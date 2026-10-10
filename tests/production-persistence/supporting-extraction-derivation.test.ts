import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRawValidatedRestorationJournal, GitRawObjectPersistence, type SupportingExtractionDerivation } from "../../lib/production-persistence/git-raw-object-persistence";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { ProductionRawObjectBoundary } from "../../lib/production-persistence/raw-object-boundary";
import { canonicalHash, canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { assertSOVDiscoverySupportIntegrity, validateDiscoveryEvidence, type SOVDiscoverySupport } from "../../lib/ingestion/normalization/source-discovery-support";
import { bootstrapTrustedChainCompositionRoot, InMemoryRawBlobRepository, InMemorySnapshotRepository, RawCaptureService, type TrustedChainCommand } from "../../lib/ingestion";
import { GitAppendOnlyExecutionStore } from "../../lib/production-persistence/git-append-only-execution-store";
import { createChnenergy2027SourceVersions, CHNENERGY_CAMPAIGN_URL } from "../../lib/production-sources/chnenergy-2027-source";
import { createChnenergySupportingSourceVersions } from "../../lib/production-sources/chnenergy-support-source-versions";
import { chnenergySupportingEndpoint } from "../../lib/production-sources/chnenergy-supporting-evidence";

const at = "2026-10-09T00:00:00.000Z";
const later = "2026-10-09T00:01:00.000Z";
const provenance = { scope: "PRODUCTION" as const, actor_id: "TEST_ONLY", actor_role: "TEST_ONLY", evidence_references: ["TEST_ONLY:approved"] };
const html = '<p class="lead text-center">国家能源投资集团有限责任公司2027年度高校毕业生统招公告</p><div id="anncTxt"><p>TEST_ONLY 年龄一般条件</p></div><a href="/annc/showggStationList?id=6a152f40-7fe5-460e-ad37-0024acafd8c9">招聘职位列表</a>';

test("derived rediscovery requires separately sealed references and restores through existing journal", async () => {
  const current = await setup();
  try {
    const derivation = await current.raw.appendSupportingExtractionDerivation(current.options);
    const nextAt = "2026-10-09T00:02:00.000Z";
    const recordedAt = "2026-10-09T00:03:00.000Z";
    const endpoint = chnenergySupportingEndpoint(CHNENERGY_CAMPAIGN_URL);
    const bytes = new TextEncoder().encode(html);
    const captured = new RawCaptureService(new InMemoryRawBlobRepository(), new InMemorySnapshotRepository()).record({
      recruitment_endpoint_id: endpoint.recruitment_endpoint_id, locator: endpoint.locator, method: "GET",
      headers: {}, parameters: {}, requested_at: nextAt as never
    }, { status: "SUCCESS", responded_at: nextAt as never, bytes, http_status: 200, headers: {}, mime_type: "text/html",
      content_sha256: createHash("sha256").update(bytes).digest("hex") as never });
    assert.ok(captured.raw_blob);
    assert.equal(captured.raw_blob.raw_content_sha256, current.original.raw_blob_manifest!.raw_content_sha256);
    await current.raw.appendAcquisitionBundle({
      raw_blob_manifest: current.original.raw_blob_manifest,
      acquisition_run: { ...current.original.acquisition_run, acquisition_run_id: "TEST_ONLY:second-failed-extraction",
        started_at: nextAt, completed_at: nextAt }, snapshot: captured.snapshot, extracted_records: []
    });
    const nextDerivation = await current.raw.appendSupportingExtractionDerivation({
      acquisition_run_id: "TEST_ONLY:second-failed-extraction", expected_parent: current.git("rev-parse", "HEAD"), derived_at: recordedAt
    });
    assert.notEqual(nextDerivation.derivation_id, derivation.derivation_id);
    const originalBundles = await current.raw.listVerifiedAcquisitions();
    const journal = new GitAppendOnlyExecutionStore<TrustedChainCommand>({ repository_path: current.seed,
      stream_id: "TEST_ONLY:derived-rediscovery", scope: "PRODUCTION" });
    const wrapped = createRawValidatedRestorationJournal(current.raw, journal,
      new GitSourceRegistryPersistence({ repository_path: current.seed }));
    const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "PRODUCTION", restoration_journal: wrapped });
    const original = await root.execute({ kind: "SOURCE_OCCURRENCE_MATERIALIZE", input: {
      source_role: "PACKAGE", endpoint: chnenergySupportingEndpoint(CHNENERGY_CAMPAIGN_URL),
      snapshot: current.original.snapshot, extracted_record: derivation.extracted_records[0]!
    } }, { actor: "TEST_ONLY", recorded_at: recordedAt }) as { version: { source_occurrence_version_id: string } };
    const input = { schema_version: "trusted-sov-discovery-support/4.0.0" as never,
      sov_id: original.version.source_occurrence_version_id as never, snapshot_id: captured.snapshot.snapshot_id,
      extracted_record_id: nextDerivation.extracted_records[0]!.extracted_record_id, source_role: "PACKAGE" as const };
    for (const schema of ["trusted-sov-discovery-support/1.0.0", "trusted-sov-discovery-support/2.0.0", "trusted-sov-discovery-support/3.0.0"] as const) {
      await assert.rejects(root.execute({ kind: "SOURCE_DISCOVERY_SUPPORT_VERIFY",
        input: { ...input, schema_version: schema } }, { actor: "TEST_ONLY", recorded_at: recordedAt }));
    }
    const result = await root.execute({ kind: "SOURCE_DISCOVERY_SUPPORT_VERIFY", input },
      { actor: "TEST_ONLY", recorded_at: recordedAt }) as { support: SOVDiscoverySupport };
    assert.equal(result.support.extraction_derivations!.original!.derivation_id, derivation.derivation_id);
    assert.equal(result.support.extraction_derivations!.next!.integrity_hash, nextDerivation.integrity_hash);
    for (const references of [undefined, { original: null, next: null },
      { original: result.support.extraction_derivations!.next, next: result.support.extraction_derivations!.original }]) {
      const { integrity_hash, ...changed } = { ...result.support, extraction_derivations: references };
      assert.throws(() => assertSOVDiscoverySupportIntegrity({ ...changed, integrity_hash: canonicalHash(changed) }));
    }
    const fresh = await bootstrapTrustedChainCompositionRoot({ scope: "PRODUCTION",
      restoration_journal: createRawValidatedRestorationJournal(new GitRawObjectPersistence({ repository_path: current.seed }),
        new GitAppendOnlyExecutionStore<TrustedChainCommand>({ repository_path: current.seed,
          stream_id: "TEST_ONLY:derived-rediscovery", scope: "PRODUCTION" }),
        new GitSourceRegistryPersistence({ repository_path: current.seed })) });
    assert.deepEqual(fresh.root.resolvers.source_occurrences.resolveSupport(result.support.support_id), result.support);
    assert.deepEqual(await current.raw.listVerifiedAcquisitions(), originalBundles);
  } finally { current.cleanup(); }
});

