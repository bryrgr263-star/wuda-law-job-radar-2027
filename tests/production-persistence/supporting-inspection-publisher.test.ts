import "../helpers/network-guard";
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import childProcess from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as publisher from "../../lib/production-persistence/supporting-inspection-publisher";
import { createSourcePersistenceVersion, type SourcePersistenceVersion } from "../../lib/production-persistence/contracts";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { sealQueryAuthorizationContract } from "../../lib/application/source-admission/query-authorization";
import { fixture as continuousFixture, AT, LATER, provenance, identity } from "./continuous-acquisition-fixture";

function fixture() {
  const original = continuousFixture();
  const exactUrl = "https://example.invalid/recruitment?id=TEST_ONLY";
  const query = sealQueryAuthorizationContract({ schema_version: "query-authorization/2.0.0",
    base_exact_url: "https://example.invalid/recruitment", parameters: [{ name: "id", required: true, allowed_values: ["TEST_ONLY"] }],
    approved_combinations: [[{ name: "id", value: "TEST_ONLY" }]], pagination: null, maximum_pages: 1, request_budget: 1,
    canonicalization: "QUERY_ASCII_RFC3986_V1" });
  const { continuous_acquisition_scope, ...base } = original.admitted;
  const admission = { ...base, endpoint: exactUrl, automation_basis: "HUMAN_REVIEWED_CANARY" as const,
    evidence: base.evidence.map(item => ({ ...item, endpoint: exactUrl, source_url: exactUrl })) };
  const endpoint = { ...original.endpoint, locator: exactUrl,
    collection_config: { ...original.endpoint.collection_config, max_items: 1, max_pages: 1, retry_limit: 0, follow_redirects: false } };
  const versions: SourcePersistenceVersion[] = [];
  for (const source of original.versions) {
    let artifact = source.artifact;
    if (artifact.kind === "RECRUITMENT_ENDPOINT") artifact = { kind: artifact.kind, payload: endpoint };
    if (artifact.kind === "SOURCE_ADMISSION") artifact = { kind: artifact.kind, payload: admission };
    if (artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST") artifact = { kind: artifact.kind, payload: { ...artifact.payload,
      recruitment_endpoint_artifact_id: versions.find(item => item.artifact.kind === "RECRUITMENT_ENDPOINT")!.artifact_id,
      source_admission_artifact_id: versions.find(item => item.artifact.kind === "SOURCE_ADMISSION")!.artifact_id,
      query_policy: { mode: "FINITE_VALUES", contract: query } } };
    versions.push(createSourcePersistenceVersion({ stream_id: source.stream_id, revision: 1, supersedes_artifact_id: null,
      artifact, provenance, effective_at: AT, created_at: AT }));
  }
  const id = (kind: string) => versions.find(item => item.artifact.kind === kind)!.artifact_id;
  const claim = { schema_version: "supporting-inspection-execution/1.0.0", state: "CLAIMED",
    authorization: { authorization_mode: "AUTOMATION_CANARY", authorization_id: "TEST_ONLY:inspection-auth",
      source_admission_id: admission.source_admission_id, endpoint: exactUrl, recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
      endpoint_purpose: admission.endpoint_purpose, allowed_http_method: "GET", collection_run_id: "TEST_ONLY:inspection-run",
      reviewer: "TEST_ONLY", issued_at: AT, evidence_id: admission.evidence[2]!.source_admission_evidence_id,
      scope: "ONE_ENDPOINT_ONE_RUN", manual_confirmation: true },
    bindings: { source_artifact_id: id("SOURCE_DEFINITION"), endpoint_artifact_id: id("RECRUITMENT_ENDPOINT"),
      admission_artifact_id: id("SOURCE_ADMISSION"), allowlist_artifact_id: id("OFFICIAL_ENDPOINT_ALLOWLIST"),
      adapter_artifact_id: id("ADAPTER_REGISTRATION") }, exact_url: exactUrl, method: "GET", query_contract_hash: query.contract_hash, claimed_at: LATER };
  return { versions, claim };
}

function version(payload: object, prior?: SourcePersistenceVersion) {
  return createSourcePersistenceVersion({ stream_id: Reflect.get(payload, "authorization").authorization_id,
    revision: (prior?.revision ?? 0) + 1, supersedes_artifact_id: prior?.artifact_id ?? null,
    artifact: { kind: "SUPPORTING_INSPECTION_EXECUTION", payload } as unknown as SourcePersistenceVersion["artifact"],
    provenance, effective_at: Reflect.get(payload, "claimed_at"), created_at: Reflect.get(payload, "claimed_at") });
}

