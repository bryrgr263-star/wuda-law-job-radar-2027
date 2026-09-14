import {
  OpportunityContractValidationError,
  type OpportunityVersionId,
  type Position,
  type PositionBoundOpportunityVersion,
  type PositionVersion,
  type SourceCompositionEvidence,
  type SourceCompositionInput,
  type SourceCompositionResult,
  type SourceCompositionResultId,
  type SourceOccurrenceVersionId,
  SourceCompositionValidationError,
  type SourceSurface,
  type SourceSurfaceBinding,
} from "../domain";
import {
  validatePosition,
  validatePositionVersion
} from "../domain/recruitment-context";
import {
  assertPositionBoundOpportunityVersionIntegrity,
  assertTrustedPositionBoundOpportunityResolver,
  type PositionIdentityResolutionInput,
  type TrustedPositionBoundOpportunityResolver,
  resolvePositionIdentity,
  validateSourceOccurrenceVersionBinding
} from "../normalization";
import {
  assertTrustedSourceOccurrenceVersionResolver,
  type TrustedSourceOccurrenceVersionResolver
} from "../normalization/trusted-source-occurrence-registry";
import {
  CanonicalArtifactRegistryError,
  createCanonicalArtifactRegistryAuthority
} from "../normalization/canonical-artifact-registry";
import {
  assertSourceCompositionResultIntegrity,
  buildSourceCompositionResult
} from "../requirements";

export interface PositionBoundSourceCompositionInput {
  readonly opportunity_version_id: OpportunityVersionId;
  readonly composition_input: SourceCompositionInput;
}

export interface TrustedSourceCompositionResolver {
  resolve(sourceCompositionId: SourceCompositionResultId): SourceCompositionResult | null;
}

const trustedSourceCompositionResolvers = new WeakSet<object>();

export class PositionBoundSourceCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PositionBoundSourceCompositionError";
  }
}

export class InMemoryPositionBoundSourceCompositionTracker
implements TrustedSourceCompositionResolver {
  readonly #pbovResolver: TrustedPositionBoundOpportunityResolver;
  readonly #sourceResolver: TrustedSourceOccurrenceVersionResolver | null;
  readonly #registry = createCanonicalArtifactRegistryAuthority<
    SourceCompositionResultId,
    SourceCompositionResult
  >((artifact) => artifact.source_composition_id);

  constructor(
    pbovResolver: TrustedPositionBoundOpportunityResolver,
    sourceResolver: TrustedSourceOccurrenceVersionResolver | null = null
  ) {
    this.#pbovResolver = assertTrustedPositionBoundOpportunityResolver(pbovResolver);
    this.#sourceResolver = sourceResolver
      ? assertTrustedSourceOccurrenceVersionResolver(sourceResolver)
      : null;
    trustedSourceCompositionResolvers.add(this);
  }

  process(input: PositionBoundSourceCompositionInput): SourceCompositionResult {
    const graph = this.#pbovResolver.resolve(input.opportunity_version_id);
    const sources = this.#pbovResolver.resolveSources(input.opportunity_version_id);
    if (!graph || !sources) {
      throw new PositionBoundSourceCompositionError(
        "Source Composition requires a trusted PBOV and its sealed source provenance"
      );
    }
    const result = materializeTrustedPositionBoundSourceComposition(
      graph.position,
      graph.position_version,
      graph.canonical_opportunity,
      graph.opportunity_version,
      sources,
      input.composition_input,
      this.#sourceResolver
    );
    try {
      return this.#registry.writer.seal(
        result.source_composition_id,
        result
      ).artifact;
    } catch (error) {
      if (error instanceof CanonicalArtifactRegistryError
          && error.code === "IDENTITY_COLLISION") {
        throw new PositionBoundSourceCompositionError(
          `SourceComposition identity collision: ${result.source_composition_id}`
        );
      }
      throw error;
    }
  }

  resolve(sourceCompositionId: SourceCompositionResultId) {
    const result = this.#registry.resolver.resolve(sourceCompositionId);
    return result ? assertSourceCompositionResultIntegrity(result) : null;
  }
}

export function assertTrustedSourceCompositionResolver(
  resolver: TrustedSourceCompositionResolver
) {
  if (!trustedSourceCompositionResolvers.has(resolver as object)
      || Object.getPrototypeOf(resolver)
        !== InMemoryPositionBoundSourceCompositionTracker.prototype) {
    throw new PositionBoundSourceCompositionError(
      "Trusted SourceComposition resolver must be composition-root controlled"
    );
  }
  return resolver;
}

