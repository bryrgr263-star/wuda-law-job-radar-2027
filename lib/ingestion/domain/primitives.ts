declare const domainBrand: unique symbol;

export type BrandedString<Name extends string> = string & {
  readonly [domainBrand]: Name;
};

export type OrganizationId = BrandedString<"OrganizationId">;
export type SourceDefinitionId = BrandedString<"SourceDefinitionId">;
export type RecruitmentEndpointId = BrandedString<"RecruitmentEndpointId">;
export type RawBlobId = BrandedString<"RawBlobId">;
export type SnapshotId = BrandedString<"SnapshotId">;
export type ExtractedRecordId = BrandedString<"ExtractedRecordId">;
export type SourceOccurrenceId = BrandedString<"SourceOccurrenceId">;
export type SourceOccurrenceVersionId = BrandedString<"SourceOccurrenceVersionId">;
export type CanonicalOpportunityId = BrandedString<"CanonicalOpportunityId">;
export type OpportunityVersionId = BrandedString<"OpportunityVersionId">;
export type AnnouncementId = BrandedString<"AnnouncementId">;
export type AnnouncementVersionId = BrandedString<"AnnouncementVersionId">;
export type RecruitmentPlanId = BrandedString<"RecruitmentPlanId">;
export type RecruitmentBatchId = BrandedString<"RecruitmentBatchId">;
export type PositionId = BrandedString<"PositionId">;
export type PositionVersionId = BrandedString<"PositionVersionId">;
export type OrganizationRoleAssignmentId =
  BrandedString<"OrganizationRoleAssignmentId">;
export type LocationAssignmentId = BrandedString<"LocationAssignmentId">;
export type HeadcountObservationId = BrandedString<"HeadcountObservationId">;
export type RecruitmentPopulationReferenceId =
  BrandedString<"RecruitmentPopulationReferenceId">;
export type RecruitmentRevisionRelationId =
  BrandedString<"RecruitmentRevisionRelationId">;
export type IdentityEvidenceId = BrandedString<"IdentityEvidenceId">;
export type IdentityAliasId = BrandedString<"IdentityAliasId">;
export type IdentityReconciliationId = BrandedString<"IdentityReconciliationId">;
export type LifecycleEventId = BrandedString<"LifecycleEventId">;
export type RequirementFactId = BrandedString<"RequirementFactId">;
export type RequirementPredicateId = BrandedString<"RequirementPredicateId">;
export type RequirementEvidenceId = BrandedString<"RequirementEvidenceId">;
export type RequirementSetId = BrandedString<"RequirementSetId">;
export type RequirementObservationId = BrandedString<"RequirementObservationId">;
export type RequirementEvidenceFragmentId =
  BrandedString<"RequirementEvidenceFragmentId">;
export type LogicGroupId = BrandedString<"LogicGroupId">;
export type RequirementConditionId = BrandedString<"RequirementConditionId">;
export type RequirementLogicTreeId = BrandedString<"RequirementLogicTreeId">;
export type RequirementLogicNodeId = BrandedString<"RequirementLogicNodeId">;
export type RequirementMandatoryRootId =
  BrandedString<"RequirementMandatoryRootId">;
export type CandidateCredentialApplicabilityId =
  BrandedString<"CandidateCredentialApplicabilityId">;
export type CandidateStateApplicabilityId =
  BrandedString<"CandidateStateApplicabilityId">;
export type RequirementContextBindingId =
  BrandedString<"RequirementContextBindingId">;
export type RequirementSourceReferenceId =
  BrandedString<"RequirementSourceReferenceId">;
export type RequirementSelectorPredicateId =
  BrandedString<"RequirementSelectorPredicateId">;
export type SelectorLogicTreeId = BrandedString<"SelectorLogicTreeId">;
export type SelectorLogicNodeId = BrandedString<"SelectorLogicNodeId">;
export type ConditionalRequirementBranchSetId =
  BrandedString<"ConditionalRequirementBranchSetId">;
export type MajorExpressionId = BrandedString<"MajorExpressionId">;
export type MajorIdentityId = BrandedString<"MajorIdentityId">;
export type MajorMatchRelationId = BrandedString<"MajorMatchRelationId">;
export type MajorSemanticProjectionId =
  BrandedString<"MajorSemanticProjectionId">;
export type MajorConnectorObservationId =
  BrandedString<"MajorConnectorObservationId">;