function setup() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "inspection-publisher-TEST_ONLY-"));
  const seed = path.join(directory, "seed");
  const remote = path.join(directory, "remote.git");
  mkdirSync(seed);
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(directory, "init", "--quiet", "--bare", remote);
  git(seed, "init", "--quiet", "-b", "main");
  writeFileSync(path.join(seed, "README.md"), "TEST_ONLY\n");
  const commit = () => { git(seed, "add", "--", "."); git(seed, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "TEST_ONLY fixture"); };
  commit();
  git(seed, "remote", "add", "origin", remote);
  const current = fixture();
  const initialize = async () => {
    const repository = new GitSourceRegistryPersistence({ repository_path: seed });
    for (const source of current.versions) await repository.appendVersion(source);
    commit();
    git(seed, "push", "origin", "HEAD:refs/heads/main");
    return git(seed, "rev-parse", "HEAD");
  };
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  return { directory, seed, remote, current, git, commit, initialize, cleanup };
}
async function publish(current: ReturnType<typeof setup>, parent: string, claim = version(current.current.claim)) {
  const helper = (publisher as unknown as { publishSupportingInspectionClaim?: (options: unknown) => Promise<{
    committed_head: string; claim: SourcePersistenceVersion;
  }> }).publishSupportingInspectionClaim;
  assert.ok(helper, "durable publisher must exist");
  return helper({ repository_path: current.seed, branch: "main", expected_parent: parent, claim, commit_identity: identity });
}

test("claim publication returns only exact committed source reference after authoritative readback", async () => {
  const current = setup();
  try {
    const parent = await current.initialize();
    const claim = version(current.current.claim);
    const result = await publish(current, parent, claim);
    assert.notEqual(result.committed_head, parent);
    assert.equal(current.git(current.remote, "rev-parse", "refs/heads/main"), result.committed_head);
    assert.equal(canonicalSerialize(result.claim), canonicalSerialize(claim));
    assert.equal("raw_blob" in result, false);
    assert.equal("verified" in result, false);
    const repository = new GitSourceRegistryPersistence({ repository_path: current.seed });
    repository.assertAuthoritativeHead("main", result.committed_head);
    assert.equal(canonicalSerialize((await repository.listVersions()).at(-1)), canonicalSerialize(claim));
    await assert.rejects(publish(current, result.committed_head, claim));
    const nextUrl = current.current.claim.exact_url + "-other";
    const second = version({ ...current.current.claim, exact_url: nextUrl, authorization: { ...current.current.claim.authorization,
      endpoint: nextUrl, authorization_id: "TEST_ONLY:new-auth", collection_run_id: "TEST_ONLY:new-run" } });
    await assert.rejects(publish(current, result.committed_head, second), /UNRESOLVED/);
  } finally { current.cleanup(); }
});

test("stale parent, dirty tree, forged current source bindings and remote divergence cannot publish", async () => {
  for (const mutation of ["stale", "dirty", "binding", "remote"] as const) {
    const current = setup();
    try {
      const parent = await current.initialize();
      let expected = parent;
      let claim = version(current.current.claim);
      if (mutation === "stale") expected = "0".repeat(40);
      if (mutation === "dirty") writeFileSync(path.join(current.seed, "README.md"), "dirty\n");
      if (mutation === "binding") claim = version({ ...current.current.claim, bindings: {
        ...current.current.claim.bindings, source_artifact_id: current.current.claim.bindings.endpoint_artifact_id } });
      if (mutation === "remote") {
        current.git(current.seed, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "--allow-empty", "-qm", "remote advancement");
        current.git(current.seed, "push", "origin", "HEAD:refs/heads/main");
        current.git(current.seed, "reset", "--hard", parent);
      }
      await assert.rejects(publish(current, expected, claim));
      assert.equal(current.git(current.seed, "rev-parse", "HEAD"), parent);
    } finally { current.cleanup(); }
  }
});

test("rejected local-bare push never yields readback proof or retries", async () => {
  const current = setup();
  try {
    const parent = await current.initialize();
    writeFileSync(path.join(current.remote, "hooks", "pre-receive"), "#!/bin/sh\nexit 1\n");
    await assert.rejects(publish(current, parent));
    assert.equal(current.git(current.remote, "rev-parse", "refs/heads/main"), parent);
    const local = current.git(current.seed, "rev-parse", "HEAD");
    assert.notEqual(local, parent);
    await assert.rejects(publish(current, parent));
    assert.equal(current.git(current.seed, "rev-parse", "HEAD"), local);
  } finally { current.cleanup(); }
});

test("ambiguous push acknowledgement leaves committed claim spent and cannot rearm", async () => {
  const current = setup();
  try {
    const parent = await current.initialize();
    const actual = childProcess.execFileSync;
    let pushes = 0;
    const interception = mock.method(childProcess, "execFileSync", ((command: unknown, args: unknown, options: unknown) => {
      const result = Reflect.apply(actual, childProcess, [command, args, options]);
      if (command === "git" && Array.isArray(args) && args[0] === "push") {
        pushes++;
        throw new Error("TEST_ONLY_ACK_UNKNOWN");
      }
      return result;
    }) as typeof childProcess.execFileSync);
    try { await assert.rejects(publish(current, parent), /ACK_UNKNOWN/); }
    finally { interception.mock.restore(); }
    assert.equal(pushes, 1);
    const head = current.git(current.remote, "rev-parse", "refs/heads/main");
    assert.notEqual(head, parent);
    await assert.rejects(publish(current, head));
    assert.equal(current.git(current.remote, "rev-parse", "refs/heads/main"), head);
  } finally { current.cleanup(); }
});

