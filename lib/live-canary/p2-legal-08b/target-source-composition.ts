import { createHash } from "node:crypto";

import { load } from "cheerio";

import {
  SOURCE_COMPOSITION_SCHEMA_VERSION,
  UTF8_TEXT_ENCODING,
  createExtractedRecordV2,
  createTrustedArtifactChain,
  InMemoryPositionBoundOpportunityTracker,
  InMemoryPositionVersionTracker,
  InMemoryTrustedSourceOccurrenceTracker,
  resolvePositionIdentity,
  type AttachmentPublicationBinding,
  type AttachmentPublicationBindingId,
  type AttachmentToPositionBinding,
  type AttachmentToPositionBindingId,
  type AuthorityAssertionId,
  type DiscoveryBoundaryId,
  type ExpectedSurfaceManifestEntryId,
  type ExtractedRecordV2,
  type IsoDateTime,
  type Position,
  type PositionBoundOpportunityVersion,
  type PositionIdentityResolutionInput,
  type PositionVersion,
  type RawBlob,
  type RawBlobId,
  type RawContentSha256,
  type Snapshot,
  type SourceCompositionEvidenceId,
  type SourceCompositionInput,
  type SourceCompositionResult,
  type SourceOccurrenceVersionId,
  type SourcePackageInventoryId,
  type SourcePrecedenceDecisionId,
  type SourceSurface,
  type SourceSurfaceBinding,
  type SourceSurfaceBindingId,
  type SourceSurfaceId,
  type SourceVersionSelectionId,
  type TrustedArtifactChain,
  type TrustedSourceOccurrenceArtifact
} from "../../ingestion";
import {
  GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT,
  GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT_ID,
  GUIZHOU_LEGAL_CANARY_NOTICE_URL,
  GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID
} from "../p2-legal-01/guizhou-legal-canary-admission-preflight";
import {
  GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID,
  GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
  GUIZHOU_NOTICE_RAW_SHA256,
  GUIZHOU_NOTICE_SNAPSHOT_ID
} from "../p2-legal-03/guizhou-attachment-admission-preflight";
import { GUIZHOU_ATTACHMENT_EXPECTED_MIME } from "../p2-legal-04/guizhou-attachment-observation-canary";
import {
  GuizhouLegalXlsxRequirementObservationAdapter,
  P2_LEGAL_05_PARSER_VERSION,
  P2_LEGAL_05_RAW_SHA256,
  P2_LEGAL_05_SNAPSHOT_ID,
  P2_LEGAL_05_TARGET_JOB_CODE,
  createGuizhouLegalRequirementEndpoint
} from "../p2-legal-05/guizhou-legal-xlsx-requirement-adapter";

export const P2_LEGAL_08B_ANNOUNCEMENT_EXTRACTOR_VERSION =
  "p2-legal-08b-offline-announcement-package/1.0.0";
export const P2_LEGAL_08B_COMPOSITION_VERSION =
  "p2-legal-08b-target-source-composition/1.0.0";

export type TargetAttachmentDisposition =
  | "REQUIRED"
  | "CONDITIONAL"
  | "EVIDENCED_OUT_OF_SCOPE"
  | "UNRESOLVED";

export interface TargetAttachmentInventoryEntry {
  readonly attachment_index: 1 | 2 | 3 | 4;
  readonly filename: string;
  readonly title: string;
  readonly anchor_text: string;
  readonly raw_href: string;
  readonly exact_locator: string;
  readonly locally_archived: boolean;
  readonly disposition: TargetAttachmentDisposition;
  readonly disposition_reason: string;
}

export interface P2Legal08bArchivedEvidenceInput {
  readonly notice_raw_bytes: Uint8Array;
  readonly notice_snapshot: Snapshot;
  readonly attachment_1_raw_bytes: Uint8Array;
  readonly attachment_1_snapshot: Snapshot;
}

export interface P2Legal08bTargetMaterializationResult {
  readonly attachment_inventory: readonly TargetAttachmentInventoryEntry[];
  readonly announcement_record: ExtractedRecordV2;
  readonly announcement_source: TrustedSourceOccurrenceArtifact;
  readonly target_record: ExtractedRecordV2;
  readonly target_source: TrustedSourceOccurrenceArtifact;
  readonly position: Position;
  readonly position_version: PositionVersion;
  readonly opportunity_version: PositionBoundOpportunityVersion;
  readonly source_composition: SourceCompositionResult;
  readonly trusted_root: {
    readonly position_bound_opportunities: InMemoryPositionBoundOpportunityTracker;
    readonly chain: TrustedArtifactChain;
  };
  readonly downstream_boundary: {
    readonly requirement_projection_created: false;
    readonly requirement_set_version_created: false;
    readonly predicate_resolution_created: false;
    readonly eligibility_assessment_created: false;
  };
}

export class P2Legal08bMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "P2Legal08bMaterializationError";
  }
}

