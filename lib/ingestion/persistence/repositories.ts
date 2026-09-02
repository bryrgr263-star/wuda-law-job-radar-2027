import type {
  CandidateProfile,
  CandidateProfileId,
  CanonicalOpportunity,
  CanonicalOpportunityId,
  EligibilityAssessment,
  EligibilityAssessmentId,
  OpportunityVersion,
  OpportunityVersionId,
  Organization,
  OrganizationId,
  RecruitmentEndpoint,
  RecruitmentEndpointId,
  RequirementEvidence,
  RequirementEvidenceId,
  RequirementFact,
  RequirementFactId,
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

export interface ShadowPersistenceRepositories {
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
