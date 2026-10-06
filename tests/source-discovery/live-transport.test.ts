import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { prepareDirectoryHttpRequest } from "../../lib/source-discovery/adapters/official-directory-http";

test("directory HTTP preparation denies unsafe DNS and never dispatches a request", async context => {
  context.mock.method(dns, "resolve4", async () => ["127.0.0.1"]);
  await assert.rejects(() => prepareDirectoryHttpRequest("https://official.example.org/recruitment/", 1024, 1000), /DISCOVERY_DNS_DENIED/u);
});

test("directory HTTP preparation accepts only a public pinned exact HTTPS target", async context => {
  let dnsCalls = 0;
  context.mock.method(dns, "resolve4", async () => { dnsCalls += 1; return ["8.8.8.8"]; });
  await assert.rejects(() => prepareDirectoryHttpRequest("http://official.example.org/recruitment/", 1024, 1000), /DISCOVERY_TARGET_DENIED/u);
  assert.equal(dnsCalls, 0);
  const prepared = await prepareDirectoryHttpRequest("https://official.example.org/recruitment/", 1024, 1000);
  assert.equal(prepared.exact_url, "https://official.example.org/recruitment/");
  assert.deepEqual(prepared.addresses, ["8.8.8.8"]);
  await assert.rejects(() => prepared.execute(), /DISCOVERY_HTTP_REQUEST_FAILED/u);
});

test("live directory request is one-shot, pinned, stateless and retains no sensitive response header", async context => {
  context.mock.method(dns, "resolve4", async () => ["8.8.8.8"]);
  let calls = 0;
  context.mock.method(https, "request", (url: URL, options: Record<string, unknown>, callback: (response: unknown) => void) => {
    calls += 1;
    assert.equal(url.href, "https://official.example.org/recruitment/");
    assert.equal(options.autoSelectFamily, false);
    assert.equal(options.rejectUnauthorized, true);
    assert.deepEqual(options.headers, { Accept: "text/html", "Accept-Encoding": "identity", "User-Agent": "LawJobRadar-Discovery/1.0" });
    const response = Object.assign(new PassThrough(), { statusCode: 302,
      headers: { "content-type": "text/html; charset=utf-8", "set-cookie": ["secret=session-value"], location: "https://unapproved.example.org/" } });
    const request = Object.assign(new EventEmitter(), {
      end() { callback(response); response.end("\uFEFF<html>public</html>"); },
      destroy(error: Error) { request.emit("error", error); }
    });
    return request;
  });
  const prepared = await prepareDirectoryHttpRequest("https://official.example.org/recruitment/", 1024, 1000);
  const response = await prepared.execute();
  assert.equal(response.http_status, 302);
  assert.equal(response.response_set_cookie_present, true);
  assert.equal(response.received_byte_length, Buffer.byteLength("\uFEFF<html>public</html>"));
  assert.equal(response.body, "<html>public</html>");
  assert.doesNotMatch(JSON.stringify(response), /session-value|location|unapproved/u);
  assert.match(response.content_sha256!, /^[a-f0-9]{64}$/u);
  await assert.rejects(() => prepared.execute(), /ALREADY_USED/u);
  assert.equal(calls, 1);
});

test("oversized live response retains received-byte evidence rather than zero-byte network failure", async context => {
  context.mock.method(dns, "resolve4", async () => ["8.8.8.8"]);
  context.mock.method(https, "request", (_url: URL, _options: unknown, callback: (response: unknown) => void) => {
    const response = Object.assign(new PassThrough(), { statusCode: 200, headers: { "content-type": "text/html" } });
    const request = Object.assign(new EventEmitter(), {
      end() { callback(response); response.end("larger than limit"); },
      destroy(error: Error) { request.emit("error", error); }
    });
    return request;
  });
  const prepared = await prepareDirectoryHttpRequest("https://official.example.org/recruitment/", 4, 1000);
  await assert.rejects(() => prepared.execute(), (error: unknown) => {
    assert.equal((error as { received_bytes: number }).received_bytes, 17);
    assert.equal((error as { reason_code: string }).reason_code, "DISCOVERY_HTTP_RESPONSE_TOO_LARGE");
    return true;
  });
});
