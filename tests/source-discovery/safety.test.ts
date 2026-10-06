import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { safeDiscoveryUrl, publicDiscoveryAddress, safeDiscoveryText } from "../../lib/source-discovery/safety";
import { DiscoveryBudget } from "../../lib/source-discovery/discovery-budget";
import { observeDirectory } from "../../lib/source-discovery/adapters/official-directory";
import { canonicalHash } from "../../lib/ingestion/normalization/canonical-artifact-registry";

const at = "2026-10-06T00:00:00.000Z";
const scope = { scope_id: "fixture", revision: 1, status: "ACTIVE" as const, approved_by: "TEST_ONLY",
  approval_reference: "fixture:scope", effective_from: at, expires_at: "2026-10-07T00:00:00.000Z", exact_urls: ["https://example.org/directory"],
  budget: { max_organizations: 1, max_endpoints_per_organization: 1, max_requests: 1, max_candidate_urls: 1,
    max_domains: 1, redirect_depth: 0, retry_limit: 0, runtime_seconds: 600, cooldown_seconds: 259200,
    max_response_bytes: 2097152, max_total_bytes: 16777216 } };

test("unsafe target and DNS address forms fail closed, safe text never retains credential/contact values", () => {
  for (const url of ["http://example.org/", "https://user:pass@example.org/", "https://example.org/?token=secret",
    "https://example.org/#secret", "https://127.0.0.1/", "https://example.org:444/", "https://service.local/",
    "https://example.org/careers?email=alice%40example.org", "https://example.org/contact/alice%40example.org"]) {
    assert.throws(() => safeDiscoveryUrl(url));
  }
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.1.1", "::1", "::ffff:127.0.0.1", "198.18.1.1"]) {
    assert.equal(publicDiscoveryAddress(address), false);
  }
  assert.equal(publicDiscoveryAddress("93.184.216.34"), true);
  const text = safeDiscoveryText("招聘 token=credential alice@example.org 13812345678 Authorization: Bearer abcdef123456");
  assert.equal(/credential|alice@|13812345678|abcdef123456/.test(text), false);
});

test("one bounded organization visit may use two exact endpoints, but same-target retry cannot bypass cooldown", () => {
  const policy = { ...scope, exact_urls: [scope.exact_urls[0]!, "https://example.org/second"],
    budget: { ...scope.budget, max_endpoints_per_organization: 2, max_requests: 2 } };
  const budget = new DiscoveryBudget(policy, at);
  const first = budget.reserve("unit", policy.exact_urls[0]!, at);
  budget.markSent(first.intent_id, at);
  budget.observe(first.intent_id, { status: "SUCCESS", byte_length: 1 }, at);
  const second = budget.reserve("unit", policy.exact_urls[1]!, at);
  budget.markSent(second.intent_id, at);
  budget.observe(second.intent_id, { status: "SUCCESS", byte_length: 1 }, at);
  assert.throws(() => budget.reserve("unit", policy.exact_urls[0]!, at), /COOLDOWN|BUDGET/);
});

test("budget persists no-refund lifecycle and rejects forged replay, overruns and stale times", () => {
  const budget = new DiscoveryBudget(scope, at);
  const intent = budget.reserve("unit", scope.exact_urls[0]!, at);
  budget.markSent(intent.intent_id, at);
  budget.observe(intent.intent_id, { status: "NETWORK_FAILURE", byte_length: 0 }, at);
  const restored = DiscoveryBudget.restore(budget.snapshot());
  assert.throws(() => restored.reserve("unit", scope.exact_urls[0]!, at), /BUDGET|COOLDOWN/);
  assert.throws(() => restored.observe(intent.intent_id, { status: "SUCCESS", byte_length: 0 }, at));
  const snapshot = budget.snapshot();
  snapshot.events.pop();
  assert.throws(() => DiscoveryBudget.restore(snapshot), /INTEGRITY/);
  const forged = { ...snapshot, integrity_hash: canonicalHash({ policy: snapshot.policy, started_at: snapshot.started_at,
    cooldowns: snapshot.cooldowns, events: [{ kind: "SENT", intent_id: "missing", at }] }) };
  forged.events = [{ kind: "SENT", intent_id: "missing", at }];
  assert.throws(() => DiscoveryBudget.restore(forged), /SEND_INVALID/);
  assert.throws(() => new DiscoveryBudget({ ...scope, budget: { ...scope.budget, max_requests: 33 } }, at), /POLICY/);
});

test("directory parser bounds candidates, retains unvisited unsafe clues and never follows links", () => {
  const parsed = observeDirectory('<a href="/careers">单位招聘</a><a href="https://other.example/?token=secret">外部单位</a>', scope.exact_urls[0]!, 1);
  assert.equal(parsed.selected.length, 1);
  assert.equal(parsed.deferred.length, 1);
  assert.equal(parsed.deferred[0]!.url, null);
  assert.equal(JSON.stringify(parsed).includes("secret"), false);
});
