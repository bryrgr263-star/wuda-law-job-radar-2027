import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";

import type { RawContentSha256, TransportHeaders, TransportResponse } from "../ingestion";
import { assertLocalHttpEgressAllowed, type LocalHttpEgressPolicy } from "./local-egress-policy";
import type { HttpTransport, HttpTransportRequest } from "./types";

const sensitiveName = /authorization|cookie|token|password|secret|session|api[_-]?key/iu;

export class LocalHttpTransport implements HttpTransport {
  readonly #egressPolicy: LocalHttpEgressPolicy;
  readonly #now: () => string;

  constructor(egressPolicy: LocalHttpEgressPolicy, options: { readonly now?: () => string } = {}) {
    this.#egressPolicy = egressPolicy;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async execute(request: HttpTransportRequest): Promise<TransportResponse> {
    let url: URL;
    try {
      url = appendParameters(assertLocalHttpEgressAllowed(this.#egressPolicy, request.locator), request.parameters);
      validateRequestHeaders(request.headers);
    } catch (error) {
      return failed(this.#now(), "EGRESS_DENIED", message(error), false);
    }

    return new Promise((resolve) => {
      const client = url.protocol === "https:" ? https : http;
      const activeRequest = client.request(url, {
        method: request.method ?? "GET",
        headers: request.headers,
        timeout: request.timeout_ms
      }, (response) => {
        const chunks: Uint8Array[] = [];
        response.on("data", (chunk: Uint8Array) => chunks.push(new Uint8Array(chunk)));
        response.on("error", (error) => resolve(failed(
          this.#now(), "RESPONSE_STREAM_ERROR", message(error), true, response.statusCode ?? null, headers(response.headers), mimeType(response.headers)
        )));
        response.on("end", () => {
          const bytes = concat(chunks);
          const httpStatus = response.statusCode ?? null;
          if (httpStatus === null || httpStatus < 200 || httpStatus >= 300) {
            resolve(failed(
              this.#now(), httpFailureCode(httpStatus), `HTTP status ${httpStatus ?? "unknown"}`,
              isRetryableHttpStatus(httpStatus), httpStatus, headers(response.headers), mimeType(response.headers)
            ));
            return;
          }
          resolve({
            status: "SUCCESS",
            responded_at: this.#now() as TransportResponse["responded_at"],
            bytes,
            content_sha256: createHash("sha256").update(bytes).digest("hex") as RawContentSha256,
            mime_type: mimeType(response.headers) ?? "application/octet-stream",
            http_status: httpStatus,
            headers: headers(response.headers)
          });
        });
      });
      activeRequest.once("timeout", () => activeRequest.destroy(Object.assign(
        new Error(`Request timed out after ${request.timeout_ms}ms`), { code: "ETIMEDOUT" }
      )));
      activeRequest.once("error", (error: NodeJS.ErrnoException) => resolve(failed(
        this.#now(), error.code === "ETIMEDOUT" ? "TIMEOUT" : "NETWORK_ERROR",
        message(error), true
      )));
      if (request.body) activeRequest.write(request.body);
      activeRequest.end();
    });
  }
}

function appendParameters(url: URL, parameters: HttpTransportRequest["parameters"]) {
  const copy = new URL(url);
  for (const [name, rawValue] of Object.entries(parameters)) {
    if (sensitiveName.test(name)) throw new Error(`P2-03 request rejects sensitive parameter: ${name}`);
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) copy.searchParams.append(name, String(value));
  }
  return copy;
}

function validateRequestHeaders(requestHeaders: TransportHeaders) {
  for (const [name, value] of Object.entries(requestHeaders)) {
    if (sensitiveName.test(name) || /^bearer\s/iu.test(value)) {
      throw new Error(`P2-03 request rejects sensitive header: ${name}`);
    }
  }
}

function headers(input: http.IncomingHttpHeaders): TransportHeaders {
  return Object.fromEntries(Object.entries(input).flatMap(([name, value]) => {
    if (sensitiveName.test(name)) return [];
    return [[name, Array.isArray(value) ? value.join(", ") : value ?? ""]] as const;
  }));
}

function mimeType(input: http.IncomingHttpHeaders) {
  const value = input["content-type"];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function concat(chunks: readonly Uint8Array[]) {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function failed(
  respondedAt: string,
  code: string,
  errorMessage: string,
  retryable: boolean,
  httpStatus: number | null = null,
  responseHeaders: TransportHeaders = {},
  contentType: string | null = null
): TransportResponse {
  return {
    status: "FAILED",
    responded_at: respondedAt as TransportResponse["responded_at"],
    http_status: httpStatus,
    headers: responseHeaders,
    mime_type: contentType,
    error: { code, message: errorMessage, retryable }
  };
}

function isRetryableHttpStatus(status: number | null) {
  return status === 408 || status === 429 || (status !== null && status >= 500);
}

function httpFailureCode(status: number | null) {
  return status === 429 ? "RATE_LIMITED" : status !== null && status >= 500 ? "HTTP_SERVER_ERROR" : "HTTP_CLIENT_ERROR";
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Unknown HTTP Transport error";
}
