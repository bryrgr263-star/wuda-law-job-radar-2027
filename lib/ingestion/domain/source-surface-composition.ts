import { createHash } from "node:crypto";

import type {
  AnnouncementId,
  AnnouncementVersionId,
  AttachmentPublicationBindingId,
  AttachmentToPositionBindingId,
  AuthorityAssertionId,
  AuthorityAssertionHash,
  DiscoveryBoundaryId,
  DiscoveryBoundaryHash,
  ExpectedSurfaceManifestEntryId,
  ExpectedSurfaceManifestEntryHash,
  ExtractedRecordId,
  IsoDateTime,
  LocationAssignmentId,
  OpportunityVersionId,
  PositionVersionId,
  RecruitmentBatchId,
  RecruitmentPlanId,
  RequirementSetId,
  SnapshotId,
  SourceCompositionEvidenceId,
  SourceCompositionHash,
  SourceCompositionManifestHash,
  SourceCompositionResultId,
  SourceConflictId,
  SourceConflictHash,
  SourceOccurrenceVersionId,
  SourcePackageInventoryId,
  SourcePackageInventoryHash,
  SourcePrecedenceDecisionId,
  SourcePrecedenceDecisionHash,
  SourceSurfaceBindingId,
  SourceSurfaceBindingHash,
  SourceSurfaceId,
  SurfaceRevisionRelationId,
  SurfaceRevisionRelationHash,
  SourceVersionSelectionId,
  SourceVersionSelectionHash
} from "./primitives";
import type { EvidenceLocator } from "./requirements";

export const SOURCE_COMPOSITION_SCHEMA_VERSION =
  "SOURCE_SURFACE_COMPOSITION_V1" as const;

export const SOURCE_COMPOSITION_GATE_VERSION =
  "source-composition-gate/1.0.0" as const;

export const SOURCE_SURFACE_KINDS = [
  "ANNOUNCEMENT_BODY",
  "ANNOUNCEMENT_ATTACHMENT",
  "POSITION_TABLE_ROW",
  "OFFICIAL_SYSTEM_RECORD",
  "SUPPLEMENT_NOTICE",
  "CORRECTION_NOTICE",
  "REPLACEMENT_NOTICE",
  "OFFICIAL_DIRECTORY_REFERENCE",
  "THIRD_PARTY_RECORD",
  "OTHER_REQUIREMENT_SURFACE",
  "UNRESOLVED"
] as const;

export const SOURCE_COMPOSITION_STATUSES = [
  "COMPLETE",
  "INCOMPLETE",
  "CONFLICT",
  "REVIEW_REQUIRED",
  "UNRESOLVED"
] as const;

export const SOURCE_SURFACE_BINDING_STATUSES = [
  "RESOLVED",
  "MISSING_TARGET",
  "TARGET_VERSION_MISMATCH",
  "LOCATOR_INVALID",
  "EVIDENCE_INCOMPLETE",
  "UNRESOLVED"
] as const;

export const AUTHORITY_ASSERTION_STATES = [
  "OFFICIAL_AUTHORITATIVE",
  "AUTHORIZED_SCOPED",
  "THIRD_PARTY_REFERENCE_ONLY",
  "UNKNOWN"
] as const;

export const INVENTORY_COMPLETENESS_STATUSES = [
  "CLOSED",
  "OPEN_MISSING_REQUIRED",
  "OPEN_UNRESOLVED",
  "UNRESOLVED"
] as const;

export type SourceSurfaceKind = (typeof SOURCE_SURFACE_KINDS)[number];
export type SourceCompositionStatus =
  (typeof SOURCE_COMPOSITION_STATUSES)[number];
export type SourceSurfaceBindingStatus =
  (typeof SOURCE_SURFACE_BINDING_STATUSES)[number];
export type AuthorityAssertionState =
  (typeof AUTHORITY_ASSERTION_STATES)[number];
export type InventoryCompletenessStatus =
  (typeof INVENTORY_COMPLETENESS_STATUSES)[number];

export interface SourceCompositionEffectivePeriod {
  readonly effective_from?: IsoDateTime;
  readonly effective_to?: IsoDateTime;
}

export interface SourceCompositionEvidence {
  readonly source_composition_evidence_id: SourceCompositionEvidenceId;
  readonly snapshot_id: SnapshotId;
  readonly extracted_record_id: ExtractedRecordId;
  readonly source_occurrence_version_id: SourceOccurrenceVersionId;
  readonly locator: EvidenceLocator;
  readonly observed_at: IsoDateTime;
  readonly extractor_version: string;
}

export interface SourceSurface {
  readonly source_surface_id: SourceSurfaceId;
  readonly surface_kind: SourceSurfaceKind;
  readonly source_occurrence_version_id: SourceOccurrenceVersionId;
  readonly snapshot_id: SnapshotId;
  readonly extracted_record_id: ExtractedRecordId;
  readonly locator: EvidenceLocator;
  readonly surface_content_hash: string;
  readonly effective_period: SourceCompositionEffectivePeriod;
  readonly source_publication_time?: IsoDateTime;
  readonly observed_at: IsoDateTime;
  readonly surface_status:
    | "OBSERVED"
    | "ACQUIRED"
    | "PARSED"
    | "MISSING"
    | "BINDING_UNRESOLVED"
    | "AUTHORITY_UNRESOLVED"
    | "RELATION_UNRESOLVED"
    | "EXCLUDED_BY_EVIDENCED_DECISION"
    | "UNRESOLVED";
  readonly composition_role:
    | "PRIMARY"
    | "SUPPLEMENT"
    | "REFERENCE"
    | "OVERRIDE"
    | "CORRECTION"
    | "SUPERSEDES"
    | "CONFLICT";
  readonly target_scope: string;
  readonly evidence_ids: readonly SourceCompositionEvidenceId[];
  readonly extractor_version: string;
  readonly parser_version: string;
  readonly resolver_version: string;
  readonly schema_version: typeof SOURCE_COMPOSITION_SCHEMA_VERSION;
}

export type SourceSurfaceTargetType =
  | "ANNOUNCEMENT"
  | "ANNOUNCEMENT_VERSION"
  | "RECRUITMENT_PLAN"
  | "RECRUITMENT_BATCH"
  | "POSITION"
  | "POSITION_VERSION"
  | "OPPORTUNITY"
  | "OPPORTUNITY_VERSION"
  | "LOCATION_ASSIGNMENT"
  | "SYSTEM_RECORD"
  | "UNRESOLVED";

