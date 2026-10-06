import "../helpers/network-guard";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { canonicalHash } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { GitDiscoveryStore } from "../../lib/source-discovery/git-discovery-store";
import { importHistoricalResearch } from "../../lib/source-discovery/research-import";
import { DiscoveryRoot, selectDueSeeds } from "../../lib/source-discovery/discovery-root";
import { DiscoveryBudget } from "../../lib/source-discovery/discovery-budget";
import { createDiscoveryRecord } from "../../lib/source-discovery/contracts";

const at = "2026-10-06T00:00:00.000Z";
const scope = { scope_id: "fixture-directory", revision: 1, status: "ACTIVE" as const,
  approved_by: "TEST_ONLY", approval_reference: "fixture:directory", effective_from: at,
  expires_at: "2026-10-07T00:00:00.000Z", exact_urls: ["https://example.org/directory"],
  budget: { max_organizations: 10, max_endpoints_per_organization: 2, max_requests: 2,
    max_candidate_urls: 40, max_domains: 8, redirect_depth: 0, retry_limit: 1,
    runtime_seconds: 600, cooldown_seconds: 259200, max_response_bytes: 2097152, max_total_bytes: 16777216 } };
const html = '<a href="https://new-employer.example/careers">新单位招聘 2027 法务</a><a href="https://new-employer.example/careers">新单位招聘 2027 法务</a>';

