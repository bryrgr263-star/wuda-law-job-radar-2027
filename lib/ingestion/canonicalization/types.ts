import type {
  CanonicalOpportunityId,
  CanonicalOpportunity,
  IdentityReconciliation,
  IdentityHash,
  OpportunityVersion,
  Organization,
  OrganizationId,
  SourceDefinition,
  SourceOccurrence,
  SourceOccurrenceVersion,
  SourceOccurrenceVersionId
} from "../domain";

export interface CanonicalizationCandidate {
  readonly occurrence: SourceOccurrence;
  readonly version: SourceOccurrenceVersion;
  readonly source_definition: SourceDefinition;
  readonly legacy_canonical_opportunity_id?: CanonicalOpportunityId;
}

export const CANONICALIZATION_REASON_CODES = [
  "EXACT_ORGANIZATION_MATCH",
  "EXACT_NORMALIZED_TITLE_MATCH",
  "RECRUITMENT_YEAR_MATCH",
  "RECRUITMENT_BATCH_MATCH",
  "LOCATION_SET_MATCH",
  "TIME_WINDOW_COMPATIBLE",
  "ORGANIZATION_UNRESOLVED",
  "ORGANIZATION_CONFLICT",
  "TITLE_CONFLICT",
  "RECRUITMENT_YEAR_MISSING",
  "RECRUITMENT_YEAR_CONFLICT",
  "RECRUITMENT_BATCH_MISSING",
  "RECRUITMENT_BATCH_CONFLICT",
  "LOCATION_MISSING",
  "LOCATION_CONFLICT",
  "TIME_WINDOW_MISSING",
  "TIME_WINDOW_CONFLICT",
  "RECRUITMENT_CONTEXT_MATCH",
  "OPPORTUNITY_IDENTITY_MATCH",
  "OPPORTUNITY_IDENTITY_CONFLICT",
  "POSITION_IDENTITY_MATCH",
  "POSITION_IDENTITY_CONFLICT",
  "POSITION_IDENTITY_PROVISIONAL",
  "POSITION_IDENTITY_UNRESOLVED",
  "RECRUITMENT_PLAN_IDENTITY_MATCH",
  "RECRUITMENT_PLAN_IDENTITY_CONFLICT",
  "RECRUITMENT_PLAN_IDENTITY_PROVISIONAL",
  "RECRUITMENT_PLAN_IDENTITY_UNRESOLVED",
  "RECRUITMENT_BATCH_IDENTITY_MATCH",
  "RECRUITMENT_BATCH_IDENTITY_CONFLICT",
  "RECRUITMENT_BATCH_IDENTITY_PROVISIONAL",
  "RECRUITMENT_BATCH_IDENTITY_UNRESOLVED",
  "RECRUITMENT_BATCH_APPLICABILITY_CONFLICT",
  "EMPLOYER_IDENTITY_MATCH",
  "EMPLOYER_IDENTITY_UNRESOLVED",
  "EMPLOYER_IDENTITY_CONFLICT",
  "LOCATION_IDENTITY_DISCRIMINATOR_MATCH",
  "LOCATION_IDENTITY_DISCRIMINATOR_UNRESOLVED",
  "LOCATION_IDENTITY_DISCRIMINATOR_CONFLICT",
  "IDENTITY_EVIDENCE_INSUFFICIENT",
  "IDENTITY_EVIDENCE_CONFLICT",
  "LEGACY_CONTEXT_RECONCILIATION_MISSING",
  "EXPLICIT_RECONCILIATION_MATCH",
  "TRANSITIVE_MERGE_CONFLICT_BLOCKED"
] as const;

export type CanonicalizationReasonCode =
  (typeof CANONICALIZATION_REASON_CODES)[number];

export interface CanonicalizationDecision {
  readonly left_source_occurrence_version_id: SourceOccurrenceVersionId;
  readonly right_source_occurrence_version_id: SourceOccurrenceVersionId;
  readonly outcome: "MERGE" | "SEPARATE";
  readonly reason_codes: readonly CanonicalizationReasonCode[];
  readonly resolved_organization_id?: OrganizationId;
  readonly canonical_identity_hash?: IdentityHash;
  readonly resolver_version: string;
}

export interface CanonicalizedOpportunity {
  readonly canonical_opportunity: CanonicalOpportunity;
  readonly opportunity_version: OpportunityVersion;
}

export interface CanonicalizationResult {
  readonly opportunities: readonly CanonicalizedOpportunity[];
  readonly decisions: readonly CanonicalizationDecision[];
}

export interface CanonicalizationContext {
  readonly organizations: readonly Organization[];
  readonly identity_reconciliations?: readonly IdentityReconciliation[];
}