export type SourceSurfaceBindingKind =
  | "SURFACE_DECLARATION"
  | "ANNOUNCEMENT_UNIFORM"
  | "ATTACHMENT_PUBLICATION"
  | "ATTACHMENT_ROW"
  | "BATCH_APPLICABILITY"
  | "LOCATION_APPLICABILITY"
  | "SYSTEM_RECORD_APPLICABILITY"
  | "REVISION_SCOPE"
  | "AUTHORITY_BASIS"
  | "OTHER"
  | "UNRESOLVED";

export interface SourceSurfaceBindingContext {
  readonly source_occurrence_version_id: SourceOccurrenceVersionId;
  readonly snapshot_id: SnapshotId;
  readonly extracted_record_id: ExtractedRecordId;
  readonly observed_at: IsoDateTime;
  readonly resolver_version: string;
}

export interface SourceSurfaceBinding {
  readonly source_surface_binding_id: SourceSurfaceBindingId;
  readonly source_surface_id: SourceSurfaceId;
  readonly target_type: SourceSurfaceTargetType;
  readonly target_id: string;
  readonly target_version_id?: string;
  readonly binding_kind: SourceSurfaceBindingKind;
  readonly binding_status: SourceSurfaceBindingStatus;
  readonly evidence_ids: readonly SourceCompositionEvidenceId[];
  readonly created_context: SourceSurfaceBindingContext;
  readonly observed_context: SourceSurfaceBindingContext;
  readonly locator: EvidenceLocator;
  readonly schema_version: typeof SOURCE_COMPOSITION_SCHEMA_VERSION;
  readonly binding_hash?: SourceSurfaceBindingHash;
}

export interface AttachmentPublicationBinding extends SourceSurfaceBinding {
  readonly attachment_publication_binding_id: AttachmentPublicationBindingId;
  readonly binding_kind: "ATTACHMENT_PUBLICATION";
  readonly attachment_surface_id: SourceSurfaceId;
  readonly publication_source_surface_id: SourceSurfaceId;
}

export interface AttachmentToPositionBinding extends SourceSurfaceBinding {
  readonly attachment_to_position_binding_id: AttachmentToPositionBindingId;
  readonly binding_kind: "ATTACHMENT_ROW";
  readonly attachment_publication_binding_id: AttachmentPublicationBindingId;
  readonly attachment_surface_id: SourceSurfaceId;
  readonly position_version_id: PositionVersionId;
  readonly opportunity_version_id: OpportunityVersionId;
  readonly row_locator?: string;
  readonly cell_locator?: string;
  readonly page_locator?: string;
  readonly span_locator?: string;
  readonly binding_version: string;
}

export interface AuthorityAssertion {
  readonly authority_assertion_id: AuthorityAssertionId;
  readonly asserted_source_surface_id: SourceSurfaceId;
  readonly authority_basis_source_surface_id: SourceSurfaceId;
  readonly authority_basis_binding_id?: SourceSurfaceBindingId;
  readonly issuer: string;
  readonly authority_state: AuthorityAssertionState;
  readonly target_scope: string;
  readonly effective_period: SourceCompositionEffectivePeriod;
  readonly evidence_ids: readonly SourceCompositionEvidenceId[];
  readonly resolver_version: string;
  readonly schema_version: typeof SOURCE_COMPOSITION_SCHEMA_VERSION;
  readonly authority_assertion_hash?: AuthorityAssertionHash;
}

export interface DiscoveryBoundary {
  readonly discovery_boundary_id: DiscoveryBoundaryId;
  readonly opportunity_version_id: OpportunityVersionId;
  readonly boundary_kind:
    | "ANNOUNCEMENT_PACKAGE"
    | "PLAN_PACKAGE"
    | "BATCH_PACKAGE"
    | "POSITION_PACKAGE"
    | "OFFICIAL_SYSTEM_PACKAGE"
    | "UNRESOLVED";
  readonly initiating_source_surface_ids: readonly SourceSurfaceId[];
  readonly source_metadata_references: readonly string[];
  readonly discovery_scope: string;
  readonly admissible_relation_kinds: readonly string[];
  readonly evidence_ids: readonly SourceCompositionEvidenceId[];
  readonly composition_as_of: IsoDateTime;
  readonly observed_at: IsoDateTime;
  readonly extractor_version: string;
  readonly discovery_resolver_version: string;
  readonly schema_version: typeof SOURCE_COMPOSITION_SCHEMA_VERSION;
  readonly discovery_boundary_hash?: DiscoveryBoundaryHash;
}

export interface ExpectedSurfaceManifestEntry {
  readonly expected_surface_manifest_entry_id: ExpectedSurfaceManifestEntryId;
  readonly expected_surface_key: string;
  readonly source_surface_id: SourceSurfaceId | null;
  readonly expectedness:
    | "REQUIRED"
    | "OPTIONAL"
    | "REFERENCE_ONLY"
    | "UNEXPECTED";
  readonly requirement_level:
    | "REQUIREMENT_BEARING"
    | "NON_REQUIREMENT_REFERENCE"
    | "UNRESOLVED";
  readonly authority_status: AuthorityAssertionState | "UNRESOLVED";
  readonly authority_assertion_id?: AuthorityAssertionId;
  readonly binding_status: SourceSurfaceBindingStatus;
  readonly material_binding_ids: readonly SourceSurfaceBindingId[];
  readonly version_selection_status: SourceVersionSelectionStatus;
  readonly source_version_selection_id?: SourceVersionSelectionId;
  readonly coverage_status: "COVERED" | "MISSING" | "UNRESOLVED" | "OUT_OF_SCOPE";
  readonly resolution_status: "RESOLVED" | "UNRESOLVED";
  readonly target_scope: string;
  readonly evidence_ids: readonly SourceCompositionEvidenceId[];
  readonly expected_surface_manifest_entry_hash?: ExpectedSurfaceManifestEntryHash;
}

