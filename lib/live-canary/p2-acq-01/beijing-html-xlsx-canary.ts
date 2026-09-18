import { createHash, randomUUID } from "node:crypto";

import type { HttpTransportRequest } from "../../collection-runtime";
import {
  SOURCE_COMPOSITION_SCHEMA_VERSION,
  UTF8_TEXT_ENCODING,
  createExtractedRecordV2,
  createTrustedArtifactChain,
  InMemoryPositionBoundOpportunityTracker,
  InMemoryPositionVersionTracker,
  InMemoryRawBlobRepository,
  InMemorySnapshotRepository,
  InMemoryTrustedSourceOccurrenceTracker,
  RawCaptureService,
  resolvePositionIdentity,
  type AttachmentPublicationBinding,
  type AttachmentPublicationBindingId,
  type AttachmentToPositionBinding,
  type AttachmentToPositionBindingId,
  type AuthorityAssertionId,
  type DiscoveryBoundaryId,
  type ExpectedSurfaceManifestEntryId,
  type ExtractedRecord,
  type ExtractedRecordV2,
  type IsoDateTime,
  type OpportunityVersionId,
  type Position,
  type PositionBoundOpportunityVersion,
  type PositionIdentityResolutionInput,
  type PositionVersion,
  type RawBlob,
  type RawBlobId,
  type RawContentSha256,
  type RecruitmentEndpoint,
  type Snapshot,
  type SnapshotId,
  type SourceCompositionEvidenceId,
  type SourceCompositionInput,
  type SourceCompositionResult,
  type SourcePackageInventoryId,
  type SourcePrecedenceDecisionId,
  type SourceSurface,
  type SourceSurfaceBinding,
  type SourceSurfaceBindingId,
  type SourceSurfaceId,
  type SourceVersionSelectionId,
  type TrustedSourceOccurrenceArtifact
} from "../../ingestion";
import {
  BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_SOURCE_DEFINITION_ID
} from "../p2-04d/beijing-public-institution-detail-live-canary";
import { BeijingPublicInstitutionDetailHtmlAdapter } from "../p2-04d/beijing-public-institution-detail-html-adapter";
import {
  BEIJING_ATTACHMENT_ENDPOINT,
  BEIJING_ATTACHMENT_EXPECTED_MIME,
  BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID,
  BEIJING_ATTACHMENT_SOURCE_DEFINITION_ID
} from "../p2-04e/beijing-public-institution-attachment-contract";
import {
  BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_ADAPTER_KEY,
  BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION,
  BEIJING_PUBLIC_INSTITUTION_XLSX_RAW_SHA256,
  BEIJING_PUBLIC_INSTITUTION_XLSX_SNAPSHOT_ID,
  BeijingPublicInstitutionXlsxJobTableAdapter
} from "../p2-04e/beijing-public-institution-xlsx-job-table-adapter";
import {
  P2_ACQ_01_HTML_TIMEOUT_MS,
  P2_ACQ_01_NETWORK_POLICY,
  P2Acq01ApprovedOfficialCanaryTransport
} from "./approved-official-canary-transport";

export const P2_ACQ_01_CANARY_VERSION = "p2-acq-01/1.0.0";
export const P2_ACQ_01_DOCX_ENDPOINT =
  "https://www.beijing.gov.cn/gongkai/rsxx/sydwzp/202606/P020260625349755579014.docx";
export const P2_ACQ_01_SCOPE = {
  canary_kind: "TECHNICAL_CANARY",
  recruitment_year: 2026,
  recruitment_domain: "MEDICAL",
  admitted_to_2027_law_dataset: false,
  admitted_to_candidate_recommendation: false
} as const;

export type CanaryAttachmentAcquisitionStatus =
  | "ACQUIRED"
  | "ATTACHMENT_NOT_ACQUIRED";
export type CanaryAttachmentParsingStatus =
  | "PARSING_SUPPORTED"
  | "PARSING_UNSUPPORTED";

export interface P2Acq01AttachmentInventoryEntry {
  readonly index: 1 | 2;
  readonly title: string;
  readonly locator: string;
  readonly owner_announcement_locator: typeof BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT;
  readonly acquisition_status: CanaryAttachmentAcquisitionStatus;
  readonly parsing_status: CanaryAttachmentParsingStatus;
  readonly raw_blob_id: RawBlobId | null;
  readonly snapshot_id: SnapshotId | null;
  readonly evidence_state: "CLOSED" | "EVIDENCE_BLOCKED";
}

export interface P2Acq01ArchivedXlsxInput {
  readonly bytes: Uint8Array;
  readonly snapshot: Snapshot;
}

export interface P2Acq01PositionChain {
  readonly extracted_record: ExtractedRecordV2;
  readonly source_occurrence: TrustedSourceOccurrenceArtifact;
  readonly position: Position;
  readonly position_version: PositionVersion;
  readonly opportunity_version: PositionBoundOpportunityVersion;
  readonly source_composition: SourceCompositionResult;
}

