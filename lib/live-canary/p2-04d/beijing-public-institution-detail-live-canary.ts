import { createHash, randomUUID } from "node:crypto";

import * as cheerio from "cheerio";

import {
  InMemoryLiveCanaryAuthorizationGate,
  InMemorySourceAdmissionRegister,
  SOURCE_PROHIBITED_ACTIONS,
  type LiveCanaryAuthorizationDecision,
  type LiveCanaryCollectionRunId,
  type LiveCanaryExecutionRequest,
  type LiveCanaryManualAuthorization,
  type SourceAdmission,
  type SourceAdmissionEvidence,
  type SourceAdmissionEvidenceId,
  type SourceAdmissionReviewId
} from "../../application";
import type { HttpTransportRequest } from "../../collection-runtime";
import {
  InMemoryRawBlobRepository,
  InMemorySnapshotRepository,
  RawCaptureService,
  UTF8_TEXT_ENCODING,
  type IsoDateTime,
  type RawBlob,
  type RawContentSha256,
  type RecruitmentEndpoint,
  type RecruitmentEndpointId,
  type Snapshot,
  type SnapshotId,
  type SourceDefinitionId,
  type TransportHeaders,
  type TransportResponse
} from "../../ingestion";

export const BEIJING_PUBLIC_INSTITUTION_DETAIL_SOURCE_DEFINITION_ID =
  "source-cn-beijing-government-public-institution-recruitment" as SourceDefinitionId;
export const BEIJING_PUBLIC_INSTITUTION_DETAIL_SOURCE_ADMISSION_ID =
  "admission-beijing-public-institution-job-detail" as SourceAdmission["source_admission_id"];
export const BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID =
  "endpoint-cn-beijing-government-public-institution-job-detail-html" as RecruitmentEndpointId;
export const BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT =
  "https://www.beijing.gov.cn/gongkai/rsxx/sydwzp/202606/t20260625_4714884.html";
export const BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY =
  "cn-beijing-government-public-institution-detail-html";
export const BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_REVIEWER = "human-approved-by-user";
export const BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_TIMEOUT_MS = 10_000;
export const BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const robotsLocator = "https://www.beijing.gov.cn/robots.txt";
const termsLocator = "https://www.beijing.gov.cn/";
const sensitiveHeaderName = /authorization|cookie|token|password|secret|session|api[_-]?key/iu;

export interface HumanReviewedDetailCanaryEvidence {
  readonly evidence_id: SourceAdmissionEvidenceId;
  readonly evidence_type: "HUMAN_REVIEWED_CANARY";
  readonly source_url: string;
  readonly observed_at: IsoDateTime;
  readonly reviewer: string;
  readonly observation: string;
  readonly decision: "APPROVED_FOR_ONE_ENDPOINT_ONE_RUN";
}

export interface BeijingDetailLiveCanaryApprovalBundle {
  readonly initial_admission: SourceAdmission;
  readonly approved_admission: SourceAdmission;
  readonly recruitment_endpoint: RecruitmentEndpoint;
  readonly authorization: LiveCanaryManualAuthorization;
  readonly execution: LiveCanaryExecutionRequest;
  readonly evidence: HumanReviewedDetailCanaryEvidence;
  readonly authorization_decision: Extract<LiveCanaryAuthorizationDecision, { allowed: true }>;
  readonly authorization_gate: InMemoryLiveCanaryAuthorizationGate;
}

export interface BeijingDetailCanaryAccessSignals {
  readonly login_form_observed: boolean;
  readonly captcha_observed: boolean;
  readonly anti_bot_observed: boolean;
  readonly response_set_cookie_observed: boolean;
}

export interface BeijingDetailLiveCanaryTransportResult {
  readonly response: TransportResponse;
  readonly final_url: string;
  readonly redirect_chain: readonly {
    readonly status: number;
    readonly location: string | null;
  }[];
  readonly request_count: 1;
  readonly elapsed_ms: number;
  readonly response_size: number;
  readonly response_content_type: string | null;
  readonly encoding: string | null;
  readonly access_signals: BeijingDetailCanaryAccessSignals;
}

export interface BeijingDetailHtmlDiagnostic {
  readonly page_title: string | null;
  readonly document_language: string | null;
  readonly encoding: string;
  readonly body_text_length: number;
  readonly heading_samples: readonly string[];
  readonly table_count: number;
  readonly list_count: number;
  readonly anchor_count: number;
  readonly date_samples: readonly string[];
  readonly candidate_content_selectors: readonly string[];
  readonly legal_term_observations: Readonly<Record<string, boolean>>;
}

