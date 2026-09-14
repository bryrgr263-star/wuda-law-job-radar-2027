import type {
  ExtractedRecordV2,
  IdentityHash,
  MaterializedSourceOccurrenceVersion,
  RecruitmentEndpoint,
  Snapshot,
  SourceOccurrence,
  SourceOccurrenceId,
  SourceOccurrenceVersionId
} from "../domain";
import {
  CanonicalArtifactRegistryError,
  createCanonicalArtifactRegistryAuthority
} from "./canonical-artifact-registry";
import {
  materializeSourceOccurrenceVersion,
  prepareSourceOccurrenceMaterialization,
  validateSourceOccurrenceVersionBinding
} from "./source-occurrence-materializer";

export type TrustedSourceOccurrenceRole = "POSITION_BEARING" | "PACKAGE";

export interface TrustedSourceOccurrenceArtifact {
  readonly source_role: TrustedSourceOccurrenceRole;
  readonly endpoint: RecruitmentEndpoint;
  readonly occurrence: SourceOccurrence;
  readonly version: MaterializedSourceOccurrenceVersion;
  readonly extracted_record: ExtractedRecordV2;
  readonly snapshot: Snapshot;
}

export interface TrustedSourceOccurrenceVersionResolver {
  resolve(
    sourceOccurrenceVersionId: SourceOccurrenceVersionId
  ): TrustedSourceOccurrenceArtifact | null;
}

export interface TrustedSourceOccurrenceMaterializationInput {
  readonly source_role: TrustedSourceOccurrenceRole;
  readonly endpoint: RecruitmentEndpoint;
  readonly extracted_record: ExtractedRecordV2;
  readonly snapshot: Snapshot;
}

const trustedSourceOccurrenceResolvers = new WeakSet<object>();

export class TrustedSourceOccurrenceRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrustedSourceOccurrenceRegistryError";
  }
}

export class InMemoryTrustedSourceOccurrenceTracker
implements TrustedSourceOccurrenceVersionResolver {
  readonly #occurrencesByHash = new Map<IdentityHash, SourceOccurrence>();
  readonly #versionIdsByOccurrence = new Map<
    SourceOccurrenceId,
    SourceOccurrenceVersionId[]
  >();
  readonly #registry = createCanonicalArtifactRegistryAuthority<
    SourceOccurrenceVersionId,
    TrustedSourceOccurrenceArtifact
  >((artifact) => artifact.version.source_occurrence_version_id);

  constructor() {
    trustedSourceOccurrenceResolvers.add(this);
  }

  process(
    input: TrustedSourceOccurrenceMaterializationInput
  ): TrustedSourceOccurrenceArtifact {
    validateRole(input);
    const prepared = prepareSourceOccurrenceMaterialization(
      input.endpoint,
      input.extracted_record,
      input.snapshot
    );
    const existingOccurrence = this.#occurrencesByHash.get(
      prepared.identity_hash
    ) ?? null;
    const existingVersions = existingOccurrence
      ? (this.#versionIdsByOccurrence.get(existingOccurrence.source_occurrence_id) ?? [])
        .map((versionId) => {
          const artifact = this.#registry.resolver.resolve(versionId);
          if (!artifact) {
            throw new TrustedSourceOccurrenceRegistryError(
              "Trusted SOV registry is internally incomplete"
            );
          }
          return artifact.version;
        })
      : [];
    const materialized = materializeSourceOccurrenceVersion({
      prepared,
      existing_occurrence: existingOccurrence,
      existing_versions: existingVersions
    });
    const artifact = assertTrustedSourceOccurrenceArtifactIntegrity({
      source_role: input.source_role,
      endpoint: structuredClone(input.endpoint),
      occurrence: materialized.occurrence,
      version: materialized.version,
      extracted_record: structuredClone(input.extracted_record),
      snapshot: structuredClone(input.snapshot)
    });
    let sealed;
    try {
      sealed = this.#registry.writer.seal(
        artifact.version.source_occurrence_version_id,
        artifact
      );
    } catch (error) {
      if (error instanceof CanonicalArtifactRegistryError
          && error.code === "IDENTITY_COLLISION") {
        throw new TrustedSourceOccurrenceRegistryError(
          `Trusted SOV identity collision: ${artifact.version.source_occurrence_version_id}`
        );
      }
      throw error;
    }
    if (!existingOccurrence) {
      this.#occurrencesByHash.set(
        materialized.occurrence.identity_hash,
        structuredClone(materialized.occurrence)
      );
      this.#versionIdsByOccurrence.set(
        materialized.occurrence.source_occurrence_id,
        []
      );
    }
    if (sealed.status === "SEALED") {
      this.#versionIdsByOccurrence
        .get(materialized.occurrence.source_occurrence_id)!
        .push(materialized.version.source_occurrence_version_id);
    }
    return assertTrustedSourceOccurrenceArtifactIntegrity(sealed.artifact);
  }

  resolve(sourceOccurrenceVersionId: SourceOccurrenceVersionId) {
    const artifact = this.#registry.resolver.resolve(sourceOccurrenceVersionId);
    return artifact
      ? assertTrustedSourceOccurrenceArtifactIntegrity(artifact)
      : null;
  }
}

export function assertTrustedSourceOccurrenceVersionResolver(
  resolver: TrustedSourceOccurrenceVersionResolver
) {
  if (!trustedSourceOccurrenceResolvers.has(resolver as object)
      || Object.getPrototypeOf(resolver)
        !== InMemoryTrustedSourceOccurrenceTracker.prototype) {
    throw new TrustedSourceOccurrenceRegistryError(
      "Trusted SOV resolver must be composition-root controlled"
    );
  }
  return resolver;
}

export function assertTrustedSourceOccurrenceArtifactIntegrity(
  artifact: TrustedSourceOccurrenceArtifact
): TrustedSourceOccurrenceArtifact {
  validateRole(artifact);
  validateSourceOccurrenceVersionBinding({
    endpoint: artifact.endpoint,
    occurrence: artifact.occurrence,
    version: artifact.version,
    extracted_record: artifact.extracted_record,
    snapshot: artifact.snapshot
  });
  return structuredClone(artifact);
}

function validateRole(input: {
  readonly source_role: TrustedSourceOccurrenceRole;
  readonly extracted_record: ExtractedRecordV2;
}) {
  const context = input.extracted_record.recruitment_context;
  if (input.source_role === "PACKAGE" && context) {
    throw new TrustedSourceOccurrenceRegistryError(
      "Package SOV must not carry Position-bearing RecruitmentContext"
    );
  }
  if (input.source_role === "POSITION_BEARING" && !context) {
    throw new TrustedSourceOccurrenceRegistryError(
      "Position-bearing SOV requires RecruitmentContext"
    );
  }
}
