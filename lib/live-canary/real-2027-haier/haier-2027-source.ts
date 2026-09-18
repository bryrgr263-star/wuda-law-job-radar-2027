import { createHash } from "node:crypto";

import * as cheerio from "cheerio";

import {
  SOURCE_PROHIBITED_ACTIONS,
  type SourceAdmission,
  type SourceAdmissionEvidence,
  type SourceAdmissionEvidenceId,
  type SourceAdmissionReviewId
} from "../../application";
import type { HttpTransportRequest } from "../../collection-runtime";
import {
  AdapterExtractionError,
  UTF8_TEXT_ENCODING,
  type AdapterCompletenessAssessment,
  type AdapterCompletenessInput,
  type AdapterDescriptor,
  type AdapterExtractionInput,
  type AdapterNextPageInput,
  type AdapterRequestPlan,
  type EndpointValidationResult,
  type ExtractedRecord,
  type ExtractedRecordId,
  type IsoDateTime,
  type OriginalText,
  type RawBlob,
  type RawContentSha256,
  type RecruitmentAdapter,
  type RecruitmentEndpoint,
  type RecruitmentEndpointId,
  type SourceDefinition,
  type TransportHeaders,
  type TransportResponse
} from "../../ingestion";
import {
  createSourcePersistenceVersion,
  type ProductionPersistenceProvenance,
  type SourcePersistenceVersion
} from "../../production-persistence/contracts";

export const HAIER_2027_LEGAL_URL =
  "https://maker.haier.net/client/campus/customizedptjobdetail/sid/64/rid/61";
export const HAIER_2027_ADAPTER_KEY = "cn-haier-2027-legal-official-html";
export const HAIER_2027_SOURCE_DEFINITION_ID =
  "source-cn-haier-2027-legal-campus-recruitment" as never;
export const HAIER_2027_RECRUITMENT_ENDPOINT_ID =
  "endpoint-cn-haier-2027-legal-campus-recruitment-html" as RecruitmentEndpointId;
export const HAIER_2027_SOURCE_ADMISSION_ID =
  "admission-cn-haier-2027-legal-campus-recruitment" as
    SourceAdmission["source_admission_id"];
export const HAIER_2027_TIMEOUT_MS = 20_000;
export const HAIER_2027_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const HAIER_2027_APPROVAL_REFERENCE =
  "user-approval:second-real-official-2027-source-haier-rid-61";
export const HAIER_2027_PACKAGE_RECORD_ID = "haier-rid-61:page-package";
export const HAIER_2027_POSITION_RECORD_ID = "haier-rid-61:legal-position";

