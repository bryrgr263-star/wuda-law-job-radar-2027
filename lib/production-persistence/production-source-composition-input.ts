import type {
  BrandedString, EvidenceLocator, OpportunityVersionId, SourceCompositionInput,
  TrustedSourceOccurrenceArtifact
} from "../ingestion";
import { SOURCE_COMPOSITION_SCHEMA_VERSION } from "../ingestion";
import { canonicalHash } from "../ingestion/normalization/canonical-artifact-registry";
import type { ZeroCostProductionTrustedRunContext } from "./zero-cost-production-composition-root";

const preparationVersion = "production-source-composition-preparation/1.0.0";

export function prepareProductionSourceCompositionInput(
  context: ZeroCostProductionTrustedRunContext,
  opportunityVersionId: OpportunityVersionId
): SourceCompositionInput {
  const graph = context.resolvers.position_bound_opportunities.resolve(opportunityVersionId);
  if (!graph) throw new Error("EVIDENCE_BLOCKED: SourceComposition requires a trusted PBOV");
  const positionSources = graph.opportunity_version.source_occurrence_version_ids.map(id => {
    const source = context.resolvers.source_occurrences.resolve(id);
    if (!source || source.source_role !== "POSITION_BEARING") {
      throw new Error("EVIDENCE_BLOCKED: SourceComposition position source is unavailable");
    }
    return source;
  });
  if (!positionSources.length) throw new Error("EVIDENCE_BLOCKED: SourceComposition position provenance is empty");
  const sourceIds = [...new Set(context.available_artifact_references
    .filter(reference => reference.artifact_kind === "SOURCE_OCCURRENCE_VERSION")
    .map(reference => reference.artifact_id))].sort();
  const packages = sourceIds.flatMap(id => {
    const source = context.resolvers.source_occurrences.resolve(id as never);
    return source?.source_role === "PACKAGE" && positionSources.some(positionSource =>
      source.endpoint.source_definition_id === positionSource.endpoint.source_definition_id
      && source.endpoint.recruitment_endpoint_id === positionSource.endpoint.recruitment_endpoint_id)
      ? [source] : [];
  });
  const sources = [...positionSources, ...packages].sort((left, right) =>
    left.version.source_occurrence_version_id < right.version.source_occurrence_version_id ? -1
      : left.version.source_occurrence_version_id > right.version.source_occurrence_version_id ? 1 : 0);
  const compositionAsOf = sources.reduce((latest, source) =>
    Date.parse(source.snapshot.observed_at) > Date.parse(latest) ? source.snapshot.observed_at : latest,
  positionSources[0]!.snapshot.observed_at);
  const identity = canonicalHash({ opportunity_version_id: opportunityVersionId,
    sources: sources.map(source => [source.version.source_occurrence_version_id,
      source.snapshot.snapshot_id, source.extracted_record.extracted_record_id]), preparationVersion });
  const id = <Name extends string>(kind: Name, sourceKey = identity): BrandedString<Name> =>
    `${kind}:${canonicalHash({ identity, sourceKey, kind })}` as BrandedString<Name>;
  const entries = sources.map(source => {
    const sourceKey = source.version.source_occurrence_version_id;
    const isPosition = source.source_role === "POSITION_BEARING";
    const evidenceId = id("SourceCompositionEvidenceId", sourceKey);
    const surfaceId = id("SourceSurfaceId", sourceKey);
    const bindingId = id("SourceSurfaceBindingId", sourceKey);
    const locator = sourceLocator(source);
    const extractorVersion = source.version.materialization.extractor_version;
    const bindingContext = { source_occurrence_version_id: sourceKey,
      snapshot_id: source.snapshot.snapshot_id, extracted_record_id: source.extracted_record.extracted_record_id,
      observed_at: source.snapshot.observed_at, resolver_version: preparationVersion };
    const targetScope = isPosition ? opportunityVersionId : sourceKey;
    return {
      evidence: { source_composition_evidence_id: evidenceId, ...bindingContext, locator,
        extractor_version: extractorVersion },
      surface: { source_surface_id: surfaceId, surface_kind: "OTHER_REQUIREMENT_SURFACE" as const,
        ...bindingContext, locator, surface_content_hash: canonicalHash(source.extracted_record),
        effective_period: { effective_from: source.snapshot.observed_at },
        surface_status: "PARSED" as const, composition_role: isPosition ? "PRIMARY" as const : "REFERENCE" as const,
        target_scope: targetScope, evidence_ids: [evidenceId], extractor_version: extractorVersion,
        parser_version: preparationVersion, schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION },
      binding: { source_surface_binding_id: bindingId, source_surface_id: surfaceId,
        target_type: isPosition ? "OPPORTUNITY_VERSION" as const : "SYSTEM_RECORD" as const,
        target_id: targetScope, binding_kind: "SURFACE_DECLARATION" as const, binding_status: "RESOLVED" as const,
        evidence_ids: [evidenceId], created_context: bindingContext, observed_context: bindingContext, locator,
        schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION },
      manifest: { expected_surface_manifest_entry_id: id("ExpectedSurfaceManifestEntryId", sourceKey),
        expected_surface_key: sourceKey, source_surface_id: surfaceId,
        expectedness: isPosition ? "REQUIRED" as const : "REFERENCE_ONLY" as const,
        requirement_level: isPosition ? (source.extracted_record.raw_requirement_text
          ? "REQUIREMENT_BEARING" as const : "UNRESOLVED" as const) : "NON_REQUIREMENT_REFERENCE" as const,
        authority_status: "UNRESOLVED" as const, binding_status: "RESOLVED" as const,
        material_binding_ids: [bindingId], version_selection_status: "UNRESOLVED" as const,
        coverage_status: "COVERED" as const, resolution_status: "UNRESOLVED" as const,
        target_scope: targetScope, evidence_ids: [evidenceId] }
    };
  });
  const boundaryId = id("DiscoveryBoundaryId");
  const evidenceIds = entries.map(entry => entry.evidence.source_composition_evidence_id);
  const extractorVersion = positionSources[0]!.version.materialization.extractor_version;
  return {
    opportunity_version_id: opportunityVersionId, composition_as_of: compositionAsOf,
    discovery_boundary: { discovery_boundary_id: boundaryId, opportunity_version_id: opportunityVersionId,
      boundary_kind: "POSITION_PACKAGE", initiating_source_surface_ids: entries
        .filter(entry => entry.manifest.expectedness === "REQUIRED").map(entry => entry.surface.source_surface_id),
      source_metadata_references: sources.map(source => source.version.source_occurrence_version_id),
      discovery_scope: opportunityVersionId, admissible_relation_kinds: ["SURFACE_DECLARATION"], evidence_ids: evidenceIds,
      composition_as_of: compositionAsOf, observed_at: compositionAsOf, extractor_version: extractorVersion,
      discovery_resolver_version: preparationVersion, schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION },
    inventory: { source_package_inventory_id: id("SourcePackageInventoryId"), discovery_boundary_id: boundaryId,
      composition_as_of: compositionAsOf, discovered_source_surface_ids: entries.map(entry => entry.surface.source_surface_id),
      expected_surface_entries: entries.map(entry => entry.manifest), inventory_completeness_status: "OPEN_UNRESOLVED",
      unexpected_surface_dispositions: [], discovery_resolver_version: preparationVersion,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION },
    evidence_registry: entries.map(entry => entry.evidence), source_surfaces: entries.map(entry => entry.surface),
    source_surface_bindings: entries.map(entry => entry.binding), authority_assertions: [], source_version_selections: [],
    surface_revision_relations: [], precedence_decisions: [], source_conflicts: [], extractor_version: extractorVersion,
    parser_version: preparationVersion, discovery_resolver_version: preparationVersion,
    composition_resolver_version: preparationVersion, schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
    serialization_version: "canonical-json/1.0.0"
  };
}

function sourceLocator(source: TrustedSourceOccurrenceArtifact): EvidenceLocator {
  const locator = source.extracted_record.source_record_locator;
  const fieldPath = source.source_role === "POSITION_BEARING" ? "raw_requirement_text" : "source_record_locator";
  switch (locator.kind) {
    case "HTML": return { kind: "HTML", text_locator: locator.selector, field_path: fieldPath,
      ...(locator.path ? { section: locator.path } : {}) };
    case "JSON": return { kind: "JSON", json_path: locator.json_path, field_path: fieldPath };
    case "DOCUMENT": return { ...locator, field_path: fieldPath };
    case "OTHER": return { kind: "JSON", text_locator: locator.locator, field_path: "source_record_locator" };
  }
}
