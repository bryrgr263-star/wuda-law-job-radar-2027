import type { PresentationDecision, PresentationReadModel } from "../../lib/ingestion";
import {
  PRESENTATION_DECISION_SCHEMA_VERSION,
  PRESENTATION_POLICY_V1_ID,
  PRESENTATION_POLICY_V1_VERSION,
  PRESENTATION_READ_MODEL_SCHEMA_VERSION
} from "../../lib/ingestion";
import { canonicalHash } from "../../lib/ingestion/normalization/canonical-artifact-registry";

export function sealedDecision(candidateId: string, recallId: string, recallHash: string): PresentationDecision {
  const withoutIntegrity = {
    presentation_decision_id: `presentation-decision:${canonicalHash({ opportunity_candidate_id: candidateId, revision: 1 })}` as never,
    opportunity_candidate_id: candidateId, recall_disposition_id: recallId,
    recall_disposition_integrity_hash: recallHash, relevance_assessment_id: null,
    relevance_integrity_hash: null, opportunity_version_id: null, position_id: null,
    position_version_id: null, source_composition_id: null, source_composition_hash: null,
    requirement_set_version_id: null, eligibility_assessment_id: null,
    eligibility_integrity_hash: null, eligibility_assessment_scope: null, policy_id: PRESENTATION_POLICY_V1_ID,
    policy_version: PRESENTATION_POLICY_V1_VERSION, status: "EVIDENCE_BLOCKED" as const,
    reason_codes: ["RELEVANCE_ASSESSMENT_MISSING"],
    decision_basis: { recall_status: "ACQUISITION_UNSUPPORTED", relevance_state: null,
      eligibility_result: null, candidate_source_binding: "UNBOUND" as const,
      approved_exclusion: false }, revision: 1, supersedes_presentation_decision_id: null,
    decided_at: "2026-09-14T08:00:00.000Z" as never,
    schema_version: PRESENTATION_DECISION_SCHEMA_VERSION
  } as const;
  return { ...withoutIntegrity, integrity_hash: canonicalHash(withoutIntegrity) } as unknown as PresentationDecision;
}

export function sealedModel(decision: PresentationDecision): PresentationReadModel {
  const missing = (reason: string) => ({ state: "NOT_YET_AVAILABLE" as const, reason });
  const withoutIntegrity = {
    presentation_read_model_id: `presentation-read-model:${decision.presentation_decision_id}` as never,
    presentation_decision_id: decision.presentation_decision_id,
    opportunity_candidate_id: decision.opportunity_candidate_id, decision_revision: decision.revision,
    presentation_status: decision.status, reason_codes: decision.reason_codes,
    policy_id: decision.policy_id, policy_version: decision.policy_version,
    opportunity_version_id: null, position_id: null, position_version_id: null,
    employer: missing("EMPLOYER_NOT_AVAILABLE"), position_title: missing("POSITION_TITLE_NOT_AVAILABLE"),
    locations: missing("LOCATION_NOT_AVAILABLE"), recruitment_year: missing("RECRUITMENT_YEAR_NOT_AVAILABLE"),
    recruitment_batch: missing("RECRUITMENT_BATCH_NOT_AVAILABLE"), announcement_link: missing("ANNOUNCEMENT_LINK_NOT_AVAILABLE"),
    application_link: missing("APPLICATION_LINK_NOT_AVAILABLE"), requirement_summary: missing("REQUIREMENT_SET_NOT_AVAILABLE"),
    updated_at: decision.decided_at, effective_at: missing("EFFECTIVE_TIME_NOT_AVAILABLE"),
    upstream: { decision_integrity_hash: decision.integrity_hash, recall_disposition_id: decision.recall_disposition_id,
      recall_disposition_integrity_hash: decision.recall_disposition_integrity_hash,
      relevance_assessment_id: null, relevance_integrity_hash: null, requirement_set_version_id: null,
      eligibility_assessment_id: null, eligibility_integrity_hash: null, eligibility_assessment_scope: null, source_composition_id: null,
      source_composition_hash: null, opportunity_version_semantic_hash: null,
      opportunity_version_integrity_hash: null, position_version_semantic_hash: null,
      position_version_integrity_hash: null, source_occurrence_version_ids: [] },
    schema_version: PRESENTATION_READ_MODEL_SCHEMA_VERSION
  } as const;
  return { ...withoutIntegrity, integrity_hash: canonicalHash(withoutIntegrity) } as PresentationReadModel;
}
