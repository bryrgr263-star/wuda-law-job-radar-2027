import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { RecruitmentAdapter } from "../ingestion";
import { canonicalHash } from "../ingestion/normalization/canonical-artifact-registry";
import { continuousTime, pendingContinuousAttempt } from "../application/source-admission/continuous-acquisition";
import { GitSourceRegistryPersistence } from "./git-source-registry-persistence";
import { enumerateScheduledSources, type ScheduledSource } from "./scheduler-source-enumeration";
import {
  appendSchedulerBatchManifest,
  deriveSchedulerBatchStatus,
  sealSchedulerBatchManifest,
  SCHEDULER_POLICY_VERSION,
  type SchedulerBatchManifest,
  type SchedulerDeferredSource,
  type SchedulerSourceExecutionReference
} from "./scheduler-batch-manifest";
import { bootstrapZeroCostProductionCompositionRoot,
  type ZeroCostProductionCompositionRootOptions } from "./zero-cost-production-composition-root";

export interface ProductionSchedulerBatchOptions extends ZeroCostProductionCompositionRootOptions {
  readonly resolve_adapter: (adapterKey: string) => RecruitmentAdapter | null;
}

export interface ProductionSchedulerBatchResult {
  readonly manifest: SchedulerBatchManifest;
  readonly manifest_commit: string;
  readonly reused: boolean;
}

