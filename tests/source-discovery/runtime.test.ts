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
import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

test("live discovery preserves a scope-denied NOT_SENT event and restores without fixture provenance", async context => {
  const { directory } = repository();
  const store = new GitDiscoveryStore(directory);
  context.mock.method(dns, "resolve4", async () => ["127.0.0.1"]);
  const live = new DiscoveryRoot({ store, run_id: "live-dns-denied", scope,
    started_at: at, approved_scope_hash: canonicalHash(scope), mode: "REAL_DIRECTORY" });
  await live.discoverLive("official", scope.exact_urls[0]!);
  const records = store.restore(store.head()).list("OBSERVATION");
  assert.equal(records.at(-1)?.payload.request_state, "NOT_SENT");
  assert.equal(records.at(-1)?.payload.provenance_kind, "REAL_DIRECTORY");
  assert.equal(records.at(-1)?.payload.reason, "DISCOVERY_SCOPE_DENIED");
  const restored = DiscoveryRoot.restore({ store, sha: store.head(), run_id: "live-dns-denied",
    approved_scope_hash: canonicalHash(scope), mode: "REAL_DIRECTORY" });
  assert.deepEqual(restored.budgetSnapshot(), live.budgetSnapshot());
  assert.equal(store.restore(store.head()).current("CANDIDATE").length, 0);
});

test("live DNS policy failure is NOT_SENT while guarded HTTP failure retains SENT and live mode", async context => {
  const { directory } = repository();
  const store = new GitDiscoveryStore(directory);
  const now = new Date().toISOString();
  const liveScope = { ...scope, effective_from: now, expires_at: new Date(Date.parse(now) + 600000).toISOString() };
  const hash = canonicalHash(liveScope);
  context.mock.method(dns, "resolve4", async () => ["10.0.0.1"]);
  const first = new DiscoveryRoot({ store, run_id: "live-dns", scope: liveScope,
    started_at: now, approved_scope_hash: hash, mode: "REAL_DIRECTORY" });
  await first.discoverLive("first", liveScope.exact_urls[0]!);
  const denied = store.restore(store.head()).list("OBSERVATION").at(-1)!;
  assert.equal(denied.payload.request_state, "NOT_SENT");
  assert.equal(denied.payload.reason, "DISCOVERY_DNS_DENIED");
  context.mock.restoreAll();
  context.mock.method(dns, "resolve4", async () => ["8.8.8.8"]);
  const secondScope = { ...liveScope, exact_urls: ["https://second.example.org/directory/"] };
  const secondHash = canonicalHash(secondScope);
  const second = new DiscoveryRoot({ store, run_id: "live-http", scope: secondScope,
    started_at: new Date().toISOString(), approved_scope_hash: secondHash, mode: "REAL_DIRECTORY" });
  await second.discoverLive("second", secondScope.exact_urls[0]!);
  const failed = store.restore(store.head()).list("OBSERVATION").at(-1)!;
  assert.equal(failed.payload.request_state, "SENT");
  assert.equal(failed.payload.status, "NETWORK_FAILURE");
  assert.equal(failed.payload.provenance_kind, "REAL_DIRECTORY");
  const sha = store.head();
  const child = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "-e",
    `import {GitDiscoveryStore} from ${JSON.stringify(resolve("lib/source-discovery/git-discovery-store.ts").replaceAll("\\", "/"))}; import {DiscoveryRoot} from ${JSON.stringify(resolve("lib/source-discovery/discovery-root.ts").replaceAll("\\", "/"))}; const store=new GitDiscoveryStore(${JSON.stringify(directory)}); const root=DiscoveryRoot.restore({store,sha:${JSON.stringify(sha)},run_id:"live-http",approved_scope_hash:${JSON.stringify(secondHash)},mode:"REAL_DIRECTORY"});console.log(JSON.stringify(root.budgetSnapshot()));`], { encoding: "utf8", timeout: 30000 });
  assert.deepEqual(JSON.parse(child.trim()), second.budgetSnapshot());
  assert.throws(() => DiscoveryRoot.restore({ store, sha, run_id: "live-http", approved_scope_hash: secondHash,
    mode: "OFFLINE_FIXTURE" }), /DISCOVERY_REPLAY_MISMATCH/u);
});

test("live revocation during DNS preparation remains terminal and cannot send", async context => {
  const { directory } = repository();
  const store = new GitDiscoveryStore(directory);
  const now = new Date().toISOString();
  const liveScope = { ...scope, effective_from: now, expires_at: new Date(Date.parse(now) + 600000).toISOString() };
  let release!: (addresses: string[]) => void;
  let entered!: () => void;
  const entering = new Promise<void>(resolve => { entered = resolve; });
  context.mock.method(dns, "resolve4", () => { entered(); return new Promise<string[]>(resolve => { release = resolve; }); });
  const root = new DiscoveryRoot({ store, run_id: "live-revoked-dns", scope: liveScope,
    started_at: now, approved_scope_hash: canonicalHash(liveScope), mode: "REAL_DIRECTORY" });
  const request = root.discoverLive("official", liveScope.exact_urls[0]!);
  await entering;
  root.revoke(new Date().toISOString());
  release(["8.8.8.8"]);
  await assert.rejects(() => request, /DISCOVERY_ROOT_HALTED/u);
  assert.equal(store.restore(store.head()).current("RUN").at(-1)!.payload.stage, "REVOKED");
  assert.equal(root.budgetSnapshot().events.some(event => event.kind === "SENT"), false);
});

