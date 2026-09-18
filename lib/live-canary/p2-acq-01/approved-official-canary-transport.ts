import { createHash } from "node:crypto";

import type { HttpTransportRequest } from "../../collection-runtime";
import type {
  IsoDateTime,
  RawContentSha256,
  TransportHeaders,
  TransportResponse
} from "../../ingestion";
import {
  BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_MAX_RESPONSE_BYTES,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_TIMEOUT_MS,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID
} from "../p2-04d/beijing-public-institution-detail-live-canary";

export const P2_ACQ_01_NETWORK_POLICY = {
  policy_id: "P2_ACQ_01_APPROVED_OFFICIAL_CANARY",
  scheme: "https:",
  host: "www.beijing.gov.cn",
  port: "",
  path: "/gongkai/rsxx/sydwzp/202606/t20260625_4714884.html",
  method: "GET",
  query: "",
  redirects: "DENY",
  retry_limit: 0,
  request_budget: 1,
  cookies: "DENY",
  credentials: "DENY"
} as const;

export const P2_ACQ_01_HTML_TIMEOUT_MS =
  BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_TIMEOUT_MS;

const sensitiveHeader = /authorization|cookie|proxy-authorization|token|password|secret|session|api[_-]?key/iu;

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface P2Acq01TransportResult {
  readonly response: TransportResponse;
  readonly request_count: 1;
  readonly final_url: string;
  readonly redirect_rejected: boolean;
  readonly elapsed_ms: number;
  readonly response_size: number;
}

export class P2Acq01NetworkPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "P2Acq01NetworkPolicyError";
  }
}

export class P2Acq01ApprovedOfficialCanaryTransport {
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