const descriptor: AdapterDescriptor = {
  adapter_key: HAIER_2027_ADAPTER_KEY,
  name: "Haier2027LegalOfficialHtmlAdapter",
  version: "1.0.0",
  supported_content_kinds: ["HTML"],
  capabilities: ["HTML_EXTRACTION"]
};
const sensitiveHeader =
  /authorization|cookie|proxy-authorization|token|password|secret|session|api[_-]?key/iu;

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export class Haier2027ApprovedOfficialTransport {
  readonly #fetch: FetchImplementation;
  readonly #now: () => IsoDateTime;
  #used = false;
  #report: {
    readonly url: string;
    readonly content_sha256: string;
    readonly byte_length: number;
    readonly responded_at: string;
    readonly http_status: number;
  } | null = null;

  constructor(
    fetchImplementation: FetchImplementation,
    options: { readonly now?: () => IsoDateTime } = {}
  ) {
    this.#fetch = fetchImplementation;
    this.#now = options.now ?? (() => new Date().toISOString() as IsoDateTime);
  }

  async execute(request: HttpTransportRequest): Promise<TransportResponse> {
    assertHaier2027ApprovedRequest(request);
    if (this.#used) throw new Error("Approved Haier endpoint already consumed");
    this.#used = true;
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
      const headers = safeHeaders(response.headers);
      const finalUrl = response.url || request.locator;
      if (response.redirected || finalUrl !== request.locator
          || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel();
        return failed(this.#now(), "REDIRECT_REJECTED",
          `Redirect or final URL change rejected: ${finalUrl}`, false,
          response.status, headers, response.headers.get("content-type"));
      }
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel();
        return failed(this.#now(), `HTTP_${response.status}`,
          `HTTP status ${response.status}`, false, response.status, headers,
          response.headers.get("content-type"));
      }
      const contentType = response.headers.get("content-type");
      if (!contentType?.toLowerCase().startsWith("text/html")) {
        await response.body?.cancel();
        return failed(this.#now(), "NON_HTML_RESPONSE",
          `Expected HTML but received ${contentType ?? "no Content-Type"}`, false,
          response.status, headers, contentType);
      }
      const bytes = await readBodyWithLimit(response, HAIER_2027_MAX_RESPONSE_BYTES);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (/<input[^>]+type=["']password["']|验证码|captcha/iu.test(text)) {
        return failed(this.#now(), "INTERACTIVE_ACCESS_DETECTED",
          "Password or CAPTCHA content was detected", false,
          response.status, headers, contentType);
      }
      const contentSha256 = sha256(bytes);
      this.#report = {
        url: request.locator,
        content_sha256: contentSha256,
        byte_length: bytes.byteLength,
        responded_at: this.#now(),
        http_status: response.status
      };
      return {
        status: "SUCCESS",
        responded_at: this.#report.responded_at as IsoDateTime,
        bytes,
        content_sha256: contentSha256 as RawContentSha256,
        mime_type: contentType,
        http_status: response.status,
        headers
      };
    } catch (error) {
      return failed(
        this.#now(),
        error instanceof DOMException && error.name === "AbortError"
          ? "TIMEOUT" : "ACQUISITION_FAILED",
        error instanceof Error ? error.message : "Unknown acquisition failure",
        false
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  report() {
    if (!this.#report) throw new Error("Haier approved transport has no successful response");
    return structuredClone(this.#report);
  }
}

export class Haier2027LegalOfficialHtmlAdapter implements RecruitmentAdapter {
  readonly descriptor = descriptor;

  validateEndpoint(endpoint: RecruitmentEndpoint): EndpointValidationResult {
    const issues: string[] = [];
    if (endpoint.adapter_key !== descriptor.adapter_key) {
      issues.push(`Endpoint adapter_key must be ${descriptor.adapter_key}`);
    }
    if (endpoint.locator !== HAIER_2027_LEGAL_URL) {
      issues.push("Endpoint locator must exactly match the approved Haier legal role");
    }
    if (endpoint.request_method !== "GET" || endpoint.content_kind !== "HTML") {
      issues.push("Haier canary endpoint requires GET HTML");
    }
    if ((endpoint.collection_config.max_pages ?? 0) !== 1
        || endpoint.collection_config.follow_redirects !== false
        || endpoint.collection_config.retry_limit !== 0) {
      issues.push("Haier canary requires one page, no redirects, and no retries");
    }
    return issues.length === 0
      ? { valid: true, issues: [] }
      : { valid: false, issues };
  }

  plan(endpoint: RecruitmentEndpoint): readonly AdapterRequestPlan[] {
    this.assertEndpoint(endpoint);
    return [{
      recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
      locator: HAIER_2027_LEGAL_URL,
      method: "GET",
      parameters: {},
      pagination_state: {
        page_index: 1,
        cursor: null,
        visited_locators: [HAIER_2027_LEGAL_URL]
      }
    }];
  }

  extract(input: AdapterExtractionInput): readonly ExtractedRecord[] {
    this.assertEndpoint(input.endpoint);
    const rawBlob = this.assertTraceability(input);
    if (input.snapshot.request_metadata.locator !== HAIER_2027_LEGAL_URL) {
      throw malformed("Snapshot locator is outside the approved Haier URL");
    }
    const html = new TextDecoder("utf-8", { fatal: true }).decode(rawBlob.bytes);
    const $ = cheerio.load(html);
    const documentTitle = clean($("title").first().text());
    const positionTitle = clean($(".campus_joblist_wrap .job_name").first().text());
    const intro = clean($(".campus_joblist_wrap .job_intro").first().text());
    const description = sectionLines($, "职位描述");
    const requirementLines = sectionLines($, "职位要求").filter((line) => {
      return /^\d+[、.．]/u.test(line);
    });
    if (documentTitle !== "海尔招聘-海尔官方招聘网站"
        || positionTitle !== "法务") {
      throw malformed(
        `Official Haier page identity changed: ${documentTitle} / ${positionTitle}`
      );
    }
    if (!/2027届应届毕业生/u.test(requirementLines.join("\n"))
        || !/法律等相关专业/u.test(requirementLines.join("\n"))
        || !/法律职业资格/u.test(requirementLines.join("\n"))) {
      throw malformed("Approved 2027 legal requirements are incomplete or changed");
    }
    if (description.length !== 5 || requirementLines.length !== 7) {
      throw malformed("Approved Haier duty or requirement count changed");
    }
    const locations = intro.split("|")[0]!.trim().split(/\s+/u).filter(Boolean);
    return [
      packageRecord(input, positionTitle, intro),
      positionRecord(input, positionTitle, locations, description, requirementLines)
    ];
  }

  nextPage(_input: AdapterNextPageInput): AdapterRequestPlan | null {
    return null;
  }

  assessCompleteness(input: AdapterCompletenessInput): AdapterCompletenessAssessment {
    if (input.extraction_errors.length > 0) {
      return { status: "FAILED", reason_codes: ["HTML_EXTRACTION_ERROR"] };
    }
    if (input.snapshots.length !== 1
        || input.snapshots[0]?.request_metadata.locator !== HAIER_2027_LEGAL_URL) {
      return { status: "PARTIAL", reason_codes: ["APPROVED_PAGE_MISSING"] };
    }
    const sourceIds = new Set(input.records.map((record) => {
      return record.raw_source_record_id;
    }));
    if (sourceIds.size !== 2
        || !sourceIds.has(HAIER_2027_PACKAGE_RECORD_ID)
        || !sourceIds.has(HAIER_2027_POSITION_RECORD_ID)) {
      return { status: "PARTIAL", reason_codes: ["POSITION_SET_INCOMPLETE"] };
    }
    return { status: "COMPLETE", reason_codes: ["ONE_APPROVED_PAGE_COMPLETE"] };
  }

  private assertEndpoint(endpoint: RecruitmentEndpoint) {
    const validation = this.validateEndpoint(endpoint);
    if (!validation.valid) {
      throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", validation.issues.join("; "));
    }
  }

  private assertTraceability(input: AdapterExtractionInput): RawBlob {
    const rawBlob = input.raw_blob;
    if (!rawBlob || input.snapshot.transport_status !== "SUCCESS") {
      throw new AdapterExtractionError("RAW_BLOB_REQUIRED", "Successful HTML RawBlob is required");
    }
    if (input.snapshot.raw_blob_id !== rawBlob.raw_blob_id
        || input.snapshot.content_hash !== rawBlob.raw_content_sha256
        || input.snapshot.content_length !== rawBlob.byte_length) {
      throw new AdapterExtractionError("RAW_BLOB_MISMATCH", "Snapshot and RawBlob differ");
    }
    if (!rawBlob.mime_type.toLowerCase().startsWith("text/html")) {
      throw malformed("Haier adapter accepts HTML only");
    }
    return rawBlob;
  }
}

export function assertHaier2027ApprovedRequest(request: HttpTransportRequest) {
  if (request.locator !== HAIER_2027_LEGAL_URL
      || new URL(request.locator).hostname !== "maker.haier.net") {
    throw new Error("Request is outside the exact approved Haier URL");
  }
  if (request.recruitment_endpoint_id !== HAIER_2027_RECRUITMENT_ENDPOINT_ID) {
    throw new Error("Request endpoint reference is not approved");
  }
  if (request.method !== "GET" || request.timeout_ms !== HAIER_2027_TIMEOUT_MS) {
    throw new Error("Approved Haier request requires fixed GET and timeout");
  }
  if (Object.keys(request.headers).length > 0
      || Object.keys(request.parameters).length > 0) {
    throw new Error("Approved Haier request rejects headers and parameters");
  }
  return request;
}

export function createHaier2027SourceVersions(input: {
  readonly observed_at: string;
  readonly provenance: ProductionPersistenceProvenance;
}): readonly SourcePersistenceVersion[] {
  const organization = {
    organization_id: "organization-cn-haier-group" as never,
    name: traceable("海尔集团"),
    aliases: [],
    country_code: "CN"
  } as const;
  const source: SourceDefinition = {
    source_definition_id: HAIER_2027_SOURCE_DEFINITION_ID,
    publisher_organization_id: organization.organization_id,
    name: traceable("海尔集团2027校园招聘法务官方岗位页"),
    publisher_kind: "EMPLOYER_OFFICIAL",
    authority_level: "OFFICIAL",
    scope: "SINGLE_ORGANIZATION",
    enabled: true
  };
  const endpoint = createHaier2027RecruitmentEndpoint();
  const admission = createHaier2027SourceAdmission(input.observed_at);
  const versions: SourcePersistenceVersion[] = [];
  const append = (artifact: SourcePersistenceVersion["artifact"]) => {
    const streamId = artifact.kind === "ORGANIZATION"
      ? artifact.payload.organization_id
      : artifact.kind === "SOURCE_DEFINITION"
        ? artifact.payload.source_definition_id
        : artifact.kind === "RECRUITMENT_ENDPOINT"
          ? artifact.payload.recruitment_endpoint_id
          : artifact.kind === "ADAPTER_REGISTRATION"
            ? artifact.payload.adapter_key
            : artifact.kind === "SOURCE_ADMISSION"
              ? artifact.payload.source_admission_id
              : artifact.payload.allowlist_entry_id;
    const version = createSourcePersistenceVersion({
      stream_id: streamId,
      revision: 1,
      supersedes_artifact_id: null,
      artifact,
      provenance: input.provenance,
      effective_at: input.observed_at,
      created_at: input.observed_at
    });
    versions.push(version);
    return version;
  };
  append({ kind: "ORGANIZATION", payload: organization });
  append({
    kind: "ADAPTER_REGISTRATION",
    payload: {
      adapter_key: descriptor.adapter_key,
      name: traceable(descriptor.name),
      supported_content_kinds: descriptor.supported_content_kinds
    }
  });
  append({ kind: "SOURCE_DEFINITION", payload: source });
  const endpointVersion = append({ kind: "RECRUITMENT_ENDPOINT", payload: endpoint });
  const admissionVersion = append({ kind: "SOURCE_ADMISSION", payload: admission });
  append({
    kind: "OFFICIAL_ENDPOINT_ALLOWLIST",
    payload: {
      allowlist_entry_id: "allowlist-cn-haier-2027-legal-rid-61",
      recruitment_endpoint_artifact_id: endpointVersion.artifact_id,
      source_admission_artifact_id: admissionVersion.artifact_id,
      active: true,
      scheme: "https",
      host: "maker.haier.net",
      port: null,
      path_prefix: "/client/campus/customizedptjobdetail/sid/64/rid/61",
      exact_path: true,
      allowed_method: "GET",
      query_policy: { mode: "DENY_ALL", allowed_parameters: [] },
      endpoint_purpose: "2027_LEGAL_POSITION",
      authority_level: "OFFICIAL",
      approval_evidence_ids: admission.evidence.map((item) => {
        return item.source_admission_evidence_id;
      })
    }
  });
  return versions;
}

export function createHaier2027RecruitmentEndpoint(): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: HAIER_2027_RECRUITMENT_ENDPOINT_ID,
    source_definition_id: HAIER_2027_SOURCE_DEFINITION_ID,
    name: traceable("海尔集团2027校园招聘法务岗位"),
    description: traceable("仅限用户批准的 sid/64/rid/61 精确岗位页"),
    coverage_regions: [
      { raw_text: original("上海") },
      { raw_text: original("青岛") }
    ],
    locator: HAIER_2027_LEGAL_URL,
    request_method: "GET",
    content_kind: "HTML",
    adapter_key: HAIER_2027_ADAPTER_KEY,
    decoded_text_encoding: UTF8_TEXT_ENCODING,
    collection_config: {
      timeout_ms: HAIER_2027_TIMEOUT_MS,
      max_items: 2,
      max_pages: 1,
      follow_redirects: false,
      retry_limit: 0
    },
    enabled: true
  };
}

export function createHaier2027SourceAdmission(observedAt: string): SourceAdmission {
  const robotsId = "evidence-haier-2027-robots-unreviewed" as SourceAdmissionEvidenceId;
  const termsId = "evidence-haier-2027-terms-unreviewed" as SourceAdmissionEvidenceId;
  const inspectionId = "evidence-haier-2027-exact-endpoint" as SourceAdmissionEvidenceId;
  const approvalId = "evidence-haier-2027-user-approval" as SourceAdmissionEvidenceId;
  const evidence = [
    sourceEvidence(robotsId, "ROBOTS", "UNKNOWN", observedAt,
      "robots.txt was not accessed because it is outside the approved exact URL"),
    sourceEvidence(termsId, "TERMS", "UNKNOWN", observedAt,
      "No terms page was accessed; the canary remains human-reviewed Level B"),
    sourceEvidence(inspectionId, "ENDPOINT_INSPECTION", "ALLOWED", observedAt,
      "The exact job page is public HTTPS HTML and readable without credentials"),
    sourceEvidence(approvalId, "MANUAL_REVIEW", "ALLOWED", observedAt,
      `User approved only ${HAIER_2027_LEGAL_URL}`)
  ];
  return {
    source_admission_id: HAIER_2027_SOURCE_ADMISSION_ID,
    admission_level: "B",
    automation_basis: "HUMAN_REVIEWED_CANARY",
    source_name: traceable("海尔集团2027校园招聘法务官方岗位页"),
    source_type: "OFFICIAL_RECRUITMENT_PAGE",
    official_owner: traceable("海尔集团"),
    endpoint: HAIER_2027_LEGAL_URL,
    recruitment_endpoint_id: HAIER_2027_RECRUITMENT_ENDPOINT_ID,
    endpoint_purpose: "JOB_DETAIL",
    allowed_http_method: "GET",
    content_kind: "HTML",
    source_authority: "OFFICIAL",
    robots: { status: "UNKNOWN", evidence_id: robotsId },
    terms: { status: "UNKNOWN", evidence_id: termsId },
    login_requirement: "NONE",
    captcha: "NONE_OBSERVED",
    structure: "STATIC_HTML",
    stability: "MEDIUM",
    update_frequency: "IRREGULAR",
    priority: "HIGH",
    prohibited_actions: [...SOURCE_PROHIBITED_ACTIONS],
    evidence,
    review_records: [{
      source_admission_review_id:
        "review-haier-2027-user-approved-canary" as SourceAdmissionReviewId,
      reviewer: "user-approved-canary",
      reviewed_at: observedAt,
      decision: "APPROVED",
      rationale: original("One exact public Haier 2027 legal job page is approved"),
      evidence_ids: evidence.map((item) => item.source_admission_evidence_id)
    }],
    admission_decision: "APPROVED"
  };
}

export function haierSourceRole(record: ExtractedRecord) {
  return record.raw_source_record_id === HAIER_2027_PACKAGE_RECORD_ID
    ? "PACKAGE" as const
    : "POSITION_BEARING" as const;
}

function packageRecord(
  input: AdapterExtractionInput,
  positionTitle: string,
  intro: string
): ExtractedRecord {
  return baseRecord(input, {
    id: HAIER_2027_PACKAGE_RECORD_ID,
    title: "海尔集团2027校园招聘法务官方岗位页",
    locations: [],
    description: `${positionTitle}；${intro}`,
    requirement: null,
    selector: ".campus_joblist_wrap",
    positionIdentity: null
  });
}

function positionRecord(
  input: AdapterExtractionInput,
  title: string,
  locations: readonly string[],
  description: readonly string[],
  requirements: readonly string[]
): ExtractedRecord {
  return baseRecord(input, {
    id: HAIER_2027_POSITION_RECORD_ID,
    title,
    locations,
    description: description.join("\n"),
    requirement: requirements.join("\n"),
    selector: ".campus_joblist_wrap .detail_cnt",
    positionIdentity: "haier-campus-sid-64-rid-61"
  });
}

function baseRecord(input: AdapterExtractionInput, data: {
  readonly id: string;
  readonly title: string;
  readonly locations: readonly string[];
  readonly description: string;
  readonly requirement: string | null;
  readonly selector: string;
  readonly positionIdentity: string | null;
}): ExtractedRecord {
  const packageRecordValue = data.positionIdentity === null;
  return {
    extracted_record_id: `legacy:${sha256Text(`${input.snapshot.snapshot_id}|${data.id}`)}` as
      ExtractedRecordId,
    snapshot_id: input.snapshot.snapshot_id,
    source_definition_id: input.endpoint.source_definition_id,
    identity_candidates: [{
      kind: "SOURCE_RECORD_ID",
      value: data.id,
      confidence: "HIGH"
    }, {
      kind: "ANNOUNCEMENT_URL",
      value: HAIER_2027_LEGAL_URL,
      confidence: "HIGH"
    }],
    raw_source_record_id: data.id,
    raw_title: original(data.title),
    raw_organization_name: original("海尔集团"),
    raw_location_text: data.locations.map(original),
    raw_description: original(data.description),
    ...(data.requirement ? { raw_requirement_text: original(data.requirement) } : {}),
    announcement_url: HAIER_2027_LEGAL_URL,
    application_url: HAIER_2027_LEGAL_URL,
    recruitment_year: original("2027"),
    recruitment_batch: original("海尔集团2027校园招聘"),
    ...(!packageRecordValue ? {
      recruitment_context: {
        announcement: confirmedIdentity(
          "haier-campus-sid-64-rid-61",
          "official:haier:campus-position",
          ".campus_joblist_wrap"
        ),
        recruitment_plan: provisionalIdentity(
          "haier-group-2027-campus-recruitment",
          ".campus_joblist_wrap"
        ),
        recruitment_batch: {
          applicability: "APPLICABLE" as const,
          identity: provisionalIdentity(
            "海尔集团2027校园招聘",
            ".campus_joblist_wrap .job_name"
          )
        },
        position: provisionalIdentity(data.positionIdentity!, data.selector),
        opportunity: provisionalIdentity(
          `${data.positionIdentity}:opportunity`,
          data.selector
        )
      }
    } : {}),
    source_record_locator: {
      kind: "HTML",
      selector: data.selector,
      path: data.id
    },
    adapter_metadata: {
      [HAIER_2027_ADAPTER_KEY]: {
        approved_url: HAIER_2027_LEGAL_URL,
        source_role: packageRecordValue ? "PACKAGE" : "POSITION_BEARING",
        source_record_id: data.id,
        publication_date_state: "NOT_YET_AVAILABLE"
      }
    },
    extraction: {
      extractor_name: descriptor.name,
      extractor_version: descriptor.version,
      extracted_at: input.snapshot.observed_at
    }
  };
}

function confirmedIdentity(value: string, namespace: string, selector: string) {
  return {
    identity_state: "CONFIRMED" as const,
    official_identifier: original(value),
    identifier_namespace: namespace,
    evidence_locator: { kind: "HTML" as const, selector }
  };
}

function provisionalIdentity(value: string, selector: string) {
  return {
    identity_state: "PROVISIONAL" as const,
    source_local_identifier: original(value),
    evidence_locator: { kind: "HTML" as const, selector }
  };
}

function sectionLines($: ReturnType<typeof cheerio.load>, heading: string) {
  const headingNode = $(".campus_joblist_wrap .job_subtitle").filter((_index, node) => {
    return clean($(node).text()) === heading;
  }).first();
  if (headingNode.length === 0) throw malformed(`${heading} heading is missing`);
  const section = headingNode.next("div").first().clone();
  if (section.length === 0) throw malformed(`${heading} section is missing`);
  section.find("br").replaceWith("\n");
  return section.text().split(/\r?\n/u).map(clean).filter(Boolean);
}

function sourceEvidence(
  id: SourceAdmissionEvidenceId,
  kind: SourceAdmissionEvidence["kind"],
  decision: SourceAdmissionEvidence["decision"],
  observedAt: string,
  summary: string
): SourceAdmissionEvidence {
  return {
    source_admission_evidence_id: id,
    source_admission_id: HAIER_2027_SOURCE_ADMISSION_ID,
    endpoint: HAIER_2027_LEGAL_URL,
    source_url: HAIER_2027_LEGAL_URL,
    kind,
    locator: HAIER_2027_APPROVAL_REFERENCE,
    captured_at: observedAt,
    reviewer: "user-approved-canary",
    decision,
    summary: original(summary)
  };
}

function traceable(text: string) {
  return { original: original(text) };
}

function original(text: string): OriginalText {
  return { text, encoding: UTF8_TEXT_ENCODING };
}

function clean(value: string) {
  return value.replace(/\u00a0/gu, " ").replace(/\s+/gu, " ").trim();
}

function malformed(message: string) {
  return new AdapterExtractionError("MALFORMED_CONTENT", message);
}

function safeHeaders(headers: Headers): TransportHeaders {
  return Object.fromEntries([...headers.entries()].filter(([name]) => {
    return !sensitiveHeader.test(name);
  }));
}

async function readBodyWithLimit(response: Response, maximum: number) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    length += item.value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new Error("Response exceeds the approved byte limit");
    }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function failed(
  respondedAt: IsoDateTime,
  code: string,
  message: string,
  retryable: boolean,
  httpStatus: number | null = null,
  headers: TransportHeaders = {},
  mimeType: string | null = null
): TransportResponse {
  return {
    status: "FAILED",
    responded_at: respondedAt,
    http_status: httpStatus,
    headers,
    mime_type: mimeType,
    error: { code, message, retryable }
  };
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
