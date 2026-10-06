import dns from "node:dns/promises";
import https from "node:https";
import type { ClientRequest } from "node:http";
import { createHash } from "node:crypto";
import { publicDiscoveryAddress, safeDiscoveryUrl } from "../safety";
import type { DirectoryResponse } from "../discovery-root";

export class DirectoryHttpFailure extends Error {
  constructor(readonly reason_code: string, readonly received_bytes: number) { super(reason_code); }
}

export async function prepareDirectoryHttpRequest(exactUrl: string, maximumBytes: number, timeoutMilliseconds: number) {
  const url = new URL(safeDiscoveryUrl(exactUrl));
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 2097152
    || !Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 60000) {
    throw new Error("DISCOVERY_HTTP_BUDGET_INVALID");
  }
  const deadline = Date.now() + timeoutMilliseconds;
  const addresses = await Promise.race([
    dns.resolve4(url.hostname),
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("DISCOVERY_DNS_TIMEOUT")), timeoutMilliseconds);
      timer.unref();
    })
  ]);
  if (!addresses.length || addresses.some(address => !publicDiscoveryAddress(address))) throw new Error("DISCOVERY_DNS_DENIED");
  const pinned = [...addresses].sort()[0]!;
  let used = false;
  return Object.freeze({ exact_url: exactUrl, addresses: Object.freeze([...addresses]),
    async execute(): Promise<DirectoryResponse> {
      if (used) throw new Error("DISCOVERY_HTTP_REQUEST_ALREADY_USED");
      used = true;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("DISCOVERY_HTTP_TIMEOUT");
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), remaining);
        let request: ClientRequest;
        let receivedBytes = 0;
        const fail = (reason: string) => { clearTimeout(timer); reject(new DirectoryHttpFailure(reason, receivedBytes)); };
        try {
          const options: https.RequestOptions & { autoSelectFamily: false } = { method: "GET", agent: false, family: 4, autoSelectFamily: false, signal: controller.signal,
            rejectUnauthorized: true, servername: url.hostname,
            headers: { Accept: "text/html", "Accept-Encoding": "identity", "User-Agent": "LawJobRadar-Discovery/1.0" },
            lookup: (_hostname, _options, callback) => callback(null, pinned, 4) };
          request = https.request(url, options, response => {
            const chunks: Buffer[] = [];
            let size = 0;
            response.on("data", (chunk: Buffer) => {
              size += chunk.length;
              receivedBytes = size;
              if (size > maximumBytes) { request.destroy(new Error("DISCOVERY_HTTP_RESPONSE_TOO_LARGE")); return; }
              chunks.push(chunk);
            });
            response.on("error", () => fail("DISCOVERY_HTTP_RESPONSE_FAILED"));
            response.on("end", () => {
              clearTimeout(timer);
              if (size > maximumBytes) return;
              const bytes = Buffer.concat(chunks);
              try {
                const contentType = response.headers["content-type"] ?? "";
                if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity"
                  || /charset\s*=\s*(?!utf-8\b|utf8\b|us-ascii\b)[^;\s]+/i.test(contentType)) {
                  throw new Error("DISCOVERY_HTTP_ENCODING_UNSUPPORTED");
                }
                resolve({ http_status: response.statusCode ?? 0, final_url: exactUrl,
                  addresses: [...addresses], content_type: contentType,
                  body: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
                  response_set_cookie_present: response.headers["set-cookie"] !== undefined,
                  received_byte_length: bytes.length,
                  content_sha256: createHash("sha256").update(bytes).digest("hex") });
              } catch { fail("DISCOVERY_HTTP_ENCODING_UNSUPPORTED"); }
            });
          });
        } catch { fail("DISCOVERY_HTTP_REQUEST_FAILED"); return; }
        request.on("error", error => fail(error.message === "DISCOVERY_HTTP_RESPONSE_TOO_LARGE"
          ? error.message : "DISCOVERY_HTTP_REQUEST_FAILED"));
        request.end();
      });
    }
  });
}
