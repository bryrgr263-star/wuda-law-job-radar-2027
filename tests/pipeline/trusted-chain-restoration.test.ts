import "../helpers/network-guard";

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  ELIGIBILITY_ASSESSMENT_RULE_VERSION,
  PREDICATE_RESOLUTION_RULE_VERSION,
  TrustedRestorationError,
  assertTrustedRestorationExecution,
  assertTrustedRestorationRecordIntegrity,
  bootstrapTrustedChainCompositionRoot,
  createCandidateEvidenceSourceManifest,
  createExtractedRecordV2,
  createTrustedRestorationRecord,
  materializeSourceOccurrenceVersion,
  prepareSourceOccurrenceMaterialization,
  type LegalEmploymentRelevanceAssessment,
  type OpportunityRecallRegistrationResult,
  type PositionBoundEligibilityAssessmentResult,
  type PositionBoundPredicateResolutionResult,
  type PresentationDecision,
  type PresentationReadModel,
  type RequirementProjectionArtifact,
  type SourceCompositionResult,
  type TrustedCandidateEvidenceBatch,
  type TrustedChainCommand,
  type TrustedRestorationJournalRepository,
  type TrustedRestorationRecord
} from "../../lib/ingestion";
import { canonicalHash, canonicalSerialize } from
  "../../lib/ingestion/normalization/canonical-artifact-registry";
import { buildAuthoritativePresentationCurrentSnapshot } from "../../lib/ingestion/pipeline/presentation-persistence";
import { ReadOnlyPresentationApi } from "../../lib/presentation-read-api";
import {
  GitAppendOnlyExecutionStore,
  PostgresProductionPersistence,
  artifactSetHash,
  sealCheckpoint,
  type PostgresExecutor
} from "../../lib/production-persistence";
import type { PositionBoundRequirementSetMaterializationResult } from
  "../../lib/ingestion/pipeline/position-bound-requirement-set";
import {
  AS_OF,
  CANDIDATE_ID,
  OBSERVED_AT,
  syntheticCandidateProfile,
  trustedFixture
} from "./position-bound-phase-fixture";

const METADATA = {
  actor: "trusted-restoration-test",
  recorded_at: "2026-09-15T10:00:00+08:00"
} as const;

test("fresh composition root replays the complete trusted chain after restart", async () => {
  const journal = new InMemoryRestorationJournal();
  const expected = await createProcessAState(journal, "restoration-e2e");
  const processAExecutions = journal.executions();
  assert.equal(processAExecutions.length, 13);
  assert.ok(processAExecutions.every((execution) => {
    return execution.record.expected_artifacts.length === execution.artifact_envelopes.length;
  }));
  assert.equal(processAExecutions.filter((execution) => {
    return execution.read_model_projection !== null;
  }).length, 1);
  const producedIds = new Set(processAExecutions.flatMap((execution) => {
    return execution.artifact_envelopes.map((artifact) => artifact.artifact_id);
  }));
  assert.ok(processAExecutions.flatMap((execution) => execution.artifact_envelopes)
    .flatMap((artifact) => artifact.upstream_references)
    .every((reference) => producedIds.has(reference.upstream_artifact_id)));

  const processB = await bootstrapTrustedChainCompositionRoot({
    scope: "SYNTHETIC_TEST",
    restoration_journal: journal
  });

  assert.equal(processB.restored_record_count, 13);
  assert.deepEqual(Object.keys(processB.root).sort(), ["execute", "resolvers", "scope"]);
  assert.equal("process" in processB.root.resolvers.source_occurrences, false);
  assert.equal("materialize" in processB.root.resolvers.requirement_sets, false);
  assert.equal("decide" in processB.root.resolvers.presentation_decisions, false);
  assert.equal(
    processB.root.resolvers.source_occurrences.resolve(expected.source_occurrence_version_id)
      ?.version.source_occurrence_version_id,
    expected.source_occurrence_version_id
  );
  assert.equal(
    processB.root.resolvers.opportunity_candidates.resolve(
      expected.opportunity_candidate_id
    )?.integrity_hash,
    expected.opportunity_candidate_integrity_hash
  );
  assert.equal(
    processB.root.resolvers.position_versions.resolve(expected.position_version_id)
      ?.position_version.integrity_hash,
    expected.position_version_integrity_hash
  );
  assert.equal(
    processB.root.resolvers.position_bound_opportunities.resolve(
      expected.opportunity_version_id
    )
      ?.opportunity_version.integrity_hash,
    expected.opportunity_version_integrity_hash
  );
  assert.equal(
    processB.root.resolvers.source_compositions.resolve(
      expected.source_composition_id
    )?.composition_hash,
    expected.source_composition_hash
  );
  assert.equal(
    processB.root.resolvers.relevance.resolve(expected.relevance_assessment_id)
      ?.integrity_hash,
    expected.relevance_integrity_hash
  );
  assert.equal(
    processB.root.resolvers.requirement_projections.resolve(
      expected.requirement_projection_id
    )?.integrity_hash,
    expected.requirement_projection_integrity_hash
  );
  assert.equal(
    processB.root.resolvers.requirement_sets.resolve(
      expected.requirement_set_version_id
    )?.semantic_hash,
    expected.requirement_set_semantic_hash
  );
  assert.equal(
    processB.root.resolvers.candidate_evidence.resolve(
      expected.candidate_evidence_id
    )?.predicate_candidate_evidence_hash,
    expected.candidate_evidence_hash
  );
  assert.equal(
    processB.root.resolvers.predicate_resolutions.resolve(
      expected.predicate_resolution_id
    )?.integrity_hash,
    expected.predicate_resolution_integrity_hash
  );
  assert.equal(
    processB.root.resolvers.eligibility_assessments.resolve(
      expected.eligibility_assessment_id
    )?.integrity_hash,
    expected.eligibility_integrity_hash
  );
  assert.equal(
    processB.root.resolvers.presentation_decisions.resolve(
      expected.presentation_decision_id
    )
      ?.integrity_hash,
    expected.presentation_decision_integrity_hash
  );
  assert.equal(
    processB.root.resolvers.presentation_read_models.resolve(
      expected.presentation_read_model_id
    )
      ?.integrity_hash,
    expected.presentation_read_model_integrity_hash
  );

  const revisedRecall = asRecallRevision(await processB.root.execute({
    kind: "RECALL_DISPOSITION_RECORD",
    input: {
      opportunity_candidate_id: expected.opportunity_candidate_id,
      status: "REVIEW_REQUIRED",
      reason_codes: ["POST_RESTART_REVIEW"],
      evidence_ids: ["evidence:post-restart-review"],
      decided_at: "2026-09-16T10:00:00+08:00" as never
    }
  }, METADATA));
  const revisedDecision = asPresentationDecisionResult(await processB.root.execute({
    kind: "PRESENTATION_DECIDE",
    input: {
      opportunity_candidate_id: expected.opportunity_candidate_id,
      recall_disposition_id: revisedRecall.disposition.recall_disposition_id,
      relevance_assessment_id: expected.relevance_assessment_id,
      eligibility_assessment_id: expected.eligibility_assessment_id,
      decided_at: "2026-09-16T10:01:00+08:00" as never
    }
  }, METADATA));
  const revisedModel = asPresentationReadModelResult(await processB.root.execute({
    kind: "PRESENTATION_READ_MODEL_MATERIALIZE",
    presentation_decision_id: revisedDecision.decision.presentation_decision_id
  }, METADATA));

  assert.equal(revisedDecision.decision.revision, 2);
  assert.equal(revisedDecision.decision.status, "DISPLAY");
  assert.equal(revisedDecision.decision.recall_disposition_id,
    revisedRecall.disposition.recall_disposition_id);
  assert.equal(revisedModel.read_model.decision_revision, 2);
  assert.equal((await journal.list()).length, 16);
});

