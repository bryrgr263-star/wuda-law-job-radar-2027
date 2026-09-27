import "../helpers/network-guard";

import assert from "node:assert/strict";
import { bootstrapTrustedChainCompositionRoot, type TrustedChainCommand, type TrustedRestorationExecution } from "../../lib/ingestion";
import { canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { GitAppendOnlyExecutionStore } from "../../lib/production-persistence/git-append-only-execution-store";
import { createRawValidatedRestorationJournal, GitRawObjectPersistence } from "../../lib/production-persistence/git-raw-object-persistence";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { executeProductionTrustedChainBinding } from "../../lib/production-persistence/production-trusted-chain-execution-binding";

async function main() {
  const repositoryPath = process.argv[2];
  const mode = process.argv[3];
  const store = new GitAppendOnlyExecutionStore<TrustedChainCommand>({
    repository_path: repositoryPath, stream_id: "initial-production-source-activation", scope: "PRODUCTION"
  });
  const verified = createRawValidatedRestorationJournal(
    new GitRawObjectPersistence({ repository_path: repositoryPath }), store,
    new GitSourceRegistryPersistence({ repository_path: repositoryPath })
  );
  const records = await verified.list();
  const originalExecutions = store.listVerifiedExecutions();
  const captured: TrustedRestorationExecution<TrustedChainCommand>[] = [];
  const journal = mode === "execute" ? { ...verified,
    appendExecution: async (execution: TrustedRestorationExecution<TrustedChainCommand>) => {
      captured.push(execution);
      return "APPENDED" as const;
    }
  } : verified;
  const root = (await bootstrapTrustedChainCompositionRoot({ scope: "PRODUCTION", restoration_journal: journal })).root;
  if (mode === "execute") {
    assert.equal(records.length, 26);
    const sourceIds = originalExecutions.flatMap((execution) => execution.record.expected_artifacts)
      .filter((seal) => seal.artifact_kind === "SOURCE_OCCURRENCE_VERSION");
    const sources = sourceIds.map((seal) => {
      const source = root.resolvers.source_occurrences.resolve(seal.artifact_id as never);
      assert.ok(source);
      return source;
    });
    await executeProductionTrustedChainBinding({
      source_occurrences: sources,
      snapshots: sources.map((source) => source.snapshot),
      extracted_records: sources.map((source) => source.extracted_record),
      available_artifact_references: originalExecutions.flatMap((execution) => execution.record.expected_artifacts),
      resolvers: root.resolvers,
      execute: (command) => root.execute(command, { actor: "offline-business-chain-regression", recorded_at: "2026-09-27T07:00:00Z" })
    });
  }
  const executions = [...originalExecutions, ...captured];
  const appended = executions.slice(26);
  assert.equal(appended.filter((execution) => execution.record.command_kind === "SOURCE_COMPOSITION_MATERIALIZE").length, 4);
  assert.equal(appended.filter((execution) => execution.record.command_kind === "LEGAL_RELEVANCE_ASSESS").length, 4);
  assert.equal(appended.filter((execution) => /REQUIREMENT|PREDICATE|ELIGIBILITY|CANDIDATE_EVIDENCE/u.test(execution.record.command_kind)).length, 0);
  for (const execution of appended) {
    for (const artifact of execution.artifact_envelopes) {
      const payload = JSON.parse(artifact.canonical_bytes);
      if (artifact.artifact_kind === "SOURCE_COMPOSITION") {
        assert.equal(payload.inventory.inventory_completeness_status, "OPEN_UNRESOLVED");
        assert.notEqual(payload.status, "COMPLETE");
        const restored = root.resolvers.source_compositions.resolve(payload.source_composition_id);
        assert.equal(canonicalSerialize(restored), artifact.canonical_bytes);
        assert.ok(payload.inventory.expected_surface_entries.some((entry: { expectedness: string; binding_status: string }) =>
          entry.expectedness === "REQUIRED" && entry.binding_status === "RESOLVED"));
      }
      if (artifact.artifact_kind === "LEGAL_RELEVANCE") {
        assert.equal(payload.assessment_state, "REVIEW_REQUIRED");
        assert.equal(canonicalSerialize(root.resolvers.relevance.resolve(payload.assessment_id)), artifact.canonical_bytes);
      }
      if (artifact.artifact_kind === "PRESENTATION_DECISION") {
        assert.equal(payload.status, "EVIDENCE_BLOCKED");
        assert.ok(!payload.reason_codes.includes("RELEVANCE_ASSESSMENT_MISSING"));
        assert.ok(payload.relevance_assessment_id);
        assert.equal(payload.revision, 2);
        assert.equal(canonicalSerialize(root.resolvers.presentation_decisions.resolve(payload.presentation_decision_id)), artifact.canonical_bytes);
      }
      if (artifact.artifact_kind === "PRESENTATION_READ_MODEL") {
        assert.equal(payload.presentation_status, "EVIDENCE_BLOCKED");
        assert.equal(canonicalSerialize(root.resolvers.presentation_read_models.resolve(payload.presentation_read_model_id)), artifact.canonical_bytes);
      }
    }
  }
  const originalBytes = records.slice(0, 26).map(canonicalSerialize);
  assert.deepEqual(executions.slice(0, 26).map((execution) => canonicalSerialize(execution.record)), originalBytes);
  for (const execution of captured) await store.appendExecution(execution);
  console.log(JSON.stringify({ mode, original_records: 26, total_records: executions.length, compositions: 4, relevance: 4,
    eligibility: 0, outcome: "EVIDENCE_BLOCKED", fresh_restore: mode === "restore" }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
