import type {
  SourceCompositionResult,
  SourceCompositionResultId
} from "../domain";
import type { Cr12StructuredRequirementSetInput } from "../requirements";
import {
  CanonicalArtifactRegistryError,
  canonicalHash,
  canonicalSerialize,
  createCanonicalArtifactRegistryAuthority
} from "../normalization/canonical-artifact-registry";
import {
  assertTrustedPositionBoundOpportunityResolver,
  assertTrustedSourceOccurrenceVersionResolver,
  type PositionIdentityResolutionInput,
  type TrustedSourceOccurrenceVersionResolver,
  type TrustedPositionBoundOpportunityResolver
} from "../normalization";
import {
  assertTrustedSourceCompositionResolver,
  type TrustedSourceCompositionResolver
} from "./position-bound-source-composition";
import { projectApprovedRequirements } from "./approved-requirement-projector";

export const APPROVED_REQUIREMENT_PROJECTOR_IMPLEMENTATION_ID =
  "cr12-explicit-requirement-projector/1.0.0" as const;
export const REQUIREMENT_PROJECTION_SCHEMA_VERSION =
  "requirement-projection/1.0.0" as const;

export type RequirementProjectionOutput = Omit<
  Cr12StructuredRequirementSetInput,
  "opportunity_version_id" | "source_composition_result"
>;

export interface RequirementProjectionArtifact {
  readonly requirement_projection_id: string;
  readonly projection_key: string;
  readonly source_composition_id: SourceCompositionResultId;
  readonly source_composition_hash: string;
  readonly opportunity_version_id: string;
  readonly projector_implementation_id:
    typeof APPROVED_REQUIREMENT_PROJECTOR_IMPLEMENTATION_ID;
  readonly output: RequirementProjectionOutput;
  readonly output_hash: string;
  readonly schema_version: typeof REQUIREMENT_PROJECTION_SCHEMA_VERSION;
  readonly integrity_hash: string;
}

export interface TrustedRequirementProjectionResolver {
  resolve(requirementProjectionId: string): RequirementProjectionArtifact | null;
  resolveByKey(projectionKey: string): RequirementProjectionArtifact | null;
}

const trustedProjectionResolvers = new WeakSet<object>();

export class RequirementProjectionError extends Error {
  readonly code: "PROJECTION_UNSUPPORTED" | "PROJECTION_NON_DETERMINISM";

  constructor(code: RequirementProjectionError["code"], message: string) {
    super(message);
    this.name = "RequirementProjectionError";
    this.code = code;
  }
}

export class InMemoryApprovedRequirementProjectionTracker
implements TrustedRequirementProjectionResolver {
  readonly #pbovResolver: TrustedPositionBoundOpportunityResolver;
  readonly #sourceCompositionResolver: TrustedSourceCompositionResolver;
  readonly #sourceResolver: TrustedSourceOccurrenceVersionResolver | null;
  readonly #projectionIdsByKey = new Map<string, string>();
  readonly #registry = createCanonicalArtifactRegistryAuthority<
    string,
    RequirementProjectionArtifact
  >((artifact) => artifact.requirement_projection_id);

  constructor(
    pbovResolver: TrustedPositionBoundOpportunityResolver,
    sourceCompositionResolver: TrustedSourceCompositionResolver,
    sourceResolver: TrustedSourceOccurrenceVersionResolver | null = null
  ) {
    this.#pbovResolver = assertTrustedPositionBoundOpportunityResolver(pbovResolver);
    this.#sourceCompositionResolver = assertTrustedSourceCompositionResolver(
      sourceCompositionResolver
    );
    this.#sourceResolver = sourceResolver
      ? assertTrustedSourceOccurrenceVersionResolver(sourceResolver)
      : null;
    trustedProjectionResolvers.add(this);
  }

  process(sourceCompositionId: SourceCompositionResultId) {
    const sourceComposition = this.#sourceCompositionResolver.resolve(
      sourceCompositionId
    );
    if (!sourceComposition || sourceComposition.status !== "COMPLETE") {
      throw new RequirementProjectionError(
        "PROJECTION_UNSUPPORTED",
        "Requirement projection requires a trusted COMPLETE SourceComposition"
      );
    }
    const graph = this.#pbovResolver.resolve(
      sourceComposition.opportunity_version_id
    );
    const positionSources = this.#pbovResolver.resolveSources(
      sourceComposition.opportunity_version_id
    );
    if (!graph || !positionSources) {
      throw new RequirementProjectionError(
        "PROJECTION_UNSUPPORTED",
        "Requirement projection requires trusted PBOV source provenance"
      );
    }
    const sources = resolveProjectionSources(
      sourceComposition,
      positionSources,
      this.#sourceResolver
    );
    const projectionKey = `requirement-projection-key:${canonicalHash({
      source_composition_id: sourceComposition.source_composition_id,
      composition_hash: sourceComposition.composition_hash,
      projector_implementation_id: APPROVED_REQUIREMENT_PROJECTOR_IMPLEMENTATION_ID
    })}`;
    const output = projectExplicitRequirements(
      sourceComposition,
      graph.position_version.position_version_id,
      graph.opportunity_version,
      sources
    );
    const outputHash = canonicalHash(output);
    const artifactWithoutIntegrity = {
      requirement_projection_id: `requirement-projection:${canonicalHash({
        projection_key: projectionKey,
        output_hash: outputHash,
        schema_version: REQUIREMENT_PROJECTION_SCHEMA_VERSION
      })}`,
      projection_key: projectionKey,
      source_composition_id: sourceComposition.source_composition_id,
      source_composition_hash: sourceComposition.composition_hash,
      opportunity_version_id: graph.opportunity_version.opportunity_version_id,
      projector_implementation_id: APPROVED_REQUIREMENT_PROJECTOR_IMPLEMENTATION_ID,
      output,
      output_hash: outputHash,
      schema_version: REQUIREMENT_PROJECTION_SCHEMA_VERSION
    } as const;
    const artifact: RequirementProjectionArtifact = {
      ...artifactWithoutIntegrity,
      integrity_hash: canonicalHash(artifactWithoutIntegrity)
    };
    const existingId = this.#projectionIdsByKey.get(projectionKey);
    if (existingId) {
      const existing = this.#registry.resolver.resolve(existingId);
      assertDeterministicRequirementProjectionReplay(
        existing,
        projectionKey,
        output,
        outputHash
      );
    }
    try {
      const sealed = this.#registry.writer.seal(
        artifact.requirement_projection_id,
        artifact
      );
      if (!existingId) {
        this.#projectionIdsByKey.set(projectionKey, artifact.requirement_projection_id);
      }
      return sealed.artifact;
    } catch (error) {
      if (error instanceof CanonicalArtifactRegistryError
          && error.code === "IDENTITY_COLLISION") {
        throw new RequirementProjectionError(
          "PROJECTION_NON_DETERMINISM",
          `RequirementProjection identity collision: ${artifact.requirement_projection_id}`
        );
      }
      throw error;
    }
  }

  resolve(requirementProjectionId: string) {
    const artifact = this.#registry.resolver.resolve(requirementProjectionId);
    return artifact ? assertRequirementProjectionIntegrity(artifact) : null;
  }

  resolveByKey(projectionKey: string) {
    const identity = this.#projectionIdsByKey.get(projectionKey);
    return identity ? this.resolve(identity) : null;
  }
}

