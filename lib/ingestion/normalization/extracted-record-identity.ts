import { createHash } from "node:crypto";

import {
  EXTRACTED_RECORD_V2_CONTRACT_VERSION,
  type ExtractedRecord,
  type ExtractedRecordId,
  type ExtractedRecordV2,
  type ExtractedRecordV2Input,
  type SemanticHash,
  type Snapshot
} from "../domain";

export class ExtractedRecordValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractedRecordValidationError";
  }
}

export function createExtractedRecordV2(
  snapshot: Snapshot,
  input: ExtractedRecordV2Input
): ExtractedRecordV2 {
  if (snapshot.transport_status !== "SUCCESS") {
    throw new ExtractedRecordValidationError(
      "ExtractedRecord V2 requires a successful Snapshot"
    );
  }
  const semanticHash = extractedRecordSemanticHashFor(input);
  const extractedRecordId = extractedRecordIdFor({
    source_definition_id: input.source_definition_id,
    snapshot_id: snapshot.snapshot_id,
    snapshot_content_hash: snapshot.content_hash,
    semantic_hash: semanticHash
  });
  const record: ExtractedRecordV2 = {
    ...structuredClone(input),
    contract_version: EXTRACTED_RECORD_V2_CONTRACT_VERSION,
    extracted_record_id: extractedRecordId,
    snapshot_id: snapshot.snapshot_id,
    snapshot_content_hash: snapshot.content_hash,
    observed_at: snapshot.observed_at,
    semantic_hash: semanticHash,
    extraction: {
      ...structuredClone(input.extraction),
      extracted_at: snapshot.observed_at
    }
  };
  validateExtractedRecordV2(record, snapshot);
  return deepFreeze(record);
}

export function extractedRecordSemanticHashFor(
  record: ExtractedRecordV2 | ExtractedRecordV2Input
): SemanticHash {
  requireNonEmpty(record.source_definition_id, "source_definition_id");
  requireNonEmpty(record.extraction?.extractor_name, "extractor_name");
  requireNonEmpty(record.extraction?.extractor_version, "extractor_version");
  requireNonEmpty(record.extraction?.schema_version, "schema_version");
  if (!Array.isArray(record.identity_candidates)) {
    throw new ExtractedRecordValidationError(
      "ExtractedRecord V2 requires identity_candidates"
    );
  }
  const canonical = {
    source_definition_id: record.source_definition_id,
    identity_candidates: uniqueSorted(record.identity_candidates),
    raw_source_record_id: record.raw_source_record_id ?? null,
    raw_title: record.raw_title ?? null,
    raw_organization_name: record.raw_organization_name ?? null,
    raw_location_text: uniqueSorted(record.raw_location_text ?? []),
    raw_description: record.raw_description ?? null,
    raw_requirement_text: record.raw_requirement_text ?? null,
    announcement_url: record.announcement_url ?? null,
    application_url: record.application_url ?? null,
    publish_time: record.publish_time ?? null,
    deadline: record.deadline ?? null,
    recruitment_year: record.recruitment_year ?? null,
    recruitment_batch: record.recruitment_batch ?? null,
    recruitment_context: record.recruitment_context ?? null,
    source_record_locator: record.source_record_locator ?? null,
    extraction_contract: {
      extractor_name: record.extraction.extractor_name.trim(),
      extractor_version: record.extraction.extractor_version.trim(),
      schema_version: record.extraction.schema_version.trim()
    }
  };
  return sha256(stableSerialize(canonical)) as SemanticHash;
}

export function validateExtractedRecordV2(
  record: ExtractedRecordV2,
  snapshot: Snapshot
): ExtractedRecordV2 {
  if (!isExtractedRecordV2(record)) {
    throw new ExtractedRecordValidationError(
      "ExtractedRecord V2 contract_version is required"
    );
  }
  if (snapshot.transport_status !== "SUCCESS") {
    throw new ExtractedRecordValidationError(
      "ExtractedRecord V2 requires a successful Snapshot"
    );
  }
  if (
    record.snapshot_id !== snapshot.snapshot_id
    || record.snapshot_content_hash !== snapshot.content_hash
    || record.observed_at !== snapshot.observed_at
    || record.extraction.extracted_at !== snapshot.observed_at
  ) {
    throw new ExtractedRecordValidationError(
      "ExtractedRecord V2 Snapshot provenance does not match"
    );
  }
  requireSha256(record.snapshot_content_hash, "Snapshot content hash");
  requireSha256(record.semantic_hash, "ExtractedRecord semantic hash");
  const expectedSemanticHash = extractedRecordSemanticHashFor(record);
  if (record.semantic_hash !== expectedSemanticHash) {
    throw new ExtractedRecordValidationError(
      "ExtractedRecord semantic hash does not match canonical content"
    );
  }
  const expectedId = extractedRecordIdFor({
    source_definition_id: record.source_definition_id,
    snapshot_id: record.snapshot_id,
    snapshot_content_hash: record.snapshot_content_hash,
    semantic_hash: record.semantic_hash
  });
  if (record.extracted_record_id !== expectedId) {
    throw new ExtractedRecordValidationError(
      "ExtractedRecord ID does not match canonical identity"
    );
  }
  return record;
}

export function isExtractedRecordV2(
  record: ExtractedRecord
): record is ExtractedRecordV2 {
  return (record as Partial<ExtractedRecordV2>).contract_version
    === EXTRACTED_RECORD_V2_CONTRACT_VERSION;
}

function extractedRecordIdFor(input: {
  readonly source_definition_id: string;
  readonly snapshot_id: string;
  readonly snapshot_content_hash: string;
  readonly semantic_hash: string;
}) {
  const identityHash = sha256(stableSerialize({
    contract_version: EXTRACTED_RECORD_V2_CONTRACT_VERSION,
    ...input
  }));
  return `extracted:v2:${identityHash}` as ExtractedRecordId;
}

function uniqueSorted(values: readonly unknown[]) {
  const canonical = values.map(stableSerialize);
  return [...new Set(canonical)].sort().map((value) => JSON.parse(value) as unknown);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => {
      return `${JSON.stringify(key)}:${stableSerialize(record[key])}`;
    }).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireNonEmpty(value: string | undefined, field: string) {
  if (!value?.trim()) {
    throw new ExtractedRecordValidationError(
      `ExtractedRecord V2 requires non-empty ${field}`
    );
  }
}

function requireSha256(value: string, field: string) {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throwMalformedField(field);
  }
}

function throwMalformedField(field: string): never {
  throw new ExtractedRecordValidationError(`${field} must be a lowercase SHA-256 hash`);
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