export interface SourcePackageInventory {
  readonly source_package_inventory_id: SourcePackageInventoryId;
  readonly discovery_boundary_id: DiscoveryBoundaryId;
  readonly composition_as_of: IsoDateTime;
  readonly discovered_source_surface_ids: readonly SourceSurfaceId[];
  readonly expected_surface_entries: readonly ExpectedSurfaceManifestEntry[];
  readonly inventory_completeness_status: InventoryCompletenessStatus;
  readonly unexpected_surface_dispositions:
    readonly UnexpectedSurfaceDisposition[];
  readonly discovery_resolver_version: string;
  readonly schema_version: typeof SOURCE_COMPOSITION_SCHEMA_VERSION;
  readonly source_package_inventory_hash?: SourcePackageInventoryHash;
}

export interface UnexpectedSurfaceDisposition {
  readonly expected_surface_manifest_entry_id: ExpectedSurfaceManifestEntryId;
  readonly disposition:
    | "RECLASSIFIED_REQUIRED"
    | "RECLASSIFIED_OPTIONAL"
    | "RECLASSIFIED_REFERENCE_ONLY"
    | "EVIDENCED_OUT_OF_SCOPE"
    | "UNRESOLVED";
  readonly evidence_ids: readonly SourceCompositionEvidenceId[];
  readonly resolver_version: string;
  readonly schema_version: typeof SOURCE_COMPOSITION_SCHEMA_VERSION;
}

export type SourceVersionSelectionStatus =
  | "RESOLVED"
  | "NO_EFFECTIVE_VERSION"
  | "EFFECTIVE_TIME_UNKNOWN"
  | "RELATION_UNRESOLVED"
  | "CONFLICT"
  | "UNRESOLVED";

export interface SourceVersionSelection {
  readonly source_version_selection_id: SourceVersionSelectionId;
  readonly source_identity: string;
  readonly target_scope: string;
  readonly candidate_source_surface_ids: readonly SourceSurfaceId[];
  readonly selected_source_surface_id: SourceSurfaceId | null;
  readonly excluded_source_surface_ids: readonly SourceSurfaceId[];
  readonly selection_status: SourceVersionSelectionStatus;
  readonly source_publication_time?: IsoDateTime;
  readonly effective_period: SourceCompositionEffectivePeriod;
  readonly correction_time?: IsoDateTime;
  readonly observation_time?: IsoDateTime;
  readonly ingestion_time?: IsoDateTime;
  readonly evidence_ids: readonly SourceCompositionEvidenceId[];
  readonly resolver_version: string;
  readonly schema_version: typeof SOURCE_COMPOSITION_SCHEMA_VERSION;
  readonly source_version_selection_hash?: SourceVersionSelectionHash;
}

export interface SurfaceRevisionRelation {
  readonly surface_revision_relation_id: SurfaceRevisionRelationId;
  readonly source_surface_id: SourceSurfaceId;
  readonly target_surface_ids: readonly SourceSurfaceId[];
  readonly relation_kind:
    | "ORIGINAL"
    | "CORRECTION"
    | "SUPPLEMENT"
    | "REPLACEMENT"
    | "SUPERSEDES"
    | "CANCELLED"
    | "REINSTATED";
  readonly relation_status: "RESOLVED" | "UNRESOLVED";
  readonly target_scope: string;
  readonly requirement_scope: string;
  readonly effective_period: SourceCompositionEffectivePeriod;
  readonly authority_assertion_ids: readonly AuthorityAssertionId[];
  readonly evidence_ids: readonly SourceCompositionEvidenceId[];
  readonly resolver_version: string;
  readonly schema_version: typeof SOURCE_COMPOSITION_SCHEMA_VERSION;
  readonly affects_required_coverage: boolean;
  readonly surface_revision_relation_hash?: SurfaceRevisionRelationHash;
}

export type SourcePrecedenceDecisionStatus =
  | "NOT_APPLICABLE"
  | "RESOLVED"
  | "NO_DECISION"
  | "CONFLICT"
  | "UNRESOLVED";

export interface SourcePrecedenceDecision {
  readonly precedence_decision_id: SourcePrecedenceDecisionId;
  readonly selected_source_surface_ids: readonly SourceSurfaceId[];
  readonly excluded_source_surface_ids: readonly SourceSurfaceId[];
  readonly applicable_scope: string;
  readonly effective_period: SourceCompositionEffectivePeriod;
  readonly composition_as_of: IsoDateTime;
  readonly authority_assertion_ids: readonly AuthorityAssertionId[];
  readonly precedence_rule: string;
  readonly evidence_ids: readonly SourceCompositionEvidenceId[];
  readonly decision_status: SourcePrecedenceDecisionStatus;
  readonly resolver_version: string;
  readonly schema_version: typeof SOURCE_COMPOSITION_SCHEMA_VERSION;
  readonly source_precedence_decision_hash?: SourcePrecedenceDecisionHash;
}

export interface SourceConflict {
  readonly source_conflict_id: SourceConflictId;
  readonly competing_source_surface_ids: readonly SourceSurfaceId[];
  readonly target_scope: string;
  readonly requirement_scope: string;
  readonly competing_observation_ids: readonly string[];
  readonly authority_assertion_ids: readonly AuthorityAssertionId[];
  readonly effective_period: SourceCompositionEffectivePeriod;
  readonly evidence_ids: readonly SourceCompositionEvidenceId[];
  readonly status:
    | "DETECTED"
    | "REVIEW_REQUIRED"
    | "RESOLVED_BY_EVIDENCED_OVERRIDE"
    | "RESOLVED_MANUALLY";
  readonly affects_required_coverage: boolean;
  readonly resolver_version: string;
  readonly schema_version: typeof SOURCE_COMPOSITION_SCHEMA_VERSION;
  readonly source_conflict_hash?: SourceConflictHash;
}

export interface SourceCompositionInput {
  readonly opportunity_version_id: OpportunityVersionId;
  readonly composition_as_of: IsoDateTime;
  readonly discovery_boundary: DiscoveryBoundary;
  readonly inventory: SourcePackageInventory;
  readonly evidence_registry: readonly SourceCompositionEvidence[];
  readonly source_surfaces: readonly SourceSurface[];
  readonly source_surface_bindings: readonly SourceSurfaceBinding[];
  readonly authority_assertions: readonly AuthorityAssertion[];
  readonly source_version_selections: readonly SourceVersionSelection[];
  readonly surface_revision_relations: readonly SurfaceRevisionRelation[];
  readonly precedence_decisions: readonly SourcePrecedenceDecision[];
  readonly source_conflicts: readonly SourceConflict[];
  readonly extractor_version: string;
  readonly parser_version: string;
  readonly discovery_resolver_version: string;
  readonly composition_resolver_version: string;
  readonly schema_version: typeof SOURCE_COMPOSITION_SCHEMA_VERSION;
  readonly serialization_version: string;
}

