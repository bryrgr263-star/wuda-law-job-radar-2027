import { createHash, randomUUID } from "node:crypto";

import {
  InMemoryObservationCanaryAuthorizationGate,
  InMemorySourceAdmissionRegister,
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
  type IsoDateTime,
  type RawBlob,
  type RawContentSha256,
  type RecruitmentEndpoint,
  type Snapshot,
  type SnapshotId,
  type TransportHeaders,
  type TransportResponse
} from "../../ingestion";
import {
  inspectXlsxContainer,
  type XlsxContainerSafetyResult
} from "../p2-04e/beijing-public-institution-attachment-observation-canary";
import {
  GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION,
  GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT,
  GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID,
  GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL
} from "../p2-legal-03/guizhou-attachment-admission-preflight";

export const GUIZHOU_ATTACHMENT_OBSERVATION_TIMEOUT_MS = 20_000;
export const GUIZHOU_ATTACHMENT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const GUIZHOU_ATTACHMENT_EXPECTED_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const GUIZHOU_ATTACHMENT_OBSERVATION_REVIEWER = "human-approved-by-user";

export type AccessObservation = "OBSERVED" | "NONE_OBSERVED" | "UNKNOWN";

export interface GuizhouAttachmentApprovalEvidence {
  readonly evidence_id: SourceAdmissionEvidenceId;
  readonly evidence_type: "OBSERVATION_CANARY";
  readonly source_url: string;
  readonly observed_at: IsoDateTime;
  readonly reviewer: string;
  readonly observation: string;
  readonly decision: "APPROVED_FOR_ONE_ENDPOINT_ONE_RUN_OBSERVATION";
}

export interface GuizhouAttachmentObservationApprovalBundle {
  readonly admission: SourceAdmission;
  readonly recruitment_endpoint: RecruitmentEndpoint;
  readonly authorization: ObservationCanaryManualAuthorization;
  readonly execution: LiveCanaryExecutionRequest;
  readonly evidence: GuizhouAttachmentApprovalEvidence;
  readonly authorization_decision: Extract<
    ObservationCanaryAuthorizationDecision,
    { allowed: true }
  >;
  readonly authorization_gate: InMemoryObservationCanaryAuthorizationGate;
}

