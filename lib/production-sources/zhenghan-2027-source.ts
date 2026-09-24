import { createHash } from "node:crypto";

import * as cheerio from "cheerio";

import {
  SOURCE_PROHIBITED_ACTIONS,
  type SourceAdmission,
  type SourceAdmissionEvidence,
  type SourceAdmissionEvidenceId,
  type SourceAdmissionReviewId
} from "../application";
import type { HttpTransportRequest } from "../collection-runtime";
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
} from "../ingestion";
import {
  createSourcePersistenceVersion,
  type ProductionPersistenceProvenance,
  type SourcePersistenceVersion
} from "../production-persistence/contracts";

export const ZHENGHAN_2027_ANNOUNCEMENT_URL =
  "https://www.zhenghan.com/news/2782.html";
export const ZHENGHAN_2027_DETAIL_URL =
  "https://www.zhenghan.com/news/2790.html";
export const ZHENGHAN_2027_ADAPTER_KEY =
  "cn-zhenghan-2027-official-html";
export const ZHENGHAN_2027_SOURCE_DEFINITION_ID =
  "source-cn-zhenghan-2027-campus-recruitment" as never;
export const ZHENGHAN_2027_RECRUITMENT_ENDPOINT_ID =
  "endpoint-cn-zhenghan-2027-campus-recruitment-html" as RecruitmentEndpointId;
export const ZHENGHAN_2027_SOURCE_ADMISSION_ID =
  "admission-cn-zhenghan-2027-campus-recruitment" as
    SourceAdmission["source_admission_id"];
export const ZHENGHAN_2027_TIMEOUT_MS = 20_000;
export const ZHENGHAN_2027_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const ZHENGHAN_2027_APPROVAL_REFERENCE =
  "user-approval:b951d518-87c3-4205-88e5-1b1e94148ca7";

