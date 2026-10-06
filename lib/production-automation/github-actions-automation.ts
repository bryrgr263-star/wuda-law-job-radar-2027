import type { PresentationReadModel } from "../ingestion";
import {
  bootstrapProductionSchedulerBatch,
  type ProductionSchedulerBatchOptions
} from "../production-persistence/production-scheduler-batch";
import {
  bootstrapZeroCostProductionCompositionRoot
} from "../production-persistence/zero-cost-production-composition-root";
import type {
  SchedulerBatchManifest,
  SchedulerBatchStatus
} from "../production-persistence/scheduler-batch-manifest";
import { CADENCE_SCHEDULER_BATCH_SCHEMA_VERSION, deriveCurrentSchedulerBatchStatus, deriveSchedulerBatchStatus, effectiveSourceExecutionStatus } from "../production-persistence/scheduler-batch-manifest";
import type { SourceExecutionOutcome, TrustedChainFailureDiagnostic } from "../production-persistence/source-execution-outcome";

export type PublicationHandoffStatus = "NOT_REQUIRED" | "READY" | "PUBLISHED" | "RETRY_REQUIRED";

export interface ProductionSchedulerAutomationInput {
  readonly batch_id: string;
  readonly actor: string;
  readonly started_at: string;
  readonly expected_starting_sha?: string;
}

export interface ProductionSchedulerAutomationResult {
  readonly starting_sha: string;
  readonly ending_sha: string;
  readonly batch_id: string;
  readonly batch_status: SchedulerBatchStatus;
  readonly effective_batch_status: SchedulerBatchStatus;
  readonly manifest_commit: string;
  readonly manifest: SchedulerBatchManifest;
  readonly source_execution_ids: readonly string[];
  readonly source_diagnostics: readonly { readonly source_execution_id: string;
    readonly trusted_chain_status: SourceExecutionOutcome["trusted_chain_status"];
    readonly trusted_chain_failure: TrustedChainFailureDiagnostic | null }[];
  readonly position_ids: readonly string[];
  readonly presentation_decision_ids: readonly string[];
  readonly presentation_read_model_ids: readonly string[];
  readonly pre_run_process_b: "PASS";
  readonly post_push_process_b: "PASS";
  readonly publication_handoff: PublicationHandoffStatus;
}

export async function executeProductionSchedulerAutomation(
  options: ProductionSchedulerBatchOptions,
  input: ProductionSchedulerAutomationInput,
  publisher?: (models: readonly PresentationReadModel[]) => Promise<void>
): Promise<ProductionSchedulerAutomationResult> {
  const root = bootstrapZeroCostProductionCompositionRoot(options);
  const before = await root.restore();
  if (input.expected_starting_sha && before.committed_head !== input.expected_starting_sha) {
    throw new Error("ACTIONS_STARTING_HEAD_MISMATCH");
  }
  const scheduled = await bootstrapProductionSchedulerBatch(options).runBatch(input);
  const after = await root.restore();
  if (after.committed_head !== scheduled.manifest_commit) {
    throw new Error("ACTIONS_POST_PUSH_HEAD_MISMATCH");
  }
  const restored = after.scheduler_batches.find(batch => batch.batch_id === input.batch_id);
  if (!restored || restored.integrity_hash !== scheduled.manifest.integrity_hash) {
    throw new Error("ACTIONS_POST_PUSH_MANIFEST_MISMATCH");
  }
  const readModelIds = restored.source_executions.flatMap(item => item.presentation_read_model_ids);
  const historicalModels = new Map(after.historical_read_models.map(model => [model.presentation_read_model_id, model]));
  const selectedModels = readModelIds.map(id => {
    const model = historicalModels.get(id as never);
    if (!model) throw new Error("ACTIONS_POST_PUSH_READ_MODEL_MISMATCH");
    return model;
  });
  const publicationHandoff = await handoffPublication(restored, after.read_models, publisher);
  const byOutcome = new Map(after.source_execution_outcomes.map(outcome => [outcome.source_execution_id, outcome]));
  const effectiveStatuses = restored.source_executions.map(item => {
    const outcome = byOutcome.get(item.source_execution_id);
    if (!outcome) throw new Error("ACTIONS_POST_PUSH_SOURCE_OUTCOME_MISSING");
    return effectiveSourceExecutionStatus(outcome);
  });
  const effectiveBatchStatus = restored.schema_version === CADENCE_SCHEDULER_BATCH_SCHEMA_VERSION
    ? deriveCurrentSchedulerBatchStatus(effectiveStatuses, restored.deferred_sources.map(item => item.reason))
    : deriveSchedulerBatchStatus(effectiveStatuses, restored.deferred_sources.length);
  return Object.freeze({
    starting_sha: before.committed_head,
    ending_sha: after.committed_head,
    batch_id: restored.batch_id,
    batch_status: restored.batch_status,
    effective_batch_status: effectiveBatchStatus,
    manifest_commit: scheduled.manifest_commit,
    manifest: structuredClone(restored),
    source_execution_ids: restored.source_executions.map(item => item.source_execution_id),
    source_diagnostics: restored.source_executions.map(item => {
      const outcome = byOutcome.get(item.source_execution_id);
      if (!outcome) throw new Error("ACTIONS_POST_PUSH_SOURCE_OUTCOME_MISSING");
      return { source_execution_id: item.source_execution_id,
        trusted_chain_status: outcome.trusted_chain_status,
        trusted_chain_failure: outcome.trusted_chain_failure ?? null };
    }),
    position_ids: [...new Set(selectedModels.flatMap(model => model.position_id ? [model.position_id] : []))],
    presentation_decision_ids: [...new Set(selectedModels.map(model => model.presentation_decision_id))],
    presentation_read_model_ids: readModelIds,
    pre_run_process_b: "PASS" as const,
    post_push_process_b: "PASS" as const,
    publication_handoff: publicationHandoff
  });
}

export async function retryCommittedPresentationPublication(
  options: ProductionSchedulerBatchOptions,
  batchId: string,
  publisher: (models: readonly PresentationReadModel[]) => Promise<void>
) {
  const state = await bootstrapZeroCostProductionCompositionRoot(options).restore();
  const manifest = state.scheduler_batches.find(batch => batch.batch_id === batchId);
  if (!manifest) throw new Error("ACTIONS_PUBLICATION_BATCH_NOT_COMMITTED");
  if (manifest.presentation_publish_readiness !== "READY") {
    return Object.freeze({ batch_id: batchId, status: "NOT_REQUIRED" as const });
  }
  await publisher(structuredClone(state.read_models));
  return Object.freeze({ batch_id: batchId, status: "PUBLISHED" as const });
}

async function handoffPublication(
  manifest: SchedulerBatchManifest,
  models: readonly PresentationReadModel[],
  publisher?: (models: readonly PresentationReadModel[]) => Promise<void>
): Promise<PublicationHandoffStatus> {
  if (manifest.presentation_publish_readiness !== "READY") return "NOT_REQUIRED";
  if (!publisher) return "READY";
  try {
    await publisher(structuredClone(models));
    return "PUBLISHED";
  } catch {
    return "RETRY_REQUIRED";
  }
}