test("publication refuses readback when remote advances after push acknowledgement", async () => {
  const current = setup();
  try {
    const parent = await current.initialize();
    const actual = childProcess.execFileSync;
    const interception = mock.method(childProcess, "execFileSync", ((command: unknown, args: unknown, options: unknown) => {
      const result = Reflect.apply(actual, childProcess, [command, args, options]);
      if (command === "git" && Array.isArray(args) && args[0] === "push") {
        Reflect.apply(actual, childProcess, ["git", ["-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`,
          "commit", "--allow-empty", "-qm", "TEST_ONLY competing advancement"], { cwd: current.seed, stdio: "pipe" }]);
        Reflect.apply(actual, childProcess, ["git", ["push", "origin", "HEAD:refs/heads/main"], { cwd: current.seed, stdio: "pipe" }]);
      }
      return result;
    }) as typeof childProcess.execFileSync);
    try { await assert.rejects(publish(current, parent)); }
    finally { interception.mock.restore(); }
    const head = current.git(current.remote, "rev-parse", "refs/heads/main");
    await assert.rejects(publish(current, head));
    assert.equal(current.git(current.remote, "rev-parse", "refs/heads/main"), head);
  } finally { current.cleanup(); }
});

test("a terminal spent target cannot be republished with a new caller authorization", async () => {
  const current = setup();
  try {
    const parent = await current.initialize();
    const result = await publish(current, parent);
    const repository = new GitSourceRegistryPersistence({ repository_path: current.seed });
    await repository.appendVersion(version({ ...current.current.claim, state: "RECEIPT", receipt: {
      collection_run_id: current.current.claim.authorization.collection_run_id, exact_url: current.current.claim.exact_url,
      acquisition_run_id: "TEST_ONLY:receipt", snapshot_id: "TEST_ONLY:snapshot", acquisition_bundle_hash: "a".repeat(64),
      request_started_at: LATER, response_received_at: LATER, transport_status: "FAILED", raw_blob_id: null } }, result.claim));
    current.commit();
    current.git(current.seed, "push", "origin", "HEAD:refs/heads/main");
    const head = current.git(current.seed, "rev-parse", "HEAD");
    const candidate = version({ ...current.current.claim, authorization: { ...current.current.claim.authorization,
      authorization_id: "TEST_ONLY:new-auth", collection_run_id: "TEST_ONLY:new-run" } });
    await assert.rejects(publish(current, head, candidate), /SPENT/);
  } finally { current.cleanup(); }
});

test("two publishers of identical claim at the same parent cannot both return readback proof", async () => {
  const current = setup();
  const previousAuthorDate = process.env.GIT_AUTHOR_DATE;
  const previousCommitterDate = process.env.GIT_COMMITTER_DATE;
  try {
    const parent = await current.initialize();
    const competing = path.join(current.directory, "competing");
    current.git(current.directory, "clone", "--quiet", "--branch", "main", current.remote, competing);
    process.env.GIT_AUTHOR_DATE = LATER;
    process.env.GIT_COMMITTER_DATE = LATER;
    const actual = childProcess.execFileSync;
    let competingProofs = 0;
    const interception = mock.method(childProcess, "execFileSync", ((command: unknown, args: unknown, options: unknown) => {
      if (command === "git" && Array.isArray(args) && args[0] === "push") {
        const input = { repository_path: competing, expected_parent: parent, branch: "main",
          claim: version(current.current.claim), commit_identity: identity };
        const code = `const {publishSupportingInspectionClaim} = require('./lib/production-persistence/supporting-inspection-publisher.ts');
          publishSupportingInspectionClaim(JSON.parse(process.argv[1])).then(value => process.stdout.write(value.committed_head))
          .catch(() => { process.exitCode = 1; });`;
        Reflect.apply(actual, childProcess, [process.execPath, ["--import", "tsx", "-e", code, JSON.stringify(input)],
          { cwd: process.cwd(), encoding: "utf8", stdio: "pipe", windowsHide: true }]);
        competingProofs++;
      }
      return Reflect.apply(actual, childProcess, [command, args, options]);
    }) as typeof childProcess.execFileSync);
    try { await assert.rejects(publish(current, parent)); }
    finally { interception.mock.restore(); }
    assert.equal(competingProofs, 1);
  } finally {
    if (previousAuthorDate === undefined) delete process.env.GIT_AUTHOR_DATE; else process.env.GIT_AUTHOR_DATE = previousAuthorDate;
    if (previousCommitterDate === undefined) delete process.env.GIT_COMMITTER_DATE; else process.env.GIT_COMMITTER_DATE = previousCommitterDate;
    current.cleanup();
  }
});

