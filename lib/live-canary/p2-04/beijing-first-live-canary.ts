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
  type Snapshot,
  type SnapshotId,
  type TransportHeaders,
  type TransportResponse
} from "../../ingestion";
import {
  BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT,
  BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID,
  BEIJING_PUBLIC_INSTITUTION_SOURCE_ADMISSION_ID
} from "./beijing-canary-authorization-preparation";

export const BEIJING_FIRST_CANARY_REVIEWER = "human-approved-by-user";
export const BEIJING_FIRST_CANARY_SCOPE = "ONE_ENDPOINT_ONE_RUN";
export const BEIJING_FIRST_CANARY_TIMEOUT_MS = 10_000;
export const BEIJING_FIRST_CANARY_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const sourceUrl = "https://www.beijing.gov.cn/";
const robotsLocator = "https://www.beijing.gov.cn/robots.txt";
const termsLocator = "https://www.beijing.gov.cn/";
const sensitiveHeaderName = /authorization|cookie|token|password|secret|session|api[_-]?key/iu;

export interface HumanReviewedCanaryEvidence {
  readonly evidence_id: SourceAdmissionEvidenceId;
  readonly evidence_type: "HUMAN_REVIEWED_CANARY";
  readonly source_url: string;
  readonly observed_at: IsoDateTime;
  readonly reviewer: string;
  readonly observation: string;
  readonly decision: "APPROVED_FOR_ONE_ENDPOINT_ONE_RUN";
}

export interface BeijingLiveCanaryApprovalBundle {
  readonly initial_admission: SourceAdmission;
  readonly approved_admission: SourceAdmission;
  readonly recruitment_endpoint: RecruitmentEndpoint;
  readonly authorization: LiveCanaryManualAuthorization;
  readonly execution: LiveCanaryExecutionRequest;
  readonly evidence: HumanReviewedCanaryEvidence;
  readonly authorization_decision: Extract<LiveCanaryAuthorizationDecision, { allowed: true }>;
  readonly authorization_gate: InMemoryLiveCanaryAuthorizationGate;
}

export interface BeijingLiveCanaryTransportResult {
  readonly response: TransportResponse;
  readonly final_url: string;
  readonly redirect_location: string | null;
  readonly request_count: 1;
  readonly response_size: number;
  readonly response_content_type: string | null;
}

export interface BeijingHtmlDiagnostic {
  readonly encoding: string;
  readonly page_title: string | null;
  readonly document_language: string | null;
  readonly anchor_count: number;
  readonly date_samples: readonly string[];
  readonly list_like_containers: readonly {
    readonly tag: string;
    readonly id: string | null;
    readonly class_name: string | null;
    readonly item_count: number;
    readonly link_count: number;
  }[];
  readonly recruitment_link_samples: readonly {
    readonly text: string;
    readonly href: string;
    readonly parent_tag: string;
    readonly parent_class: string | null;
  }[];
  readonly password_input_observed: boolean;
  readonly captcha_marker_observed: boolean;
  readonly anti_bot_marker_observed: boolean;
}