test("a separate Process B restores without Process A registry memory", async () => {
  const journal = new InMemoryRestorationJournal();
  const expected = await createProcessAState(journal, "restoration-process-boundary");
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "trusted-restoration-"));
  const statePath = path.join(temporaryRoot, "journal.json");
  const markerPath = path.join(temporaryRoot, "process-b.json");
  const scriptPath = path.join(temporaryRoot, "process-b.ts");
  const ingestionModule = pathToFileURL(path.resolve(
    process.cwd(),
    "lib/ingestion/index.ts"
  )).href;
  writeFileSync(statePath, JSON.stringify({
    records: await journal.list(),
    expected,
    marker_path: markerPath
  }), "utf8");
  writeFileSync(scriptPath, `
    import { readFileSync, writeFileSync } from "node:fs";
    import { bootstrapTrustedChainCompositionRoot } from ${JSON.stringify(ingestionModule)};
    void (async () => {
      const state = JSON.parse(readFileSync(process.argv[2], "utf8"));
      const journal = {
        async list() { return structuredClone(state.records); },
        async appendExecution() { return "APPENDED"; }
      };
      const restored = await bootstrapTrustedChainCompositionRoot({
        scope: "SYNTHETIC_TEST",
        restoration_journal: journal
      });
      const decision = restored.root.resolvers.presentation_decisions.resolve(
        state.expected.presentation_decision_id
      );
      const model = restored.root.resolvers.presentation_read_models.resolve(
        state.expected.presentation_read_model_id
      );
      if (decision?.integrity_hash !== state.expected.presentation_decision_integrity_hash
          || model?.integrity_hash !== state.expected.presentation_read_model_integrity_hash) {
        throw new Error("Process B did not restore the sealed downstream artifacts");
      }
      writeFileSync(state.marker_path, JSON.stringify({
        restored_record_count: restored.restored_record_count,
        process_id: process.pid
      }), "utf8");
    })();
  `, "utf8");
  try {
    const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
    const child = spawnSync(process.execPath, [tsxCli, scriptPath, statePath], {
      cwd: process.cwd(), encoding: "utf8", timeout: 30_000
    });
    assert.equal(child.status, 0,
      `${child.error?.message ?? ""}\n${child.stdout}\n${child.stderr}`);
    const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
      readonly restored_record_count: number;
      readonly process_id: number;
    };
    assert.equal(marker.restored_record_count, 13);
    assert.notEqual(marker.process_id, process.pid);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("Git-backed fresh Process B restores every sealed trusted-chain stage", async () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "trusted-git-process-b-"));
  const markerPath = path.join(temporaryRoot, "process-b.json");
  const expectedPath = path.join(temporaryRoot, "expected.json");
  const scriptPath = path.join(temporaryRoot, "process-b.ts");
  const ingestionModule = pathToFileURL(path.resolve(
    process.cwd(),
    "lib/ingestion/index.ts"
  )).href;
  const persistenceModule = pathToFileURL(path.resolve(
    process.cwd(),
    "lib/production-persistence/index.ts"
  )).href;
  const canonicalModule = pathToFileURL(path.resolve(
    process.cwd(),
    "lib/ingestion/normalization/canonical-artifact-registry.ts"
  )).href;
  try {
    git(temporaryRoot, "init", "-b", "main");
    git(temporaryRoot, "config", "core.longpaths", "true");
    writeFileSync(path.join(temporaryRoot, "README.md"), "seed", "utf8");
    git(temporaryRoot, "add", "README.md");
    git(temporaryRoot, "-c", "user.name=Test", "-c",
      "user.email=test@example.invalid", "commit", "-m", "seed");
    const store = new GitAppendOnlyExecutionStore<TrustedChainCommand>({
      repository_path: temporaryRoot,
      stream_id: "trusted-chain-git-restart",
      scope: "SYNTHETIC_TEST"
    });
    const expected = await createProcessAState(store, "restoration-git-process-b");
    const processA = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: store });
    const historicalDecision = processA.root.resolvers.presentation_decisions.resolve(expected.presentation_decision_id)!;
    assert.ok(historicalDecision.position_id);
    const migrated = await processA.root.execute({ kind: "PRESENTATION_MIGRATE_V1", input: {
      position_id: historicalDecision.position_id, anchored_input_head: await store.readAuthoritativeHead(),
      actor: METADATA.actor, created_at: AS_OF } }, METADATA) as {
        audit: import("../../lib/ingestion").PresentationMigrationAudit;
        decision: import("../../lib/ingestion").PresentationDecision;
        read_model: import("../../lib/ingestion").PresentationReadModel;
      };
    const blocked = asPresentationDecisionResult(await processA.root.execute({ kind: "PRESENTATION_DECIDE", input: {
      contract_version: "presentation-decision/2.0.0", expected_current_presentation_decision_id: migrated.decision.presentation_decision_id,
      opportunity_candidate_id: expected.opportunity_candidate_id,
      recall_disposition_id: historicalDecision.recall_disposition_id,
      relevance_assessment_id: expected.relevance_assessment_id, eligibility_assessment_id: null, decided_at: AS_OF
    } }, METADATA)).decision;
    const blockedModel = asPresentationReadModelResult(await processA.root.execute({ kind: "PRESENTATION_READ_MODEL_MATERIALIZE",
      presentation_decision_id: blocked.presentation_decision_id }, METADATA)).read_model;
    const recovered = asPresentationDecisionResult(await processA.root.execute({ kind: "PRESENTATION_DECIDE", input: {
      contract_version: "presentation-decision/2.0.0", expected_current_presentation_decision_id: blocked.presentation_decision_id,
      opportunity_candidate_id: expected.opportunity_candidate_id,
      recall_disposition_id: historicalDecision.recall_disposition_id,
      relevance_assessment_id: expected.relevance_assessment_id, eligibility_assessment_id: expected.eligibility_assessment_id, decided_at: AS_OF
    } }, METADATA)).decision;
    const recoveredModel = asPresentationReadModelResult(await processA.root.execute({ kind: "PRESENTATION_READ_MODEL_MATERIALIZE",
      presentation_decision_id: recovered.presentation_decision_id }, METADATA)).read_model;
    assert.deepEqual([migrated.decision.revision, blocked.revision, recovered.revision], [1, 2, 3]);
    assert.equal(recovered.supersedes_presentation_decision_id, blocked.presentation_decision_id);
    const retained = asPresentationDecisionResult(await processA.root.execute({ kind: "PRESENTATION_DECIDE", input: {
      contract_version: "presentation-decision/2.0.0", expected_current_presentation_decision_id: migrated.decision.presentation_decision_id,
      opportunity_candidate_id: expected.opportunity_candidate_id,
      recall_disposition_id: processA.root.resolvers.recall_dispositions.resolveCurrent(expected.opportunity_candidate_id)!.recall_disposition_id,
      relevance_assessment_id: null, eligibility_assessment_id: null, decided_at: AS_OF } }, METADATA));
    writeFileSync(expectedPath, JSON.stringify({ ...expected, migration: migrated, v2_revisions: [migrated.decision, blocked, recovered],
      v2_models: [migrated.read_model, blockedModel, recoveredModel],
      retained: retained.decision, current_snapshot: store.readCurrentSnapshot() }), "utf8");
    writeFileSync(scriptPath, `
      import { readFileSync, writeFileSync } from "node:fs";
      import { bootstrapTrustedChainCompositionRoot } from ${JSON.stringify(ingestionModule)};
      import { canonicalHash, canonicalSerialize } from ${JSON.stringify(canonicalModule)};
      import { GitAppendOnlyExecutionStore } from ${JSON.stringify(persistenceModule)};
      void (async () => {
        const expected = JSON.parse(readFileSync(process.argv[2], "utf8"));
        const repositoryPath = process.argv[3];
        const markerPath = process.argv[4];
        const store = new GitAppendOnlyExecutionStore({
          repository_path: repositoryPath,
          stream_id: "trusted-chain-git-restart",
          scope: "SYNTHETIC_TEST"
        });
        const restored = await bootstrapTrustedChainCompositionRoot({
          scope: "SYNTHETIC_TEST",
          restoration_journal: store
        });
        const checks = [
          restored.root.resolvers.source_occurrences.resolve(
            expected.source_occurrence_version_id
          )?.version && canonicalHash(restored.root.resolvers.source_occurrences.resolve(
            expected.source_occurrence_version_id
          )?.version) === expected.source_occurrence_version_canonical_hash,
          restored.root.resolvers.opportunity_candidates.resolve(
            expected.opportunity_candidate_id
          )?.integrity_hash === expected.opportunity_candidate_integrity_hash,
          restored.root.resolvers.position_versions.resolve(
            expected.position_version_id
          )?.position_version.integrity_hash === expected.position_version_integrity_hash,
          restored.root.resolvers.position_bound_opportunities.resolve(
            expected.opportunity_version_id
          )?.opportunity_version.integrity_hash === expected.opportunity_version_integrity_hash,
          restored.root.resolvers.source_compositions.resolve(
            expected.source_composition_id
          )?.composition_hash === expected.source_composition_hash,
          restored.root.resolvers.relevance.resolve(
            expected.relevance_assessment_id
          )?.integrity_hash === expected.relevance_integrity_hash,
          restored.root.resolvers.requirement_projections.resolve(
            expected.requirement_projection_id
          )?.integrity_hash === expected.requirement_projection_integrity_hash,
          restored.root.resolvers.requirement_sets.resolve(
            expected.requirement_set_version_id
          )?.semantic_hash === expected.requirement_set_semantic_hash,
          restored.root.resolvers.candidate_evidence.resolve(
            expected.candidate_evidence_id
          )?.predicate_candidate_evidence_hash === expected.candidate_evidence_hash,
          restored.root.resolvers.predicate_resolutions.resolve(
            expected.predicate_resolution_id
          )?.integrity_hash === expected.predicate_resolution_integrity_hash,
          restored.root.resolvers.eligibility_assessments.resolve(
            expected.eligibility_assessment_id
          )?.integrity_hash === expected.eligibility_integrity_hash,
          restored.root.resolvers.presentation_decisions.resolve(
            expected.presentation_decision_id
          )?.integrity_hash === expected.presentation_decision_integrity_hash,
          restored.root.resolvers.presentation_decisions.resolve(
            expected.presentation_decision_id
          )?.status === expected.presentation_decision_status,
          restored.root.resolvers.presentation_read_models.resolve(
            expected.presentation_read_model_id
          )?.integrity_hash === expected.presentation_read_model_integrity_hash,
          canonicalSerialize(restored.root.resolvers.presentation_read_models.resolve(
            expected.presentation_read_model_id
          )) === expected.presentation_read_model_bytes,
          canonicalSerialize(restored.root.resolvers.presentation_decisions.resolveMigration(expected.migration.audit.migration_id)) === canonicalSerialize(expected.migration.audit),
          canonicalSerialize(restored.root.resolvers.presentation_decisions.resolve(expected.migration.decision.presentation_decision_id)) === canonicalSerialize(expected.migration.decision),
          canonicalSerialize(restored.root.resolvers.presentation_read_models.resolve(expected.migration.read_model.presentation_read_model_id)) === canonicalSerialize(expected.migration.read_model),
          expected.v2_revisions.every((decision) => canonicalSerialize(restored.root.resolvers.presentation_decisions.resolve(decision.presentation_decision_id)) === canonicalSerialize(decision)),
          expected.v2_models.every((model) => canonicalSerialize(restored.root.resolvers.presentation_read_models.resolve(model.presentation_read_model_id)) === canonicalSerialize(model)),
          canonicalSerialize(restored.root.resolvers.presentation_decisions.resolvePositionCurrent("SYNTHETIC_TEST", expected.migration.decision.position_id)) === canonicalSerialize(expected.v2_revisions[2]),
          canonicalSerialize(restored.root.resolvers.presentation_decisions.resolve(expected.retained.presentation_decision_id)) === canonicalSerialize(expected.retained),
          canonicalSerialize(store.readCurrentSnapshot()) === canonicalSerialize(expected.current_snapshot)
        ];
        if (checks.some((check) => !check)) {
          throw new Error("Git Process B did not restore every expected trusted artifact");
        }
        writeFileSync(markerPath, JSON.stringify({
          restored_record_count: restored.restored_record_count,
          process_id: process.pid
        }), "utf8");
      })();
    `, "utf8");
    const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
    const child = spawnSync(
      process.execPath,
      [tsxCli, scriptPath, expectedPath, temporaryRoot, markerPath],
      { cwd: process.cwd(), encoding: "utf8", timeout: 60_000 }
    );
    assert.equal(child.status, 0,
      `${child.error?.message ?? ""}\n${child.stdout}\n${child.stderr}`);
    const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
      readonly restored_record_count: number;
      readonly process_id: number;
    };
    assert.equal(marker.restored_record_count, 19);
    assert.notEqual(marker.process_id, process.pid);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("PostgreSQL-backed Process B rehydrates the complete downstream trusted chain", async () => {
  const journal = new InMemoryRestorationJournal();
  const expected = await createProcessAState(journal, "restoration-postgres-process-b");
  const records = await journal.list();
  const executions = journal.executions();
  const genesis = sealCheckpoint({
    checkpoint_id: "postgres-process-b-genesis",
    stream_id: "postgres-process-b",
    scope: "SYNTHETIC_TEST",
    sequence: 0,
    head_hash: "0".repeat(64),
    artifact_set_hash: artifactSetHash([]),
    previous_checkpoint_hash: null,
    signer_key_id: "test-only-key",
    signature_algorithm: "Ed25519",
    created_at: "2026-09-15T09:59:59+08:00"
  }, "test-signature");
  const checkpoint = sealCheckpoint({
    checkpoint_id: "postgres-process-b-current",
    stream_id: "postgres-process-b",
    scope: "SYNTHETIC_TEST",
    sequence: records.length,
    head_hash: records.at(-1)!.integrity_hash,
    artifact_set_hash: artifactSetHash(executions.flatMap((item) => {
      return item.artifact_envelopes;
    })),
    previous_checkpoint_hash: genesis.checkpoint_hash,
    signer_key_id: "test-only-key",
    signature_algorithm: "Ed25519",
    created_at: "2026-09-15T10:01:00+08:00"
  }, "test-signature");
  const repository = new PostgresProductionPersistence<TrustedChainCommand>(
    new PostgresReplayExecutor(executions, [genesis, checkpoint]),
    {
      stream_id: "postgres-process-b",
      scope: "SYNTHETIC_TEST",
      writer_epoch: 1,
      checkpoint_verifier: {
        async verify(input) { return input.signature === "test-signature"; }
      }
    }
  );
  const processB = await bootstrapTrustedChainCompositionRoot({
    scope: "SYNTHETIC_TEST",
    restoration_journal: repository
  });
  assert.equal(processB.restored_record_count, records.length);
  assert.equal(
    processB.root.resolvers.candidate_evidence.resolve(expected.candidate_evidence_id)
      ?.predicate_candidate_evidence_hash,
    expected.candidate_evidence_hash
  );
  assert.equal(
    processB.root.resolvers.predicate_resolutions.resolve(expected.predicate_resolution_id)
      ?.integrity_hash,
    expected.predicate_resolution_integrity_hash
  );
  assert.equal(
    processB.root.resolvers.eligibility_assessments.resolve(
      expected.eligibility_assessment_id
    )?.integrity_hash,
    expected.eligibility_integrity_hash
  );
  assert.equal(
    processB.root.resolvers.presentation_decisions.resolve(
      expected.presentation_decision_id
    )?.integrity_hash,
    expected.presentation_decision_integrity_hash
  );
  assert.equal(
    processB.root.resolvers.presentation_read_models.resolve(
      expected.presentation_read_model_id
    )?.integrity_hash,
    expected.presentation_read_model_integrity_hash
  );
});