async function setup(body = html, failedTransport = false) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "sxd-TEST_ONLY-"));
  const seed = path.join(directory, "seed");
  mkdirSync(seed);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: seed, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commit = () => { git("add", "--", "."); git("-c", "user.name=TEST_ONLY", "-c", "user.email=test@invalid.local", "commit", "-qm", "TEST_ONLY fixture"); };
  git("init", "--quiet", "-b", "main");
  writeFileSync(path.join(seed, "README.md"), "TEST_ONLY");
  commit();
  const prior = createChnenergy2027SourceVersions({ observed_at: at, provenance });
  const supporting = createChnenergySupportingSourceVersions({ existing_versions: prior, approved_at: at,
    reviewer: "TEST_ONLY", approval_reference: "TEST_ONLY:approval", provenance });
  const source = new GitSourceRegistryPersistence({ repository_path: seed });
  for (const version of [...prior, ...supporting]) await source.appendVersion(version);
  commit();
  const endpoint = chnenergySupportingEndpoint(CHNENERGY_CAMPAIGN_URL);
  const endpointVersion = supporting.find(version => version.artifact.kind === "RECRUITMENT_ENDPOINT" && version.artifact.payload.locator === endpoint.locator)!;
  const allowlistVersion = supporting.find(version => version.artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST" && version.artifact.payload.recruitment_endpoint_artifact_id === endpointVersion.artifact_id)!;
  if (allowlistVersion.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST") throw new Error("fixture");
  const bytes = new TextEncoder().encode(body);
  const captured = new RawCaptureService(new InMemoryRawBlobRepository(), new InMemorySnapshotRepository()).record({
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id, locator: endpoint.locator, method: "GET", headers: {}, parameters: {}, requested_at: at as never
  }, failedTransport ? { status: "FAILED", responded_at: at as never, http_status: 401, headers: {}, mime_type: "text/html",
    error: { code: "TEST_ONLY", message: "TEST_ONLY", retryable: false } } : {
    status: "SUCCESS", responded_at: at as never, bytes, http_status: 200, headers: {}, mime_type: "text/html",
    content_sha256: createHash("sha256").update(bytes).digest("hex") as never
  });
  const bundle = { acquisition_run: { acquisition_run_id: "TEST_ONLY:failed-extraction", source_admission_artifact_id: allowlistVersion.artifact.payload.source_admission_artifact_id,
    endpoint_artifact_id: endpointVersion.artifact_id, allowlist_artifact_id: allowlistVersion.artifact_id,
    status: "FAILED" as const, started_at: at, completed_at: at,
    request_metadata: { locator: endpoint.locator, method: "GET", parameters: {} },
    result_metadata: { transport_status: failedTransport ? "FAILED" : "SUCCESS", extraction_status: "FAILED", extracted_record_count: 0 }, provenance },
    snapshot: captured.snapshot, extracted_records: [] };
  const raw = new GitRawObjectPersistence({ repository_path: seed });
  const boundary = new ProductionRawObjectBoundary(raw, raw);
  if (captured.raw_blob) await boundary.persistSuccessfulAcquisition({ raw_blob: captured.raw_blob, source_definition_id: endpoint.source_definition_id,
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id, acquired_at: at, provenance, bundle });
  else await boundary.persistFailedAcquisition(bundle);
  const original = (await raw.listVerifiedAcquisitions())[0]!;
  const head = git("rev-parse", "HEAD");
  const files = git("ls-tree", "-r", "--name-only", head).split(/\r?\n/u);
  const originalFiles = files.map(file => [file, git("rev-parse", `${head}:${file}`)]);
  return { directory, seed, git, commit, raw, original, head, originalFiles,
    options: { acquisition_run_id: original.acquisition_run.acquisition_run_id, expected_parent: head, derived_at: later },
    cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

function owner(raw: GitRawObjectPersistence) {
  const api = raw as unknown as {
    appendSupportingExtractionDerivation?: (input: unknown) => Promise<SupportingExtractionDerivation>;
    listVerifiedSupportingExtractionDerivations?: () => Promise<readonly SupportingExtractionDerivation[]>;
    readSupportingExtractionDerivation?: (id: string) => Promise<SupportingExtractionDerivation | null>;
  };
  assert.ok(api.appendSupportingExtractionDerivation, "Raw owner append derivation API required");
  assert.ok(api.listVerifiedSupportingExtractionDerivations, "Raw owner independent derivation reader required");
  assert.ok(api.readSupportingExtractionDerivation, "Raw owner exact derivation reader required");
  return api as Required<typeof api>;
}

test("existing discovery reader resolves verified derivation without rewriting original FAILED acquisition", async () => {
  const current = await setup();
  try {
    const artifact = await current.raw.appendSupportingExtractionDerivation(current.options);
    const fresh = new GitRawObjectPersistence({ repository_path: current.seed });
    const reader = createRawValidatedRestorationJournal(fresh, {
      async list() { return []; },
      async appendExecution() { throw new Error("TEST_ONLY: not a journal append"); }
    }, new GitSourceRegistryPersistence({ repository_path: current.seed }));
    assert.ok(reader.readVerifiedDiscovery);
    const evidence = await reader.readVerifiedDiscovery(current.original.snapshot.snapshot_id,
      artifact.extracted_records[0]!.extracted_record_id);
    assert.equal(evidence.acquisition.status, "FAILED");
    assert.equal(evidence.acquisition.complete, false);
    assert.deepEqual(evidence.extracted_record, artifact.extracted_records[0]);
    assert.deepEqual(await fresh.listVerifiedAcquisitions(), [current.original]);
  } finally { current.cleanup(); }
});

test("verified derived extraction reaches the existing SOV gate without claiming acquisition SUCCESS", async () => {
  const current = await setup();
  try {
    const artifact = await current.raw.appendSupportingExtractionDerivation(current.options);
    const reader = createRawValidatedRestorationJournal(current.raw, {
      async list() { return []; },
      async appendExecution() { throw new Error("TEST_ONLY: not a journal append"); }
    }, new GitSourceRegistryPersistence({ repository_path: current.seed }));
    assert.ok(reader.readVerifiedDiscovery);
    const evidence = await reader.readVerifiedDiscovery(current.original.snapshot.snapshot_id,
      artifact.extracted_records[0]!.extracted_record_id);
    assert.equal(evidence.acquisition.status, "FAILED");
    assert.equal(evidence.acquisition.complete, false);
    assert.doesNotThrow(() => validateDiscoveryEvidence(evidence, "PRODUCTION"));
    assert.ok(evidence.extraction_derivation);
    const { extraction_derivation, ...withoutProof } = evidence;
    assert.throws(() => validateDiscoveryEvidence(withoutProof, "PRODUCTION"));
    assert.throws(() => validateDiscoveryEvidence({ ...evidence,
      acquisition: { ...evidence.acquisition, status: "SUCCESS", complete: true } }, "PRODUCTION"));
    assert.throws(() => validateDiscoveryEvidence(evidence, "SYNTHETIC_TEST"));
    for (const change of [
      { outcome: "FAILED" as const },
      { integrity_hash: "0".repeat(64) },
      { derivation_id: `supporting-extraction:${"0".repeat(64)}` },
      { original: { ...extraction_derivation.original, acquisition_bundle_hash: "0".repeat(64) } },
      { original: { ...extraction_derivation.original, snapshot_canonical_hash: "0".repeat(64) } },
      { original: { ...extraction_derivation.original, raw_sha256: "0".repeat(64) } },
      { extracted_records_hash: "0".repeat(64) },
      { extracted_records: [] }
    ]) {
      assert.throws(() => validateDiscoveryEvidence({ ...evidence,
        extraction_derivation: { ...extraction_derivation, ...change } }, "PRODUCTION"));
    }
    assert.throws(() => validateDiscoveryEvidence({ ...evidence,
      raw_blob: { ...evidence.raw_blob, bytes: new Uint8Array([1]) } }, "PRODUCTION"));
    assert.deepEqual(await current.raw.listVerifiedAcquisitions(), [current.original]);
  } finally { current.cleanup(); }
});

test("existing trusted root journals derived PACKAGE and fresh root replays unchanged original acquisition", async () => {
  const current = await setup();
  let preserveFailure = false;
  try {
    const artifact = await current.raw.appendSupportingExtractionDerivation(current.options);
    const journal = new GitAppendOnlyExecutionStore<TrustedChainCommand>({ repository_path: current.seed,
      stream_id: "TEST_ONLY:derived-package", scope: "PRODUCTION" });
    const restored = await bootstrapTrustedChainCompositionRoot({ scope: "PRODUCTION",
      restoration_journal: createRawValidatedRestorationJournal(current.raw, journal,
        new GitSourceRegistryPersistence({ repository_path: current.seed })) });
    const snapshot = current.original.snapshot;
    assert.equal(snapshot.transport_status, "SUCCESS");
    if (snapshot.transport_status !== "SUCCESS") throw new Error("TEST_ONLY expected successful retained transport");
    const validInput = {
      source_role: "PACKAGE" as const, endpoint: chnenergySupportingEndpoint(CHNENERGY_CAMPAIGN_URL),
      snapshot, extracted_record: artifact.extracted_records[0]!
    };
    const unchangedHead = current.git("rev-parse", "HEAD");
    for (const input of [
      { ...validInput, snapshot: { ...validInput.snapshot, content_length: validInput.snapshot.content_length + 1 } },
      { ...validInput, extracted_record: { ...validInput.extracted_record, snapshot_id: "TEST_ONLY:wrong-snapshot" as never } },
      { ...validInput, extracted_record: { ...validInput.extracted_record, extracted_record_id: "TEST_ONLY:missing-record" as never } },
      { ...validInput, extracted_record: { ...validInput.extracted_record,
        raw_description: { text: "TEST_ONLY caller replacement", encoding: "UTF-8" as const } } }
    ]) {
      const negativeRoot = await bootstrapTrustedChainCompositionRoot({ scope: "PRODUCTION",
        restoration_journal: createRawValidatedRestorationJournal(new GitRawObjectPersistence({ repository_path: current.seed }),
          new GitAppendOnlyExecutionStore<TrustedChainCommand>({ repository_path: current.seed,
            stream_id: "TEST_ONLY:derived-package", scope: "PRODUCTION" }),
          new GitSourceRegistryPersistence({ repository_path: current.seed })) });
      await assert.rejects(negativeRoot.root.execute({ kind: "SOURCE_OCCURRENCE_MATERIALIZE", input },
        { actor: "TEST_ONLY", recorded_at: later }));
      assert.deepEqual(await journal.list(), []);
      assert.equal(current.git("rev-parse", "HEAD"), unchangedHead);
    }
    await restored.root.execute({ kind: "SOURCE_OCCURRENCE_MATERIALIZE", input: {
      source_role: "PACKAGE", endpoint: chnenergySupportingEndpoint(CHNENERGY_CAMPAIGN_URL),
      snapshot: current.original.snapshot, extracted_record: artifact.extracted_records[0]!
    } }, { actor: "TEST_ONLY", recorded_at: later });
    const before = await journal.list();
    assert.equal(before.length, 1);
    const freshJournal = new GitAppendOnlyExecutionStore<TrustedChainCommand>({ repository_path: current.seed,
      stream_id: "TEST_ONLY:derived-package", scope: "PRODUCTION" });
    await bootstrapTrustedChainCompositionRoot({ scope: "PRODUCTION",
      restoration_journal: createRawValidatedRestorationJournal(
        new GitRawObjectPersistence({ repository_path: current.seed }), freshJournal,
        new GitSourceRegistryPersistence({ repository_path: current.seed })) });
    assert.deepEqual(await freshJournal.list(), before);
    assert.deepEqual(await current.raw.listVerifiedAcquisitions(), [current.original]);
    const childCode = `require('./tests/helpers/network-guard.ts');
      const {bootstrapTrustedChainCompositionRoot}=require('./lib/ingestion/index.ts');
      const {GitRawObjectPersistence,createRawValidatedRestorationJournal}=require('./lib/production-persistence/git-raw-object-persistence.ts');
      const {GitSourceRegistryPersistence}=require('./lib/production-persistence/git-source-registry-persistence.ts');
      const {GitAppendOnlyExecutionStore}=require('./lib/production-persistence/git-append-only-execution-store.ts');
      const {canonicalHash}=require('./lib/ingestion/normalization/canonical-artifact-registry.ts');
      (async()=>{
        const raw=new GitRawObjectPersistence({repository_path:process.argv[1]});
        const journal=new GitAppendOnlyExecutionStore({repository_path:process.argv[1],stream_id:'TEST_ONLY:derived-package',scope:'PRODUCTION'});
        const wrapped=createRawValidatedRestorationJournal(raw,journal,new GitSourceRegistryPersistence({repository_path:process.argv[1]}));
        await bootstrapTrustedChainCompositionRoot({scope:'PRODUCTION',restoration_journal:wrapped});
        const records=await wrapped.list();
        const original=await raw.listVerifiedAcquisitions();
        process.stdout.write(JSON.stringify({pid:process.pid,count:records.length,journal:canonicalHash(records),original:canonicalHash(original)}));
      })().catch(error=>{console.error(error);process.exitCode=1});`;
    const child = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "-e", childCode, current.seed], {
      cwd: process.cwd(), encoding: "utf8", windowsHide: true, timeout: 60_000
    }));
    assert.notEqual(child.pid, process.pid);
    assert.equal(child.count, 1);
    assert.equal(child.journal, canonicalHash(before));
    assert.equal(child.original, canonicalHash([current.original]));
    for (const [file, hash] of current.originalFiles) assert.equal(current.git("rev-parse", `HEAD:${file}`), hash);

    const { integrity_hash, derivation_id, ...originalContent } = artifact;
    const content = { ...originalContent, original: { ...originalContent.original, snapshot_canonical_hash: "0".repeat(64) } };
    const withId = { ...content, derivation_id: `supporting-extraction:${canonicalHash(content)}` };
    current.git("rm", "--", `trusted-objects/supporting-extraction-derivations/${derivation_id.split(":")[1]}.json`);
    mkdirSync(path.join(current.seed, "trusted-objects/supporting-extraction-derivations"), { recursive: true });
    writeFileSync(path.join(current.seed, `trusted-objects/supporting-extraction-derivations/${withId.derivation_id.split(":")[1]}.json`),
      canonicalSerialize({ ...withId, integrity_hash: canonicalHash(withId) }));
    current.commit();
    const adverseJournal = createRawValidatedRestorationJournal(new GitRawObjectPersistence({ repository_path: current.seed }),
      new GitAppendOnlyExecutionStore<TrustedChainCommand>({ repository_path: current.seed,
        stream_id: "TEST_ONLY:derived-package", scope: "PRODUCTION" }),
      new GitSourceRegistryPersistence({ repository_path: current.seed }));
    await assert.rejects(adverseJournal.list(), /Supporting derivation/);
    await assert.rejects(bootstrapTrustedChainCompositionRoot({ scope: "PRODUCTION", restoration_journal: adverseJournal }),
      /Supporting derivation/);
    assert.deepEqual(await current.raw.listVerifiedAcquisitions(), [current.original]);
    for (const [file, hash] of current.originalFiles) assert.equal(current.git("rev-parse", `HEAD:${file}`), hash);
  } catch (error) {
    preserveFailure = true;
    console.error("TEST_ONLY retained failed journal fixture:", current.seed);
    throw error;
  } finally { if (!preserveFailure) current.cleanup(); }
});