export interface P2Acq01CanaryResult {
  readonly canary_status: "CANARY_PARTIAL" | "ACQUISITION_FAILED";
  readonly evidence_status: "EVIDENCE_BLOCKED" | "REVIEW_REQUIRED";
  readonly scope: typeof P2_ACQ_01_SCOPE;
  readonly network_policy: typeof P2_ACQ_01_NETWORK_POLICY;
  readonly network_calls: 1;
  readonly request: HttpTransportRequest;
  readonly html_raw: RawBlob | null;
  readonly html_snapshot: Snapshot;
  readonly html_extracted_record: ExtractedRecordV2 | null;
  readonly package_source_occurrence: TrustedSourceOccurrenceArtifact | null;
  readonly xlsx_raw: RawBlob | null;
  readonly xlsx_snapshot: Snapshot | null;
  readonly xlsx_extracted_records: readonly ExtractedRecord[];
  readonly attachment_inventory: readonly P2Acq01AttachmentInventoryEntry[];
  readonly position_chains: readonly P2Acq01PositionChain[];
  readonly blockers: readonly string[];
  readonly downstream: {
    readonly requirement_projection_created: false;
    readonly requirement_set_version_created: false;
    readonly predicate_resolution_created: false;
    readonly eligibility_assessment_created: false;
  };
}

interface HtmlAttachmentReference {
  readonly text: string;
  readonly raw_locator: string;
  readonly locator: string;
}

interface XlsxRecordMetadata {
  readonly sheet: string;
  readonly row_number: number;
  readonly row_range: string;
  readonly fields: Readonly<Record<string, {
    readonly cell: string;
    readonly field_path: string;
  }>>;
}

export class P2Acq01CanaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "P2Acq01CanaryError";
  }
}

export async function runP2Acq01BeijingHtmlXlsxCanary(input: {
  readonly transport: P2Acq01ApprovedOfficialCanaryTransport;
  readonly requested_at: IsoDateTime;
  readonly archived_xlsx: P2Acq01ArchivedXlsxInput;
}): Promise<P2Acq01CanaryResult> {
  const htmlEndpoint = createHtmlEndpoint();
  const request: HttpTransportRequest = {
    recruitment_endpoint_id: htmlEndpoint.recruitment_endpoint_id,
    locator: htmlEndpoint.locator,
    method: "GET",
    requested_at: input.requested_at,
    headers: {},
    parameters: {},
    timeout_ms: P2_ACQ_01_HTML_TIMEOUT_MS
  };
  const rawRepository = new InMemoryRawBlobRepository();
  const snapshotRepository = new InMemorySnapshotRepository();
  const capture = new RawCaptureService(rawRepository, snapshotRepository, {
    create_snapshot_id: () => `p2-acq-01-html-snapshot:${randomUUID()}` as SnapshotId
  });
  const transportResult = await input.transport.execute(request);
  const captured = capture.record(request, transportResult.response);
  if (!captured.raw_blob) {
    return frozen({
      canary_status: "ACQUISITION_FAILED",
      evidence_status: "REVIEW_REQUIRED",
      scope: P2_ACQ_01_SCOPE,
      network_policy: P2_ACQ_01_NETWORK_POLICY,
      network_calls: 1,
      request,
      html_raw: null,
      html_snapshot: captured.snapshot,
      html_extracted_record: null,
      package_source_occurrence: null,
      xlsx_raw: null,
      xlsx_snapshot: null,
      xlsx_extracted_records: [],
      attachment_inventory: [],
      position_chains: [],
      blockers: ["ACQUISITION_FAILED"],
      downstream: downstreamBoundary()
    });
  }

  const htmlLegacyRecord = new BeijingPublicInstitutionDetailHtmlAdapter().extract({
    endpoint: htmlEndpoint,
    snapshot: captured.snapshot,
    raw_blob: captured.raw_blob
  })[0];
  if (!htmlLegacyRecord) {
    throw new P2Acq01CanaryError("Official HTML produced no ExtractedRecord");
  }
  const htmlRecord = packageRecordV2(htmlLegacyRecord, captured.snapshot);
  const archivedXlsx = sealArchivedXlsx(input.archived_xlsx);
  const attachmentInventory = attachmentInventoryFor(
    htmlRecord,
    archivedXlsx.raw_blob,
    archivedXlsx.snapshot
  );
  const xlsxEndpoint = createXlsxEndpoint();
  const xlsxParsed = new BeijingPublicInstitutionXlsxJobTableAdapter().parse({
    endpoint: xlsxEndpoint,
    snapshot: archivedXlsx.snapshot,
    raw_blob: archivedXlsx.raw_blob
  });

  const sourceTracker = new InMemoryTrustedSourceOccurrenceTracker();
  const packageSource = sourceTracker.process({
    source_role: "PACKAGE",
    endpoint: htmlEndpoint,
    extracted_record: htmlRecord,
    snapshot: captured.snapshot
  });
  const positionVersionTracker = new InMemoryPositionVersionTracker();
  const pbovTracker = new InMemoryPositionBoundOpportunityTracker(positionVersionTracker);
  const trustedChain = createTrustedArtifactChain(pbovTracker, sourceTracker);
  const positionChains: P2Acq01PositionChain[] = [];

  for (const legacyRecord of xlsxParsed.records) {
    const extractedRecord = positionRecordV2(legacyRecord, archivedXlsx.snapshot);
    const source = sourceTracker.process({
      source_role: "POSITION_BEARING",
      endpoint: xlsxEndpoint,
      extracted_record: extractedRecord,
      snapshot: archivedXlsx.snapshot
    });
    const identityInput = identitySource(source);
    const identityResolution = resolvePositionIdentity(identityInput);
    if (identityResolution.status !== "RESOLVED") {
      continue;
    }
    const position = identityResolution.position;
    if (position.identity_basis.kind !== "SOURCE_LOCAL_RECORD"
        || position.identity_state !== "PROVISIONAL") {
      throw new P2Acq01CanaryError(
        "Canary Position must remain SOURCE_LOCAL_RECORD + PROVISIONAL"
      );
    }
    const positionVersion = positionVersionTracker.process({
      position,
      sources: [identityInput]
    }).position_version;
    const opportunityVersion = pbovTracker.process({
      position,
      position_version: positionVersion,
      sources: [identityInput]
    }).opportunity_version;
    const composition = trustedChain.source_compositions.materialize({
      opportunity_version_id: opportunityVersion.opportunity_version_id,
      composition_input: buildCompositionInput({
        package_source: packageSource,
        position_source: source,
        position_version: positionVersion,
        opportunity_version: opportunityVersion,
        attachment_inventory: attachmentInventory
      })
    });
    if (composition.status === "COMPLETE") {
      throw new P2Acq01CanaryError(
        "Unacquired DOCX evidence must prevent COMPLETE SourceComposition"
      );
    }
    positionChains.push({
      extracted_record: extractedRecord,
      source_occurrence: source,
      position,
      position_version: positionVersion,
      opportunity_version: opportunityVersion,
      source_composition: composition
    });
  }

  return frozen({
    canary_status: "CANARY_PARTIAL",
    evidence_status: "EVIDENCE_BLOCKED",
    scope: P2_ACQ_01_SCOPE,
    network_policy: P2_ACQ_01_NETWORK_POLICY,
    network_calls: 1,
    request,
    html_raw: captured.raw_blob,
    html_snapshot: captured.snapshot,
    html_extracted_record: htmlRecord,
    package_source_occurrence: packageSource,
    xlsx_raw: archivedXlsx.raw_blob,
    xlsx_snapshot: archivedXlsx.snapshot,
    xlsx_extracted_records: xlsxParsed.records,
    attachment_inventory: attachmentInventory,
    position_chains: positionChains,
    blockers: [
      "DOCX_ATTACHMENT_NOT_ACQUIRED",
      "DOCX_PARSING_UNSUPPORTED",
      "SOURCE_COMPOSITION_UNRESOLVED",
      "REQUIREMENT_PROJECTION_BLOCKED"
    ],
    downstream: downstreamBoundary()
  });
}