function materializeTrustedPositionBoundSourceComposition(
  suppliedPosition: Position,
  suppliedPositionVersion: PositionVersion,
  canonicalOpportunity: import("../domain").CanonicalOpportunity,
  suppliedOpportunityVersion: PositionBoundOpportunityVersion,
  suppliedSources: readonly PositionIdentityResolutionInput[],
  compositionInput: SourceCompositionInput,
  sourceResolver: TrustedSourceOccurrenceVersionResolver | null
): SourceCompositionResult {
  const position = validatePosition(suppliedPosition);
  const positionVersion = validatePositionVersion(suppliedPositionVersion, position);
  const opportunityVersion = assertPositionBoundOpportunityVersionIntegrity(
    suppliedOpportunityVersion,
    position,
    positionVersion,
    canonicalOpportunity
  );
  const positionSources = validateSources(suppliedSources, position);
  const sources = resolveCompositionSources(
    compositionInput,
    positionSources,
    sourceResolver
  );
  validateOpportunitySourceClosure(opportunityVersion, positionVersion, sources);

  if (compositionInput.opportunity_version_id
      !== opportunityVersion.opportunity_version_id) {
    throw new PositionBoundSourceCompositionError(
      "SourceCompositionInput must target the supplied Position-bound OpportunityVersion"
    );
  }

  requireSourceCompositionInputShape(compositionInput);
  validateCompositionProvenance(
    compositionInput,
    positionVersion,
    opportunityVersion,
    sources
  );
  return assertSourceCompositionResultIntegrity(
    buildSourceCompositionResult(compositionInput)
  );
}

function validateSources(
  sources: readonly PositionIdentityResolutionInput[],
  position: Position
) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new PositionBoundSourceCompositionError(
      "Position-bound Source Composition requires validated SOV input"
    );
  }
  const byVersionId = new Map<
    string,
    PositionIdentityResolutionInput
  >();
  for (const source of flattenSources(sources)) {
    validateSourceOccurrenceVersionBinding(source);
  }
  for (const source of sources) {
    const existing = byVersionId.get(
      source.version.source_occurrence_version_id
    );
    if (existing
        && existing.version.semantic_hash !== source.version.semantic_hash) {
      throw new PositionBoundSourceCompositionError(
        "One SourceOccurrenceVersion ID cannot carry multiple semantic hashes"
      );
    }
    byVersionId.set(source.version.source_occurrence_version_id, source);
  }
  for (const source of sources) {
    const resolution = resolvePositionIdentity(source);
    if (resolution.status !== "RESOLVED"
        || resolution.position.position_id !== position.position_id
        || resolution.position.identity_hash !== position.identity_hash) {
      throw new PositionBoundSourceCompositionError(
        "SourceOccurrenceVersion Position identity does not match the supplied Position"
      );
    }
  }
  return byVersionId;
}

function resolveCompositionSources(
  composition: SourceCompositionInput,
  positionSources: ReadonlyMap<string, PositionIdentityResolutionInput>,
  sourceResolver: TrustedSourceOccurrenceVersionResolver | null
) {
  const resolved = new Map(positionSources);
  for (const sourceVersionId of compositionSourceVersionIds(composition)) {
    if (resolved.has(sourceVersionId)) continue;
    const artifact = sourceResolver?.resolve(
      sourceVersionId as SourceOccurrenceVersionId
    );
    if (!artifact || artifact.source_role !== "PACKAGE") {
      throw new PositionBoundSourceCompositionError(
        `SourceComposition package SourceOccurrenceVersion is unavailable: ${sourceVersionId}`
      );
    }
    resolved.set(sourceVersionId, {
      endpoint: artifact.endpoint,
      occurrence: artifact.occurrence,
      version: artifact.version,
      extracted_record: artifact.extracted_record,
      snapshot: artifact.snapshot
    });
  }
  return resolved;
}

function compositionSourceVersionIds(composition: SourceCompositionInput) {
  return new Set([
    ...composition.evidence_registry.map((evidence) => {
      return evidence.source_occurrence_version_id;
    }),
    ...composition.source_surfaces.map((surface) => {
      return surface.source_occurrence_version_id;
    }),
    ...composition.source_surface_bindings.flatMap((binding) => [
      binding.created_context.source_occurrence_version_id,
      binding.observed_context.source_occurrence_version_id
    ])
  ]);
}

