import { createHash } from "node:crypto";

import {
  SOURCE_OCCURRENCE_VERSION_V2_CONTRACT_VERSION,
  type ExtractedRecord,
  type ExtractedRecordV2,
  type IdentityEvidence,
  type IdentityHash,
  type MaterializedSourceOccurrenceVersion,
  type OpportunityContent,
  type RecruitmentEndpoint,
  type SemanticHash,
  type Snapshot,
  type SourceOccurrence,
  type SourceOccurrenceId,
  type SourceOccurrenceIdentityBasis,
  type SourceOccurrenceVersion,
  type SourceOccurrenceVersionId,
  type SourceOccurrenceVersionMaterialization,
  type TraceableText
} from "../domain";
import {
  isExtractedRecordV2,
  validateExtractedRecordV2
} from "./extracted-record-identity";
import {
  normalizeExtractedRecord,
  type NormalizedSourceRecord
} from "./source-record-normalizer";

export interface PreparedSourceOccurrenceMaterialization<
  RecordType extends ExtractedRecord = ExtractedRecord
> {
  readonly endpoint: RecruitmentEndpoint;
  readonly extracted_record: RecordType;
  readonly snapshot: Snapshot | null;
  readonly normalized: NormalizedSourceRecord;
  readonly identity_basis: SourceOccurrenceIdentityBasis;
  readonly identity_hash: IdentityHash;
}

type VersionFor<RecordType extends ExtractedRecord> =
  RecordType extends ExtractedRecordV2
    ? MaterializedSourceOccurrenceVersion
    : SourceOccurrenceVersion;

export interface SourceOccurrenceMaterializationResult<
  RecordType extends ExtractedRecord = ExtractedRecord
> {
  readonly occurrence: SourceOccurrence;
  readonly version: VersionFor<RecordType>;
  readonly occurrence_created: boolean;
  readonly version_created: boolean;
}

export class SourceOccurrenceMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceOccurrenceMaterializationError";
  }
}

export function prepareSourceOccurrenceMaterialization<
  RecordType extends ExtractedRecord
>(
  endpoint: RecruitmentEndpoint,
  extractedRecord: RecordType,
  snapshot?: Snapshot
): PreparedSourceOccurrenceMaterialization<RecordType> {
  requireExtractedRecordShape(extractedRecord);
  if (endpoint.source_definition_id !== extractedRecord.source_definition_id) {
    throw new SourceOccurrenceMaterializationError(
      "Endpoint and ExtractedRecord must belong to the same SourceDefinition"
    );
  }
  if (isExtractedRecordV2(extractedRecord)) {
    if (!snapshot) {
      throw new SourceOccurrenceMaterializationError(
        "ExtractedRecord V2 materialization requires its Snapshot"
      );
    }
    if (snapshot.recruitment_endpoint_id !== endpoint.recruitment_endpoint_id) {
      throw new SourceOccurrenceMaterializationError(
        "Snapshot and Endpoint must remain exactly bound"
      );
    }
    validateExtractedRecordV2(extractedRecord, snapshot);
  } else if (snapshot && extractedRecord.snapshot_id !== snapshot.snapshot_id) {
    throw new SourceOccurrenceMaterializationError(
      "Legacy ExtractedRecord and Snapshot must remain exactly bound"
    );
  }

  const normalized = normalizeExtractedRecord(extractedRecord);
  const identityBasis = buildIdentityBasis(normalized);
  return {
    endpoint,
    extracted_record: extractedRecord,
    snapshot: snapshot ?? null,
    normalized,
    identity_basis: identityBasis,
    identity_hash: identityHashFor(endpoint.recruitment_endpoint_id, identityBasis)
  };
}

export function materializeSourceOccurrenceVersion<
  RecordType extends ExtractedRecord