const approvedUrls = new Set([
  ZHENGHAN_2027_ANNOUNCEMENT_URL,
  ZHENGHAN_2027_DETAIL_URL
]);
const expectedTitles = new Map([
  [ZHENGHAN_2027_ANNOUNCEMENT_URL,
    "虹桥正瀚举办2026开放日活动 | 暨2027届校园招聘正式启动"],
  [ZHENGHAN_2027_DETAIL_URL, "【正瀚纳贤】招聘岗位 | 2026年5月"]
]);
const descriptor: AdapterDescriptor = {
  adapter_key: ZHENGHAN_2027_ADAPTER_KEY,
  name: "Zhenghan2027OfficialHtmlAdapter",
  version: "1.0.0",
  supported_content_kinds: ["HTML"],
  capabilities: ["PAGINATION", "HTML_EXTRACTION"]
};
const sensitiveHeader =
  /authorization|cookie|proxy-authorization|token|password|secret|session|api[_-]?key/iu;

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export class Zhenghan2027ApprovedOfficialTransport {
  readonly #fetch: FetchImplementation;
  readonly #used = new Set<string>();
  readonly #now: () => IsoDateTime;

  constructor(
    fetchImplementation: FetchImplementation,
    options: { readonly now?: () => IsoDateTime } = {}
  ) {
    this.#fetch = fetchImplementation;
    this.#now = options.now ?? (() => new Date().toISOString() as IsoDateTime);
  }

  async execute(request: HttpTransportRequest): Promise<TransportResponse> {
    assertZhenghan2027ApprovedRequest(request);
    if (this.#used.has(request.locator)) {
      throw new Error(`Approved endpoint already consumed: ${request.locator}`);
    }
    this.#used.add(request.locator);
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
      const bytes = await readBodyWithLimit(response, ZHENGHAN_2027_MAX_RESPONSE_BYTES);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (/<input[^>]+type=["']password["']|验证码|captcha/iu.test(text)) {
        return failed(this.#now(), "INTERACTIVE_ACCESS_DETECTED",
          "Login, password, or CAPTCHA content was detected", false,
          response.status, headers, contentType);
      }
      return {
        status: "SUCCESS",
        responded_at: this.#now(),
        bytes,
        content_sha256: sha256(bytes) as RawContentSha256,
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
}

export class Zhenghan2027OfficialHtmlAdapter implements RecruitmentAdapter {
  readonly descriptor = descriptor;

  validateEndpoint(endpoint: RecruitmentEndpoint): EndpointValidationResult {
    const issues: string[] = [];
    if (endpoint.adapter_key !== descriptor.adapter_key) {
      issues.push(`Endpoint adapter_key must be ${descriptor.adapter_key}`);
    }
    if (endpoint.locator !== ZHENGHAN_2027_ANNOUNCEMENT_URL) {
      issues.push("Endpoint locator must exactly match the approved announcement");
    }
    if (endpoint.request_method !== "GET" || endpoint.content_kind !== "HTML") {
      issues.push("Zhenghan endpoint requires GET HTML");
    }
    if ((endpoint.collection_config.max_pages ?? 0) !== 2
        || endpoint.collection_config.follow_redirects !== false
        || endpoint.collection_config.retry_limit !== 0) {
      issues.push("Zhenghan canary requires two pages, no redirects, and no retries");
    }
    return issues.length === 0
      ? { valid: true, issues: [] }
      : { valid: false, issues };
  }

  plan(endpoint: RecruitmentEndpoint): readonly AdapterRequestPlan[] {
    this.assertEndpoint(endpoint);
    return [ZHENGHAN_2027_ANNOUNCEMENT_URL, ZHENGHAN_2027_DETAIL_URL].map(
      (locator, index) => ({
        recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
        locator,
        method: "GET" as const,
        parameters: {},
        pagination_state: {
          page_index: index + 1,
          cursor: null,
          visited_locators: [locator]
        }
      })
    );
  }

  extract(input: AdapterExtractionInput): readonly ExtractedRecord[] {
    this.assertEndpoint(input.endpoint);
    const rawBlob = this.assertTraceability(input);
    const locator = input.snapshot.request_metadata.locator;
    if (!approvedUrls.has(locator)) throw malformed("Snapshot locator is not approved");
    const html = new TextDecoder("utf-8", { fatal: true }).decode(rawBlob.bytes);
    const $ = cheerio.load(html);
    const title = clean($("h1.entry-title").first().text());
    const expectedTitle = expectedTitles.get(locator);
    if (!expectedTitle || title !== expectedTitle) {
      throw malformed(`Official page title changed: ${title}`);
    }
    const published = clean($("time.entry-date").first().text());
    const content = $("article .entry-content").first();
    if (content.length === 0) throw malformed("Official article body is missing");
    return locator === ZHENGHAN_2027_ANNOUNCEMENT_URL
      ? [announcementRecord(input, title, published, clean(content.text()))]
      : detailRecords(input, $, title, published, content);
  }

  nextPage(_input: AdapterNextPageInput): AdapterRequestPlan | null {
    return null;
  }

  assessCompleteness(input: AdapterCompletenessInput): AdapterCompletenessAssessment {
    if (input.extraction_errors.length > 0) {
      return { status: "FAILED", reason_codes: ["HTML_EXTRACTION_ERROR"] };
    }
    const locators = new Set(input.snapshots.map((snapshot) => {
      return snapshot.request_metadata.locator;
    }));
    if (input.snapshots.length !== 2
        || ![...approvedUrls].every((locator) => locators.has(locator))) {
      return { status: "PARTIAL", reason_codes: ["APPROVED_PAGE_MISSING"] };
    }
    const sourceIds = new Set(input.records.map((record) => record.raw_source_record_id));
    const expected = [
      "post-2782:announcement-package",
      "post-2790:dispute-resolution-lawyer",
      "post-2790:campus-long-term-intern-2027",
      "post-2790:short-term-intern-2028-plus"
    ];
    if (input.records.length !== expected.length
        || expected.some((id) => !sourceIds.has(id))) {
      return { status: "PARTIAL", reason_codes: ["POSITION_SET_INCOMPLETE"] };
    }
    return { status: "COMPLETE", reason_codes: ["TWO_APPROVED_PAGES_COMPLETE"] };
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
      throw malformed("Zhenghan adapter accepts HTML only");
    }
    return rawBlob;
  }
}

export function assertZhenghan2027ApprovedRequest(request: HttpTransportRequest) {
  if (!approvedUrls.has(request.locator)
      || new URL(request.locator).hostname !== "www.zhenghan.com") {
    throw new Error("Request is outside the exact approved Zhenghan URLs");
  }
  if (request.recruitment_endpoint_id !== ZHENGHAN_2027_RECRUITMENT_ENDPOINT_ID) {
    throw new Error("Request endpoint reference is not approved");
  }
  if (request.method !== "GET" || request.timeout_ms !== ZHENGHAN_2027_TIMEOUT_MS) {
    throw new Error("Approved Zhenghan request requires fixed GET and timeout");
  }
  if (Object.keys(request.headers).length > 0
      || Object.keys(request.parameters).length > 0) {
    throw new Error("Approved Zhenghan request rejects headers and parameters");
  }
  return request;
}

export function createZhenghan2027SourceVersions(input: {
  readonly observed_at: string;
  readonly provenance: ProductionPersistenceProvenance;
}): readonly SourcePersistenceVersion[] {
  const organization = {
    organization_id: "organization-cn-zhenghan-law-firm" as never,
    name: traceable("上海虹桥正瀚律师事务所"),
    aliases: [traceable("虹桥正瀚")],
    country_code: "CN"
  } as const;
  const source: SourceDefinition = {
    source_definition_id: ZHENGHAN_2027_SOURCE_DEFINITION_ID,
    publisher_organization_id: organization.organization_id,
    name: traceable("虹桥正瀚2027届校园招聘官方页面"),
    publisher_kind: "LAW_FIRM",
    authority_level: "OFFICIAL",
    scope: "SINGLE_ORGANIZATION",
    enabled: true
  };
  const endpoint = createZhenghan2027RecruitmentEndpoint();
  const admission = createZhenghan2027SourceAdmission(input.observed_at);
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
  for (const [suffix, path, purpose] of [
    ["announcement", "/news/2782.html", "2027_RECRUITMENT_ANNOUNCEMENT"],
    ["detail", "/news/2790.html", "2027_RECRUITMENT_DETAIL"]
  ] as const) {
    append({
      kind: "OFFICIAL_ENDPOINT_ALLOWLIST",
      payload: {
        allowlist_entry_id: `allowlist-cn-zhenghan-2027-${suffix}`,
        recruitment_endpoint_artifact_id: endpointVersion.artifact_id,
        source_admission_artifact_id: admissionVersion.artifact_id,
        active: true,
        scheme: "https",
        host: "www.zhenghan.com",
        port: null,
        path_prefix: path,
        exact_path: true,
        allowed_method: "GET",
        query_policy: { mode: "DENY_ALL", allowed_parameters: [] },
        endpoint_purpose: purpose,
        authority_level: "OFFICIAL",
        approval_evidence_ids: admission.evidence.map((item) => {
          return item.source_admission_evidence_id;
        })
      }
    });
  }
  return versions;
}

export function createZhenghan2027RecruitmentEndpoint(): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: ZHENGHAN_2027_RECRUITMENT_ENDPOINT_ID,
    source_definition_id: ZHENGHAN_2027_SOURCE_DEFINITION_ID,
    name: traceable("虹桥正瀚2027届校园招聘公告及岗位详情"),
    description: traceable("仅限已批准的 2782 公告页与 2790 招聘详情页"),
    coverage_regions: [
      { raw_text: original("上海") },
      { raw_text: original("广州") }
    ],
    locator: ZHENGHAN_2027_ANNOUNCEMENT_URL,
    request_method: "GET",
    content_kind: "HTML",
    adapter_key: ZHENGHAN_2027_ADAPTER_KEY,
    decoded_text_encoding: UTF8_TEXT_ENCODING,
    collection_config: {
      timeout_ms: ZHENGHAN_2027_TIMEOUT_MS,
      max_items: 4,
      max_pages: 2,
      follow_redirects: false,
      retry_limit: 0
    },
    enabled: true
  };
}