export interface VerifiedDiscoveryBoundary extends DiscoveryBoundary {
  readonly discovery_boundary_hash: DiscoveryBoundaryHash;
}

export interface VerifiedExpectedSurfaceManifestEntry extends ExpectedSurfaceManifestEntry {
  readonly expected_surface_manifest_entry_hash: ExpectedSurfaceManifestEntryHash;
}

export interface VerifiedSourcePackageInventory extends SourcePackageInventory {
  readonly source_package_inventory_hash: SourcePackageInventoryHash;
  readonly expected_surface_entries: readonly VerifiedExpectedSurfaceManifestEntry[];
}

export type VerifiedSourceSurfaceBinding = SourceSurfaceBinding & {
  readonly binding_hash: SourceSurfaceBindingHash;
};

export interface VerifiedAuthorityAssertion extends AuthorityAssertion {
  readonly authority_assertion_hash: AuthorityAssertionHash;
}

export interface VerifiedSourceVersionSelection extends SourceVersionSelection {
  readonly source_version_selection_hash: SourceVersionSelectionHash;
}

export interface VerifiedSurfaceRevisionRelation extends SurfaceRevisionRelation {
  readonly surface_revision_relation_hash: SurfaceRevisionRelationHash;
}

export interface VerifiedSourcePrecedenceDecision extends SourcePrecedenceDecision {
  readonly source_precedence_decision_hash: SourcePrecedenceDecisionHash;
}

export interface VerifiedSourceConflict extends SourceConflict {
  readonly source_conflict_hash: SourceConflictHash;
}

export interface SourceCompositionResult extends SourceCompositionInput {
  readonly discovery_boundary: VerifiedDiscoveryBoundary;
  readonly inventory: VerifiedSourcePackageInventory;
  readonly source_surface_bindings: readonly VerifiedSourceSurfaceBinding[];
  readonly authority_assertions: readonly VerifiedAuthorityAssertion[];
  readonly source_version_selections: readonly VerifiedSourceVersionSelection[];
  readonly surface_revision_relations: readonly VerifiedSurfaceRevisionRelation[];
  readonly precedence_decisions: readonly VerifiedSourcePrecedenceDecision[];
  readonly source_conflicts: readonly VerifiedSourceConflict[];
  readonly source_composition_id: SourceCompositionResultId;
  readonly status: SourceCompositionStatus;
  readonly composition_hash: SourceCompositionHash;
  readonly composition_manifest_hash: SourceCompositionManifestHash;
}

export interface LegacyRequirementSetCompositionClassification {
  readonly requirement_set_id: RequirementSetId;
  readonly readability: "READABLE";
  readonly composition_state: "LEGACY_UNCOMPOSED";
}

export class SourceCompositionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceCompositionValidationError";
  }
}

export function discoveryBoundaryHash(
  boundary: DiscoveryBoundary
): DiscoveryBoundaryHash {
  return canonicalObjectHash(boundary, "discovery_boundary_hash") as DiscoveryBoundaryHash;
}

export function sourceSurfaceBindingHash(
  binding: SourceSurfaceBinding
): SourceSurfaceBindingHash {
  return canonicalObjectHash(binding, "binding_hash") as SourceSurfaceBindingHash;
}

export function authorityAssertionHash(
  assertion: AuthorityAssertion
): AuthorityAssertionHash {
  return canonicalObjectHash(assertion, "authority_assertion_hash") as AuthorityAssertionHash;
}

export function expectedSurfaceManifestEntryHash(
  entry: ExpectedSurfaceManifestEntry
): ExpectedSurfaceManifestEntryHash {
  return canonicalObjectHash(
    entry,
    "expected_surface_manifest_entry_hash"
  ) as ExpectedSurfaceManifestEntryHash;
}

export function sourcePackageInventoryHash(
  inventory: SourcePackageInventory
): SourcePackageInventoryHash {
  return canonicalObjectHash(
    inventory,
    "source_package_inventory_hash"
  ) as SourcePackageInventoryHash;
}

export function sourceVersionSelectionHash(
  selection: SourceVersionSelection
): SourceVersionSelectionHash {
  return canonicalObjectHash(
    selection,
    "source_version_selection_hash"
  ) as SourceVersionSelectionHash;
}

export function surfaceRevisionRelationHash(
  relation: SurfaceRevisionRelation
): SurfaceRevisionRelationHash {
  return canonicalObjectHash(
    relation,
    "surface_revision_relation_hash"
  ) as SurfaceRevisionRelationHash;
}

export function sourcePrecedenceDecisionHash(
  decision: SourcePrecedenceDecision
): SourcePrecedenceDecisionHash {
  return canonicalObjectHash(
    decision,
    "source_precedence_decision_hash"
  ) as SourcePrecedenceDecisionHash;
}

export function sourceConflictHash(conflict: SourceConflict): SourceConflictHash {
  return canonicalObjectHash(conflict, "source_conflict_hash") as SourceConflictHash;
}

export function assertSourceCompositionNestedHashIntegrity(
  result: SourceCompositionResult
) {
  assertNestedHash(
    result.discovery_boundary.discovery_boundary_hash,
    discoveryBoundaryHash(result.discovery_boundary),
    "DiscoveryBoundary"
  );
  assertNestedHash(
    result.inventory.source_package_inventory_hash,
    sourcePackageInventoryHash(result.inventory),
    "SourcePackageInventory"
  );
  for (const entry of result.inventory.expected_surface_entries) {
    assertNestedHash(
      entry.expected_surface_manifest_entry_hash,
      expectedSurfaceManifestEntryHash(entry),
      "ExpectedSurfaceManifestEntry"
    );
  }
  for (const binding of result.source_surface_bindings) {
    assertNestedHash(
      binding.binding_hash,
      sourceSurfaceBindingHash(binding),
      "SourceSurfaceBinding"
    );
  }
  for (const assertion of result.authority_assertions) {
    assertNestedHash(
      assertion.authority_assertion_hash,
      authorityAssertionHash(assertion),
      "AuthorityAssertion"
    );
  }
  for (const selection of result.source_version_selections) {
    assertNestedHash(
      selection.source_version_selection_hash,
      sourceVersionSelectionHash(selection),
      "SourceVersionSelection"
    );
  }
  for (const relation of result.surface_revision_relations) {
    assertNestedHash(
      relation.surface_revision_relation_hash,
      surfaceRevisionRelationHash(relation),
      "SurfaceRevisionRelation"
    );
  }
  for (const decision of result.precedence_decisions) {
    assertNestedHash(
      decision.source_precedence_decision_hash,
      sourcePrecedenceDecisionHash(decision),
      "SourcePrecedenceDecision"
    );
  }
  for (const conflict of result.source_conflicts) {
    assertNestedHash(
      conflict.source_conflict_hash,
      sourceConflictHash(conflict),
      "SourceConflict"
    );
  }
}