function sealArchivedXlsx(input: P2Acq01ArchivedXlsxInput) {
  const hash = sha256(input.bytes);
  if (hash !== BEIJING_PUBLIC_INSTITUTION_XLSX_RAW_SHA256
      || input.snapshot.snapshot_id !== BEIJING_PUBLIC_INSTITUTION_XLSX_SNAPSHOT_ID
      || input.snapshot.recruitment_endpoint_id !== BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID
      || input.snapshot.request_metadata.locator !== BEIJING_ATTACHMENT_ENDPOINT
      || input.snapshot.content_hash !== hash
      || input.snapshot.content_length !== input.bytes.byteLength
      || input.snapshot.transport_status !== "SUCCESS") {
    throw new P2Acq01CanaryError("Archived XLSX Raw/Snapshot provenance is not sealed");
  }
  const rawRepository = new InMemoryRawBlobRepository();
  const snapshotRepository = new InMemorySnapshotRepository();
  const rawBlob = rawRepository.append({
    raw_blob_id: `sha256:${hash}` as RawBlobId,
    bytes: new Uint8Array(input.bytes),
    raw_content_sha256: hash as RawContentSha256,
    mime_type: BEIJING_ATTACHMENT_EXPECTED_MIME,
    byte_length: input.bytes.byteLength,
    created_at: input.snapshot.observed_at
  });
  const snapshot = snapshotRepository.append(structuredClone(input.snapshot));
  return { raw_blob: rawBlob, snapshot };
}

function attachmentInventoryFor(
  htmlRecord: ExtractedRecordV2,
  xlsxRaw: RawBlob,
  xlsxSnapshot: Snapshot
): readonly P2Acq01AttachmentInventoryEntry[] {
  const metadata = htmlRecord.adapter_metadata[
    BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY
  ] as { readonly attachment_references?: readonly HtmlAttachmentReference[] } | undefined;
  const references = metadata?.attachment_references ?? [];
  const byLocator = new Map(references.map((reference) => [reference.locator, reference]));
  const xlsx = byLocator.get(BEIJING_ATTACHMENT_ENDPOINT);
  const docx = byLocator.get(P2_ACQ_01_DOCX_ENDPOINT);
  if (!xlsx || !docx || references.some((reference) => {
    const locator = new URL(reference.locator);
    return locator.origin !== new URL(BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT).origin;
  })) {
    throw new P2Acq01CanaryError(
      "Attachment ownership does not match the captured official announcement"
    );
  }
  return frozen([{
    index: 1,
    title: xlsx.text,
    locator: xlsx.locator,
    owner_announcement_locator: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
    acquisition_status: "ACQUIRED",
    parsing_status: "PARSING_SUPPORTED",
    raw_blob_id: xlsxRaw.raw_blob_id,
    snapshot_id: xlsxSnapshot.snapshot_id,
    evidence_state: "CLOSED"
  }, {
    index: 2,
    title: docx.text,
    locator: docx.locator,
    owner_announcement_locator: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
    acquisition_status: "ATTACHMENT_NOT_ACQUIRED",
    parsing_status: "PARSING_UNSUPPORTED",
    raw_blob_id: null,
    snapshot_id: null,
    evidence_state: "EVIDENCE_BLOCKED"
  }]);
}

