import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { InMemorySourceAdmissionRegister } from "../../lib/application/source-admission";
import { InMemorySourceRegistry } from "../../lib/ingestion";
import { createSourcePersistenceVersion, type SourcePersistenceVersion } from "../../lib/production-persistence/contracts";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { rehydrateProductionSourceOwners } from "../../lib/production-persistence/source-owner-rehydration";
import { canonicalHash, canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { sealQueryAuthorizationContract } from "../../lib/application/source-admission/query-authorization";
import { PostgresProductionPersistence } from "../../lib/production-persistence/postgres-production-persistence";
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
async function restore(versions: readonly SourcePersistenceVersion[]) {
  const owner = new InMemorySourceAdmissionRegister();
  await rehydrateProductionSourceOwners({ repository: { async listVersions() { return versions; }, async appendVersion() { throw new Error("read only"); } },
    source_registry: new InMemorySourceRegistry(), source_admission_register: owner });
  const list = (owner as unknown as { listSupportingInspections?: () => unknown[] }).listSupportingInspections;
  assert.ok(list, "existing SourceAdmission owner must restore inspections");
  return list.call(owner) as { state: string; authorization: { authorization_id: string } }[];
}

test("explicit claim is restored unresolved in existing SourceAdmission owner", async () => {
  const current = fixture();
  const claim = version(current.claim);
  const restored = await restore([...current.versions, claim]);
  assert.equal(restored[0]!.state, "CLAIMED");
  assert.equal(restored[0]!.authorization.authorization_id, current.claim.authorization.authorization_id);
});

test("six historical source artifacts retain canonical bytes and no default inspection fields", async () => {
  const current = fixture();
  for (const source of current.versions) {
    const rebuilt = createSourcePersistenceVersion({ stream_id: source.stream_id, revision: source.revision,
      supersedes_artifact_id: source.supersedes_artifact_id, artifact: source.artifact, provenance: source.provenance,
      effective_at: source.effective_at, created_at: source.created_at });
    assert.equal(canonicalSerialize(rebuilt), canonicalSerialize(source));
    assert.equal("supporting_inspections" in source, false);
  }
  assert.deepEqual(await restore(current.versions), []);
});

const negatives: readonly [string, (claim: ReturnType<typeof fixture>["claim"]) => object][] = [
  ["wrong schema", claim => ({ ...claim, schema_version: "unknown" })],
  ["caller verified flag", claim => ({ ...claim, verified: true })],
  ["wrong query hash", claim => ({ ...claim, query_contract_hash: "f".repeat(64) })],
  ["wrong exact URL", claim => ({ ...claim, exact_url: claim.exact_url + "&extra=1" })],
  ["POST", claim => ({ ...claim, method: "POST" })],
  ["missing manual confirmation", claim => ({ ...claim, authorization: { ...claim.authorization, manual_confirmation: false } })],
  ["wrong source artifact", claim => ({ ...claim, bindings: { ...claim.bindings, source_artifact_id: claim.bindings.endpoint_artifact_id } })],
  ["claim before authorization", claim => ({ ...claim, claimed_at: "2026-01-01T00:00:00.000Z" })],
  ["receipt without claim", claim => ({ ...claim, state: "RECEIPT", receipt: receipt() })],
  ["claim with terminal data", claim => ({ ...claim, receipt: receipt() })]
];
for (const [name, mutate] of negatives) {
  test(`inspection rejects ${name}`, async () => {
    const current = fixture();
    await assert.rejects(async () => restore([...current.versions, version(mutate(current.claim))]));
  });
}
function receipt() {
  return { acquisition_run_id: "TEST_ONLY:inspection-run:acquisition:1", snapshot_id: "TEST_ONLY:snapshot",
    collection_run_id: "TEST_ONLY:inspection-run", exact_url: "https://example.invalid/recruitment?id=TEST_ONLY",
    acquisition_bundle_hash: canonicalHash("TEST_ONLY:bundle"), request_started_at: LATER, response_received_at: LATER,
    transport_status: "SUCCESS", raw_blob_id: `sha256:${"a".repeat(64)}` };
}

test("explicit receipt and UNKNOWN close once without rearming authorization", async () => {
  for (const terminal of [{ state: "RECEIPT", receipt: receipt() },
    { state: "UNKNOWN", unknown: { recorded_at: LATER, reason: "SEND_STATE_UNKNOWN" } }]) {
    const current = fixture();
    const first = version(current.claim);
    const last = version({ ...current.claim, ...terminal }, first);
    assert.equal((await restore([...current.versions, first, last]))[0]!.state, terminal.state);
    await assert.rejects(async () => restore([...current.versions, first, last, version(current.claim, last)]));
  }
});

test("terminal receipt must refer to the claimed run and exact target", async () => {
  const current = fixture();
  const first = version(current.claim);
  for (const changes of [{ collection_run_id: "other-run" }, { exact_url: "https://example.invalid/other" }]) {
    await assert.rejects(async () => restore([...current.versions, first,
      version({ ...current.claim, state: "RECEIPT", receipt: { ...receipt(), ...changes } }, first)]));
  }
});

test("future or superseded source references, unapproved admission and oversized collection are rejected", async () => {
  for (const mutation of ["future", "superseded", "rejected", "budget"] as const) {
    const current = fixture();
    const index = current.versions.findIndex(item => item.artifact.kind === (mutation === "budget" ? "RECRUITMENT_ENDPOINT" : "SOURCE_ADMISSION"));
    const original = current.versions[index]!;
    let artifact = original.artifact;
    if (mutation === "rejected" && artifact.kind === "SOURCE_ADMISSION") artifact = { ...artifact, payload: { ...artifact.payload, admission_decision: "REJECTED" } };
    if (mutation === "budget" && artifact.kind === "RECRUITMENT_ENDPOINT") artifact = { ...artifact,
      payload: { ...artifact.payload, collection_config: { ...artifact.payload.collection_config, max_pages: 2 } } };
    const replacement = createSourcePersistenceVersion({ stream_id: original.stream_id, revision: mutation === "superseded" ? 2 : 1,
      supersedes_artifact_id: mutation === "superseded" ? original.artifact_id : null, artifact, provenance,
      created_at: mutation === "future" ? "2027-01-01T00:00:00.000Z" : AT,
      effective_at: mutation === "future" ? "2027-01-01T00:00:00.000Z" : AT });
    if (mutation === "superseded") current.versions.push(replacement);
    else {
      current.versions[index] = replacement;
      if (mutation === "budget") current.claim.bindings.endpoint_artifact_id = replacement.artifact_id;
      else current.claim.bindings.admission_artifact_id = replacement.artifact_id;
    }
    await assert.rejects(async () => restore([...current.versions, version(current.claim)]));
  }
});

test("PostgreSQL explicitly rejects inspection artifacts without calling an RPC", async () => {
  let calls = 0;
  const database = { async query() { calls++; throw new Error("UNEXPECTED_DATABASE_CALL"); },
    async transaction() { throw new Error("UNEXPECTED_DATABASE_CALL"); } };
  const repository = new PostgresProductionPersistence(database);
  await assert.rejects(repository.appendVersion(version(fixture().claim)), /not implemented for PostgreSQL/);
  assert.equal(calls, 0);
});

test("duplicate run or authorization, identity changes and terminal rewrite fail closed", async () => {
  const current = fixture();
  const first = version(current.claim);
  await assert.rejects(async () => restore([...current.versions, first, version({ ...current.claim,
    authorization: { ...current.claim.authorization, authorization_id: "TEST_ONLY:second-auth" } })]));
  await assert.rejects(async () => restore([...current.versions, first, version(current.claim, first)]));
  await assert.rejects(async () => restore([...current.versions, first, version({ ...current.claim, state: "UNKNOWN",
    authorization: { ...current.claim.authorization, collection_run_id: "other" }, unknown: { recorded_at: LATER, reason: "SEND_STATE_UNKNOWN" } }, first)]));
  const last = version({ ...current.claim, state: "UNKNOWN", unknown: { recorded_at: LATER, reason: "SEND_STATE_UNKNOWN" } }, first);
  await assert.rejects(async () => restore([...current.versions, first, last, version({ ...current.claim, state: "RECEIPT", receipt: receipt() }, last)]));
});

test("Git append is collision safe and committed fresh process retains unresolved CLAIMED", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "supporting-inspection-TEST_ONLY-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8", windowsHide: true });
  const commit = () => { git("add", "--", "."); git("-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "TEST_ONLY fixture"); };
  try {
    git("init", "--quiet"); writeFileSync(path.join(directory, "README.md"), "TEST_ONLY\n"); commit();
    const current = fixture();
    const repository = new GitSourceRegistryPersistence({ repository_path: directory });
    for (const item of current.versions) await repository.appendVersion(item);
    commit();
    const historicalBytes = (await repository.listVersions()).map(item => canonicalSerialize(item));
    const first = version(current.claim);
    assert.equal(await repository.appendVersion(first), "APPENDED");
    assert.equal(await repository.appendVersion(first), "IDEMPOTENT_REUSE");
    await assert.rejects(repository.appendVersion({ ...first, artifact: { ...first.artifact,
      payload: { ...current.claim, exact_url: "https://example.invalid/forged" } } } as unknown as SourcePersistenceVersion));
    await assert.rejects(repository.appendVersion(version({ ...current.claim,
      authorization: { ...current.claim.authorization, authorization_id: "TEST_ONLY:other" } })));
    commit();
    const restarted = new GitSourceRegistryPersistence({ repository_path: directory });
    assert.deepEqual((await restarted.listVersions()).slice(0, 6).map(item => canonicalSerialize(item)), historicalBytes);
    assert.equal((await restore(await restarted.listVersions()))[0]!.state, "CLAIMED");
    const code = `const { GitSourceRegistryPersistence } = require('./lib/production-persistence/git-source-registry-persistence.ts');
      const { rehydrateProductionSourceOwners } = require('./lib/production-persistence/source-owner-rehydration.ts');
      const { InMemorySourceAdmissionRegister } = require('./lib/application/source-admission/index.ts');
      const { InMemorySourceRegistry } = require('./lib/ingestion/index.ts');
      (async () => {
      const owner = new InMemorySourceAdmissionRegister();
      await rehydrateProductionSourceOwners({ repository: new GitSourceRegistryPersistence({repository_path: process.argv[1]}), source_registry: new InMemorySourceRegistry(), source_admission_register: owner });
      process.stdout.write(owner.listSupportingInspections()[0].state);
      })().catch(() => { process.exitCode = 1; });`;
    assert.equal(execFileSync(process.execPath, ["--import", "tsx", "-e", code, directory],
      { cwd: process.cwd(), encoding: "utf8", windowsHide: true }), "CLAIMED");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