export function sourceCompositionManifestHash(input: SourceCompositionInput) {
  return sha256(stableSerialize({
    discovery_boundary: input.discovery_boundary,
    inventory: input.inventory
  })) as SourceCompositionManifestHash;
}

export function sourceCompositionResultHash(
  input: SourceCompositionInput,
  status: SourceCompositionStatus,
  compositionManifestHash: SourceCompositionManifestHash
) {
  return sha256(stableSerialize({
    ...input,
    composition_manifest_hash: compositionManifestHash,
    status
  })) as SourceCompositionHash;
}

export function assertSourceCompositionInputIntegrity(input: SourceCompositionInput) {
  if (!input.composition_as_of || !input.extractor_version || !input.parser_version
      || !input.discovery_resolver_version || !input.composition_resolver_version
      || !input.serialization_version) {
    throw new SourceCompositionValidationError(
      "SourceCompositionInput requires as_of and all version contracts"
    );
  }
  if (input.schema_version !== SOURCE_COMPOSITION_SCHEMA_VERSION
      || input.discovery_boundary.schema_version !== SOURCE_COMPOSITION_SCHEMA_VERSION
      || input.inventory.schema_version !== SOURCE_COMPOSITION_SCHEMA_VERSION) {
    throw new SourceCompositionValidationError("SourceComposition schema version mismatch");
  }
  if (input.discovery_boundary.opportunity_version_id !== input.opportunity_version_id
      || input.inventory.discovery_boundary_id
        !== input.discovery_boundary.discovery_boundary_id
      || input.inventory.composition_as_of !== input.composition_as_of
      || input.discovery_boundary.composition_as_of !== input.composition_as_of) {
    throw new SourceCompositionValidationError(
      "SourceComposition target, boundary, inventory, and as_of must agree"
    );
  }
  const evidence = keyed(input.evidence_registry, "source_composition_evidence_id");
  const surfaces = keyed(input.source_surfaces, "source_surface_id");
  const bindings = keyed(input.source_surface_bindings, "source_surface_binding_id");
  const authorities = keyed(input.authority_assertions, "authority_assertion_id");
  const selections = keyed(input.source_version_selections, "source_version_selection_id");
  keyed(input.surface_revision_relations, "surface_revision_relation_id");
  const manifestEntries = keyed(
    input.inventory.expected_surface_entries,
    "expected_surface_manifest_entry_id"
  );

  for (const surfaceId of input.inventory.discovered_source_surface_ids) {
    if (!input.inventory.expected_surface_entries.some((entry) => {
      return entry.source_surface_id === surfaceId;
    })) {
      throw new SourceCompositionValidationError(
        "SourcePackageInventory must classify every discovered SourceSurface"
      );
    }
  }

  for (const surfaceId of input.discovery_boundary.initiating_source_surface_ids) {
    requireReference(surfaceId, surfaces, "DiscoveryBoundary initiating surface");
  }
  if (!sameStringSet(
    input.inventory.discovered_source_surface_ids,
    input.source_surfaces.map((surface) => surface.source_surface_id)
  )) {
    throw new SourceCompositionValidationError(
      "SourcePackageInventory discovered surfaces must close the surface registry"
    );
  }
  for (const surfaceId of input.inventory.discovered_source_surface_ids) {
    requireReference(surfaceId, surfaces, "SourcePackageInventory discovered surface");
  }

  requireEvidence(input.discovery_boundary.evidence_ids, evidence, "DiscoveryBoundary");
  requireNonEmpty(
    input.discovery_boundary.discovery_scope,
    "DiscoveryBoundary discovery scope"
  );
  for (const item of input.evidence_registry) {
    requireEvidenceLocator(item.locator, "SourceCompositionEvidence locator");
    requireNonEmpty(item.extractor_version, "SourceCompositionEvidence extractor version");
  }
  for (const surface of input.source_surfaces) {
    requireEvidence(surface.evidence_ids, evidence, "SourceSurface");
    requireNonEmpty(surface.surface_content_hash, "SourceSurface content hash");
    requireEvidenceLocator(surface.locator, "SourceSurface locator");
    requireNonEmpty(surface.target_scope, "SourceSurface target scope");
    requireEffectivePeriod(surface.effective_period, "SourceSurface effective period");
    requireSchemaVersion(surface.schema_version, "SourceSurface");
  }
  for (const binding of input.source_surface_bindings) {
    requireReference(binding.source_surface_id, surfaces, "SourceSurfaceBinding surface");
    requireEvidence(binding.evidence_ids, evidence, "SourceSurfaceBinding");
    requireEvidenceLocator(binding.locator, "SourceSurfaceBinding locator");
    requireSchemaVersion(binding.schema_version, "SourceSurfaceBinding");
    if (binding.binding_status === "RESOLVED") {
      requireNonEmpty(binding.target_id, "Resolved SourceSurfaceBinding target");
      if (binding.target_type === "OPPORTUNITY_VERSION"
          && binding.target_id !== input.opportunity_version_id) {
        throw new SourceCompositionValidationError(
          "OpportunityVersion binding belongs to another composition target"
        );
      }
    }
    validateAttachmentBinding(binding, surfaces, input.opportunity_version_id);
  }
  for (const binding of input.source_surface_bindings) {
    validateAttachmentRowPublicationReference(binding, bindings);
  }
  for (const authority of input.authority_assertions) {
    requireReference(authority.asserted_source_surface_id, surfaces, "Authority asserted surface");
    requireReference(authority.authority_basis_source_surface_id, surfaces, "Authority basis surface");
    if (authority.authority_basis_binding_id) {
      requireReference(authority.authority_basis_binding_id, bindings, "Authority basis binding");
    }
    requireEvidence(authority.evidence_ids, evidence, "AuthorityAssertion");
    requireNonEmpty(authority.issuer, "AuthorityAssertion issuer");
    requireNonEmpty(authority.target_scope, "AuthorityAssertion target scope");
    requireEffectivePeriod(authority.effective_period, "AuthorityAssertion effective period");
    requireSchemaVersion(authority.schema_version, "AuthorityAssertion");
    if (authority.asserted_source_surface_id
        !== authority.authority_basis_source_surface_id) {
      if (!authority.authority_basis_binding_id) {
        throw new SourceCompositionValidationError(
          "Cross-surface AuthorityAssertion requires a publication binding"
        );
      }
      const basisBinding = bindings.get(authority.authority_basis_binding_id);
      if (!basisBinding || basisBinding.binding_kind !== "ATTACHMENT_PUBLICATION") {
        throw new SourceCompositionValidationError(
          "AuthorityAssertion basis binding must be an attachment publication binding"
        );
      }
      const attachmentBinding = basisBinding as AttachmentPublicationBinding;
      if (attachmentBinding.attachment_surface_id
            !== authority.asserted_source_surface_id
          || attachmentBinding.publication_source_surface_id
            !== authority.authority_basis_source_surface_id) {
        throw new SourceCompositionValidationError(
          "AuthorityAssertion basis binding does not prove its publication chain"
        );
      }
    }
  }
  for (const selection of input.source_version_selections) {
    requireEvidence(selection.evidence_ids, evidence, "SourceVersionSelection");
    for (const surfaceId of selection.candidate_source_surface_ids) {
      requireReference(surfaceId, surfaces, "SourceVersionSelection candidate");
    }
    if (selection.selected_source_surface_id) {
      requireReference(selection.selected_source_surface_id, surfaces, "SourceVersionSelection selected");
    }
    if (selection.selection_status === "RESOLVED") {
      if (!selection.selected_source_surface_id
          || !selection.candidate_source_surface_ids.includes(
            selection.selected_source_surface_id
          )
          || selection.excluded_source_surface_ids.includes(
            selection.selected_source_surface_id
          )) {
        throw new SourceCompositionValidationError(
          "Resolved SourceVersionSelection requires one eligible selected surface"
        );
      }
    } else if (selection.selected_source_surface_id) {
      throw new SourceCompositionValidationError(
        "Unresolved SourceVersionSelection must not name a selected surface"
      );
    }
    for (const surfaceId of selection.excluded_source_surface_ids) {
      requireReference(surfaceId, surfaces, "SourceVersionSelection excluded");
    }
    if (selection.candidate_source_surface_ids.some((surfaceId) => {
      return selection.excluded_source_surface_ids.includes(surfaceId);
    })) {
      throw new SourceCompositionValidationError(
        "SourceVersionSelection candidates cannot also be excluded"
      );
    }
    requireNonEmpty(selection.target_scope, "SourceVersionSelection target scope");
    if (selection.selection_status === "RESOLVED") {
      requireEffectivePeriod(
        selection.effective_period,
        "Resolved SourceVersionSelection effective period"
      );
    }
    requireSchemaVersion(selection.schema_version, "SourceVersionSelection");
  }
  for (const relation of input.surface_revision_relations) {
    requireReference(relation.source_surface_id, surfaces, "SurfaceRevisionRelation source");
    if (relation.target_surface_ids.length === 0) {
      throw new SourceCompositionValidationError(
        "SurfaceRevisionRelation requires an affected target surface"
      );
    }
    for (const surfaceId of relation.target_surface_ids) {
      requireReference(surfaceId, surfaces, "SurfaceRevisionRelation target");
    }
    for (const authorityId of relation.authority_assertion_ids) {
      requireReference(authorityId, authorities, "SurfaceRevisionRelation authority");
    }
    requireEvidence(relation.evidence_ids, evidence, "SurfaceRevisionRelation");
    requireNonEmpty(relation.target_scope, "SurfaceRevisionRelation target scope");
    requireNonEmpty(relation.requirement_scope, "SurfaceRevisionRelation requirement scope");
    requireEffectivePeriod(relation.effective_period, "SurfaceRevisionRelation effective period");
    requireSchemaVersion(relation.schema_version, "SurfaceRevisionRelation");
    if (relation.relation_status === "RESOLVED"
        && relation.authority_assertion_ids.length === 0) {
      throw new SourceCompositionValidationError(
        "Resolved SurfaceRevisionRelation requires authority evidence"
      );
    }
  }
  for (const decision of input.precedence_decisions) {
    requireEvidence(decision.evidence_ids, evidence, "SourcePrecedenceDecision");
    for (const surfaceId of decision.selected_source_surface_ids) {
      requireReference(surfaceId, surfaces, "SourcePrecedenceDecision selected");
    }
    for (const surfaceId of decision.excluded_source_surface_ids) {
      requireReference(surfaceId, surfaces, "SourcePrecedenceDecision excluded");
    }
    for (const authorityId of decision.authority_assertion_ids) {
      requireReference(authorityId, authorities, "SourcePrecedenceDecision authority");
    }
    if (decision.selected_source_surface_ids.some((surfaceId) => {
      return decision.excluded_source_surface_ids.includes(surfaceId);
    })) {
      throw new SourceCompositionValidationError(
        "SourcePrecedenceDecision surfaces cannot be both selected and excluded"
      );
    }
    requireNonEmpty(decision.applicable_scope, "SourcePrecedenceDecision scope");
    requireNonEmpty(decision.precedence_rule, "SourcePrecedenceDecision rule");
    requireEffectivePeriod(decision.effective_period, "SourcePrecedenceDecision effective period");
    if (decision.composition_as_of !== input.composition_as_of) {
      throw new SourceCompositionValidationError(
        "SourcePrecedenceDecision as_of must match SourceComposition"
      );
    }
    requireSchemaVersion(decision.schema_version, "SourcePrecedenceDecision");
  }
  for (const conflict of input.source_conflicts) {
    requireEvidence(conflict.evidence_ids, evidence, "SourceConflict");
    for (const surfaceId of conflict.competing_source_surface_ids) {
      requireReference(surfaceId, surfaces, "SourceConflict surface");
    }
    for (const authorityId of conflict.authority_assertion_ids) {
      requireReference(authorityId, authorities, "SourceConflict authority");
    }
    requireNonEmpty(conflict.target_scope, "SourceConflict target scope");
    requireNonEmpty(conflict.requirement_scope, "SourceConflict requirement scope");
    requireEffectivePeriod(conflict.effective_period, "SourceConflict effective period");
    requireSchemaVersion(conflict.schema_version, "SourceConflict");
  }
  for (const entry of input.inventory.expected_surface_entries) {
    requireEvidence(entry.evidence_ids, evidence, "ExpectedSurfaceManifestEntry");
    if (entry.source_surface_id) {
      requireReference(entry.source_surface_id, surfaces, "ExpectedSurfaceManifestEntry surface");
    }
    if (entry.authority_assertion_id) {
      requireReference(entry.authority_assertion_id, authorities, "ExpectedSurfaceManifestEntry authority");
    }
    if (entry.source_version_selection_id) {
      requireReference(entry.source_version_selection_id, selections, "ExpectedSurfaceManifestEntry selection");
    }
    for (const bindingId of entry.material_binding_ids) {
      requireReference(bindingId, bindings, "ExpectedSurfaceManifestEntry binding");
    }
    requireNonEmpty(entry.expected_surface_key, "ExpectedSurfaceManifestEntry key");
    requireNonEmpty(entry.target_scope, "ExpectedSurfaceManifestEntry target scope");
    validateManifestEntry(
      entry,
      surfaces,
      bindings,
      authorities,
      selections,
      input.opportunity_version_id
    );
  }
  for (const disposition of input.inventory.unexpected_surface_dispositions) {
    requireReference(
      disposition.expected_surface_manifest_entry_id,
      manifestEntries,
      "UnexpectedSurfaceDisposition entry"
    );
    requireEvidence(disposition.evidence_ids, evidence, "UnexpectedSurfaceDisposition");
    requireNonEmpty(disposition.resolver_version, "UnexpectedSurfaceDisposition resolver version");
    requireSchemaVersion(disposition.schema_version, "UnexpectedSurfaceDisposition");
  }
}

