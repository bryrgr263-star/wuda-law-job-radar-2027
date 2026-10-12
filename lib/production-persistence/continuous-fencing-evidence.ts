import { assertContinuousRecord, type ContinuousRecord } from "../application/source-admission/continuous-acquisition";
import { canonicalHash, canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";

export const INCIDENT_CONTINUOUS_FENCING_SCHEMA_VERSION = "incident-continuous-fencing/1.0.0" as const;
const attemptId = "continuous-attempt:bccb61fd-fdb9-4ffa-a901-69cacbe35638";
const reserveHash = "91a59c623fd4a7030500d47f08ac188ceeeb7d1c2212c3f4cc0ed5683de86e77";
const intentHash = "8169698d98f484c03a8d8963d71368f8db2af77eaf31fc8e908f364719d8bd49";
const executionId = "scheduler-source:b11f252b67a074cdc98beacdba3d0dc9ba4e9a9a78b684522314d9a0bd8c98ab";
const repository = "bryrgr263-star/wuda-law-job-radar-2027";

export interface IncidentExecutorFacts {
  readonly repository: string;
  readonly run_id: string;
  readonly job_id: string;
  readonly run_attempt: number;
  readonly batch_id: string;
  readonly status: "completed";
  readonly conclusion: "failure";
  readonly completed_at: string;
  readonly reservation_commit: string;
  readonly source_execution_id: string;
}

export interface IncidentRecoveryApproval {
  readonly reference: string;
  readonly approved_at: string;
  readonly attempt_id: string;
  readonly action: "RECOVER_FENCED_UNKNOWN";
}

export interface IncidentContinuousFencingContext {
  readonly historical_parent: string;
  readonly reserve: ContinuousRecord;
  readonly intent: {
    readonly integrity_hash: string;
    readonly source_execution_id: string;
    readonly authorization_id: string;
    readonly exact_url: string;
    readonly introducing_commit: string;
    readonly reserve_commit: string;
  };
  readonly executor: IncidentExecutorFacts;
  readonly approval: IncidentRecoveryApproval;
}

export interface IncidentContinuousFencingEvidence {
  readonly schema_version: typeof INCIDENT_CONTINUOUS_FENCING_SCHEMA_VERSION;
  readonly historical_parent: string;
  readonly attempt_id: string;
  readonly reserve_integrity_hash: string;
  readonly holder: string;
  readonly authorization_id: string;
  readonly target_key: string;
  readonly min_interval_seconds: number;
  readonly intent_integrity_hash: string;
  readonly source_execution_id: string;
  readonly intent_commit: string;
  readonly reserve_commit: string;
  readonly executor: IncidentExecutorFacts;
  readonly approval: IncidentRecoveryApproval;
  readonly actual_send: "UNKNOWN";
  readonly integrity_hash: string;
}

function deny(): never { throw new Error("INCIDENT_CONTINUOUS_FENCING_DENIED"); }
function exactKeys(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) deny();
}
function timestamp(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) deny();
  return Date.parse(value);
}
function sha(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) deny();
}

export function createIncidentContinuousFencingEvidence(context: IncidentContinuousFencingContext): IncidentContinuousFencingEvidence {
  exactKeys(context, ["historical_parent", "reserve", "intent", "executor", "approval"]);
  const { reserve, intent, executor, approval } = context;
  if (!reserve) deny();
  assertContinuousRecord(reserve);
  exactKeys(intent, ["integrity_hash", "source_execution_id", "authorization_id", "exact_url", "introducing_commit", "reserve_commit"]);
  exactKeys(executor, ["repository", "run_id", "job_id", "run_attempt", "batch_id", "status", "conclusion", "completed_at", "reservation_commit", "source_execution_id"]);
  exactKeys(approval, ["reference", "approved_at", "attempt_id", "action"]);
  sha(context.historical_parent);
  sha(intent.introducing_commit);
  sha(intent.reserve_commit);
  const payload = reserve.payload;
  if (reserve.kind !== "RESERVE" || reserve.integrity_hash !== reserveHash || payload.attempt_id !== attemptId
    || intent.integrity_hash !== intentHash || intent.source_execution_id !== executionId
    || intent.introducing_commit !== "804e221ed9f49ef94c959110a32157d804768831"
    || intent.reserve_commit !== "57ebf594af3b1019552edae25e9d9cd639aa48bb"
    || payload.authorization_id !== intent.authorization_id || !payload.holder
    || payload.target_key !== canonicalHash({ exact_url: intent.exact_url, method: "GET" })
    || payload.min_interval_seconds !== 86400
    || executor.repository !== repository || executor.run_id !== "37909786610" || executor.job_id !== "113751898178"
    || executor.run_attempt !== 1 || executor.batch_id !== "github-actions:37909786610:1"
    || executor.status !== "completed" || executor.conclusion !== "failure"
    || executor.reservation_commit !== intent.reserve_commit || executor.source_execution_id !== executionId
    || executionId !== `scheduler-source:${canonicalHash({ batch_id: executor.batch_id, authorization_id: intent.authorization_id })}`
    || approval.action !== "RECOVER_FENCED_UNKNOWN" || approval.attempt_id !== attemptId
    || typeof approval.reference !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u.test(approval.reference)
    || timestamp(executor.completed_at) < timestamp(payload.at)
    || timestamp(approval.approved_at) < timestamp(executor.completed_at)) deny();
  const content = {
    schema_version: INCIDENT_CONTINUOUS_FENCING_SCHEMA_VERSION,
    historical_parent: context.historical_parent, attempt_id: attemptId, reserve_integrity_hash: reserve.integrity_hash,
    holder: payload.holder, authorization_id: intent.authorization_id, target_key: payload.target_key,
    min_interval_seconds: payload.min_interval_seconds, intent_integrity_hash: intent.integrity_hash,
    source_execution_id: executionId, intent_commit: intent.introducing_commit, reserve_commit: intent.reserve_commit,
    executor: structuredClone(executor), approval: structuredClone(approval), actual_send: "UNKNOWN" as const
  };
  return { ...content, integrity_hash: canonicalHash(content) };
}

export function validateIncidentContinuousFencingEvidence(proof: unknown, context: IncidentContinuousFencingContext): IncidentContinuousFencingEvidence {
  const expected = createIncidentContinuousFencingEvidence(context);
  if (!proof || canonicalSerialize(proof) !== canonicalSerialize(expected)) deny();
  return structuredClone(expected);
}
