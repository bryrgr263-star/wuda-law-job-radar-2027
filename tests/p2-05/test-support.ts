import {
  SOURCE_PROHIBITED_ACTIONS,
  type AccessReviewStatus,
  type LiveCanaryManualAuthorization,
  type SourceAdmission,
  type SourceAdmissionLevel,
  type SourceAdmissionStatus,
  type SourceAutomationBasis
} from "../../lib/application";
import type { CollectionRunRuntimeResult } from "../../lib/collection-runtime";
import {
  UTF8_TEXT_ENCODING,
  type RawBlobId,
  type RawContentSha256,
  type RecruitmentEndpoint,
  type Snapshot
} from "../../lib/ingestion";
import type { SourceAdmissionEvidenceId } from "../../lib/application";

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}

export interface AdmissionOptions {
  readonly level?: SourceAdmissionLevel;
  readonly decision?: SourceAdmissionStatus;
  readonly automation_basis?: SourceAutomationBasis;
  readonly robots?: AccessReviewStatus;
  readonly terms?: AccessReviewStatus;
  readonly source_admission_id?: string;
  readonly endpoint?: string;
}

export function admission(options: AdmissionOptions = {}): SourceAdmission {
  const sourceAdmissionId = (options.source_admission_id ?? "admission-p2-05-test") as SourceAdmission["source_admission_id"];
  const endpoint = options.endpoint ?? "https://example.invalid/recruitment";
  const robots = options.robots ?? "ALLOWED";
  const terms = options.terms ?? "ALLOWED";
  const decision = options.decision ?? "APPROVED";
  const level = options.level ?? "A";
  const automationBasis = options.automation_basis ?? "EXPLICIT_OFFICIAL_POLICY";
  const robotsEvidenceId = "evidence-p2-05-robots" as SourceAdmissionEvidenceId;
  const termsEvidenceId = "evidence-p2-05-terms" as SourceAdmissionEvidenceId;
  const reviewEvidenceId = "evidence-p2-05-review" as SourceAdmissionEvidenceId;
  return {
    source_admission_id: sourceAdmissionId,
    admission_level: level,
    automation_basis: automationBasis,
    source_name: traceable("P2-05 官方来源"),
    source_type: "OFFICIAL_RECRUITMENT_PAGE",
    official_owner: traceable("P2-05 官方单位"),
    endpoint,
    recruitment_endpoint_id: "endpoint-p2-05-test" as SourceAdmission["recruitment_endpoint_id"],
    endpoint_purpose: "JOB_LIST",
    allowed_http_method: "GET",
    content_kind: "HTML",
    source_authority: "OFFICIAL",
    robots: { status: robots, evidence_id: robotsEvidenceId },
    terms: { status: terms, evidence_id: termsEvidenceId },
    login_requirement: "NONE",
    captcha: "NONE_OBSERVED",
    structure: "STATIC_HTML",
    stability: "HIGH",
    update_frequency: "DAILY",
    priority: "HIGH",
    prohibited_actions: SOURCE_PROHIBITED_ACTIONS,
    evidence: [
      evidence(sourceAdmissionId, endpoint, robotsEvidenceId, "ROBOTS", robots),
      evidence(sourceAdmissionId, endpoint, termsEvidenceId, "TERMS", terms),
      evidence(sourceAdmissionId, endpoint, reviewEvidenceId, "MANUAL_REVIEW", decision === "APPROVED" ? "ALLOWED" : "UNKNOWN")
    ],
    review_records: [{
      source_admission_review_id: "review-p2-05" as SourceAdmission["review_records"][number]["source_admission_review_id"],
      reviewer: "p2-05-test-reviewer",
      reviewed_at: "2026-09-02T00:00:00.000Z" as never,
      decision,
      rationale: original("P2-05 离线调度测试。"),
      evidence_ids: [robotsEvidenceId, termsEvidenceId, reviewEvidenceId]
    }],
    admission_decision: decision
  };
}

function evidence(
  sourceAdmissionId: SourceAdmission["source_admission_id"],
  endpoint: string,
  evidenceId: SourceAdmissionEvidenceId,
  kind: SourceAdmission["evidence"][number]["kind"],
  decision: AccessReviewStatus
): SourceAdmission["evidence"][number] {
  return {
    source_admission_evidence_id: evidenceId,
    source_admission_id: sourceAdmissionId,
    endpoint,
    source_url: endpoint,
    kind,
    locator: `manual://p2-05/${evidenceId}`,
    captured_at: "2026-09-02T00:00:00.000Z" as never,
    reviewer: "p2-05-test-reviewer",
    decision,
    summary: original("P2-05 离线证据。")
  };
}

export function endpoint(
  source: SourceAdmission,
  overrides: Partial<RecruitmentEndpoint["collection_config"]> = {}
): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: source.recruitment_endpoint_id,
    source_definition_id: "source-p2-05-test" as RecruitmentEndpoint["source_definition_id"],
    name: traceable("P2-05 招聘列表"),
    coverage_regions: [],
    locator: source.endpoint,
    request_method: "GET",
    content_kind: "HTML",
    adapter_key: "p2-05-test-only",
    decoded_text_encoding: UTF8_TEXT_ENCODING,
    collection_config: {
      max_pages: 1,
      follow_redirects: false,
      retry_limit: 0,
      ...overrides
    },
    enabled: true
  };
}