export interface GuizhouAttachmentAccessSignals {
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

export interface GuizhouAttachmentTransportResult {
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
  readonly content_encoding: string | null;
  readonly access_signals: GuizhouAttachmentAccessSignals;
}

export interface GuizhouXlsxSafetyObservation {
  readonly classification: XlsxContainerSafetyResult["classification"];
  readonly actual_file_type: "XLSX_OFFICE_OPEN_XML" | "UNKNOWN";
  readonly checks: XlsxContainerSafetyResult["checks"] & {
    readonly macro_absent: boolean;
    readonly ole_object_absent: boolean;
    readonly embedded_object_absent: boolean;
  };
  readonly observed: XlsxContainerSafetyResult["observed"];
  readonly reason_codes: readonly string[];
}

export interface GuizhouAttachmentObservationEvidence {
  readonly evidence_id: SourceAdmissionEvidenceId;
  readonly evidence_type: "ENDPOINT_OBSERVATION";
  readonly source_url: string;
  readonly endpoint_id: RecruitmentEndpoint["recruitment_endpoint_id"];
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

export interface GuizhouAttachmentObservationCanaryResult {
  readonly approval: GuizhouAttachmentObservationApprovalBundle;
  readonly request: HttpTransportRequest;
  readonly transport: GuizhouAttachmentTransportResult;
  readonly raw_blob: RawBlob | null;
  readonly snapshot: Snapshot;
  readonly file_safety: GuizhouXlsxSafetyObservation | null;
  readonly observation_evidence: GuizhouAttachmentObservationEvidence;
  readonly access_classification: "EVIDENCE_CAPTURED" | "REVIEW_REQUIRED";
  readonly offline_parsing_allowed: boolean;
  readonly authorization_replay_decision: ObservationCanaryAuthorizationDecision;
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export function createGuizhouAttachmentObservationApproval(
  issuedAt: IsoDateTime,
  reviewer = GUIZHOU_ATTACHMENT_OBSERVATION_REVIEWER
): GuizhouAttachmentObservationApprovalBundle {
  const approvalEvidenceId = evidenceId("human-observation-approval");
  const approvalEvidence: SourceAdmissionEvidence = {
    source_admission_evidence_id: approvalEvidenceId,
    source_admission_id: GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION.source_admission_id,
    endpoint: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
    source_url: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
    kind: "MANUAL_REVIEW",
    locator: `manual://p2-legal-04/${approvalEvidenceId}`,
    captured_at: issuedAt,
    reviewer,
    decision: "UNKNOWN",
    summary: original(
      "人工仅批准该精确贵州附件 Endpoint 的一次 GET Observation Canary；Admission 保持 B + REVIEW，不构成长期开通。"
    )
  };
  const register = new InMemorySourceAdmissionRegister();
  register.register(GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION);
  const admission = register.revise({
    ...GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION,
    evidence: [...GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION.evidence, approvalEvidence],
    review_records: [
      ...GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION.review_records,
      {
        source_admission_review_id: reviewId("human-observation-approval"),
        reviewer,
        reviewed_at: issuedAt,
        decision: "REVIEW",
        rationale: original(
          "人工批准 OBSERVE_ACCESS_PROPERTIES：单一附件 Endpoint、单一 GET、单一 Run；不访问公告或任何第二 URL。"
        ),
        evidence_ids: [approvalEvidenceId]
      }
    ]
  });
  const recruitmentEndpoint: RecruitmentEndpoint = {
    ...GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT,
    collection_config: {
      timeout_ms: GUIZHOU_ATTACHMENT_OBSERVATION_TIMEOUT_MS,
      max_items: 1,
      max_pages: 1,
      follow_redirects: false,
      retry_limit: 0
    },
    enabled: false
  };
  const collectionRunId = `p2-legal-04-run:${randomUUID()}` as
    ObservationCanaryManualAuthorization["collection_run_id"];
  const authorization: ObservationCanaryManualAuthorization = {
    authorization_mode: "OBSERVATION_CANARY",
    authorization_purpose: "OBSERVE_ACCESS_PROPERTIES",
    authorization_id: `p2-legal-04-authorization:${randomUUID()}` as
      ObservationCanaryManualAuthorization["authorization_id"],
    source_admission_id: admission.source_admission_id,
    endpoint: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
    recruitment_endpoint_id: GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID,
    endpoint_purpose: "RECRUITMENT_ATTACHMENT",
    allowed_http_method: "GET",
    content_kind: "FILE",
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
      `Guizhou attachment Observation Canary authorization denied: ${authorizationDecision.reason_codes.join(", ")}`
    );
  }
  return {
    admission,
    recruitment_endpoint: recruitmentEndpoint,
    authorization,
    execution,
    evidence: {
      evidence_id: approvalEvidenceId,
      evidence_type: "OBSERVATION_CANARY",
      source_url: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
      observed_at: issuedAt,
      reviewer,
      observation:
        "人工仅批准该精确官方附件 Endpoint 的一次 GET，用于访问属性、Raw/Snapshot 与文件容器安全观察；不执行岗位业务解析。",
      decision: "APPROVED_FOR_ONE_ENDPOINT_ONE_RUN_OBSERVATION"
    },
    authorization_decision: authorizationDecision,
    authorization_gate: authorizationGate
  };
}

export class OneEndpointOneRunGuizhouAttachmentTransport {
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