export function classifyLegacyRequirementSet(
  requirementSetId: RequirementSetId
): LegacyRequirementSetCompositionClassification {
  return {
    requirement_set_id: requirementSetId,
    readability: "READABLE",
    composition_state: "LEGACY_UNCOMPOSED"
  };
}

function keyed<Value extends Record<Key, string>, Key extends string>(
  values: readonly Value[],
  key: Key
) {
  const map = new Map<string, Value>();
  for (const value of values) {
    const valueKey = value[key];
    if (map.has(valueKey)) {
      throw new SourceCompositionValidationError(`Duplicate registry key: ${valueKey}`);
    }
    map.set(valueKey, value);
  }
  return map;
}

function requireReference<Value>(
  value: string,
  registry: ReadonlyMap<string, Value>,
  context: string
) {
  if (!registry.has(value)) {
    throw new SourceCompositionValidationError(`${context} is unavailable: ${value}`);
  }
}

function requireEvidence(
  evidenceIds: readonly SourceCompositionEvidenceId[],
  registry: ReadonlyMap<string, SourceCompositionEvidence>,
  context: string
) {
  if (evidenceIds.length === 0) {
    throw new SourceCompositionValidationError(`${context} requires Evidence`);
  }
  for (const evidenceId of evidenceIds) {
    requireReference(evidenceId, registry, `${context} Evidence`);
  }
}

