import { createHash, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import {
  InMemoryObservationCanaryAuthorizationGate,
  InMemorySourceAdmissionRegister,
  SOURCE_PROHIBITED_ACTIONS,
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
  type SourceDefinitionId,
  type TransportHeaders,
  type TransportResponse
} from "../../ingestion";

export const BEIJING_ATTACHMENT_SOURCE_DEFINITION_ID =
  "source-cn-beijing-government-public-institution-recruitment" as SourceDefinitionId;
export const BEIJING_ATTACHMENT_SOURCE_ADMISSION_ID =
  "admission-cn-beijing-government-public-institution-recruitment-attachment-xlsx" as
    SourceAdmission["source_admission_id"];
export const BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID =
  "endpoint-cn-beijing-government-public-institution-recruitment-attachment-xlsx" as
    RecruitmentEndpointId;
export const BEIJING_ATTACHMENT_ENDPOINT =
  "https://www.beijing.gov.cn/gongkai/rsxx/sydwzp/202606/P020260625349755441673.xlsx";
export const BEIJING_ATTACHMENT_REFERRING_DETAIL_ENDPOINT =
  "https://www.beijing.gov.cn/gongkai/rsxx/sydwzp/202606/t20260625_4714884.html";
export const BEIJING_ATTACHMENT_EXPECTED_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const BEIJING_ATTACHMENT_OBSERVATION_REVIEWER = "human-approved-by-user";
export const BEIJING_ATTACHMENT_OBSERVATION_TIMEOUT_MS = 15_000;
export const BEIJING_ATTACHMENT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const BEIJING_ATTACHMENT_MAX_ZIP_ENTRIES = 256;
export const BEIJING_ATTACHMENT_MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
export const BEIJING_ATTACHMENT_MAX_SINGLE_ENTRY_BYTES = 16 * 1024 * 1024;
export const BEIJING_ATTACHMENT_MAX_EXPANSION_RATIO = 100;
export const BEIJING_ATTACHMENT_DETAIL_RAW_SHA256 =
  "8a44dad79da041e1aefb7d9aed442df40f5de844eefe5d1708cb52996f511d8a";
export const BEIJING_ATTACHMENT_DETAIL_SNAPSHOT_ID =
  "p2-04d-snapshot:d46a0d70-f9d4-46d9-a9ca-bd010d0caec4";

const robotsLocator = "https://www.beijing.gov.cn/robots.txt";
const termsLocator = "https://www.beijing.gov.cn/";
const sensitiveHeaderName = /authorization|cookie|token|password|secret|session|api[_-]?key/iu;
const zipLocalFileSignature = 0x04034b50;
const zipCentralDirectorySignature = 0x02014b50;
const zipEndOfCentralDirectorySignature = 0x06054b50;
const ooxmlRequiredEntries = ["[Content_Types].xml", "xl/workbook.xml"] as const;
const nestedArchiveExtension = /\.(?:7z|bz2|docx|gz|rar|tar|tgz|xlsm|xlsx|xlam|xz|zip)$/iu;
const forbiddenEmbeddedPath = /(?:^|\/)(?:activeX|embeddings|oleObjects)(?:\/|$)|(?:^|\/)vbaProject\.bin$/iu;

export interface AttachmentObservationApprovalEvidence {
  readonly evidence_id: SourceAdmissionEvidenceId;
  readonly evidence_type: "OBSERVATION_CANARY";
  readonly source_url: string;
  readonly observed_at: IsoDateTime;
  readonly reviewer: string;
  readonly observation: string;
  readonly decision: "APPROVED_FOR_ONE_ENDPOINT_ONE_RUN_OBSERVATION";
}

export interface BeijingAttachmentObservationApprovalBundle {
  readonly admission: SourceAdmission;
  readonly recruitment_endpoint: RecruitmentEndpoint;
  readonly authorization: ObservationCanaryManualAuthorization;
  readonly execution: import("../../application").LiveCanaryExecutionRequest;
  readonly evidence: AttachmentObservationApprovalEvidence;
  readonly authorization_decision: Extract<
    ObservationCanaryAuthorizationDecision,
    { allowed: true }
  >;
  readonly authorization_gate: InMemoryObservationCanaryAuthorizationGate;
}

export type AccessObservation = "OBSERVED" | "NONE_OBSERVED" | "UNKNOWN";

export interface AttachmentAccessSignals {
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

export interface AttachmentObservationTransportResult {
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
  readonly access_signals: AttachmentAccessSignals;
}

export interface XlsxContainerSafetyResult {
  readonly classification: "PASS" | "REVIEW_REQUIRED";
  readonly checks: {
    readonly mime_type_matches: boolean;
    readonly extension_matches: boolean;
    readonly zip_magic_matches: boolean;
    readonly central_directory_valid: boolean;
    readonly required_ooxml_entries_present: boolean;
    readonly response_size_within_limit: boolean;
    readonly declared_content_length_matches: boolean | null;
    readonly entry_count_within_limit: boolean;
    readonly decompressed_total_within_limit: boolean;
    readonly single_entry_within_limit: boolean;
    readonly expansion_ratio_within_limit: boolean;
    readonly path_traversal_absent: boolean;
    readonly nested_archive_absent: boolean;
    readonly encrypted_workbook_absent: boolean;
    readonly vba_ole_embedded_absent: boolean;
    readonly external_workbook_relationship_absent: boolean;
  };
  readonly observed: {
    readonly entry_count: number | null;
    readonly compressed_bytes: number | null;
    readonly decompressed_bytes: number | null;
    readonly maximum_entry_bytes: number | null;
    readonly maximum_expansion_ratio: number | null;
  };
  readonly reason_codes: readonly string[];
}

export interface BeijingAttachmentObservationCanaryResult {
  readonly approval: BeijingAttachmentObservationApprovalBundle;
  readonly request: HttpTransportRequest;
  readonly transport: AttachmentObservationTransportResult;
  readonly raw_blob: RawBlob | null;
  readonly snapshot: Snapshot;
  readonly file_safety: XlsxContainerSafetyResult | null;
  readonly access_classification: "EVIDENCE_CAPTURED" | "REVIEW_REQUIRED";
  readonly authorization_replay_decision: ObservationCanaryAuthorizationDecision;
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

interface ZipEntry {
  readonly name: string;
  readonly flags: number;
  readonly compression_method: number;
  readonly compressed_size: number;
  readonly uncompressed_size: number;
  readonly local_header_offset: number;
}

export function createBeijingAttachmentObservationApproval(
  issuedAt: IsoDateTime,
  reviewer = BEIJING_ATTACHMENT_OBSERVATION_REVIEWER
): BeijingAttachmentObservationApprovalBundle {
  const robotsEvidenceId = evidenceId("robots-unknown");
  const termsEvidenceId = evidenceId("terms-unknown");
  const referenceEvidenceId = evidenceId("detail-reference");
  const approvalEvidenceId = evidenceId("human-observation-approval");
  const initialAdmission = createAttachmentAdmission(
    issuedAt,
    reviewer,
    robotsEvidenceId,
    termsEvidenceId,
    referenceEvidenceId
  );
  const register = new InMemorySourceAdmissionRegister();
  register.register(initialAdmission);
  const approvalEvidence: SourceAdmissionEvidence = {
    source_admission_evidence_id: approvalEvidenceId,
    source_admission_id: BEIJING_ATTACHMENT_SOURCE_ADMISSION_ID,
    endpoint: BEIJING_ATTACHMENT_ENDPOINT,
    source_url: BEIJING_ATTACHMENT_ENDPOINT,
    kind: "MANUAL_REVIEW",
    locator: `manual://p2-04e/${approvalEvidenceId}`,
    captured_at: issuedAt,
    reviewer,
    decision: "UNKNOWN",
    summary: original(
      "人工仅批准本精确附件 URL 的一次 GET Observation Canary；该批准不改变 B + REVIEW，不代表长期自动化访问许可。"
    )
  };
  const admission = register.revise({
    ...initialAdmission,
    evidence: [...initialAdmission.evidence, approvalEvidence],
    review_records: [
      ...initialAdmission.review_records,
      {
        source_admission_review_id: reviewId("human-observation-approval"),
        reviewer,
        reviewed_at: issuedAt,
        decision: "REVIEW",
        rationale: original(
          "人工批准 OBSERVE_ACCESS_PROPERTIES：单一附件 Endpoint、单一 GET、单一 Run；Admission 继续保持 REVIEW。"
        ),
        evidence_ids: [approvalEvidenceId]
      }
    ]
  });
  const recruitmentEndpoint = createAttachmentEndpoint();
  const collectionRunId = `p2-04e-observation-run:${randomUUID()}` as
    ObservationCanaryManualAuthorization["collection_run_id"];
  const authorization: ObservationCanaryManualAuthorization = {
    authorization_mode: "OBSERVATION_CANARY",
    authorization_purpose: "OBSERVE_ACCESS_PROPERTIES",
    authorization_id: `p2-04e-observation-authorization:${randomUUID()}` as
      ObservationCanaryManualAuthorization["authorization_id"],
    source_admission_id: BEIJING_ATTACHMENT_SOURCE_ADMISSION_ID,
    endpoint: BEIJING_ATTACHMENT_ENDPOINT,
    recruitment_endpoint_id: BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID,
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
  const execution = {
    source_admission_id: authorization.source_admission_id,
    endpoint: authorization.endpoint,
    recruitment_endpoint_id: authorization.recruitment_endpoint_id,
    recruitment_endpoint: recruitmentEndpoint,
    endpoint_purpose: authorization.endpoint_purpose,
    allowed_http_method: authorization.allowed_http_method,
    collection_run_id: authorization.collection_run_id
  } as const;
  const authorizationGate = new InMemoryObservationCanaryAuthorizationGate();
  const authorizationDecision = authorizationGate.authorize(
    admission,
    execution,
    authorization
  );
  if (!authorizationDecision.allowed) {
    throw new Error(
      `Attachment Observation Canary authorization was denied: ${authorizationDecision.reason_codes.join(", ")}`
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
      source_url: BEIJING_ATTACHMENT_ENDPOINT,
      observed_at: issuedAt,
      reviewer,
      observation:
        "人工批准一次性访问属性观察；官方详情 Raw/Snapshot 证明该 locator 被引用，但 robots、terms、login、CAPTCHA 和附件响应属性在请求前保持 UNKNOWN。",
      decision: "APPROVED_FOR_ONE_ENDPOINT_ONE_RUN_OBSERVATION"
    },
    authorization_decision: authorizationDecision,
    authorization_gate: authorizationGate
  };
}

export class OneEndpointOneRunAttachmentObservationTransport {
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

  async execute(request: HttpTransportRequest): Promise<AttachmentObservationTransportResult> {
    validateObservationRequest(request);
    if (this.#used) {
      throw new Error("ONE_ENDPOINT_ONE_RUN attachment observation transport is already consumed");
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
      const headers = safeResponseHeaders(response.headers);
      const contentType = response.headers.get("content-type");
      const declaredLength = parseContentLength(response.headers.get("content-length"));
      const finalUrl = response.url || request.locator;
      const redirectObserved = response.status >= 300 && response.status < 400;
      const redirectChain = redirectObserved
        ? [{ status: response.status, location: response.headers.get("location") }]
        : [];
      const initialSignals = unknownAccessSignals(response.headers);
      if (redirectObserved) {
        await cancelBody(response);
        return failedTransportResult({
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
        return failedTransportResult({
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
      if (declaredLength !== null && declaredLength > BEIJING_ATTACHMENT_MAX_RESPONSE_BYTES) {
        await cancelBody(response);
        return failedTransportResult({
          responded_at: this.#now(),
          code: "RESPONSE_SIZE_LIMIT",
          message: `Declared response size ${declaredLength} exceeds 10 MiB`,
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
      const bytes = await readBodyWithLimit(response, BEIJING_ATTACHMENT_MAX_RESPONSE_BYTES);
      const accessSignals = inspectAccessSignals(bytes, contentType, response.headers, response.status);
      if (response.status !== 200) {
        return failedTransportResult({
          responded_at: this.#now(),
          code: httpFailureCode(response.status),
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
      if (accessSignals.html_error_page === "OBSERVED") {
        return failedTransportResult({
          responded_at: this.#now(),
          code: "HTML_RESPONSE_OBSERVED",
          message: "Expected XLSX but received an HTML response",
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
      if (normalizeMime(contentType) !== BEIJING_ATTACHMENT_EXPECTED_MIME) {
        return failedTransportResult({
          responded_at: this.#now(),
          code: "MIME_TYPE_MISMATCH",
          message: `Expected XLSX MIME but received ${contentType ?? "no Content-Type"}`,
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
          mime_type: contentType ?? BEIJING_ATTACHMENT_EXPECTED_MIME,
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
      return failedTransportResult({
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

export async function runBeijingAttachmentObservationCanary(
  approval: BeijingAttachmentObservationApprovalBundle,
  transport: OneEndpointOneRunAttachmentObservationTransport,
  requestedAt: IsoDateTime
): Promise<BeijingAttachmentObservationCanaryResult> {
  const request: HttpTransportRequest = {
    recruitment_endpoint_id: approval.recruitment_endpoint.recruitment_endpoint_id,
    locator: approval.recruitment_endpoint.locator,
    method: "GET",
    requested_at: requestedAt,
    headers: {},
    parameters: {},
    timeout_ms: BEIJING_ATTACHMENT_OBSERVATION_TIMEOUT_MS
  };
  const rawBlobs = new InMemoryRawBlobRepository();
  const snapshots = new InMemorySnapshotRepository();
  const capture = new RawCaptureService(rawBlobs, snapshots, {
    create_snapshot_id: () => `p2-04e-observation-snapshot:${randomUUID()}` as SnapshotId
  });
  const transportResult = await transport.execute(request);
  const captured = capture.record(request, transportResult.response);
  const fileSafety = captured.raw_blob
    ? inspectXlsxContainer(
        captured.raw_blob.bytes,
        captured.raw_blob.mime_type,
        request.locator,
        transportResult.declared_content_length
      )
    : null;
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
    access_classification:
      captured.raw_blob && fileSafety?.classification === "PASS"
        ? "EVIDENCE_CAPTURED"
        : "REVIEW_REQUIRED",
    authorization_replay_decision: replayDecision
  };
}

export function inspectXlsxContainer(
  bytes: Uint8Array,
  contentType: string,
  locator: string,
  declaredContentLength: number | null
): XlsxContainerSafetyResult {
  const reasons: string[] = [];
  const mimeMatches = normalizeMime(contentType) === BEIJING_ATTACHMENT_EXPECTED_MIME;
  const extensionMatches = new URL(locator).pathname.toLowerCase().endsWith(".xlsx");
  const zipMagicMatches = readUint32(bytes, 0) === zipLocalFileSignature;
  const responseSizeWithinLimit = bytes.byteLength <= BEIJING_ATTACHMENT_MAX_RESPONSE_BYTES;
  const declaredContentLengthMatches = declaredContentLength === null
    ? null
    : declaredContentLength === bytes.byteLength;
  if (!mimeMatches) reasons.push("MIME_TYPE_MISMATCH");
  if (!extensionMatches) reasons.push("EXTENSION_MISMATCH");
  if (!zipMagicMatches) reasons.push("ZIP_MAGIC_MISMATCH");
  if (!responseSizeWithinLimit) reasons.push("RESPONSE_SIZE_LIMIT");
  if (declaredContentLengthMatches === false) reasons.push("CONTENT_LENGTH_MISMATCH");

  let entries: readonly ZipEntry[] = [];
  let centralDirectoryValid = false;
  try {
    entries = parseCentralDirectory(bytes);
    centralDirectoryValid = true;
  } catch (error) {
    reasons.push(`INVALID_CENTRAL_DIRECTORY:${errorMessage(error)}`);
  }
  const entryCountWithinLimit = entries.length > 0
    && entries.length <= BEIJING_ATTACHMENT_MAX_ZIP_ENTRIES;
  const totalUncompressed = entries.reduce((sum, entry) => sum + entry.uncompressed_size, 0);
  const totalCompressed = entries.reduce((sum, entry) => sum + entry.compressed_size, 0);
  const maximumEntryBytes = entries.length > 0
    ? Math.max(...entries.map((entry) => entry.uncompressed_size))
    : null;
  const entryRatios = entries.map(expansionRatio);
  const maximumExpansionRatio = entryRatios.length > 0 ? Math.max(...entryRatios) : null;
  const totalExpansionRatio = totalUncompressed / Math.max(totalCompressed, 1);
  const decompressedTotalWithinLimit = centralDirectoryValid
    && totalUncompressed <= BEIJING_ATTACHMENT_MAX_DECOMPRESSED_BYTES;
  const singleEntryWithinLimit = centralDirectoryValid
    && entries.every((entry) => entry.uncompressed_size <= BEIJING_ATTACHMENT_MAX_SINGLE_ENTRY_BYTES);
  const expansionRatioWithinLimit = centralDirectoryValid
    && totalExpansionRatio <= BEIJING_ATTACHMENT_MAX_EXPANSION_RATIO
    && entryRatios.every((ratio) => ratio <= BEIJING_ATTACHMENT_MAX_EXPANSION_RATIO);
  const pathTraversalAbsent = centralDirectoryValid
    && entries.every((entry) => isSafeZipPath(entry.name));
  const nestedArchiveAbsent = centralDirectoryValid
    && entries.every((entry) => !nestedArchiveExtension.test(entry.name));
  const encryptedWorkbookAbsent = centralDirectoryValid
    && entries.every((entry) => (entry.flags & 0x41) === 0)
    && !startsWithOleMagic(bytes);
  const embeddedPathAbsent = centralDirectoryValid
    && entries.every((entry) => !forbiddenEmbeddedPath.test(entry.name));
  const entryNames = new Set(entries.map((entry) => entry.name));
  const requiredEntriesPresent = centralDirectoryValid
    && ooxmlRequiredEntries.every((name) => entryNames.has(name));
  let vbaOleEmbeddedAbsent = embeddedPathAbsent;
  let externalWorkbookRelationshipAbsent = centralDirectoryValid;
  if (centralDirectoryValid) {
    try {
      const contentTypesEntry = entries.find((entry) => entry.name === "[Content_Types].xml");
      if (!contentTypesEntry) {
        vbaOleEmbeddedAbsent = false;
      } else {
        const contentTypes = decodeXml(readZipEntry(bytes, contentTypesEntry));
        if (/(?:macroEnabled|vbaProject|oleObject|activeX)/iu.test(contentTypes)) {
          vbaOleEmbeddedAbsent = false;
        }
      }
      if (entries.some((entry) => entry.name.startsWith("xl/externalLinks/"))) {
        externalWorkbookRelationshipAbsent = false;
      }
      for (const relationshipEntry of entries.filter((entry) => entry.name.endsWith(".rels"))) {
        const relationships = decodeXml(readZipEntry(bytes, relationshipEntry));
        if (
          /Type\s*=\s*["'][^"']*\/externalLink["']/iu.test(relationships)
          || /Target\s*=\s*["'][^"']*externalLinks?\//iu.test(relationships)
        ) {
          externalWorkbookRelationshipAbsent = false;
        }
      }
    } catch (error) {
      reasons.push(`OOXML_SAFETY_INSPECTION_FAILED:${errorMessage(error)}`);
      vbaOleEmbeddedAbsent = false;
      externalWorkbookRelationshipAbsent = false;
    }
  }

  const checks = {
    mime_type_matches: mimeMatches,
    extension_matches: extensionMatches,
    zip_magic_matches: zipMagicMatches,
    central_directory_valid: centralDirectoryValid,
    required_ooxml_entries_present: requiredEntriesPresent,
    response_size_within_limit: responseSizeWithinLimit,
    declared_content_length_matches: declaredContentLengthMatches,
    entry_count_within_limit: entryCountWithinLimit,
    decompressed_total_within_limit: decompressedTotalWithinLimit,
    single_entry_within_limit: singleEntryWithinLimit,
    expansion_ratio_within_limit: expansionRatioWithinLimit,
    path_traversal_absent: pathTraversalAbsent,
    nested_archive_absent: nestedArchiveAbsent,
    encrypted_workbook_absent: encryptedWorkbookAbsent,
    vba_ole_embedded_absent: vbaOleEmbeddedAbsent,
    external_workbook_relationship_absent: externalWorkbookRelationshipAbsent
  };
  for (const [check, passed] of Object.entries(checks)) {
    if (passed === false && !reasons.some((reason) => reason.startsWith(check))) {
      reasons.push(check.toUpperCase());
    }
  }
  return {
    classification: Object.values(checks).every((value) => value !== false)
      && declaredContentLengthMatches !== false
      ? "PASS"
      : "REVIEW_REQUIRED",
    checks,
    observed: {
      entry_count: centralDirectoryValid ? entries.length : null,
      compressed_bytes: centralDirectoryValid ? totalCompressed : null,
      decompressed_bytes: centralDirectoryValid ? totalUncompressed : null,
      maximum_entry_bytes: centralDirectoryValid ? maximumEntryBytes : null,
      maximum_expansion_ratio: centralDirectoryValid ? maximumExpansionRatio : null
    },
    reason_codes: [...new Set(reasons)]
  };
}

function createAttachmentAdmission(
  observedAt: IsoDateTime,
  reviewer: string,
  robotsEvidenceId: SourceAdmissionEvidenceId,
  termsEvidenceId: SourceAdmissionEvidenceId,
  referenceEvidenceId: SourceAdmissionEvidenceId
): SourceAdmission {
  const evidence: readonly SourceAdmissionEvidence[] = [
    {
      source_admission_evidence_id: robotsEvidenceId,
      source_admission_id: BEIJING_ATTACHMENT_SOURCE_ADMISSION_ID,
      endpoint: BEIJING_ATTACHMENT_ENDPOINT,
      source_url: BEIJING_ATTACHMENT_ENDPOINT,
      kind: "ROBOTS",
      locator: robotsLocator,
      captured_at: observedAt,
      reviewer,
      decision: "UNKNOWN",
      summary: original(
        "本阶段未访问 robots.txt，附件精确路径的 robots 结论保持 UNKNOWN。"
      )
    },
    {
      source_admission_evidence_id: termsEvidenceId,
      source_admission_id: BEIJING_ATTACHMENT_SOURCE_ADMISSION_ID,
      endpoint: BEIJING_ATTACHMENT_ENDPOINT,
      source_url: BEIJING_ATTACHMENT_ENDPOINT,
      kind: "TERMS",
      locator: termsLocator,
      captured_at: observedAt,
      reviewer,
      decision: "UNKNOWN",
      summary: original(
        "本阶段未访问新的 Terms 页面，附件自动化访问条款保持 UNKNOWN。"
      )
    },
    {
      source_admission_evidence_id: referenceEvidenceId,
      source_admission_id: BEIJING_ATTACHMENT_SOURCE_ADMISSION_ID,
      endpoint: BEIJING_ATTACHMENT_ENDPOINT,
      source_url: BEIJING_ATTACHMENT_REFERRING_DETAIL_ENDPOINT,
      kind: "ENDPOINT_INSPECTION",
      locator:
        `snapshot://${BEIJING_ATTACHMENT_DETAIL_SNAPSHOT_ID}/raw-sha256/${BEIJING_ATTACHMENT_DETAIL_RAW_SHA256}#a[href='./P020260625349755441673.xlsx']`,
      captured_at: observedAt,
      reviewer,
      decision: "UNKNOWN",
      summary: original(
        "已验证 P2-04D Detail Raw/Snapshot 中存在附件1链接；该事实只证明官方页面引用 locator，不证明附件 Endpoint 已获自动访问许可。"
      )
    }
  ];
  return {
    source_admission_id: BEIJING_ATTACHMENT_SOURCE_ADMISSION_ID,
    admission_level: "B",
    automation_basis: "INSUFFICIENT_EVIDENCE",
    source_name: traceable("北京市人民政府事业单位招聘附件"),
    source_type: "OFFICIAL_RECRUITMENT_PAGE",
    official_owner: traceable("北京市人民政府"),
    endpoint: BEIJING_ATTACHMENT_ENDPOINT,
    recruitment_endpoint_id: BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID,
    endpoint_purpose: "RECRUITMENT_ATTACHMENT",
    allowed_http_method: "GET",
    content_kind: "FILE",
    source_authority: "OFFICIAL",
    robots: { status: "UNKNOWN", evidence_id: robotsEvidenceId },
    terms: { status: "UNKNOWN", evidence_id: termsEvidenceId },
    login_requirement: "UNKNOWN",
    captcha: "UNKNOWN",
    structure: "DOCUMENT",
    stability: "UNKNOWN",
    update_frequency: "UNKNOWN",
    priority: "HIGH",
    prohibited_actions: SOURCE_PROHIBITED_ACTIONS,
    evidence,
    review_records: [{
      source_admission_review_id: reviewId("offline-reference-review"),
      reviewer,
      reviewed_at: observedAt,
      decision: "REVIEW",
      rationale: original(
        "官方 Detail Raw 仅证明附件引用；访问属性均为 UNKNOWN，需独立 Observation Canary。"
      ),
      evidence_ids: [robotsEvidenceId, termsEvidenceId, referenceEvidenceId]
    }],
    admission_decision: "REVIEW"
  };
}

function createAttachmentEndpoint(): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID,
    source_definition_id: BEIJING_ATTACHMENT_SOURCE_DEFINITION_ID,
    name: traceable("北京急救中心2026年度第四批公开招聘职位及要求表附件"),
    description: traceable("P2-04E 单一附件 URL 的一次性访问属性观察与 Raw/Snapshot 封存。"),
    coverage_regions: [{ raw_text: original("北京市") }],
    locator: BEIJING_ATTACHMENT_ENDPOINT,
    request_method: "GET",
    content_kind: "FILE",
    adapter_key: "p2-04e-observation-capture-only",
    decoded_text_encoding: UTF8_TEXT_ENCODING,
    collection_config: {
      timeout_ms: BEIJING_ATTACHMENT_OBSERVATION_TIMEOUT_MS,
      max_items: 1,
      max_pages: 1,
      follow_redirects: false,
      retry_limit: 0
    },
    enabled: false
  };
}

function validateObservationRequest(request: HttpTransportRequest) {
  if (request.recruitment_endpoint_id !== BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID) {
    throw new Error("Attachment Observation Canary Endpoint ID is not authorized");
  }
  if (request.locator !== BEIJING_ATTACHMENT_ENDPOINT) {
    throw new Error("Attachment Observation Canary locator is not the exact authorized URL");
  }
  if (request.method !== "GET") throw new Error("Attachment Observation Canary permits GET only");
  if (request.timeout_ms !== BEIJING_ATTACHMENT_OBSERVATION_TIMEOUT_MS) {
    throw new Error("Attachment Observation Canary timeout must match the fixed policy");
  }
  if (Object.keys(request.headers).length > 0 || Object.keys(request.parameters).length > 0) {
    throw new Error("Attachment Observation Canary forbids caller headers and parameters");
  }
}

function parseCentralDirectory(bytes: Uint8Array): readonly ZipEntry[] {
  if (bytes.byteLength < 22) throw new Error("ZIP is shorter than the EOCD record");
  const view = dataView(bytes);
  const eocdOffset = findEndOfCentralDirectory(view);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const commentLength = view.getUint16(eocdOffset + 20, true);
  if (eocdOffset + 22 + commentLength !== bytes.byteLength) {
    throw new Error("ZIP has trailing data or an invalid EOCD comment length");
  }
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error("Multi-disk ZIP is not allowed");
  }
  if (
    entryCount === 0xffff
    || centralDirectorySize === 0xffffffff
    || centralDirectoryOffset === 0xffffffff
  ) {
    throw new Error("ZIP64 requires separate review");
  }
  if (entryCount === 0 || entryCount > BEIJING_ATTACHMENT_MAX_ZIP_ENTRIES) {
    throw new Error("ZIP entry count is outside the allowed range");
  }
  if (centralDirectoryOffset + centralDirectorySize > eocdOffset) {
    throw new Error("Central directory exceeds the archive boundary");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocdOffset || view.getUint32(offset, true) !== zipCentralDirectorySignature) {
      throw new Error("Invalid central directory entry");
    }
    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLengthForEntry = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const end = offset + 46 + nameLength + extraLength + commentLengthForEntry;
    if (end > eocdOffset) throw new Error("Central directory entry exceeds its boundary");
    if (
      compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff
      || localHeaderOffset === 0xffffffff
    ) {
      throw new Error("ZIP64 entry requires separate review");
    }
    if (diskStart !== 0) throw new Error("Multi-disk ZIP entry is not allowed");
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
    }
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!name || names.has(name)) throw new Error("ZIP entry names must be non-empty and unique");
    names.add(name);
    entries.push({
      name,
      flags,
      compression_method: compressionMethod,
      compressed_size: compressedSize,
      uncompressed_size: uncompressedSize,
      local_header_offset: localHeaderOffset
    });
    offset = end;
  }
  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    throw new Error("Central directory size does not match parsed entries");
  }
  return entries;
}

function readZipEntry(bytes: Uint8Array, entry: ZipEntry) {
  const view = dataView(bytes);
  const offset = entry.local_header_offset;
  if (offset + 30 > bytes.byteLength || view.getUint32(offset, true) !== zipLocalFileSignature) {
    throw new Error(`Invalid local header for ${entry.name}`);
  }
  const flags = view.getUint16(offset + 6, true);
  const method = view.getUint16(offset + 8, true);
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  if ((flags & 0x41) !== 0 || flags !== entry.flags || method !== entry.compression_method) {
    throw new Error(`Unsafe or inconsistent local header for ${entry.name}`);
  }
  const dataOffset = offset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressed_size;
  if (dataEnd > bytes.byteLength) throw new Error(`Compressed data exceeds archive for ${entry.name}`);
  const compressed = bytes.subarray(dataOffset, dataEnd);
  const decoded = method === 0
    ? new Uint8Array(compressed)
    : new Uint8Array(inflateRawSync(compressed, {
        maxOutputLength: Math.max(1, entry.uncompressed_size)
      }));
  if (decoded.byteLength !== entry.uncompressed_size) {
    throw new Error(`Uncompressed size mismatch for ${entry.name}`);
  }
  return decoded;
}

function findEndOfCentralDirectory(view: DataView) {
  const minimum = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === zipEndOfCentralDirectorySignature) return offset;
  }
  throw new Error("ZIP end-of-central-directory record was not found");
}

function isSafeZipPath(name: string) {
  if (name.includes("\\") || name.startsWith("/") || /^[a-z]:/iu.test(name)) return false;
  return name.split("/").every((segment) => segment !== "..");
}

function expansionRatio(entry: ZipEntry) {
  if (entry.uncompressed_size === 0) return 0;
  if (entry.compressed_size === 0) return Number.POSITIVE_INFINITY;
  return entry.uncompressed_size / entry.compressed_size;
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
      await reader.cancel("P2-04E response size budget exceeded");
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
): AttachmentAccessSignals {
  const htmlObserved = normalizeMime(contentType) === "text/html"
    || looksLikeHtml(bytes);
  if (!htmlObserved) {
    return {
      login: status === 200 ? "NONE_OBSERVED" : "UNKNOWN",
      captcha: status === 200 ? "NONE_OBSERVED" : "UNKNOWN",
      anti_bot: status === 200 ? "NONE_OBSERVED" : "UNKNOWN",
      html_error_page: "NONE_OBSERVED",
      request_cookie_sent: false,
      request_authorization_sent: false,
      response_set_cookie_observed: headers.has("set-cookie"),
      follow_up_cookie_required: status === 200
        ? "NOT_REQUIRED_FOR_SUCCESSFUL_RESPONSE"
        : "UNKNOWN"
    };
  }
  const sample = new TextDecoder("utf-8").decode(bytes.subarray(0, 128 * 1024));
  return {
    login: /(?:type\s*=\s*["']password["']|登录|login)/iu.test(sample)
      ? "OBSERVED"
      : "NONE_OBSERVED",
    captcha: /(?:验证码|captcha)/iu.test(sample) ? "OBSERVED" : "NONE_OBSERVED",
    anti_bot: /(?:访问过于频繁|安全验证|robot check|cloudflare|anti-bot)/iu.test(sample)
      ? "OBSERVED"
      : "NONE_OBSERVED",
    html_error_page: "OBSERVED",
    request_cookie_sent: false,
    request_authorization_sent: false,
    response_set_cookie_observed: headers.has("set-cookie"),
    follow_up_cookie_required: "UNKNOWN"
  };
}

function unknownAccessSignals(headers?: Headers): AttachmentAccessSignals {
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

function failedTransportResult(input: {
  readonly responded_at: IsoDateTime;
  readonly code: string;
  readonly message: string;
  readonly http_status: number | null;
  readonly headers: TransportHeaders;
  readonly content_type: string | null;
  readonly final_url: string;
  readonly redirect_chain: AttachmentObservationTransportResult["redirect_chain"];
  readonly elapsed_ms: number;
  readonly response_size: number;
  readonly declared_content_length: number | null;
  readonly access_signals: AttachmentAccessSignals;
}): AttachmentObservationTransportResult {
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
    declared_content_length: input.declared_content_length,
    response_content_type: input.content_type,
    access_signals: input.access_signals
  };
}

function safeResponseHeaders(headers: Headers): TransportHeaders {
  return Object.fromEntries([...headers.entries()].filter(([name]) => {
    return !sensitiveHeaderName.test(name) && name.toLowerCase() !== "set-cookie";
  }));
}

async function cancelBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    return;
  }
}

function looksLikeHtml(bytes: Uint8Array) {
  const sample = new TextDecoder("utf-8").decode(bytes.subarray(0, 512)).trimStart();
  return /^(?:<!doctype\s+html|<html|<head|<body)/iu.test(sample);
}

function startsWithOleMagic(bytes: Uint8Array) {
  const oleMagic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return oleMagic.every((value, index) => bytes[index] === value);
}

function readUint32(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 4 > bytes.byteLength) return null;
  return dataView(bytes).getUint32(offset, true);
}

function dataView(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decodeXml(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function normalizeMime(value: string | null) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function parseContentLength(value: string | null) {
  if (value === null || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
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
  if (error instanceof DOMException && error.name === "AbortError") return "TIMEOUT";
  return "NETWORK_ERROR";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Attachment Observation Canary error";
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex") as RawContentSha256;
}

function evidenceId(label: string) {
  return `p2-04e-evidence:${label}:${randomUUID()}` as SourceAdmissionEvidenceId;
}

function reviewId(label: string) {
  return `p2-04e-review:${label}:${randomUUID()}` as SourceAdmissionReviewId;
}

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}