  async execute(request: HttpTransportRequest): Promise<P2Acq01TransportResult> {
    assertP2Acq01ApprovedRequest(request);
    if (this.#used) {
      throw new P2Acq01NetworkPolicyError(
        "P2-ACQ-01 request budget is exhausted"
      );
    }
    this.#used = true;

    const startedAt = this.#monotonicNow();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeout_ms);
    try {
      const response = await this.#fetch(BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT, {
        method: "GET",
        headers: { accept: "text/html,application/xhtml+xml" },
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      });
      const headers = safeHeaders(response.headers);
      const finalUrl = response.url || BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT;
      if (response.redirected || finalUrl !== BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT) {
        await response.body?.cancel();
        return failed({
          now: this.#now(),
          code: "FINAL_URL_CHANGED",
          message: `Final URL is outside the exact approved endpoint: ${finalUrl}`,
          httpStatus: response.status,
          headers,
          mimeType: response.headers.get("content-type"),
          finalUrl,
          redirectRejected: true,
          elapsedMs: elapsed(startedAt, this.#monotonicNow())
        });
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        return failed({
          now: this.#now(),
          code: "REDIRECT_REJECTED",
          message: "Redirect response was not followed",
          httpStatus: response.status,
          headers,
          mimeType: response.headers.get("content-type"),
          finalUrl,
          redirectRejected: true,
          elapsedMs: elapsed(startedAt, this.#monotonicNow())
        });
      }
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel();
        return failed({
          now: this.#now(),
          code: `HTTP_${response.status}`,
          message: `HTTP status ${response.status}`,
          httpStatus: response.status,
          headers,
          mimeType: response.headers.get("content-type"),
          finalUrl,
          redirectRejected: false,
          elapsedMs: elapsed(startedAt, this.#monotonicNow())
        });
      }
      const contentType = response.headers.get("content-type");
      if (!contentType?.toLowerCase().startsWith("text/html")) {
        await response.body?.cancel();
        return failed({
          now: this.#now(),
          code: "NON_HTML_RESPONSE",
          message: `Expected HTML but received ${contentType ?? "no Content-Type"}`,
          httpStatus: response.status,
          headers,
          mimeType: contentType,
          finalUrl,
          redirectRejected: false,
          elapsedMs: elapsed(startedAt, this.#monotonicNow())
        });
      }

      const declaredLength = contentLength(response.headers.get("content-length"));
      if (declaredLength !== null
          && declaredLength > BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_MAX_RESPONSE_BYTES) {
        await response.body?.cancel();
        return failed({
          now: this.#now(),
          code: "RESPONSE_SIZE_LIMIT",
          message: "Declared response size exceeds the fixed Canary budget",
          httpStatus: response.status,
          headers,
          mimeType: contentType,
          finalUrl,
          redirectRejected: false,
          elapsedMs: elapsed(startedAt, this.#monotonicNow())
        });
      }
      const bytes = await readBodyWithLimit(
        response,
        BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_MAX_RESPONSE_BYTES
      );
      return {
        response: {
          status: "SUCCESS",
          responded_at: this.#now(),
          bytes,
          content_sha256: sha256(bytes),
          mime_type: contentType,
          http_status: response.status,
          headers
        },
        request_count: 1,
        final_url: finalUrl,
        redirect_rejected: false,
        elapsed_ms: elapsed(startedAt, this.#monotonicNow()),
        response_size: bytes.byteLength
      };
    } catch (error) {
      return failed({
        now: this.#now(),
        code: error instanceof DOMException && error.name === "AbortError"
          ? "TIMEOUT"
          : "ACQUISITION_FAILED",
        message: error instanceof Error ? error.message : "Unknown acquisition failure",
        httpStatus: null,
        headers: {},
        mimeType: null,
        finalUrl: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
        redirectRejected: false,
        elapsedMs: elapsed(startedAt, this.#monotonicNow())
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function assertP2Acq01ApprovedRequest(request: HttpTransportRequest) {
  let locator: URL;
  try {
    locator = new URL(request.locator);
  } catch {
    throw new P2Acq01NetworkPolicyError("P2-ACQ-01 requires an absolute URL");
  }
  if (locator.protocol !== P2_ACQ_01_NETWORK_POLICY.scheme
      || locator.hostname !== P2_ACQ_01_NETWORK_POLICY.host
      || locator.port !== P2_ACQ_01_NETWORK_POLICY.port
      || locator.pathname !== P2_ACQ_01_NETWORK_POLICY.path
      || locator.search !== P2_ACQ_01_NETWORK_POLICY.query
      || locator.hash !== ""
      || locator.username !== ""
      || locator.password !== ""
      || locator.href !== BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT) {
    throw new P2Acq01NetworkPolicyError(
      "P2-ACQ-01 rejects URLs outside the exact approved HTTPS endpoint"
    );
  }
  if (request.recruitment_endpoint_id
      !== BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID) {
    throw new P2Acq01NetworkPolicyError("P2-ACQ-01 endpoint reference is not approved");
  }
  if (request.method !== "GET") {
    throw new P2Acq01NetworkPolicyError("P2-ACQ-01 permits GET only");
  }
  if (request.timeout_ms !== P2_ACQ_01_HTML_TIMEOUT_MS) {
    throw new P2Acq01NetworkPolicyError("P2-ACQ-01 timeout must match policy");
  }
  if (Object.keys(request.parameters).length > 0) {
    throw new P2Acq01NetworkPolicyError("P2-ACQ-01 rejects query parameters");
  }
  if (Object.keys(request.headers).length > 0
      || Object.keys(request.headers).some((name) => sensitiveHeader.test(name))) {
    throw new P2Acq01NetworkPolicyError(
      "P2-ACQ-01 rejects caller headers, cookies, and credentials"
    );
  }
  return request;
}

function failed(input: {
  readonly now: IsoDateTime;
  readonly code: string;
  readonly message: string;
  readonly httpStatus: number | null;
  readonly headers: TransportHeaders;
  readonly mimeType: string | null;
  readonly finalUrl: string;
  readonly redirectRejected: boolean;
  readonly elapsedMs: number;
}): P2Acq01TransportResult {
  return {
    response: {
      status: "FAILED",
      responded_at: input.now,
      http_status: input.httpStatus,
      headers: input.headers,
      mime_type: input.mimeType,
      error: {
        code: input.code,
        message: input.message,
        retryable: false
      }
    },
    request_count: 1,
    final_url: input.finalUrl,
    redirect_rejected: input.redirectRejected,
    elapsed_ms: input.elapsedMs,
    response_size: 0
  };
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
      await reader.cancel("P2-ACQ-01 response budget exceeded");
      throw new Error(`Response exceeds ${maximumBytes} byte budget`);
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

function safeHeaders(headers: Headers): TransportHeaders {
  return Object.fromEntries([...headers.entries()].filter(([name]) => {
    return name.toLowerCase() !== "set-cookie" && !sensitiveHeader.test(name);
  }));
}

function contentLength(value: string | null) {
  return value && /^\d+$/u.test(value) ? Number(value) : null;
}

function elapsed(startedAt: number, endedAt: number) {
  return Math.max(0, Math.round(endedAt - startedAt));
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex") as RawContentSha256;
}