function validateOpportunitySourceClosure(
  opportunityVersion: PositionBoundOpportunityVersion,
  positionVersion: PositionVersion,
  sources: ReadonlyMap<string, PositionIdentityResolutionInput>
) {
  for (const sourceVersionId of opportunityVersion.source_occurrence_version_ids) {
    if (!sources.has(sourceVersionId)) {
      throw new PositionBoundSourceCompositionError(
        `OpportunityVersion SourceOccurrenceVersion is unavailable: ${sourceVersionId}`
      );
    }
    if (!positionVersion.source_occurrence_version_ids.includes(sourceVersionId)) {
      throw new PositionBoundSourceCompositionError(
        "OpportunityVersion source must be bound to the supplied PositionVersion"
      );
    }
  }
}

function validateCompositionProvenance(
  composition: SourceCompositionInput,
  positionVersion: PositionVersion,
  opportunityVersion: PositionBoundOpportunityVersion,
  sources: ReadonlyMap<string, PositionIdentityResolutionInput>
) {
  const evidenceById = new Map(composition.evidence_registry.map((evidence) => {
    validateEvidence(evidence, composition.composition_as_of, sources);
    return [evidence.source_composition_evidence_id, evidence] as const;
  }));
  const surfacesById = new Map(composition.source_surfaces.map((surface) => {
    validateSurface(surface, composition.composition_as_of, sources, evidenceById);
    return [surface.source_surface_id, surface] as const;
  }));
  for (const binding of composition.source_surface_bindings) {
    validateBinding(
      binding,
      positionVersion,
      opportunityVersion,
      sources,
      surfacesById,
      evidenceById
    );
  }
}

function requireSourceCompositionInputShape(input: SourceCompositionInput) {
  const candidate = input as SourceCompositionInput & Record<string, unknown>;
  if (!candidate.discovery_boundary
      || !candidate.inventory
      || !Array.isArray(candidate.evidence_registry)
      || !Array.isArray(candidate.source_surfaces)
      || !Array.isArray(candidate.source_surface_bindings)
      || !Array.isArray(candidate.authority_assertions)
      || !Array.isArray(candidate.source_version_selections)
      || !Array.isArray(candidate.surface_revision_relations)
      || !Array.isArray(candidate.precedence_decisions)
      || !Array.isArray(candidate.source_conflicts)) {
    throw new SourceCompositionValidationError(
      "Legacy composition data is not a SourceCompositionInput"
    );
  }
}

function validateEvidence(
  evidence: SourceCompositionEvidence,
  compositionAsOf: string,
  sources: ReadonlyMap<string, PositionIdentityResolutionInput>
) {
  const source = requireSource(
    sources,
    evidence.source_occurrence_version_id,
    "SourceCompositionEvidence"
  );
  if (evidence.snapshot_id !== source.snapshot.snapshot_id
      || evidence.extracted_record_id
        !== source.extracted_record.extracted_record_id
      || evidence.observed_at !== source.snapshot.observed_at
      || evidence.extractor_version
        !== source.version.materialization.extractor_version) {
    throw new PositionBoundSourceCompositionError(
      "SourceCompositionEvidence provenance does not match its validated SOV"
    );
  }
  requireNotAfterAsOf(evidence.observed_at, compositionAsOf, "Evidence");
}

function validateSurface(
  surface: SourceSurface,
  compositionAsOf: string,
  sources: ReadonlyMap<string, PositionIdentityResolutionInput>,
  evidenceById: ReadonlyMap<string, SourceCompositionEvidence>
) {
  const source = requireSource(
    sources,
    surface.source_occurrence_version_id,
    "SourceSurface"
  );
  if (surface.snapshot_id !== source.snapshot.snapshot_id
      || surface.extracted_record_id
        !== source.extracted_record.extracted_record_id
      || surface.observed_at !== source.snapshot.observed_at
      || surface.extractor_version
        !== source.version.materialization.extractor_version) {
    throw new PositionBoundSourceCompositionError(
      "SourceSurface provenance does not match its validated SOV"
    );
  }
  requireEvidenceTuple(
    surface.evidence_ids,
    surface.source_occurrence_version_id,
    surface.snapshot_id,
    surface.extracted_record_id,
    evidenceById,
    "SourceSurface"
  );
  requireNotAfterAsOf(surface.observed_at, compositionAsOf, "SourceSurface");
}