function packageRecordV2(record: ExtractedRecord, snapshot: Snapshot) {
  return createExtractedRecordV2(snapshot, {
    source_definition_id: record.source_definition_id,
    identity_candidates: record.identity_candidates,
    raw_source_record_id: record.announcement_url,
    raw_title: record.raw_title,
    raw_organization_name: record.raw_organization_name,
    raw_location_text: record.raw_location_text,
    raw_description: record.raw_description,
    raw_requirement_text: record.raw_requirement_text,
    announcement_url: record.announcement_url,
    publish_time: record.publish_time,
    recruitment_year: record.recruitment_year,
    recruitment_batch: record.recruitment_batch,
    source_record_locator: record.source_record_locator,
    adapter_metadata: record.adapter_metadata,
    extraction: {
      extractor_name: record.extraction.extractor_name,
      extractor_version: record.extraction.extractor_version,
      schema_version: "p2-acq-01-beijing-announcement/1.0.0"
    }
  });
}

function positionRecordV2(record: ExtractedRecord, snapshot: Snapshot) {
  const metadata = record.adapter_metadata[
    BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_ADAPTER_KEY
  ] as unknown as XlsxRecordMetadata;
  const serialEvidence = metadata.fields.serial_number;
  if (!record.raw_source_record_id || !serialEvidence) {
    throw new P2Acq01CanaryError("XLSX row lacks source-local Position identity evidence");
  }
  return createExtractedRecordV2(snapshot, {
    source_definition_id: record.source_definition_id,
    identity_candidates: record.identity_candidates,
    raw_source_record_id: record.raw_source_record_id,
    raw_title: record.raw_title,
    raw_organization_name: record.raw_organization_name,
    raw_location_text: record.raw_location_text,
    raw_description: record.raw_description,
    raw_requirement_text: record.raw_requirement_text,
    announcement_url: record.announcement_url,
    recruitment_year: record.recruitment_year,
    recruitment_batch: record.recruitment_batch,
    recruitment_context: {
      recruitment_batch: { applicability: "UNRESOLVED" },
      position: {
        identity_state: "PROVISIONAL",
        source_local_identifier: original(record.raw_source_record_id),
        evidence_locator: {
          kind: "SPREADSHEET",
          sheet: metadata.sheet,
          cell_or_range: serialEvidence.cell,
          field_path: serialEvidence.field_path
        }
      },
      opportunity: {
        identity_state: "PROVISIONAL",
        source_local_identifier: original(`${metadata.sheet}!${metadata.row_range}`),
        evidence_locator: {
          kind: "SPREADSHEET",
          sheet: metadata.sheet,
          cell_or_range: metadata.row_range
        }
      }
    },
    source_record_locator: record.source_record_locator,
    adapter_metadata: record.adapter_metadata,
    extraction: {
      extractor_name: record.extraction.extractor_name,
      extractor_version: record.extraction.extractor_version,
      schema_version: "p2-acq-01-beijing-position-row/1.0.0"
    }
  });
}