export function createZhenghan2027SourceAdmission(observedAt: string): SourceAdmission {
  const robotsId = "evidence-zhenghan-2027-robots-unreviewed" as SourceAdmissionEvidenceId;
  const termsId = "evidence-zhenghan-2027-terms-unreviewed" as SourceAdmissionEvidenceId;
  const inspectionId = "evidence-zhenghan-2027-exact-endpoints" as SourceAdmissionEvidenceId;
  const approvalId = "evidence-zhenghan-2027-user-approval" as SourceAdmissionEvidenceId;
  const evidence = [
    sourceEvidence(robotsId, "ROBOTS", "UNKNOWN", observedAt,
      "robots.txt was not accessed because it is outside the approved exact paths"),
    sourceEvidence(termsId, "TERMS", "UNKNOWN", observedAt,
      "No separate terms page was accessed; the canary remains human-reviewed Level B"),
    sourceEvidence(inspectionId, "ENDPOINT_INSPECTION", "ALLOWED", observedAt,
      "The approved pages are public HTTPS HTML endpoints without login or CAPTCHA"),
    sourceEvidence(approvalId, "MANUAL_REVIEW", "ALLOWED", observedAt,
      `User approved only ${ZHENGHAN_2027_ANNOUNCEMENT_URL} and ${ZHENGHAN_2027_DETAIL_URL}`)
  ];
  return {
    source_admission_id: ZHENGHAN_2027_SOURCE_ADMISSION_ID,
    admission_level: "B",
    automation_basis: "HUMAN_REVIEWED_CANARY",
    source_name: traceable("虹桥正瀚2027届校园招聘官方页面"),
    source_type: "OFFICIAL_RECRUITMENT_PAGE",
    official_owner: traceable("上海虹桥正瀚律师事务所"),
    endpoint: ZHENGHAN_2027_ANNOUNCEMENT_URL,
    recruitment_endpoint_id: ZHENGHAN_2027_RECRUITMENT_ENDPOINT_ID,
    endpoint_purpose: "RECRUITMENT_NOTICE",
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
        "review-zhenghan-2027-user-approved-canary" as SourceAdmissionReviewId,
      reviewer: "user-approved-canary",
      reviewed_at: observedAt,
      decision: "APPROVED",
      rationale: original(
        "One real 2027 official-source canary is approved for exactly two public pages"
      ),
      evidence_ids: evidence.map((item) => item.source_admission_evidence_id)
    }],
    admission_decision: "APPROVED"
  };
}