export function bootstrapProductionSchedulerBatch(options: ProductionSchedulerBatchOptions) {
  const root = bootstrapZeroCostProductionCompositionRoot(options);
  const now = options.now ?? (() => new Date().toISOString());
  const scope = options.continuous_scope ?? "PRODUCTION";
  const identity = options.commit_identity ?? {
    name: "Zero Cost Production Scheduler", email: "zero-cost-scheduler@invalid.local"
  };
  return Object.freeze({
    async runBatch(input: { readonly batch_id: string; readonly actor: string; readonly started_at: string }): Promise<ProductionSchedulerBatchResult> {
      if (!input.batch_id.trim() || !input.actor.trim()) throw new Error("SCHEDULER_BATCH_IDENTITY_MISSING");
      continuousTime(input.started_at);
      const startingState = await root.restore();
      const existing = startingState.scheduler_batches.find(batch => batch.batch_id === input.batch_id);
      if (existing) return { manifest: existing, manifest_commit: batchCommit(options, input.batch_id), reused: true };
      assertNoUnsettledSourceExecution(startingState);
      const recoveredOutcomes = startingState.source_execution_outcomes.filter(outcome =>
        outcome.continuous_authorization_ids.length > 0
        && outcome.source_execution_id === schedulerSourceExecutionId(input.batch_id, outcome.continuous_authorization_ids));
      const recoveredAuthorizationIds = new Set(recoveredOutcomes.flatMap(outcome => outcome.continuous_authorization_ids));
      const initialHead = recoveredOutcomes.length
        ? oldestCommittedParent(options, recoveredOutcomes.map(outcome => outcome.expected_parent))
        : startingState.committed_head;
      const selected = await committedSelection(options, now(), scope);
      if (selected.committed_head !== startingState.committed_head && selected.deferred.length > 0) {
        throw new Error(`SCHEDULER_CONCURRENT_SOURCE_DEFERRED:${selected.deferred[0]!.reason}`);
      }
      const committed: { readonly authorization_ids: readonly string[]; readonly source_execution_id: string; readonly result_commit: string }[] =
        recoveredOutcomes.map(outcome => ({ authorization_ids: outcome.continuous_authorization_ids,
          source_execution_id: outcome.source_execution_id,
          result_commit: sourceOutcomeCommit(options, outcome.source_execution_id) }));
      const deferred: SchedulerDeferredSource[] = selected.deferred.filter(item =>
        !recoveredAuthorizationIds.has(item.authorization_id));
      for (const targets of groupEndpointTargets(selected.eligible)) {
        const target = targets[0]!;
        const authorizationIds = targets.map(item => item.authorization_id).sort();
        if (authorizationIds.every(id => recoveredAuthorizationIds.has(id))) continue;
        if (authorizationIds.some(id => recoveredAuthorizationIds.has(id))) throw new Error("SCHEDULER_PARTIAL_GROUP_RECOVERY_DENIED");
        const adapter = options.resolve_adapter(target.adapter_key);
        if (!adapter) {
          deferred.push(...targets.map(item => toDeferred(item, "ADAPTER_UNAVAILABLE")));
          continue;
        }
        if (adapter.descriptor.adapter_key !== target.adapter_key) throw new Error("SCHEDULER_ADAPTER_BINDING_INVALID");
        const sourceExecutionId = schedulerSourceExecutionId(input.batch_id, authorizationIds);
        const execute = () => root.runProduction({
          run_id: sourceExecutionId,
          continuous_authorization_ids: authorizationIds,
          source_versions: [],
          source_admission_id: target.source_admission_id,
          recruitment_endpoint_id: target.recruitment_endpoint_id,
          adapter,
          transport: { async execute() { throw new Error("SCHEDULER_CALLER_TRANSPORT_DENIED"); } },
          provenance: { scope: "PRODUCTION", actor_id: input.actor,
            actor_role: "PRODUCTION_SCHEDULER", evidence_references: [target.authorization_id] },
          actor: input.actor,
          started_at: input.started_at
        });
        let result = await execute();
        if (!result.committed_head && isCasConflict(result.error)) {
          const fresh = await root.restore();
          const already = fresh.source_execution_outcomes.find(outcome => outcome.source_execution_id === sourceExecutionId);
          if (already) {
            committed.push({ authorization_ids: authorizationIds, source_execution_id: sourceExecutionId,
              result_commit: sourceOutcomeCommit(options, sourceExecutionId) });
            continue;
          }
          const refreshed = await committedSelection(options, now(), scope);
          const missing = authorizationIds.find(id => !refreshed.eligible.some(item => item.authorization_id === id));
          if (missing) {
            const reason = refreshed.deferred.find(item =>
              item.authorization_id === missing)?.reason ?? "AUTHORIZATION_REVOKED";
            throw new Error(`SCHEDULER_CONCURRENT_SOURCE_DEFERRED:${reason}`);
          }
          result = await execute();
        }
        if (!result.committed_head) {
          if (isCasConflict(result.error)) {
            throw new Error("SCHEDULER_CONCURRENT_SOURCE_DEFERRED:CAS_DEFERRED");
          }
          const refreshed = await committedSelection(options, now(), scope);
          const blocked = refreshed.deferred.find(item => authorizationIds.includes(item.authorization_id));
          if (blocked) {
            deferred.push(blocked);
            continue;
          }
          throw new Error(`SCHEDULER_SOURCE_NOT_COMMITTED: ${result.error ?? result.status}`);
        }
        committed.push({ authorization_ids: authorizationIds,
          source_execution_id: sourceExecutionId, result_commit: result.committed_head });
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const state = await root.restore();
        assertNoUnsettledSourceExecution(state);
        const concurrent = state.scheduler_batches.find(batch => batch.batch_id === input.batch_id);
        if (concurrent) return { manifest: concurrent, manifest_commit: batchCommit(options, input.batch_id), reused: true };
        const byOutcome = new Map(state.source_execution_outcomes.map(outcome => [outcome.source_execution_id, outcome]));
        const byRun = new Map(state.runs.map(run => [run.run_id, run]));
        const sourceExecutions: SchedulerSourceExecutionReference[] = committed.map(item => {
          const outcome = byOutcome.get(item.source_execution_id);
          if (!outcome || canonicalHash([...outcome.continuous_authorization_ids].sort()) !== canonicalHash([...item.authorization_ids].sort())) {
            throw new Error("SCHEDULER_SOURCE_OUTCOME_MISSING");
          }
          return { source_definition_id: outcome.source_definition_id,
            recruitment_endpoint_id: outcome.recruitment_endpoint_id,
            ...(item.authorization_ids.length === 1
              ? { authorization_id: item.authorization_ids[0]! }
              : { authorization_ids: [...item.authorization_ids] }),
            source_execution_id: item.source_execution_id,
            result_commit: item.result_commit,
            outcome_status: outcome.status,
            outcome_integrity_hash: outcome.integrity_hash,
            presentation_read_model_ids: byRun.get(item.source_execution_id)?.presentation_read_model_ids ?? [] };
        });
        const manifest = sealSchedulerBatchManifest({
          batch_id: input.batch_id,
          scheduler_policy_version: sourceExecutions.some(item => item.authorization_ids)
            ? "production-scheduler-batch/2.0.0" : SCHEDULER_POLICY_VERSION,
          initial_head: initialHead,
          manifest_parent: state.committed_head,
          started_at: input.started_at,
          completed_at: now(),
          actor: input.actor,
          source_executions: sourceExecutions,
          deferred_sources: deferred,
          batch_status: deriveSchedulerBatchStatus(sourceExecutions.map(item => item.outcome_status), deferred.length),
          presentation_publish_readiness: sourceExecutions.some(item => item.presentation_read_model_ids.length)
            ? "READY" : "NO_NEW_MODEL",
          public_website_published: false
        });
        try {
          const manifestCommit = appendSchedulerBatchManifest(options.remote_url, options.branch, manifest,
            identity, state.source_execution_outcomes, state.runs);
          return { manifest, manifest_commit: manifestCommit, reused: false };
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "SCHEDULER_BATCH_CAS_CONFLICT" || attempt === 1) throw error;
        }
      }
      throw new Error("SCHEDULER_BATCH_CAS_CONFLICT");
    }
  });
}

