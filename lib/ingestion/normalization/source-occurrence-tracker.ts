import type {
  ExtractedRecord,
  IdentityHash,
  RecruitmentEndpoint,
  Snapshot,
  SourceOccurrence,
  SourceOccurrenceId,
  SourceOccurrenceVersion
} from "../domain";
import {
  materializeSourceOccurrenceVersion,
  prepareSourceOccurrenceMaterialization,
  type SourceOccurrenceMaterializationResult
} from "./source-occurrence-materializer";

export type SourceOccurrenceProcessingResult =
  SourceOccurrenceMaterializationResult<ExtractedRecord>;

export class SourceOccurrenceIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceOccurrenceIdentityError";
  }
}

export class InMemorySourceOccurrenceTracker {
  readonly #occurrencesByHash = new Map<IdentityHash, SourceOccurrence>();
  readonly #versionsByOccurrence = new Map<SourceOccurrenceId, SourceOccurrenceVersion[]>();

  process<RecordType extends ExtractedRecord>(
    endpoint: RecruitmentEndpoint,
    extractedRecord: RecordType,
    snapshot?: Snapshot
  ): SourceOccurrenceMaterializationResult<RecordType> {
    let prepared;
    try {
      prepared = prepareSourceOccurrenceMaterialization(
        endpoint,
        extractedRecord,
        snapshot
      );
    } catch (error) {
      if (error instanceof Error) {
        throw new SourceOccurrenceIdentityError(error.message);
      }
      throw error;
    }
    const existingOccurrence = this.#occurrencesByHash.get(prepared.identity_hash) ?? null;
    const existingVersions = existingOccurrence
      ? this.#versionsByOccurrence.get(existingOccurrence.source_occurrence_id) ?? []
      : [];
    const result = materializeSourceOccurrenceVersion({
      prepared,
      existing_occurrence: existingOccurrence,
      existing_versions: existingVersions
    });
    if (result.occurrence_created) {
      this.#occurrencesByHash.set(result.occurrence.identity_hash, clone(result.occurrence));
      this.#versionsByOccurrence.set(result.occurrence.source_occurrence_id, []);
    }
    if (result.version_created) {
      this.#versionsByOccurrence.get(result.occurrence.source_occurrence_id)!
        .push(clone(result.version));
    }
    return clone(result);
  }

  getOccurrence(identityHash: IdentityHash) {
    const occurrence = this.#occurrencesByHash.get(identityHash);
    return occurrence ? clone(occurrence) : null;
  }

  listOccurrences() {
    return [...this.#occurrencesByHash.values()].map(clone);
  }

  listVersions(sourceOccurrenceId: SourceOccurrenceId) {
    return (this.#versionsByOccurrence.get(sourceOccurrenceId) ?? []).map(clone);
  }
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

export {
  buildIdentityBasis,
  identityHashFor,
  semanticHashFor
} from "./source-occurrence-materializer";
