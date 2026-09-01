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
export type LifecycleEventId = BrandedString<"LifecycleEventId">;
export type RequirementFactId = BrandedString<"RequirementFactId">;
export type RequirementEvidenceId = BrandedString<"RequirementEvidenceId">;
export type LogicGroupId = BrandedString<"LogicGroupId">;
export type CandidateProfileId = BrandedString<"CandidateProfileId">;
export type EligibilityAssessmentId = BrandedString<"EligibilityAssessmentId">;

export type IdentityHash = BrandedString<"IdentityHash">;
export type SemanticHash = BrandedString<"SemanticHash">;
export type RawContentSha256 = BrandedString<"RawContentSha256">;
export type IsoDateTime = BrandedString<"IsoDateTime">;
export type IsoDate = BrandedString<"IsoDate">;

export type NonEmptyReadonlyArray<Value> = readonly [Value, ...Value[]];

export type NamespacedAdapterMetadata = Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>;
