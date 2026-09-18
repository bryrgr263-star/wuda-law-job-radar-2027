import { createHash, randomUUID } from "node:crypto";

import {
  InMemoryObservationCanaryAuthorizationGate,
  InMemorySourceAdmissionRegister,
  SOURCE_PROHIBITED_ACTIONS,
  type LiveCanaryExecutionRequest,
  type ObservationCanaryAuthorizationDecision,
  type ObservationCanaryManualAuthorization,
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
  type TransportHeaders,
  type TransportResponse
} from "../../ingestion";

export const SHENZHEN_LEGAL_NOTICE_URL =
  "https://sf.sz.gov.cn/gkmlpt/content/12/12224/post_12224538.html";
export const SHENZHEN_LEGAL_PDF_URL =
  "https://sf.sz.gov.cn/attachment/1/1592/1592992/12224540.pdf";
export const SHENZHEN_LEGAL_TIMEOUT_MS = 20_000;
export const SHENZHEN_LEGAL_NOTICE_MAX_BYTES = 5 * 1024 * 1024;
export const SHENZHEN_LEGAL_PDF_MAX_BYTES = 20 * 1024 * 1024;
export const SHENZHEN_LEGAL_OBSERVATION_REVIEWER = "human-approved-by-user";

export type ShenzhenLegalEndpointKind = "NOTICE" | "POSITION_TABLE_PDF";
export type AccessObservation = "OBSERVED" | "NONE_OBSERVED" | "UNKNOWN";

interface EndpointPolicy {
  readonly kind: ShenzhenLegalEndpointKind;
  readonly endpoint: string;
  readonly source_admission_id: SourceAdmission["source_admission_id"];
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly source_definition_id: RecruitmentEndpoint["source_definition_id"];
  readonly endpoint_purpose: "RECRUITMENT_NOTICE" | "RECRUITMENT_ATTACHMENT";
  readonly content_kind: "HTML" | "PDF";
  readonly expected_mime: "text/html" | "application/pdf";
  readonly maximum_bytes: number;
  readonly name: string;
}

const policies: Readonly<Record<ShenzhenLegalEndpointKind, EndpointPolicy>> = {
  NOTICE: {
    kind: "NOTICE",
    endpoint: SHENZHEN_LEGAL_NOTICE_URL,
    source_admission_id:
      "admission-cn-shenzhen-justice-bankruptcy-recruitment-notice" as
        SourceAdmission["source_admission_id"],
    recruitment_endpoint_id:
      "endpoint-cn-shenzhen-justice-bankruptcy-recruitment-notice-html" as
        RecruitmentEndpointId,
    source_definition_id:
      "source-cn-shenzhen-justice-bankruptcy-recruitment" as
        RecruitmentEndpoint["source_definition_id"],
    endpoint_purpose: "RECRUITMENT_NOTICE",
    content_kind: "HTML",
    expected_mime: "text/html",
    maximum_bytes: SHENZHEN_LEGAL_NOTICE_MAX_BYTES,
    name: "深圳市破产事务管理署2025年公开招聘工作人员公告"
  },
  POSITION_TABLE_PDF: {
    kind: "POSITION_TABLE_PDF",
    endpoint: SHENZHEN_LEGAL_PDF_URL,
    source_admission_id:
      "admission-cn-shenzhen-justice-bankruptcy-recruitment-position-table-pdf" as
        SourceAdmission["source_admission_id"],
    recruitment_endpoint_id:
      "endpoint-cn-shenzhen-justice-bankruptcy-recruitment-position-table-pdf" as
        RecruitmentEndpointId,
    source_definition_id:
      "source-cn-shenzhen-justice-bankruptcy-recruitment" as
        RecruitmentEndpoint["source_definition_id"],
    endpoint_purpose: "RECRUITMENT_ATTACHMENT",
    content_kind: "PDF",
    expected_mime: "application/pdf",
    maximum_bytes: SHENZHEN_LEGAL_PDF_MAX_BYTES,
    name: "深圳市破产事务管理署2025年公开招聘岗位表"
  }
};

export interface ShenzhenLegalApprovalEvidence {
  readonly evidence_id: SourceAdmissionEvidenceId;
  readonly evidence_type: "OBSERVATION_CANARY";
  readonly source_url: string;
  readonly observed_at: IsoDateTime;
  readonly reviewer: string;
  readonly observation: string;
  readonly decision: "APPROVED_FOR_ONE_ENDPOINT_ONE_RUN_OBSERVATION";
}