>(input: {
  readonly prepared: PreparedSourceOccurrenceMaterialization<RecordType>;
  readonly existing_occurrence: SourceOccurrence | null;
  readonly existing_versions: readonly SourceOccurrenceVersion[];
}): SourceOccurrenceMaterializationResult<RecordType> {
  const { prepared } = input;
  const occurrence = input.existing_occurrence
    ? validateExistingOccurrence(input.existing_occurrence, prepared)
    : createOccurrence(prepared);
  validateExistingVersions(input.existing_versions, occurrence);
  const materialization = isExtractedRecordV2(prepared.extracted_record)
      ? materializationFor(
        prepared as unknown as PreparedSourceOccurrenceMaterialization<ExtractedRecordV2>,
        prepared.extracted_record
      )
    : undefined;
  const semanticHash = sourceOccurrenceVersionSemanticHashFor({
    source_occurrence_id: occurrence.source_occurrence_id,
    content: prepared.normalized.content,
    ...(materialization ? { materialization } : {})
  });
  const existingVersion = input.existing_versions.find((version) => {
    return version.semantic_hash === semanticHash;
  });
  if (existingVersion) {
    if (
      isExtractedRecordV2(prepared.extracted_record)
      && isMaterializedSourceOccurrenceVersion(existingVersion)
      && existingVersion.extracted_record_id
        === prepared.extracted_record.extracted_record_id
      && prepared.snapshot
    ) {
      validateSourceOccurrenceVersionBinding({
        endpoint: prepared.endpoint,
        occurrence,
        version: existingVersion,
        extracted_record: prepared.extracted_record,
        snapshot: prepared.snapshot
      });
    }
    return {
      occurrence: clone(occurrence),
      version: clone(existingVersion) as VersionFor<RecordType>,
      occurrence_created: false,
      version_created: false
    };
  }

  const revision = input.existing_versions.reduce((maximum, version) => {
    return Math.max(maximum, version.revision);
  }, 0) + 1;
  const sourceOccurrenceVersionId = sourceOccurrenceVersionIdFor(
    occurrence.identity_hash,
    revision
  );
  const identityEvidence = canonicalIdentityEvidence(
    prepared.normalized.identity_evidence.map((evidence) => ({
      ...clone(evidence),
      source_occurrence_version_id: sourceOccurrenceVersionId
    }))
  );
  const baseVersion: SourceOccurrenceVersion = {
    source_occurrence_version_id: sourceOccurrenceVersionId,
    source_occurrence_id: occurrence.source_occurrence_id,
    extracted_record_id: prepared.normalized.extracted_record_id,
    revision,
    semantic_hash: semanticHash,
    content: clone(prepared.normalized.content),
    identity_evidence: identityEvidence,
    first_observed_at: prepared.extracted_record.extraction.extracted_at
  };
  const version = materialization
    ? { ...baseVersion, materialization }
    : baseVersion;
  if (
    isExtractedRecordV2(prepared.extracted_record)
    && isMaterializedSourceOccurrenceVersion(version)
    && prepared.snapshot
  ) {
    validateSourceOccurrenceVersionBinding({
      endpoint: prepared.endpoint,
      occurrence,
      version,
      extracted_record: prepared.extracted_record,
      snapshot: prepared.snapshot
    });
  }
  return {
    occurrence: clone(occurrence),
    version: clone(version) as VersionFor<RecordType>,
    occurrence_created: !input.existing_occurrence,
    version_created: true
  };
}