test("restoration rejects tampering, missing records, and reordered records", async () => {
  const journal = new InMemoryRestorationJournal();
  await createProcessAState(journal, "restoration-tamper");
  const records = await journal.list();

  const staleIntegrity = structuredClone(records);
  staleIntegrity[0] = {
    ...staleIntegrity[0]!,
    command_hash: "forged"
  };
  await assert.rejects(
    bootstrapWith(staleIntegrity),
    (error: unknown) => error instanceof TrustedRestorationError
      && error.code === "INVALID_RECORD"
  );

  const wrongExpectedResult = resealRecord({
    ...records[0]!,
    result_hash: "0".repeat(64)
  });
  await assert.rejects(
    bootstrapWith([wrongExpectedResult]),
    (error: unknown) => error instanceof TrustedRestorationError
      && error.code === "COMMAND_REPLAY_MISMATCH"
  );

  await assert.rejects(
    bootstrapWith(records.slice(1)),
    (error: unknown) => error instanceof TrustedRestorationError
      && error.code === "JOURNAL_DISCONTINUITY"
  );
  await assert.rejects(
    bootstrapWith([records[1]!, records[0]!, ...records.slice(2)]),
    (error: unknown) => error instanceof TrustedRestorationError
      && error.code === "JOURNAL_DISCONTINUITY"
  );
});