function resolveProjectionSources(
  sourceComposition: SourceCompositionResult,
  positionSources: readonly PositionIdentityResolutionInput[],
  sourceResolver: TrustedSourceOccurrenceVersionResolver | null
) {
  const sources = new Map(positionSources.map((source) => {
    return [source.version.source_occurrence_version_id, source] as const;
  }));
  for (const surface of sourceComposition.source_surfaces) {
    if (sources.has(surface.source_occurrence_version_id)) continue;
    const artifact = sourceResolver?.resolve(surface.source_occurrence_version_id);
    if (!artifact || artifact.source_role !== "PACKAGE") {
      throw new RequirementProjectionError(
        "PROJECTION_UNSUPPORTED",
        `Requirement projection lacks trusted package SOV provenance: ${surface.source_surface_id}`
      );
    }
    sources.set(surface.source_occurrence_version_id, {
      endpoint: artifact.endpoint,
      occurrence: artifact.occurrence,
      version: artifact.version,
      extracted_record: artifact.extracted_record,
      snapshot: artifact.snapshot
    });
  }
  return [...sources.values()];
}

export function assertDeterministicRequirementProjectionReplay(
  existing: RequirementProjectionArtifact | null,
  projectionKey: string,
  output: RequirementProjectionOutput,
  outputHash = canonicalHash(output)
) {
  if (!existing || existing.projection_key !== projectionKey
      || existing.output_hash !== outputHash
      || canonicalSerialize(existing.output) !== canonicalSerialize(output)) {
    throw new RequirementProjectionError(
      "PROJECTION_NON_DETERMINISM",
      `Projection key produced different canonical output: ${projectionKey}`
    );
  }
  return existing;
}

export function assertTrustedRequirementProjectionResolver(
  resolver: TrustedRequirementProjectionResolver
) {
  if (!trustedProjectionResolvers.has(resolver as object)
      || Object.getPrototypeOf(resolver)
        !== InMemoryApprovedRequirementProjectionTracker.prototype) {
    throw new RequirementProjectionError(
      "PROJECTION_UNSUPPORTED",
      "RequirementProjection resolver must be composition-root controlled"
    );
  }
  return resolver;
}

export function assertRequirementProjectionIntegrity(
  artifact: RequirementProjectionArtifact
) {
  const { integrity_hash: integrityHash, ...withoutIntegrity } = artifact;
  if (artifact.projector_implementation_id
        !== APPROVED_REQUIREMENT_PROJECTOR_IMPLEMENTATION_ID
      || artifact.schema_version !== REQUIREMENT_PROJECTION_SCHEMA_VERSION
      || artifact.output_hash !== canonicalHash(artifact.output)
      || integrityHash !== canonicalHash(withoutIntegrity)) {
    throw new RequirementProjectionError(
      "PROJECTION_UNSUPPORTED",
      "RequirementProjection integrity validation failed"
    );
  }
  return artifact;
}

function projectExplicitRequirements(
  sourceComposition: SourceCompositionResult,
  positionVersionId: import("../domain").PositionVersionId,
  opportunityVersion: import("../domain").PositionBoundOpportunityVersion,
  sources: readonly import("../normalization").PositionIdentityResolutionInput[]
): RequirementProjectionOutput {
  try {
    return projectApprovedRequirements({
      source_composition: sourceComposition,
      position_version_id: positionVersionId,
      opportunity_version: opportunityVersion,
      sources,
      projector_version: APPROVED_REQUIREMENT_PROJECTOR_IMPLEMENTATION_ID
    });
  } catch (error) {
    throw new RequirementProjectionError(
      "PROJECTION_UNSUPPORTED",
      error instanceof Error ? error.message : "Approved requirement projection failed"
    );
  }
}