test("live oversized evidence preserves received bytes and unresolved reservation across restore", async context => {
  const { directory } = repository();
  const store = new GitDiscoveryStore(directory);
  const now = new Date().toISOString();
  const liveScope = { ...scope, effective_from: now, expires_at: new Date(Date.parse(now) + 600000).toISOString(),
    budget: { ...scope.budget, max_response_bytes: 4, max_total_bytes: 4 } };
  context.mock.method(dns, "resolve4", async () => ["8.8.8.8"]);
  context.mock.method(https, "request", (_url: URL, _options: unknown, callback: (response: unknown) => void) => {
    const response = Object.assign(new PassThrough(), { statusCode: 200, headers: { "content-type": "text/html" } });
    const request = Object.assign(new EventEmitter(), {
      end() { callback(response); response.end("larger than limit"); },
      destroy(error: Error) { request.emit("error", error); }
    });
    return request;
  });
  const hash = canonicalHash(liveScope);
  const root = new DiscoveryRoot({ store, run_id: "live-oversized", scope: liveScope,
    started_at: now, approved_scope_hash: hash, mode: "REAL_DIRECTORY" });
  await root.discoverLive("official", liveScope.exact_urls[0]!);
  const observation = store.restore(store.head()).list("OBSERVATION").at(-1)!;
  assert.equal(observation.payload.received_bytes, 17);
  assert.equal(observation.payload.status, "RESPONSE_BUDGET_EXCEEDED_UNRESOLVED");
  assert.equal(root.budgetSnapshot().events.some(event => event.kind === "OBSERVE"), false);
  const restored = DiscoveryRoot.restore({ store, sha: store.head(), run_id: "live-oversized", approved_scope_hash: hash, mode: "REAL_DIRECTORY" });
  await assert.rejects(() => restored.discoverLive("official", liveScope.exact_urls[0]!), /HALTED/u);
  assert.throws(() => new DiscoveryRoot({ store, run_id: "live-budget-bypass", scope: liveScope,
    started_at: new Date().toISOString(), approved_scope_hash: hash, mode: "REAL_DIRECTORY" }), /UNRESOLVED_RESERVATION/u);
});

test("live directory content enters the existing untrusted catalog with safe evidence and no child requests", async context => {
  const { directory } = repository();
  const store = new GitDiscoveryStore(directory);
  const now = new Date().toISOString();
  const liveScope = { ...scope, effective_from: now, expires_at: new Date(Date.parse(now) + 600000).toISOString() };
  const hash = canonicalHash(liveScope);
  let requests = 0;
  context.mock.method(dns, "resolve4", async () => ["8.8.8.8"]);
  context.mock.method(https, "request", (_url: URL, _options: unknown, callback: (response: unknown) => void) => {
    requests += 1;
    const response = Object.assign(new PassThrough(), { statusCode: 200,
      headers: { "content-type": "text/html", "set-cookie": ["session=DO_NOT_PERSIST"] } });
    const request = Object.assign(new EventEmitter(), {
      end() { callback(response); response.end(html); },
      destroy(error: Error) { request.emit("error", error); }
    });
    return request;
  });
  const root = new DiscoveryRoot({ store, run_id: "live-success", scope: liveScope,
    started_at: now, approved_scope_hash: hash, mode: "REAL_DIRECTORY" });
  await root.discoverLive("official", liveScope.exact_urls[0]!);
  const sha = store.head();
  const records = store.restore(sha).list();
  const candidate = store.restore(sha).current("CANDIDATE")[0]!;
  assert.equal(candidate.payload.provenance_kind, "REAL_DIRECTORY");
  assert.equal(candidate.payload.officiality, "UNRESOLVED");
  assert.equal(candidate.payload.production_admission_status, "NOT_SUBMITTED");
  assert.equal(candidate.payload.recruitment_year_signal, "OBSERVED");
  assert.equal(requests, 1);
  assert.doesNotMatch(JSON.stringify(records), /DO_NOT_PERSIST/u);
  const response = store.restore(sha).list("OBSERVATION").find(record => record.payload.http_status === 200)!;
  assert.match(String(response.payload.content_sha256), /^[a-f0-9]{64}$/u);
  assert.equal(response.payload.byte_length, Buffer.byteLength(html));
  assert.deepEqual(DiscoveryRoot.restore({ store, sha, run_id: "live-success", approved_scope_hash: hash,
    mode: "REAL_DIRECTORY" }).budgetSnapshot(), root.budgetSnapshot());
  await assert.rejects(() => root.discover("official", liveScope.exact_urls[0]!, now,
    { kind: "OFFLINE_DIRECTORY_FIXTURE", responses: {} }), /DISCOVERY_FIXTURE_REQUIRED/u);
});

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
