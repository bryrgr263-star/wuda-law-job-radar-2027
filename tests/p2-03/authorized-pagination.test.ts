import "../helpers/network-guard";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { CollectionRunner } from "../../lib/collection-runtime";
import { InMemoryRawBlobRepository, InMemorySnapshotRepository, RawCaptureService } from "../../lib/ingestion";
import { sealQueryAuthorizationContract, materializeApprovedQueryTargets } from "../../lib/application/source-admission/query-authorization";
import { LocalJsonTestAdapter } from "./local-test-adapter";
import { endpoint } from "./test-support";

const base = "https://official.invalid/jobs";
const contract = sealQueryAuthorizationContract({ schema_version: "query-authorization/2.0.0", base_exact_url: base,
  parameters: [{ name: "page", required: true, allowed_values: ["1", "2", "3"] }],
  approved_combinations: [1, 2, 3].map(page => [{ name: "page", value: String(page) }]),
  pagination: { parameter: "page", minimum_page: 1, maximum_page: 3, ordering: "ASCENDING_INTEGER", empty_stop: "STOP", repeated_content_stop: "STOP" },
  maximum_pages: 3, request_budget: 3, canonicalization: "QUERY_ASCII_RFC3986_V1" });

async function collect(bodies: string[], budget = 3) {
  let sent = 0; let sequence = 0;
  const parser = new LocalJsonTestAdapter();
  const plans = [1, 2, 3].map(page => ({ ...parser.plan(endpoint(`${base}?page=${page}`))[0]!, locator: `${base}?page=${page}` }));
  const adapter = { descriptor: parser.descriptor, validateEndpoint: parser.validateEndpoint.bind(parser), plan: () => plans,
    extract: parser.extract.bind(parser), nextPage: () => null, assessCompleteness: parser.assessCompleteness.bind(parser) };
  const runner = new CollectionRunner({ transport: { async execute() {
    const bytes = new TextEncoder().encode(bodies[sent++]!);
    return { status: "SUCCESS", responded_at: "2026-10-01T00:00:00.000Z" as never, bytes, content_sha256: createHash("sha256").update(bytes).digest("hex") as never,
      http_status: 200, headers: { "content-type": "application/json" }, mime_type: "application/json" };
  } }, raw_capture: new RawCaptureService(new InMemoryRawBlobRepository(), new InMemorySnapshotRepository(), { create_snapshot_id: () => `pagination:${++sequence}` as never }),
    policy: { timeout_ms: 100, retry_limit: 0, retry_backoff_ms: 0, rate_limit_ms: 0, max_pages: 3, request_budget: budget } });
  const result = await runner.run({ collection_run_id: "bounded-query-test", endpoint: endpoint(base), adapter,
    pagination_safety: { approved_locators: materializeApprovedQueryTargets(contract), maximum_pages: contract.maximum_pages, request_budget: contract.request_budget } });
  return { result, sent };
}

test("repeated vacancy content stops despite changed raw metadata and retains extracted records", async () => {
  const { result, sent } = await collect(['{"records":[{"id":"one","title":"法务"}],"metadata":1}', '{"records":[{"id":"one","title":"法务"}],"metadata":2}', '{"records":[{"id":"later","title":"法务"}]}']);
  assert.equal(sent, 2); assert.equal(result.status, "PARTIAL"); assert.equal(result.extracted_records.length, 2);
  assert.ok(result.reason_codes.includes("REPEATED_CONTENT_BLOCKED"));
});
test("explicit empty page stops but missing record structure is an extraction failure, not empty", async () => {
  const empty = await collect(['{"records":[{"id":"one","title":"法务"}]}', '{"records":[]}', '{"records":[]}']);
  assert.equal(empty.sent, 2); assert.ok(empty.result.reason_codes.includes("EMPTY_PAGE_STOP")); assert.equal(empty.result.status, "PARTIAL");
  const malformed = await collect(['{}', '{"records":[{"id":"two","title":"法务"}]}', '{"records":[{"id":"three","title":"法务"}]}']);
  assert.equal(malformed.sent, 3); assert.ok(malformed.result.reason_codes.includes("ADAPTER_EXTRACTION_FAILED"));
  assert.equal(malformed.result.reason_codes.includes("EMPTY_PAGE_STOP"), false);
});
test("first empty page is suspicious; request budget prevents the next page", async () => {
  const empty = await collect(['{"records":[]}', '{"records":[]}', '{"records":[]}']);
  assert.equal(empty.sent, 1); assert.equal(empty.result.status, "SUSPICIOUS_EMPTY");
  const budget = await collect(['{"records":[{"id":"one","title":"法务"}]}'], 1);
  assert.equal(budget.sent, 1); assert.equal(budget.result.status, "PARTIAL");
});