export interface BeijingFirstLiveCanaryResult {
  readonly approval: BeijingLiveCanaryApprovalBundle;
  readonly request: HttpTransportRequest;
  readonly transport: BeijingLiveCanaryTransportResult;
  readonly raw_blob: RawBlob | null;
  readonly snapshot: Snapshot;
  readonly html_diagnostic: BeijingHtmlDiagnostic | null;
  readonly authorization_replay_decision: LiveCanaryAuthorizationDecision;
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export function createBeijingLiveCanaryApproval(
  issuedAt: IsoDateTime,
  reviewer = BEIJING_FIRST_CANARY_REVIEWER
): BeijingLiveCanaryApprovalBundle {
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
    source_admission_id: BEIJING_PUBLIC_INSTITUTION_SOURCE_ADMISSION_ID,
    endpoint: BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT,
    source_url: BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT,
    kind: "MANUAL_REVIEW",
    locator: `manual://p2-04/${approvalEvidenceId}`,
    captured_at: issuedAt,
    reviewer,
    decision: "ALLOWED",
    summary: original(
      "官方公开招聘页面；robots=ALLOWED；terms=UNKNOWN；本次仅进行人工批准的一次性受控 Canary。"
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
          "人工仅批准该精确 Endpoint 的 ONE_ENDPOINT_ONE_RUN P2-04 Canary；不授予长期或批量权限。"
        ),
        evidence_ids: [approvalEvidenceId]
      }
    ]
  });

  const recruitmentEndpoint = createBeijingDiagnosticEndpoint();
  const collectionRunId = `p2-04-run:${randomUUID()}` as LiveCanaryCollectionRunId;
  const authorization: LiveCanaryManualAuthorization = {
    authorization_id: `p2-04-authorization:${randomUUID()}` as LiveCanaryManualAuthorization["authorization_id"],
    source_admission_id: BEIJING_PUBLIC_INSTITUTION_SOURCE_ADMISSION_ID,
    endpoint: BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT,
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID,
    endpoint_purpose: "JOB_LIST",
    allowed_http_method: "GET",
    collection_run_id: collectionRunId,
    reviewer,
    issued_at: issuedAt,
    evidence_id: approvalEvidenceId,
    scope: BEIJING_FIRST_CANARY_SCOPE,
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
      `Human-approved Canary authorization was denied: ${authorizationDecision.reason_codes.join(", ")}`
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
      source_url: BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT,
      observed_at: issuedAt,
      reviewer,
      observation:
        "官方公开招聘页面；robots=ALLOWED；terms=UNKNOWN；本次仅进行人工批准的一次性受控 Canary",
      decision: "APPROVED_FOR_ONE_ENDPOINT_ONE_RUN"
    },
    authorization_decision: authorizationDecision,
    authorization_gate: authorizationGate
  };
}

export class OneEndpointOneRunLiveCanaryTransport {
  readonly #fetch: FetchImplementation;
  readonly #now: () => IsoDateTime;
  #used = false;

  constructor(
    fetchImplementation: FetchImplementation,
    options: { readonly now?: () => IsoDateTime } = {}
  ) {
    this.#fetch = fetchImplementation;
    this.#now = options.now ?? (() => new Date().toISOString() as IsoDateTime);
  }