export function validateSourceOccurrenceVersionBinding(input: {
  readonly endpoint: RecruitmentEndpoint;
  readonly occurrence: SourceOccurrence;
  readonly version: MaterializedSourceOccurrenceVersion;
  readonly extracted_record: ExtractedRecordV2 | null;
  readonly snapshot: Snapshot;
}): MaterializedSourceOccurrenceVersion {
  if (!input.extracted_record) {
    throw new SourceOccurrenceMaterializationError(
      "ExtractedRecord is required for SOV binding validation"
    );
  }
  const prepared = prepareSourceOccurrenceMaterialization(
    input.endpoint,
    input.extracted_record,
    input.snapshot
  );
  validateExistingOccurrence(input.occurrence, prepared);
  const expectedVersionId = sourceOccurrenceVersionIdFor(
    input.occurrence.identity_hash,
    input.version.revision
  );
  if (input.version.source_occurrence_version_id !== expectedVersionId) {
    throw new SourceOccurrenceMaterializationError(
      "SOV ID does not match SourceOccurrence identity and revision"
    );
  }
  if (
    input.version.source_occurrence_id !== input.occurrence.source_occurrence_id
    || input.version.extracted_record_id !== input.extracted_record.extracted_record_id
  ) {
    throw new SourceOccurrenceMaterializationError(
      "SOV does not bind the supplied ExtractedRecord and SourceOccurrence"
    );
  }
  if (stableSerialize(input.version.content)
      !== stableSerialize(prepared.normalized.content)) {
    throw new SourceOccurrenceMaterializationError(
      "SOV content does not match its ExtractedRecord projection"
    );
  }
  validateMaterializationEnvelope(
    input.version.materialization,
    prepared,
    input.extracted_record
  );
  const expectedHash = sourceOccurrenceVersionSemanticHashFor(input.version);
  requireSha256(input.version.semantic_hash, "SOV semantic hash");
  if (input.version.semantic_hash !== expectedHash) {
    throw new SourceOccurrenceMaterializationError(
      "SOV semantic hash does not match canonical content"
    );
  }
  const expectedEvidence = canonicalIdentityEvidence(
    prepared.normalized.identity_evidence.map((evidence) => ({
      ...clone(evidence),
      source_occurrence_version_id: input.version.source_occurrence_version_id
    }))
  );
  for (const evidence of input.version.identity_evidence) {
    if (
      evidence.source_definition_id !== input.extracted_record.source_definition_id
      || evidence.snapshot_id !== input.extracted_record.snapshot_id
      || evidence.extracted_record_id !== input.extracted_record.extracted_record_id
      || evidence.source_occurrence_version_id
        !== input.version.source_occurrence_version_id
    ) {
      throw new SourceOccurrenceMaterializationError(
        "Identity Evidence provenance does not match the ExtractedRecord and SOV"
      );
    }
  }
  if (stableSerialize(canonicalIdentityEvidence(input.version.identity_evidence))
      !== stableSerialize(expectedEvidence)) {
    throw new SourceOccurrenceMaterializationError(
      "SOV Identity Evidence does not match its ExtractedRecord context evidence"
    );
  }
  const availableEvidence = new Set(
    input.version.identity_evidence.map((evidence) => evidence.identity_evidence_id)
  );
  for (const evidenceId of contextEvidenceIds(input.version.content)) {
    if (!availableEvidence.has(evidenceId)) {
      throw new SourceOccurrenceMaterializationError(
        "SOV RecruitmentContext references missing Identity Evidence"
      );
    }
  }
  return input.version;
}

export function sourceOccurrenceVersionSemanticHashFor(input: {
  readonly source_occurrence_id: SourceOccurrenceId;
  readonly content: OpportunityContent;
  readonly materialization?: SourceOccurrenceVersionMaterialization;
}): SemanticHash {
  if (!input.materialization) return semanticHashFor(input.content);
  return sha256(stableSerialize({
    contract_version: input.materialization.contract_version,
    source_occurrence_id: input.source_occurrence_id,
    content_semantic_hash: semanticHashFor(input.content),
    extractor_contract: {
      extractor_name: input.materialization.extractor_name,
      extractor_version: input.materialization.extractor_version,
      extractor_schema_version: input.materialization.extractor_schema_version
    }
  })) as SemanticHash;
}

