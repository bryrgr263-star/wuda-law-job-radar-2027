import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { canonicalDeserialize, canonicalHash, canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import { pendingContinuousAttempt, type ContinuousRecord } from "../application/source-admission/continuous-acquisition";
import { readSourceExecutionRequestIntents, type SourceExecutionRequestIntent } from "./source-execution-request-intent";
import type { AcquisitionPersistenceBundle, RawBlobManifest, SourcePersistenceVersion } from "./contracts";
import { isClosedOfficialJsonEmpty, type TrustedAcquisitionClassification } from "./trusted-acquisition-evidence";
import { SourceRunMissingGuard, type SourceRunId } from "../ingestion";
import { assertSourceExecutionRequestPlanBindings, assertSourceExecutionPaginationEvidence, type SourceExecutionRequestPlan } from "./source-execution-request-plan";

export const SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION = "production-source-execution-outcome/1.0.0" as const;
export const MULTI_TARGET_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION = "production-source-execution-outcome/2.0.0" as const;
export const DIAGNOSTIC_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION = "production-source-execution-outcome/3.0.0" as const;
export const RECOVERY_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION = "production-source-execution-outcome/4.0.0" as const;

export interface EvidenceLossRecoveryDecision {
  readonly expected_parent: string;
  readonly source_execution_id: string;
  readonly actor: string;
  readonly approval_reference: string;
  readonly incident_baseline: string;
  readonly decided_at: string;
  readonly original_evidence_available: boolean;
}

export interface EvidenceLossRecoveryProof {
  readonly reason: "UNPUBLISHED_EVIDENCE_LOST";
  readonly stage: "AUTHORITATIVE_SUBMISSION";
  readonly intent_hash: string;
  readonly intent_commit: string;
  readonly reserve: { readonly record_id: string; readonly integrity_hash: string };
  readonly complete: { readonly record_id: string; readonly integrity_hash: string };
  readonly incident_baseline: string;
  readonly actor: string;
  readonly approval_reference: string;
  readonly original_evidence_available: false;
}

export interface TrustedChainFailureDiagnostic {
  readonly stage: "SOURCE_DISCOVERY_SUPPORT_VERIFY" | "POST_ACQUISITION_EXECUTION";
  readonly error_code: "SOV_DISCOVERY_SUPPORT_RAW_CHANGED" | "TRUSTED_CHAIN_EXECUTION_FAILED";
  readonly subject_id: string;
}

export type SourceExecutionStatus =
  | "SUCCESS" | "NOT_MODIFIED" | "CONFIRMED_EMPTY"
  | "SUSPICIOUS_EMPTY" | "PARTIAL" | "FAILED";

export interface SourceExecutionOutcome {
  readonly schema_version: typeof SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION | typeof MULTI_TARGET_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION
    | typeof DIAGNOSTIC_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION | typeof RECOVERY_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION;
  readonly source_execution_id: string;
  readonly status: SourceExecutionStatus;
  readonly trusted_chain_status: "COMMITTED" | "NOT_RUN" | "FAILED";
  readonly source_definition_id: string;
  readonly recruitment_endpoint_id: string;
  readonly source_version_ids: readonly string[];
  readonly source_admission_artifact_id: string;
  readonly continuous_authorization_ids: readonly string[];
  readonly request_attempt_ids: readonly string[];
  readonly expected_parent: string;
  readonly started_at: string;
  readonly completed_at: string;
  readonly reason_codes: readonly string[];
  readonly acquisition_evidence: TrustedAcquisitionClassification;
  readonly acquisition_run_ids: readonly string[];
  readonly acquisition_bundle_hashes: readonly string[];
  readonly raw_blob_ids: readonly string[];
  readonly snapshot_ids: readonly string[];
  readonly extracted_record_ids: readonly string[];
  readonly request_plan?: SourceExecutionRequestPlan;
  readonly trusted_chain_failure?: TrustedChainFailureDiagnostic;
  readonly outcome_kind?: "RECOVERY_TERMINATION";
  readonly recovery?: EvidenceLossRecoveryProof;
  readonly integrity_hash: string;
}

export function sealSourceExecutionOutcome(
  input: Omit<SourceExecutionOutcome, "schema_version" | "integrity_hash">
): SourceExecutionOutcome {
  const content = { schema_version: input.trusted_chain_failure
    ? DIAGNOSTIC_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION
    : input.request_plan ? MULTI_TARGET_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION : SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION, ...input };
  return { ...content, integrity_hash: canonicalHash(content) };
}

export function writeSourceExecutionOutcome(repositoryPath: string, outcome: SourceExecutionOutcome) {
  assertSourceExecutionShape(outcome);
  const { integrity_hash: integrityHash, ...content } = outcome;
  if (![SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION, MULTI_TARGET_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION,
    DIAGNOSTIC_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION, RECOVERY_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION].includes(outcome.schema_version)
    || integrityHash !== canonicalHash(content)) throw new Error("Source execution outcome seal mismatch");
  const directory = path.join(repositoryPath, "production-runs", "source-executions");
  mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `${canonicalHash({ source_execution_id: outcome.source_execution_id })}.json`);
  const bytes = canonicalSerialize(outcome);
  try {
    writeFileSync(target, bytes, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (readFileSync(target, "utf8") !== bytes) throw new Error("Source execution outcome identity collision");
  }
}

export async function readSourceExecutionOutcomes(
  repositoryPath: string,
  acquisitions: readonly AcquisitionPersistenceBundle[],
  versions: readonly SourcePersistenceVersion[],
  continuousRecords: readonly ContinuousRecord[],
  readRaw: (manifest: RawBlobManifest) => Promise<Uint8Array | null>
): Promise<readonly SourceExecutionOutcome[]> {
  const directory = path.join(repositoryPath, "production-runs", "source-executions");
  let names: string[];
  try {
    names = readdirSync(directory).filter(name => name.endsWith(".json")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const byId = new Map(acquisitions.map(bundle => [bundle.acquisition_run.acquisition_run_id, bundle]));
  const versionIds = new Set(versions.map(version => version.artifact_id));
  const seen = new Set<string>();
  const entries = await Promise.all(names.map(async name => {
    const relativePath = `production-runs/source-executions/${name}`;
    const bytes = readFileSync(path.join(directory, name), "utf8");
    const outcome = canonicalDeserialize(bytes) as SourceExecutionOutcome;
    assertSourceExecutionShape(outcome);
    const { integrity_hash: integrityHash, ...content } = outcome;
    if (canonicalSerialize(outcome) !== bytes
      || ![SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION, MULTI_TARGET_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION,
        DIAGNOSTIC_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION, RECOVERY_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION].includes(outcome.schema_version)
      || integrityHash !== canonicalHash(content)
      || name !== `${canonicalHash({ source_execution_id: outcome.source_execution_id })}.json`
      || seen.has(outcome.source_execution_id)) {
      throw new Error(`Source execution outcome integrity mismatch: ${name}`);
    }
    seen.add(outcome.source_execution_id);
    if (outcome.outcome_kind === "RECOVERY_TERMINATION") {
      assertEvidenceLossRecoveryBinding(repositoryPath, outcome, versions, continuousRecords);
      const introducingCommit = git(repositoryPath, "log", "-1", "--format=%H", "--", relativePath).trim();
      if (!introducingCommit || git(repositoryPath, "rev-parse", `${introducingCommit}^`).trim() !== outcome.expected_parent) {
        throw new Error("RECOVERY_PARENT_MISMATCH");
      }
      if (acquisitions.some(bundle => bundle.acquisition_run.acquisition_run_id.startsWith(`${outcome.source_execution_id}:acquisition:`))) {
        throw new Error("RECOVERY_ACQUISITION_ALREADY_PRESENT");
      }
      return { outcome, introducingCommit };
    }
    let executionRecords = continuousRecords;
    if (outcome.request_plan?.schema_version === "source-execution-request-plan/2.0.0") {
      const parentState = canonicalDeserialize(git(repositoryPath, "show", `${outcome.expected_parent}:production-source-state/state/current.json`)) as {
        readonly integrity_hash: string;
        readonly continuous_records?: readonly { readonly record_id: string; readonly integrity_hash: string }[];
      };
      const { integrity_hash: stateHash, ...stateContent } = parentState;
      const references = parentState.continuous_records;
      if (stateHash !== canonicalHash(stateContent) || !Array.isArray(references)
        || references.some((reference, index) => reference.record_id !== continuousRecords[index]?.record_id
          || reference.integrity_hash !== continuousRecords[index]?.integrity_hash)) throw new Error("SOURCE_REQUEST_PLAN_RECORD_SCOPE_INVALID");
      executionRecords = continuousRecords.slice(0, references.length);
    }
    const grants = new Map(executionRecords.filter(record => record.kind === "GRANT")
      .map(record => [record.payload.grant!.authorization_id, record.payload.grant!]));
    const reserves = new Map(executionRecords.filter(record => record.kind === "RESERVE")
      .map(record => [record.payload.attempt_id!, record]));
    const completedAttempts = new Set(executionRecords.filter(record => record.kind === "COMPLETE")
      .map(record => record.payload.attempt_id));
    if (!outcome.source_version_ids.length
      || outcome.source_version_ids.some(id => !versionIds.has(id))
      || !versionIds.has(outcome.source_admission_artifact_id)
      || outcome.continuous_authorization_ids.some(id => {
        const grant = grants.get(id);
        return !grant || grant.canonical_payload.bindings.source.id !== outcome.source_definition_id
          || grant.canonical_payload.bindings.endpoint.id !== outcome.recruitment_endpoint_id
          || grant.canonical_payload.bindings.admission.artifact_id !== outcome.source_admission_artifact_id;
      })
      || outcome.request_attempt_ids.some(id => {
        const reservation = reserves.get(id);
        return !reservation || !completedAttempts.has(id)
          || !outcome.continuous_authorization_ids.includes(reservation.payload.authorization_id ?? "");
      })
      || (outcome.continuous_authorization_ids.length > 0
        && outcome.request_attempt_ids.length !== outcome.acquisition_run_ids.length)) {
      throw new Error(`Source execution upstream binding mismatch: ${name}`);
    }
    const introducingCommit = git(repositoryPath, "log", "-1", "--format=%H", "--", relativePath).trim();
    if (!introducingCommit || git(repositoryPath, "rev-parse", `${introducingCommit}^`).trim() !== outcome.expected_parent) {
      throw new Error(`Source execution parent mismatch: ${name}`);
    }
    if (outcome.acquisition_run_ids.length !== outcome.acquisition_bundle_hashes.length) {
      throw new Error(`Source execution acquisition coverage mismatch: ${name}`);
    }
    const linked = outcome.acquisition_run_ids.map((id, index) => {
      const bundle = byId.get(id);
      if (!bundle || canonicalHash(bundle) !== outcome.acquisition_bundle_hashes[index]
        || bundle.snapshot.recruitment_endpoint_id !== outcome.recruitment_endpoint_id
        || bundle.acquisition_run.source_admission_artifact_id !== outcome.source_admission_artifact_id
        || bundle.acquisition_run.acquisition_run_id !== `${outcome.source_execution_id}:acquisition:${index + 1}`) {
        throw new Error(`Source execution acquisition mismatch: ${id}`);
      }
      return bundle;
    });
    if (outcome.request_plan) assertSourceExecutionRequestPlanBindings(outcome.request_plan,
      outcome, versions, executionRecords, linked);
    if (outcome.request_plan?.schema_version === "source-execution-request-plan/2.0.0") {
      const rawBytes = new Map<string, Uint8Array>();
      for (const bundle of linked) {
        if (!bundle.raw_blob_manifest) continue;
        const bytes = await readRaw(bundle.raw_blob_manifest);
        if (bytes) rawBytes.set(bundle.raw_blob_manifest.raw_blob_id, bytes);
      }
      assertSourceExecutionPaginationEvidence(outcome.request_plan, outcome, versions, linked, rawBytes);
    }
    if (canonicalSerialize(linked.map(bundle => bundle.snapshot.snapshot_id)) !== canonicalSerialize(outcome.snapshot_ids)
      || canonicalSerialize(linked.flatMap(bundle => bundle.extracted_records.map(record => record.extracted_record_id)))
        !== canonicalSerialize(outcome.extracted_record_ids)
      || canonicalSerialize(linked.flatMap(bundle => bundle.raw_blob_manifest ? [bundle.raw_blob_manifest.raw_blob_id] : []))
        !== canonicalSerialize(outcome.raw_blob_ids)) {
      throw new Error(`Source execution artifact references mismatch: ${name}`);
    }
    if (outcome.acquisition_evidence.status !== outcome.status
      || canonicalSerialize(outcome.acquisition_evidence.raw_content_hashes)
        !== canonicalSerialize(linked.flatMap(bundle => bundle.raw_blob_manifest
          ? [bundle.raw_blob_manifest.raw_content_sha256] : []))
      || (outcome.acquisition_evidence.assessment
        && canonicalSerialize(outcome.reason_codes)
          !== canonicalSerialize(outcome.acquisition_evidence.assessment.reason_codes))
      || (["NOT_MODIFIED", "CONFIRMED_EMPTY"].includes(outcome.status)
        && outcome.acquisition_evidence.assessment?.status !== outcome.status)) {
      throw new Error(`Source execution status evidence mismatch: ${name}`);
    }
    if (outcome.status === "CONFIRMED_EMPTY") {
      const manifest = linked[0]?.raw_blob_manifest;
      const raw = manifest ? await readRaw(manifest) : null;
      const expectedValidation = {
        response_structure_valid: true, pagination_complete: true,
        explicit_empty_signal: true, official_result_count: 0,
        authentication_wall_detected: false, captcha_detected: false,
        error_page_detected: false, structure_drift_detected: false,
        historical_comparison: outcome.acquisition_evidence.prior_source_execution_id ? "CONSISTENT" : "UNAVAILABLE"
      };
      if (linked.length !== 1 || !manifest || !raw
        || !manifest.content_type.toLowerCase().includes("json")
        || !isClosedOfficialJsonEmpty(raw)
        || linked[0]!.extracted_records.length !== 0
        || canonicalSerialize(outcome.acquisition_evidence.empty_validation) !== canonicalSerialize(expectedValidation)) {
        throw new Error(`Source execution confirmed-empty proof mismatch: ${name}`);
      }
    }
    if (["NOT_MODIFIED", "CONFIRMED_EMPTY", "SUSPICIOUS_EMPTY"].includes(outcome.status)) {
      const evidence = outcome.acquisition_evidence;
      const assessment = evidence.assessment;
      if (!assessment) throw new Error(`Source execution guard assessment missing: ${name}`);
      const recomputed = new SourceRunMissingGuard().assessRun({
        source_run_id: outcome.source_execution_id as SourceRunId,
        source_definition_id: outcome.source_definition_id as never,
        recruitment_endpoint_id: outcome.recruitment_endpoint_id as never,
        started_at: outcome.started_at as never,
        completed_at: outcome.completed_at as never,
        snapshots: linked.map(bundle => bundle.snapshot),
        collection_completeness: {
          status: outcome.status === "NOT_MODIFIED" ? "COMPLETE" : "SUSPICIOUS_EMPTY",
          reason_codes: assessment.collection_reason_codes
        },
        observed_source_occurrence_ids: [],
        not_modified: outcome.status === "NOT_MODIFIED",
        ...(evidence.empty_validation ? { empty_result_validation: evidence.empty_validation } : {})
      });
      if (canonicalSerialize(recomputed) !== canonicalSerialize(assessment)
        || recomputed.status !== outcome.status) {
        throw new Error(`Source execution guard assessment mismatch: ${name}`);
      }
    }
    return { outcome, introducingCommit };
  }));
  const commitOrder = new Map(git(repositoryPath, "rev-list", "--reverse", "HEAD").trim()
    .split(/\r?\n/u).map((commit, index) => [commit, index] as const));
  const outcomes = entries.sort((left, right) =>
    (commitOrder.get(left.introducingCommit) ?? -1) - (commitOrder.get(right.introducingCommit) ?? -1))
    .map(entry => entry.outcome);
  const byExecutionId = new Map(outcomes.map(outcome => [outcome.source_execution_id, outcome]));
  for (const recovery of outcomes.filter(outcome => outcome.outcome_kind === "RECOVERY_TERMINATION")) {
    if (outcomes.some(outcome => outcome !== recovery && outcome.request_attempt_ids.some(id => recovery.request_attempt_ids.includes(id)))) {
      throw new Error("RECOVERY_ATTEMPT_DOUBLE_BOUND");
    }
  }
  for (const outcome of outcomes) {
    const priorId = outcome.acquisition_evidence.prior_source_execution_id;
    if (!priorId) continue;
    const prior = byExecutionId.get(priorId);
    if (!prior || prior.recruitment_endpoint_id !== outcome.recruitment_endpoint_id
      || canonicalSerialize(prior.source_version_ids) !== canonicalSerialize(outcome.source_version_ids)
      || prior.trusted_chain_status !== "COMMITTED"
      || !["SUCCESS", "NOT_MODIFIED"].includes(prior.status)) {
      throw new Error(`Source execution prior representation mismatch: ${outcome.source_execution_id}`);
    }
    if (outcome.status === "NOT_MODIFIED") {
      const currentBundles = outcome.acquisition_run_ids.map(id => byId.get(id)!);
      const priorBundles = prior.acquisition_run_ids.map(id => byId.get(id)!);
      if (!priorBundles.length || currentBundles.length !== priorBundles.length
        || currentBundles.some((bundle, index) => !bundle.raw_blob_manifest
          || bundle.acquisition_run.status !== "SUCCESS"
          || bundle.acquisition_run.request_metadata.locator !== priorBundles[index]?.acquisition_run.request_metadata.locator
          || bundle.raw_blob_manifest.raw_content_sha256 !== priorBundles[index]?.raw_blob_manifest?.raw_content_sha256)) {
        throw new Error(`Source execution unchanged-content proof mismatch: ${outcome.source_execution_id}`);
      }
    }
  }
  return outcomes;
}

function assertSourceExecutionShape(outcome: SourceExecutionOutcome) {
  if (outcome?.schema_version === RECOVERY_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION) {
    assertEvidenceLossRecoveryShape(outcome);
    return;
  }
  const keys = ["schema_version", "source_execution_id", "status", "trusted_chain_status",
    "source_definition_id", "recruitment_endpoint_id", "source_version_ids",
    "source_admission_artifact_id", "continuous_authorization_ids", "request_attempt_ids",
    "expected_parent", "started_at", "completed_at", "reason_codes", "acquisition_evidence",
    "acquisition_run_ids", "acquisition_bundle_hashes", "raw_blob_ids", "snapshot_ids",
    "extracted_record_ids", ...(outcome.request_plan ? ["request_plan"] : []),
    ...(outcome.trusted_chain_failure ? ["trusted_chain_failure"] : []), "integrity_hash"];
  const listFields = ["source_version_ids", "continuous_authorization_ids", "request_attempt_ids",
    "reason_codes", "acquisition_run_ids", "acquisition_bundle_hashes", "raw_blob_ids",
    "snapshot_ids", "extracted_record_ids"] as const;
  if (!outcome || typeof outcome !== "object"
    || Object.keys(outcome).sort().join(",") !== keys.sort().join(",")
    || !["SUCCESS", "NOT_MODIFIED", "CONFIRMED_EMPTY", "SUSPICIOUS_EMPTY", "PARTIAL", "FAILED"].includes(outcome.status)
    || (outcome.trusted_chain_failure
      ? outcome.schema_version !== DIAGNOSTIC_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION
      : outcome.request_plan
        ? outcome.schema_version !== MULTI_TARGET_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION
        : outcome.schema_version !== SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION)
    || (outcome.trusted_chain_failure
      ? outcome.trusted_chain_status !== "FAILED" || !validTrustedChainFailure(outcome.trusted_chain_failure)
      : outcome.schema_version === DIAGNOSTIC_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION)
    || !["COMMITTED", "NOT_RUN", "FAILED"].includes(outcome.trusted_chain_status)
    || [outcome.source_execution_id, outcome.source_definition_id, outcome.recruitment_endpoint_id,
      outcome.source_admission_artifact_id, outcome.expected_parent, outcome.started_at,
      outcome.completed_at, outcome.integrity_hash].some(value => typeof value !== "string" || !value.trim())
    || listFields.some(field => !Array.isArray(outcome[field])
      || outcome[field].some(value => typeof value !== "string" || !value.trim()))
    || !outcome.acquisition_evidence || typeof outcome.acquisition_evidence !== "object"
    || Object.keys(outcome.acquisition_evidence).sort().join(",") !== ["status", "assessment",
      "empty_validation", "prior_source_execution_id", "raw_content_hashes"].sort().join(",")
    || outcome.acquisition_evidence.status !== outcome.status
    || !Array.isArray(outcome.acquisition_evidence.raw_content_hashes)
    || outcome.acquisition_evidence.raw_content_hashes.some(value => typeof value !== "string" || !value.trim())) {
    throw new Error("Source execution outcome schema mismatch");
  }
}

export function prepareEvidenceLossRecoveryOutcome(repositoryPath: string, decision: EvidenceLossRecoveryDecision,
  versions: readonly SourcePersistenceVersion[], records: readonly ContinuousRecord[],
  outcomes: readonly SourceExecutionOutcome[]): SourceExecutionOutcome {
  if (decision.original_evidence_available !== false || !decision.actor?.trim() || !decision.approval_reference?.trim()) {
    throw new Error("RECOVERY_EXPLICIT_LOSS_APPROVAL_REQUIRED");
  }
  if (git(repositoryPath, "rev-parse", "HEAD").trim() !== decision.expected_parent) throw new Error("RECOVERY_STALE_PARENT");
  const intent = readSourceExecutionRequestIntents(repositoryPath, versions, records, decision.source_execution_id)
    .find(entry => entry.source_execution_id === decision.source_execution_id);
  if (!intent || intent.targets.length !== 1 || !intent.targets[0]!.authorization_id) throw new Error("RECOVERY_SINGLE_INTENT_REQUIRED");
  if (outcomes.some(outcome => outcome.source_execution_id === decision.source_execution_id)) throw new Error("RECOVERY_ALREADY_COVERED");
  const authorizationId = intent.targets[0]!.authorization_id;
  const reserve = [...records].reverse().find(record => record.kind === "RESERVE" && record.payload.authorization_id === authorizationId);
  const complete = records.find(record => record.kind === "COMPLETE" && record.payload.attempt_id === reserve?.payload.attempt_id);
  if (!reserve || !complete || pendingContinuousAttempt(records)) throw new Error("RECOVERY_COMPLETED_ATTEMPT_REQUIRED");
  if (outcomes.some(outcome => outcome.request_attempt_ids.includes(reserve.payload.attempt_id!))) throw new Error("RECOVERY_ALREADY_COVERED");
  const intentCommit = git(repositoryPath, "log", "-1", "--format=%H", "--", intentFile(intent)).trim();
  const content = {
    schema_version: RECOVERY_SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION,
    outcome_kind: "RECOVERY_TERMINATION" as const,
    source_execution_id: intent.source_execution_id,
    status: "FAILED" as const,
    trusted_chain_status: "FAILED" as const,
    source_definition_id: intent.source_definition_id,
    recruitment_endpoint_id: intent.recruitment_endpoint_id,
    source_version_ids: [intent.source_artifact_id, intent.endpoint_artifact_id,
      intent.source_admission_artifact_id, intent.targets[0]!.allowlist_artifact_id],
    source_admission_artifact_id: intent.source_admission_artifact_id,
    continuous_authorization_ids: [authorizationId], request_attempt_ids: [reserve.payload.attempt_id!],
    expected_parent: decision.expected_parent, started_at: reserve.payload.at!, completed_at: decision.decided_at,
    reason_codes: ["UNPUBLISHED_EVIDENCE_LOST"],
    acquisition_evidence: { status: "FAILED" as const, assessment: null, empty_validation: null,
      prior_source_execution_id: null, raw_content_hashes: [] },
    acquisition_run_ids: [], acquisition_bundle_hashes: [], raw_blob_ids: [], snapshot_ids: [], extracted_record_ids: [],
    recovery: { reason: "UNPUBLISHED_EVIDENCE_LOST" as const, stage: "AUTHORITATIVE_SUBMISSION" as const,
      intent_hash: intent.integrity_hash, intent_commit: intentCommit,
      reserve: { record_id: reserve.record_id, integrity_hash: reserve.integrity_hash },
      complete: { record_id: complete.record_id, integrity_hash: complete.integrity_hash },
      incident_baseline: decision.incident_baseline, actor: decision.actor,
      approval_reference: decision.approval_reference, original_evidence_available: false as const }
  };
  const outcome = { ...content, integrity_hash: canonicalHash(content) };
  assertEvidenceLossRecoveryShape(outcome);
  assertEvidenceLossRecoveryBinding(repositoryPath, outcome, versions, records);
  return outcome;
}

function assertEvidenceLossRecoveryShape(outcome: SourceExecutionOutcome) {
  const keys = ["schema_version", "outcome_kind", "source_execution_id", "status", "trusted_chain_status",
    "source_definition_id", "recruitment_endpoint_id", "source_version_ids", "source_admission_artifact_id",
    "continuous_authorization_ids", "request_attempt_ids", "expected_parent", "started_at", "completed_at",
    "reason_codes", "acquisition_evidence", "acquisition_run_ids", "acquisition_bundle_hashes", "raw_blob_ids",
    "snapshot_ids", "extracted_record_ids", "recovery", "integrity_hash"];
  const proof = outcome.recovery;
  const hashes = [outcome.integrity_hash, proof?.intent_hash, proof?.reserve?.integrity_hash, proof?.complete?.integrity_hash];
  const commits = [outcome.expected_parent, proof?.intent_commit, proof?.incident_baseline];
  const { integrity_hash: hash, ...content } = outcome;
  if (Object.keys(outcome).sort().join(",") !== keys.sort().join(",")
    || outcome.outcome_kind !== "RECOVERY_TERMINATION" || outcome.status !== "FAILED" || outcome.trusted_chain_status !== "FAILED"
    || hash !== canonicalHash(content) || hashes.some(value => typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    || commits.some(value => typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value))
    || !proof || Object.keys(proof).sort().join(",") !== ["reason", "stage", "intent_hash", "intent_commit", "reserve", "complete",
      "incident_baseline", "actor", "approval_reference", "original_evidence_available"].sort().join(",")
    || proof.reason !== "UNPUBLISHED_EVIDENCE_LOST" || proof.stage !== "AUTHORITATIVE_SUBMISSION"
    || proof.original_evidence_available !== false || !proof.actor?.trim() || !proof.approval_reference?.trim()
    || [proof.reserve, proof.complete].some(reference => Object.keys(reference).sort().join(",") !== "integrity_hash,record_id" || !reference.record_id)
    || !outcome.source_execution_id || !outcome.source_definition_id || !outcome.recruitment_endpoint_id
    || canonicalSerialize(outcome.reason_codes) !== canonicalSerialize(["UNPUBLISHED_EVIDENCE_LOST"])
    || !Number.isFinite(Date.parse(outcome.completed_at)) || new Date(outcome.completed_at).toISOString() !== outcome.completed_at
    || !Number.isFinite(Date.parse(outcome.started_at)) || new Date(outcome.started_at).toISOString() !== outcome.started_at
    || [outcome.acquisition_run_ids, outcome.acquisition_bundle_hashes, outcome.raw_blob_ids,
      outcome.snapshot_ids, outcome.extracted_record_ids].some(value => !Array.isArray(value) || value.length !== 0)
    || canonicalSerialize(outcome.acquisition_evidence) !== canonicalSerialize({ status: "FAILED", assessment: null,
      empty_validation: null, prior_source_execution_id: null, raw_content_hashes: [] })) {
    throw new Error("RECOVERY_SCHEMA_INVALID");
  }
}

function assertEvidenceLossRecoveryBinding(repositoryPath: string, outcome: SourceExecutionOutcome,
  versions: readonly SourcePersistenceVersion[], records: readonly ContinuousRecord[]) {
  const proof = outcome.recovery!;
  let parentState: { integrity_hash: string; continuous_records: { record_id: string; integrity_hash: string }[] };
  try {
    git(repositoryPath, "merge-base", "--is-ancestor", proof.incident_baseline, outcome.expected_parent);
    parentState = canonicalDeserialize(git(repositoryPath, "show", `${outcome.expected_parent}:production-source-state/state/current.json`));
  } catch { throw new Error("RECOVERY_INCIDENT_SCOPE_INVALID"); }
  const { integrity_hash: stateHash, ...stateContent } = parentState;
  if (stateHash !== canonicalHash(stateContent) || !Array.isArray(parentState.continuous_records)
    || parentState.continuous_records.some((reference, index) => reference.record_id !== records[index]?.record_id
      || reference.integrity_hash !== records[index]?.integrity_hash)) throw new Error("RECOVERY_RECORD_SCOPE_INVALID");
  const prefix = records.slice(0, parentState.continuous_records.length);
  const intent = readSourceExecutionRequestIntents(repositoryPath, versions, prefix, outcome.source_execution_id)
    .find(entry => entry.source_execution_id === outcome.source_execution_id);
  const reserve = prefix.find(record => record.record_id === proof.reserve.record_id);
  const complete = prefix.find(record => record.record_id === proof.complete.record_id);
  if (!intent || intent.integrity_hash !== proof.intent_hash || intent.targets.length !== 1
    || intent.source_definition_id !== outcome.source_definition_id || intent.recruitment_endpoint_id !== outcome.recruitment_endpoint_id
    || intent.source_admission_artifact_id !== outcome.source_admission_artifact_id
    || canonicalSerialize(outcome.source_version_ids) !== canonicalSerialize([intent.source_artifact_id, intent.endpoint_artifact_id,
      intent.source_admission_artifact_id, intent.targets[0]!.allowlist_artifact_id])
    || !reserve || !complete || reserve.kind !== "RESERVE" || complete.kind !== "COMPLETE" || pendingContinuousAttempt(prefix)
    || reserve.integrity_hash !== proof.reserve.integrity_hash || complete.integrity_hash !== proof.complete.integrity_hash
    || complete.payload.outcome !== "SUCCESS" || complete.payload.attempt_id !== reserve.payload.attempt_id
    || complete.payload.holder !== reserve.payload.holder || complete.sequence <= reserve.sequence
    || canonicalSerialize(outcome.request_attempt_ids) !== canonicalSerialize([reserve.payload.attempt_id])
    || canonicalSerialize(outcome.continuous_authorization_ids) !== canonicalSerialize([intent.targets[0]!.authorization_id])
    || reserve.payload.authorization_id !== intent.targets[0]!.authorization_id
    || outcome.started_at !== reserve.payload.at || Date.parse(outcome.completed_at) < Date.parse(complete.payload.at!)) {
    throw new Error("RECOVERY_UPSTREAM_MISMATCH");
  }
  const reservePath = `production-source-state/continuous/records/${canonicalHash({ record_id: reserve.record_id })}.json`;
  const reserveCommit = git(repositoryPath, "log", "-1", "--format=%H", "--", reservePath).trim();
  const originalIntentCommit = git(repositoryPath, "log", "-1", "--format=%H", `${reserveCommit}^`, "--", intentFile(intent)).trim();
  const latestPreReservationIntent = git(repositoryPath, "log", "-1", "--format=%H", `${reserveCommit}^`, "--", "production-runs/source-request-intents").trim();
  if (originalIntentCommit !== proof.intent_commit
    || latestPreReservationIntent !== originalIntentCommit
    || git(repositoryPath, "show", `${proof.intent_commit}:${intentFile(intent)}`).trim() !== canonicalSerialize(intent)) {
    throw new Error("RECOVERY_ORIGINAL_INTENT_MISMATCH");
  }
}

function intentFile(intent: SourceExecutionRequestIntent) {
  return `production-runs/source-request-intents/${canonicalHash({ source_execution_id: intent.source_execution_id })}.json`;
}

function validTrustedChainFailure(value: TrustedChainFailureDiagnostic): boolean {
  return !!value && typeof value === "object"
    && Object.keys(value).sort().join(",") === ["stage", "error_code", "subject_id"].sort().join(",")
    && ["SOURCE_DISCOVERY_SUPPORT_VERIFY", "POST_ACQUISITION_EXECUTION"].includes(value.stage)
    && ["SOV_DISCOVERY_SUPPORT_RAW_CHANGED", "TRUSTED_CHAIN_EXECUTION_FAILED"].includes(value.error_code)
    && typeof value.subject_id === "string" && !!value.subject_id.trim();
}

function git(repositoryPath: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: repositoryPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
