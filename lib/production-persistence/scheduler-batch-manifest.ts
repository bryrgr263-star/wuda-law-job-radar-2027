import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { canonicalDeserialize, canonicalHash, canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import type { ZeroCostCommittedRunManifest } from "./zero-cost-production-composition-root";
import type { SourceExecutionOutcome, SourceExecutionStatus } from "./source-execution-outcome";

export const SCHEDULER_BATCH_SCHEMA_VERSION = "production-scheduler-batch/1.0.0" as const;
export const SCHEDULER_POLICY_VERSION = "production-scheduler-batch/1.0.0" as const;
export const MULTI_TARGET_SCHEDULER_BATCH_SCHEMA_VERSION = "production-scheduler-batch/2.0.0" as const;

export type SchedulerBatchStatus = "SUCCESS" | "PARTIAL" | "FAILED";
export type SchedulerDeferredReason = "CADENCE_DENIED" | "PENDING_GATE_DENIED"
  | "AUTHORIZATION_NOT_EFFECTIVE" | "AUTHORIZATION_REVOKED" | "CAS_DEFERRED" | "ADAPTER_UNAVAILABLE";

interface SchedulerSourceExecutionBase {
  readonly source_definition_id: string;
  readonly recruitment_endpoint_id: string;
  readonly source_execution_id: string;
  readonly result_commit: string;
  readonly outcome_status: SourceExecutionStatus;
  readonly outcome_integrity_hash: string;
  readonly presentation_read_model_ids: readonly string[];
}

export type SchedulerSourceExecutionReference = SchedulerSourceExecutionBase & (
  { readonly authorization_id: string; readonly authorization_ids?: never }
  | { readonly authorization_ids: readonly string[]; readonly authorization_id?: never }
);

export interface SchedulerDeferredSource {
  readonly source_definition_id: string;
  readonly recruitment_endpoint_id: string;
  readonly authorization_id: string;
  readonly reason: SchedulerDeferredReason;
}

export interface SchedulerBatchManifest {
  readonly schema_version: typeof SCHEDULER_BATCH_SCHEMA_VERSION | typeof MULTI_TARGET_SCHEDULER_BATCH_SCHEMA_VERSION;
  readonly batch_id: string;
  readonly scheduler_policy_version: typeof SCHEDULER_POLICY_VERSION | typeof MULTI_TARGET_SCHEDULER_BATCH_SCHEMA_VERSION;
  readonly initial_head: string;
  readonly manifest_parent: string;
  readonly started_at: string;
  readonly completed_at: string;
  readonly actor: string;
  readonly source_executions: readonly SchedulerSourceExecutionReference[];
  readonly deferred_sources: readonly SchedulerDeferredSource[];
  readonly batch_status: SchedulerBatchStatus;
  readonly presentation_publish_readiness: "READY" | "NO_NEW_MODEL";
  readonly public_website_published: false;
  readonly integrity_hash: string;
}

export function deriveSchedulerBatchStatus(statuses: readonly SourceExecutionStatus[], deferredCount: number): SchedulerBatchStatus {
  if (!Number.isSafeInteger(deferredCount) || deferredCount < 0) throw new Error("BATCH_DEFERRED_COUNT_INVALID");
  const acceptable = statuses.filter(status => ["SUCCESS", "NOT_MODIFIED", "CONFIRMED_EMPTY"].includes(status)).length;
  if (acceptable === statuses.length && deferredCount === 0 && acceptable > 0) return "SUCCESS";
  return acceptable > 0 ? "PARTIAL" : "FAILED";
}

export function sealSchedulerBatchManifest(input: Omit<SchedulerBatchManifest, "schema_version" | "integrity_hash">): SchedulerBatchManifest {
  const content = {
    schema_version: input.source_executions.some(item => item.authorization_ids)
      ? MULTI_TARGET_SCHEDULER_BATCH_SCHEMA_VERSION : SCHEDULER_BATCH_SCHEMA_VERSION,
    batch_id: input.batch_id,
    scheduler_policy_version: input.scheduler_policy_version,
    initial_head: input.initial_head,
    manifest_parent: input.manifest_parent,
    started_at: input.started_at,
    completed_at: input.completed_at,
    actor: input.actor,
    source_executions: structuredClone(input.source_executions),
    deferred_sources: structuredClone(input.deferred_sources),
    batch_status: input.batch_status,
    presentation_publish_readiness: input.presentation_publish_readiness,
    public_website_published: false as const
  };
  const manifest = { ...content, integrity_hash: canonicalHash(content) };
  assertSchedulerBatchManifest(manifest);
  return manifest;
}

export function appendSchedulerBatchManifest(
  remoteUrl: string,
  branch: string,
  manifest: SchedulerBatchManifest,
  identity: { readonly name: string; readonly email: string },
  outcomes: readonly SourceExecutionOutcome[],
  runs: readonly ZeroCostCommittedRunManifest[]
): string {
  assertSchedulerBatchManifest(manifest);
  const directory = mkdtempSync(path.join(os.tmpdir(), "scheduler-batch-"));
  const checkout = path.join(directory, "checkout");
  try {
    execFileSync("git", ["clone", "--quiet", "--single-branch", "--branch", branch, "--no-tags", remoteUrl, checkout]);
    const relative = batchPath(manifest.batch_id);
    const target = path.join(checkout, relative);
    if (existsSync(target)) {
      const existing = readSchedulerBatchManifests(checkout, outcomes, runs).find(item => item.batch_id === manifest.batch_id);
      if (existing && canonicalSerialize(existing) === canonicalSerialize(manifest)) {
        return git(checkout, "log", "-1", "--format=%H", "--", relative).trim();
      }
      throw new Error("SCHEDULER_BATCH_IDENTITY_COLLISION");
    }
    const parent = git(checkout, "rev-parse", "HEAD").trim();
    if (parent !== manifest.manifest_parent || remoteHead(remoteUrl, branch) !== parent) {
      throw new Error("SCHEDULER_BATCH_CAS_CONFLICT");
    }
    assertManifestReferences(checkout, manifest, outcomes, runs);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, canonicalSerialize(manifest), { encoding: "utf8", flag: "wx" });
    git(checkout, "add", "--", relative);
    git(checkout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`,
      "commit", "-m", `scheduler-batch:${manifest.batch_id}`);
    if (remoteHead(remoteUrl, branch) !== parent) throw new Error("SCHEDULER_BATCH_CAS_CONFLICT");
    try { git(checkout, "push", "origin", `HEAD:refs/heads/${branch}`); }
    catch { throw new Error("SCHEDULER_BATCH_CAS_CONFLICT"); }
    const committed = git(checkout, "rev-parse", "HEAD").trim();
    if (remoteHead(remoteUrl, branch) !== committed) throw new Error("SCHEDULER_BATCH_REMOTE_COMMIT_MISMATCH");
    return committed;
  } finally {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe scheduler batch temporary directory");
    rmSync(resolved, { recursive: true, force: true });
  }
}

export function readSchedulerBatchManifests(
  repositoryPath: string,
  outcomes: readonly SourceExecutionOutcome[],
  runs: readonly ZeroCostCommittedRunManifest[]
): readonly SchedulerBatchManifest[] {
  const directory = path.join(repositoryPath, "production-runs", "scheduler-batches");
  if (!existsSync(directory)) return [];
  const entries = readdirSync(directory).filter(name => name.endsWith(".json")).map(name => {
    const relative = `production-runs/scheduler-batches/${name}`;
    const bytes = readFileSync(path.join(directory, name), "utf8");
    const manifest = canonicalDeserialize(bytes) as SchedulerBatchManifest;
    assertSchedulerBatchManifest(manifest);
    if (name !== `${canonicalHash({ batch_id: manifest.batch_id })}.json`
      || bytes !== canonicalSerialize(manifest)) throw new Error("SCHEDULER_BATCH_BYTES_MISMATCH");
    const commit = git(repositoryPath, "log", "-1", "--format=%H", "--", relative).trim();
    if (!commit || git(repositoryPath, "rev-parse", `${commit}^`).trim() !== manifest.manifest_parent) {
      throw new Error("SCHEDULER_BATCH_PARENT_MISMATCH");
    }
    const changed = git(repositoryPath, "diff-tree", "--no-commit-id", "--name-only", "-r", commit).trim();
    if (changed !== relative) throw new Error("SCHEDULER_BATCH_COMMIT_NOT_ISOLATED");
    assertManifestReferences(repositoryPath, manifest, outcomes, runs);
    return { manifest, commit };
  });
  const commits = git(repositoryPath, "rev-list", "--reverse", "HEAD").trim().split(/\r?\n/u);
  const order = new Map(commits.map((commit, index) => [commit, index] as const));
  return entries.sort((left, right) => (order.get(left.commit) ?? -1) - (order.get(right.commit) ?? -1))
    .map(entry => structuredClone(entry.manifest));
}

function assertSchedulerBatchManifest(manifest: SchedulerBatchManifest) {
  const keys = ["schema_version", "batch_id", "scheduler_policy_version", "initial_head", "manifest_parent",
    "started_at", "completed_at", "actor", "source_executions", "deferred_sources", "batch_status",
    "presentation_publish_readiness", "public_website_published", "integrity_hash"];
  if (!manifest || typeof manifest !== "object" || Object.keys(manifest).sort().join(",") !== keys.sort().join(",")
    || ![SCHEDULER_BATCH_SCHEMA_VERSION, MULTI_TARGET_SCHEDULER_BATCH_SCHEMA_VERSION].includes(manifest.schema_version)
    || manifest.scheduler_policy_version !== manifest.schema_version
    || [manifest.batch_id, manifest.initial_head, manifest.manifest_parent, manifest.started_at,
      manifest.completed_at, manifest.actor].some(value => typeof value !== "string" || !value.trim())
    || !Array.isArray(manifest.source_executions) || !Array.isArray(manifest.deferred_sources)
    || !["SUCCESS", "PARTIAL", "FAILED"].includes(manifest.batch_status)
    || !["READY", "NO_NEW_MODEL"].includes(manifest.presentation_publish_readiness)
    || manifest.public_website_published !== false) throw new Error("SCHEDULER_BATCH_SCHEMA_INVALID");
  const startedAt = Date.parse(manifest.started_at);
  const completedAt = Date.parse(manifest.completed_at);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)
    || new Date(startedAt).toISOString() !== manifest.started_at
    || new Date(completedAt).toISOString() !== manifest.completed_at
    || completedAt < startedAt) throw new Error("SCHEDULER_BATCH_TIME_INVALID");
  const { integrity_hash: hash, ...content } = manifest;
  if (hash !== canonicalHash(content)
    || manifest.batch_status !== deriveSchedulerBatchStatus(manifest.source_executions.map(item => item.outcome_status), manifest.deferred_sources.length)
    || manifest.presentation_publish_readiness !== (manifest.source_executions.some(item => item.presentation_read_model_ids.length)
      ? "READY" : "NO_NEW_MODEL")) throw new Error("SCHEDULER_BATCH_SEAL_INVALID");
  for (const reference of manifest.source_executions) assertSourceExecutionReference(reference);
  for (const reference of manifest.deferred_sources) assertDeferredSource(reference);
  const executionIds = manifest.source_executions.map(item => item.source_execution_id);
  const authorizationIds = [...manifest.source_executions.flatMap(item => item.authorization_ids ?? [item.authorization_id!]),
    ...manifest.deferred_sources.map(item => item.authorization_id)];
  if (new Set(executionIds).size !== executionIds.length
    || new Set(authorizationIds).size !== authorizationIds.length
    || (manifest.schema_version === SCHEDULER_BATCH_SCHEMA_VERSION
      && manifest.source_executions.some(item => item.authorization_ids))) throw new Error("SCHEDULER_BATCH_DUPLICATE_SOURCE");
}

function assertSourceExecutionReference(reference: SchedulerSourceExecutionReference) {
  const keys = ["source_definition_id", "recruitment_endpoint_id", reference.authorization_ids ? "authorization_ids" : "authorization_id", "source_execution_id",
    "result_commit", "outcome_status", "outcome_integrity_hash", "presentation_read_model_ids"];
  if (!reference || typeof reference !== "object"
    || Object.keys(reference).sort().join(",") !== keys.sort().join(",")
    || [reference.source_definition_id, reference.recruitment_endpoint_id,
      reference.source_execution_id, reference.result_commit, reference.outcome_integrity_hash]
      .some(value => typeof value !== "string" || !value.trim())
    || (reference.authorization_ids
      ? reference.authorization_ids.length < 2 || new Set(reference.authorization_ids).size !== reference.authorization_ids.length
        || reference.authorization_ids.some(id => typeof id !== "string" || !id.trim())
      : typeof reference.authorization_id !== "string" || !reference.authorization_id.trim())
    || !["SUCCESS", "NOT_MODIFIED", "CONFIRMED_EMPTY", "SUSPICIOUS_EMPTY", "PARTIAL", "FAILED"]
      .includes(reference.outcome_status)
    || !Array.isArray(reference.presentation_read_model_ids)
    || reference.presentation_read_model_ids.some(id => typeof id !== "string" || !id.trim())
    || new Set(reference.presentation_read_model_ids).size !== reference.presentation_read_model_ids.length) {
    throw new Error("SCHEDULER_BATCH_SCHEMA_INVALID");
  }
}

function assertDeferredSource(reference: SchedulerDeferredSource) {
  const keys = ["source_definition_id", "recruitment_endpoint_id", "authorization_id", "reason"];
  if (!reference || typeof reference !== "object"
    || Object.keys(reference).sort().join(",") !== keys.sort().join(",")
    || [reference.source_definition_id, reference.recruitment_endpoint_id, reference.authorization_id]
      .some(value => typeof value !== "string" || !value.trim())
    || !["CADENCE_DENIED", "PENDING_GATE_DENIED", "AUTHORIZATION_NOT_EFFECTIVE", "AUTHORIZATION_REVOKED",
      "CAS_DEFERRED", "ADAPTER_UNAVAILABLE"].includes(reference.reason)) {
    throw new Error("SCHEDULER_BATCH_SCHEMA_INVALID");
  }
}

function assertManifestReferences(repositoryPath: string, manifest: SchedulerBatchManifest,
  outcomes: readonly SourceExecutionOutcome[], runs: readonly ZeroCostCommittedRunManifest[]) {
  if (!isAncestor(repositoryPath, manifest.initial_head, manifest.manifest_parent)) {
    throw new Error("SCHEDULER_BATCH_INITIAL_HEAD_INVALID");
  }
  const byOutcome = new Map(outcomes.map(outcome => [outcome.source_execution_id, outcome]));
  const byRun = new Map(runs.map(run => [run.run_id, run]));
  for (const reference of manifest.source_executions) {
    const outcome = byOutcome.get(reference.source_execution_id);
    const run = byRun.get(reference.source_execution_id);
    const outcomePath = `production-runs/source-executions/${canonicalHash({ source_execution_id: reference.source_execution_id })}.json`;
    if (!outcome || outcome.integrity_hash !== reference.outcome_integrity_hash
      || outcome.status !== reference.outcome_status
      || outcome.source_definition_id !== reference.source_definition_id
      || outcome.recruitment_endpoint_id !== reference.recruitment_endpoint_id
      || canonicalSerialize([...outcome.continuous_authorization_ids].sort())
        !== canonicalSerialize([...(reference.authorization_ids ?? [reference.authorization_id!])].sort())
      || git(repositoryPath, "log", "-1", "--format=%H", "--", outcomePath).trim() !== reference.result_commit
      || !isAncestor(repositoryPath, reference.result_commit, manifest.manifest_parent)
      || canonicalSerialize(run?.presentation_read_model_ids ?? []) !== canonicalSerialize(reference.presentation_read_model_ids)) {
      throw new Error("SCHEDULER_BATCH_UPSTREAM_MISMATCH");
    }
  }
}

function batchPath(batchId: string) {
  return `production-runs/scheduler-batches/${canonicalHash({ batch_id: batchId })}.json`;
}

function isAncestor(repositoryPath: string, ancestor: string, descendant: string) {
  try { git(repositoryPath, "merge-base", "--is-ancestor", ancestor, descendant); return true; }
  catch { return false; }
}

function remoteHead(remoteUrl: string, branch: string) {
  return execFileSync("git", ["ls-remote", "--heads", remoteUrl, `refs/heads/${branch}`], { encoding: "utf8" }).trim().split(/\s+/u)[0];
}

function git(repositoryPath: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: repositoryPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