export interface BeijingDetailLiveCanaryResult {
  readonly approval: BeijingDetailLiveCanaryApprovalBundle;
  readonly request: HttpTransportRequest;
  readonly transport: BeijingDetailLiveCanaryTransportResult;
  readonly raw_blob: RawBlob | null;
  readonly snapshot: Snapshot;
  readonly html_diagnostic: BeijingDetailHtmlDiagnostic | null;
  readonly authorization_replay_decision: LiveCanaryAuthorizationDecision;
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export function createBeijingDetailLiveCanaryApproval(
  issuedAt: IsoDateTime,
  reviewer = BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_REVIEWER
): BeijingDetailLiveCanaryApprovalBundle {
  const robotsEvidenceId = evidenceId("robots");
  const termsEvidenceId = evidenceId("terms");
  const approvalEvidenceId = evidenceId("human-canary");
  const initialAdmission = createInitialAdmission(
    issuedAt,
    reviewer,
    robotsEvidenceId,
    termsEvidenceId
  );
  const register = new InMemorySourceAdmissionRegister();
  register.register(initialAdmission);

  const approvalEvidence: SourceAdmissionEvidence = {
    source_admission_evidence_id: approvalEvidenceId,
    source_admission_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_SOURCE_ADMISSION_ID,
    endpoint: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
    source_url: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
    kind: "MANUAL_REVIEW",
    locator: `manual://p2-04d/${approvalEvidenceId}`,
    captured_at: issuedAt,
    reviewer,
    decision: "ALLOWED",
    summary: original(
      "人工仅批准本精确详情 URL 的一次 GET Canary；robots=UNKNOWN、terms=UNKNOWN 不解释为自动化访问许可。"
    )
  };
  const approvedAdmission = register.revise({
    ...initialAdmission,
    automation_basis: "HUMAN_REVIEWED_CANARY",
    admission_decision: "APPROVED",
    evidence: [...initialAdmission.evidence, approvalEvidence],
    review_records: [
      ...initialAdmission.review_records,
      {
        source_admission_review_id: reviewId("human-canary"),
        reviewer,
        reviewed_at: issuedAt,
        decision: "APPROVED",
        rationale: original(
          "人工批准此单一详情 Endpoint、单一 GET、单一 Collection Run 的 P2-04D Canary；不授予长期、批量或其他 URL 的访问权限。"
        ),
        evidence_ids: [approvalEvidenceId]
      }
    ]
  });

  const recruitmentEndpoint = createBeijingDetailEndpoint();
  const collectionRunId = `p2-04d-run:${randomUUID()}` as LiveCanaryCollectionRunId;
  const authorization: LiveCanaryManualAuthorization = {
    authorization_id: `p2-04d-authorization:${randomUUID()}` as LiveCanaryManualAuthorization["authorization_id"],
    source_admission_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_SOURCE_ADMISSION_ID,
    endpoint: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
    endpoint_purpose: "JOB_DETAIL",
    allowed_http_method: "GET",
    collection_run_id: collectionRunId,
    reviewer,
    issued_at: issuedAt,
    evidence_id: approvalEvidenceId,
    scope: "ONE_ENDPOINT_ONE_RUN",
    manual_confirmation: true
  };
  const execution: LiveCanaryExecutionRequest = {
    source_admission_id: authorization.source_admission_id,
    endpoint: authorization.endpoint,
    recruitment_endpoint_id: authorization.recruitment_endpoint_id,
    recruitment_endpoint: recruitmentEndpoint,
    endpoint_purpose: authorization.endpoint_purpose,
    allowed_http_method: authorization.allowed_http_method,
    collection_run_id: authorization.collection_run_id
  };
  const authorizationGate = new InMemoryLiveCanaryAuthorizationGate();
  const authorizationDecision = authorizationGate.authorize(
    approvedAdmission,
    execution,
    authorization
  );
  if (!authorizationDecision.allowed) {
    throw new Error(
      `Human-approved detail Canary authorization was denied: ${authorizationDecision.reason_codes.join(", ")}`
    );
  }

  return {
    initial_admission: initialAdmission,
    approved_admission: approvedAdmission,
    recruitment_endpoint: recruitmentEndpoint,
    authorization,
    execution,
    evidence: {
      evidence_id: approvalEvidenceId,
      evidence_type: "HUMAN_REVIEWED_CANARY",
      source_url: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
      observed_at: issuedAt,
      reviewer,
      observation:
        "官方公开招聘详情页面；robots=UNKNOWN；terms=UNKNOWN；本次仅进行人工批准的一次性受控 Canary。",
      decision: "APPROVED_FOR_ONE_ENDPOINT_ONE_RUN"
    },
    authorization_decision: authorizationDecision,
    authorization_gate: authorizationGate
  };
}

export class OneEndpointOneRunDetailLiveCanaryTransport {
  readonly #fetch: FetchImplementation;
  readonly #now: () => IsoDateTime;
  readonly #monotonicNow: () => number;
  #used = false;