export function buildIdentityBasis(
  normalized: NormalizedSourceRecord
): SourceOccurrenceIdentityBasis {
  const context = normalized.content.recruitment_context;
  if (context) {
    return {
      kind: "RECRUITMENT_CONTEXT",
      position_identity_key: context.position.identity_key
        ?? `unresolved-position:${normalized.source_local_record_key}`,
      recruitment_plan_identity_key: context.recruitment_plan.identity_key,
      recruitment_batch_identity_key:
        context.recruitment_batch.identity.identity_key,
      opportunity_identity_key: context.opportunity.identity_key,
      source_local_record_key: normalized.source_local_record_key
    };
  }
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
    throw new SourceOccurrenceMaterializationError(
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
    application_locator: content.application_locator ?? null,
    recruitment_context: semanticRecruitmentContext(content),
    organization_role_assignments:
      content.organization_role_assignments?.map((assignment) => ({
        role: assignment.role,
        organization_id: assignment.organization_id ?? null,
        identity_state: assignment.identity_state,
        raw_name: assignment.raw_name
          ? normalizedValue(assignment.raw_name)
          : null
      })) ?? [],
    location_assignments: content.location_assignments?.map((assignment) => ({
      role: assignment.role,
      assignment_mode: assignment.assignment_mode,
      locations: assignment.locations.map((location) => ({
        country: location.country ?? null,
        province: location.province ?? null,
        city: location.city ?? null,
        district: location.district ?? null,
        raw_text: location.raw_text.text,
        is_nationwide: location.is_nationwide,
        normalization_confidence: location.normalization_confidence
      })),
      identity_discriminator: assignment.identity_discriminator,
      identity_state: assignment.identity_state
    })) ?? [],
    headcount_observations: content.headcount_observations?.map((observation) => ({
      state: observation.state,
      raw_text: observation.raw_text?.text ?? null,
      normalized_count: observation.state === "EXACT"
        ? observation.normalized_count
        : null,
      shared_quota_reference: observation.state === "SHARED_QUOTA"
        ? observation.shared_quota_reference
        : null
    })) ?? [],
    recruitment_population_references:
      content.recruitment_population_references?.map((reference) => ({
        state: reference.state,
        raw_text: reference.raw_text?.text ?? null,
        population_kind: reference.population_kind ?? null,
        reference_date: reference.reference_date ?? null,
        recruitment_cycle: reference.recruitment_cycle
          ? normalizedValue(reference.recruitment_cycle)
          : null
      })) ?? [],
    recruitment_revision_relation_ids:
      [...(content.recruitment_revision_relation_ids ?? [])].sort()
  };
  return sha256(stableSerialize(semanticContent)) as SemanticHash;
}

function semanticRecruitmentContext(content: OpportunityContent) {
  const context = content.recruitment_context;
  if (!context) return null;
  const claim = (value: typeof context.position) => ({
    identity_state: value.identity_state,
    identity_key: value.identity_key,
    official_identifier: value.identity_state === "CONFIRMED"
      ? normalizedValue(value.official_identifier)
      : null,
    identifier_namespace: value.identity_state === "CONFIRMED"
      ? value.identifier_namespace
      : null,
    source_local_identifier: value.identity_state === "PROVISIONAL"
      ? normalizedValue(value.source_local_identifier)
      : null,
    raw_text: value.identity_state === "UNRESOLVED" && value.raw_text
      ? normalizedValue(value.raw_text)
      : null
  });
  return {
    announcement: claim(context.announcement),
    recruitment_plan: claim(context.recruitment_plan),
    recruitment_batch: {
      applicability: context.recruitment_batch.applicability,
      identity: claim(context.recruitment_batch.identity)
    },
    position: claim(context.position),
    opportunity: claim(context.opportunity)
  };
}

