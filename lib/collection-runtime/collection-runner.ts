import {
  AdapterExtractionError,
  RawCaptureService,
  type AdapterExtractionErrorSummary,
  type CollectionCompletenessAssessment,
  type RecruitmentAdapter,
  type RecruitmentEndpoint,
  type TransportRequest
} from "../ingestion";
import type {
  CollectionRequestResult,
  CollectionRunReasonCode,
  CollectionRunRuntimeResult,
  CollectionRuntimeClock,
  CollectionRuntimePolicy,
  HttpTransport
} from "./types";
import { paginationContentFingerprint, explicitPaginationEmpty } from "./pagination-content";

export interface CollectionRunnerInput {
  readonly collection_run_id: string;
  readonly endpoint: RecruitmentEndpoint;
  readonly adapter: RecruitmentAdapter;
  readonly pagination_safety?: {
    readonly approved_locators: readonly string[];
    readonly maximum_pages: number;
    readonly request_budget: number;
  };
}

export interface CollectionRunnerOptions {
  readonly transport: HttpTransport;
  readonly raw_capture: RawCaptureService;
  readonly policy: CollectionRuntimePolicy;
  readonly clock?: CollectionRuntimeClock;
}

export class CollectionRunner {
  readonly #transport: HttpTransport;
  readonly #rawCapture: RawCaptureService;
  readonly #policy: CollectionRuntimePolicy;
  readonly #clock: CollectionRuntimeClock;
  #lastRequestAtMs: number | null = null;

  constructor(options: CollectionRunnerOptions) {
    validatePolicy(options.policy);
    this.#transport = options.transport;
    this.#rawCapture = options.raw_capture;
    this.#policy = options.policy;
    this.#clock = options.clock ?? systemClock();
  }