async function committedSelection(options: ProductionSchedulerBatchOptions, at: string,
  scope: NonNullable<ProductionSchedulerBatchOptions["continuous_scope"]>) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "scheduler-source-state-"));
  const checkout = path.join(directory, "checkout");
  try {
    execFileSync("git", ["clone", "--quiet", "--single-branch", "--branch", options.branch,
      "--no-tags", options.remote_url, checkout]);
    const repository = new GitSourceRegistryPersistence({ repository_path: checkout,
      fencing_verifier: options.continuous_fencing_verifier });
    return { ...enumerateScheduledSources(await repository.listVersions(), repository.listContinuousRecords(), at, scope),
      committed_head: gitText(checkout, "rev-parse", "HEAD") };
  } finally {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe scheduler source temporary directory");
    rmSync(resolved, { recursive: true, force: true });
  }
}

function toDeferred(target: ScheduledSource, reason: SchedulerDeferredSource["reason"]): SchedulerDeferredSource {
  return { source_definition_id: target.source_definition_id,
    recruitment_endpoint_id: target.recruitment_endpoint_id,
    authorization_id: target.authorization_id, reason };
}

function isCasConflict(error: string | null) {
  return !!error && /CAS_MISMATCH|CONTINUOUS_CAS|stale info|non-fast-forward|incorrect old value provided/u.test(error);
}

function batchCommit(options: ProductionSchedulerBatchOptions, batchId: string) {
  return committedFileCommit(options, `production-runs/scheduler-batches/${canonicalHash({ batch_id: batchId })}.json`);
}

function sourceOutcomeCommit(options: ProductionSchedulerBatchOptions, sourceExecutionId: string) {
  return committedFileCommit(options, `production-runs/source-executions/${canonicalHash({ source_execution_id: sourceExecutionId })}.json`);
}

function schedulerSourceExecutionId(batchId: string, authorizationIds: readonly string[]) {
  const sorted = [...authorizationIds].sort();
  return `scheduler-source:${canonicalHash(sorted.length === 1
    ? { batch_id: batchId, authorization_id: sorted[0] }
    : { batch_id: batchId, authorization_ids: sorted })}`;
}

function groupEndpointTargets(targets: readonly ScheduledSource[]): readonly (readonly ScheduledSource[])[] {
  const groups = new Map<string, ScheduledSource[]>();
  for (const target of targets) {
    const key = canonicalHash({ source_definition_id: target.source_definition_id,
      recruitment_endpoint_id: target.recruitment_endpoint_id,
      source_admission_id: target.source_admission_id, adapter_key: target.adapter_key });
    const group = groups.get(key) ?? [];
    if (group.some(item => item.exact_url === target.exact_url || item.authorization_id === target.authorization_id)) {
      throw new Error("SCHEDULER_DUPLICATE_TARGET_BINDING");
    }
    group.push(target);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function oldestCommittedParent(options: ProductionSchedulerBatchOptions, candidates: readonly string[]) {
  const unique = [...new Set(candidates)];
  if (unique.length === 1) return unique[0]!;
  const directory = mkdtempSync(path.join(os.tmpdir(), "scheduler-parent-read-"));
  const checkout = path.join(directory, "checkout");
  try {
    execFileSync("git", ["clone", "--quiet", "--single-branch", "--branch", options.branch,
      "--no-tags", options.remote_url, checkout]);
    const oldest = unique.find(candidate => unique.every(other => candidate === other
      || gitIsAncestor(checkout, candidate, other)));
    if (!oldest) throw new Error("SCHEDULER_RECOVERED_PARENT_DIVERGENCE");
    return oldest;
  } finally {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe scheduler parent temporary directory");
    rmSync(resolved, { recursive: true, force: true });
  }
}

function gitIsAncestor(repositoryPath: string, ancestor: string, descendant: string) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: repositoryPath });
    return true;
  } catch { return false; }
}

function gitText(repositoryPath: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: repositoryPath, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function assertNoUnsettledSourceExecution(state: Awaited<ReturnType<ReturnType<
  typeof bootstrapZeroCostProductionCompositionRoot>["restore"]>>) {
  if (pendingContinuousAttempt(state.continuous_records)) {
    throw new Error("SCHEDULER_CONCURRENT_SOURCE_DEFERRED:PENDING_GATE_DENIED");
  }
  const bound = new Set(state.source_execution_outcomes.flatMap(outcome => outcome.request_attempt_ids));
  const unsettled = state.continuous_records.find(record => record.kind === "COMPLETE"
    && record.payload.attempt_id && !bound.has(record.payload.attempt_id));
  if (unsettled) throw new Error("SCHEDULER_CONCURRENT_SOURCE_DEFERRED:SOURCE_OUTCOME_PENDING");
}

function committedFileCommit(options: ProductionSchedulerBatchOptions, relative: string) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "scheduler-commit-read-"));
  const checkout = path.join(directory, "checkout");
  try {
    execFileSync("git", ["clone", "--quiet", "--single-branch", "--branch", options.branch,
      "--no-tags", options.remote_url, checkout]);
    return execFileSync("git", ["log", "-1", "--format=%H", "--", relative],
      { cwd: checkout, encoding: "utf8" }).trim();
  } finally {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe scheduler commit temporary directory");
    rmSync(resolved, { recursive: true, force: true });
  }
}
