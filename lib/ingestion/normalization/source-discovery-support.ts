import { createHash } from "node:crypto";
import type { ExtractedRecordV2, Snapshot, SourceOccurrenceVersionId, RecruitmentEndpoint } from "../domain";
import { canonicalHash, canonicalSerialize } from "./canonical-artifact-registry";
import { prepareSourceOccurrenceMaterialization, sourceOccurrenceVersionSemanticHashFor } from "./source-occurrence-materializer";
import { normalizeExtractedRecord, RECRUITMENT_CONTEXT_NORMALIZER_VERSION } from "./source-record-normalizer";
import type { TrustedSourceOccurrenceArtifact, TrustedSourceOccurrenceRole } from "./trusted-source-occurrence-registry";

export const SOV_DISCOVERY_SUPPORT_SCHEMA_VERSION = "trusted-sov-discovery-support/1.0.0" as const;
export type DiscoverySupportScope = "PRODUCTION" | "SYNTHETIC_TEST";
export interface DiscoverySourceReference {
  readonly artifact_id: string;
  readonly integrity_hash: string;
}
export interface SOVDiscoveryEvidence {
  readonly scope: DiscoverySupportScope;
  readonly endpoint: RecruitmentEndpoint;
  readonly snapshot: Snapshot;
  readonly extracted_record: ExtractedRecordV2;
  readonly raw_blob: { readonly raw_blob_id: string; readonly bytes: Uint8Array;
    readonly sha256: string; readonly byte_length: number; readonly content_type: string };
  readonly acquisition: { readonly acquisition_run_id: string; readonly status: string;
    readonly integrity_hash: string; readonly complete: boolean };
  readonly source_reference: { readonly source_definition: DiscoverySourceReference;
    readonly endpoint: DiscoverySourceReference; readonly admission: DiscoverySourceReference;
    readonly allowlist: DiscoverySourceReference; readonly authority_level: "OFFICIAL" | "AUTHORIZED" };
}
export interface SOVDiscoverySupportCommand {
  readonly schema_version: typeof SOV_DISCOVERY_SUPPORT_SCHEMA_VERSION;
  readonly sov_id: SourceOccurrenceVersionId;
  readonly snapshot_id: Snapshot["snapshot_id"];
  readonly extracted_record_id: ExtractedRecordV2["extracted_record_id"];
  readonly source_role: TrustedSourceOccurrenceRole;
}
export interface SOVDiscoverySupport {
  readonly schema_version: typeof SOV_DISCOVERY_SUPPORT_SCHEMA_VERSION;
  readonly support_id: string;
  readonly scope: DiscoverySupportScope;
  readonly source_role: TrustedSourceOccurrenceRole;
  readonly source_reference: SOVDiscoveryEvidence["source_reference"];
  readonly target: { readonly source_definition_id: string; readonly endpoint_id: string;
    readonly source_occurrence_id: string; readonly occurrence_identity_hash: string;
    readonly occurrence_identity_basis_hash: string; readonly sov_id: SourceOccurrenceVersionId;
    readonly sov_revision: number; readonly sov_semantic_hash: string; readonly original_sov_artifact_seal: string };
  readonly discovery: { readonly acquisition_run_id: string; readonly acquisition_integrity_hash: string;
    readonly snapshot_id: Snapshot["snapshot_id"]; readonly snapshot_canonical_hash: string;
    readonly extracted_record_id: ExtractedRecordV2["extracted_record_id"];
    readonly extracted_record_canonical_hash: string; readonly extracted_record_semantic_hash: string;
    readonly raw_blob_id: string; readonly raw_sha256: string; readonly byte_length: number;
    readonly content_type: string; readonly observed_at: string; readonly exact_locator: string;
    readonly source_local_record_key: string };
  readonly equivalence: { readonly verification_contract_version: typeof SOV_DISCOVERY_SUPPORT_SCHEMA_VERSION;
    readonly extraction_contract_descriptor: { readonly adapter_key: string; readonly extractor_name: string;
      readonly extractor_version: string; readonly schema_version: string; readonly normalizer_version: string };
    readonly normalized_descriptor_hash: string; readonly identity_evidence_descriptor_hash: string;
    readonly reference_original_descriptor_hash: string; readonly result: "VERIFIED_IDENTICAL" };
  readonly integrity_hash: string;
}
export class SOVDiscoverySupportError extends Error {
  constructor(readonly code: "REVIEW_REQUIRED" | "EVIDENCE_BLOCKED" | "INTEGRITY_FAILURE" | "STALE_SUPPORT_WRITER", message: string) {
    super(message); this.name = "SOVDiscoverySupportError";
  }
}