test("journal is append-only, idempotent, collision-safe, and defensively cloned", async () => {
  const journal = new InMemoryRestorationJournal();
  const record = createTrustedRestorationRecord({
    sequence: 1,
    previous_record_hash: null,
    command_kind: "TEST",
    command: {
      kind: "PRESENTATION_READ_MODEL_MATERIALIZE",
      presentation_decision_id: "presentation-decision:test" as never
    } satisfies TrustedChainCommand,
    result: { status: "OK" },
    expected_artifacts: [],
    provenance: {
      scope: "SYNTHETIC_TEST",
      actor: "test",
      recorded_at: "2026-09-15T10:00:00+08:00"
    }
  });
  assert.equal(await journal.appendExecution(executionFor(record)), "APPENDED");
  assert.equal(await journal.appendExecution(executionFor(structuredClone(record))),
    "IDEMPOTENT_REUSE");

  const collision = resealRecord({
    ...record,
    restoration_record_id: record.restoration_record_id,
    result_hash: "1".repeat(64)
  }, false);
  await assert.rejects(journal.appendExecution(executionFor(collision)), /identity collision/);

  const firstRead = await journal.list();
  (firstRead[0]!.expected_artifacts as TrustedRestorationRecord["expected_artifacts"] &
    TrustedRestorationRecord["expected_artifacts"][number][]).push({
    artifact_kind: "FORGED",
    artifact_id: "forged",
    content_hash: "forged"
  });
  assert.equal((await journal.list())[0]!.expected_artifacts.length, 0);
});

test("production restoration roots reject synthetic Candidate Evidence", async () => {
  const journal = new InMemoryRestorationJournal("PRODUCTION");
  const { root } = await bootstrapTrustedChainCompositionRoot({
    scope: "PRODUCTION",
    restoration_journal: journal
  });
  await assert.rejects(root.execute({
    kind: "CANDIDATE_EVIDENCE_MATERIALIZE_SYNTHETIC",
    input: {
      candidate_profile: syntheticCandidateProfile("production-rejected"),
      observed_at: OBSERVED_AT,
      effective_from: OBSERVED_AT
    }
  }, METADATA), /forbidden in production roots/);
  assert.equal((await journal.list()).length, 0);
});

test("issued Candidate Evidence replays through the same owner with manifest upstream seals", async () => {
  const journal = new InMemoryRestorationJournal();
  const profile = syntheticCandidateProfile("restoration-issued-evidence");
  const credential = structuredClone(profile.education[0]!);
  (credential as { provenance: string }).provenance = "CANDIDATE_ASSERTED";
  const manifest = createCandidateEvidenceSourceManifest({
    manifest_stream_id: "restoration-issued-evidence",
    candidate_profile_id: profile.candidate_profile_id,
    evidence_class: "CANDIDATE_ASSERTED",
    scope: "SYNTHETIC_TEST",
    revision: 1,
    supersedes_manifest_id: null,
    locator: { kind: "CANDIDATE_CLAIM", value: "fixture://restoration/claim" },
    evidence_object: null,
    verifier: null,
    actor: "restoration-test-actor",
    issued_at: OBSERVED_AT,
    provenance_references: ["fixture:restoration-issued-evidence"]
  });
  const command: TrustedChainCommand = {
    kind: "CANDIDATE_EVIDENCE_ISSUE",
    input: {
      source_manifest: manifest,
      evidence: [{
        candidate_credential_id: credential.candidate_credential_id,
        value: { kind: "EDUCATION_CREDENTIAL", credential },
        original_value: credential.program_name.original,
        normalized_value: {
          text: credential.program_name.original.text.normalize("NFKC"),
          unicode_form: "NFKC",
          normalizer_version: "restoration-issued-evidence/1.0.0",
          operations: ["UNICODE_NORMALIZATION"]
        },
        observation_status: "INSUFFICIENT",
        observed_at: OBSERVED_AT
      }]
    }
  };
  const processA = await bootstrapTrustedChainCompositionRoot({
    scope: "SYNTHETIC_TEST",
    restoration_journal: journal
  });
  const issued = asCandidateEvidence(await processA.root.execute(command, METADATA));
  const execution = journal.executions()[0]!;
  assert.deepEqual(execution.artifact_envelopes.map((item) => item.artifact_kind), [
    "CANDIDATE_EVIDENCE_SOURCE_MANIFEST",
    "CANDIDATE_EVIDENCE"
  ]);
  assert.equal(
    execution.artifact_envelopes[1]?.upstream_references[0]?.upstream_artifact_id,
    manifest.candidate_evidence_source_manifest_id
  );

  const processB = await bootstrapTrustedChainCompositionRoot({
    scope: "SYNTHETIC_TEST",
    restoration_journal: journal
  });
  assert.equal(
    processB.root.resolvers.candidate_evidence.resolve(issued.evidence_ids[0]!)
      ?.predicate_candidate_evidence_hash,
    issued.evidence[0]?.predicate_candidate_evidence_hash
  );
});