export function zhenghanSourceRole(record: ExtractedRecord) {
  return record.raw_source_record_id === "post-2782:announcement-package"
    ? "PACKAGE" as const
    : "POSITION_BEARING" as const;
}

function announcementRecord(
  input: AdapterExtractionInput,
  title: string,
  published: string,
  body: string
): ExtractedRecord {
  return baseRecord(input, {
    id: "post-2782:announcement-package",
    title,
    locations: ["上海"],
    description: body,
    requirement: null,
    announcementUrl: ZHENGHAN_2027_ANNOUNCEMENT_URL,
    published,
    year: "2027",
    batch: "2027届校园招聘",
    selector: "article#post-2782 .entry-content",
    positionIdentity: null
  });
}

function detailRecords(
  input: AdapterExtractionInput,
  $: ReturnType<typeof cheerio.load>,
  _title: string,
  published: string,
  content: ReturnType<ReturnType<typeof cheerio.load>>
): readonly ExtractedRecord[] {
  const positions = [
    {
      id: "post-2790:dispute-resolution-lawyer",
      heading: "争议解决律师",
      title: "争议解决律师",
      locations: ["广州"],
      year: null,
      batch: "社会招聘",
      description: "社招岗位；商事争议解决律师。"
    },
    {
      id: "post-2790:campus-long-term-intern-2027",
      heading: "长期实习生",
      title: "长期实习生（2027届校招，留用岗位：培训生）",
      locations: ["上海", "广州"],
      year: "2027",
      batch: "2027届校园招聘",
      description: "校招岗位；有留用机会；留用岗位为培训生。"
    },
    {
      id: "post-2790:short-term-intern-2028-plus",
      heading: "短期实习生",
      title: "短期实习生（2028届及之后，无留用机会）",
      locations: ["上海", "广州"],
      year: "2028",
      batch: "2028届及之后实习招聘",
      description: "校招实习岗位；无留用机会。"
    }
  ] as const;
  return positions.map((position) => {
    const section = sectionForHeading($, content, position.heading);
    const requirement = section.filter((text) => /^\d+[.．]/u.test(text)).join("\n");
    if (!requirement) throw malformed(`${position.heading} requirement section is missing`);
    return baseRecord(input, {
      id: position.id,
      title: position.title,
      locations: [...position.locations],
      description: `${position.description}\n${section.filter((text) => {
        return !/^\d+[.．]/u.test(text);
      }).join("\n")}`.trim(),
      requirement,
      announcementUrl: ZHENGHAN_2027_DETAIL_URL,
      published,
      year: position.year,
      batch: position.batch,
      selector: `article#post-2790 .entry-content > h3:contains("${position.heading}")`,
      positionIdentity: position.id
    });
  });
}