  constructor(
    fetchImplementation: FetchImplementation,
    options: {
      readonly now?: () => IsoDateTime;
      readonly monotonic_now?: () => number;
    } = {}
  ) {
    this.#fetch = fetchImplementation;
    this.#now = options.now ?? (() => new Date().toISOString() as IsoDateTime);
    this.#monotonicNow = options.monotonic_now ?? (() => performance.now());
  }

  async execute(request: HttpTransportRequest): Promise<BeijingDetailLiveCanaryTransportResult> {
    validateLiveRequest(request);
    if (this.#used) {
      throw new Error("ONE_ENDPOINT_ONE_RUN detail transport has already been consumed");
    }
    this.#used = true;

    const startedAt = this.#monotonicNow();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeout_ms);
    try {
      const response = await this.#fetch(request.locator, {
        method: "GET",
        headers: { accept: "text/html,application/xhtml+xml" },
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      });
      const responseHeaders = safeResponseHeaders(response.headers);
      const contentType = response.headers.get("content-type");
      const finalUrl = response.url || request.locator;
      const elapsedMs = elapsed(startedAt, this.#monotonicNow());
      const signals = emptyAccessSignals(response.headers);

      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        return failedResult({
          responded_at: this.#now(),
          code: "UNAUTHORIZED_REDIRECT",
          message: `Redirect was not followed: ${response.headers.get("location") ?? "missing Location"}`,
          http_status: response.status,
          headers: responseHeaders,
          content_type: contentType,
          final_url: finalUrl,
          redirect_chain: [{ status: response.status, location: response.headers.get("location") }],
          elapsed_ms: elapsedMs,
          response_size: 0,
          encoding: null,
          access_signals: signals
        });
      }
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel();
        return failedResult({
          responded_at: this.#now(),
          code: httpFailureCode(response.status),
          message: `HTTP status ${response.status}`,
          http_status: response.status,
          headers: responseHeaders,
          content_type: contentType,
          final_url: finalUrl,
          redirect_chain: [],
          elapsed_ms: elapsedMs,
          response_size: 0,
          encoding: null,
          access_signals: signals
        });
      }
      if (!contentType?.toLowerCase().startsWith("text/html")) {
        await response.body?.cancel();
        return failedResult({
          responded_at: this.#now(),
          code: "NON_HTML_RESPONSE",
          message: `Expected HTML but received ${contentType ?? "no Content-Type"}`,
          http_status: response.status,
          headers: responseHeaders,
          content_type: contentType,
          final_url: finalUrl,
          redirect_chain: [],
          elapsed_ms: elapsedMs,
          response_size: 0,
          encoding: null,
          access_signals: signals
        });
      }

      const declaredLength = parseContentLength(response.headers.get("content-length"));
      if (
        declaredLength !== null
        && declaredLength > BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_MAX_RESPONSE_BYTES
      ) {
        await response.body?.cancel();
        return failedResult({
          responded_at: this.#now(),
          code: "RESPONSE_SIZE_LIMIT",
          message: `Declared response size ${declaredLength} exceeds budget`,
          http_status: response.status,
          headers: responseHeaders,
          content_type: contentType,
          final_url: finalUrl,
          redirect_chain: [],
          elapsed_ms: elapsedMs,
          response_size: 0,
          encoding: null,
          access_signals: signals
        });
      }