test("DOCUMENT_VERIFIED issuance cannot execute without root-owned object verification", async () => {
  const journal = new InMemoryRestorationJournal();
  const profile = syntheticCandidateProfile("restoration-document-verifier");
  const manifest = createCandidateEvidenceSourceManifest({
    manifest_stream_id: "restoration-document-verifier",
    candidate_profile_id: profile.candidate_profile_id,
    evidence_class: "DOCUMENT_VERIFIED",
    scope: "SYNTHETIC_TEST",
    revision: 1,
    supersedes_manifest_id: null,
    locator: { kind: "PRIVATE_OBJECT_STORAGE", value: "fixture://verified-object" },
    evidence_object: {
      bucket_id: "test-private-evidence",
      object_key: `sha256/aa/bb/${"a".repeat(64)}`,
      sha256: "a".repeat(64),
      byte_length: 1,
      content_type: "application/pdf"
    },
    verifier: {
      identity: "test-verifier",
      role: "TEST_ONLY_VERIFIER",
      method: "FIXTURE_CONTRACT",
      verified_at: OBSERVED_AT
    },
    actor: "restoration-test-actor",
    issued_at: OBSERVED_AT,
    provenance_references: ["fixture:not-production-evidence"]
  });
  const { root } = await bootstrapTrustedChainCompositionRoot({
    scope: "SYNTHETIC_TEST",
    restoration_journal: journal
  });
  await assert.rejects(root.execute({
    kind: "CANDIDATE_EVIDENCE_ISSUE",
    input: { source_manifest: manifest, evidence: [] }
  }, METADATA), /root-owned Candidate Evidence object verifier/);
  assert.equal((await journal.list()).length, 0);
});

test("Candidate Evidence issuance scope mismatch is rejected before persistence", async () => {
  const journal = new InMemoryRestorationJournal("PRODUCTION");
  const profile = syntheticCandidateProfile("restoration-scope-mismatch");
  const manifest = createCandidateEvidenceSourceManifest({
    manifest_stream_id: "restoration-scope-mismatch",
    candidate_profile_id: profile.candidate_profile_id,
    evidence_class: "CANDIDATE_ASSERTED",
    scope: "SYNTHETIC_TEST",
    revision: 1,
    supersedes_manifest_id: null,
    locator: { kind: "CANDIDATE_CLAIM", value: "fixture://scope-mismatch" },
    evidence_object: null,
    verifier: null,
    actor: "restoration-test-actor",
    issued_at: OBSERVED_AT,
    provenance_references: ["fixture:scope-mismatch"]
  });
  const { root } = await bootstrapTrustedChainCompositionRoot({
    scope: "PRODUCTION",
    restoration_journal: journal
  });
  await assert.rejects(root.execute({
    kind: "CANDIDATE_EVIDENCE_ISSUE",
    input: { source_manifest: manifest, evidence: [] }
  }, METADATA), /scope does not match/);
  assert.equal((await journal.list()).length, 0);
});

test("root rejects missing upstream SOV provenance before Recall registration", async () => {
  const journal = new InMemoryRestorationJournal();
  const fixture = trustedFixture("restoration-missing-sov");
  const { root } = await bootstrapTrustedChainCompositionRoot({
    scope: "SYNTHETIC_TEST",
    restoration_journal: journal
  });
  await assert.rejects(root.execute({
    kind: "OPPORTUNITY_REGISTER",
    input: {
      source_definition_id: fixture.source.endpoint.source_definition_id,
      recruitment_endpoint_id: fixture.source.endpoint.recruitment_endpoint_id,
      discovery_locator: fixture.source.endpoint.locator,
      snapshot_id: fixture.source.snapshot.snapshot_id,
      extracted_record_id: fixture.source.extracted_record.extracted_record_id,
      source_occurrence_version_id: fixture.source.version.source_occurrence_version_id,
      publisher_subject: null,
      discovery_evidence_ids: ["official:missing-sov"],
      first_observed_at: OBSERVED_AT,
      initial_disposition: {
        status: "RETAINED",
        reason_codes: ["OFFICIAL_RECRUITMENT_DISCOVERED"],
        evidence_ids: ["official:missing-sov"],
        decided_at: OBSERVED_AT
      }
    }
  }, METADATA), /Trusted SourceOccurrenceVersion is unavailable/);
  assert.equal((await journal.list()).length, 0);
});

test("diagnostic V2 Case A blocker: unchanged rediscovery cannot bind new Snapshot and ExtractedRecord events to the reused trusted SOV", async () => {
  const journal = new InMemoryRestorationJournal();
  const fixture = trustedFixture("restoration-v2-rediscovery-blocker");
  const source = fixture.source;
  const { root } = await bootstrapTrustedChainCompositionRoot({
    scope: "SYNTHETIC_TEST",
    restoration_journal: journal
  });
  const original = await root.execute({
    kind: "SOURCE_OCCURRENCE_MATERIALIZE",
    input: {
      source_role: "POSITION_BEARING",
      endpoint: source.endpoint,
      extracted_record: source.extracted_record,
      snapshot: source.snapshot
    }
  }, METADATA);
  const snapshot = {
    ...structuredClone(source.snapshot),
    snapshot_id: `${source.snapshot.snapshot_id}-rediscovery` as typeof source.snapshot.snapshot_id,
    observed_at: AS_OF,
    request_metadata: {
      ...source.snapshot.request_metadata,
      requested_at: AS_OF
    }
  };
  const extractedRecord = createExtractedRecordV2(snapshot, source.extracted_record);
  assert.notEqual(snapshot.snapshot_id, source.snapshot.snapshot_id);
  assert.notEqual(extractedRecord.extracted_record_id, source.extracted_record.extracted_record_id);
  assert.equal(snapshot.content_hash, source.snapshot.content_hash);
  assert.equal(extractedRecord.semantic_hash, source.extracted_record.semantic_hash);
  const reused = materializeSourceOccurrenceVersion({
    prepared: prepareSourceOccurrenceMaterialization(source.endpoint, extractedRecord, snapshot),
    existing_occurrence: source.occurrence,
    existing_versions: [source.version]
  });
  assert.equal(reused.version_created, false);
  assert.deepEqual(reused.version, source.version);
  await assert.rejects(root.execute({
    kind: "SOURCE_OCCURRENCE_MATERIALIZE",
    input: {
      source_role: "POSITION_BEARING",
      endpoint: source.endpoint,
      extracted_record: extractedRecord,
      snapshot
    }
  }, METADATA), /SOV does not bind the supplied ExtractedRecord and SourceOccurrence/);
  await assert.rejects(root.execute({
    kind: "OPPORTUNITY_REGISTER",
    input: {
      source_definition_id: source.endpoint.source_definition_id,
      recruitment_endpoint_id: source.endpoint.recruitment_endpoint_id,
      discovery_locator: source.endpoint.locator,
      snapshot_id: snapshot.snapshot_id,
      extracted_record_id: extractedRecord.extracted_record_id,
      source_occurrence_version_id: source.version.source_occurrence_version_id,
      publisher_subject: null,
      discovery_evidence_ids: ["fixture:v2-rediscovery-not-production"],
      first_observed_at: AS_OF,
      initial_disposition: {
        status: "RETAINED",
        reason_codes: ["OFFICIAL_RECRUITMENT_DISCOVERED"],
        evidence_ids: ["fixture:v2-rediscovery-not-production"],
        decided_at: AS_OF
      }
    }
  }, METADATA), /OpportunityCandidate discovery provenance does not match the trusted SOV/);
  assert.equal((await journal.list()).length, 1);
  assert.deepEqual(root.resolvers.source_occurrences.resolve(source.version.source_occurrence_version_id), original);
  const processB = await bootstrapTrustedChainCompositionRoot({
    scope: "SYNTHETIC_TEST",
    restoration_journal: journal
  });
  assert.equal(processB.restored_record_count, 1);
  assert.deepEqual(processB.root.resolvers.source_occurrences.resolve(source.version.source_occurrence_version_id), original);
});

