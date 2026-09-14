import { createHash } from "node:crypto";

import {
  type IdentityEvidenceId,
  type LocationAssignment,
  type LocationAssignmentId,
  type OrganizationRoleAssignment,
  type OrganizationRoleAssignmentId,
  type Position,
  type PositionId,
  type PositionVersion,
  type PositionVersionId,
  type PositionVersionSemanticPayload,
  type SemanticHash,
  type SourceOccurrenceVersionId
} from "../domain";
import {
  POSITION_VERSION_MATERIALIZATION_VERSION,
  POSITION_VERSION_SCHEMA_VERSION,
  positionCanonicalHashFor,
  positionVersionIdFor,
  positionVersionIntegrityHashFor,
  positionVersionSemanticHashFor,
  validatePosition,
  validatePositionVersion
} from "../domain/recruitment-context";
import {
  resolvePositionIdentity,
  type PositionIdentityResolutionInput,
  type ValidatedPositionIdentitySource
} from "./position-identity-resolver";
import {
  CanonicalArtifactRegistryError,
  canonicalSerialize,
  createCanonicalArtifactRegistryAuthority
} from "./canonical-artifact-registry";

const trustedResolverByReadModel = new WeakMap<
  object,
  TrustedPositionVersionResolver
>();

export interface PositionVersionTrackingInput {
  readonly position: Position;
  readonly sources: readonly PositionIdentityResolutionInput[];
}

export interface PositionVersionTrackingResult {
  readonly position: Position;
  readonly position_version: PositionVersion;
  readonly version_created: boolean;
}

export interface TrustedPositionVersionArtifact {
  readonly position: Position;
  readonly position_version: PositionVersion;
}

export interface TrustedPositionVersionResolver {
  resolve(positionVersionId: PositionVersionId): TrustedPositionVersionArtifact | null;
}

export class PositionVersionTrackingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PositionVersionTrackingError";
  }
}

export class InMemoryPositionVersionTracker implements TrustedPositionVersionResolver {
  readonly #positions = new Map<PositionId, Position>();
  readonly #versions = new Map<PositionId, PositionVersionId[]>();
  readonly #sourceVersionHashes = new Map<SourceOccurrenceVersionId, SemanticHash>();
  readonly #registry = createCanonicalArtifactRegistryAuthority<
    PositionVersionId,
    TrustedPositionVersionArtifact
  >((artifact) => artifact.position_version.position_version_id);