function buildCompositionInput(input: {
  readonly package_source: TrustedSourceOccurrenceArtifact;
  readonly position_source: TrustedSourceOccurrenceArtifact;
  readonly position_version: PositionVersion;
  readonly opportunity_version: PositionBoundOpportunityVersion;
  readonly attachment_inventory: readonly P2Acq01AttachmentInventoryEntry[];
}): SourceCompositionInput {
  const opportunityVersionId = input.opportunity_version.opportunity_version_id;
  const compositionAsOf = latest(
    input.package_source.snapshot.observed_at,
    input.position_source.snapshot.observed_at
  );
  const publishedAt = "2026-06-24T00:00:00+08:00" as IsoDateTime;
  const seed = input.position_source.extracted_record.raw_source_record_id
    ?? input.position_source.extracted_record.extracted_record_id;
  const targetScope = `opportunity-version:${opportunityVersionId}`;
  const ids = compositionIds(seed);
  const noticeLocator = {
    kind: "HTML" as const,
    section: "official recruitment announcement",
    text_locator: "#mainText > .view"
  };
  const attachmentLocator = {
    kind: "DOCUMENT" as const,
    section: "attachment 1",
    text_locator: BEIJING_ATTACHMENT_ENDPOINT
  };
  const rowMetadata = input.position_source.extracted_record.adapter_metadata[
    BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_ADAPTER_KEY
  ] as unknown as XlsxRecordMetadata;
  const rowLocator = {
    kind: "SPREADSHEET" as const,
    sheet: rowMetadata.sheet,
    cell_or_range: rowMetadata.row_range,
    field_path: `positions[${JSON.stringify(seed)}]`
  };
  const noticeContext = bindingContext(input.package_source);
  const positionContext = bindingContext(input.position_source);
  const surfaces: SourceSurface[] = [{
    source_surface_id: ids.noticeSurface,
    surface_kind: "ANNOUNCEMENT_BODY",
    source_occurrence_version_id: input.package_source.version.source_occurrence_version_id,
    snapshot_id: input.package_source.snapshot.snapshot_id,
    extracted_record_id: input.package_source.extracted_record.extracted_record_id,
    locator: noticeLocator,
    surface_content_hash: input.package_source.snapshot.content_hash!,
    effective_period: { effective_from: publishedAt },
    source_publication_time: publishedAt,
    observed_at: input.package_source.snapshot.observed_at,
    surface_status: "PARSED",
    composition_role: "PRIMARY",
    target_scope: targetScope,
    evidence_ids: [ids.noticeEvidence],
    extractor_version: input.package_source.version.materialization.extractor_version,
    parser_version: P2_ACQ_01_CANARY_VERSION,
    resolver_version: P2_ACQ_01_CANARY_VERSION,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
  }, {
    source_surface_id: ids.attachmentSurface,
    surface_kind: "ANNOUNCEMENT_ATTACHMENT",
    source_occurrence_version_id: input.position_source.version.source_occurrence_version_id,
    snapshot_id: input.position_source.snapshot.snapshot_id,
    extracted_record_id: input.position_source.extracted_record.extracted_record_id,
    locator: attachmentLocator,
    surface_content_hash: input.position_source.snapshot.content_hash!,
    effective_period: { effective_from: publishedAt },
    source_publication_time: publishedAt,
    observed_at: input.position_source.snapshot.observed_at,
    surface_status: "PARSED",
    composition_role: "PRIMARY",
    target_scope: targetScope,
    evidence_ids: [ids.attachmentEvidence],
    extractor_version: input.position_source.version.materialization.extractor_version,
    parser_version: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION,
    resolver_version: P2_ACQ_01_CANARY_VERSION,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
  }, {
    source_surface_id: ids.rowSurface,
    surface_kind: "POSITION_TABLE_ROW",
    source_occurrence_version_id: input.position_source.version.source_occurrence_version_id,
    snapshot_id: input.position_source.snapshot.snapshot_id,
    extracted_record_id: input.position_source.extracted_record.extracted_record_id,
    locator: rowLocator,
    surface_content_hash: input.position_source.extracted_record.semantic_hash,
    effective_period: { effective_from: publishedAt },
    source_publication_time: publishedAt,
    observed_at: input.position_source.snapshot.observed_at,
    surface_status: "PARSED",
    composition_role: "PRIMARY",
    target_scope: targetScope,
    evidence_ids: [ids.rowEvidence],
    extractor_version: input.position_source.version.materialization.extractor_version,
    parser_version: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION,
    resolver_version: P2_ACQ_01_CANARY_VERSION,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
  }];
  const publicationBinding: AttachmentPublicationBinding = {
    source_surface_binding_id: ids.attachmentPublicationBinding,
    source_surface_id: ids.attachmentSurface,
    target_type: "ANNOUNCEMENT_VERSION",
    target_id: input.package_source.version.source_occurrence_version_id,
    target_version_id: input.package_source.version.source_occurrence_version_id,
    binding_kind: "ATTACHMENT_PUBLICATION",
    binding_status: "RESOLVED",
    evidence_ids: [ids.attachmentEvidence],
    created_context: positionContext,
    observed_context: positionContext,
    locator: attachmentLocator,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
    attachment_publication_binding_id: ids.attachmentPublication,
    attachment_surface_id: ids.attachmentSurface,
    publication_source_surface_id: ids.noticeSurface
  };
  const rowPublicationBinding: AttachmentPublicationBinding = {
    source_surface_binding_id: ids.rowPublicationBinding,
    source_surface_id: ids.rowSurface,
    target_type: "ANNOUNCEMENT_VERSION",
    target_id: input.package_source.version.source_occurrence_version_id,
    target_version_id: input.package_source.version.source_occurrence_version_id,
    binding_kind: "ATTACHMENT_PUBLICATION",
    binding_status: "RESOLVED",
    evidence_ids: [ids.rowEvidence],
    created_context: positionContext,
    observed_context: positionContext,
    locator: rowLocator,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
    attachment_publication_binding_id: ids.rowPublication,
    attachment_surface_id: ids.rowSurface,
    publication_source_surface_id: ids.noticeSurface
  };
  const rowBinding: AttachmentToPositionBinding = {
    source_surface_binding_id: ids.rowBinding,
    source_surface_id: ids.rowSurface,
    target_type: "OPPORTUNITY_VERSION",
    target_id: opportunityVersionId,
    target_version_id: opportunityVersionId,
    binding_kind: "ATTACHMENT_ROW",
    binding_status: "RESOLVED",
    evidence_ids: [ids.rowEvidence],
    created_context: positionContext,
    observed_context: positionContext,
    locator: rowLocator,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
    attachment_to_position_binding_id: ids.rowPositionBinding,
    attachment_publication_binding_id: ids.rowPublication,
    attachment_surface_id: ids.rowSurface,
    position_version_id: input.position_version.position_version_id,
    opportunity_version_id: opportunityVersionId,
    row_locator: String(rowMetadata.row_number),
    cell_locator: rowMetadata.row_range,
    binding_version: P2_ACQ_01_CANARY_VERSION
  };
  const bindings: SourceSurfaceBinding[] = [{
    source_surface_binding_id: ids.noticeBinding,
    source_surface_id: ids.noticeSurface,
    target_type: "OPPORTUNITY_VERSION",
    target_id: opportunityVersionId,
    target_version_id: opportunityVersionId,
    binding_kind: "ANNOUNCEMENT_UNIFORM",
    binding_status: "RESOLVED",
    evidence_ids: [ids.noticeEvidence],
    created_context: noticeContext,
    observed_context: noticeContext,
    locator: noticeLocator,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
  }, publicationBinding, {
    source_surface_binding_id: ids.attachmentBinding,
    source_surface_id: ids.attachmentSurface,
    target_type: "OPPORTUNITY_VERSION",
    target_id: opportunityVersionId,
    target_version_id: opportunityVersionId,
    binding_kind: "SURFACE_DECLARATION",
    binding_status: "RESOLVED",
    evidence_ids: [ids.attachmentEvidence],
    created_context: positionContext,
    observed_context: positionContext,
    locator: attachmentLocator,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
  }, rowPublicationBinding, rowBinding];

  return {
    opportunity_version_id: opportunityVersionId,
    composition_as_of: compositionAsOf,
    discovery_boundary: {
      discovery_boundary_id: ids.boundary,
      opportunity_version_id: opportunityVersionId,
      boundary_kind: "ANNOUNCEMENT_PACKAGE",
      initiating_source_surface_ids: [ids.noticeSurface],
      source_metadata_references: input.attachment_inventory.map((item) => item.locator),
      discovery_scope: "Captured official HTML and its two declared attachments",
      admissible_relation_kinds: [
        "ANNOUNCEMENT_UNIFORM",
        "ATTACHMENT_PUBLICATION",
        "ATTACHMENT_ROW"
      ],
      evidence_ids: [ids.noticeEvidence],
      composition_as_of: compositionAsOf,
      observed_at: input.package_source.snapshot.observed_at,
      extractor_version: P2_ACQ_01_CANARY_VERSION,
      discovery_resolver_version: P2_ACQ_01_CANARY_VERSION,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    inventory: {
      source_package_inventory_id: ids.inventory,
      discovery_boundary_id: ids.boundary,
      composition_as_of: compositionAsOf,
      discovered_source_surface_ids: surfaces.map((surface) => surface.source_surface_id),
      expected_surface_entries: [
        manifest(ids.noticeEntry, BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
          ids.noticeSurface, ids.noticeAuthority, [ids.noticeBinding], ids.noticeSelection,
          ids.noticeEvidence, targetScope),
        manifest(ids.attachmentEntry, BEIJING_ATTACHMENT_ENDPOINT,
          ids.attachmentSurface, ids.attachmentAuthority, [ids.attachmentBinding],
          ids.attachmentSelection, ids.attachmentEvidence, targetScope),
        manifest(ids.rowEntry, `${BEIJING_ATTACHMENT_ENDPOINT}#${rowMetadata.row_range}`,
          ids.rowSurface, ids.rowAuthority, [ids.rowBinding], ids.rowSelection,
          ids.rowEvidence, targetScope),
        {
          expected_surface_manifest_entry_id: ids.docxEntry,
          expected_surface_key: P2_ACQ_01_DOCX_ENDPOINT,
          source_surface_id: null,
          expectedness: "OPTIONAL",
          requirement_level: "UNRESOLVED",
          authority_status: "UNRESOLVED",
          binding_status: "UNRESOLVED",
          material_binding_ids: [],
          version_selection_status: "UNRESOLVED",
          coverage_status: "MISSING",
          resolution_status: "UNRESOLVED",
          target_scope: targetScope,
          evidence_ids: [ids.noticeEvidence]
        }
      ],
      inventory_completeness_status: "OPEN_UNRESOLVED",
      unexpected_surface_dispositions: [{
        expected_surface_manifest_entry_id: ids.docxEntry,
        disposition: "UNRESOLVED",
        evidence_ids: [ids.noticeEvidence],
        resolver_version: P2_ACQ_01_CANARY_VERSION,
        schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
      }],
      discovery_resolver_version: P2_ACQ_01_CANARY_VERSION,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    evidence_registry: [{
      source_composition_evidence_id: ids.noticeEvidence,
      snapshot_id: input.package_source.snapshot.snapshot_id,
      extracted_record_id: input.package_source.extracted_record.extracted_record_id,
      source_occurrence_version_id: input.package_source.version.source_occurrence_version_id,
      locator: noticeLocator,
      observed_at: input.package_source.snapshot.observed_at,
      extractor_version: input.package_source.version.materialization.extractor_version
    }, {
      source_composition_evidence_id: ids.attachmentEvidence,
      snapshot_id: input.position_source.snapshot.snapshot_id,
      extracted_record_id: input.position_source.extracted_record.extracted_record_id,
      source_occurrence_version_id: input.position_source.version.source_occurrence_version_id,
      locator: attachmentLocator,
      observed_at: input.position_source.snapshot.observed_at,
      extractor_version: input.position_source.version.materialization.extractor_version
    }, {
      source_composition_evidence_id: ids.rowEvidence,
      snapshot_id: input.position_source.snapshot.snapshot_id,
      extracted_record_id: input.position_source.extracted_record.extracted_record_id,
      source_occurrence_version_id: input.position_source.version.source_occurrence_version_id,
      locator: rowLocator,
      observed_at: input.position_source.snapshot.observed_at,
      extractor_version: input.position_source.version.materialization.extractor_version
    }],
    source_surfaces: surfaces,
    source_surface_bindings: bindings,
    authority_assertions: [{
      authority_assertion_id: ids.noticeAuthority,
      asserted_source_surface_id: ids.noticeSurface,
      authority_basis_source_surface_id: ids.noticeSurface,
      authority_basis_binding_id: ids.noticeBinding,
      issuer: "北京市人民政府 / 北京急救中心",
      authority_state: "OFFICIAL_AUTHORITATIVE",
      target_scope: targetScope,
      effective_period: { effective_from: publishedAt },
      evidence_ids: [ids.noticeEvidence],
      resolver_version: P2_ACQ_01_CANARY_VERSION,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }, {
      authority_assertion_id: ids.attachmentAuthority,
      asserted_source_surface_id: ids.attachmentSurface,
      authority_basis_source_surface_id: ids.noticeSurface,
      authority_basis_binding_id: ids.attachmentPublicationBinding,
      issuer: "北京市人民政府 / 北京急救中心",
      authority_state: "OFFICIAL_AUTHORITATIVE",
      target_scope: targetScope,
      effective_period: { effective_from: publishedAt },
      evidence_ids: [ids.attachmentEvidence],
      resolver_version: P2_ACQ_01_CANARY_VERSION,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }, {
      authority_assertion_id: ids.rowAuthority,
      asserted_source_surface_id: ids.rowSurface,
      authority_basis_source_surface_id: ids.noticeSurface,
      authority_basis_binding_id: ids.rowPublicationBinding,
      issuer: "北京市人民政府 / 北京急救中心",
      authority_state: "OFFICIAL_AUTHORITATIVE",
      target_scope: targetScope,
      effective_period: { effective_from: publishedAt },
      evidence_ids: [ids.rowEvidence],
      resolver_version: P2_ACQ_01_CANARY_VERSION,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    source_version_selections: [
      selection(ids.noticeSelection, BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
        ids.noticeSurface, ids.noticeEvidence, targetScope, publishedAt, compositionAsOf),
      selection(ids.attachmentSelection, BEIJING_ATTACHMENT_ENDPOINT,
        ids.attachmentSurface, ids.attachmentEvidence, targetScope, publishedAt, compositionAsOf),
      selection(ids.rowSelection, `${BEIJING_ATTACHMENT_ENDPOINT}#${rowMetadata.row_range}`,
        ids.rowSurface, ids.rowEvidence, targetScope, publishedAt, compositionAsOf)
    ],
    surface_revision_relations: [],
    precedence_decisions: [{
      precedence_decision_id: ids.precedence,
      selected_source_surface_ids: [ids.noticeSurface, ids.attachmentSurface, ids.rowSurface],
      excluded_source_surface_ids: [],
      applicable_scope: targetScope,
      effective_period: { effective_from: publishedAt },
      composition_as_of: compositionAsOf,
      authority_assertion_ids: [ids.noticeAuthority, ids.attachmentAuthority, ids.rowAuthority],
      precedence_rule: "OFFICIAL_ANNOUNCEMENT_WITH_EXACT_XLSX_ROW",
      evidence_ids: [ids.noticeEvidence, ids.rowEvidence],
      decision_status: "RESOLVED",
      resolver_version: P2_ACQ_01_CANARY_VERSION,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    source_conflicts: [],
    extractor_version: P2_ACQ_01_CANARY_VERSION,
    parser_version: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION,
    discovery_resolver_version: P2_ACQ_01_CANARY_VERSION,
    composition_resolver_version: P2_ACQ_01_CANARY_VERSION,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
    serialization_version: "canonical-json/1.0.0"
  };
}

function compositionIds(seed: string) {
  const key = sha256(new TextEncoder().encode(seed));
  const value = (name: string) => `${name}:p2-acq-01:${key}`;
  return {
    noticeSurface: identity<SourceSurfaceId>(value("source-surface:notice")),
    attachmentSurface: identity<SourceSurfaceId>(value("source-surface:xlsx")),
    rowSurface: identity<SourceSurfaceId>(value("source-surface:row")),
    noticeEvidence: identity<SourceCompositionEvidenceId>(value("evidence:notice")),
    attachmentEvidence: identity<SourceCompositionEvidenceId>(value("evidence:xlsx")),
    rowEvidence: identity<SourceCompositionEvidenceId>(value("evidence:row")),
    noticeBinding: identity<SourceSurfaceBindingId>(value("binding:notice")),
    attachmentPublicationBinding: identity<SourceSurfaceBindingId>(value("binding:xlsx-publication")),
    attachmentBinding: identity<SourceSurfaceBindingId>(value("binding:xlsx-target")),
    rowPublicationBinding: identity<SourceSurfaceBindingId>(value("binding:row-publication")),
    rowBinding: identity<SourceSurfaceBindingId>(value("binding:row-target")),
    attachmentPublication: identity<AttachmentPublicationBindingId>(value("attachment-publication:xlsx")),
    rowPublication: identity<AttachmentPublicationBindingId>(value("attachment-publication:row")),
    rowPositionBinding: identity<AttachmentToPositionBindingId>(value("attachment-position:row")),
    noticeAuthority: identity<AuthorityAssertionId>(value("authority:notice")),
    attachmentAuthority: identity<AuthorityAssertionId>(value("authority:xlsx")),
    rowAuthority: identity<AuthorityAssertionId>(value("authority:row")),
    noticeSelection: identity<SourceVersionSelectionId>(value("selection:notice")),
    attachmentSelection: identity<SourceVersionSelectionId>(value("selection:xlsx")),
    rowSelection: identity<SourceVersionSelectionId>(value("selection:row")),
    boundary: identity<DiscoveryBoundaryId>(value("boundary")),
    inventory: identity<SourcePackageInventoryId>(value("inventory")),
    noticeEntry: identity<ExpectedSurfaceManifestEntryId>(value("manifest:notice")),
    attachmentEntry: identity<ExpectedSurfaceManifestEntryId>(value("manifest:xlsx")),
    rowEntry: identity<ExpectedSurfaceManifestEntryId>(value("manifest:row")),
    docxEntry: identity<ExpectedSurfaceManifestEntryId>(value("manifest:docx")),
    precedence: identity<SourcePrecedenceDecisionId>(value("precedence"))
  };
}

function manifest(
  id: ExpectedSurfaceManifestEntryId,
  key: string,
  surfaceId: SourceSurfaceId,
  authorityId: AuthorityAssertionId,
  bindingIds: readonly SourceSurfaceBindingId[],
  selectionId: SourceVersionSelectionId,
  evidenceId: SourceCompositionEvidenceId,
  targetScope: string
) {
  return {
    expected_surface_manifest_entry_id: id,
    expected_surface_key: key,
    source_surface_id: surfaceId,
    expectedness: "REQUIRED" as const,
    requirement_level: "REQUIREMENT_BEARING" as const,
    authority_status: "OFFICIAL_AUTHORITATIVE" as const,
    authority_assertion_id: authorityId,
    binding_status: "RESOLVED" as const,
    material_binding_ids: bindingIds,
    version_selection_status: "RESOLVED" as const,
    source_version_selection_id: selectionId,
    coverage_status: "COVERED" as const,
    resolution_status: "RESOLVED" as const,
    target_scope: targetScope,
    evidence_ids: [evidenceId]
  };
}

function selection(
  id: SourceVersionSelectionId,
  sourceIdentity: string,
  surfaceId: SourceSurfaceId,
  evidenceId: SourceCompositionEvidenceId,
  targetScope: string,
  publishedAt: IsoDateTime,
  compositionAsOf: IsoDateTime
) {
  return {
    source_version_selection_id: id,
    source_identity: sourceIdentity,
    target_scope: targetScope,
    candidate_source_surface_ids: [surfaceId],
    selected_source_surface_id: surfaceId,
    excluded_source_surface_ids: [],
    selection_status: "RESOLVED" as const,
    source_publication_time: publishedAt,
    effective_period: { effective_from: publishedAt },
    observation_time: compositionAsOf,
    ingestion_time: compositionAsOf,
    evidence_ids: [evidenceId],
    resolver_version: P2_ACQ_01_CANARY_VERSION,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
  };
}

function identitySource(source: TrustedSourceOccurrenceArtifact): PositionIdentityResolutionInput {
  return {
    endpoint: source.endpoint,
    occurrence: source.occurrence,
    version: source.version,
    extracted_record: source.extracted_record,
    snapshot: source.snapshot
  };
}

function bindingContext(source: TrustedSourceOccurrenceArtifact) {
  return {
    source_occurrence_version_id: source.version.source_occurrence_version_id,
    snapshot_id: source.snapshot.snapshot_id,
    extracted_record_id: source.extracted_record.extracted_record_id,
    observed_at: source.snapshot.observed_at,
    resolver_version: P2_ACQ_01_CANARY_VERSION
  };
}

function createHtmlEndpoint(): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
    source_definition_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_SOURCE_DEFINITION_ID,
    name: traceable("北京急救中心2026年度第四批公开招聘公告"),
    description: traceable("P2-ACQ-01 exact official HTML technical Canary"),
    coverage_regions: [{ raw_text: original("北京市") }],
    locator: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
    request_method: "GET",
    content_kind: "HTML",
    adapter_key: BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY,
    decoded_text_encoding: UTF8_TEXT_ENCODING,
    collection_config: {
      timeout_ms: P2_ACQ_01_HTML_TIMEOUT_MS,
      max_items: 1,
      max_pages: 1,
      follow_redirects: false,
      retry_limit: 0
    },
    enabled: false
  };
}

function createXlsxEndpoint(): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID,
    source_definition_id: BEIJING_ATTACHMENT_SOURCE_DEFINITION_ID,
    name: traceable("北京急救中心2026年度第四批职位及要求表"),
    description: traceable("Previously sealed official XLSX Raw, reused offline"),
    coverage_regions: [{ raw_text: original("北京市") }],
    locator: BEIJING_ATTACHMENT_ENDPOINT,
    request_method: "GET",
    content_kind: "FILE",
    adapter_key: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_ADAPTER_KEY,
    decoded_text_encoding: UTF8_TEXT_ENCODING,
    collection_config: {
      timeout_ms: 15_000,
      max_items: 1,
      max_pages: 1,
      follow_redirects: false,
      retry_limit: 0
    },
    enabled: false
  };
}

function downstreamBoundary() {
  return {
    requirement_projection_created: false,
    requirement_set_version_created: false,
    predicate_resolution_created: false,
    eligibility_assessment_created: false
  } as const;
}

function latest(left: IsoDateTime, right: IsoDateTime) {
  return (left > right ? left : right) as IsoDateTime;
}

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}

function identity<Value extends string>(value: string) {
  return value as Value;
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function frozen<Value>(value: Value): Value {
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      frozen(nested);
    }
  }
  return value;
}