test("journal failure halts the root before any later unjournaled command", async () => {
  const fixture = trustedFixture("restoration-journal-failure");
  const { root } = await bootstrapTrustedChainCompositionRoot({
    scope: "SYNTHETIC_TEST",
    restoration_journal: {
      async list() { return []; },
      async appendExecution() { throw new Error("repository unavailable"); }
    }
  });
  const command: TrustedChainCommand = {
    kind: "SOURCE_OCCURRENCE_MATERIALIZE",
    input: {
      source_role: "POSITION_BEARING",
      endpoint: fixture.source.endpoint,
      extracted_record: fixture.source.extracted_record,
      snapshot: fixture.source.snapshot
    }
  };
  await assert.rejects(root.execute(command, METADATA),
    (error: unknown) => error instanceof TrustedRestorationError
      && error.code === "JOURNAL_WRITE_FAILURE");
  await assert.rejects(root.execute(command, METADATA),
    (error: unknown) => error instanceof TrustedRestorationError
      && error.code === "ROOT_HALTED");
});

test("root-owned V1 migration verifies the complete historical issuance inventory before seeding V2", async () => {
  const journal = new InMemoryRestorationJournal();
  const expected = await createProcessAState(journal, "presentation-v2-migration-root");
  const processB = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: journal });
  const graph = processB.root.resolvers.position_bound_opportunities.resolve(expected.opportunity_version_id)!;
  const migrated = await processB.root.execute({ kind: "PRESENTATION_MIGRATE_V1", input: {
    position_id: graph.position.position_id, anchored_input_head: "test-verified-history-anchor",
    actor: METADATA.actor, created_at: AS_OF
  } }, METADATA) as { audit: { classification: string }; decision: PresentationDecision; read_model: PresentationReadModel };
  assert.equal(migrated.audit.classification, "EQUIVALENT");
  assert.equal(migrated.decision.schema_version, "presentation-decision/2.0.0");
  assert.equal(migrated.decision.revision, 1);
  assert.equal(migrated.read_model.decision_revision, 1);
  assert.deepEqual(processB.root.resolvers.presentation_decisions.resolve(expected.presentation_decision_id),
    JSON.parse(journal.executions().find((execution) => execution.record.command.kind === "PRESENTATION_DECIDE")!.artifact_envelopes[0]!.canonical_bytes));
  const restarted = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: journal });
  assert.deepEqual(restarted.root.resolvers.presentation_decisions.resolve(migrated.decision.presentation_decision_id), migrated.decision);
});

test("a migrated subject cannot bypass bound V1 history and distinct Positions remain isolated in the same owner", async () => {
  const journal = new InMemoryRestorationJournal();
  const first = await createProcessAState(journal, "presentation-v2-isolation-first");
  const second = await createProcessAState(journal, "presentation-v2-isolation-second");
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: journal });
  const firstGraph = root.resolvers.position_bound_opportunities.resolve(first.opportunity_version_id)!;
  const secondGraph = root.resolvers.position_bound_opportunities.resolve(second.opportunity_version_id)!;
  assert.notEqual(firstGraph.position.position_id, secondGraph.position.position_id);
  assert.equal(firstGraph.position_version.title.original.text, secondGraph.position_version.title.original.text);
  assert.equal(firstGraph.opportunity_version.content.organization.name.original.text,
    secondGraph.opportunity_version.content.organization.name.original.text);
  assert.deepEqual(firstGraph.opportunity_version.content.locations, secondGraph.opportunity_version.content.locations);
  assert.equal(firstGraph.opportunity_version.content.recruitment_year, secondGraph.opportunity_version.content.recruitment_year);
  await assert.rejects(root.execute({ kind: "PRESENTATION_DECIDE", input: {
    contract_version: "presentation-decision/2.0.0", expected_current_presentation_decision_id: null,
    opportunity_candidate_id: first.opportunity_candidate_id, recall_disposition_id: root.resolvers.recall_dispositions.resolveCurrent(first.opportunity_candidate_id)!.recall_disposition_id,
    relevance_assessment_id: first.relevance_assessment_id, eligibility_assessment_id: first.eligibility_assessment_id,
    decided_at: AS_OF } }, METADATA), /migration/);
  for (const graph of [firstGraph, secondGraph]) await root.execute({ kind: "PRESENTATION_MIGRATE_V1", input: {
    position_id: graph.position.position_id, anchored_input_head: "test-verified-history-anchor",
    actor: METADATA.actor, created_at: AS_OF } }, METADATA);
  assert.equal(root.resolvers.presentation_decisions.resolvePositionCurrent("SYNTHETIC_TEST", firstGraph.position.position_id)?.revision, 1);
  assert.equal(root.resolvers.presentation_decisions.resolvePositionCurrent("SYNTHETIC_TEST", secondGraph.position.position_id)?.revision, 1);
});

test("conflicting V1 semantics produce a migration audit without an arbitrary V2 head", async () => {
  const journal = new InMemoryRestorationJournal();
  const expected = await createProcessAState(journal, "presentation-v2-conflicting-history");
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: journal });
  const graph = root.resolvers.position_bound_opportunities.resolve(expected.opportunity_version_id)!;
  await root.execute({ kind: "PRESENTATION_DECIDE", input: {
    opportunity_candidate_id: expected.opportunity_candidate_id,
    recall_disposition_id: root.resolvers.recall_dispositions.resolveCurrent(expected.opportunity_candidate_id)!.recall_disposition_id,
    relevance_assessment_id: expected.relevance_assessment_id, eligibility_assessment_id: null, decided_at: AS_OF
  } }, METADATA);
  const result = await root.execute({ kind: "PRESENTATION_MIGRATE_V1", input: {
    position_id: graph.position.position_id, anchored_input_head: "test-verified-history-anchor",
    actor: METADATA.actor, created_at: AS_OF
  } }, METADATA) as { audit: import("../../lib/ingestion").PresentationMigrationAudit; decision: null; read_model: null };
  assert.equal(result.audit.classification, "BLOCKED");
  assert.equal(result.audit.reason_code, "V1_SEMANTIC_CONFLICT");
  assert.equal(result.decision, null);
  assert.equal(result.read_model, null);
  assert.equal(root.resolvers.presentation_decisions.resolvePositionCurrent("SYNTHETIC_TEST", graph.position.position_id), null);
  const executions = journal.executions();
  const snapshot = buildAuthoritativePresentationCurrentSnapshot({ scope: "SYNTHETIC_TEST",
    authoritative_head: "test-verified-history-anchor",
    decisions: executions.flatMap((execution) => execution.artifact_envelopes.filter((envelope) => envelope.artifact_kind === "PRESENTATION_DECISION").map((envelope) => JSON.parse(envelope.canonical_bytes))),
    read_models: executions.flatMap((execution) => execution.read_model_projection ? [execution.read_model_projection.record as PresentationReadModel] : []),
    migration_audits: [result.audit], candidate_associations: [] });
  assert.equal(snapshot.current_position_read_models.length, 0);
  assert.equal(snapshot.migration.blocked_position_count, 1);
  assert.equal(snapshot.migration.items[0]?.migration_id, result.audit.migration_id);
  const api = new ReadOnlyPresentationApi({ readCurrentSnapshot: () => snapshot, listCurrentReadModels: () => { throw new Error("historical fallback forbidden"); } });
  const detail = await api.handle(new Request(`https://test.invalid/api/presentation/v1/opportunities/${expected.opportunity_candidate_id}`));
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).record_kind, "MIGRATION_BLOCKED");
  assert.throws(() => buildAuthoritativePresentationCurrentSnapshot({ ...snapshotInput(executions), migration_audits: [] }), /exactly one verified migration/);
});

