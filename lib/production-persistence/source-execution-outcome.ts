import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { canonicalDeserialize, canonicalHash, canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import type { ContinuousRecord } from "../application/source-admission/continuous-acquisition";
import type { AcquisitionPersistenceBundle, RawBlobManifest, SourcePersistenceVersion } from "./contracts";
import { isClosedOfficialJsonEmpty, type TrustedAcquisitionClassification } from "./trusted-acquisition-evidence";
import { SourceRunMissingGuard, type SourceRunId } from "../ingestion";

export const SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION = "production-source-execution-outcome/1.0.0" as const;

export type SourceExecutionStatus =
  | "SUCCESS" | "NOT_MODIFIED" | "CONFIRMED_EMPTY"
  | "SUSPICIOUS_EMPTY" | "PARTIAL" | "FAILED";

export interface SourceExecutionOutcome {
  readonly schema_version: typeof SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION;
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
  readonly integrity_hash: string;
}

export function sealSourceExecutionOutcome(
  input: Omit<SourceExecutionOutcome, "schema_version" | "integrity_hash">
): SourceExecutionOutcome {
  const content = { schema_version: SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION, ...input };
  return { ...content, integrity_hash: canonicalHash(content) };
}

export function writeSourceExecutionOutcome(repositoryPath: string, outcome: SourceExecutionOutcome) {
  assertSourceExecutionShape(outcome);
  const { integrity_hash: integrityHash, ...content } = outcome;
  if (outcome.schema_version !== SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION
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
  const grants = new Map(continuousRecords.filter(record => record.kind === "GRANT")
    .map(record => [record.payload.grant!.authorization_id, record.payload.grant!]));
  const reserves = new Map(continuousRecords.filter(record => record.kind === "RESERVE")
    .map(record => [record.payload.attempt_id!, record]));
  const completedAttempts = new Set(continuousRecords.filter(record => record.kind === "COMPLETE")
    .map(record => record.payload.attempt_id));
  const seen = new Set<string>();
  const entries = await Promise.all(names.map(async name => {
    const relativePath = `production-runs/source-executions/${name}`;
    const bytes = readFileSync(path.join(directory, name), "utf8");
    const outcome = canonicalDeserialize(bytes) as SourceExecutionOutcome;
    assertSourceExecutionShape(outcome);
    const { integrity_hash: integrityHash, ...content } = outcome;
    if (canonicalSerialize(outcome) !== bytes
      || outcome.schema_version !== SOURCE_EXECUTION_OUTCOME_SCHEMA_VERSION
      || integrityHash !== canonicalHash(content)
      || name !== `${canonicalHash({ source_execution_id: outcome.source_execution_id })}.json`
      || seen.has(outcome.source_execution_id)) {
      throw new Error(`Source execution outcome integrity mismatch: ${name}`);
    }
    seen.add(outcome.source_execution_id);
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
  const keys = ["schema_version", "source_execution_id", "status", "trusted_chain_status",
    "source_definition_id", "recruitment_endpoint_id", "source_version_ids",
    "source_admission_artifact_id", "continuous_authorization_ids", "request_attempt_ids",
    "expected_parent", "started_at", "completed_at", "reason_codes", "acquisition_evidence",
    "acquisition_run_ids", "acquisition_bundle_hashes", "raw_blob_ids", "snapshot_ids",
    "extracted_record_ids", "integrity_hash"];
  const listFields = ["source_version_ids", "continuous_authorization_ids", "request_attempt_ids",
    "reason_codes", "acquisition_run_ids", "acquisition_bundle_hashes", "raw_blob_ids",
    "snapshot_ids", "extracted_record_ids"] as const;
  if (!outcome || typeof outcome !== "object"
    || Object.keys(outcome).sort().join(",") !== keys.sort().join(",")
    || !["SUCCESS", "NOT_MODIFIED", "CONFIRMED_EMPTY", "SUSPICIOUS_EMPTY", "PARTIAL", "FAILED"].includes(outcome.status)
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

function git(repositoryPath: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: repositoryPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