function materializationFor(
  prepared: PreparedSourceOccurrenceMaterialization<ExtractedRecordV2>,
  record: ExtractedRecordV2
): SourceOccurrenceVersionMaterialization {
  if (!prepared.snapshot || prepared.snapshot.transport_status !== "SUCCESS") {
    throw new SourceOccurrenceMaterializationError(
      "Materialized SOV requires a successful validated Snapshot"
    );
  }
  return {
    contract_version: SOURCE_OCCURRENCE_VERSION_V2_CONTRACT_VERSION,
    source_definition_id: record.source_definition_id,
    recruitment_endpoint_id: prepared.endpoint.recruitment_endpoint_id,
    snapshot_id: record.snapshot_id,
    snapshot_content_hash: record.snapshot_content_hash,
    extracted_record_semantic_hash: record.semantic_hash,
    observed_at: record.observed_at,
    extractor_name: record.extraction.extractor_name,
    extractor_version: record.extraction.extractor_version,
    extractor_schema_version: record.extraction.schema_version
  };
}

function validateMaterializationEnvelope(
  envelope: SourceOccurrenceVersionMaterialization,
  prepared: PreparedSourceOccurrenceMaterialization<ExtractedRecordV2>,
  record: ExtractedRecordV2
) {
  const expected = materializationFor(prepared, record);
  if (stableSerialize(envelope) !== stableSerialize(expected)) {
    throw new SourceOccurrenceMaterializationError(
      "SOV materialization provenance does not match its ExtractedRecord"
    );
  }
}

function createOccurrence(
  prepared: PreparedSourceOccurrenceMaterialization
): SourceOccurrence {
  return {
    source_occurrence_id: `source-occurrence:${prepared.identity_hash}` as SourceOccurrenceId,
    source_definition_id: prepared.endpoint.source_definition_id,
    recruitment_endpoint_id: prepared.endpoint.recruitment_endpoint_id,
    source_record_key: prepared.extracted_record.raw_source_record_id,
    identity_basis: clone(prepared.identity_basis),
    identity_hash: prepared.identity_hash,
    first_observed_at: prepared.extracted_record.extraction.extracted_at
  };
}

function validateExistingOccurrence(
  occurrence: SourceOccurrence,
  prepared: PreparedSourceOccurrenceMaterialization
) {
  const expected = createOccurrence(prepared);
  if (
    occurrence.source_occurrence_id !== expected.source_occurrence_id
    || occurrence.identity_hash !== expected.identity_hash
    || occurrence.source_definition_id !== expected.source_definition_id
    || occurrence.recruitment_endpoint_id !== expected.recruitment_endpoint_id
    || stableSerialize(occurrence.identity_basis)
      !== stableSerialize(expected.identity_basis)
  ) {
    throw new SourceOccurrenceMaterializationError(
      "Existing SourceOccurrence does not match the prepared identity"
    );
  }
  return occurrence;
}

function validateExistingVersions(
  versions: readonly SourceOccurrenceVersion[],
  occurrence: SourceOccurrence
) {
  const revisions = new Set<number>();
  for (const version of versions) {
    if (version.source_occurrence_id !== occurrence.source_occurrence_id) {
      throw new SourceOccurrenceMaterializationError(
        "Every existing SourceOccurrenceVersion must belong to the same SourceOccurrence"
      );
    }
    if (!Number.isInteger(version.revision) || version.revision <= 0
        || revisions.has(version.revision)) {
      throw new SourceOccurrenceMaterializationError(
        "Existing SourceOccurrenceVersion revisions must be positive and unique"
      );
    }
    revisions.add(version.revision);
    if (isMaterializedSourceOccurrenceVersion(version)) {
      try {
        validateExistingMaterializedVersionIntegrity(version, occurrence);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new SourceOccurrenceMaterializationError(
          `existing SOV integrity validation failed: ${message}`
        );
      }
    }
  }
}

