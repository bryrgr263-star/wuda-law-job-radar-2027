import type {
  ExpectedSurfaceManifestEntry,
  SourceCompositionInput,
  SourceCompositionResult,
  SourceCompositionStatus
} from "../domain";
import {
  assertSourceCompositionNestedHashIntegrity,
  SourceCompositionValidationError,
  assertSourceCompositionInputIntegrity,
  authorityAssertionHash,
  discoveryBoundaryHash,
  expectedSurfaceManifestEntryHash,
  sourceConflictHash,
  sourceCompositionManifestHash,
  sourceCompositionResultHash,
  sourcePackageInventoryHash,
  sourcePrecedenceDecisionHash,
  sourceSurfaceBindingHash,
  sourceVersionSelectionHash,
  surfaceRevisionRelationHash
} from "../domain";

export function buildSourceCompositionResult(
  input: SourceCompositionInput
): SourceCompositionResult {
  assertSourceCompositionInputIntegrity(input);
  const nestedHashedInput = withNestedCanonicalHashes(input);
  const status = determineSourceCompositionStatus(nestedHashedInput);
  const compositionManifestHash = sourceCompositionManifestHash(nestedHashedInput);
  const compositionHash = sourceCompositionResultHash(
    nestedHashedInput,
    status,
    compositionManifestHash
  );
  return {
    ...nestedHashedInput,
    source_composition_id: `source-composition:${compositionHash}` as SourceCompositionResult["source_composition_id"],
    status,
    composition_hash: compositionHash,
    composition_manifest_hash: compositionManifestHash
  } as SourceCompositionResult;
}

export function assertSourceCompositionResultIntegrity(
  result: SourceCompositionResult
): SourceCompositionResult {
  assertSourceCompositionNestedHashIntegrity(result);
  const {
    source_composition_id: sourceCompositionId,
    status,
    composition_hash: compositionHash,
    composition_manifest_hash: compositionManifestHash,
    ...input
  } = result;
  const rebuilt = buildSourceCompositionResult(input);
  if (sourceCompositionId !== rebuilt.source_composition_id
      || status !== rebuilt.status
      || compositionHash !== rebuilt.composition_hash
      || compositionManifestHash !== rebuilt.composition_manifest_hash) {
    throw new SourceCompositionValidationError(
      "SourceCompositionResult content changed after hashing"
    );
  }
  return result;
}

function withNestedCanonicalHashes(
  input: SourceCompositionInput
): SourceCompositionInput {
  const expectedSurfaceEntries = input.inventory.expected_surface_entries.map((entry) => {
    return {
      ...entry,
      expected_surface_manifest_entry_hash: expectedSurfaceManifestEntryHash(entry)
    };
  });
  const inventoryWithEntryHashes = {
    ...input.inventory,
    expected_surface_entries: expectedSurfaceEntries
  };
  return {
    ...input,
    discovery_boundary: {
      ...input.discovery_boundary,
      discovery_boundary_hash: discoveryBoundaryHash(input.discovery_boundary)
    },
    inventory: {
      ...inventoryWithEntryHashes,
      source_package_inventory_hash: sourcePackageInventoryHash(inventoryWithEntryHashes)
    },
    source_surface_bindings: input.source_surface_bindings.map((binding) => {
      return { ...binding, binding_hash: sourceSurfaceBindingHash(binding) };
    }),
    authority_assertions: input.authority_assertions.map((assertion) => {
      return {
        ...assertion,
        authority_assertion_hash: authorityAssertionHash(assertion)
      };
    }),
    source_version_selections: input.source_version_selections.map((selection) => {
      return {
        ...selection,
        source_version_selection_hash: sourceVersionSelectionHash(selection)
      };
    }),
    surface_revision_relations: input.surface_revision_relations.map((relation) => {
      return {
        ...relation,
        surface_revision_relation_hash: surfaceRevisionRelationHash(relation)
      };
    }),
    precedence_decisions: input.precedence_decisions.map((decision) => {
      return {
        ...decision,
        source_precedence_decision_hash: sourcePrecedenceDecisionHash(decision)
      };
    }),
    source_conflicts: input.source_conflicts.map((conflict) => {
      return {
        ...conflict,
        source_conflict_hash: sourceConflictHash(conflict)
      };
    })
  };
}

