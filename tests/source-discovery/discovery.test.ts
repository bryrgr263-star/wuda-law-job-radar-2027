import "../helpers/network-guard";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { importHistoricalResearch } from "../../lib/source-discovery/research-import";
import { DiscoveryCatalog } from "../../lib/source-discovery/candidate-catalog";
import { DiscoveryBudget } from "../../lib/source-discovery/discovery-budget";
import { prepareAdmissionProposal } from "../../lib/source-discovery/admission-proposal";
import { createDiscoveryRecord } from "../../lib/source-discovery/contracts";

const pool = readFileSync("docs/source-discovery/2026-10-01-candidate-pool.json", "utf8");
test("46 sources migrate deterministically with no trust upgrade and immutable deduplication", () => {
  const records = importHistoricalResearch(pool);
  assert.deepEqual(records, importHistoricalResearch(pool));
  const catalog = new DiscoveryCatalog();
  records.forEach(record => catalog.append(record));
  records.forEach(record => assert.equal(catalog.append(record), "IDEMPOTENT"));
  assert.equal(catalog.list("SEED").length, 46);
  assert.equal(catalog.list("OBSERVATION").length, 46);
  assert.equal(catalog.list("CANDIDATE").length, 46);
  assert.ok(catalog.list("CANDIDATE").every(record => record.payload.officiality === "UNRESOLVED"));
  assert.ok(catalog.list("CANDIDATE").every(record => record.payload.provenance_kind === "IMPORTED_RESEARCH"));
  const first = catalog.list("CANDIDATE")[0]!;
  first.payload.officiality = "VERIFIED";
  assert.equal(catalog.list("CANDIDATE")[0]!.payload.officiality, "UNRESOLVED");
  assert.throws(() => catalog.append(first));
  assert.equal(prepareAdmissionProposal(catalog.list("CANDIDATE")[0]!).disposition, "REVIEW_REQUIRED");
});

test("research field origins and historical assertions survive without entity conflation", () => {
  const records = importHistoricalResearch(pool);
  const original = JSON.parse(pool);
  for (const entry of original.sources) {
    const seed = records.find(record => record.kind === "SEED" && record.payload.research_id === entry.id)!;
    assert.deepEqual(seed.payload.historical_entry, entry);
    assert.deepEqual(seed.payload.historical_defaults, original.field_defaults);
    const effective = { ...original.field_defaults, ...entry };
    assert.deepEqual(seed.payload.effective_claims, effective);
    for (const field of Object.keys(effective)) {
      assert.equal((seed.payload.field_origins as Record<string, string>)[field], Object.hasOwn(entry, field) ? "ENTRY" : "FIELD_DEFAULTS");
    }
  }
  const candidates = records.filter(record => record.kind === "CANDIDATE");
  assert.equal(new Set(candidates.map(record => record.logical_id)).size, 46);
  assert.ok(candidates.every(record => record.payload.publisher_identity === "UNRESOLVED"));
  assert.ok(candidates.every(record => record.payload.hosting_platform_identity === "UNRESOLVED"));
  assert.ok(candidates.every(record => record.payload.disposition === "PENDING_VERIFICATION"));
});

test("catalog rejects collision, revision gap, missing upstream and unknown schema", () => {
  const catalog = new DiscoveryCatalog();
  const first = createDiscoveryRecord("SEED", "discovery:test", { claim: "UNKNOWN" });
  catalog.append(first);
  assert.throws(() => catalog.append(createDiscoveryRecord("SEED", "discovery:test", { claim: "DIFFERENT" })), /COLLISION/);
  assert.throws(() => catalog.append(createDiscoveryRecord("SEED", "discovery:test", { claim: "UNKNOWN" }, [], 3)), /REVISION_GAP/);
  const missing = createDiscoveryRecord("OBSERVATION", "discovery:missing", {}, [createDiscoveryRecord("SEED", "discovery:absent", {})]);
  assert.throws(() => catalog.append(missing), /UPSTREAM/);
  assert.throws(() => catalog.append({ ...first, schema: "other" } as never), /INTEGRITY/);
  assert.throws(() => prepareAdmissionProposal(first), /CANDIDATE_REQUIRED/);
});

test("malformed or duplicate historical records cannot silently overwrite", () => {
  const original = JSON.parse(pool);
  original.sources.push(original.sources[0]);
  assert.throws(() => importHistoricalResearch(JSON.stringify(original)), /RESEARCH_ID_INVALID/);
  assert.throws(() => importHistoricalResearch("{}"), /RESEARCH_SCHEMA_INVALID/);
});

test("discovery requests deny by default and require exact scope, budget and cooldown", () => {
  const at = "2026-10-06T00:00:00.000Z";
  const policy = { scope_id: "test-directory", revision: 1, status: "ACTIVE" as const,
    approved_by: "TEST_ONLY", approval_reference: "fixture:directory", effective_from: at,
    expires_at: "2026-10-07T00:00:00.000Z", exact_urls: ["https://example.org/directory"],
    budget: { max_organizations: 1, max_endpoints_per_organization: 1, max_requests: 1,
      max_candidate_urls: 2, max_domains: 1, redirect_depth: 0, retry_limit: 0,
      runtime_seconds: 600, cooldown_seconds: 259200, max_response_bytes: 2097152, max_total_bytes: 16777216 } };
  assert.throws(() => new DiscoveryBudget(null, at).reserve("unit", "https://example.org/directory", at));
  const denied = new DiscoveryBudget(policy, at);
  assert.throws(() => denied.reserve("unit", "https://example.org/other", at));
  assert.throws(() => denied.reserve("unit", "http://127.0.0.1/", at));
  const budget = new DiscoveryBudget(policy, at);
  const request = budget.reserve("unit", policy.exact_urls[0]!, at);
  assert.equal(request.method, "GET");
  assert.equal(request.credentials, "omit");
  assert.equal(request.redirect, "manual");
  assert.throws(() => budget.reserve("unit", policy.exact_urls[0]!, at));
  assert.throws(() => new DiscoveryBudget(policy, at, { "unit": at }).reserve("unit", policy.exact_urls[0]!, at));
  assert.throws(() => new DiscoveryBudget({ ...policy, status: "REVOKED" }, at).reserve("unit", policy.exact_urls[0]!, at));
  assert.throws(() => budget.observe(request.intent_id, { status: "SUCCESS", byte_length: 2097153 }, at));
});