export function discoverP2Legal08bAttachmentInventory(
  noticeRawBytes: Uint8Array
): readonly TargetAttachmentInventoryEntry[] {
  const $ = load(new TextDecoder("utf-8").decode(noticeRawBytes));
  const discovered = $("a[appendix='true'][href]").toArray().flatMap((element) => {
    const anchor = $(element);
    const anchorText = normalizeWhitespace(anchor.text());
    const match = /^附件([1-4])[:：]\s*(.+)$/u.exec(anchorText);
    if (!match) return [];
    const attachmentIndex = Number(match[1]) as 1 | 2 | 3 | 4;
    const rawHref = anchor.attr("href")?.trim();
    if (!rawHref) return [];
    const filename = new URL(rawHref, GUIZHOU_LEGAL_CANARY_NOTICE_URL)
      .pathname.split("/").pop();
    if (!filename) return [];
    const titledFilename = match[2]!.trim();
    const title = titledFilename.replace(/\.(?:xlsx|doc|wps)$/iu, "");
    return [{
      attachment_index: attachmentIndex,
      filename,
      title,
      anchor_text: anchorText,
      raw_href: rawHref,
      exact_locator: new URL(rawHref, GUIZHOU_LEGAL_CANARY_NOTICE_URL).toString(),
      locally_archived: attachmentIndex === 1,
      disposition: attachmentIndex === 1 ? "REQUIRED" : "UNRESOLVED",
      disposition_reason: attachmentDispositionReason(attachmentIndex)
    } satisfies TargetAttachmentInventoryEntry];
  }).sort((left, right) => left.attachment_index - right.attachment_index);

  const indexes = discovered.map((entry) => entry.attachment_index);
  if (discovered.length !== 4 || new Set(indexes).size !== 4
      || indexes.some((value, index) => value !== index + 1)) {
    throw new P2Legal08bMaterializationError(
      "Official announcement package must disclose exactly attachments 1 through 4"
    );
  }
  assertAttachmentIdentities(discovered);
  return deepFreeze(structuredClone(discovered));
}

export function createP2Legal08bAnnouncementRecord(
  noticeRawBytes: Uint8Array,
  noticeSnapshot: Snapshot
): ExtractedRecordV2 {
  validateArchivedSource(
    noticeRawBytes,
    noticeSnapshot,
    GUIZHOU_NOTICE_RAW_SHA256,
    GUIZHOU_NOTICE_SNAPSHOT_ID,
    GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT_ID,
    GUIZHOU_LEGAL_CANARY_NOTICE_URL
  );
  const $ = load(new TextDecoder("utf-8").decode(noticeRawBytes));
  const title = $("meta[name='ArticleTitle']").attr("content")?.trim()
    ?? $(".Article_bt").first().text().trim();
  const articleText = normalizeWhitespace($("#Zoom .trs_editor_view").first().text());
  if (!title || !articleText) {
    throw new P2Legal08bMaterializationError(
      "Archived notice does not contain the frozen title and article body selectors"
    );
  }
  return createExtractedRecordV2(noticeSnapshot, {
    source_definition_id: GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID,
    identity_candidates: [{
      kind: "ANNOUNCEMENT_URL",
      value: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
      confidence: "HIGH"
    }],
    raw_source_record_id: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
    raw_title: original(title),
    raw_organization_name: original("贵州省司法厅"),
    raw_location_text: [original("贵州省")],
    raw_requirement_text: original(articleText),
    announcement_url: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
    publish_time: original("2025年2月10日"),
    recruitment_year: original("2025"),
    source_record_locator: {
      kind: "HTML",
      selector: "#Zoom .trs_editor_view",
      path: GUIZHOU_LEGAL_CANARY_NOTICE_URL
    },
    adapter_metadata: {
      [P2_LEGAL_08B_ANNOUNCEMENT_EXTRACTOR_VERSION]: {
        source_role: "PACKAGE",
        attachment_count: 4,
        target_job_code: P2_LEGAL_05_TARGET_JOB_CODE,
        downstream_artifacts_created: false
      }
    },
    extraction: {
      extractor_name: "GuizhouAnnouncementPackageOfflineExtractor",
      extractor_version: P2_LEGAL_08B_ANNOUNCEMENT_EXTRACTOR_VERSION,
      schema_version: "p2-legal-08b-announcement-package-extracted-record/1.0.0"
    }
  });
}