function validateBinding(
  binding: SourceSurfaceBinding,
  positionVersion: PositionVersion,
  opportunityVersion: PositionBoundOpportunityVersion,
  sources: ReadonlyMap<string, PositionIdentityResolutionInput>,
  surfacesById: ReadonlyMap<string, SourceSurface>,
  evidenceById: ReadonlyMap<string, SourceCompositionEvidence>
) {
  const surface = surfacesById.get(binding.source_surface_id);
  if (!surface) {
    throw new PositionBoundSourceCompositionError(
      "SourceSurfaceBinding references an unavailable SourceSurface"
    );
  }
  const source = requireSource(
    sources,
    surface.source_occurrence_version_id,
    "SourceSurfaceBinding"
  );
  for (const context of [binding.created_context, binding.observed_context]) {
    if (context.source_occurrence_version_id
          !== source.version.source_occurrence_version_id
        || context.snapshot_id !== source.snapshot.snapshot_id
        || context.extracted_record_id
          !== source.extracted_record.extracted_record_id
        || context.observed_at !== source.snapshot.observed_at
        || !context.resolver_version.trim()) {
      throw new PositionBoundSourceCompositionError(
        "SourceSurfaceBinding context does not match its validated SOV"
      );
    }
  }
  requireEvidenceTuple(
    binding.evidence_ids,
    surface.source_occurrence_version_id,
    surface.snapshot_id,
    surface.extracted_record_id,
    evidenceById,
    "SourceSurfaceBinding"
  );
  if (binding.target_type === "OPPORTUNITY_VERSION"
      && (binding.target_id !== opportunityVersion.opportunity_version_id
        || (binding.target_version_id !== undefined
          && binding.target_version_id
            !== opportunityVersion.opportunity_version_id))) {
    throw new PositionBoundSourceCompositionError(
      "SourceSurfaceBinding targets another OpportunityVersion"
    );
  }
  if (binding.binding_kind === "ATTACHMENT_ROW") {
    const attachmentBinding = binding as SourceSurfaceBinding & {
      readonly position_version_id?: string;
      readonly opportunity_version_id?: string;
    };
    if (attachmentBinding.position_version_id
          !== positionVersion.position_version_id
        || attachmentBinding.opportunity_version_id
          !== opportunityVersion.opportunity_version_id) {
      throw new PositionBoundSourceCompositionError(
        "AttachmentToPositionBinding does not match the supplied PositionVersion and OpportunityVersion"
      );
    }
    if (!positionVersion.source_occurrence_version_ids.includes(
      surface.source_occurrence_version_id
    )) {
      throw new PositionBoundSourceCompositionError(
        "AttachmentToPositionBinding requires a Position-bearing SOV"
      );
    }
  }
}

function requireEvidenceTuple(
  evidenceIds: readonly string[],
  sourceVersionId: string,
  snapshotId: string,
  extractedRecordId: string,
  evidenceById: ReadonlyMap<string, SourceCompositionEvidence>,
  context: string
) {
  for (const evidenceId of evidenceIds) {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence
        || evidence.source_occurrence_version_id !== sourceVersionId
        || evidence.snapshot_id !== snapshotId
        || evidence.extracted_record_id !== extractedRecordId) {
      throw new PositionBoundSourceCompositionError(
        `${context} Evidence does not match its validated source tuple`
      );
    }
  }
}

function requireSource(
  sources: ReadonlyMap<string, PositionIdentityResolutionInput>,
  sourceVersionId: string,
  context: string
) {
  const source = sources.get(sourceVersionId);
  if (!source) {
    throw new PositionBoundSourceCompositionError(
      `${context} references an unavailable SourceOccurrenceVersion`
    );
  }
  return source;
}

function requireNotAfterAsOf(
  observedAt: string,
  compositionAsOf: string,
  context: string
) {
  const observedTime = Date.parse(observedAt);
  const asOfTime = Date.parse(compositionAsOf);
  if (!Number.isFinite(observedTime)
      || !Number.isFinite(asOfTime)
      || observedTime > asOfTime) {
    throw new PositionBoundSourceCompositionError(
      `${context} observation cannot postdate composition_as_of`
    );
  }
}

function flattenSources(
  sources: readonly PositionIdentityResolutionInput[]
): PositionIdentityResolutionInput[] {
  const flattened: PositionIdentityResolutionInput[] = [];
  for (const source of sources) {
    flattened.push(source);
    for (const related of source.reconciliation?.related_sources ?? []) {
      flattened.push(related);
    }
  }
  return flattened;
}