export function validateDiscoveryEvidence(evidence: SOVDiscoveryEvidence, scope: DiscoverySupportScope) {
  const extractionKeys = new Set(["extractor_name", "extractor_version", "schema_version", "extracted_at"]);
  if (Object.keys(evidence.extracted_record.extraction).some((key) => !extractionKeys.has(key))) {
    throw new SOVDiscoverySupportError("REVIEW_REQUIRED", "Unproven parser/adapter contract extension");
  }
  if (evidence.scope !== scope || evidence.acquisition.status !== "SUCCESS" || !evidence.acquisition.complete
      || evidence.snapshot.transport_status !== "SUCCESS") {
    throw new SOVDiscoverySupportError("EVIDENCE_BLOCKED", "Discovery scope, acquisition or extraction completeness is invalid");
  }
  const raw = evidence.raw_blob;
  const hash = createHash("sha256").update(raw.bytes).digest("hex");
  if (hash !== raw.sha256 || raw.bytes.byteLength !== raw.byte_length
      || raw.raw_blob_id !== `sha256:${hash}` || evidence.snapshot.raw_blob_id !== raw.raw_blob_id
      || evidence.snapshot.content_hash !== hash || evidence.snapshot.content_length !== raw.byte_length
      || evidence.snapshot.response_metadata.mime_type !== raw.content_type) {
    throw new SOVDiscoverySupportError("EVIDENCE_BLOCKED", "Discovery RawBlob bytes/hash/length/Snapshot binding mismatch");
  }
  if (!["OFFICIAL", "AUTHORIZED"].includes(evidence.source_reference.authority_level)
      || !evidence.acquisition.acquisition_run_id.trim()
      || !/^[a-f0-9]{64}$/.test(evidence.acquisition.integrity_hash)) {
    throw new SOVDiscoverySupportError("EVIDENCE_BLOCKED", "Discovery authority or acquisition integrity proof is missing");
  }
  for (const reference of [evidence.source_reference.source_definition, evidence.source_reference.endpoint,
    evidence.source_reference.admission, evidence.source_reference.allowlist]) {
    if (!reference.artifact_id.trim() || !/^[a-f0-9]{64}$/.test(reference.integrity_hash)) {
      throw new SOVDiscoverySupportError("EVIDENCE_BLOCKED", "Discovery persistent source references are missing");
    }
  }
  return prepareSourceOccurrenceMaterialization(evidence.endpoint, evidence.extracted_record, evidence.snapshot);
}