      const bytes = await readBodyWithLimit(
        response,
        BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_MAX_RESPONSE_BYTES
      );
      const encoding = detectEncoding(bytes, contentType);
      const observedSignals = inspectAccessSignals(bytes, encoding, response.headers);
      const blockingReason = blockingReasonFor(observedSignals);
      if (blockingReason) {
        return failedResult({
          responded_at: this.#now(),
          code: "BLOCKING_CONTENT_OBSERVED",
          message: blockingReason,
          http_status: response.status,
          headers: responseHeaders,
          content_type: contentType,
          final_url: finalUrl,
          redirect_chain: [],
          elapsed_ms: elapsedMs,
          response_size: bytes.byteLength,
          encoding,
          access_signals: observedSignals
        });
      }
      return {
        response: {
          status: "SUCCESS",
          responded_at: this.#now(),
          bytes,
          content_sha256: sha256(bytes),
          mime_type: contentType,
          http_status: response.status,
          headers: responseHeaders
        },
        final_url: finalUrl,
        redirect_chain: [],
        request_count: 1,
        elapsed_ms: elapsedMs,
        response_size: bytes.byteLength,
        response_content_type: contentType,
        encoding,
        access_signals: observedSignals
      };
    } catch (error) {
      const timeoutFailure = error instanceof DOMException && error.name === "AbortError";
      return failedResult({
        responded_at: this.#now(),
        code: timeoutFailure ? "TIMEOUT" : errorCode(error),
        message: errorMessage(error),
        http_status: null,
        headers: {},
        content_type: null,
        final_url: request.locator,
        redirect_chain: [],
        elapsed_ms: elapsed(startedAt, this.#monotonicNow()),
        response_size: 0,
        encoding: null,
        access_signals: emptyAccessSignals()
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function runBeijingDetailLiveCanary(
  approval: BeijingDetailLiveCanaryApprovalBundle,
  transport: OneEndpointOneRunDetailLiveCanaryTransport,
  requestedAt: IsoDateTime
): Promise<BeijingDetailLiveCanaryResult> {
  const request: HttpTransportRequest = {
    recruitment_endpoint_id: approval.recruitment_endpoint.recruitment_endpoint_id,
    locator: approval.recruitment_endpoint.locator,
    method: "GET",
    requested_at: requestedAt,
    headers: {},
    parameters: {},
    timeout_ms: BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_TIMEOUT_MS
  };
  const rawBlobs = new InMemoryRawBlobRepository();
  const snapshots = new InMemorySnapshotRepository();
  const capture = new RawCaptureService(rawBlobs, snapshots, {
    create_snapshot_id: () => `p2-04d-snapshot:${randomUUID()}` as SnapshotId
  });
  const transportResult = await transport.execute(request);
  const captured = capture.record(request, transportResult.response);
  const replayDecision = approval.authorization_gate.authorize(
    approval.approved_admission,
    approval.execution,
    approval.authorization
  );

  return {
    approval,
    request,
    transport: transportResult,
    raw_blob: captured.raw_blob,
    snapshot: captured.snapshot,
    html_diagnostic: captured.raw_blob
      ? diagnoseBeijingDetailHtml(captured.raw_blob.bytes, captured.raw_blob.mime_type)
      : null,
    authorization_replay_decision: replayDecision
  };
}

export function diagnoseBeijingDetailHtml(
  bytes: Uint8Array,
  contentType: string
): BeijingDetailHtmlDiagnostic {
  const encoding = detectEncoding(bytes, contentType);
  const text = new TextDecoder(encoding).decode(bytes);
  const $ = cheerio.load(text);
  const bodyText = $("body").text().replace(/\s+/gu, " ").trim();
  const candidates = ["#main", ".main", ".article", ".content", ".TRS_Editor"]
    .filter((selector) => $(selector).length > 0);
  const datePattern = /(?:19|20)\d{2}[年\-\/.]\d{1,2}[月\-\/.]\d{1,2}日?/gu;
  const legalTerms = [
    "法律硕士",
    "法律硕士（非法学）",
    "法学硕士",
    "法学专业",
    "法学类",
    "法律专业",
    "本科专业",
    "硕士专业",
    "法律职业资格"
  ];
  return {
    page_title: $("title").first().text().replace(/\s+/gu, " ").trim() || null,
    document_language: $("html").attr("lang") ?? null,
    encoding,
    body_text_length: bodyText.length,
    heading_samples: $("h1,h2,h3").toArray().map((element) => {
      return $(element).text().replace(/\s+/gu, " ").trim();
    }).filter(Boolean).slice(0, 20),
    table_count: $("table").length,
    list_count: $("ul,ol").length,
    anchor_count: $("a[href]").length,
    date_samples: [...new Set((bodyText.match(datePattern) ?? []).slice(0, 20))],
    candidate_content_selectors: candidates,
    legal_term_observations: Object.fromEntries(legalTerms.map((term) => [term, bodyText.includes(term)]))
  };
}

function createInitialAdmission(
  observedAt: IsoDateTime,
  reviewer: string,
  robotsEvidenceId: SourceAdmissionEvidenceId,
  termsEvidenceId: SourceAdmissionEvidenceId
): SourceAdmission {
  const evidence: readonly SourceAdmissionEvidence[] = [
    {
      source_admission_evidence_id: robotsEvidenceId,
      source_admission_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_SOURCE_ADMISSION_ID,
      endpoint: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
      source_url: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
      kind: "ROBOTS",
      locator: robotsLocator,
      captured_at: observedAt,
      reviewer,
      decision: "UNKNOWN",
      summary: original(
        "本精确详情 Endpoint 未取得独立 robots 规则证据；UNKNOWN 不解释为 ALLOWED 或 DISALLOWED。"
      )
    },
    {
      source_admission_evidence_id: termsEvidenceId,
      source_admission_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_SOURCE_ADMISSION_ID,
      endpoint: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
      source_url: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
      kind: "TERMS",
      locator: termsLocator,
      captured_at: observedAt,
      reviewer,
      decision: "UNKNOWN",
      summary: original(
        "本精确详情 Endpoint 未取得明确的自动化访问条款；UNKNOWN 不解释为 ALLOWED 或 DISALLOWED。"
      )
    }
  ];
  return {
    source_admission_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_SOURCE_ADMISSION_ID,
    admission_level: "B",
    automation_basis: "INSUFFICIENT_EVIDENCE",
    source_name: traceable("北京市人民政府事业单位招聘"),
    source_type: "OFFICIAL_RECRUITMENT_PAGE",
    official_owner: traceable("北京市人民政府"),
    endpoint: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
    endpoint_purpose: "JOB_DETAIL",
    allowed_http_method: "GET",
    content_kind: "HTML",
    source_authority: "OFFICIAL",
    robots: { status: "UNKNOWN", evidence_id: robotsEvidenceId },
    terms: { status: "UNKNOWN", evidence_id: termsEvidenceId },
    login_requirement: "NONE",
    captcha: "NONE_OBSERVED",
    structure: "UNKNOWN",
    stability: "UNKNOWN",
    update_frequency: "UNKNOWN",
    priority: "HIGH",
    prohibited_actions: SOURCE_PROHIBITED_ACTIONS,
    evidence,
    review_records: [{
      source_admission_review_id: reviewId("pre-canary"),
      reviewer,
      reviewed_at: observedAt,
      decision: "REVIEW",
      rationale: original(
        "详情页需独立于列表页进行人工一次性准入；robots=UNKNOWN、terms=UNKNOWN。"
      ),
      evidence_ids: [robotsEvidenceId, termsEvidenceId]
    }],
    admission_decision: "REVIEW"
  };
}

function createBeijingDetailEndpoint(): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
    source_definition_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_SOURCE_DEFINITION_ID,
    name: traceable("北京急救中心2026年度第四批公开招聘公告详情"),
    description: traceable("P2-04D 单一详情 URL 的 Raw/Snapshot 与离线 source-fact Adapter 输入。"),
    coverage_regions: [{ raw_text: original("北京市") }],
    locator: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
    request_method: "GET",
    content_kind: "HTML",
    adapter_key: BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY,
    decoded_text_encoding: UTF8_TEXT_ENCODING,
    collection_config: {
      timeout_ms: BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_TIMEOUT_MS,
      max_items: 1,
      max_pages: 1,
      follow_redirects: false,
      retry_limit: 0
    },
    enabled: false
  };
}

function validateLiveRequest(request: HttpTransportRequest) {
  if (request.recruitment_endpoint_id !== BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID) {
    throw new Error("Live Canary RecruitmentEndpoint is not authorized");
  }
  if (request.locator !== BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT) {
    throw new Error("Live Canary locator is not the exact authorized Endpoint");
  }
  if (request.method !== "GET") throw new Error("Live Canary permits GET only");
  if (request.timeout_ms !== BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_TIMEOUT_MS) {
    throw new Error("Live Canary timeout must match the fixed policy");
  }
  if (Object.keys(request.parameters).length > 0 || Object.keys(request.headers).length > 0) {
    throw new Error("Live Canary does not accept caller-supplied headers or parameters");
  }
}

async function readBodyWithLimit(response: Response, maximumBytes: number) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel("P2-04D response size budget exceeded");
      throw Object.assign(new Error(`Response exceeds ${maximumBytes} byte budget`), {
        code: "RESPONSE_SIZE_LIMIT"
      });
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function inspectAccessSignals(
  bytes: Uint8Array,
  encoding: string,
  headers: Headers
): BeijingDetailCanaryAccessSignals {
  const text = new TextDecoder(encoding).decode(bytes);
  return {
    login_form_observed: /<input[^>]+type=["']password["']/iu.test(text),
    captcha_observed: /(?:验证码|captcha)/iu.test(text),
    anti_bot_observed: /(?:访问过于频繁|安全验证|robot check|cloudflare)/iu.test(text),
    response_set_cookie_observed: headers.has("set-cookie")
  };
}

function emptyAccessSignals(headers?: Headers): BeijingDetailCanaryAccessSignals {
  return {
    login_form_observed: false,
    captcha_observed: false,
    anti_bot_observed: false,
    response_set_cookie_observed: headers?.has("set-cookie") ?? false
  };
}

function blockingReasonFor(signals: BeijingDetailCanaryAccessSignals) {
  if (signals.login_form_observed) return "Login form observed";
  if (signals.captcha_observed) return "CAPTCHA marker observed";
  if (signals.anti_bot_observed) return "Anti-bot marker observed";
  return null;
}

function detectEncoding(bytes: Uint8Array, contentType: string) {
  const headerCharset = /charset\s*=\s*["']?([^;\s"']+)/iu.exec(contentType)?.[1];
  if (headerCharset) return normalizeEncoding(headerCharset);
  const asciiSample = new TextDecoder("latin1").decode(bytes.slice(0, 4_096));
  const metaCharset = /<meta[^>]+charset\s*=\s*["']?([^\s"'/>]+)/iu.exec(asciiSample)?.[1]
    ?? /<meta[^>]+content=["'][^"']*charset=([^\s"';>]+)/iu.exec(asciiSample)?.[1];
  return normalizeEncoding(metaCharset ?? "utf-8");
}

function normalizeEncoding(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "gb2312" || normalized === "gbk") return "gb18030";
  return normalized;
}

function safeResponseHeaders(headers: Headers): TransportHeaders {
  return Object.fromEntries([...headers.entries()].filter(([name]) => {
    return !sensitiveHeaderName.test(name) && name.toLowerCase() !== "set-cookie";
  }));
}

function failedResult(input: {
  readonly responded_at: IsoDateTime;
  readonly code: string;
  readonly message: string;
  readonly http_status: number | null;
  readonly headers: TransportHeaders;
  readonly content_type: string | null;
  readonly final_url: string;
  readonly redirect_chain: BeijingDetailLiveCanaryTransportResult["redirect_chain"];
  readonly elapsed_ms: number;
  readonly response_size: number;
  readonly encoding: string | null;
  readonly access_signals: BeijingDetailCanaryAccessSignals;
}): BeijingDetailLiveCanaryTransportResult {
  return {
    response: {
      status: "FAILED",
      responded_at: input.responded_at,
      http_status: input.http_status,
      headers: input.headers,
      mime_type: input.content_type,
      error: { code: input.code, message: input.message, retryable: false }
    },
    final_url: input.final_url,
    redirect_chain: input.redirect_chain,
    request_count: 1,
    elapsed_ms: input.elapsed_ms,
    response_size: input.response_size,
    response_content_type: input.content_type,
    encoding: input.encoding,
    access_signals: input.access_signals
  };
}

function parseContentLength(value: string | null) {
  if (value === null || !/^\d+$/u.test(value)) return null;
  return Number(value);
}

function httpFailureCode(status: number) {
  if (status === 403) return "HTTP_403";
  if (status === 429) return "HTTP_429";
  return "HTTP_ERROR";
}

function elapsed(startedAt: number, endedAt: number) {
  return Math.max(0, Math.round(endedAt - startedAt));
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String(error.code);
  }
  return "NETWORK_ERROR";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Live Canary error";
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex") as RawContentSha256;
}

function evidenceId(label: string) {
  return `p2-04d-evidence:${label}:${randomUUID()}` as SourceAdmissionEvidenceId;
}

function reviewId(label: string) {
  return `p2-04d-review:${label}:${randomUUID()}` as SourceAdmissionReviewId;
}

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}