  process(input: PositionVersionTrackingInput): PositionVersionTrackingResult {
    const position = validatePosition(input.position);
    if (!Array.isArray(input.sources) || input.sources.length === 0) {
      throw new PositionVersionTrackingError(
        "PositionVersion materialization requires at least one validated SOV"
      );
    }

    const resolutions = input.sources.map((source) => ({
      source,
      resolution: resolvePositionIdentity(source)
    }));
    for (const item of resolutions) {
      if (item.resolution.status !== "RESOLVED") {
        throw new PositionVersionTrackingError(
          "Unresolved Position identity cannot materialize a PositionVersion"
        );
      }
      if (
        item.resolution.position.position_id !== position.position_id
        || item.resolution.position.identity_hash !== position.identity_hash
      ) {
        throw new PositionVersionTrackingError(
          "Validated SOV identity does not match the supplied Position"
        );
      }
    }

    const existingPosition = this.#positions.get(position.position_id);
    if (
      existingPosition
      && (
        existingPosition.identity_hash !== position.identity_hash
        || existingPosition.identity_state !== position.identity_state
      )
    ) {
      throw new PositionVersionTrackingError(
        "Stored Position identity is immutable"
      );
    }

    const existingVersions = (this.#versions.get(position.position_id) ?? []).map(
      (positionVersionId) => {
        const artifact = this.#registry.resolver.resolve(positionVersionId);
        if (!artifact) {
          throw new PositionVersionTrackingError(
            "Trusted PositionVersion registry is internally incomplete"
          );
        }
        return artifact.position_version;
      }
    );
    validateHistory(existingVersions, position);

    const contentSources = uniqueSources(input.sources);
    const validatedSources = uniqueSources(input.sources.flatMap(allValidatedSources));
    validateSourceVersionIntegrity(validatedSources, this.#sourceVersionHashes);

    const projections = input.sources
      .map((source) => ({
        source,
        payload: semanticPayloadFor(position, source)
      }))
      .sort((left, right) => {
        return left.source.version.source_occurrence_version_id.localeCompare(
          right.source.version.source_occurrence_version_id
        );
      });
    const semanticHashes = projections.map(({ payload }) => {
      return positionVersionSemanticHashFor(payload);
    });
    if (semanticHashes.some((hash) => hash !== semanticHashes[0])) {
      throw new PositionVersionTrackingError(
        "One PositionVersion cannot combine conflicting substantive SOV semantics"
      );
    }
    const semanticHash = semanticHashes[0]!;
    const existingVersion = existingVersions.find((version) => {
      return version.semantic_hash === semanticHash;
    });
    const revision = existingVersion?.revision ?? existingVersions.length + 1;
    const sourceOccurrenceVersionIds = uniqueSorted(
      contentSources.map((source) => source.version.source_occurrence_version_id)
    );
    const availableContentEvidence = new Set(contentSources.flatMap((source) => {
      return source.version.identity_evidence.map((evidence) => {
        return evidence.identity_evidence_id;
      });
    }));
    const identityEvidenceIds = uniqueSorted(resolutions.flatMap((item) => {
      return item.resolution.status === "RESOLVED"
        ? item.resolution.position.identity_evidence_ids
        : [];
    }).filter((evidenceId) => availableContentEvidence.has(evidenceId)));
    validateEvidenceBinding(identityEvidenceIds, contentSources);
    const payload = projections[0]!.payload;
    const versionWithoutIntegrity: Omit<PositionVersion, "integrity_hash"> = {
      ...clone(payload),
      position_version_id: positionVersionIdFor(position.identity_hash, revision),
      revision,
      semantic_hash: semanticHash,
      position_identity_hash: position.identity_hash,
      position_canonical_hash: positionCanonicalHashFor(position),
      source_occurrence_version_ids: asNonEmpty(sourceOccurrenceVersionIds),
      identity_evidence_ids: identityEvidenceIds,
      effective_from: input.sources
        .map((source) => source.version.first_observed_at)
        .sort()[0]!,
      schema_version: POSITION_VERSION_SCHEMA_VERSION,
      materialization_version: POSITION_VERSION_MATERIALIZATION_VERSION
    };
    const version = validatePositionVersion({
      ...versionWithoutIntegrity,
      integrity_hash: positionVersionIntegrityHashFor(versionWithoutIntegrity)
    }, position);

    let sealed;
    try {
      sealed = this.#registry.writer.seal(version.position_version_id, {
        position: clone(position),
        position_version: clone(version)
      });
    } catch (error) {
      if (error instanceof CanonicalArtifactRegistryError
          && error.code === "IDENTITY_COLLISION") {
        throw new PositionVersionTrackingError(
          `PositionVersion identity collision: ${version.position_version_id}`
        );
      }
      throw error;
    }