function requireNonEmpty(value: string, context: string) {
  if (!value.trim()) {
    throw new SourceCompositionValidationError(`${context} must be non-empty`);
  }
}

function requireEvidenceLocator(locator: EvidenceLocator, context: string) {
  if (!locator.kind || !hasEvidenceLocatorDetail(locator)) {
    throw new SourceCompositionValidationError(
      `${context} requires a kind and an exact location detail`
    );
  }
  if ((locator.start_offset === undefined) !== (locator.end_offset === undefined)
      || (locator.start_offset !== undefined
        && locator.end_offset !== undefined
        && locator.end_offset < locator.start_offset)) {
    throw new SourceCompositionValidationError(`${context} has an invalid text span`);
  }
}

function hasEvidenceLocatorDetail(locator: EvidenceLocator) {
  return Boolean(
    locator.field_path
      || locator.section
      || locator.sheet
      || locator.cell_or_range
      || locator.json_path
      || locator.text_locator
      || locator.page_number !== undefined
      || locator.start_offset !== undefined
  );
}

function requireEffectivePeriod(
  effectivePeriod: SourceCompositionEffectivePeriod,
  context: string
) {
  if (!effectivePeriod.effective_from) {
    throw new SourceCompositionValidationError(`${context} requires effective_from`);
  }
  if (effectivePeriod.effective_to
      && effectivePeriod.effective_to < effectivePeriod.effective_from) {
    throw new SourceCompositionValidationError(`${context} effective period is inverted`);
  }
}

function requireSchemaVersion(schemaVersion: string, context: string) {
  if (schemaVersion !== SOURCE_COMPOSITION_SCHEMA_VERSION) {
    throw new SourceCompositionValidationError(`${context} schema version mismatch`);
  }
}

function validateAttachmentBinding(
  binding: SourceSurfaceBinding,
  surfaces: ReadonlyMap<string, SourceSurface>,
  opportunityVersionId: OpportunityVersionId
) {
  if (binding.binding_kind === "ATTACHMENT_PUBLICATION") {
    const attachmentBinding = binding as AttachmentPublicationBinding;
    if (!attachmentBinding.attachment_surface_id
        || !attachmentBinding.publication_source_surface_id
        || attachmentBinding.attachment_surface_id !== binding.source_surface_id) {
      throw new SourceCompositionValidationError(
        "AttachmentPublicationBinding must name its attachment and publication surfaces"
      );
    }
    requireReference(
      attachmentBinding.attachment_surface_id,
      surfaces,
      "AttachmentPublicationBinding attachment"
    );
    requireReference(
      attachmentBinding.publication_source_surface_id,
      surfaces,
      "AttachmentPublicationBinding publication"
    );
  }
  if (binding.binding_kind === "ATTACHMENT_ROW") {
    const rowBinding = binding as AttachmentToPositionBinding;
    if (!rowBinding.attachment_to_position_binding_id
        || !rowBinding.attachment_publication_binding_id
        || !rowBinding.attachment_surface_id
        || !rowBinding.position_version_id
        || !rowBinding.opportunity_version_id
        || !rowBinding.binding_version
        || rowBinding.attachment_surface_id !== binding.source_surface_id
        || rowBinding.opportunity_version_id !== opportunityVersionId
        || !hasRowLocator(rowBinding)) {
      throw new SourceCompositionValidationError(
        "AttachmentToPositionBinding requires an exact attachment row target and locator"
      );
    }
  }
}