export interface ShenzhenLegalObservationApprovalBundle {
  readonly kind: ShenzhenLegalEndpointKind;
  readonly admission: SourceAdmission;
  readonly recruitment_endpoint: RecruitmentEndpoint;
  readonly authorization: ObservationCanaryManualAuthorization;
  readonly execution: LiveCanaryExecutionRequest;
  readonly evidence: ShenzhenLegalApprovalEvidence;
  readonly authorization_decision: Extract<
    ObservationCanaryAuthorizationDecision,
    { allowed: true }
  >;
  readonly authorization_gate: InMemoryObservationCanaryAuthorizationGate;
}

export interface ShenzhenLegalAccessSignals {
  readonly login: AccessObservation;
  readonly captcha: AccessObservation;
  readonly anti_bot: AccessObservation;
  readonly html_error_page: AccessObservation;
  readonly request_cookie_sent: false;
  readonly request_authorization_sent: false;
  readonly response_set_cookie_observed: boolean;
  readonly follow_up_cookie_required:
    | "NOT_REQUIRED_FOR_SUCCESSFUL_RESPONSE"
    | "UNKNOWN";
}

export interface ShenzhenLegalTransportResult {
  readonly response: TransportResponse;
  readonly final_url: string;
  readonly redirect_chain: readonly {
    readonly status: number;
    readonly location: string | null;
  }[];
  readonly request_count: 1;
  readonly elapsed_ms: number;
  readonly response_size: number;
  readonly declared_content_length: number | null;
  readonly response_content_type: string | null;
  readonly access_signals: ShenzhenLegalAccessSignals;
}

export interface ShenzhenLegalContentSafetyResult {
  readonly classification: "PASS" | "REVIEW_REQUIRED";
  readonly checks: {
    readonly mime_type_matches: boolean;
    readonly extension_matches: boolean;
    readonly response_size_within_limit: boolean;
    readonly declared_content_length_matches: boolean | null;
    readonly pdf_magic_matches: boolean | null;
    readonly pdf_eof_present: boolean | null;
    readonly pdf_encryption_absent: boolean | null;
    readonly pdf_active_content_absent: boolean | null;
  };
  readonly reason_codes: readonly string[];
}

export interface ShenzhenLegalObservationEvidence {
  readonly evidence_id: SourceAdmissionEvidenceId;
  readonly evidence_type: "ENDPOINT_OBSERVATION";
  readonly source_url: string;
  readonly endpoint_id: RecruitmentEndpointId;
  readonly collection_run_id: ObservationCanaryManualAuthorization["collection_run_id"];
  readonly observed_at: IsoDateTime;
  readonly http_status: number | null;
  readonly final_url: string;
  readonly raw_blob_id: RawBlob["raw_blob_id"] | null;
  readonly snapshot_id: SnapshotId;
  readonly sha256: RawContentSha256 | null;
  readonly byte_length: number | null;
  readonly decision: "EVIDENCE_CAPTURED" | "REVIEW_REQUIRED";
}