test("fixed parser derives COMPLETE from retained successful transport without changing FAILED acquisition or historical bytes", async () => {
  const current = await setup();
  try {
    const artifact = await owner(current.raw).appendSupportingExtractionDerivation(current.options);
    assert.equal(artifact.outcome, "COMPLETE");
    assert.equal(artifact.extracted_records.length, 1);
    assert.deepEqual(await current.raw.listVerifiedAcquisitions(), [current.original]);
    assert.equal(current.original.acquisition_run.status, "FAILED");
    for (const [file, hash] of current.originalFiles) assert.equal(current.git("rev-parse", `HEAD:${file}`), hash);
    const fresh = new GitRawObjectPersistence({ repository_path: current.seed });
    assert.deepEqual(await owner(fresh).readSupportingExtractionDerivation(artifact.derivation_id), artifact);
    assert.equal((await owner(fresh).listVerifiedSupportingExtractionDerivations()).length, 1);
    const nextHead = current.git("rev-parse", "HEAD");
    assert.deepEqual(await owner(fresh).appendSupportingExtractionDerivation({ ...current.options, expected_parent: nextHead }), artifact);
    assert.equal(current.git("rev-parse", "HEAD"), nextHead);
    await assert.rejects(owner(fresh).appendSupportingExtractionDerivation({ ...current.options, expected_parent: nextHead, derived_at: "2026-10-09T00:02:00.000Z" }));
  } finally { current.cleanup(); }
});

