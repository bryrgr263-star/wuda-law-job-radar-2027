import type {
  CandidateProfile,
  CandidateProfileId,
  CanonicalOpportunity,
  CanonicalOpportunityId,
  EligibilityAssessment,
  EligibilityAssessmentId,
  OpportunityVersion,
  OpportunityVersionId,
  OpportunityCandidate,
  OpportunityCandidateId,
  PresentationDecision,
  PresentationDecisionId,
  PresentationReadModel,
  PresentationReadModelId,
  PresentationMigrationAudit,
  Organization,
  OrganizationId,
  RecruitmentEndpoint,
  RecruitmentEndpointId,
  RequirementEvidence,
  RequirementEvidenceId,
  RequirementFact,
  RequirementFactId,
  RecallDisposition,
  RecallDispositionId,
  SourceDefinition,
  SourceDefinitionId,
  SourceOccurrence,
  SourceOccurrenceId,
  SourceOccurrenceVersion,
  SourceOccurrenceVersionId
} from "../domain";

export interface AppendOnlyRepository<Entity, Id> {
  append(entity: Entity): Entity;
  get(id: Id): Entity | null;
  count(): number;
}

export interface OpportunityRecallPersistenceRepository {
  appendRegistration(
    candidate: OpportunityCandidate,
    initialDisposition: RecallDisposition
  ): {
    readonly candidate: OpportunityCandidate;
    readonly disposition: RecallDisposition;
  };
  appendDisposition(disposition: RecallDisposition): RecallDisposition;
  getCandidate(id: OpportunityCandidateId): OpportunityCandidate | null;
  getDisposition(id: RecallDispositionId): RecallDisposition | null;
  listDispositions(id: OpportunityCandidateId): readonly RecallDisposition[];
  candidateCount(): number;
  dispositionCount(): number;
}

export interface PresentationReadRepository {
  readCurrentSnapshot?(): PresentationCurrentSnapshot | null | Promise<PresentationCurrentSnapshot | null>;
  listCurrentReadModels():
    readonly PresentationReadModel[] | Promise<readonly PresentationReadModel[]>;
}

export interface PresentationRetainedReference {
  readonly record_kind: "UNBOUND_RETAINED_OUTCOME";
  readonly public_series_member: false;
  readonly audit_outcome_id: string;
  readonly opportunity_candidate_id: string;
  readonly presentation_status: PresentationDecision["status"];
  readonly reason_codes: readonly string[];
  readonly public_collection_state: "POSITION_BINDING_REQUIRED";
}
export interface PresentationMigrationBlockedReference {
  readonly record_kind: "MIGRATION_BLOCKED";
  readonly public_series_member: false;
  readonly migration_id: string;
  readonly position_id: string;
  readonly opportunity_candidate_id: string;
  readonly historical_presentation_decision_ids: readonly string[];
  readonly public_collection_state: "MIGRATION_BLOCKED";
  readonly reason_code: string;
}
export interface PresentationCurrentSnapshot {
  readonly contract_version: "presentation-current-snapshot/2.0.0";
  readonly authoritative_head: string;
  readonly scope: "PRODUCTION" | "SYNTHETIC_TEST";
  readonly current_position_read_models: readonly PresentationReadModel[];
  readonly candidate_details: Readonly<Record<string, PresentationReadModel | PresentationRetainedReference | PresentationMigrationBlockedReference>>;
  readonly retention: {
    readonly unbound_outcome_count: number;
    readonly pending_candidate_count: number;
    readonly items: readonly PresentationRetainedReference[];
  };
  readonly migration: {
    readonly blocked_position_count: number;
    readonly items: readonly { readonly position_id: string; readonly reason_code: string;
      readonly migration_id: string; readonly anchored_input_head: string; readonly historical_presentation_decision_ids: readonly string[] }[];
  };
}

export interface PresentationPersistenceRepository extends PresentationReadRepository {
  readPresentationHistory?(): {
    readonly decisions: readonly PresentationDecision[];
    readonly read_models: readonly PresentationReadModel[];
    readonly migration_audits?: readonly PresentationMigrationAudit[];
  };
  appendMigrationAudit?(audit: PresentationMigrationAudit): PresentationMigrationAudit;
  appendDecision(decision: PresentationDecision): PresentationDecision;
  appendReadModel(readModel: PresentationReadModel): PresentationReadModel;
  getDecision(id: PresentationDecisionId): PresentationDecision | null;
  getReadModel(id: PresentationReadModelId): PresentationReadModel | null;
}

export interface ShadowPersistenceRepositories {
  readonly opportunity_recall: OpportunityRecallPersistenceRepository;
  readonly presentation: PresentationPersistenceRepository;
  readonly organizations: AppendOnlyRepository<Organization, OrganizationId>;
  readonly source_definitions: AppendOnlyRepository<
    SourceDefinition,
    SourceDefinitionId
  >;
  readonly recruitment_endpoints: AppendOnlyRepository<
    RecruitmentEndpoint,
    RecruitmentEndpointId
  >;
  readonly source_occurrences: AppendOnlyRepository<
    SourceOccurrence,
    SourceOccurrenceId
  >;
  readonly source_occurrence_versions: AppendOnlyRepository<
    SourceOccurrenceVersion,
    SourceOccurrenceVersionId
  >;
  readonly canonical_opportunities: AppendOnlyRepository<
    CanonicalOpportunity,
    CanonicalOpportunityId
  >;
  readonly opportunity_versions: AppendOnlyRepository<
    OpportunityVersion,
    OpportunityVersionId
  >;
  readonly requirement_facts: AppendOnlyRepository<
    RequirementFact,
    RequirementFactId
  >;
  readonly requirement_evidence: AppendOnlyRepository<
    RequirementEvidence,
    RequirementEvidenceId
  >;
  readonly candidate_profiles: AppendOnlyRepository<
    CandidateProfile,
    CandidateProfileId
  >;
  readonly eligibility_assessments: AppendOnlyRepository<
    EligibilityAssessment,
    EligibilityAssessmentId
  >;
}