function repository() {
  const directory = mkdtempSync(resolve(tmpdir(), "discovery-runtime-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
  git("init"); git("config", "user.name", "Discovery Test"); git("config", "user.email", "fixture@example.invalid");
  git("commit", "--allow-empty", "-m", "fixture baseline");
  return { directory, git };
}

test("Git append-only catalog and fresh child Process B restore historical and discovered evidence", async () => {
  const { directory, git } = repository();
  const store = new GitDiscoveryStore(directory);
  const records = importHistoricalResearch(readFileSync("docs/source-discovery/2026-10-01-candidate-pool.json", "utf8"));
  store.commit(records, git("rev-parse", "HEAD"));
  const root = new DiscoveryRoot({ store, run_id: "fixture-run", scope, started_at: at,
    approved_scope_hash: canonicalHash(scope), mode: "OFFLINE_FIXTURE" });
  await root.discover("directory-owner", scope.exact_urls[0]!, at, { kind: "OFFLINE_DIRECTORY_FIXTURE", responses: {
    [scope.exact_urls[0]!]: { http_status: 200, final_url: scope.exact_urls[0]!, addresses: ["93.184.216.34"],
      content_type: "text/html", body: html, response_set_cookie_present: true }
  } });
  const head = git("rev-parse", "HEAD");
  const catalog = store.restore(head);
  assert.equal(catalog.list("CANDIDATE").length, 47);
  const candidate = catalog.list("CANDIDATE").at(-1)!;
  assert.equal(candidate.payload.officiality, "UNRESOLVED");
  assert.equal(candidate.payload.employer_identity, "UNRESOLVED");
  assert.equal(candidate.payload.hosting_platform_identity, "UNRESOLVED");
  assert.equal(candidate.payload.recruitment_year_signal, "OBSERVED");
  assert.equal(candidate.payload.legal_signal, "OBSERVED");
  assert.equal(root.budgetSnapshot().events.filter(event => event.kind === "SENT").length, 1);
  const bytes = JSON.stringify(catalog.list());
  assert.equal(bytes.includes("Set-Cookie:"), false);
  const script = resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  const modulePath = resolve(process.cwd(), "lib/source-discovery/git-discovery-store.ts").replaceAll("\\", "/");
  const rootModule = resolve(process.cwd(), "lib/source-discovery/discovery-root.ts").replaceAll("\\", "/");
  const child = execFileSync(process.execPath, [script, "-e", `import { GitDiscoveryStore } from ${JSON.stringify(modulePath)}; import { DiscoveryRoot } from ${JSON.stringify(rootModule)}; import { canonicalHash } from ${JSON.stringify(resolve(process.cwd(), "lib/ingestion/normalization/canonical-artifact-registry.ts").replaceAll("\\", "/"))}; const store = new GitDiscoveryStore(${JSON.stringify(directory)}); const root = DiscoveryRoot.restore({store, sha:${JSON.stringify(head)}, run_id:"fixture-run", approved_scope_hash:${JSON.stringify(canonicalHash(scope))}, mode:"OFFLINE_FIXTURE"}); console.log(JSON.stringify({catalog:canonicalHash(store.restore(${JSON.stringify(head)}).list()), budget:canonicalHash(root.budgetSnapshot())}));`], { encoding: "utf8", timeout: 30000 });
  assert.deepEqual(JSON.parse(child.trim()), { catalog: canonicalHash(catalog.list()), budget: canonicalHash(root.budgetSnapshot()) });
  const restored = DiscoveryRoot.restore({ store, sha: head, run_id: "fixture-run", approved_scope_hash: canonicalHash(scope), mode: "OFFLINE_FIXTURE" });
  assert.equal(restored.budgetSnapshot().events.length, 3);
  assert.throws(() => store.commit(records, head.slice(0, -1) + "0"), /CAS/);
  const manifestPath = resolve(directory, "discovery-state/manifest.json");
  mkdirSync(resolve(directory, "discovery-state"), { recursive: true });
  writeFileSync(manifestPath, "{}");
  assert.equal(store.restore(head).list().length, catalog.list().length);
});

test("stale restored roots, arbitrary transport callbacks and revoked runs cannot dispatch", async () => {
  const { directory, git } = repository();
  const store = new GitDiscoveryStore(directory);
  const root = new DiscoveryRoot({ store, run_id: "stale-run", scope, started_at: at,
    approved_scope_hash: canonicalHash(scope), mode: "OFFLINE_FIXTURE" });
  const earlier = git("rev-parse", "HEAD");
  const stale = DiscoveryRoot.restore({ store, sha: earlier, run_id: "stale-run", approved_scope_hash: canonicalHash(scope), mode: "OFFLINE_FIXTURE" });
  const fixture = { kind: "OFFLINE_DIRECTORY_FIXTURE" as const, responses: { [scope.exact_urls[0]!]: { failure: "NETWORK_FAILURE" as const } } };
  await root.discover("unit", scope.exact_urls[0]!, at, fixture);
  await assert.rejects(stale.discover("unit", scope.exact_urls[0]!, at, fixture), /STALE_ROOT/);
  await assert.rejects(root.discover("unit", scope.exact_urls[0]!, at, (() => {}) as never), /FIXTURE_REQUIRED/);
  root.revoke(at);
  const restored = DiscoveryRoot.restore({ store, sha: git("rev-parse", "HEAD"), run_id: "stale-run", approved_scope_hash: canonicalHash(scope), mode: "OFFLINE_FIXTURE" });
  await assert.rejects(restored.discover("unit", scope.exact_urls[0]!, at, fixture), /HALTED/);
  assert.throws(() => new DiscoveryRoot({ store, run_id: "next-run", scope, started_at: at,
    approved_scope_hash: canonicalHash(scope), mode: "OFFLINE_FIXTURE" }), /SCOPE_REVOKED/);
});

test("rediscovery appends observation and candidate revision, deferred frontier stays recoverable", async () => {
  const { directory, git } = repository();
  const store = new GitDiscoveryStore(directory);
  const limited = { ...scope, exact_urls: [scope.exact_urls[0]!, "https://example.org/second"],
    budget: { ...scope.budget, max_candidate_urls: 1 } };
  const root = new DiscoveryRoot({ store, run_id: "dedup-run", scope: limited, started_at: at,
    approved_scope_hash: canonicalHash(limited), mode: "OFFLINE_FIXTURE" });
  const response = (url: string, body: string) => ({ http_status: 200, final_url: url, addresses: ["93.184.216.34"],
    content_type: "text/html", body, response_set_cookie_present: false });
  await root.discover("unit-a", limited.exact_urls[0]!, at, { kind: "OFFLINE_DIRECTORY_FIXTURE", responses: {
    [limited.exact_urls[0]!]: response(limited.exact_urls[0]!, html + '<a href="https://other.example/jobs">另一单位</a>') } });
  await root.discover("unit-b", limited.exact_urls[1]!, at, { kind: "OFFLINE_DIRECTORY_FIXTURE", responses: {
    [limited.exact_urls[1]!]: response(limited.exact_urls[1]!, html) } });
  const catalog = store.restore(git("rev-parse", "HEAD"));
  assert.equal(catalog.current("CANDIDATE").length, 1);
  assert.ok(catalog.list("OBSERVATION").some(record => Array.isArray(record.payload.deferred_frontier)));
  assert.ok(!catalog.list("OBSERVATION").some(record => record.payload.status === "EMPTY"));
});

test("Git discovery rejects namespace deletion instead of accepting an empty recovery", () => {
  const { directory, git } = repository();
  const store = new GitDiscoveryStore(directory);
  const baseline = git("rev-parse", "HEAD");
  const records = importHistoricalResearch(readFileSync("docs/source-discovery/2026-10-01-candidate-pool.json", "utf8"));
  const head = store.commit(records.slice(0, 3), baseline);
  const removed = git("commit-tree", `${baseline}^{tree}`, "-p", head, "-m", "fixture forbidden namespace removal");
  assert.throws(() => store.restore(removed), /NAMESPACE_REMOVED/);
});

test("new run IDs cannot replace a crash-unknown persisted reservation", () => {
  const { directory, git } = repository();
  const store = new GitDiscoveryStore(directory);
  new DiscoveryRoot({ store, run_id: "crashed", scope, started_at: at,
    approved_scope_hash: canonicalHash(scope), mode: "OFFLINE_FIXTURE" });
  const parent = git("rev-parse", "HEAD");
  const initial = store.restore(parent).current("RUN")[0]!;
  const budget = DiscoveryBudget.restore(initial.payload.budget as ReturnType<DiscoveryBudget["snapshot"]>);
  budget.reserve("unit", scope.exact_urls[0]!, at);
  store.commit([createDiscoveryRecord("RUN", initial.logical_id, { ...initial.payload, stage: "RESERVED", budget: budget.snapshot() }, [initial], 2)], parent);
  assert.throws(() => new DiscoveryRoot({ store, run_id: "replacement", scope, started_at: at,
    approved_scope_hash: canonicalHash(scope), mode: "OFFLINE_FIXTURE" }), /UNRESOLVED_RESERVATION/);
});

test("restoring an idle run at current HEAD cannot bypass another run's completed cooldown", async () => {
  const { directory, git } = repository();
  const store = new GitDiscoveryStore(directory);
  new DiscoveryRoot({ store, run_id: "idle", scope, started_at: at, approved_scope_hash: canonicalHash(scope), mode: "OFFLINE_FIXTURE" });
  const active = new DiscoveryRoot({ store, run_id: "other", scope, started_at: at, approved_scope_hash: canonicalHash(scope), mode: "OFFLINE_FIXTURE" });
  const fixture = { kind: "OFFLINE_DIRECTORY_FIXTURE" as const, responses: { [scope.exact_urls[0]!]: { failure: "NETWORK_FAILURE" as const } } };
  await active.discover("unit", scope.exact_urls[0]!, at, fixture);
  const restored = DiscoveryRoot.restore({ store, sha: git("rev-parse", "HEAD"), run_id: "idle", approved_scope_hash: canonicalHash(scope), mode: "OFFLINE_FIXTURE" });
  await restored.discover("renamed-unit", scope.exact_urls[0]!, at, fixture);
  assert.equal(restored.budgetSnapshot().events.length, 0);
  assert.equal(store.restore(git("rev-parse", "HEAD")).list("OBSERVATION").at(-1)!.payload.reason, "DISCOVERY_COOLDOWN");
});

test("changed employer wording stays REVIEW_REQUIRED until independently resolved", async () => {
  const { directory, git } = repository();
  const store = new GitDiscoveryStore(directory);
  let policy = scope;
  for (const [index, quote] of ["单位甲 2027招聘", "单位乙 2027招聘", "单位乙 2027招聘"].entries()) {
    const observed = `2026-10-${String(6 + index * 3).padStart(2, "0")}T00:00:00.000Z`;
    policy = { ...scope, effective_from: observed, expires_at: "2026-11-01T00:00:00.000Z" };
    const root = new DiscoveryRoot({ store, run_id: `identity-${index}`, scope: policy, started_at: observed,
      approved_scope_hash: canonicalHash(policy), mode: "OFFLINE_FIXTURE" });
    await root.discover("unit", policy.exact_urls[0]!, observed, { kind: "OFFLINE_DIRECTORY_FIXTURE", responses: {
      [policy.exact_urls[0]!]: { http_status: 200, final_url: policy.exact_urls[0]!, addresses: ["93.184.216.34"],
        content_type: "text/html", body: `<a href="https://employer.example/jobs">${quote}</a>`, response_set_cookie_present: false }
    } });
  }
  const catalog = store.restore(git("rev-parse", "HEAD"));
  assert.equal(catalog.current("CANDIDATE").length, 1);
  assert.equal(catalog.current("CANDIDATE")[0]!.revision, 3);
  assert.equal(catalog.current("CANDIDATE")[0]!.payload.disposition, "REVIEW_REQUIRED");
  assert.equal(catalog.current("CANDIDATE")[0]!.payload.claim_conflict, true);
});

test("intermediate immutable record mutation remains invalid even after byte restoration", () => {
  const { directory, git } = repository();
  const store = new GitDiscoveryStore(directory);
  const seed = createDiscoveryRecord("SEED", "discovery:immutable", { claim: "UNKNOWN" });
  const head = store.commit([seed], git("rev-parse", "HEAD"));
  const blob = execFileSync("git", ["-C", directory, "hash-object", "-w", "--stdin"], { input: "{}", encoding: "utf8" }).trim();
  const tree = (input: string) => execFileSync("git", ["-C", directory, "mktree"], { input: input + "\n", encoding: "utf8" }).trim();
  const recordsTree = tree(`100644 blob ${blob}\t${canonicalHash(seed.record_id)}.json`);
  const manifestLine = git("ls-tree", `${head}:discovery-state`).split("\n").find(line => line.endsWith("\tmanifest.json"))!;
  const namespace = tree(`${manifestLine}\n040000 tree ${recordsTree}\trecords`);
  const rootTree = tree(`040000 tree ${namespace}\tdiscovery-state`);
  const corrupted = git("commit-tree", rootTree, "-p", head, "-m", "fixture intermediate mutation");
  const restoredBytes = git("commit-tree", `${head}^{tree}`, "-p", corrupted, "-m", "fixture restore bytes");
  assert.throws(() => store.restore(restoredBytes), /IMMUTABLE_BLOB_CHANGED/);
});

test("discovery writer cannot append records into the production-state repository", () => {
  const store = new GitDiscoveryStore(process.cwd());
  const parent = store.head();
  assert.throws(() => store.commit([], parent), /ISOLATED_WRITER_REQUIRED/);
  assert.equal(store.head(), parent);
});

test("runtime preserves pre-send denial, sent failure and unresolved reservations without refund", async () => {
  const { directory, git } = repository();
  const store = new GitDiscoveryStore(directory);
  const root = new DiscoveryRoot({ store, run_id: "failure-run", scope, started_at: at,
    approved_scope_hash: canonicalHash(scope), mode: "OFFLINE_FIXTURE" });
  const response = { kind: "OFFLINE_DIRECTORY_FIXTURE" as const, responses: { [scope.exact_urls[0]!]: { failure: "NETWORK_FAILURE" as const } } };
  await root.discover("unit", "https://example.org/unapproved", at, response);
  assert.equal(root.budgetSnapshot().events.filter(event => event.kind === "SENT").length, 0);
  await root.discover("unit", scope.exact_urls[0]!, at, response);
  assert.equal(root.budgetSnapshot().events.filter(event => event.kind === "SENT").length, 1);
  const catalog = store.restore(git("rev-parse", "HEAD"));
  assert.ok(catalog.list("OBSERVATION").some(record => record.payload.request_state === "NOT_SENT"));
  assert.ok(catalog.list("OBSERVATION").some(record => record.payload.request_state === "SENT" && record.payload.status === "NETWORK_FAILURE"));
  assert.equal(JSON.stringify(catalog.list()).includes("do-not-persist"), false);
  const budget = new DiscoveryBudget(scope, at);
  budget.reserve("unit", scope.exact_urls[0]!, at);
  const replay = DiscoveryBudget.restore(budget.snapshot());
  assert.throws(() => replay.reserve("unit", scope.exact_urls[0]!, at), /UNRESOLVED/);
});

test("fair due selection reserves capacity for unknown signals deterministically", () => {
  const seeds = Array.from({ length: 10 }, (_, index) => ({ id: `seed-${index}`, next_due: at,
    unknown_signal: index >= 7 }));
  assert.equal(selectDueSeeds(seeds, at, 4).filter(seed => seed.unknown_signal).length, 2);
  assert.deepEqual(selectDueSeeds(seeds, at, 4), selectDueSeeds([...seeds].reverse(), at, 4));
});
