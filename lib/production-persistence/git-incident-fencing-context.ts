import { execFileSync } from "node:child_process";
import { assertContinuousRecord, type ContinuousRecord } from "../application/source-admission/continuous-acquisition";
import { canonicalHash, canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import type { SourceExecutionRequestIntent } from "./source-execution-request-intent";
import { createIncidentContinuousFencingEvidence, validateIncidentContinuousFencingEvidence,
  type IncidentContinuousFencingContext, type IncidentExecutorFacts, type IncidentRecoveryApproval } from "./continuous-fencing-evidence";

export const GIT_INCIDENT_FENCING_WITNESS_SCHEMA_VERSION = "git-incident-fencing-witness/1.0.0" as const;
const prefix = "production-source-state/continuous/fencing/";
const baseline = "f40714dc001994ca140df6002138c09aa5be223b";
const reserveCommit = "57ebf594af3b1019552edae25e9d9cd639aa48bb";
const intentCommit = "804e221ed9f49ef94c959110a32157d804768831";
const reservePath = "production-source-state/continuous/records/d4e160eb543706d5ff5d4a14364f6382e565100f54dabb3587593709cd8270ad.json";
const intentPath = "production-runs/source-request-intents/3c263ab2ab56fae9d1a82e569ae30ca4b9c1490ca848191c3b5d39329cb60b16.json";

export interface GitIncidentFencingWitness {
  readonly schema_version: typeof GIT_INCIDENT_FENCING_WITNESS_SCHEMA_VERSION;
  readonly historical_parent: string;
  readonly reserve: { readonly record_id: string; readonly integrity_hash: string };
  readonly intent: { readonly integrity_hash: string; readonly source_execution_id: string; readonly introducing_commit: string };
  readonly executor: IncidentExecutorFacts;
  readonly approval: IncidentRecoveryApproval;
  readonly actual_send: "UNKNOWN";
  readonly integrity_hash: string;
}

export interface GitIncidentFencingWitnessV2 extends Omit<GitIncidentFencingWitness, "schema_version"> {
  readonly schema_version: "git-incident-fencing-witness/2.0.0";
  readonly platform_capture: { readonly captured_at: string; readonly executor_head_sha: string };
}

export type GitIncidentFencingBaseContext = Omit<IncidentContinuousFencingContext, "executor" | "approval">;

export interface GitIncidentFencingReadOptions {
  readonly repository_path: string;
  readonly fixed_sha: string;
}

function deny(): never { throw new Error("GIT_INCIDENT_FENCING_CONTEXT_DENIED"); }
function exactKeys(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) deny();
}

export function readGitIncidentContinuousFencingContext(options: GitIncidentFencingReadOptions): IncidentContinuousFencingContext | null {
  return readIncidentContext(options, false) as IncidentContinuousFencingContext | null;
}

export function readGitIncidentFencingBaseContext(options: GitIncidentFencingReadOptions): GitIncidentFencingBaseContext {
  return readIncidentContext(options, true) as GitIncidentFencingBaseContext;
}