test("failed transport is refused and parser refusal appends only FAILED extraction", async () => {
  for (const failedTransport of [true, false]) {
    const current = await setup("<p>TEST_ONLY missing campaign body</p>", failedTransport);
    try {
      if (failedTransport) {
        await assert.rejects(owner(current.raw).appendSupportingExtractionDerivation(current.options));
        assert.equal(current.git("rev-parse", "HEAD"), current.head);
      } else {
        const artifact = await owner(current.raw).appendSupportingExtractionDerivation(current.options);
        assert.equal(artifact.outcome, "FAILED");
        assert.equal(artifact.extracted_records.length, 0);
        assert.deepEqual(await owner(new GitRawObjectPersistence({ repository_path: current.seed })).readSupportingExtractionDerivation(artifact.derivation_id), artifact);
      }
    } finally { current.cleanup(); }
  }
});

test("caller records flags adapters transports wrong acquisition future time stale HEAD and dirty state cannot authorize derivation", async () => {
  const current = await setup();
  try {
    for (const extra of [{ records: [] }, { completion: true }, { adapter: {} }, { transport: {} }, { bytes: [] },
      { acquisition_run_id: "TEST_ONLY:missing" }, { derived_at: "2099-01-01T00:00:00.000Z" }, { expected_parent: "0".repeat(40) }]) {
      await assert.rejects(owner(current.raw).appendSupportingExtractionDerivation({ ...current.options, ...extra }));
    }
    writeFileSync(path.join(current.seed, "README.md"), "dirty");
    await assert.rejects(owner(current.raw).appendSupportingExtractionDerivation(current.options));
    assert.equal(current.git("rev-parse", "HEAD"), current.head);
  } finally { current.cleanup(); }
});