function determineSourceCompositionStatus(input: SourceCompositionInput): SourceCompositionStatus {
  if (input.source_conflicts.some((conflict) => conflict.affects_required_coverage
      && !["RESOLVED_BY_EVIDENCED_OVERRIDE", "RESOLVED_MANUALLY"].includes(conflict.status))) {
    return "CONFLICT";
  }
  if (input.inventory.inventory_completeness_status === "OPEN_MISSING_REQUIRED"
      || input.inventory.expected_surface_entries.some((entry) => {
        return entry.expectedness === "REQUIRED" && entry.coverage_status === "MISSING";
      })) {
    return "INCOMPLETE";
  }
  if (input.discovery_boundary.boundary_kind === "UNRESOLVED"
      || input.inventory.inventory_completeness_status !== "CLOSED") {
    return "UNRESOLVED";
  }
  const materialEntries = input.inventory.expected_surface_entries.filter(isMaterialEntry);
  const surfacesById = new Map(input.source_surfaces.map((surface) => {
    return [surface.source_surface_id, surface] as const;
  }));
  for (const entry of materialEntries) {
    const surface = entry.source_surface_id
      ? surfacesById.get(entry.source_surface_id)
      : undefined;
    if (entry.coverage_status !== "COVERED"
        || entry.resolution_status !== "RESOLVED"
        || !isResolvedMaterialAuthority(entry.authority_status)
        || entry.binding_status !== "RESOLVED"
        || entry.version_selection_status !== "RESOLVED"
        || !surface
        || surface.surface_status !== "PARSED"
        || surface.surface_kind === "THIRD_PARTY_RECORD") {
      return "REVIEW_REQUIRED";
    }
  }
  if (input.inventory.expected_surface_entries.some((entry) => {
    return isUnresolvedRequirementSurface(
      entry,
      input.inventory.unexpected_surface_dispositions
    );
  })) {
    return "REVIEW_REQUIRED";
  }
  if (input.surface_revision_relations.some((relation) => {
    return relation.affects_required_coverage
      && relation.relation_status !== "RESOLVED";
  })) {
    return "REVIEW_REQUIRED";
  }
  if (input.precedence_decisions.some((decision) => {
    return !["RESOLVED", "NOT_APPLICABLE"].includes(decision.decision_status);
  })) {
    return "REVIEW_REQUIRED";
  }
  return "COMPLETE";
}

function isMaterialEntry(entry: ExpectedSurfaceManifestEntry) {
  return entry.expectedness === "REQUIRED";
}

function isResolvedMaterialAuthority(
  authorityStatus: ExpectedSurfaceManifestEntry["authority_status"]
) {
  return authorityStatus === "OFFICIAL_AUTHORITATIVE"
    || authorityStatus === "AUTHORIZED_SCOPED";
}

function isUnresolvedRequirementSurface(
  entry: ExpectedSurfaceManifestEntry,
  dispositions: SourceCompositionInput["inventory"]["unexpected_surface_dispositions"]
) {
  if (entry.requirement_level !== "REQUIREMENT_BEARING") {
    return false;
  }
  if (entry.expectedness === "OPTIONAL"
      && entry.coverage_status !== "UNRESOLVED"
      && entry.resolution_status !== "UNRESOLVED") {
    return false;
  }
  if (!["OPTIONAL", "UNEXPECTED"].includes(entry.expectedness)) return false;
  return !dispositions.some((disposition) => {
    return disposition.expected_surface_manifest_entry_id
      === entry.expected_surface_manifest_entry_id
      && disposition.disposition === "EVIDENCED_OUT_OF_SCOPE";
  });
}