export type SourceExclusionObservationId =
  BrandedString<"SourceExclusionObservationId">;
export type CandidateProfileId = BrandedString<"CandidateProfileId">;
export type CandidateStateAssertionId =
  BrandedString<"CandidateStateAssertionId">;
export type CandidateStateEvidenceId = BrandedString<"CandidateStateEvidenceId">;
export type EligibilityAssessmentId = BrandedString<"EligibilityAssessmentId">;
export type CandidateCredentialId = BrandedString<"CandidateCredentialId">;
export type CandidateBoundMajorMatchRelationId =
  BrandedString<"CandidateBoundMajorMatchRelationId">;
export type StructuredEligibilityAssessmentId =
  BrandedString<"StructuredEligibilityAssessmentId">;
export type SourceCompositionEvidenceId =
  BrandedString<"SourceCompositionEvidenceId">;
export type SourceSurfaceId = BrandedString<"SourceSurfaceId">;
export type SourceSurfaceBindingId = BrandedString<"SourceSurfaceBindingId">;
export type AttachmentPublicationBindingId =
  BrandedString<"AttachmentPublicationBindingId">;
export type AttachmentToPositionBindingId =
  BrandedString<"AttachmentToPositionBindingId">;
export type AuthorityAssertionId = BrandedString<"AuthorityAssertionId">;
export type DiscoveryBoundaryId = BrandedString<"DiscoveryBoundaryId">;
export type SourcePackageInventoryId =
  BrandedString<"SourcePackageInventoryId">;
export type ExpectedSurfaceManifestEntryId =
  BrandedString<"ExpectedSurfaceManifestEntryId">;
export type SourceVersionSelectionId =
  BrandedString<"SourceVersionSelectionId">;
export type SurfaceRevisionRelationId =
  BrandedString<"SurfaceRevisionRelationId">;
export type SourcePrecedenceDecisionId =
  BrandedString<"SourcePrecedenceDecisionId">;
export type SourceConflictId = BrandedString<"SourceConflictId">;
export type SourceCompositionResultId =
  BrandedString<"SourceCompositionResultId">;
export type OpportunityCandidateId = BrandedString<"OpportunityCandidateId">;
export type RecallDispositionId = BrandedString<"RecallDispositionId">;
export type LegalEmploymentRelevanceAssessmentId =
  BrandedString<"LegalEmploymentRelevanceAssessmentId">;
export type LegalEmploymentRelevanceFindingId =
  BrandedString<"LegalEmploymentRelevanceFindingId">;
export type PresentationDecisionId = BrandedString<"PresentationDecisionId">;
export type PresentationReadModelId = BrandedString<"PresentationReadModelId">;

export type IdentityHash = BrandedString<"IdentityHash">;
export type SemanticHash = BrandedString<"SemanticHash">;
export type RawContentSha256 = BrandedString<"RawContentSha256">;
export type SourceCompositionHash = BrandedString<"SourceCompositionHash">;
export type SourceCompositionManifestHash =
  BrandedString<"SourceCompositionManifestHash">;
export type DiscoveryBoundaryHash = BrandedString<"DiscoveryBoundaryHash">;
export type SourceSurfaceBindingHash = BrandedString<"SourceSurfaceBindingHash">;
export type AuthorityAssertionHash = BrandedString<"AuthorityAssertionHash">;
export type SourcePackageInventoryHash =
  BrandedString<"SourcePackageInventoryHash">;
export type ExpectedSurfaceManifestEntryHash =
  BrandedString<"ExpectedSurfaceManifestEntryHash">;
export type SourceVersionSelectionHash =
  BrandedString<"SourceVersionSelectionHash">;
export type SurfaceRevisionRelationHash =
  BrandedString<"SurfaceRevisionRelationHash">;
export type SourcePrecedenceDecisionHash =
  BrandedString<"SourcePrecedenceDecisionHash">;
export type SourceConflictHash = BrandedString<"SourceConflictHash">;
export type CandidateStateAssertionHash =
  BrandedString<"CandidateStateAssertionHash">;
export type IsoDateTime = BrandedString<"IsoDateTime">;
export type IsoDate = BrandedString<"IsoDate">;

export type NonEmptyReadonlyArray<Value> = readonly [Value, ...Value[]];

export type NamespacedAdapterMetadata = Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>;