function validateExistingMaterializedVersionIntegrity(
  version: MaterializedSourceOccurrenceVersion,
  occurrence: SourceOccurrence
) {
  if (version.source_occurrence_version_id
      !== sourceOccurrenceVersionIdFor(occurrence.identity_hash, version.revision)) {
    throw new SourceOccurrenceMaterializationError(
      "SOV ID does not match SourceOccurrence identity and revision"
    );
  }
  requireSha256(version.semantic_hash, "SOV semantic hash");
  requireSha256(
    version.materialization.snapshot_content_hash,
    "SOV Snapshot content hash"
  );
  requireSha256(
    version.materialization.extracted_record_semantic_hash,
    "SOV ExtractedRecord semantic hash"
  );
  if (
    version.materialization.source_definition_id !== occurrence.source_definition_id
    || version.materialization.recruitment_endpoint_id
      !== occurrence.recruitment_endpoint_id
  ) {
    throw new SourceOccurrenceMaterializationError(
      "SOV materialization source provenance does not match SourceOccurrence"
    );
  }
  if (version.semantic_hash !== sourceOccurrenceVersionSemanticHashFor(version)) {
    throw new SourceOccurrenceMaterializationError(
      "SOV semantic hash does not match canonical content"
    );
  }
  if (canonicalIdentityEvidence(version.identity_evidence).length
      !== version.identity_evidence.length) {
    throw new SourceOccurrenceMaterializationError(
      "SOV Identity Evidence must not contain duplicate identities"
    );
  }
  const evidenceIds = new Set(
    version.identity_evidence.map((evidence) => {
      if (evidence.source_occurrence_version_id
          !== version.source_occurrence_version_id) {
        throw new SourceOccurrenceMaterializationError(
          "SOV Identity Evidence must bind the actual SOV ID"
        );
      }
      return evidence.identity_evidence_id;
    })
  );
  if (contextEvidenceIds(version.content).some((evidenceId) => {
    return !evidenceIds.has(evidenceId);
  })) {
    throw new SourceOccurrenceMaterializationError(
      "SOV RecruitmentContext references missing Identity Evidence"
    );
  }
}

function isMaterializedSourceOccurrenceVersion(
  version: SourceOccurrenceVersion
): version is MaterializedSourceOccurrenceVersion {
  const materialization = (version as Partial<MaterializedSourceOccurrenceVersion>)
    .materialization;
  return materialization?.contract_version
    === SOURCE_OCCURRENCE_VERSION_V2_CONTRACT_VERSION;
}

function sourceOccurrenceVersionIdFor(identityHash: IdentityHash, revision: number) {
  if (!Number.isInteger(revision) || revision <= 0) {
    throw new SourceOccurrenceMaterializationError("SOV revision must be positive");
  }
  return `source-occurrence-version:${identityHash}:${revision}` as SourceOccurrenceVersionId;
}

function canonicalIdentityEvidence(evidence: readonly IdentityEvidence[]) {
  const byId = new Map(evidence.map((item) => [item.identity_evidence_id, item]));
  return [...byId.values()].sort((left, right) => {
    return left.identity_evidence_id.localeCompare(right.identity_evidence_id);
  });
}

function contextEvidenceIds(content: OpportunityContent) {
  const context = content.recruitment_context;
  if (!context) return [];
  return [
    ...context.announcement.identity_evidence_ids,
    ...context.recruitment_plan.identity_evidence_ids,
    ...context.recruitment_batch.identity.identity_evidence_ids,
    ...context.position.identity_evidence_ids,
    ...context.opportunity.identity_evidence_ids
  ];
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

function requireExtractedRecordShape(record: ExtractedRecord) {
  const candidate = record as Partial<ExtractedRecord>;
  if (
    !candidate
    || typeof candidate !== "object"
    || !candidate.extracted_record_id
    || !candidate.snapshot_id
    || !candidate.source_definition_id
    || !candidate.extraction
    || !Array.isArray(candidate.identity_candidates)
    || !Array.isArray(candidate.raw_location_text)
    || !candidate.source_record_locator
  ) {
    throw new SourceOccurrenceMaterializationError(
      "A valid ExtractedRecord is required to materialize a SOV"
    );
  }
}

function requireSha256(value: string, field: string) {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new SourceOccurrenceMaterializationError(
      `${field} must be a lowercase SHA-256 hash`
    );
  }
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

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}