test("independent reader rejects hash-addressed artifact tampering and altered original Raw", async () => {
  for (const mutateRaw of [false, true]) {
    const current = await setup();
    try {
      await owner(current.raw).appendSupportingExtractionDerivation(current.options);
      const files = current.git("ls-tree", "-r", "--name-only", "HEAD").split(/\r?\n/u);
      const file = files.find(value => value.includes(mutateRaw ? "/objects/sha256/" : "/supporting-extraction-derivations/"))!;
      assert.ok(file);
      writeFileSync(path.join(current.seed, file), mutateRaw ? "TEST_ONLY tampered bytes" : "{}");
      current.commit();
      await assert.rejects(owner(new GitRawObjectPersistence({ repository_path: current.seed })).listVerifiedSupportingExtractionDerivations());
    } finally { current.cleanup(); }
  }
});

test("fresh child process independently reconstructs canonical derivation with original acquisition unchanged", async () => {
  const current = await setup();
  try {
    const artifact = await owner(current.raw).appendSupportingExtractionDerivation(current.options);
    const code = `const {GitRawObjectPersistence}=require('./lib/production-persistence/git-raw-object-persistence.ts');
      const {canonicalHash}=require('./lib/ingestion/normalization/canonical-artifact-registry.ts');
      const raw=new GitRawObjectPersistence({repository_path:process.argv[1]});
      Promise.all([raw.listVerifiedSupportingExtractionDerivations(),raw.listVerifiedAcquisitions()])
        .then(([derived,original])=>process.stdout.write(JSON.stringify({hash:canonicalHash(derived[0]),original:canonicalHash(original[0])})))
        .catch(()=>{process.exitCode=1});`;
    const restored = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "-e", code, current.seed], {
      cwd: process.cwd(), encoding: "utf8", windowsHide: true
    }));
    assert.equal(restored.hash, canonicalHash(artifact));
    assert.equal(restored.original, canonicalHash(current.original));
    assert.ok(canonicalSerialize(artifact).includes("1.1.0"));
  } finally { current.cleanup(); }
});