export function materializeP2Legal08bTarget(
  input: P2Legal08bArchivedEvidenceInput
): P2Legal08bTargetMaterializationResult {
  validateArchivedSource(
    input.attachment_1_raw_bytes,
    input.attachment_1_snapshot,
    P2_LEGAL_05_RAW_SHA256,
    P2_LEGAL_05_SNAPSHOT_ID,
    GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID,
    GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL
  );
  const attachmentInventory = discoverP2Legal08bAttachmentInventory(
    input.notice_raw_bytes
  );
  const announcementRecord = createP2Legal08bAnnouncementRecord(
    input.notice_raw_bytes,
    input.notice_snapshot
  );
  const attachmentEndpoint = createGuizhouLegalRequirementEndpoint(
    GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID
  );
  const attachmentRawBlob: RawBlob = {
    raw_blob_id: `sha256:${P2_LEGAL_05_RAW_SHA256}` as RawBlobId,
    bytes: new Uint8Array(input.attachment_1_raw_bytes),
    raw_content_sha256: P2_LEGAL_05_RAW_SHA256 as RawContentSha256,
    mime_type: GUIZHOU_ATTACHMENT_EXPECTED_MIME,
    byte_length: input.attachment_1_raw_bytes.byteLength,
    created_at: input.attachment_1_snapshot.observed_at
  };
  const parsed = new GuizhouLegalXlsxRequirementObservationAdapter().parse({
    endpoint: attachmentEndpoint,
    snapshot: input.attachment_1_snapshot,
    raw_blob: attachmentRawBlob
  });

  const sourceTracker = new InMemoryTrustedSourceOccurrenceTracker();
  const announcementSource = sourceTracker.process({
    source_role: "PACKAGE",
    endpoint: GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT,
    extracted_record: announcementRecord,
    snapshot: input.notice_snapshot
  });
  const targetSource = sourceTracker.process({
    source_role: "POSITION_BEARING",
    endpoint: attachmentEndpoint,
    extracted_record: parsed.source_occurrence_record,
    snapshot: input.attachment_1_snapshot
  });
  const targetIdentitySource = identitySource(targetSource);
  const positionResolution = resolvePositionIdentity(targetIdentitySource);
  if (positionResolution.status !== "RESOLVED") {
    throw new P2Legal08bMaterializationError(
      "Target Position identity did not resolve from the sealed Position-bearing SOV"
    );
  }
  const position = positionResolution.position;
  if (position.identity_basis.kind !== "SOURCE_LOCAL_RECORD"
      || position.identity_state !== "PROVISIONAL") {
    throw new P2Legal08bMaterializationError(
      "Target Position must remain SOURCE_LOCAL_RECORD + PROVISIONAL"
    );
  }
  const positionVersionTracker = new InMemoryPositionVersionTracker();
  const positionVersion = positionVersionTracker.process({
    position,
    sources: [targetIdentitySource]
  }).position_version;
  const pbovTracker = new InMemoryPositionBoundOpportunityTracker(
    positionVersionTracker
  );
  const opportunity = pbovTracker.process({
    position,
    position_version: positionVersion,
    sources: [targetIdentitySource]
  });
  const chain = createTrustedArtifactChain(pbovTracker, sourceTracker);
  const compositionInput = buildTargetCompositionInput({
    announcement_source: announcementSource,
    target_source: targetSource,
    attachment_inventory: attachmentInventory,
    position_version: positionVersion,
    opportunity_version: opportunity.opportunity_version
  });
  const sourceComposition = chain.source_compositions.materialize({
    opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
    composition_input: compositionInput
  });
  if (sourceComposition.status === "COMPLETE") {
    throw new P2Legal08bMaterializationError(
      "Unresolved attachment dispositions must not produce COMPLETE"
    );
  }

  const artifacts = deepFreeze({
    attachment_inventory: attachmentInventory,
    announcement_record: announcementRecord,
    announcement_source: announcementSource,
    target_record: parsed.source_occurrence_record,
    target_source: targetSource,
    position,
    position_version: positionVersion,
    opportunity_version: opportunity.opportunity_version,
    source_composition: sourceComposition,
    downstream_boundary: {
      requirement_projection_created: false,
      requirement_set_version_created: false,
      predicate_resolution_created: false,
      eligibility_assessment_created: false
    } as const
  });
  return Object.freeze({
    ...artifacts,
    trusted_root: Object.freeze({
      position_bound_opportunities: pbovTracker,
      chain
    })
  });
}