export function validatedDiscoverySupport(original: TrustedSourceOccurrenceArtifact, first: SOVDiscoveryEvidence,
  next: SOVDiscoveryEvidence, scope: DiscoverySupportScope): SOVDiscoverySupport {
  const originalPrepared = validateDiscoveryEvidence(first, scope);
  const prepared = validateDiscoveryEvidence(next, scope);
  same(first.endpoint, original.endpoint, "Original endpoint proof");
  same(first.snapshot, original.snapshot, "Original Snapshot proof");
  same(first.extracted_record, original.extracted_record, "Original ExtractedRecord proof");
  same(next.endpoint, original.endpoint, "Source/endpoint contract");
  same(first.source_reference, next.source_reference, "Source/admission/authority references");
  same(originalPrepared.identity_basis, original.occurrence.identity_basis, "Original occurrence identity");
  same(prepared.identity_basis, original.occurrence.identity_basis, "SourceOccurrence identity");
  same(prepared.identity_hash, original.occurrence.identity_hash, "SourceOccurrence hash");
  same(first.raw_blob.sha256, next.raw_blob.sha256, "Raw changed; identical normalized text is not sufficient");
  same(first.raw_blob.content_type, next.raw_blob.content_type, "Raw content type");
  same(first.snapshot.request_metadata.locator, next.snapshot.request_metadata.locator, "Acquisition locator");
  same(first.snapshot.request_metadata.method, next.snapshot.request_metadata.method, "Acquisition method");
  same(first.snapshot.request_metadata.parameters, next.snapshot.request_metadata.parameters, "Acquisition parameters");
  const versionHeaders = (evidence: SOVDiscoveryEvidence) => Object.fromEntries(
    Object.entries(evidence.snapshot.response_metadata.headers).filter(([name]) => name.toLowerCase() !== "date")
  );
  same(versionHeaders(first), versionHeaders(next), "Response revision/authority headers");
  if (!Buffer.from(first.raw_blob.bytes).equals(Buffer.from(next.raw_blob.bytes))) {
    throw new SOVDiscoverySupportError("REVIEW_REQUIRED", "Raw bytes mismatch; support reuse rejected");
  }
  same(extractionDescriptor(first), extractionDescriptor(next), "Parser/adapter/extraction contract");
  same(first.extracted_record.semantic_hash, next.extracted_record.semantic_hash, "ExtractedRecord semantic payload");
  same(first.extracted_record.source_record_locator, next.extracted_record.source_record_locator, "Exact record locator");
  same(extractionPayload(first.extracted_record), extractionPayload(next.extracted_record), "Opaque event-independent extraction payload");
  same(originalPrepared.normalized.source_local_record_key, prepared.normalized.source_local_record_key, "Source-local identity");
  const originalDescriptor = descriptor(first.extracted_record);
  const nextDescriptor = descriptor(next.extracted_record);
  same(originalDescriptor, nextDescriptor, "Complete normalized payload/identity evidence/effective semantics");
  const semanticHash = sourceOccurrenceVersionSemanticHashFor({ source_occurrence_id: original.occurrence.source_occurrence_id,
    content: prepared.normalized.content, materialization: original.version.materialization });
  same(semanticHash, original.version.semantic_hash, "SOV semantic hash");
  const payload = {
    schema_version: SOV_DISCOVERY_SUPPORT_SCHEMA_VERSION, scope, source_role: original.source_role,
    source_reference: structuredClone(next.source_reference),
    target: { source_definition_id: original.endpoint.source_definition_id,
      endpoint_id: original.endpoint.recruitment_endpoint_id, source_occurrence_id: original.occurrence.source_occurrence_id,
      occurrence_identity_hash: original.occurrence.identity_hash,
      occurrence_identity_basis_hash: canonicalHash(original.occurrence.identity_basis),
      sov_id: original.version.source_occurrence_version_id, sov_revision: original.version.revision,
      sov_semantic_hash: original.version.semantic_hash, original_sov_artifact_seal: canonicalHash(original) },
    discovery: { acquisition_run_id: next.acquisition.acquisition_run_id,
      acquisition_integrity_hash: next.acquisition.integrity_hash,
      snapshot_id: next.snapshot.snapshot_id, snapshot_canonical_hash: canonicalHash(next.snapshot),
      extracted_record_id: next.extracted_record.extracted_record_id, extracted_record_canonical_hash: canonicalHash(next.extracted_record),
      extracted_record_semantic_hash: next.extracted_record.semantic_hash, raw_blob_id: next.raw_blob.raw_blob_id,
      raw_sha256: next.raw_blob.sha256, byte_length: next.raw_blob.byte_length, content_type: next.raw_blob.content_type,
      observed_at: next.snapshot.observed_at, exact_locator: next.snapshot.request_metadata.locator,
      source_local_record_key: prepared.normalized.source_local_record_key },
    equivalence: { verification_contract_version: SOV_DISCOVERY_SUPPORT_SCHEMA_VERSION,
      extraction_contract_descriptor: extractionDescriptor(next), normalized_descriptor_hash: canonicalHash(nextDescriptor.content),
      identity_evidence_descriptor_hash: canonicalHash(nextDescriptor.evidence),
      reference_original_descriptor_hash: canonicalHash(originalDescriptor.content), result: "VERIFIED_IDENTICAL" as const }
  };
  const withId = { ...payload, support_id: discoverySupportId(payload) };
  return assertSOVDiscoverySupportIntegrity({ ...withId, integrity_hash: canonicalHash(withId) });
}