function snapshotInput(executions: readonly import("../../lib/ingestion").TrustedRestorationExecution<TrustedChainCommand>[]) {
  return { scope: "SYNTHETIC_TEST" as const, authoritative_head: "test-verified-history-anchor",
    decisions: executions.flatMap((execution) => execution.artifact_envelopes.filter((envelope) => envelope.artifact_kind === "PRESENTATION_DECISION").map((envelope) => JSON.parse(envelope.canonical_bytes))),
    read_models: executions.flatMap((execution) => execution.read_model_projection ? [execution.read_model_projection.record as PresentationReadModel] : []), candidate_associations: [] };
}

test("live production V1 writes are rejected rather than silently promoted", async () => {
  const journal = new InMemoryRestorationJournal("PRODUCTION");
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "PRODUCTION", restoration_journal: journal });
  await assert.rejects(root.execute({ kind: "PRESENTATION_DECIDE", input: {
    opportunity_candidate_id: "untrusted-candidate" as never, recall_disposition_id: "untrusted-recall" as never,
    relevance_assessment_id: null, eligibility_assessment_id: null, decided_at: AS_OF } }, METADATA), /historical replay only/);
  assert.equal((await journal.list()).length, 0);
});

async function createProcessAState(
  journal: TrustedRestorationJournalRepository<TrustedChainCommand>,
  suffix: string
) {
  const fixture = trustedFixture(suffix, "学历要求：本科及以上", {
    raw_title: "法务岗"
  });
  const { root } = await bootstrapTrustedChainCompositionRoot({
    scope: "SYNTHETIC_TEST",
    restoration_journal: journal
  });
  await root.execute({
    kind: "SOURCE_OCCURRENCE_MATERIALIZE",
    input: {
      source_role: "POSITION_BEARING",
      endpoint: fixture.source.endpoint,
      extracted_record: fixture.source.extracted_record,
      snapshot: fixture.source.snapshot
    }
  }, METADATA);
  const registration = asRecallRegistration(await root.execute({
    kind: "OPPORTUNITY_REGISTER",
    input: {
      source_definition_id: fixture.source.endpoint.source_definition_id,
      recruitment_endpoint_id: fixture.source.endpoint.recruitment_endpoint_id,
      discovery_locator: fixture.source.endpoint.locator,
      snapshot_id: fixture.source.snapshot.snapshot_id,
      extracted_record_id: fixture.source.extracted_record.extracted_record_id,
      source_occurrence_version_id: fixture.source.version.source_occurrence_version_id,
      publisher_subject: null,
      discovery_evidence_ids: ["official:trusted-restoration-fixture"],
      first_observed_at: OBSERVED_AT,
      initial_disposition: {
        status: "RETAINED",
        reason_codes: ["OFFICIAL_RECRUITMENT_DISCOVERED"],
        evidence_ids: ["official:trusted-restoration-fixture"],
        decided_at: OBSERVED_AT
      }
    }
  }, METADATA));
  const positionVersion = asPositionVersion(await root.execute({
    kind: "POSITION_VERSION_MATERIALIZE",
    source_references: [{
      source_occurrence_version_id: fixture.source.version.source_occurrence_version_id
    }]
  }, METADATA));
  const opportunity = asPbov(await root.execute({
    kind: "PBOV_MATERIALIZE",
    position_version_id: positionVersion.position_version.position_version_id,
    source_references: [{
      source_occurrence_version_id: fixture.source.version.source_occurrence_version_id
    }]
  }, METADATA));
  assert.equal(
    opportunity.opportunity_version.opportunity_version_id,
    fixture.opportunity_version_id
  );
  const composition = asSourceComposition(await root.execute({
    kind: "SOURCE_COMPOSITION_MATERIALIZE",
    input: {
      opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
      composition_input: fixture.composition_input
    }
  }, METADATA));
  const relevance = asRelevance(await root.execute({
    kind: "LEGAL_RELEVANCE_ASSESS",
    input: {
      opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
      source_composition_id: composition.source_composition_id,
      created_at: AS_OF
    }
  }, METADATA));
  const projection = asProjection(await root.execute({
    kind: "REQUIREMENT_PROJECTION_MATERIALIZE",
    source_composition_id: composition.source_composition_id
  }, METADATA));
  const requirementSet = asRequirementSet(await root.execute({
    kind: "REQUIREMENT_SET_MATERIALIZE",
    source_composition_id: composition.source_composition_id
  }, METADATA));
  const evidence = asCandidateEvidence(await root.execute({
    kind: "CANDIDATE_EVIDENCE_MATERIALIZE_SYNTHETIC",
    input: {
      candidate_profile: syntheticCandidateProfile(suffix),
      observed_at: OBSERVED_AT,
      effective_from: OBSERVED_AT
    }
  }, METADATA));
  const predicates = asPredicateResult(await root.execute({
    kind: "PREDICATE_RESOLUTION_MATERIALIZE",
    input: {
      opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
      source_composition_id: composition.source_composition_id,
      requirement_set_version_id: requirementSet.requirement_set_version_id,
      candidate_profile_id: CANDIDATE_ID,
      candidate_evidence_ids: evidence.evidence_ids,
      as_of: AS_OF,
      predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION
    }
  }, METADATA));
  assert.equal(predicates.status, "RESOLUTION_SET");
  const eligibility = asEligibility(await root.execute({
    kind: "ELIGIBILITY_MATERIALIZE",
    input: {
      opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
      source_composition_id: composition.source_composition_id,
      requirement_set_version_id: requirementSet.requirement_set_version_id,
      predicate_resolution_ids: predicates.resolutions.map((resolution) => {
        return resolution.predicate_resolution_id;
      }),
      candidate_profile_id: CANDIDATE_ID,
      candidate_evidence_ids: evidence.evidence_ids,
      as_of: AS_OF,
      predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION,
      assessment_rule_version: ELIGIBILITY_ASSESSMENT_RULE_VERSION
    }
  }, METADATA));
  assert.equal(eligibility.status, "ASSESSMENT");
  const decision = asPresentationDecisionResult(await root.execute({
    kind: "PRESENTATION_DECIDE",
    input: {
      opportunity_candidate_id: registration.candidate.opportunity_candidate_id,
      recall_disposition_id: registration.disposition.recall_disposition_id,
      relevance_assessment_id: relevance.assessment_id,
      eligibility_assessment_id: eligibility.assessment.eligibility_assessment_id,
      decided_at: AS_OF
    }
  }, METADATA));
  const readModel = asPresentationReadModelResult(await root.execute({
    kind: "PRESENTATION_READ_MODEL_MATERIALIZE",
    presentation_decision_id: decision.decision.presentation_decision_id
  }, METADATA));
  const firstPredicate = predicates.resolutions[0]!;
  const firstEvidence = evidence.evidence[0]!;
  return {
    source_occurrence_version_id: fixture.source.version.source_occurrence_version_id,
    source_occurrence_version_canonical_hash: canonicalHash(fixture.source.version),
    opportunity_candidate_id: registration.candidate.opportunity_candidate_id,
    opportunity_candidate_integrity_hash: registration.candidate.integrity_hash,
    position_version_id: positionVersion.position_version.position_version_id,
    position_version_integrity_hash: positionVersion.position_version.integrity_hash,
    opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
    opportunity_version_integrity_hash: opportunity.opportunity_version.integrity_hash,
    source_composition_id: composition.source_composition_id,
    source_composition_hash: composition.composition_hash,
    relevance_assessment_id: relevance.assessment_id,
    relevance_integrity_hash: relevance.integrity_hash,
    requirement_projection_id: projection.requirement_projection_id,
    requirement_projection_integrity_hash: projection.integrity_hash,
    requirement_set_version_id: requirementSet.requirement_set_version_id,
    requirement_set_semantic_hash: requirementSet.semantic_hash,
    candidate_evidence_id: firstEvidence.predicate_candidate_evidence_id,
    candidate_evidence_hash: firstEvidence.predicate_candidate_evidence_hash,
    predicate_resolution_id: firstPredicate.predicate_resolution_id,
    predicate_resolution_integrity_hash: firstPredicate.integrity_hash,
    eligibility_assessment_id: eligibility.assessment.eligibility_assessment_id,
    eligibility_integrity_hash: eligibility.assessment.integrity_hash,
    presentation_decision_id: decision.decision.presentation_decision_id,
    presentation_decision_integrity_hash: decision.decision.integrity_hash,
    presentation_decision_status: decision.decision.status,
    presentation_read_model_id: readModel.read_model.presentation_read_model_id,
    presentation_read_model_integrity_hash: readModel.read_model.integrity_hash,
    presentation_read_model_bytes: canonicalSerialize(readModel.read_model)
  };
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

class InMemoryRestorationJournal implements
TrustedRestorationJournalRepository<TrustedChainCommand> {
  readonly #scope: "PRODUCTION" | "SYNTHETIC_TEST";
  readonly #records: TrustedRestorationRecord<TrustedChainCommand>[] = [];
  readonly #executions: import("../../lib/ingestion").TrustedRestorationExecution<
    TrustedChainCommand
  >[] = [];

  constructor(scope: "PRODUCTION" | "SYNTHETIC_TEST" = "SYNTHETIC_TEST") {
    this.#scope = scope;
  }

  async list() {
    return structuredClone(this.#records);
  }

  executions() {
    return structuredClone(this.#executions);
  }

  async readAuthoritativeHead() { return "test-verified-history-anchor"; }

  async readArtifactEnvelope(kind: string, id: string, scope: "PRODUCTION" | "SYNTHETIC_TEST") {
    if (scope !== this.#scope) throw new Error("Restoration scope mismatch");
    return this.#executions.flatMap((execution) => execution.artifact_envelopes)
      .find((envelope) => envelope.artifact_kind === kind && envelope.artifact_id === id) ?? null;
  }

  async appendExecution(execution: import("../../lib/ingestion").TrustedRestorationExecution<
    TrustedChainCommand
  >) {
    const validatedExecution = assertTrustedRestorationExecution(execution);
    const validated = assertTrustedRestorationRecordIntegrity(validatedExecution.record);
    if (validated.provenance.scope !== this.#scope) {
      throw new Error("Restoration scope mismatch");
    }
    const existing = this.#records.find((item) => {
      return item.restoration_record_id === validated.restoration_record_id;
    });
    if (existing) {
      if (canonicalSerialize(existing) !== canonicalSerialize(validated)) {
        throw new Error("Restoration record identity collision");
      }
      return "IDEMPOTENT_REUSE" as const;
    }
    if (validated.sequence !== this.#records.length + 1
        || validated.previous_record_hash
          !== (this.#records.at(-1)?.integrity_hash ?? null)) {
      throw new Error("Restoration journal append is not contiguous");
    }
    this.#records.push(structuredClone(validated));
    this.#executions.push(structuredClone(validatedExecution));
    return "APPENDED" as const;
  }
}

class PostgresReplayExecutor implements PostgresExecutor {
  constructor(
    readonly executions: readonly import("../../lib/ingestion")
      .TrustedRestorationExecution<TrustedChainCommand>[],
    readonly checkpoints: readonly unknown[]
  ) {}

  async query<Row>(sql: string) {
    if (/journal_checkpoints/iu.test(sql)) {
      return { rows: this.checkpoints.map((record_json) => ({ record_json })) as Row[] };
    }
    if (/journal_artifact_seals/iu.test(sql)) {
      return {
        rows: this.executions.flatMap((execution) => {
          return execution.record.expected_artifacts.map((artifact, ordinal) => ({
            sequence: execution.record.sequence,
            ordinal,
            artifact_kind: artifact.artifact_kind,
            artifact_id: artifact.artifact_id,
            expected_seal: artifact.content_hash
          }));
        }) as Row[]
      };
    }
    if (/command_journal/iu.test(sql)) {
      return {
        rows: this.executions.map((execution) => ({
          record_json: execution.record
        })) as Row[]
      };
    }
    if (/trusted_chain\.artifacts/iu.test(sql)) {
      return {
        rows: this.executions.flatMap((execution) => {
          return execution.artifact_envelopes.map((record_json) => ({
            record_json,
            first_sequence: execution.record.sequence
          }));
        }) as Row[]
      };
    }
    return { rows: [] as Row[] };
  }

  async transaction<Result>(
    work: (executor: PostgresExecutor) => Promise<Result>
  ): Promise<Result> {
    return work(this);
  }
}

function bootstrapWith(records: readonly TrustedRestorationRecord<TrustedChainCommand>[]) {
  return bootstrapTrustedChainCompositionRoot({
    scope: "SYNTHETIC_TEST",
    restoration_journal: {
      async list() { return structuredClone(records); },
      async appendExecution() { return "APPENDED" as const; }
    }
  });
}

function executionFor(record: TrustedRestorationRecord<TrustedChainCommand>) {
  return {
    record,
    artifact_envelopes: [],
    read_model_projection: null
  } as const;
}

function resealRecord(
  record: TrustedRestorationRecord<TrustedChainCommand>,
  recomputeId = true
) {
  const { integrity_hash: ignored, ...withoutIntegrity } = record;
  const withId = recomputeId
    ? createTrustedRestorationRecord({
        sequence: withoutIntegrity.sequence,
        previous_record_hash: withoutIntegrity.previous_record_hash,
        command_kind: withoutIntegrity.command_kind,
        command: withoutIntegrity.command,
        result: { deliberately: "different" },
        expected_artifacts: withoutIntegrity.expected_artifacts,
        provenance: withoutIntegrity.provenance
      })
    : withoutIntegrity;
  const canonical = recomputeId
    ? { ...withId, result_hash: withoutIntegrity.result_hash }
    : withoutIntegrity;
  const { integrity_hash: ignoredAgain, ...base } = canonical as
    TrustedRestorationRecord<TrustedChainCommand>;
  return {
    ...base,
    integrity_hash: canonicalHash(base)
  };
}

function asRecallRegistration(value: unknown) {
  return value as OpportunityRecallRegistrationResult;
}

function asRecallRevision(value: unknown) {
  return value as import("../../lib/ingestion").RecallDispositionRevisionResult;
}

function asPositionVersion(value: unknown) {
  return value as import("../../lib/ingestion").PositionVersionTrackingResult;
}

function asPbov(value: unknown) {
  return value as import("../../lib/ingestion").PositionBoundOpportunityTrackingResult;
}

function asSourceComposition(value: unknown) {
  return value as SourceCompositionResult;
}

function asRelevance(value: unknown) {
  return (value as { readonly assessment: LegalEmploymentRelevanceAssessment }).assessment;
}

function asProjection(value: unknown) {
  return value as RequirementProjectionArtifact;
}

function asRequirementSet(value: unknown) {
  return value as PositionBoundRequirementSetMaterializationResult;
}

function asCandidateEvidence(value: unknown) {
  return value as TrustedCandidateEvidenceBatch;
}

function asPredicateResult(value: unknown) {
  return value as PositionBoundPredicateResolutionResult;
}

function asEligibility(value: unknown) {
  return value as PositionBoundEligibilityAssessmentResult;
}

function asPresentationDecisionResult(value: unknown) {
  return value as {
    readonly version_created: boolean;
    readonly decision: PresentationDecision;
  };
}

function asPresentationReadModelResult(value: unknown) {
  return value as {
    readonly version_created: boolean;
    readonly read_model: PresentationReadModel;
  };
}