export interface ShenzhenLegalObservationCanaryResult {
  readonly approval: ShenzhenLegalObservationApprovalBundle;
  readonly request: HttpTransportRequest;
  readonly transport: ShenzhenLegalTransportResult;
  readonly raw_blob: RawBlob | null;
  readonly snapshot: Snapshot;
  readonly content_safety: ShenzhenLegalContentSafetyResult | null;
  readonly observation_evidence: ShenzhenLegalObservationEvidence;
  readonly access_classification: "EVIDENCE_CAPTURED" | "REVIEW_REQUIRED";
  readonly authorization_replay_decision: ObservationCanaryAuthorizationDecision;
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export function createShenzhenLegalObservationApproval(
  kind: ShenzhenLegalEndpointKind,
  issuedAt: IsoDateTime,
  reviewer = SHENZHEN_LEGAL_OBSERVATION_REVIEWER
): ShenzhenLegalObservationApprovalBundle {
  const policy = policies[kind];
  const robotsEvidenceId = evidenceId(kind, "robots-unknown");
  const termsEvidenceId = evidenceId(kind, "terms-unknown");
  const approvalEvidenceId = evidenceId(kind, "human-observation-approval");
  const admission = createAdmission(
    policy,
    issuedAt,
    reviewer,
    robotsEvidenceId,
    termsEvidenceId,
    approvalEvidenceId
  );
  const register = new InMemorySourceAdmissionRegister();
  register.register(admission);
  const recruitmentEndpoint = createRecruitmentEndpoint(policy);
  const collectionRunId = `real-legal-canary-${kind.toLowerCase()}-run:${randomUUID()}` as
    ObservationCanaryManualAuthorization["collection_run_id"];
  const authorization: ObservationCanaryManualAuthorization = {
    authorization_mode: "OBSERVATION_CANARY",
    authorization_purpose: "OBSERVE_ACCESS_PROPERTIES",
    authorization_id:
      `real-legal-canary-${kind.toLowerCase()}-authorization:${randomUUID()}` as
        ObservationCanaryManualAuthorization["authorization_id"],
    source_admission_id: policy.source_admission_id,
    endpoint: policy.endpoint,
    recruitment_endpoint_id: policy.recruitment_endpoint_id,
    endpoint_purpose: policy.endpoint_purpose,
    allowed_http_method: "GET",
    content_kind: policy.content_kind,
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
  const authorizationGate = new InMemoryObservationCanaryAuthorizationGate();
  const authorizationDecision = authorizationGate.authorize(
    admission,
    execution,
    authorization
  );
  if (!authorizationDecision.allowed) {
    throw new Error(
      `Shenzhen legal Observation Canary authorization denied: ${authorizationDecision.reason_codes.join(", ")}`
    );
  }
  return {
    kind,
    admission,
    recruitment_endpoint: recruitmentEndpoint,
    authorization,
    execution,
    evidence: {
      evidence_id: approvalEvidenceId,
      evidence_type: "OBSERVATION_CANARY",
      source_url: policy.endpoint,
      observed_at: issuedAt,
      reviewer,
      observation:
        "人工仅批准本精确官方 Endpoint 的一次 GET，用于观察访问属性并封存 Evidence/Raw/Snapshot；不构成长期开通。",
      decision: "APPROVED_FOR_ONE_ENDPOINT_ONE_RUN_OBSERVATION"
    },
    authorization_decision: authorizationDecision,
    authorization_gate: authorizationGate
  };
}

export class OneEndpointOneRunShenzhenObservationTransport {
  readonly #policy: EndpointPolicy;
  readonly #fetch: FetchImplementation;
  readonly #now: () => IsoDateTime;
  readonly #monotonicNow: () => number;
  #used = false;

  constructor(
    kind: ShenzhenLegalEndpointKind,
    fetchImplementation: FetchImplementation,
    options: {
      readonly now?: () => IsoDateTime;
      readonly monotonic_now?: () => number;
    } = {}
  ) {
    this.#policy = policies[kind];
    this.#fetch = fetchImplementation;
    this.#now = options.now ?? (() => new Date().toISOString() as IsoDateTime);
    this.#monotonicNow = options.monotonic_now ?? (() => performance.now());
  }

  async execute(request: HttpTransportRequest): Promise<ShenzhenLegalTransportResult> {
    validateRequest(this.#policy, request);
    if (this.#used) {
      throw new Error("ONE_ENDPOINT_ONE_RUN Shenzhen observation transport is already consumed");
    }
    this.#used = true;
    const startedAt = this.#monotonicNow();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeout_ms);
    try {
      const response = await this.#fetch(request.locator, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        signal: controller.signal
      });
      const contentType = response.headers.get("content-type");
      const declaredLength = parseContentLength(response.headers.get("content-length"));
      const finalUrl = response.url || request.locator;
      const headers = safeResponseHeaders(response.headers);
      const initialSignals = unknownAccessSignals(response.headers);
      if (response.status >= 300 && response.status < 400) {
        const redirectChain = [{
          status: response.status,
          location: response.headers.get("location")
        }];
        await cancelBody(response);
        return failedResult({
          responded_at: this.#now(),
          code: "REDIRECT_OBSERVED",
          message: "Redirect was observed and was not followed",
          http_status: response.status,
          headers,
          content_type: contentType,
          final_url: finalUrl,
          redirect_chain: redirectChain,
          elapsed_ms: elapsed(startedAt, this.#monotonicNow()),
          response_size: 0,
          declared_content_length: declaredLength,
          access_signals: initialSignals
        });
      }
      if (finalUrl !== request.locator) {
        await cancelBody(response);
        return failedResult({
          responded_at: this.#now(),
          code: "FINAL_URL_MISMATCH",
          message: "Final URL differs from the exact authorized locator",
          http_status: response.status,
          headers,
          content_type: contentType,
          final_url: finalUrl,
          redirect_chain: [],
          elapsed_ms: elapsed(startedAt, this.#monotonicNow()),
          response_size: 0,
          declared_content_length: declaredLength,
          access_signals: initialSignals
        });
      }
      if (declaredLength !== null && declaredLength > this.#policy.maximum_bytes) {
        await cancelBody(response);
        return failedResult({
          responded_at: this.#now(),
          code: "RESPONSE_SIZE_LIMIT",
          message: `Declared response size ${declaredLength} exceeds fixed budget`,
          http_status: response.status,
          headers,
          content_type: contentType,
          final_url: finalUrl,
          redirect_chain: [],
          elapsed_ms: elapsed(startedAt, this.#monotonicNow()),
          response_size: 0,
          declared_content_length: declaredLength,
          access_signals: initialSignals
        });
      }
      const bytes = await readBodyWithLimit(response, this.#policy.maximum_bytes);
      const accessSignals = inspectAccessSignals(
        this.#policy,
        bytes,
        contentType,
        response.headers,
        response.status
      );
      if (response.status !== 200) {
        return failedResult({
          responded_at: this.#now(),
          code: `HTTP_${response.status}`,
          message: `HTTP ${response.status}`,
          http_status: response.status,
          headers,
          content_type: contentType,
          final_url: finalUrl,
          redirect_chain: [],
          elapsed_ms: elapsed(startedAt, this.#monotonicNow()),
          response_size: bytes.byteLength,
          declared_content_length: declaredLength,
          access_signals: accessSignals
        });
      }
      const blockingReason = blockingReasonFor(accessSignals);
      if (blockingReason) {
        return failedResult({
          responded_at: this.#now(),
          code: "BLOCKING_CONTENT_OBSERVED",
          message: blockingReason,
          http_status: response.status,
          headers,
          content_type: contentType,
          final_url: finalUrl,
          redirect_chain: [],
          elapsed_ms: elapsed(startedAt, this.#monotonicNow()),
          response_size: bytes.byteLength,
          declared_content_length: declaredLength,
          access_signals: accessSignals
        });
      }
      if (normalizeMime(contentType) !== this.#policy.expected_mime) {
        return failedResult({
          responded_at: this.#now(),
          code: "MIME_TYPE_MISMATCH",
          message: `Expected ${this.#policy.expected_mime} but received ${contentType ?? "no Content-Type"}`,
          http_status: response.status,
          headers,
          content_type: contentType,
          final_url: finalUrl,
          redirect_chain: [],
          elapsed_ms: elapsed(startedAt, this.#monotonicNow()),
          response_size: bytes.byteLength,
          declared_content_length: declaredLength,
          access_signals: accessSignals
        });
      }
      if (declaredLength !== null && declaredLength !== bytes.byteLength) {
        return failedResult({
          responded_at: this.#now(),
          code: "CONTENT_LENGTH_MISMATCH",
          message: "Declared Content-Length differs from the observed response bytes",
          http_status: response.status,
          headers,
          content_type: contentType,
          final_url: finalUrl,
          redirect_chain: [],
          elapsed_ms: elapsed(startedAt, this.#monotonicNow()),
          response_size: bytes.byteLength,
          declared_content_length: declaredLength,
          access_signals: accessSignals
        });
      }
      if (this.#policy.kind === "POSITION_TABLE_PDF" && !hasPdfMagic(bytes)) {
        return failedResult({
          responded_at: this.#now(),
          code: "PDF_MAGIC_MISMATCH",
          message: "Expected PDF signature was not observed",
          http_status: response.status,
          headers,
          content_type: contentType,
          final_url: finalUrl,
          redirect_chain: [],
          elapsed_ms: elapsed(startedAt, this.#monotonicNow()),
          response_size: bytes.byteLength,
          declared_content_length: declaredLength,
          access_signals: accessSignals
        });
      }
      return {
        response: {
          status: "SUCCESS",
          responded_at: this.#now(),
          bytes,
          content_sha256: sha256(bytes),
          mime_type: contentType ?? this.#policy.expected_mime,
          http_status: response.status,
          headers
        },
        final_url: finalUrl,
        redirect_chain: [],
        request_count: 1,
        elapsed_ms: elapsed(startedAt, this.#monotonicNow()),
        response_size: bytes.byteLength,
        declared_content_length: declaredLength,
        response_content_type: contentType,
        access_signals: accessSignals
      };
    } catch (error) {
      return failedResult({
        responded_at: this.#now(),
        code: errorCode(error),
        message: errorMessage(error),
        http_status: null,
        headers: {},
        content_type: null,
        final_url: request.locator,
        redirect_chain: [],
        elapsed_ms: elapsed(startedAt, this.#monotonicNow()),
        response_size: 0,
        declared_content_length: null,
        access_signals: unknownAccessSignals()
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function runShenzhenLegalObservationCanary(
  approval: ShenzhenLegalObservationApprovalBundle,
  transport: OneEndpointOneRunShenzhenObservationTransport,
  requestedAt: IsoDateTime
): Promise<ShenzhenLegalObservationCanaryResult> {
  const request: HttpTransportRequest = {
    recruitment_endpoint_id: approval.recruitment_endpoint.recruitment_endpoint_id,
    locator: approval.recruitment_endpoint.locator,
    method: "GET",
    requested_at: requestedAt,
    headers: {},
    parameters: {},
    timeout_ms: SHENZHEN_LEGAL_TIMEOUT_MS
  };
  const rawBlobs = new InMemoryRawBlobRepository();
  const snapshots = new InMemorySnapshotRepository();
  const capture = new RawCaptureService(rawBlobs, snapshots, {
    create_snapshot_id: () =>
      `real-legal-canary-${approval.kind.toLowerCase()}-snapshot:${randomUUID()}` as SnapshotId
  });
  const transportResult = await transport.execute(request);
  const captured = capture.record(request, transportResult.response);
  const contentSafety = captured.raw_blob
    ? inspectCapturedContent(
        approval.kind,
        captured.raw_blob.bytes,
        captured.raw_blob.mime_type,
        request.locator,
        transportResult.declared_content_length
      )
    : null;
  const accessClassification =
    captured.raw_blob && contentSafety?.classification === "PASS"
      ? "EVIDENCE_CAPTURED"
      : "REVIEW_REQUIRED";
  const observationEvidence: ShenzhenLegalObservationEvidence = {
    evidence_id: evidenceId(approval.kind, "endpoint-observation"),
    evidence_type: "ENDPOINT_OBSERVATION",
    source_url: request.locator,
    endpoint_id: request.recruitment_endpoint_id,
    collection_run_id: approval.authorization.collection_run_id,
    observed_at: captured.snapshot.observed_at,
    http_status: transportResult.response.http_status,
    final_url: transportResult.final_url,
    raw_blob_id: captured.raw_blob?.raw_blob_id ?? null,
    snapshot_id: captured.snapshot.snapshot_id,
    sha256: captured.raw_blob?.raw_content_sha256 ?? null,
    byte_length: captured.raw_blob?.byte_length ?? null,
    decision: accessClassification
  };
  const replayDecision = approval.authorization_gate.authorize(
    approval.admission,
    approval.execution,
    approval.authorization
  );
  return {
    approval,
    request,
    transport: transportResult,
    raw_blob: captured.raw_blob,
    snapshot: captured.snapshot,
    content_safety: contentSafety,
    observation_evidence: observationEvidence,
    access_classification: accessClassification,
    authorization_replay_decision: replayDecision
  };
}

export function inspectCapturedContent(
  kind: ShenzhenLegalEndpointKind,
  bytes: Uint8Array,
  contentType: string,
  locator: string,
  declaredContentLength: number | null
): ShenzhenLegalContentSafetyResult {
  const policy = policies[kind];
  const mimeMatches = normalizeMime(contentType) === policy.expected_mime;
  const extensionMatches = kind === "NOTICE"
    ? new URL(locator).pathname.toLowerCase().endsWith(".html")
    : new URL(locator).pathname.toLowerCase().endsWith(".pdf");
  const responseSizeWithinLimit = bytes.byteLength <= policy.maximum_bytes;
  const declaredContentLengthMatches = declaredContentLength === null
    ? null
    : declaredContentLength === bytes.byteLength;
  const pdfMagicMatches = kind === "POSITION_TABLE_PDF" ? hasPdfMagic(bytes) : null;
  const pdfEofPresent = kind === "POSITION_TABLE_PDF" ? hasPdfEof(bytes) : null;
  const pdfEncryptionAbsent = kind === "POSITION_TABLE_PDF"
    ? !containsAscii(bytes, "/Encrypt")
    : null;
  const pdfActiveContentAbsent = kind === "POSITION_TABLE_PDF"
    ? !["/JavaScript", "/JS", "/Launch", "/EmbeddedFile", "/OpenAction"].some(
        (marker) => containsAscii(bytes, marker)
      )
    : null;
  const checks = {
    mime_type_matches: mimeMatches,
    extension_matches: extensionMatches,
    response_size_within_limit: responseSizeWithinLimit,
    declared_content_length_matches: declaredContentLengthMatches,
    pdf_magic_matches: pdfMagicMatches,
    pdf_eof_present: pdfEofPresent,
    pdf_encryption_absent: pdfEncryptionAbsent,
    pdf_active_content_absent: pdfActiveContentAbsent
  };
  const reasonCodes = Object.entries(checks)
    .filter(([, passed]) => passed === false)
    .map(([name]) => name.toUpperCase());
  return {
    classification: reasonCodes.length === 0 ? "PASS" : "REVIEW_REQUIRED",
    checks,
    reason_codes: reasonCodes
  };
}

function createAdmission(
  policy: EndpointPolicy,
  observedAt: IsoDateTime,
  reviewer: string,
  robotsEvidenceId: SourceAdmissionEvidenceId,
  termsEvidenceId: SourceAdmissionEvidenceId,
  approvalEvidenceId: SourceAdmissionEvidenceId
): SourceAdmission {
  const evidence: readonly SourceAdmissionEvidence[] = [
    {
      source_admission_evidence_id: robotsEvidenceId,
      source_admission_id: policy.source_admission_id,
      endpoint: policy.endpoint,
      source_url: policy.endpoint,
      kind: "ROBOTS",
      locator: `unobserved://robots/${policy.recruitment_endpoint_id}`,
      captured_at: observedAt,
      reviewer,
      decision: "UNKNOWN",
      summary: original(
        "本次未访问 robots.txt；该精确 Endpoint 的 robots 结论保持 UNKNOWN，不解释为允许。"
      )
    },
    {
      source_admission_evidence_id: termsEvidenceId,
      source_admission_id: policy.source_admission_id,
      endpoint: policy.endpoint,
      source_url: policy.endpoint,
      kind: "TERMS",
      locator: `unobserved://terms/${policy.recruitment_endpoint_id}`,
      captured_at: observedAt,
      reviewer,
      decision: "UNKNOWN",
      summary: original(
        "本次未访问 Terms 页面；该精确 Endpoint 的长期自动化条款保持 UNKNOWN。"
      )
    },
    {
      source_admission_evidence_id: approvalEvidenceId,
      source_admission_id: policy.source_admission_id,
      endpoint: policy.endpoint,
      source_url: policy.endpoint,
      kind: "MANUAL_REVIEW",
      locator: `manual://real-legal-canary/${approvalEvidenceId}`,
      captured_at: observedAt,
      reviewer,
      decision: "UNKNOWN",
      summary: original(
        "人工仅批准本精确 Endpoint 的一次 GET Observation Canary；Admission 保持 B + REVIEW。"
      )
    }
  ];
  return {
    source_admission_id: policy.source_admission_id,
    admission_level: "B",
    automation_basis: "INSUFFICIENT_EVIDENCE",
    source_name: traceable("深圳市司法局公开招聘"),
    source_type: "OFFICIAL_RECRUITMENT_PAGE",
    official_owner: traceable("深圳市司法局、深圳市破产事务管理署"),
    endpoint: policy.endpoint,
    recruitment_endpoint_id: policy.recruitment_endpoint_id,
    endpoint_purpose: policy.endpoint_purpose,
    allowed_http_method: "GET",
    content_kind: policy.content_kind,
    source_authority: "OFFICIAL",
    robots: { status: "UNKNOWN", evidence_id: robotsEvidenceId },
    terms: { status: "UNKNOWN", evidence_id: termsEvidenceId },
    login_requirement: "UNKNOWN",
    captcha: "UNKNOWN",
    structure: policy.kind === "NOTICE" ? "STATIC_HTML" : "DOCUMENT",
    stability: "UNKNOWN",
    update_frequency: "UNKNOWN",
    priority: "HIGH",
    prohibited_actions: SOURCE_PROHIBITED_ACTIONS,
    evidence,
    review_records: [{
      source_admission_review_id: reviewId(policy.kind),
      reviewer,
      reviewed_at: observedAt,
      decision: "REVIEW",
      rationale: original(
        "官方候选 Endpoint 的访问属性尚未独立观察；仅允许一次性 OBSERVE_ACCESS_PROPERTIES。"
      ),
      evidence_ids: [robotsEvidenceId, termsEvidenceId, approvalEvidenceId]
    }],
    admission_decision: "REVIEW"
  };
}

function createRecruitmentEndpoint(policy: EndpointPolicy): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: policy.recruitment_endpoint_id,
    source_definition_id: policy.source_definition_id,
    name: traceable(policy.name),
    description: traceable("真实法律岗位 Requirement V2 Canary 的一次性只读证据入口。"),
    coverage_regions: [{ raw_text: original("深圳市") }],
    locator: policy.endpoint,
    request_method: "GET",
    content_kind: policy.content_kind,
    adapter_key: "real-legal-canary-observation-capture-only",
    decoded_text_encoding: UTF8_TEXT_ENCODING,
    collection_config: {
      timeout_ms: SHENZHEN_LEGAL_TIMEOUT_MS,
      max_items: 1,
      max_pages: 1,
      follow_redirects: false,
      retry_limit: 0
    },
    enabled: false
  };
}

function validateRequest(policy: EndpointPolicy, request: HttpTransportRequest) {
  if (request.recruitment_endpoint_id !== policy.recruitment_endpoint_id) {
    throw new Error("Shenzhen legal Observation Canary Endpoint ID is not authorized");
  }
  if (request.locator !== policy.endpoint) {
    throw new Error("Shenzhen legal Observation Canary locator is not the exact authorized URL");
  }
  if (request.method !== "GET") {
    throw new Error("Shenzhen legal Observation Canary permits GET only");
  }
  if (request.timeout_ms !== SHENZHEN_LEGAL_TIMEOUT_MS) {
    throw new Error("Shenzhen legal Observation Canary timeout must match fixed policy");
  }
  if (Object.keys(request.headers).length > 0 || Object.keys(request.parameters).length > 0) {
    throw new Error("Shenzhen legal Observation Canary forbids caller headers or parameters");
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
      await reader.cancel("Response size budget exceeded");
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
  policy: EndpointPolicy,
  bytes: Uint8Array,
  contentType: string | null,
  headers: Headers,
  status: number
): ShenzhenLegalAccessSignals {
  const htmlObserved = normalizeMime(contentType) === "text/html" || looksLikeHtml(bytes);
  const text = htmlObserved ? decodeHtml(bytes, contentType) : "";
  const successfulExpectedResponse = status === 200
    && normalizeMime(contentType) === policy.expected_mime;
  return {
    login: htmlObserved && (
      /<input[^>]+type=["']password["']/iu.test(text)
      || /(?:请先登录|登录后(?:查看|访问|下载))/u.test(text)
    ) ? "OBSERVED" : successfulExpectedResponse ? "NONE_OBSERVED" : "UNKNOWN",
    captcha: htmlObserved && /(?:验证码|captcha)/iu.test(text)
      ? "OBSERVED"
      : successfulExpectedResponse ? "NONE_OBSERVED" : "UNKNOWN",
    anti_bot: htmlObserved && /(?:访问过于频繁|安全验证|robot check|cloudflare)/iu.test(text)
      ? "OBSERVED"
      : successfulExpectedResponse ? "NONE_OBSERVED" : "UNKNOWN",
    html_error_page: policy.kind === "POSITION_TABLE_PDF" && htmlObserved
      ? "OBSERVED"
      : "NONE_OBSERVED",
    request_cookie_sent: false,
    request_authorization_sent: false,
    response_set_cookie_observed: headers.has("set-cookie"),
    follow_up_cookie_required: successfulExpectedResponse
      ? "NOT_REQUIRED_FOR_SUCCESSFUL_RESPONSE"
      : "UNKNOWN"
  };
}

function blockingReasonFor(signals: ShenzhenLegalAccessSignals) {
  if (signals.login === "OBSERVED") return "Login requirement observed";
  if (signals.captcha === "OBSERVED") return "CAPTCHA observed";
  if (signals.anti_bot === "OBSERVED") return "Anti-bot response observed";
  if (signals.html_error_page === "OBSERVED") return "HTML response observed for PDF Endpoint";
  return null;
}

function unknownAccessSignals(headers?: Headers): ShenzhenLegalAccessSignals {
  return {
    login: "UNKNOWN",
    captcha: "UNKNOWN",
    anti_bot: "UNKNOWN",
    html_error_page: "UNKNOWN",
    request_cookie_sent: false,
    request_authorization_sent: false,
    response_set_cookie_observed: headers?.has("set-cookie") ?? false,
    follow_up_cookie_required: "UNKNOWN"
  };
}

function failedResult(input: {
  readonly responded_at: IsoDateTime;
  readonly code: string;
  readonly message: string;
  readonly http_status: number | null;
  readonly headers: TransportHeaders;
  readonly content_type: string | null;
  readonly final_url: string;
  readonly redirect_chain: ShenzhenLegalTransportResult["redirect_chain"];
  readonly elapsed_ms: number;
  readonly response_size: number;
  readonly declared_content_length: number | null;
  readonly access_signals: ShenzhenLegalAccessSignals;
}): ShenzhenLegalTransportResult {
  return {
    response: {
      status: "FAILED",
      responded_at: input.responded_at,
      http_status: input.http_status,
      headers: input.headers,
      mime_type: input.content_type,
      error: {
        code: input.code,
        message: input.message,
        retryable: false
      }
    },
    final_url: input.final_url,
    redirect_chain: input.redirect_chain,
    request_count: 1,
    elapsed_ms: input.elapsed_ms,
    response_size: input.response_size,
    declared_content_length: input.declared_content_length,
    response_content_type: input.content_type,
    access_signals: input.access_signals
  };
}

function safeResponseHeaders(headers: Headers): TransportHeaders {
  return Object.fromEntries([...headers.entries()].filter(([name]) => {
    return !/(?:authorization|cookie|token|password|secret|session|api[_-]?key)/iu.test(name);
  }));
}

async function cancelBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    return;
  }
}

function decodeHtml(bytes: Uint8Array, contentType: string | null) {
  const charset = /charset\s*=\s*["']?([^;\s"']+)/iu.exec(contentType ?? "")?.[1]
    ?? "utf-8";
  const normalized = /^(?:gb2312|gbk)$/iu.test(charset) ? "gb18030" : charset;
  try {
    return new TextDecoder(normalized).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function looksLikeHtml(bytes: Uint8Array) {
  const sample = new TextDecoder("latin1").decode(bytes.slice(0, 512));
  return /<!doctype\s+html|<html|<body/iu.test(sample);
}

function hasPdfMagic(bytes: Uint8Array) {
  return new TextDecoder("ascii").decode(bytes.slice(0, 5)) === "%PDF-";
}

function hasPdfEof(bytes: Uint8Array) {
  return new TextDecoder("latin1").decode(bytes.slice(Math.max(0, bytes.length - 1_024)))
    .includes("%%EOF");
}

function containsAscii(bytes: Uint8Array, marker: string) {
  return new TextDecoder("latin1").decode(bytes).includes(marker);
}

function normalizeMime(value: string | null) {
  return value?.split(";", 1)[0].trim().toLowerCase() ?? null;
}

function parseContentLength(value: string | null) {
  if (value === null || !/^\d+$/u.test(value)) return null;
  return Number(value);
}

function elapsed(startedAt: number, endedAt: number) {
  return Math.max(0, Math.round(endedAt - startedAt));
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String(error.code);
  }
  return error instanceof DOMException && error.name === "AbortError"
    ? "TIMEOUT"
    : "NETWORK_ERROR";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Observation Canary error";
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex") as RawContentSha256;
}

function evidenceId(kind: ShenzhenLegalEndpointKind, label: string) {
  return `real-legal-canary-evidence:${kind.toLowerCase()}:${label}:${randomUUID()}` as
    SourceAdmissionEvidenceId;
}

function reviewId(kind: ShenzhenLegalEndpointKind) {
  return `real-legal-canary-review:${kind.toLowerCase()}:${randomUUID()}` as
    SourceAdmissionReviewId;
}

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}
