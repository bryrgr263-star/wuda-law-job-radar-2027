import { createHash } from "node:crypto";

import type {
  ExtractedRecord,
  IdentityHash,
  OpportunityContent,
  RecruitmentEndpoint,
  SemanticHash,
  SourceOccurrence,
  SourceOccurrenceId,
  SourceOccurrenceIdentityBasis,
  SourceOccurrenceVersion,
  SourceOccurrenceVersionId,
  TraceableText
} from "../domain";
import {
  normalizeExtractedRecord,
  type NormalizedSourceRecord
} from "./source-record-normalizer";

export interface SourceOccurrenceProcessingResult {
  readonly occurrence: SourceOccurrence;
  readonly version: SourceOccurrenceVersion;
  readonly occurrence_created: boolean;
  readonly version_created: boolean;
}

export class SourceOccurrenceIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceOccurrenceIdentityError";
  }
}

export class InMemorySourceOccurrenceTracker {
  readonly #occurrencesByHash = new Map<IdentityHash, SourceOccurrence>();
  readonly #versionsByOccurrence = new Map<SourceOccurrenceId, SourceOccurrenceVersion[]>();

  process(
    endpoint: RecruitmentEndpoint,
    extractedRecord: ExtractedRecord
  ): SourceOccurrenceProcessingResult {
    if (endpoint.source_definition_id !== extractedRecord.source_definition_id) {
      throw new SourceOccurrenceIdentityError(
        "Endpoint and ExtractedRecord must belong to the same SourceDefinition"
      );
    }
    const normalized = normalizeExtractedRecord(extractedRecord);
    const identityBasis = buildIdentityBasis(normalized);
    const identityHash = identityHashFor(endpoint.recruitment_endpoint_id, identityBasis);
    const existingOccurrence = this.#occurrencesByHash.get(identityHash);
    const occurrence = existingOccurrence ?? createOccurrence(
      endpoint,
      extractedRecord,
      identityBasis,
      identityHash
    );
    if (!existingOccurrence) {
      this.#occurrencesByHash.set(identityHash, occurrence);
      this.#versionsByOccurrence.set(occurrence.source_occurrence_id, []);
    }

    const versions = this.#versionsByOccurrence.get(occurrence.source_occurrence_id)!;
    const semanticHash = semanticHashFor(normalized.content);
    const latest = versions[versions.length - 1];
    if (latest?.semantic_hash === semanticHash) {
      return {
        occurrence: clone(occurrence),
        version: clone(latest),
        occurrence_created: false,
        version_created: false
      };
    }

    const revision = versions.length + 1;
    const version = createVersion(
      occurrence,
      normalized,
      extractedRecord,
      semanticHash,
      revision
    );
    versions.push(version);
    return {
      occurrence: clone(occurrence),
      version: clone(version),
      occurrence_created: !existingOccurrence,
      version_created: true
    };
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

export function buildIdentityBasis(
  normalized: NormalizedSourceRecord
): SourceOccurrenceIdentityBasis {
  const recruitmentCycle = recruitmentCycleFor(normalized.content);
  if (normalized.raw_source_record_id && recruitmentCycle) {
    return {
      kind: "SOURCE_RECORD_ID",
      source_record_id: normalized.raw_source_record_id,
      recruitment_cycle: recruitmentCycle
    };
  }
  if (normalized.content.announcement_locator) {
    return {
      kind: "DETAIL_URL",
      normalized_detail_url: normalized.content.announcement_locator
    };
  }

  const organization = normalizedValue(normalized.content.organization.name);
  const title = normalizedValue(normalized.content.title);
  if (!organization || !title) {
    throw new SourceOccurrenceIdentityError(
      "Composite identity requires normalized organization and title"
    );
  }
  return {
    kind: "COMPOSITE_FIELDS",
    normalized_organization: organization,
    normalized_title: title,
    normalized_locations: normalized.content.locations.map(locationIdentityValue).sort(),
    recruitment_batch: normalized.content.recruitment_batch
      ? normalizedValue(normalized.content.recruitment_batch)
      : null
  };
}

export function identityHashFor(
  endpointId: RecruitmentEndpoint["recruitment_endpoint_id"],
  identityBasis: SourceOccurrenceIdentityBasis
) {
  return sha256(stableSerialize({
    recruitment_endpoint_id: endpointId,
    identity_basis: identityBasis
  })) as IdentityHash;
}

export function semanticHashFor(content: OpportunityContent) {
  const semanticContent = {
    organization: normalizedValue(content.organization.name),
    title: normalizedValue(content.title),
    recruitment_year: content.recruitment_year ?? null,
    recruitment_batch: content.recruitment_batch
      ? normalizedValue(content.recruitment_batch)
      : null,
    locations: content.locations.map(locationIdentityValue).sort(),
    description: content.description ? normalizedValue(content.description) : null,
    requirement_text: content.requirement_text
      ? normalizedValue(content.requirement_text)
      : null,
    published_on: content.published_on ?? null,
    deadline: content.application_window?.closes_on ?? null,
    announcement_locator: content.announcement_locator ?? null,
    application_locator: content.application_locator ?? null
  };
  return sha256(stableSerialize(semanticContent)) as SemanticHash;
}

function createOccurrence(
  endpoint: RecruitmentEndpoint,
  extractedRecord: ExtractedRecord,
  identityBasis: SourceOccurrenceIdentityBasis,
  identityHash: IdentityHash
): SourceOccurrence {
  return {
    source_occurrence_id: `source-occurrence:${identityHash}` as SourceOccurrenceId,
    source_definition_id: endpoint.source_definition_id,
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
    source_record_key: extractedRecord.raw_source_record_id,
    identity_basis: clone(identityBasis),
    identity_hash: identityHash,
    first_observed_at: extractedRecord.extraction.extracted_at
  };
}

function createVersion(
  occurrence: SourceOccurrence,
  normalized: NormalizedSourceRecord,
  extractedRecord: ExtractedRecord,
  semanticHash: SemanticHash,
  revision: number
): SourceOccurrenceVersion {
  return {
    source_occurrence_version_id: `source-occurrence-version:${occurrence.identity_hash}:${revision}` as SourceOccurrenceVersionId,
    source_occurrence_id: occurrence.source_occurrence_id,
    extracted_record_id: normalized.extracted_record_id,
    revision,
    semantic_hash: semanticHash,
    content: clone(normalized.content),
    first_observed_at: extractedRecord.extraction.extracted_at
  };
}

function recruitmentCycleFor(content: OpportunityContent) {
  const year = content.recruitment_year;
  const batch = content.recruitment_batch
    ? normalizedValue(content.recruitment_batch)
    : null;
  if (!year && !batch) return null;
  return `year:${year ?? "unknown"}|batch:${batch ?? "unknown"}`;
}

function locationIdentityValue(location: OpportunityContent["locations"][number]) {
  return location.city ?? location.district ?? location.province ?? location.country
    ?? location.raw_text.text;
}

function normalizedValue(value: TraceableText) {
  return value.normalized?.text ?? value.original.text;
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
