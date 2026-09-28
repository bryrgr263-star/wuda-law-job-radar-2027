import "../helpers/network-guard";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { bootstrapTrustedChainCompositionRoot, type TrustedChainCommand,
  type TrustedRestorationExecution } from "../../lib/ingestion";
import { isExtractedRecordV2 } from "../../lib/ingestion/normalization/extracted-record-identity";
import type { SOVDiscoveryEvidence } from "../../lib/ingestion/normalization/source-discovery-support";
import { GitAppendOnlyExecutionStore } from "../../lib/production-persistence/git-append-only-execution-store";
import { GitRawObjectPersistence, createRawValidatedRestorationJournal } from
  "../../lib/production-persistence/git-raw-object-persistence";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { executeProductionTrustedChainBinding } from
  "../../lib/production-persistence/production-trusted-chain-execution-binding";

const run2Raw = new Set([
  "cf85b01309aa9da0286fe1aceb3aaa7788397d1844c1cfed3b47819e574276d9",
  "cd045bfc9415bfd52b76dc2f890098b15f95f67d33c8a9307f2414a59d5934cb"
]);

test("committed Run 2 Zhenghan discoveries issue auditable support without changing Run 1 SOV", async (context) => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "run2-evidence-"));
  const repositoryPath = path.join(temporary, "repo");
  context.after(() => rmSync(temporary, { recursive: true, force: true }));
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", process.cwd(), repositoryPath]);
  const raw = new GitRawObjectPersistence({ repository_path: repositoryPath });
  const source = new GitSourceRegistryPersistence({ repository_path: repositoryPath });
  const store = new GitAppendOnlyExecutionStore<TrustedChainCommand>({ repository_path: repositoryPath,
    stream_id: "initial-production-source-activation", scope: "PRODUCTION" });
  const historic = createRawValidatedRestorationJournal(raw, store, source);
  const committedRecords = await historic.list();
  const committedExecutions = store.listVerifiedExecutions();
  const committedEnvelopes = committedExecutions.flatMap(item => item.artifact_envelopes);
  const discoveryCache = new Map<string, SOVDiscoveryEvidence>();
  const extra: TrustedRestorationExecution<TrustedChainCommand>[] = [];
  const journal = {
    ...historic,
    async list() { return [...committedRecords, ...extra.map(item => item.record)]; },
    async readVerifiedDiscovery(snapshotId: string, recordId: string) {
      const key = `${snapshotId}\0${recordId}`;
      let evidence = discoveryCache.get(key);
      if (!evidence) {
        evidence = await historic.readVerifiedDiscovery!(snapshotId, recordId);
        discoveryCache.set(key, structuredClone(evidence));
      }
      return structuredClone(evidence);
    },
    async appendExecution(execution: TrustedRestorationExecution<TrustedChainCommand>) {
      extra.push(structuredClone(execution));
      return "APPENDED" as const;
    },
    async readArtifactEnvelope(kind: string, id: string, scope: "PRODUCTION" | "SYNTHETIC_TEST") {
      const appended = extra.flatMap(item => item.artifact_envelopes).find(item =>
        item.artifact_kind === kind && item.artifact_id === id && item.scope === scope);
      const committed = committedEnvelopes.find(item => item.artifact_kind === kind
        && item.artifact_id === id && item.scope === scope);
      return structuredClone(appended ?? committed ?? null);
    }
  };
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "PRODUCTION", restoration_journal: journal });
  const bundles = (await raw.listVerifiedAcquisitions()).filter(bundle =>
    bundle.raw_blob_manifest && run2Raw.has(bundle.raw_blob_manifest.raw_content_sha256));
  assert.equal(bundles.length, 2);
  let positionCount = 0;
  const sourceOccurrences: unknown[] = [];
  for (const bundle of bundles) {
    for (const record of bundle.extracted_records) {
      assert.ok(isExtractedRecordV2(record));
      const discovery = await journal.readVerifiedDiscovery(bundle.snapshot.snapshot_id, record.extracted_record_id);
      const role = record.recruitment_context ? "POSITION_BEARING" : "PACKAGE";
      const current = root.resolvers.source_occurrences.resolveForDiscovery({ source_role: role,
        endpoint: discovery.endpoint, snapshot: bundle.snapshot, extracted_record: record });
      assert.ok(current, `Missing existing SOV for ${record.extracted_record_id}`);
      const issued = await root.execute({ kind: "SOURCE_DISCOVERY_SUPPORT_VERIFY", input: {
        schema_version: "trusted-sov-discovery-support/2.0.0",
        sov_id: current.version.source_occurrence_version_id, snapshot_id: bundle.snapshot.snapshot_id,
        extracted_record_id: record.extracted_record_id, source_role: role
      } }, { actor: "offline-run2-evidence-replay", recorded_at: "2026-09-28T05:17:29.442Z" }) as {
        support: { support_id: string; discovery: { raw_sha256: string };
          equivalence: { raw_equivalence?: { authoritative_html_sha256: string } } }
      };
      assert.equal(issued.support.discovery.raw_sha256, bundle.raw_blob_manifest!.raw_content_sha256);
      assert.ok(issued.support.equivalence.raw_equivalence?.authoritative_html_sha256);
      assert.equal(root.resolvers.source_occurrences.resolve(current.version.source_occurrence_version_id)?.version.revision,
        current.version.revision);
      sourceOccurrences.push({ ...current, discovery_support_id: issued.support.support_id });
      if (role === "POSITION_BEARING") positionCount += 1;
    }
  }
  assert.equal(positionCount, 3);
  assert.equal(extra.length, 4);
  await executeProductionTrustedChainBinding({
    source_occurrences: sourceOccurrences,
    snapshots: bundles.map(bundle => bundle.snapshot),
    extracted_records: bundles.flatMap(bundle => bundle.extracted_records.filter(isExtractedRecordV2)),
    available_artifact_references: [
      ...committedExecutions, ...extra
    ].flatMap(execution => execution.record.expected_artifacts.map(seal => ({
      artifact_kind: seal.artifact_kind, artifact_id: seal.artifact_id
    }))),
    resolvers: root.resolvers,
    execute: command => root.execute(command, { actor: "offline-run2-evidence-replay",
      recorded_at: "2026-09-28T05:17:29.442Z" })
  });
  assert.ok(extra.some(item => item.record.command.kind === "PRESENTATION_DECIDE"));
  assert.ok(extra.some(item => item.record.command.kind === "PRESENTATION_READ_MODEL_MATERIALIZE"));
  const decisions = extra.flatMap(item => item.artifact_envelopes)
    .filter(item => item.artifact_kind === "PRESENTATION_DECISION")
    .map(item => JSON.parse(item.canonical_bytes) as { status: string; reason_codes: readonly string[];
      position_id: string | null; revision: number });
  assert.equal(decisions.length, 3);
  assert.equal(new Set(decisions.map(item => item.position_id)).size, 3);
  assert.ok(decisions.every(item => item.status === "EVIDENCE_BLOCKED"));
  assert.ok(decisions.every(item => !item.reason_codes.includes("RELEVANCE_ASSESSMENT_MISSING")));
  assert.ok(decisions.every(item => item.revision > 1));
  const restored = await bootstrapTrustedChainCompositionRoot({ scope: "PRODUCTION", restoration_journal: journal });
  assert.equal(restored.root.resolvers.source_occurrences.resolveSupport(
    extra[0]!.record.expected_artifacts.find(item => item.artifact_kind === "SOV_DISCOVERY_SUPPORT")!.artifact_id)?.scope,
  "PRODUCTION");
});