test("re-sealed content-addressed output forgery or duplicate derivation is independently rejected", async () => {
  for (const duplicate of [false, true]) {
    const current = await setup();
    try {
      const artifact = await owner(current.raw).appendSupportingExtractionDerivation(current.options);
      const { integrity_hash, derivation_id, ...originalContent } = artifact;
      const content = duplicate ? { ...originalContent, derived_at: "2026-10-09T00:02:00.000Z" }
        : { ...originalContent, original: { ...originalContent.original, acquisition_status: "SUCCESS" as const } };
      const withId = { ...content, derivation_id: `supporting-extraction:${canonicalHash(content)}` };
      const forged = { ...withId, integrity_hash: canonicalHash(withId) };
      if (!duplicate) current.git("rm", "--", `trusted-objects/supporting-extraction-derivations/${derivation_id.split(":")[1]}.json`);
      mkdirSync(path.join(current.seed, "trusted-objects/supporting-extraction-derivations"), { recursive: true });
      writeFileSync(path.join(current.seed, `trusted-objects/supporting-extraction-derivations/${withId.derivation_id.split(":")[1]}.json`), canonicalSerialize(forged));
      if (duplicate) current.commit();
      else {
        current.git("add", "--", ".");
        current.git("-c", "user.name=TEST_ONLY", "-c", "user.email=test@invalid.local", "commit", "--amend", "--no-edit", "--quiet");
      }
      await assert.rejects(owner(new GitRawObjectPersistence({ repository_path: current.seed })).listVerifiedSupportingExtractionDerivations());
    } finally { current.cleanup(); }
  }
});