export function assertSOVDiscoverySupportIntegrity(support: SOVDiscoverySupport) {
  const { integrity_hash: integrityHash, ...payload } = support;
  if (support.schema_version !== SOV_DISCOVERY_SUPPORT_SCHEMA_VERSION
      || support.equivalence.verification_contract_version !== SOV_DISCOVERY_SUPPORT_SCHEMA_VERSION
      || support.equivalence.result !== "VERIFIED_IDENTICAL"
      || !["PRODUCTION", "SYNTHETIC_TEST"].includes(support.scope)
      || support.support_id !== discoverySupportId(support) || integrityHash !== canonicalHash(payload)) {
    throw new SOVDiscoverySupportError("INTEGRITY_FAILURE", "Discovery support ID/contract/integrity mismatch");
  }
  return structuredClone(support);
}
function discoverySupportId(support: Omit<SOVDiscoverySupport, "support_id" | "integrity_hash">) {
  return `sov-discovery-support:${canonicalHash({ schema_version: support.schema_version, scope: support.scope,
    source_definition_id: support.target.source_definition_id, endpoint_id: support.target.endpoint_id,
    occurrence_id: support.target.source_occurrence_id, sov_id: support.target.sov_id,
    snapshot_id: support.discovery.snapshot_id, extracted_record_id: support.discovery.extracted_record_id })}`;
}
function extractionDescriptor(evidence: SOVDiscoveryEvidence) {
  return { adapter_key: evidence.endpoint.adapter_key, extractor_name: evidence.extracted_record.extraction.extractor_name,
    extractor_version: evidence.extracted_record.extraction.extractor_version,
    schema_version: evidence.extracted_record.extraction.schema_version, normalizer_version: RECRUITMENT_CONTEXT_NORMALIZER_VERSION };
}
function extractionPayload(record: ExtractedRecordV2) {
  const { extracted_record_id, snapshot_id, snapshot_content_hash, observed_at, extraction, ...payload } = record;
  return { ...payload, extraction: { extractor_name: extraction.extractor_name,
    extractor_version: extraction.extractor_version, schema_version: extraction.schema_version } };
}
function descriptor(record: ExtractedRecordV2) {
  const normalized = normalizeExtractedRecord(record);
  const evidence = normalized.identity_evidence.map((item) => ({ entity_kind: item.entity_kind, locator: item.locator,
    observed_value: item.observed_value ?? null, normalized_value: item.normalized_value ?? null,
    certainty: item.certainty, decision: item.decision, resolver_version: item.resolver_version }));
  const content = structuredClone(normalized.content);
  const allowed = new Set(["organization", "title", "description", "requirement_text", "locations", "recruitment_year",
    "recruitment_batch", "published_on", "application_window", "announcement_locator", "application_locator",
    "recruitment_context", "organization_role_assignments", "location_assignments", "headcount_observations",
    "recruitment_population_references", "recruitment_revision_relation_ids"]);
  if (Object.keys(content).some((key) => !allowed.has(key))) {
    throw new SOVDiscoverySupportError("REVIEW_REQUIRED", "Unsupported normalized descriptor field");
  }
  const context = content.recruitment_context;
  if (context) {
    const claims = [context.announcement, context.recruitment_plan, context.recruitment_batch.identity, context.position, context.opportunity];
    for (const claim of claims) {
      const descriptors = claim.identity_evidence_ids.map((id) => {
        const index = normalized.identity_evidence.findIndex((item) => item.identity_evidence_id === id);
        if (index < 0) throw new SOVDiscoverySupportError("EVIDENCE_BLOCKED", "Unresolved identity evidence descriptor");
        return canonicalHash(evidence[index]);
      });
      Object.assign(claim, { identity_evidence_ids: descriptors });
    }
  }
  return { content, evidence };
}
function same(first: unknown, next: unknown, label: string) {
  if (canonicalSerialize(first) !== canonicalSerialize(next)) {
    throw new SOVDiscoverySupportError("REVIEW_REQUIRED", `${label} mismatch; support reuse rejected`);
  }
}