  async execute(request: HttpTransportRequest): Promise<GuizhouAttachmentTransportResult> {
    validateRequest(request);
    if (this.#used) {
      throw new Error("ONE_ENDPOINT_ONE_RUN Guizhou attachment transport is already consumed");
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
      const contentEncoding = response.headers.get("content-encoding");
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
          message: "Redirect observed; STOP_AND_REVIEW without following",
          http_status: response.status,
          headers,
          content_type: contentType,
          content_encoding: contentEncoding,
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
          content_encoding: contentEncoding,
          final_url: finalUrl,
          redirect_chain: [],
          elapsed_ms: elapsed(startedAt, this.#monotonicNow()),
          response_size: 0,
          declared_content_length: declaredLength,
          access_signals: initialSignals
        });
      }
      if (declaredLength !== null && declaredLength > GUIZHOU_ATTACHMENT_MAX_RESPONSE_BYTES) {
        await cancelBody(response);
        return failedResult({
          responded_at: this.#now(),
          code: "RESPONSE_SIZE_LIMIT",
          message: `Declared response size ${declaredLength} exceeds 10 MiB`,
          http_status: response.status,
          headers,
          content_type: contentType,
          content_encoding: contentEncoding,
          final_url: finalUrl,
          redirect_chain: [],
          elapsed_ms: elapsed(startedAt, this.#monotonicNow()),
          response_size: 0,
          declared_content_length: declaredLength,
          access_signals: initialSignals
        });
      }
      const bytes = await readBodyWithLimit(response, GUIZHOU_ATTACHMENT_MAX_RESPONSE_BYTES);
      const accessSignals = inspectAccessSignals(
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
          content_encoding: contentEncoding,
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
          content_encoding: contentEncoding,
          final_url: finalUrl,
          redirect_chain: [],
          elapsed_ms: elapsed(startedAt, this.#monotonicNow()),
          response_size: bytes.byteLength,
          declared_content_length: declaredLength,
          access_signals: accessSignals
        });
      }
      if (normalizeMime(contentType) !== GUIZHOU_ATTACHMENT_EXPECTED_MIME) {
        return failedResult({
          responded_at: this.#now(),
          code: "MIME_TYPE_MISMATCH",
          message: `Expected XLSX MIME but received ${contentType ?? "no Content-Type"}`,
          http_status: response.status,
          headers,
          content_type: contentType,
          content_encoding: contentEncoding,
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
          mime_type: contentType ?? GUIZHOU_ATTACHMENT_EXPECTED_MIME,
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
        content_encoding: contentEncoding,
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
        content_encoding: null,
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

export async function runGuizhouAttachmentObservationCanary(
  approval: GuizhouAttachmentObservationApprovalBundle,
  transport: OneEndpointOneRunGuizhouAttachmentTransport,
  requestedAt: IsoDateTime
): Promise<GuizhouAttachmentObservationCanaryResult> {
  const request: HttpTransportRequest = {
    recruitment_endpoint_id: approval.recruitment_endpoint.recruitment_endpoint_id,
    locator: approval.recruitment_endpoint.locator,
    method: "GET",
    requested_at: requestedAt,
    headers: {},
    parameters: {},
    timeout_ms: GUIZHOU_ATTACHMENT_OBSERVATION_TIMEOUT_MS
  };
  const rawBlobs = new InMemoryRawBlobRepository();
  const snapshots = new InMemorySnapshotRepository();
  const capture = new RawCaptureService(rawBlobs, snapshots, {
    create_snapshot_id: () => `p2-legal-04-snapshot:${randomUUID()}` as SnapshotId
  });
  const transportResult = await transport.execute(request);
  const captured = capture.record(request, transportResult.response);
  const fileSafety = captured.raw_blob
    ? inspectGuizhouXlsxSafety(
        captured.raw_blob.bytes,
        captured.raw_blob.mime_type,
        request.locator,
        transportResult.content_encoding === null
          ? transportResult.declared_content_length
          : null
      )
    : null;
  const accessClassification =
    captured.raw_blob && fileSafety?.classification === "PASS"
      ? "EVIDENCE_CAPTURED"
      : "REVIEW_REQUIRED";
  const observationEvidence: GuizhouAttachmentObservationEvidence = {
    evidence_id: evidenceId("endpoint-observation"),
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
    file_safety: fileSafety,
    observation_evidence: observationEvidence,
    access_classification: accessClassification,
    offline_parsing_allowed: accessClassification === "EVIDENCE_CAPTURED",
    authorization_replay_decision: replayDecision
  };
}

export function inspectGuizhouXlsxSafety(
  bytes: Uint8Array,
  contentType: string,
  locator: string,
  declaredContentLength: number | null
): GuizhouXlsxSafetyObservation {
  const base = inspectXlsxContainer(bytes, contentType, locator, declaredContentLength);
  const entryNames = centralDirectoryEntryNames(bytes);
  const macroAbsent = base.checks.vba_ole_embedded_absent
    && entryNames.every((name) => !/(?:^|\/)vbaProject\.bin$/iu.test(name));
  const oleObjectAbsent = base.checks.vba_ole_embedded_absent
    && entryNames.every((name) => !/(?:^|\/)oleObjects(?:\/|$)/iu.test(name));
  const embeddedObjectAbsent = base.checks.vba_ole_embedded_absent
    && entryNames.every((name) => !/(?:^|\/)(?:embeddings|activeX)(?:\/|$)/iu.test(name));
  const checks = {
    ...base.checks,
    macro_absent: macroAbsent,
    ole_object_absent: oleObjectAbsent,
    embedded_object_absent: embeddedObjectAbsent
  };
  const reasons = [...base.reason_codes];
  for (const [name, passed] of Object.entries({
    macro_absent: macroAbsent,
    ole_object_absent: oleObjectAbsent,
    embedded_object_absent: embeddedObjectAbsent
  })) {
    if (!passed) reasons.push(name.toUpperCase());
  }
  const actualFileType = base.checks.zip_magic_matches
    && base.checks.central_directory_valid
    && base.checks.required_ooxml_entries_present
      ? "XLSX_OFFICE_OPEN_XML"
      : "UNKNOWN";
  return {
    classification: base.classification === "PASS"
      && macroAbsent
      && oleObjectAbsent
      && embeddedObjectAbsent
        ? "PASS"
        : "REVIEW_REQUIRED",
    actual_file_type: actualFileType,
    checks,
    observed: base.observed,
    reason_codes: [...new Set(reasons)]
  };
}

function validateRequest(request: HttpTransportRequest) {
  if (request.recruitment_endpoint_id !== GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID) {
    throw new Error("Guizhou attachment Endpoint ID is not authorized");
  }
  if (request.locator !== GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL) {
    throw new Error("Guizhou attachment locator is not the exact authorized URL");
  }
  if (request.method !== "GET") {
    throw new Error("Guizhou attachment Observation Canary permits GET only");
  }
  if (request.timeout_ms !== GUIZHOU_ATTACHMENT_OBSERVATION_TIMEOUT_MS) {
    throw new Error("Guizhou attachment timeout must match fixed policy");
  }
  if (Object.keys(request.headers).length > 0 || Object.keys(request.parameters).length > 0) {
    throw new Error("Guizhou attachment Observation Canary forbids caller headers or parameters");
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
  bytes: Uint8Array,
  contentType: string | null,
  headers: Headers,
  status: number
): GuizhouAttachmentAccessSignals {
  const htmlObserved = normalizeMime(contentType) === "text/html" || looksLikeHtml(bytes);
  const text = htmlObserved ? decodeHtml(bytes, contentType) : "";
  const successfulExpectedResponse = status === 200
    && normalizeMime(contentType) === GUIZHOU_ATTACHMENT_EXPECTED_MIME;
  return {
    login: htmlObserved && (
      /<input[^>]+type=["']password["']/iu.test(text)
      || /(?:请先登录|登录后(?:查看|访问|下载))/u.test(text)
    ) ? "OBSERVED" : successfulExpectedResponse ? "NONE_OBSERVED" : "UNKNOWN",
    captcha: htmlObserved && /(?:验证码|captcha)/iu.test(text)
      ? "OBSERVED"
      : successfulExpectedResponse ? "NONE_OBSERVED" : "UNKNOWN",
    anti_bot: htmlObserved && /(?:访问过于频繁|安全验证|robot check|cloudflare|incapsula)/iu.test(text)
      ? "OBSERVED"
      : successfulExpectedResponse ? "NONE_OBSERVED" : "UNKNOWN",
    html_error_page: htmlObserved ? "OBSERVED" : successfulExpectedResponse
      ? "NONE_OBSERVED"
      : "UNKNOWN",
    request_cookie_sent: false,
    request_authorization_sent: false,
    response_set_cookie_observed: headers.has("set-cookie"),
    follow_up_cookie_required: successfulExpectedResponse
      ? "NOT_REQUIRED_FOR_SUCCESSFUL_RESPONSE"
      : "UNKNOWN"
  };
}

function blockingReasonFor(signals: GuizhouAttachmentAccessSignals) {
  if (signals.login === "OBSERVED") return "Login requirement observed";
  if (signals.captcha === "OBSERVED") return "CAPTCHA observed";
  if (signals.anti_bot === "OBSERVED") return "Anti-bot response observed";
  if (signals.html_error_page === "OBSERVED") return "HTML response observed for file Endpoint";
  return null;
}

function unknownAccessSignals(headers?: Headers): GuizhouAttachmentAccessSignals {
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
  readonly content_encoding: string | null;
  readonly final_url: string;
  readonly redirect_chain: GuizhouAttachmentTransportResult["redirect_chain"];
  readonly elapsed_ms: number;
  readonly response_size: number;
  readonly declared_content_length: number | null;
  readonly access_signals: GuizhouAttachmentAccessSignals;
}): GuizhouAttachmentTransportResult {
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
    content_encoding: input.content_encoding,
    access_signals: input.access_signals
  };
}

function centralDirectoryEntryNames(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findSignatureFromEnd(view, 0x06054b50);
  if (endOffset < 0 || endOffset + 22 > bytes.byteLength) return [];
  const entryCount = view.getUint16(endOffset + 10, true);
  let offset = view.getUint32(endOffset + 16, true);
  const names: string[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      return [];
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.byteLength) return [];
    names.push(new TextDecoder("utf-8").decode(bytes.slice(nameStart, nameEnd)));
    offset = nameEnd + extraLength + commentLength;
  }
  return names;
}

function findSignatureFromEnd(view: DataView, signature: number) {
  for (let offset = view.byteLength - 4; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  return -1;
}

function safeResponseHeaders(headers: Headers): TransportHeaders {
  const allowed = new Set([
    "cache-control",
    "content-disposition",
    "content-encoding",
    "content-length",
    "content-security-policy",
    "content-type",
    "date",
    "etag",
    "last-modified",
    "location",
    "server",
    "strict-transport-security",
    "x-content-type-options"
  ]);
  return Object.fromEntries([...headers.entries()].filter(([name]) => allowed.has(name)));
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
  const sample = new TextDecoder("latin1").decode(bytes.slice(0, 1_024));
  return /<!doctype\s+html|<html|<head|<body/iu.test(sample);
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
  const nested = nestedError(error);
  if (nested && "code" in nested) return String(nested.code);
  if (error instanceof DOMException && error.name === "AbortError") return "TIMEOUT";
  return "NETWORK_ERROR";
}

function errorMessage(error: unknown) {
  const outer = error instanceof Error ? error.message : "Unknown Observation Canary error";
  const nested = nestedError(error);
  if (!nested || !("message" in nested)) return outer;
  return `${outer}: ${String(nested.message)}`;
}

function nestedError(error: unknown): Record<string, unknown> | null {
  if (typeof error !== "object" || error === null || !("cause" in error)) return null;
  const cause = error.cause;
  return typeof cause === "object" && cause !== null
    ? cause as Record<string, unknown>
    : null;
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex") as RawContentSha256;
}

function evidenceId(label: string) {
  return `p2-legal-04-evidence:${label}:${randomUUID()}` as SourceAdmissionEvidenceId;
}

function reviewId(label: string) {
  return `p2-legal-04-review:${label}:${randomUUID()}` as SourceAdmissionReviewId;
}

function original(text: string) {
  return { text, encoding: "UTF-8" } as const;
}