  async execute(request: HttpTransportRequest): Promise<BeijingLiveCanaryTransportResult> {
    validateLiveRequest(request);
    if (this.#used) {
      throw new Error("ONE_ENDPOINT_ONE_RUN transport has already been consumed");
    }
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
      const responseHeaders = safeResponseHeaders(response.headers);
      const contentType = response.headers.get("content-type");
      const finalUrl = response.url || request.locator;
      const redirectLocation = response.headers.get("location");

      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        return failedResult(
          this.#now(),
          "UNAUTHORIZED_REDIRECT",
          `Redirect was not followed: ${redirectLocation ?? "missing Location"}`,
          response.status,
          responseHeaders,
          contentType,
          finalUrl,
          redirectLocation
        );
      }
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel();
        return failedResult(
          this.#now(),
          httpFailureCode(response.status),
          `HTTP status ${response.status}`,
          response.status,
          responseHeaders,
          contentType,
          finalUrl,
          null
        );
      }
      if (!contentType?.toLowerCase().startsWith("text/html")) {
        await response.body?.cancel();
        return failedResult(
          this.#now(),
          "NON_HTML_RESPONSE",
          `Expected HTML but received ${contentType ?? "no Content-Type"}`,
          response.status,
          responseHeaders,
          contentType,
          finalUrl,
          null
        );
      }

      const declaredLength = parseContentLength(response.headers.get("content-length"));
      if (declaredLength !== null && declaredLength > BEIJING_FIRST_CANARY_MAX_RESPONSE_BYTES) {
        await response.body?.cancel();
        return failedResult(
          this.#now(),
          "RESPONSE_SIZE_LIMIT",
          `Declared response size ${declaredLength} exceeds budget`,
          response.status,
          responseHeaders,
          contentType,
          finalUrl,
          null
        );
      }

      const bytes = await readBodyWithLimit(response, BEIJING_FIRST_CANARY_MAX_RESPONSE_BYTES);
      const antiBotReason = detectBlockingContent(bytes, contentType);
      if (antiBotReason) {
        return failedResult(
          this.#now(),
          "BLOCKING_CONTENT_OBSERVED",
          antiBotReason,
          response.status,
          responseHeaders,
          contentType,
          finalUrl,
          null,
          bytes.byteLength
        );
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
        redirect_location: null,
        request_count: 1,
        response_size: bytes.byteLength,
        response_content_type: contentType
      };
    } catch (error) {
      const timeoutFailure = error instanceof DOMException && error.name === "AbortError";
      return failedResult(
        this.#now(),
        timeoutFailure ? "TIMEOUT" : errorCode(error),
        message(error),
        null,
        {},
        null,
        request.locator,
        null
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function runFirstBeijingLiveCanary(
  approval: BeijingLiveCanaryApprovalBundle,
  transport: OneEndpointOneRunLiveCanaryTransport,
  requestedAt: IsoDateTime
): Promise<BeijingFirstLiveCanaryResult> {
  const request: HttpTransportRequest = {
    recruitment_endpoint_id: approval.recruitment_endpoint.recruitment_endpoint_id,
    locator: approval.recruitment_endpoint.locator,
    method: "GET",
    requested_at: requestedAt,
    headers: {},
    parameters: {},
    timeout_ms: BEIJING_FIRST_CANARY_TIMEOUT_MS
  };
  const rawBlobs = new InMemoryRawBlobRepository();
  const snapshots = new InMemorySnapshotRepository();
  const capture = new RawCaptureService(rawBlobs, snapshots, {
    create_snapshot_id: () => `p2-04-snapshot:${randomUUID()}` as SnapshotId
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
      ? diagnoseBeijingHtml(captured.raw_blob.bytes, captured.raw_blob.mime_type)
      : null,
    authorization_replay_decision: replayDecision
  };
}

export function diagnoseBeijingHtml(
  bytes: Uint8Array,
  contentType: string
): BeijingHtmlDiagnostic {
  const encoding = detectEncoding(bytes, contentType);
  const text = new TextDecoder(encoding).decode(bytes);
  const $ = cheerio.load(text);
  const datePattern = /(?:19|20)\d{2}[年\-\/.]\d{1,2}[月\-\/.]\d{1,2}日?/gu;
  const dateSamples = [...new Set(($("body").text().match(datePattern) ?? []).slice(0, 20))];
  const listLikeContainers = $("ul,ol,table").toArray().flatMap((element) => {
    const node = $(element);
    const linkCount = node.find("a[href]").length;
    const itemCount = element.tagName === "table"
      ? node.find("tr").length
      : node.children("li").length;
    if (linkCount < 2 || itemCount < 2) return [];
    return [{
      tag: element.tagName,
      id: node.attr("id") ?? null,
      class_name: node.attr("class") ?? null,
      item_count: itemCount,
      link_count: linkCount
    }];
  }).slice(0, 20);
  const recruitmentLinks = $("a[href]").toArray().flatMap((element) => {
    const node = $(element);
    const linkText = node.text().replace(/\s+/gu, " ").trim();
    const href = node.attr("href")?.trim();
    if (!href || !/(?:招聘|招考|岗位|公告)/u.test(linkText)) return [];
    const parent = node.parent();
    return [{
      text: linkText,
      href,
      parent_tag: parent.prop("tagName")?.toLowerCase() ?? "unknown",
      parent_class: parent.attr("class") ?? null
    }];
  }).slice(0, 20);
  const lowerText = text.toLowerCase();

  return {
    encoding,
    page_title: $("title").first().text().replace(/\s+/gu, " ").trim() || null,
    document_language: $("html").attr("lang") ?? null,
    anchor_count: $("a[href]").length,
    date_samples: dateSamples,
    list_like_containers: listLikeContainers,
    recruitment_link_samples: recruitmentLinks,
    password_input_observed: $("input[type='password']").length > 0,
    captcha_marker_observed: /(?:验证码|captcha)/iu.test(lowerText),
    anti_bot_marker_observed: /(?:访问过于频繁|安全验证|robot check|cloudflare)/iu.test(lowerText)
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
      source_admission_id: BEIJING_PUBLIC_INSTITUTION_SOURCE_ADMISSION_ID,
      endpoint: BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT,
      source_url: sourceUrl,
      kind: "ROBOTS",
      locator: robotsLocator,
      captured_at: observedAt,
      reviewer,
      decision: "ALLOWED",
      summary: original("人工已确认目标招聘路径的 robots 审查结论为 ALLOWED。")
    },
    {
      source_admission_evidence_id: termsEvidenceId,
      source_admission_id: BEIJING_PUBLIC_INSTITUTION_SOURCE_ADMISSION_ID,
      endpoint: BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT,
      source_url: sourceUrl,
      kind: "TERMS",
      locator: termsLocator,
      captured_at: observedAt,
      reviewer,
      decision: "UNKNOWN",
      summary: original("未取得明确自动化访问条款；UNKNOWN 不解释为 ALLOWED。")
    }
  ];
  return {
    source_admission_id: BEIJING_PUBLIC_INSTITUTION_SOURCE_ADMISSION_ID,
    admission_level: "B",
    automation_basis: "ROBOTS_ALLOW",
    source_name: traceable("北京市人民政府事业单位招聘"),
    source_type: "OFFICIAL_RECRUITMENT_PAGE",
    official_owner: traceable("北京市人民政府"),
    endpoint: BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT,
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID,
    endpoint_purpose: "JOB_LIST",
    allowed_http_method: "GET",
    content_kind: "HTML",
    source_authority: "OFFICIAL",
    robots: { status: "ALLOWED", evidence_id: robotsEvidenceId },
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
      rationale: original("robots=ALLOWED、terms=UNKNOWN；等待一次性人工 Canary 批准。"),
      evidence_ids: [robotsEvidenceId, termsEvidenceId]
    }],
    admission_decision: "REVIEW"
  };
}