    if (!existingPosition) {
      this.#positions.set(position.position_id, clone(position));
      this.#versions.set(position.position_id, []);
    }
    this.#recordValidatedSources(validatedSources);
    if (sealed.status === "SEALED") {
      this.#versions.get(position.position_id)!.push(version.position_version_id);
    }
    return {
      position: clone(sealed.artifact.position),
      position_version: trustedPositionVersionReadModel(
        this,
        sealed.artifact.position_version
      ),
      version_created: sealed.status === "SEALED"
    };
  }

  resolve(positionVersionId: PositionVersionId) {
    const artifact = this.#registry.resolver.resolve(positionVersionId);
    if (!artifact) return null;
    validatePositionVersion(artifact.position_version, artifact.position);
    return {
      position: clone(artifact.position),
      position_version: trustedPositionVersionReadModel(
        this,
        artifact.position_version
      )
    };
  }

  getPosition(positionId: PositionId) {
    const position = this.#positions.get(positionId);
    return position ? clone(position) : null;
  }

  listVersions(positionId: PositionId) {
    return (this.#versions.get(positionId) ?? []).map((positionVersionId) => {
      const artifact = this.resolve(positionVersionId);
      if (!artifact) {
        throw new PositionVersionTrackingError(
          "Trusted PositionVersion registry is internally incomplete"
        );
      }
      return artifact.position_version;
    });
  }

  #recordValidatedSources(sources: readonly ValidatedPositionIdentitySource[]) {
    for (const source of sources) {
      this.#sourceVersionHashes.set(
        source.version.source_occurrence_version_id,
        source.version.semantic_hash
      );
    }
  }
}

export function resolveTrustedPositionVersionReadModel(
  readModel: PositionVersion
): {
  readonly resolver: TrustedPositionVersionResolver;
  readonly artifact: TrustedPositionVersionArtifact;
} | null {
  const resolver = trustedResolverByReadModel.get(readModel as object);
  if (!resolver) return null;
  const artifact = resolver.resolve(readModel.position_version_id);
  if (!artifact
      || canonicalSerialize(artifact.position_version)
        !== canonicalSerialize(readModel)) {
    return null;
  }
  return { resolver, artifact };
}

function trustedPositionVersionReadModel(
  resolver: TrustedPositionVersionResolver,
  version: PositionVersion
) {
  const readModel = clone(version);
  trustedResolverByReadModel.set(readModel as object, resolver);
  return readModel;
}

function semanticPayloadFor(
  position: Position,
  source: PositionIdentityResolutionInput
): PositionVersionSemanticPayload {
  const content = source.version.content;
  return {
    position_id: position.position_id,
    title: clone(content.title),
    organization_role_assignments:
      content.organization_role_assignments?.length
        ? content.organization_role_assignments.map(clone)
        : [organizationProjection(position, source)],
    location_assignments:
      content.location_assignments?.length
        ? content.location_assignments.map(clone)
        : locationProjection(position, source),
    headcount_observation_ids: (content.headcount_observations ?? []).map((item) => {
      return item.headcount_observation_id;
    }),
    recruitment_population_reference_ids:
      (content.recruitment_population_references ?? []).map((item) => {
        return item.recruitment_population_reference_id;
      }),
    requirement_surface_reference_keys: []
  };
}

function organizationProjection(
  position: Position,
  source: PositionIdentityResolutionInput
): OrganizationRoleAssignment {
  const organization = source.version.content.organization;
  const canonical = stableSerialize({
    organization_id: organization.organization_id ?? null,
    position_id: position.position_id,
    raw_name: semanticText(organization.name),
    role: "EMPLOYER_ENTITY"
  });
  return {
    organization_role_assignment_id:
      `organization-role-assignment:${sha256(canonical)}` as OrganizationRoleAssignmentId,
    role: "EMPLOYER_ENTITY",
    ...(organization.organization_id
      ? { organization_id: organization.organization_id }
      : {}),
    identity_state: organization.organization_id ? "CONFIRMED" : "UNRESOLVED",
    raw_name: clone(organization.name),
    identity_evidence_ids: []
  };
}