  async run(input: CollectionRunnerInput): Promise<CollectionRunRuntimeResult> {
    const validation = input.adapter.validateEndpoint(input.endpoint);
    if (!validation.valid) throw new Error(`Adapter rejected endpoint: ${validation.issues.join("; ")}`);
    const started_at = this.#clock.now();
    const safety = input.pagination_safety;
    if (safety && (!Number.isSafeInteger(safety.maximum_pages) || safety.maximum_pages < 1 || safety.maximum_pages > 32
      || !Number.isSafeInteger(safety.request_budget) || safety.request_budget < 1 || safety.request_budget > 64
      || !safety.approved_locators.length || safety.approved_locators.length > 64
      || new Set(safety.approved_locators).size !== safety.approved_locators.length)) throw new Error("PAGINATION_BOUNDARY_INVALID");
    const maxPages = Math.min(bounded(input.endpoint.collection_config.max_pages, this.#policy.max_pages), safety?.maximum_pages ?? this.#policy.max_pages);
    const requestBudget = Math.min(this.#policy.request_budget, safety?.request_budget ?? this.#policy.request_budget);
    const retryLimit = bounded(input.endpoint.collection_config.retry_limit, this.#policy.retry_limit);
    const timeoutMs = input.endpoint.collection_config.timeout_ms ?? this.#policy.timeout_ms;
    if (timeoutMs <= 0) throw new Error("Collection timeout must be positive");

    const plans = [...input.adapter.plan(input.endpoint)];
    if (safety) {
      const planned = plans.map(plan => plan.locator).sort();
      if (JSON.stringify(planned) !== JSON.stringify([...safety.approved_locators].sort())) throw new Error("QUERY_TARGET_INVENTORY_MISMATCH");
    }
    const contentFingerprints = new Set<string>();
    const visitedLocators = new Set<string>();
    const requestResults: CollectionRequestResult[] = [];
    const snapshots = [] as CollectionRunRuntimeResult["snapshots"] extends readonly (infer Value)[] ? Value[] : never[];
    const rawBlobs = [] as CollectionRunRuntimeResult["raw_blobs"] extends readonly (infer Value)[] ? Value[] : never[];
    const records = [] as CollectionRunRuntimeResult["extracted_records"] extends readonly (infer Value)[] ? Value[] : never[];
    const extractionErrors: AdapterExtractionErrorSummary[] = [];
    const reasons = new Set<CollectionRunReasonCode>();
    let pagesCollected = 0;
    let requestsMade = 0;
    let anyFailedAttempt = false;
    let limited = false;

    while (plans.length > 0) {
      const plan = plans.shift()!;
      if (safety && !safety.approved_locators.includes(plan.locator)) throw new Error("PAGINATION_TARGET_NOT_DECLARED");
      if (pagesCollected >= maxPages) {
        reasons.add("MAX_PAGES_REACHED");
        limited = true;
        break;
      }
      if (visitedLocators.has(plan.locator)) {
        reasons.add("REPEATED_PAGE_BLOCKED");
        limited = true;
        continue;
      }
      if (requestsMade >= requestBudget) {
        reasons.add("REQUEST_BUDGET_EXHAUSTED");
        limited = true;
        break;
      }
      visitedLocators.add(plan.locator);
      const execution = await this.executePlan(plan, timeoutMs, retryLimit, requestResults, requestBudget);
      requestsMade += execution.request_count;
      anyFailedAttempt ||= execution.failed_attempt;
      for (const result of execution.results) {
        snapshots.push(result.snapshot);
        if (result.raw_blob) rawBlobs.push(result.raw_blob);
      }
      const finalResult = execution.results.at(-1);
      if (!finalResult || finalResult.response.status === "FAILED") {
        reasons.add("TRANSPORT_FAILED");
        continue;
      }

      pagesCollected += 1;
      try {
        const extracted = input.adapter.extract({
          endpoint: input.endpoint,
          snapshot: finalResult.snapshot,
          raw_blob: finalResult.raw_blob
        });
        records.push(...extracted);
        if (safety) {
          const fingerprint = paginationContentFingerprint(extracted);
          const empty = explicitPaginationEmpty(finalResult.raw_blob, extracted);
          const repeated = extracted.length > 0 && contentFingerprints.has(fingerprint);
          contentFingerprints.add(fingerprint);
          if (empty || repeated) {
            reasons.add(empty ? "EMPTY_PAGE_STOP" : "REPEATED_CONTENT_BLOCKED");
            limited = plans.length > 0;
            break;
          }
        }
      } catch (error) {
        extractionErrors.push({
          snapshot_id: finalResult.snapshot.snapshot_id,
          code: error instanceof AdapterExtractionError ? error.code : "UNEXPECTED_EXTRACTION_ERROR",
          message: error instanceof Error ? error.message : "Unknown extraction error"
        });
        reasons.add("ADAPTER_EXTRACTION_FAILED");
        continue;
      }

      try {
        const nextPage = input.adapter.nextPage({
          endpoint: input.endpoint,
          snapshot: finalResult.snapshot,
          pagination_state: plan.pagination_state
        });
        if (nextPage) {
          if (safety && !safety.approved_locators.includes(nextPage.locator)) throw new Error("PAGINATION_TARGET_NOT_DECLARED");
          if (!safety || !plans.some(planned => planned.locator === nextPage.locator)) plans.push(nextPage);
        }
      } catch (error) {
        extractionErrors.push({
          snapshot_id: finalResult.snapshot.snapshot_id,
          code: error instanceof AdapterExtractionError ? error.code : "MALFORMED_NEXT_PAGE",
          message: error instanceof Error ? error.message : "Unknown pagination error"
        });
        reasons.add("MALFORMED_NEXT_PAGE");
        limited = true;
      }
    }

    const completeness = input.adapter.assessCompleteness({
      snapshots,
      records,
      extraction_errors: extractionErrors
    });
    if (anyFailedAttempt) reasons.add("TRANSPORT_FAILED");
    const status = classify({ completeness, records, reasons, limited, anyFailedAttempt });
    if (anyFailedAttempt && status !== "FAILED") reasons.add("RETRIED_TRANSPORT_FAILURE");
    if (completeness.status === "PARTIAL") reasons.add("ADAPTER_REPORTED_PARTIAL");
    if (status === "SUSPICIOUS_EMPTY") reasons.add("ZERO_EXTRACTED_RECORDS");

    return {
      collection_run_id: input.collection_run_id,
      source_definition_id: input.endpoint.source_definition_id,
      recruitment_endpoint_id: input.endpoint.recruitment_endpoint_id,
      started_at,
      completed_at: this.#clock.now(),
      status,
      runtime_states: ["CREATED", "RUNNING", "COMPLETED"],
      reason_codes: [...reasons].sort(),
      request_results: requestResults,
      snapshots,
      raw_blobs: rawBlobs,
      extracted_records: records,
      pages_collected: pagesCollected,
      requests_made: requestsMade
    };
  }

  private async executePlan(
    plan: CollectionRequestResult["plan"],
    timeoutMs: number,
    retryLimit: number,
    results: CollectionRequestResult[],
    requestBudget = this.#policy.request_budget
  ) {
    const localResults: CollectionRequestResult[] = [];
    let failedAttempt = false;
    for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
      if (results.length >= requestBudget) break;
      await this.waitForRateLimit(attempt);
      const request: TransportRequest = {
        recruitment_endpoint_id: plan.recruitment_endpoint_id,
        locator: plan.locator,
        method: plan.method,
        requested_at: this.#clock.now(),
        headers: {},
        parameters: plan.parameters
      };
      const response = await this.#transport.execute({ ...request, timeout_ms: timeoutMs });
      this.#lastRequestAtMs = this.#clock.now_ms();
      const captured = this.#rawCapture.record(request, response);
      const result: CollectionRequestResult = { plan, attempt, request, response, ...captured };
      results.push(result);
      localResults.push(result);
      if (response.status === "SUCCESS") break;
      failedAttempt = true;
      if (!response.error.retryable || attempt === retryLimit) break;
      await this.#clock.sleep(this.#policy.retry_backoff_ms * (2 ** attempt));
    }
    return { results: localResults, request_count: localResults.length, failed_attempt: failedAttempt };
  }

  private async waitForRateLimit(attempt: number) {
    if (this.#lastRequestAtMs === null) return;
    const elapsed = this.#clock.now_ms() - this.#lastRequestAtMs;
    const wait = Math.max(0, this.#policy.rate_limit_ms - elapsed);
    if (wait > 0 && attempt === 0) await this.#clock.sleep(wait);
  }
}

function bounded(value: number | undefined, maximum: number) {
  return value === undefined ? maximum : Math.min(value, maximum);
}

function classify(input: {
  readonly completeness: CollectionCompletenessAssessment;
  readonly records: readonly unknown[];
  readonly reasons: ReadonlySet<CollectionRunReasonCode>;
  readonly limited: boolean;
  readonly anyFailedAttempt: boolean;
}) {
  if (input.records.length === 0 && input.reasons.has("EMPTY_PAGE_STOP") && !input.reasons.has("ADAPTER_EXTRACTION_FAILED")) return "SUSPICIOUS_EMPTY" as const;
  if (input.reasons.has("TRANSPORT_FAILED")) return "FAILED" as const;
  if (input.limited || input.reasons.has("MALFORMED_NEXT_PAGE") || input.reasons.has("REPEATED_PAGE_BLOCKED") || input.completeness.status === "PARTIAL") return "PARTIAL" as const;
  if (input.reasons.has("ADAPTER_EXTRACTION_FAILED") || input.completeness.status === "FAILED" || input.anyFailedAttempt) return "FAILED" as const;
  if (input.records.length === 0 || input.completeness.status === "SUSPICIOUS_EMPTY") return "SUSPICIOUS_EMPTY" as const;
  return "SUCCESS" as const;
}

function validatePolicy(policy: CollectionRuntimePolicy) {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`Collection policy ${name} must be a non-negative integer`);
  }
  if (policy.timeout_ms === 0 || policy.max_pages === 0 || policy.request_budget === 0) {
    throw new Error("Collection policy timeout, max pages, and request budget must be positive");
  }
}

function systemClock(): CollectionRuntimeClock {
  return {
    now: () => new Date().toISOString() as ReturnType<CollectionRuntimeClock["now"]>,
    now_ms: () => Date.now(),
    sleep: (delay_ms) => new Promise((resolve) => setTimeout(resolve, delay_ms))
  };
}
