import type { SourceAdmission } from "../application/source-admission";
import { createSourcePersistenceVersion, type SourcePersistenceVersion } from "../production-persistence/contracts";
import { createHaier2027SourceVersions } from "./haier-2027-source";
import { createZhenghan2027SourceVersions } from "./zhenghan-2027-source";

export const INITIAL_PRODUCTION_ACTIVATION_AT = "2026-09-24T00:00:00.000Z";
export const INITIAL_PRODUCTION_CADENCE_SECONDS = 86_400;

const approvalReference = "user-approval:da2a74d1-2596-4171-8afe-0ef77f52a616";
const provenance = {
  scope: "PRODUCTION" as const,
  actor_id: "approved-initial-source-activation",
  actor_role: "HUMAN_APPROVED_CONTINUOUS_SCOPE",
  evidence_references: [approvalReference]
};

export function createInitialProductionActivationVersions(): readonly SourcePersistenceVersion[] {
  return [
    ...activateSource(createZhenghan2027SourceVersions({ observed_at: INITIAL_PRODUCTION_ACTIVATION_AT, provenance })),
    ...activateSource(createHaier2027SourceVersions({ observed_at: INITIAL_PRODUCTION_ACTIVATION_AT, provenance }))
  ];
}

function activateSource(base: readonly SourcePersistenceVersion[]): readonly SourcePersistenceVersion[] {
  const admissionVersion = base.find(version => version.artifact.kind === "SOURCE_ADMISSION");
  const targets = base.filter(version => version.artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST");
  if (admissionVersion?.artifact.kind !== "SOURCE_ADMISSION" || !targets.length
    || targets.some(version => version.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST")) {
    throw new Error("PRODUCTION_ACTIVATION_SOURCE_CONTRACT_MISSING");
  }
  const admission = admissionVersion.artifact.payload;
  const priorApproval = admission.evidence.find(evidence => evidence.kind === "MANUAL_REVIEW");
  const priorReview = admission.review_records.find(review => review.decision === "APPROVED");
  if (!priorApproval || !priorReview) throw new Error("PRODUCTION_ACTIVATION_APPROVAL_MISSING");
  const newEvidence = {
    ...priorApproval,
    source_admission_evidence_id: `${priorApproval.source_admission_evidence_id}-continuous` as typeof priorApproval.source_admission_evidence_id,
    locator: approvalReference,
    captured_at: INITIAL_PRODUCTION_ACTIVATION_AT,
    reviewer: "user-approved-continuous-scope",
    summary: { ...priorApproval.summary, text: "Continuous unattended acquisition approved only for the existing exact official targets" }
  };
  const evidence = [...admission.evidence, newEvidence];
  const review = {
    ...priorReview,
    source_admission_review_id: `${priorReview.source_admission_review_id}-continuous` as typeof priorReview.source_admission_review_id,
    reviewer: "user-approved-continuous-scope",
    reviewed_at: INITIAL_PRODUCTION_ACTIVATION_AT,
    rationale: { ...priorReview.rationale, text: "Revocable continuous acquisition of the existing exact official targets only" },
    evidence_ids: evidence.map(item => item.source_admission_evidence_id)
  };
  const approvedTargets = targets.map(version => {
    if (version.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST") throw new Error("PRODUCTION_ACTIVATION_TARGET_KIND_INVALID");
    const target = version.artifact.payload;
    if (!target.active || !target.exact_path || target.query_policy.mode !== "DENY_ALL") {
      throw new Error("PRODUCTION_ACTIVATION_TARGET_SCOPE_INVALID");
    }
    return { allowlist_entry_id: target.allowlist_entry_id,
      exact_url: `https://${target.host}${target.path_prefix}` };
  });
  const continuousAdmission: SourceAdmission = {
    ...admission,
    automation_basis: "HUMAN_APPROVED_CONTINUOUS_SCOPE",
    evidence,
    review_records: [...admission.review_records, review],
    continuous_acquisition_scope: {
      scope: "PRODUCTION", exact_targets: approvedTargets,
      min_interval_seconds: INITIAL_PRODUCTION_CADENCE_SECONDS,
      effective_from: INITIAL_PRODUCTION_ACTIVATION_AT,
      approval_review_id: review.source_admission_review_id
    }
  };
  const revisedAdmission = revise(admissionVersion, { kind: "SOURCE_ADMISSION", payload: continuousAdmission });
  return [
    ...base,
    revisedAdmission,
    ...targets.map(version => {
      if (version.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST") throw new Error("PRODUCTION_ACTIVATION_TARGET_KIND_INVALID");
      return revise(version, { kind: "OFFICIAL_ENDPOINT_ALLOWLIST", payload: {
        ...version.artifact.payload,
        source_admission_artifact_id: revisedAdmission.artifact_id,
        endpoint_purpose: admission.endpoint_purpose,
        approval_evidence_ids: evidence.map(item => item.source_admission_evidence_id)
      } });
    })
  ];
}

function revise(previous: SourcePersistenceVersion, artifact: SourcePersistenceVersion["artifact"]) {
  return createSourcePersistenceVersion({
    stream_id: previous.stream_id,
    revision: previous.revision + 1,
    supersedes_artifact_id: previous.artifact_id,
    artifact,
    provenance,
    effective_at: INITIAL_PRODUCTION_ACTIVATION_AT,
    created_at: INITIAL_PRODUCTION_ACTIVATION_AT
  });
}