function locationProjection(
  position: Position,
  source: PositionIdentityResolutionInput
): readonly LocationAssignment[] {
  const locations = source.version.content.locations;
  if (locations.length === 0) return [];
  const canonical = stableSerialize({
    locations: locations.map((location) => ({
      city: location.city ?? null,
      country: location.country ?? null,
      district: location.district ?? null,
      is_nationwide: location.is_nationwide,
      normalization_confidence: location.normalization_confidence,
      province: location.province ?? null,
      raw_text: location.raw_text.text
    })),
    position_id: position.position_id,
    role: "UNKNOWN"
  });
  return [{
    location_assignment_id:
      `location-assignment:${sha256(canonical)}` as LocationAssignmentId,
    role: "UNKNOWN",
    assignment_mode: locations.length === 1 ? "SINGLE" : "MULTI_LOCATION",
    locations: clone(locations),
    identity_discriminator: false,
    identity_state: "PROVISIONAL",
    identity_evidence_ids: []
  }];
}

function allValidatedSources(
  source: PositionIdentityResolutionInput
): readonly ValidatedPositionIdentitySource[] {
  return [source, ...(source.reconciliation?.related_sources ?? [])];
}

function uniqueSources(sources: readonly ValidatedPositionIdentitySource[]) {
  const byId = new Map<SourceOccurrenceVersionId, ValidatedPositionIdentitySource>();
  for (const source of sources) {
    const existing = byId.get(source.version.source_occurrence_version_id);
    if (existing && existing.version.semantic_hash !== source.version.semantic_hash) {
      throw new PositionVersionTrackingError(
        "One SOV ID cannot carry multiple semantic hashes"
      );
    }
    byId.set(source.version.source_occurrence_version_id, source);
  }
  return [...byId.values()];
}

function validateSourceVersionIntegrity(
  sources: readonly ValidatedPositionIdentitySource[],
  existingHashes: ReadonlyMap<SourceOccurrenceVersionId, SemanticHash>
) {
  for (const source of sources) {
    const existingHash = existingHashes.get(
      source.version.source_occurrence_version_id
    );
    if (existingHash && existingHash !== source.version.semantic_hash) {
      throw new PositionVersionTrackingError(
        "Previously observed SOV identity cannot be rebound to new semantics"
      );
    }
  }
}

function validateEvidenceBinding(
  evidenceIds: readonly IdentityEvidenceId[],
  sources: readonly ValidatedPositionIdentitySource[]
) {
  if (evidenceIds.length === 0) {
    throw new PositionVersionTrackingError(
      "PositionVersion requires Position identity Evidence"
    );
  }
  const available = new Set(sources.flatMap((source) => {
    return source.version.identity_evidence.map((evidence) => {
      return evidence.identity_evidence_id;
    });
  }));
  if (evidenceIds.some((evidenceId) => !available.has(evidenceId))) {
    throw new PositionVersionTrackingError(
      "PositionVersion identity Evidence must resolve to its bound SOVs"
    );
  }
}

function validateHistory(
  versions: readonly PositionVersion[],
  position: Position
) {
  const revisions = new Set<number>();
  const hashes = new Set<SemanticHash>();
  for (const version of versions) {
    validatePositionVersion(version, position);
    if (revisions.has(version.revision) || hashes.has(version.semantic_hash)) {
      throw new PositionVersionTrackingError(
        "PositionVersion history must have unique revisions and semantics"
      );
    }
    revisions.add(version.revision);
    hashes.add(version.semantic_hash);
  }
  const ordered = [...revisions].sort((left, right) => left - right);
  if (ordered.some((revision, index) => revision !== index + 1)) {
    throw new PositionVersionTrackingError(
      "PositionVersion history revisions must be contiguous"
    );
  }
}

function semanticText(value: {
  readonly original: { readonly text: string };
  readonly normalized?: { readonly text: string };
}) {
  return (value.normalized?.text ?? value.original.text).trim();
}

function uniqueSorted<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)].sort();
}

function asNonEmpty<Value>(values: readonly Value[]): readonly [Value, ...Value[]] {
  if (values.length === 0) {
    throw new PositionVersionTrackingError("A non-empty SOV binding is required");
  }
  return values as readonly [Value, ...Value[]];
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => {
      return `${JSON.stringify(key)}:${stableSerialize(record[key])}`;
    }).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}