function baseRecord(input: AdapterExtractionInput, data: {
  readonly id: string;
  readonly title: string;
  readonly locations: readonly string[];
  readonly description: string;
  readonly requirement: string | null;
  readonly announcementUrl: string;
  readonly published: string;
  readonly year: string | null;
  readonly batch: string;
  readonly selector: string;
  readonly positionIdentity: string | null;
}): ExtractedRecord {
  const packageRecord = data.positionIdentity === null;
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
      value: data.announcementUrl,
      confidence: "HIGH"
    }],
    raw_source_record_id: data.id,
    raw_title: original(data.title),
    raw_organization_name: original("上海虹桥正瀚律师事务所"),
    raw_location_text: data.locations.map(original),
    raw_description: original(data.description),
    ...(data.requirement ? { raw_requirement_text: original(data.requirement) } : {}),
    announcement_url: data.announcementUrl,
    publish_time: original(data.published),
    ...(data.year ? { recruitment_year: original(data.year) } : {}),
    recruitment_batch: original(data.batch),
    ...(!packageRecord ? {
      recruitment_context: {
          announcement: confirmedIdentity(
            "zhenghan-news-2782", "official:zhenghan:news", "h1.entry-title"
          ),
          recruitment_plan: provisionalIdentity(
            "zhenghan-2027-campus-recruitment", "article#post-2782 .entry-content"
          ),
          recruitment_batch: data.year
            ? {
                applicability: "APPLICABLE",
                identity: provisionalIdentity(data.batch, data.selector)
              }
            : { applicability: "NOT_APPLICABLE" },
          position: provisionalIdentity(data.positionIdentity!, data.selector),
          opportunity: provisionalIdentity(`${data.positionIdentity}:opportunity`, data.selector)
      }
    } : {}),
    source_record_locator: {
      kind: "HTML",
      selector: data.selector,
      path: data.id
    },
    adapter_metadata: {
      [ZHENGHAN_2027_ADAPTER_KEY]: {
        approved_announcement_url: ZHENGHAN_2027_ANNOUNCEMENT_URL,
        approved_detail_url: ZHENGHAN_2027_DETAIL_URL,
        source_role: packageRecord ? "PACKAGE" : "POSITION_BEARING",
        source_record_id: data.id
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

function sectionForHeading(
  $: ReturnType<typeof cheerio.load>,
  content: ReturnType<ReturnType<typeof cheerio.load>>,
  heading: string
) {
  const children = content.children().toArray();
  const start = children.findIndex((node) => {
    return $(node).is("h3") && clean($(node).text()) === heading;
  });
  if (start < 0) throw malformed(`Position heading is missing: ${heading}`);
  const result: string[] = [];
  for (let index = start + 1; index < children.length; index += 1) {
    const node = children[index]!;
    if ($(node).is("h2,h3")) break;
    const text = clean($(node).text());
    if (text) result.push(text);
  }
  return result;
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
    source_admission_id: ZHENGHAN_2027_SOURCE_ADMISSION_ID,
    endpoint: ZHENGHAN_2027_ANNOUNCEMENT_URL,
    source_url: ZHENGHAN_2027_ANNOUNCEMENT_URL,
    kind,
    locator: ZHENGHAN_2027_APPROVAL_REFERENCE,
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