export function authorization(
  source: SourceAdmission,
  collectionRunId: string
): LiveCanaryManualAuthorization {
  return {
    authorization_id: `authorization-p2-05-${collectionRunId}` as LiveCanaryManualAuthorization["authorization_id"],
    source_admission_id: source.source_admission_id,
    endpoint: source.endpoint,
    recruitment_endpoint_id: source.recruitment_endpoint_id,
    endpoint_purpose: source.endpoint_purpose,
    allowed_http_method: "GET",
    collection_run_id: collectionRunId as LiveCanaryManualAuthorization["collection_run_id"],
    reviewer: "p2-05-test-reviewer",
    issued_at: "2026-09-02T00:00:00.000Z",
    evidence_id: source.evidence.at(-1)!.source_admission_evidence_id,
    scope: "ONE_ENDPOINT_ONE_RUN",
    manual_confirmation: true
  };
}

export function successfulSnapshot(
  snapshotId: string,
  contentHash: string,
  endpointId: Snapshot["recruitment_endpoint_id"]
): Snapshot {
  return {
    snapshot_id: snapshotId as Snapshot["snapshot_id"],
    recruitment_endpoint_id: endpointId,
    request_metadata: {
      locator: "https://example.invalid/recruitment",
      method: "GET",
      requested_at: "2026-09-02T00:00:00.000Z" as never,
      headers: {},
      parameters: {}
    },
    response_metadata: {
      http_status: 200,
      headers: {},
      mime_type: "text/html",
      content_length: 1,
      transport_error: null
    },
    observed_at: "2026-09-02T00:00:01.000Z" as never,
    transport_status: "SUCCESS",
    raw_blob_id: `raw:${snapshotId}` as RawBlobId,
    content_hash: contentHash as RawContentSha256,
    content_length: 1
  };
}

export function runResult(input: {
  readonly collection_run_id: string;
  readonly recruitment_endpoint_id: RecruitmentEndpoint["recruitment_endpoint_id"];
  readonly status: CollectionRunRuntimeResult["status"];
  readonly http_status?: number | null;
  readonly error_code?: string;
  readonly bytes?: number;
}): CollectionRunRuntimeResult {
  const failed = input.status === "FAILED";
  const httpStatus = input.http_status ?? (failed ? 500 : 200);
  const failedResponse = {
    status: "FAILED" as const,
    responded_at: "2026-09-02T00:01:00.000Z" as never,
    http_status: httpStatus,
    headers: {},
    mime_type: null,
    error: { code: input.error_code ?? "TRANSPORT_FAILURE", message: "synthetic", retryable: false }
  };
  const successfulResponse = {
    status: "SUCCESS" as const,
    responded_at: "2026-09-02T00:01:00.000Z" as never,
    bytes: new Uint8Array(input.bytes ?? 3),
    content_sha256: "hash-run" as RawContentSha256,
    mime_type: "text/html",
    http_status: httpStatus,
    headers: {}
  };
  const failedSnapshot: Snapshot = {
        snapshot_id: `snapshot:${input.collection_run_id}` as Snapshot["snapshot_id"],
        recruitment_endpoint_id: input.recruitment_endpoint_id,
        request_metadata: { locator: "https://example.invalid/recruitment", method: "GET" as const, requested_at: "2026-09-02T00:00:00.000Z" as never, headers: {}, parameters: {} },
        response_metadata: { http_status: httpStatus, headers: {}, mime_type: null, content_length: null, transport_error: failedResponse.error },
        observed_at: "2026-09-02T00:01:00.000Z" as never,
        transport_status: "FAILED" as const,
        raw_blob_id: null,
        content_hash: null,
        content_length: null
      };
  const response = failed ? failedResponse : successfulResponse;
  const snapshot = failed
    ? failedSnapshot
    : successfulSnapshot(`snapshot:${input.collection_run_id}`, "hash-run", input.recruitment_endpoint_id);
  return {
    collection_run_id: input.collection_run_id,
    source_definition_id: "source-p2-05-test",
    recruitment_endpoint_id: input.recruitment_endpoint_id,
    started_at: "2026-09-02T00:00:00.000Z" as never,
    completed_at: "2026-09-02T00:01:00.000Z" as never,
    status: input.status,
    runtime_states: ["CREATED", "RUNNING", "COMPLETED"],
    reason_codes: failed ? ["TRANSPORT_FAILED"] : ["COMPLETE_NON_EMPTY"],
    request_results: [{
      plan: {
        recruitment_endpoint_id: input.recruitment_endpoint_id,
        locator: "https://example.invalid/recruitment",
        method: "GET",
        parameters: {},
        pagination_state: { page_index: 1, cursor: null, visited_locators: [] }
      },
      attempt: 0,
      request: {
        recruitment_endpoint_id: input.recruitment_endpoint_id,
        locator: "https://example.invalid/recruitment",
        method: "GET",
        requested_at: "2026-09-02T00:00:00.000Z" as never,
        headers: {},
        parameters: {}
      },
      response,
      snapshot,
      raw_blob: null
    }],
    snapshots: [snapshot],
    raw_blobs: [],
    extracted_records: [],
    pages_collected: input.status === "FAILED" ? 0 : 1,
    requests_made: 1
  };
}