function buildTargetCompositionInput(input: {
  readonly announcement_source: TrustedSourceOccurrenceArtifact;
  readonly target_source: TrustedSourceOccurrenceArtifact;
  readonly attachment_inventory: readonly TargetAttachmentInventoryEntry[];
  readonly position_version: PositionVersion;
  readonly opportunity_version: PositionBoundOpportunityVersion;
}): SourceCompositionInput {
  const opportunityVersionId = input.opportunity_version.opportunity_version_id;
  const compositionAsOf = latestObservedAt(
    input.announcement_source.snapshot.observed_at,
    input.target_source.snapshot.observed_at
  );
  const publishedAt = "2025-02-10T00:00:00+08:00" as IsoDateTime;
  const targetScope = `opportunity-version:${opportunityVersionId}`;
  const noticeSurfaceId = identity<SourceSurfaceId>("source-surface:p2-legal-08b:notice");
  const attachmentSurfaceId = identity<SourceSurfaceId>(
    "source-surface:p2-legal-08b:attachment-1"
  );
  const rowSurfaceId = identity<SourceSurfaceId>(
    `source-surface:p2-legal-08b:attachment-1:${P2_LEGAL_05_TARGET_JOB_CODE}`
  );
  const noticeEvidenceId = identity<SourceCompositionEvidenceId>(
    "source-composition-evidence:p2-legal-08b:notice"
  );
  const attachmentEvidenceId = identity<SourceCompositionEvidenceId>(
    "source-composition-evidence:p2-legal-08b:attachment-1"
  );
  const rowEvidenceId = identity<SourceCompositionEvidenceId>(
    `source-composition-evidence:p2-legal-08b:${P2_LEGAL_05_TARGET_JOB_CODE}`
  );
  const noticeBindingId = identity<SourceSurfaceBindingId>(
    "source-surface-binding:p2-legal-08b:notice-uniform"
  );
  const attachmentPublicationBindingId = identity<SourceSurfaceBindingId>(
    "source-surface-binding:p2-legal-08b:attachment-1-publication"
  );
  const attachmentTargetBindingId = identity<SourceSurfaceBindingId>(
    "source-surface-binding:p2-legal-08b:attachment-1-target"
  );
  const rowPublicationBindingId = identity<SourceSurfaceBindingId>(
    `source-surface-binding:p2-legal-08b:${P2_LEGAL_05_TARGET_JOB_CODE}-publication`
  );
  const rowBindingId = identity<SourceSurfaceBindingId>(
    `source-surface-binding:p2-legal-08b:${P2_LEGAL_05_TARGET_JOB_CODE}`
  );
  const noticeAuthorityId = identity<AuthorityAssertionId>(
    "authority-assertion:p2-legal-08b:notice"
  );
  const attachmentAuthorityId = identity<AuthorityAssertionId>(
    "authority-assertion:p2-legal-08b:attachment-1"
  );
  const rowAuthorityId = identity<AuthorityAssertionId>(
    `authority-assertion:p2-legal-08b:${P2_LEGAL_05_TARGET_JOB_CODE}`
  );
  const noticeSelectionId = identity<SourceVersionSelectionId>(
    "source-version-selection:p2-legal-08b:notice"
  );
  const attachmentSelectionId = identity<SourceVersionSelectionId>(
    "source-version-selection:p2-legal-08b:attachment-1"
  );
  const rowSelectionId = identity<SourceVersionSelectionId>(
    `source-version-selection:p2-legal-08b:${P2_LEGAL_05_TARGET_JOB_CODE}`
  );
  const boundaryId = identity<DiscoveryBoundaryId>(
    "discovery-boundary:p2-legal-08b:official-announcement-package"
  );

  const noticeLocator = {
    kind: "HTML" as const,
    section: "official recruitment notice body",
    text_locator: "#Zoom .trs_editor_view"
  };
  const attachmentLocator = {
    kind: "DOCUMENT" as const,
    section: "attachment 1",
    text_locator: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL
  };
  const rowLocator = {
    kind: "SPREADSHEET" as const,
    sheet: "Sheet1",
    cell_or_range: "A4:O4",
    field_path: `positions[${P2_LEGAL_05_TARGET_JOB_CODE}]`
  };
  const noticeContext = bindingContext(input.announcement_source);
  const targetContext = bindingContext(input.target_source);
  const surfaces: SourceSurface[] = [
    {
      source_surface_id: noticeSurfaceId,
      surface_kind: "ANNOUNCEMENT_BODY",
      source_occurrence_version_id:
        input.announcement_source.version.source_occurrence_version_id,
      snapshot_id: input.announcement_source.snapshot.snapshot_id,
      extracted_record_id: input.announcement_source.extracted_record.extracted_record_id,
      locator: noticeLocator,
      surface_content_hash: input.announcement_source.snapshot.content_hash!,
      effective_period: { effective_from: publishedAt },
      source_publication_time: publishedAt,
      observed_at: input.announcement_source.snapshot.observed_at,
      surface_status: "PARSED",
      composition_role: "PRIMARY",
      target_scope: targetScope,
      evidence_ids: [noticeEvidenceId],
      extractor_version: input.announcement_source.version.materialization.extractor_version,
      parser_version: P2_LEGAL_08B_ANNOUNCEMENT_EXTRACTOR_VERSION,
      resolver_version: P2_LEGAL_08B_COMPOSITION_VERSION,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    {
      source_surface_id: attachmentSurfaceId,
      surface_kind: "ANNOUNCEMENT_ATTACHMENT",
      source_occurrence_version_id: input.target_source.version.source_occurrence_version_id,
      snapshot_id: input.target_source.snapshot.snapshot_id,
      extracted_record_id: input.target_source.extracted_record.extracted_record_id,
      locator: attachmentLocator,
      surface_content_hash: input.target_source.snapshot.content_hash!,
      effective_period: { effective_from: publishedAt },
      source_publication_time: publishedAt,
      observed_at: input.target_source.snapshot.observed_at,
      surface_status: "PARSED",
      composition_role: "PRIMARY",
      target_scope: targetScope,
      evidence_ids: [attachmentEvidenceId],
      extractor_version: input.target_source.version.materialization.extractor_version,
      parser_version: P2_LEGAL_05_PARSER_VERSION,
      resolver_version: P2_LEGAL_08B_COMPOSITION_VERSION,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    {
      source_surface_id: rowSurfaceId,
      surface_kind: "POSITION_TABLE_ROW",
      source_occurrence_version_id: input.target_source.version.source_occurrence_version_id,
      snapshot_id: input.target_source.snapshot.snapshot_id,
      extracted_record_id: input.target_source.extracted_record.extracted_record_id,
      locator: rowLocator,
      surface_content_hash: input.target_source.extracted_record.semantic_hash,
      effective_period: { effective_from: publishedAt },
      source_publication_time: publishedAt,
      observed_at: input.target_source.snapshot.observed_at,
      surface_status: "PARSED",
      composition_role: "PRIMARY",
      target_scope: targetScope,
      evidence_ids: [rowEvidenceId],
      extractor_version: input.target_source.version.materialization.extractor_version,
      parser_version: P2_LEGAL_05_PARSER_VERSION,
      resolver_version: P2_LEGAL_08B_COMPOSITION_VERSION,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }
  ];

  const publicationBinding: AttachmentPublicationBinding = {
    source_surface_binding_id: attachmentPublicationBindingId,
    source_surface_id: attachmentSurfaceId,
    target_type: "ANNOUNCEMENT_VERSION",
    target_id: input.announcement_source.version.source_occurrence_version_id,
    target_version_id: input.announcement_source.version.source_occurrence_version_id,
    binding_kind: "ATTACHMENT_PUBLICATION",
    binding_status: "RESOLVED",
    evidence_ids: [attachmentEvidenceId],
    created_context: targetContext,
    observed_context: targetContext,
    locator: attachmentLocator,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
    attachment_publication_binding_id: identity<AttachmentPublicationBindingId>(
      "attachment-publication-binding:p2-legal-08b:attachment-1"
    ),
    attachment_surface_id: attachmentSurfaceId,
    publication_source_surface_id: noticeSurfaceId
  };
  const rowPublicationBinding: AttachmentPublicationBinding = {
    source_surface_binding_id: rowPublicationBindingId,
    source_surface_id: rowSurfaceId,
    target_type: "ANNOUNCEMENT_VERSION",
    target_id: input.announcement_source.version.source_occurrence_version_id,
    target_version_id: input.announcement_source.version.source_occurrence_version_id,
    binding_kind: "ATTACHMENT_PUBLICATION",
    binding_status: "RESOLVED",
    evidence_ids: [rowEvidenceId],
    created_context: targetContext,
    observed_context: targetContext,
    locator: rowLocator,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
    attachment_publication_binding_id: identity<AttachmentPublicationBindingId>(
      `attachment-publication-binding:p2-legal-08b:${P2_LEGAL_05_TARGET_JOB_CODE}`
    ),
    attachment_surface_id: rowSurfaceId,
    publication_source_surface_id: noticeSurfaceId
  };
  const rowBinding: AttachmentToPositionBinding = {
    source_surface_binding_id: rowBindingId,
    source_surface_id: rowSurfaceId,
    target_type: "OPPORTUNITY_VERSION",
    target_id: opportunityVersionId,
    target_version_id: opportunityVersionId,
    binding_kind: "ATTACHMENT_ROW",
    binding_status: "RESOLVED",
    evidence_ids: [rowEvidenceId],
    created_context: targetContext,
    observed_context: targetContext,
    locator: rowLocator,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
    attachment_to_position_binding_id: identity<AttachmentToPositionBindingId>(
      `attachment-to-position-binding:p2-legal-08b:${P2_LEGAL_05_TARGET_JOB_CODE}`
    ),
    attachment_publication_binding_id:
      rowPublicationBinding.attachment_publication_binding_id,
    attachment_surface_id: rowSurfaceId,
    position_version_id: input.position_version.position_version_id,
    opportunity_version_id: opportunityVersionId,
    row_locator: "4",
    cell_locator: "A4:O4",
    binding_version: P2_LEGAL_08B_COMPOSITION_VERSION
  };
  const bindings: SourceSurfaceBinding[] = [
    {
      source_surface_binding_id: noticeBindingId,
      source_surface_id: noticeSurfaceId,
      target_type: "OPPORTUNITY_VERSION",
      target_id: opportunityVersionId,
      target_version_id: opportunityVersionId,
      binding_kind: "ANNOUNCEMENT_UNIFORM",
      binding_status: "RESOLVED",
      evidence_ids: [noticeEvidenceId],
      created_context: noticeContext,
      observed_context: noticeContext,
      locator: noticeLocator,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    publicationBinding,
    {
      source_surface_binding_id: attachmentTargetBindingId,
      source_surface_id: attachmentSurfaceId,
      target_type: "OPPORTUNITY_VERSION",
      target_id: opportunityVersionId,
      target_version_id: opportunityVersionId,
      binding_kind: "SURFACE_DECLARATION",
      binding_status: "RESOLVED",
      evidence_ids: [attachmentEvidenceId],
      created_context: targetContext,
      observed_context: targetContext,
      locator: attachmentLocator,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    rowPublicationBinding,
    rowBinding
  ];

  return {
    opportunity_version_id: opportunityVersionId,
    composition_as_of: compositionAsOf,
    discovery_boundary: {
      discovery_boundary_id: boundaryId,
      opportunity_version_id: opportunityVersionId,
      boundary_kind: "ANNOUNCEMENT_PACKAGE",
      initiating_source_surface_ids: [noticeSurfaceId],
      source_metadata_references: input.attachment_inventory.map((entry) => {
        return entry.exact_locator;
      }),
      discovery_scope: "Official notice body and its disclosed four-attachment package",
      admissible_relation_kinds: [
        "ATTACHMENT_PUBLICATION",
        "ANNOUNCEMENT_UNIFORM",
        "ATTACHMENT_ROW"
      ],
      evidence_ids: [noticeEvidenceId],
      composition_as_of: compositionAsOf,
      observed_at: input.announcement_source.snapshot.observed_at,
      extractor_version: P2_LEGAL_08B_ANNOUNCEMENT_EXTRACTOR_VERSION,
      discovery_resolver_version: P2_LEGAL_08B_COMPOSITION_VERSION,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    inventory: {
      source_package_inventory_id: identity<SourcePackageInventoryId>(
        "source-package-inventory:p2-legal-08b:official-announcement-package"
      ),
      discovery_boundary_id: boundaryId,
      composition_as_of: compositionAsOf,
      discovered_source_surface_ids: surfaces.map((surface) => surface.source_surface_id),
      expected_surface_entries: [
        manifestEntry({
          id: "expected-surface:p2-legal-08b:notice",
          key: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
          surface_id: noticeSurfaceId,
          authority_id: noticeAuthorityId,
          binding_ids: [noticeBindingId],
          selection_id: noticeSelectionId,
          evidence_ids: [noticeEvidenceId],
          target_scope: targetScope
        }),
        manifestEntry({
          id: "expected-surface:p2-legal-08b:attachment-1",
          key: input.attachment_inventory[0]!.exact_locator,
          surface_id: attachmentSurfaceId,
          authority_id: attachmentAuthorityId,
          binding_ids: [attachmentTargetBindingId],
          selection_id: attachmentSelectionId,
          evidence_ids: [attachmentEvidenceId],
          target_scope: targetScope
        }),
        manifestEntry({
          id: `expected-surface:p2-legal-08b:${P2_LEGAL_05_TARGET_JOB_CODE}`,
          key: `${GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL}#Sheet1!A4:O4`,
          surface_id: rowSurfaceId,
          authority_id: rowAuthorityId,
          binding_ids: [rowBindingId],
          selection_id: rowSelectionId,
          evidence_ids: [rowEvidenceId],
          target_scope: targetScope
        }),
        ...input.attachment_inventory.slice(1).map((attachment) => ({
          expected_surface_manifest_entry_id: identity<ExpectedSurfaceManifestEntryId>(
            `expected-surface:p2-legal-08b:attachment-${attachment.attachment_index}`
          ),
          expected_surface_key: attachment.exact_locator,
          source_surface_id: null,
          expectedness: "OPTIONAL" as const,
          requirement_level: "REQUIREMENT_BEARING" as const,
          authority_status: "UNRESOLVED" as const,
          binding_status: "UNRESOLVED" as const,
          material_binding_ids: [],
          version_selection_status: "UNRESOLVED" as const,
          coverage_status: "UNRESOLVED" as const,
          resolution_status: "UNRESOLVED" as const,
          target_scope: targetScope,
          evidence_ids: [noticeEvidenceId]
        }))
      ],
      inventory_completeness_status: "OPEN_UNRESOLVED",
      unexpected_surface_dispositions: input.attachment_inventory.slice(1).map(
        (attachment) => ({
          expected_surface_manifest_entry_id: identity<ExpectedSurfaceManifestEntryId>(
            `expected-surface:p2-legal-08b:attachment-${attachment.attachment_index}`
          ),
          disposition: "UNRESOLVED" as const,
          evidence_ids: [noticeEvidenceId],
          resolver_version: P2_LEGAL_08B_COMPOSITION_VERSION,
          schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
        })
      ),
      discovery_resolver_version: P2_LEGAL_08B_COMPOSITION_VERSION,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    evidence_registry: [
      {
        source_composition_evidence_id: noticeEvidenceId,
        snapshot_id: input.announcement_source.snapshot.snapshot_id,
        extracted_record_id: input.announcement_source.extracted_record.extracted_record_id,
        source_occurrence_version_id:
          input.announcement_source.version.source_occurrence_version_id,
        locator: noticeLocator,
        observed_at: input.announcement_source.snapshot.observed_at,
        extractor_version: input.announcement_source.version.materialization.extractor_version
      },
      {
        source_composition_evidence_id: attachmentEvidenceId,
        snapshot_id: input.target_source.snapshot.snapshot_id,
        extracted_record_id: input.target_source.extracted_record.extracted_record_id,
        source_occurrence_version_id: input.target_source.version.source_occurrence_version_id,
        locator: attachmentLocator,
        observed_at: input.target_source.snapshot.observed_at,
        extractor_version: input.target_source.version.materialization.extractor_version
      },
      {
        source_composition_evidence_id: rowEvidenceId,
        snapshot_id: input.target_source.snapshot.snapshot_id,
        extracted_record_id: input.target_source.extracted_record.extracted_record_id,
        source_occurrence_version_id: input.target_source.version.source_occurrence_version_id,
        locator: rowLocator,
        observed_at: input.target_source.snapshot.observed_at,
        extractor_version: input.target_source.version.materialization.extractor_version
      }
    ],
    source_surfaces: surfaces,
    source_surface_bindings: bindings,
    authority_assertions: [
      {
        authority_assertion_id: noticeAuthorityId,
        asserted_source_surface_id: noticeSurfaceId,
        authority_basis_source_surface_id: noticeSurfaceId,
        authority_basis_binding_id: noticeBindingId,
        issuer: "贵州省司法厅",
        authority_state: "OFFICIAL_AUTHORITATIVE",
        target_scope: targetScope,
        effective_period: { effective_from: publishedAt },
        evidence_ids: [noticeEvidenceId],
        resolver_version: P2_LEGAL_08B_COMPOSITION_VERSION,
        schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
      },
      {
        authority_assertion_id: attachmentAuthorityId,
        asserted_source_surface_id: attachmentSurfaceId,
        authority_basis_source_surface_id: noticeSurfaceId,
        authority_basis_binding_id: attachmentPublicationBindingId,
        issuer: "贵州省司法厅",
        authority_state: "OFFICIAL_AUTHORITATIVE",
        target_scope: targetScope,
        effective_period: { effective_from: publishedAt },
        evidence_ids: [attachmentEvidenceId],
        resolver_version: P2_LEGAL_08B_COMPOSITION_VERSION,
        schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
      },
      {
        authority_assertion_id: rowAuthorityId,
        asserted_source_surface_id: rowSurfaceId,
        authority_basis_source_surface_id: noticeSurfaceId,
        authority_basis_binding_id: rowPublicationBindingId,
        issuer: "贵州省司法厅",
        authority_state: "OFFICIAL_AUTHORITATIVE",
        target_scope: targetScope,
        effective_period: { effective_from: publishedAt },
        evidence_ids: [rowEvidenceId],
        resolver_version: P2_LEGAL_08B_COMPOSITION_VERSION,
        schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
      }
    ],
    source_version_selections: [
      selection(noticeSelectionId, GUIZHOU_LEGAL_CANARY_NOTICE_URL, noticeSurfaceId,
        noticeEvidenceId, targetScope, publishedAt, compositionAsOf),
      selection(attachmentSelectionId, GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
        attachmentSurfaceId, attachmentEvidenceId, targetScope, publishedAt,
        compositionAsOf),
      selection(rowSelectionId, `${GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL}#Sheet1!A4:O4`,
        rowSurfaceId, rowEvidenceId, targetScope, publishedAt, compositionAsOf)
    ],
    surface_revision_relations: [],
    precedence_decisions: [{
      precedence_decision_id: identity<SourcePrecedenceDecisionId>(
        "source-precedence-decision:p2-legal-08b:observed-package"
      ),
      selected_source_surface_ids: [noticeSurfaceId, attachmentSurfaceId, rowSurfaceId],
      excluded_source_surface_ids: [],
      applicable_scope: targetScope,
      effective_period: { effective_from: publishedAt },
      composition_as_of: compositionAsOf,
      authority_assertion_ids: [noticeAuthorityId, attachmentAuthorityId, rowAuthorityId],
      precedence_rule: "OFFICIAL_PACKAGE_WITH_EXACT_TARGET_ROW",
      evidence_ids: [noticeEvidenceId],
      decision_status: "RESOLVED",
      resolver_version: P2_LEGAL_08B_COMPOSITION_VERSION,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    source_conflicts: [],
    extractor_version: P2_LEGAL_08B_ANNOUNCEMENT_EXTRACTOR_VERSION,
    parser_version: P2_LEGAL_05_PARSER_VERSION,
    discovery_resolver_version: P2_LEGAL_08B_COMPOSITION_VERSION,
    composition_resolver_version: P2_LEGAL_08B_COMPOSITION_VERSION,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
    serialization_version: "canonical-json/1.0.0"
  };
}

function identitySource(
  artifact: TrustedSourceOccurrenceArtifact
): PositionIdentityResolutionInput {
  return {
    endpoint: artifact.endpoint,
    occurrence: artifact.occurrence,
    version: artifact.version,
    extracted_record: artifact.extracted_record,
    snapshot: artifact.snapshot
  };
}

function bindingContext(artifact: TrustedSourceOccurrenceArtifact) {
  return {
    source_occurrence_version_id: artifact.version.source_occurrence_version_id,
    snapshot_id: artifact.snapshot.snapshot_id,
    extracted_record_id: artifact.extracted_record.extracted_record_id,
    observed_at: artifact.snapshot.observed_at,
    resolver_version: P2_LEGAL_08B_COMPOSITION_VERSION
  };
}

function manifestEntry(input: {
  readonly id: string;
  readonly key: string;
  readonly surface_id: SourceSurfaceId;
  readonly authority_id: AuthorityAssertionId;
  readonly binding_ids: readonly SourceSurfaceBindingId[];
  readonly selection_id: SourceVersionSelectionId;
  readonly evidence_ids: readonly SourceCompositionEvidenceId[];
  readonly target_scope: string;
}) {
  return {
    expected_surface_manifest_entry_id: identity<ExpectedSurfaceManifestEntryId>(input.id),
    expected_surface_key: input.key,
    source_surface_id: input.surface_id,
    expectedness: "REQUIRED" as const,
    requirement_level: "REQUIREMENT_BEARING" as const,
    authority_status: "OFFICIAL_AUTHORITATIVE" as const,
    authority_assertion_id: input.authority_id,
    binding_status: "RESOLVED" as const,
    material_binding_ids: input.binding_ids,
    version_selection_status: "RESOLVED" as const,
    source_version_selection_id: input.selection_id,
    coverage_status: "COVERED" as const,
    resolution_status: "RESOLVED" as const,
    target_scope: input.target_scope,
    evidence_ids: input.evidence_ids
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
    resolver_version: P2_LEGAL_08B_COMPOSITION_VERSION,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
  };
}

function validateArchivedSource(
  bytes: Uint8Array,
  snapshot: Snapshot,
  expectedHash: string,
  expectedSnapshotId: Snapshot["snapshot_id"],
  expectedEndpointId: Snapshot["recruitment_endpoint_id"],
  expectedLocator: string
) {
  const actualHash = sha256(bytes);
  if (actualHash !== expectedHash
      || snapshot.snapshot_id !== expectedSnapshotId
      || snapshot.recruitment_endpoint_id !== expectedEndpointId
      || snapshot.request_metadata.locator !== expectedLocator
      || snapshot.content_hash !== expectedHash
      || snapshot.raw_blob_id !== `sha256:${expectedHash}`
      || snapshot.content_length !== bytes.byteLength
      || snapshot.transport_status !== "SUCCESS") {
    throw new P2Legal08bMaterializationError(
      `Archived source provenance mismatch for ${expectedLocator}`
    );
  }
}

function assertAttachmentIdentities(
  attachments: readonly TargetAttachmentInventoryEntry[]
) {
  const expected = [
    ["P020250210600360721175.xlsx", "贵州省司法厅所属事业单位2025年公开招聘工作人员岗位及要求一览表"],
    ["P020250210600360755415.wps", "关于基层工作经历的范围界定"],
    ["P020250210600360787709.doc", "贵州省2025年全省事业单位公开招聘笔试报名信息表"],
    ["P020250210600360810960.wps", "符合专业比对条件报考人员承诺书"]
  ] as const;
  for (const [index, entry] of attachments.entries()) {
    if (entry.filename !== expected[index]?.[0]
        || entry.title !== expected[index]?.[1]) {
      throw new P2Legal08bMaterializationError(
        `Attachment ${index + 1} identity does not match the archived official notice`
      );
    }
  }
}

function attachmentDispositionReason(index: 1 | 2 | 3 | 4) {
  if (index === 1) {
    return "Archived Raw/Snapshot and exact target row establish requirement-bearing coverage";
  }
  if (index === 4) {
    return "The notice describes a conditional professional-comparison path, but the attachment Raw/content and target-specific closure are unavailable";
  }
  return "The official notice proves the attachment exists, but no archived Raw/content establishes a target-specific disposition";
}

function latestObservedAt(left: IsoDateTime, right: IsoDateTime) {
  return (left > right ? left : right) as IsoDateTime;
}

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function identity<Value extends string>(value: string) {
  return value as Value;
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