function readIncidentContext(options: GitIncidentFencingReadOptions, preparation: boolean, closingAt?: string): IncidentContinuousFencingContext | GitIncidentFencingBaseContext | null {
  if (!options || typeof options.repository_path !== "string" || !/^[a-f0-9]{40}$/u.test(options.fixed_sha)) deny();
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.longpaths=true", ...args], {
    cwd: options.repository_path, encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const fixed = options.fixed_sha;
  if (git("rev-parse", "--verify", `${fixed}^{commit}`).trim() !== fixed) deny();
  for (const ancestor of [baseline, intentCommit, reserveCommit]) git("merge-base", "--is-ancestor", ancestor, fixed);
  const names = git("ls-tree", "-r", "--name-only", "-z", fixed, "--", prefix).split("\0").filter(Boolean);
  if (git("log", "--format=", "--name-only", "--diff-filter=D", fixed, "--", prefix).trim()) deny();
  if (!preparation && !names.length) return null;
  if (preparation ? names.length !== 0 : names.length !== 1 || !new RegExp(`^${prefix}[a-f0-9]{64}\\.json$`, "u").test(names[0]!)) deny();
  const read = <Value>(sha: string, file: string): Value => {
    const bytes = git("show", `${sha}:${file}`);
    const value = JSON.parse(bytes) as Value;
    if (canonicalSerialize(value) !== bytes) deny();
    return value;
  };
  const sealed = (value: { readonly integrity_hash: string }) => {
    const { integrity_hash, ...content } = value;
    if (integrity_hash !== canonicalHash(content)) deny();
  };
  const witness = preparation ? null : read<GitIncidentFencingWitness | GitIncidentFencingWitnessV2>(fixed, names[0]!);
  if (witness) {
    const version2 = witness.schema_version === "git-incident-fencing-witness/2.0.0";
    if (closingAt !== undefined && !version2) deny();
    exactKeys(witness, ["schema_version", "historical_parent", "reserve", "intent", "executor", "approval", "actual_send", "integrity_hash",
      ...(version2 ? ["platform_capture"] : [])]);
    exactKeys(witness.reserve, ["record_id", "integrity_hash"]);
    exactKeys(witness.intent, ["integrity_hash", "source_execution_id", "introducing_commit"]);
    sealed(witness);
    if ((!version2 && witness.schema_version !== GIT_INCIDENT_FENCING_WITNESS_SCHEMA_VERSION) || witness.historical_parent !== baseline
      || witness.actual_send !== "UNKNOWN" || names[0] !== `${prefix}${witness.integrity_hash}.json`
      || witness.executor.completed_at !== "2026-10-09T09:15:22.000Z") deny();
    if (witness.schema_version === "git-incident-fencing-witness/2.0.0") {
      exactKeys(witness.platform_capture, ["captured_at", "executor_head_sha"]);
      const captured = witness.platform_capture.captured_at;
      if (witness.platform_capture.executor_head_sha !== "a0e64bb9d4a8caf7a3006537376e0e74c8296222"
        || typeof captured !== "string" || !Number.isFinite(Date.parse(captured))
        || new Date(captured).toISOString() !== captured
        || Date.parse(captured) < Date.parse(witness.executor.completed_at)
        || Date.parse(captured) < Date.parse(witness.approval.approved_at)
        || (closingAt !== undefined && Date.parse(closingAt) < Date.parse(captured))
        || witness.approval.reference !== "call_5e6879fe41a74f70bdc3c853658bee0e") deny();
    }
    const witnessIntroductions = git("log", "--format=%H", "--diff-filter=A", fixed, "--", names[0]!).trim().split(/\r?\n/u);
    if (witnessIntroductions.length !== 1 || !witnessIntroductions[0]) deny();
    git("merge-base", "--is-ancestor", baseline, `${witnessIntroductions[0]}^`);
  }
  for (const [file, introducingCommit] of [[reservePath, reserveCommit], [intentPath, intentCommit]]) {
    if (git("log", "--format=%H", "--diff-filter=A", fixed, "--", file!).trim() !== introducingCommit
      || git("show", `${fixed}:${file}`) !== git("show", `${introducingCommit}:${file}`)
      || git("log", "--format=", "--name-only", "--diff-filter=MD", `${introducingCommit}..${fixed}`, "--", file!).trim()) deny();
  }
  if (git("log", "-1", "--format=%H", `${reserveCommit}^`, "--", "production-runs/source-request-intents").trim() !== intentCommit) deny();
  git("merge-base", "--is-ancestor", intentCommit, `${reserveCommit}^`);
  const reserve = read<ContinuousRecord>(fixed, reservePath);
  assertContinuousRecord(reserve);
  const intent = read<SourceExecutionRequestIntent>(fixed, intentPath);
  sealed(intent);
  if (intent.schema_version !== "source-execution-request-intent/2.0.0" || intent.targets.length !== 1
    || (witness && (witness.reserve.record_id !== reserve.record_id || witness.reserve.integrity_hash !== reserve.integrity_hash
    || witness.intent.integrity_hash !== intent.integrity_hash || witness.intent.source_execution_id !== intent.source_execution_id
    || witness.intent.introducing_commit !== intentCommit))) deny();
  const target = intent.targets[0]!;
  if (target.request_policy.query !== "FINITE_VALUES" || target.request_policy.method !== "GET"
    || target.request_policy.redirect !== "DENY") deny();
  const state = read<{ readonly integrity_hash: string; readonly continuous_records: readonly {
    readonly record_id: string; readonly path: string; readonly integrity_hash: string }[] }>(reserveCommit, "production-source-state/state/current.json");
  sealed(state);
  if (state.continuous_records.filter(reference => reference.record_id === reserve.record_id
    && reference.path === reservePath && reference.integrity_hash === reserve.integrity_hash).length !== 1) deny();
  const grants = state.continuous_records.filter(reference => reference.record_id.startsWith("continuous-record:GRANT:"))
    .map(reference => {
      if (!/^production-source-state\/continuous\/records\/[a-f0-9]{64}\.json$/u.test(reference.path)) deny();
      const record = read<ContinuousRecord>(reserveCommit, reference.path);
      assertContinuousRecord(record);
      if (record.record_id !== reference.record_id || record.integrity_hash !== reference.integrity_hash) deny();
      return record;
    }).filter(record => record.payload.grant?.authorization_id === target.authorization_id);
  if (grants.length !== 1) deny();
  const grant = grants[0]!.payload.grant!;
  const bindings = grant.canonical_payload.bindings;
  if (grant.authorization_id !== reserve.payload.authorization_id || grant.authorization_version !== reserve.payload.authorization_version
    || grant.canonical_payload.scope !== "PRODUCTION" || grant.canonical_payload.exact_endpoint !== target.exact_url
    || grant.canonical_payload.cadence_ceiling.min_interval_seconds !== reserve.payload.min_interval_seconds
    || bindings.source.artifact_id !== intent.source_artifact_id || bindings.source.id !== intent.source_definition_id
    || bindings.endpoint.artifact_id !== intent.endpoint_artifact_id || bindings.endpoint.id !== intent.recruitment_endpoint_id
    || bindings.admission.artifact_id !== intent.source_admission_artifact_id
    || bindings.target.artifact_id !== target.allowlist_artifact_id
    || grant.canonical_payload.query_contract_hash !== target.request_policy.query_contract_hash) deny();
  const base: GitIncidentFencingBaseContext = {
    historical_parent: baseline, reserve,
    intent: { integrity_hash: intent.integrity_hash, source_execution_id: intent.source_execution_id,
      authorization_id: grant.authorization_id, exact_url: target.exact_url, introducing_commit: intentCommit, reserve_commit: reserveCommit }
  };
  if (preparation) return structuredClone(base);
  if (!witness) deny();
  const context: IncidentContinuousFencingContext = { ...base, executor: witness.executor, approval: witness.approval };
  createIncidentContinuousFencingEvidence(context);
  return structuredClone(context);
}

export function createGitIncidentContinuousFencingVerifier(options: GitIncidentFencingReadOptions) {
  const pinned = { ...options };
  return (attempt: ContinuousRecord, proof: unknown, closing_at?: string): boolean => {
    try {
      if (typeof closing_at !== "string" || !Number.isFinite(Date.parse(closing_at))
        || new Date(closing_at).toISOString() !== closing_at) return false;
      const context = readIncidentContext(pinned, false, closing_at) as IncidentContinuousFencingContext | null;
      if (!context || canonicalSerialize(attempt) !== canonicalSerialize(context.reserve)) return false;
      validateIncidentContinuousFencingEvidence(proof, context);
      return true;
    } catch { return false; }
  };
}