function createBeijingDiagnosticEndpoint(): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID,
    source_definition_id: "source-cn-beijing-government-public-institution-recruitment" as RecruitmentEndpoint["source_definition_id"],
    name: traceable("北京市事业单位招聘列表"),
    description: traceable("P2-04 单页 Raw/Snapshot 诊断；北京 Adapter 与 selector 尚未创建。"),
    coverage_regions: [{ raw_text: original("北京市") }],
    locator: BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT,
    request_method: "GET",
    content_kind: "HTML",
    adapter_key: "PENDING_BEIJING_OFFICIAL_HTML_ADAPTER",
    decoded_text_encoding: UTF8_TEXT_ENCODING,
    collection_config: {
      timeout_ms: BEIJING_FIRST_CANARY_TIMEOUT_MS,
      max_items: 1,
      max_pages: 1,
      follow_redirects: false,
      retry_limit: 0
    },
    enabled: false
  };
}

function validateLiveRequest(request: HttpTransportRequest) {
  if (request.recruitment_endpoint_id !== BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID) {
    throw new Error("Live Canary RecruitmentEndpoint is not authorized");
  }
  if (request.locator !== BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT) {
    throw new Error("Live Canary locator is not the exact authorized Endpoint");
  }
  if (request.method !== "GET") {
    throw new Error("Live Canary permits GET only");
  }
  if (request.timeout_ms !== BEIJING_FIRST_CANARY_TIMEOUT_MS) {
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
      await reader.cancel("P2-04 response size budget exceeded");
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

function detectBlockingContent(bytes: Uint8Array, contentType: string) {
  const text = new TextDecoder(detectEncoding(bytes, contentType)).decode(bytes);
  if (/<input[^>]+type=["']password["']/iu.test(text)) return "Login form observed";
  if (/(?:验证码|captcha|访问过于频繁|安全验证|robot check|cloudflare)/iu.test(text)) {
    return "CAPTCHA or anti-bot marker observed";
  }
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

function failedResult(
  respondedAt: IsoDateTime,
  code: string,
  errorMessage: string,
  httpStatus: number | null,
  headers: TransportHeaders,
  contentType: string | null,
  finalUrl: string,
  redirectLocation: string | null,
  responseSize = 0
): BeijingLiveCanaryTransportResult {
  return {
    response: {
      status: "FAILED",
      responded_at: respondedAt,
      http_status: httpStatus,
      headers,
      mime_type: contentType,
      error: { code, message: errorMessage, retryable: false }
    },
    final_url: finalUrl,
    redirect_location: redirectLocation,
    request_count: 1,
    response_size: responseSize,
    response_content_type: contentType
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

function errorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String(error.code);
  }
  return "NETWORK_ERROR";
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Live Canary error";
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex") as RawContentSha256;
}

function evidenceId(label: string) {
  return `p2-04-evidence:${label}:${randomUUID()}` as SourceAdmissionEvidenceId;
}

function reviewId(label: string) {
  return `p2-04-review:${label}:${randomUUID()}` as SourceAdmissionReviewId;
}

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}