function hasRowLocator(binding: AttachmentToPositionBinding) {
  return Boolean(
    binding.row_locator
      || binding.cell_locator
      || binding.page_locator
      || binding.span_locator
  );
}

function validateAttachmentRowPublicationReference(
  binding: SourceSurfaceBinding,
  bindings: ReadonlyMap<string, SourceSurfaceBinding>
) {
  if (binding.binding_kind !== "ATTACHMENT_ROW") return;
  const rowBinding = binding as AttachmentToPositionBinding;
  const publicationBindings = [...bindings.values()].filter((candidate) => {
    return candidate.binding_kind === "ATTACHMENT_PUBLICATION"
      && (candidate as AttachmentPublicationBinding)
        .attachment_publication_binding_id
        === rowBinding.attachment_publication_binding_id;
  });
  if (publicationBindings.length !== 1) {
    throw new SourceCompositionValidationError(
      "AttachmentToPositionBinding requires its attachment publication binding"
    );
  }
  const attachmentPublication = publicationBindings[0] as AttachmentPublicationBinding;
  if (attachmentPublication.attachment_surface_id !== rowBinding.attachment_surface_id) {
    throw new SourceCompositionValidationError(
      "AttachmentToPositionBinding must use the published attachment surface"
    );
  }
}

function validateManifestEntry(
  entry: ExpectedSurfaceManifestEntry,
  surfaces: ReadonlyMap<string, SourceSurface>,
  bindings: ReadonlyMap<string, SourceSurfaceBinding>,
  authorities: ReadonlyMap<string, AuthorityAssertion>,
  selections: ReadonlyMap<string, SourceVersionSelection>,
  opportunityVersionId: OpportunityVersionId
) {
  if (entry.expectedness === "REQUIRED" && entry.coverage_status === "COVERED"
      && !entry.source_surface_id) {
    throw new SourceCompositionValidationError(
      "Covered required ExpectedSurfaceManifestEntry requires a surface"
    );
  }
  if (entry.expectedness === "REQUIRED" && entry.coverage_status === "MISSING"
      && entry.source_surface_id) {
    throw new SourceCompositionValidationError(
      "Missing required ExpectedSurfaceManifestEntry cannot name a surface"
    );
  }
  if (entry.authority_assertion_id) {
    const authority = authorities.get(entry.authority_assertion_id);
    if (!authority || (entry.source_surface_id
        && authority.asserted_source_surface_id !== entry.source_surface_id)
        || authority.authority_state !== entry.authority_status
        || authority.target_scope !== entry.target_scope) {
      throw new SourceCompositionValidationError(
        "ExpectedSurfaceManifestEntry authority assertion does not match its surface"
      );
    }
  } else if (entry.authority_status !== "UNRESOLVED") {
    throw new SourceCompositionValidationError(
      "Resolved ExpectedSurfaceManifestEntry authority requires an assertion"
    );
  }
  if (entry.source_version_selection_id) {
    const selection = selections.get(entry.source_version_selection_id);
    if (!selection || selection.selection_status !== entry.version_selection_status
        || selection.target_scope !== entry.target_scope
        || (entry.source_surface_id
          && selection.selection_status === "RESOLVED"
          && selection.selected_source_surface_id !== entry.source_surface_id)) {
      throw new SourceCompositionValidationError(
        "ExpectedSurfaceManifestEntry version selection does not match its surface"
      );
    }
  } else if (entry.version_selection_status !== "UNRESOLVED") {
    throw new SourceCompositionValidationError(
      "Resolved ExpectedSurfaceManifestEntry version selection requires a selection"
    );
  }
  if (entry.binding_status === "RESOLVED" && entry.material_binding_ids.length === 0) {
    throw new SourceCompositionValidationError(
      "Resolved ExpectedSurfaceManifestEntry binding requires material bindings"
    );
  }
  let hasExactOpportunityBinding = false;
  for (const bindingId of entry.material_binding_ids) {
    const binding = bindings.get(bindingId);
    if (!binding || binding.binding_status !== entry.binding_status
        || (entry.source_surface_id
          && binding.source_surface_id !== entry.source_surface_id)
        || (binding.target_type === "OPPORTUNITY_VERSION"
          && binding.target_id !== opportunityVersionId)) {
      throw new SourceCompositionValidationError(
        "ExpectedSurfaceManifestEntry binding does not match its target surface"
      );
    }
    if (binding.target_type === "OPPORTUNITY_VERSION"
        && binding.target_id === opportunityVersionId) {
      hasExactOpportunityBinding = true;
    }
  }
  if (entry.expectedness === "REQUIRED"
      && entry.coverage_status === "COVERED"
      && entry.binding_status === "RESOLVED"
      && !hasExactOpportunityBinding) {
    throw new SourceCompositionValidationError(
      "Material ExpectedSurfaceManifestEntry requires an exact OpportunityVersion binding"
    );
  }
  if (entry.source_surface_id && !surfaces.has(entry.source_surface_id)) {
    throw new SourceCompositionValidationError(
      "ExpectedSurfaceManifestEntry source surface is unavailable"
    );
  }
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[]
) {
  if (left.length !== right.length) return false;
  return new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((value) => right.includes(value));
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalObjectHash(value: object, hashField: string) {
  const hashable = { ...(value as Record<string, unknown>) };
  delete hashable[hashField];
  return sha256(stableSerialize(hashable));
}

function assertNestedHash(
  actual: string | undefined,
  expected: string,
  context: string
) {
  if (!actual || !/^sha256:[a-f0-9]{64}$/.test(actual) || actual !== expected) {
    throw new SourceCompositionValidationError(
      `${context} canonical hash is missing, invalid, or does not match content`
    );
  }
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => {
    return `${JSON.stringify(key)}:${stableSerialize(record[key])}`;
  }).join(",")}}`;
}