test("reader reparses original bytes instead of trusting caller-resealed COMPLETE records", async () => {
  const current = await setup("<p>TEST_ONLY invalid retained body</p>");
  try {
    const artifact = await owner(current.raw).appendSupportingExtractionDerivation(current.options);
    const { integrity_hash, derivation_id, ...originalContent } = artifact;
    const content = { ...originalContent, outcome: "COMPLETE" as const, failure_code: null };
    const withId = { ...content, derivation_id: `supporting-extraction:${canonicalHash(content)}` };
    current.git("rm", "--", `trusted-objects/supporting-extraction-derivations/${derivation_id.split(":")[1]}.json`);
    mkdirSync(path.join(current.seed, "trusted-objects/supporting-extraction-derivations"), { recursive: true });
    writeFileSync(path.join(current.seed, `trusted-objects/supporting-extraction-derivations/${withId.derivation_id.split(":")[1]}.json`),
      canonicalSerialize({ ...withId, integrity_hash: canonicalHash(withId) }));
    current.git("add", "--", ".");
    current.git("-c", "user.name=TEST_ONLY", "-c", "user.email=test@invalid.local", "commit", "--amend", "--no-edit", "--quiet");
    await assert.rejects(owner(new GitRawObjectPersistence({ repository_path: current.seed })).readSupportingExtractionDerivation(withId.derivation_id));
  } finally { current.cleanup(); }
});

test("same Snapshot in multiple acquisitions cannot establish a unique original derivation", async () => {
  const current = await setup();
  try {
    await current.raw.appendAcquisitionBundle({ ...current.original, acquisition_run: { ...current.original.acquisition_run,
      acquisition_run_id: "TEST_ONLY:duplicate-snapshot" } });
    const head = current.git("rev-parse", "HEAD");
    await assert.rejects(owner(current.raw).appendSupportingExtractionDerivation({ ...current.options, expected_parent: head }));
    assert.equal(current.git("rev-parse", "HEAD"), head);
  } finally { current.cleanup(); }
});
