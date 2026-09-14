import type {
  ExtractedRecordId,
  IsoDateTime,
  OpportunityCandidateId,
  RecallDispositionId,
  RecruitmentEndpointId,
  SnapshotId,
  SourceDefinitionId,
  SourceOccurrenceVersionId
} from "./primitives";

export const OPPORTUNITY_CANDIDATE_SCHEMA_VERSION =
  "opportunity-candidate/1.0.0" as const;
export const RECALL_DISPOSITION_SCHEMA_VERSION =
  "recall-disposition/1.0.0" as const;

export const RECALL_DISPOSITION_STATUSES = [
  "RETAINED",
  "REVIEW_REQUIRED",
  "EVIDENCE_BLOCKED",
  "ACQUISITION_UNSUPPORTED",
  "PARSING_UNSUPPORTED",
  "IDENTITY_UNCERTAIN",
  "EXCLUDED"
] as const;

export type RecallDispositionStatus =
  (typeof RECALL_DISPOSITION_STATUSES)[number];

export type PrePolicyRecallDispositionStatus = Exclude<
  RecallDispositionStatus,
  "EXCLUDED"
>;

export interface OpportunityCandidateSubjectObservation {
  readonly subject_identity: string;
  readonly subject_display_name: string;
  readonly evidence_id: string;
}

export interface OpportunityCandidate {
  readonly opportunity_candidate_id: OpportunityCandidateId;
  readonly source_definition_id: SourceDefinitionId;
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly discovery_locator: string;
  readonly snapshot_id: SnapshotId | null;
  readonly extracted_record_id: ExtractedRecordId | null;
  readonly source_occurrence_version_id: SourceOccurrenceVersionId | null;
  readonly publisher_subject: OpportunityCandidateSubjectObservation | null;
  readonly discovery_evidence_ids: readonly string[];
  readonly first_observed_at: IsoDateTime;
  readonly schema_version: typeof OPPORTUNITY_CANDIDATE_SCHEMA_VERSION;
  readonly integrity_hash: string;
}

export interface RecallExclusionRuleReference {
  readonly policy_id: string;
  readonly policy_version: string;
  readonly rule_id: string;
  readonly rule_version: string;
  readonly reason_code: string;
  readonly matched_subject_identity: string;
}

export interface RecallDisposition {
  readonly recall_disposition_id: RecallDispositionId;
  readonly opportunity_candidate_id: OpportunityCandidateId;
  readonly revision: number;
  readonly status: RecallDispositionStatus;
  readonly reason_codes: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly exclusion_rule: RecallExclusionRuleReference | null;
  readonly decided_at: IsoDateTime;
  readonly supersedes_recall_disposition_id: RecallDispositionId | null;
  readonly schema_version: typeof RECALL_DISPOSITION_SCHEMA_VERSION;
  readonly integrity_hash: string;
}
