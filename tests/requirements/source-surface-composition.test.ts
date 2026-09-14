import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSourceCompositionResultIntegrity,
  buildSourceCompositionResult
} from "../../lib/ingestion/requirements";
import {
  SOURCE_COMPOSITION_SCHEMA_VERSION,
  classifyLegacyRequirementSet,
  sourceSurfaceBindingHash,
  type AttachmentPublicationBinding,
  type AttachmentPublicationBindingId,
  type AttachmentToPositionBinding,
  type AttachmentToPositionBindingId,
  type AuthorityAssertionId,
  type DiscoveryBoundaryId,
  type ExpectedSurfaceManifestEntryId,
  type ExtractedRecordId,
  type IsoDateTime,
  type OpportunityVersionId,
  type PositionVersionId,
  type RequirementSetId,
  type SourceCompositionEvidenceId,
  type SourcePrecedenceDecisionId,
  type SourceCompositionInput,
  type SourceOccurrenceVersionId,
  type SourcePackageInventoryId,
  type SourceSurfaceBindingId,
  type SourceSurfaceId,
  type SourceVersionSelectionId,
  type SnapshotId
} from "../../lib/ingestion";

function branded<Value extends string>(value: string) {
  return value as Value;
}

const observedAt = branded<IsoDateTime>("2026-09-07T00:00:00.000+08:00");

function completeInput(suffix = "complete"): SourceCompositionInput {
  const opportunityVersionId = branded<OpportunityVersionId>(
    `opportunity-version-${suffix}`
  );
  const surfaceId = branded<SourceSurfaceId>(`surface-${suffix}`);
  const evidenceId = branded<SourceCompositionEvidenceId>(`evidence-${suffix}`);
  const bindingId = branded<SourceSurfaceBindingId>(`binding-${suffix}`);
  const authorityId = branded<AuthorityAssertionId>(`authority-${suffix}`);
  const selectionId = branded<SourceVersionSelectionId>(`selection-${suffix}`);
  const entryId = branded<ExpectedSurfaceManifestEntryId>(`entry-${suffix}`);

  return {
    opportunity_version_id: opportunityVersionId,
    composition_as_of: observedAt,
    discovery_boundary: {
      discovery_boundary_id: branded<DiscoveryBoundaryId>(`boundary-${suffix}`),
      opportunity_version_id: opportunityVersionId,
      boundary_kind: "ANNOUNCEMENT_PACKAGE",
      initiating_source_surface_ids: [surfaceId],
      source_metadata_references: ["official-source"],
      discovery_scope: "official announcement package",
      admissible_relation_kinds: ["ORIGINAL", "SUPPLEMENT", "CORRECTION"],
      evidence_ids: [evidenceId],
      composition_as_of: observedAt,
      observed_at: observedAt,
      extractor_version: "synthetic-extractor/1",
      discovery_resolver_version: "synthetic-discovery/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    inventory: {
      source_package_inventory_id: branded<SourcePackageInventoryId>(`inventory-${suffix}`),
      discovery_boundary_id: branded<DiscoveryBoundaryId>(`boundary-${suffix}`),
      composition_as_of: observedAt,
      discovered_source_surface_ids: [surfaceId],
      expected_surface_entries: [{
        expected_surface_manifest_entry_id: entryId,
        expected_surface_key: `announcement-body-${suffix}`,
        source_surface_id: surfaceId,
        expectedness: "REQUIRED",
        requirement_level: "REQUIREMENT_BEARING",
        authority_status: "OFFICIAL_AUTHORITATIVE",
        authority_assertion_id: authorityId,
        binding_status: "RESOLVED",
        material_binding_ids: [bindingId],
        version_selection_status: "RESOLVED",
        source_version_selection_id: selectionId,
        coverage_status: "COVERED",
        resolution_status: "RESOLVED",
        target_scope: "opportunity-version",
        evidence_ids: [evidenceId]
      }],
      inventory_completeness_status: "CLOSED",
      unexpected_surface_dispositions: [],
      discovery_resolver_version: "synthetic-discovery/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    evidence_registry: [{
      source_composition_evidence_id: evidenceId,
      snapshot_id: branded<SnapshotId>(`snapshot-${suffix}`),
      extracted_record_id: branded<ExtractedRecordId>(`record-${suffix}`),
      source_occurrence_version_id: branded<SourceOccurrenceVersionId>(
        `occurrence-version-${suffix}`
      ),
      locator: {
        kind: "SPREADSHEET",
        sheet: "岗位表",
        cell_or_range: "H12",
        field_path: "requirements"
      },
      observed_at: observedAt,
      extractor_version: "synthetic-extractor/1"
    }],
    source_surfaces: [{
      source_surface_id: surfaceId,
      surface_kind: "ANNOUNCEMENT_BODY",
      source_occurrence_version_id: branded<SourceOccurrenceVersionId>(
        `occurrence-version-${suffix}`
      ),
      snapshot_id: branded<SnapshotId>(`snapshot-${suffix}`),
      extracted_record_id: branded<ExtractedRecordId>(`record-${suffix}`),
      locator: {
        kind: "SPREADSHEET",
        sheet: "岗位表",
        cell_or_range: "H12",
        field_path: "requirements"
      },
      surface_content_hash: `surface-content-${suffix}`,
      effective_period: { effective_from: observedAt },
      source_publication_time: observedAt,
      observed_at: observedAt,
      surface_status: "PARSED",
      composition_role: "PRIMARY",
      target_scope: "opportunity-version",
      evidence_ids: [evidenceId],
      extractor_version: "synthetic-extractor/1",
      parser_version: "synthetic-parser/1",
      resolver_version: "synthetic-resolver/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    source_surface_bindings: [{
      source_surface_binding_id: bindingId,
      source_surface_id: surfaceId,
      target_type: "OPPORTUNITY_VERSION",
      target_id: opportunityVersionId,
      target_version_id: opportunityVersionId,
      binding_kind: "ANNOUNCEMENT_UNIFORM",
      binding_status: "RESOLVED",
      evidence_ids: [evidenceId],
      created_context: {
        source_occurrence_version_id: branded<SourceOccurrenceVersionId>(
          `occurrence-version-${suffix}`
        ),
        snapshot_id: branded<SnapshotId>(`snapshot-${suffix}`),
        extracted_record_id: branded<ExtractedRecordId>(`record-${suffix}`),
        observed_at: observedAt,
        resolver_version: "synthetic-resolver/1"
      },
      observed_context: {
        source_occurrence_version_id: branded<SourceOccurrenceVersionId>(
          `occurrence-version-${suffix}`
        ),
        snapshot_id: branded<SnapshotId>(`snapshot-${suffix}`),
        extracted_record_id: branded<ExtractedRecordId>(`record-${suffix}`),
        observed_at: observedAt,
        resolver_version: "synthetic-resolver/1"
      },
      locator: {
        kind: "SPREADSHEET",
        sheet: "岗位表",
        cell_or_range: "H12",
        field_path: "requirements"
      },
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    authority_assertions: [{
      authority_assertion_id: authorityId,
      asserted_source_surface_id: surfaceId,
      authority_basis_source_surface_id: surfaceId,
      authority_basis_binding_id: bindingId,
      issuer: "official-publisher",
      authority_state: "OFFICIAL_AUTHORITATIVE",
      target_scope: "opportunity-version",
      effective_period: { effective_from: observedAt },
      evidence_ids: [evidenceId],
      resolver_version: "synthetic-authority/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    source_version_selections: [{
      source_version_selection_id: selectionId,
      source_identity: "official-announcement",
      target_scope: "opportunity-version",
      candidate_source_surface_ids: [surfaceId],
      selected_source_surface_id: surfaceId,
      excluded_source_surface_ids: [],
      selection_status: "RESOLVED",
      source_publication_time: observedAt,
      effective_period: { effective_from: observedAt },
      observation_time: observedAt,
      ingestion_time: observedAt,
      evidence_ids: [evidenceId],
      resolver_version: "synthetic-selection/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    surface_revision_relations: [],
    precedence_decisions: [{
      precedence_decision_id: branded<SourcePrecedenceDecisionId>(
        `precedence-${suffix}`
      ),
      selected_source_surface_ids: [surfaceId],
      excluded_source_surface_ids: [],
      applicable_scope: "opportunity-version",
      effective_period: { effective_from: observedAt },
      composition_as_of: observedAt,
      authority_assertion_ids: [authorityId],
      precedence_rule: "EXPLICIT_TARGET_SCOPE",
      evidence_ids: [evidenceId],
      decision_status: "RESOLVED",
      resolver_version: "synthetic-precedence/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    source_conflicts: [],
    extractor_version: "synthetic-extractor/1",
    parser_version: "synthetic-parser/1",
    discovery_resolver_version: "synthetic-discovery/1",
    composition_resolver_version: "synthetic-composer/1",
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
    serialization_version: "synthetic-serialization/1"
  };
}

function attachmentBackedInput(suffix = "attachment"): SourceCompositionInput {
  const baseline = completeInput(suffix);
  const announcementSurfaceId = branded<SourceSurfaceId>(
    `announcement-surface-${suffix}`
  );
  const attachmentSurfaceId = branded<SourceSurfaceId>(
    `attachment-surface-${suffix}`
  );
  const publicationBindingId = branded<SourceSurfaceBindingId>(
    `attachment-publication-binding-${suffix}`
  );
  const rowBindingId = branded<SourceSurfaceBindingId>(
    `attachment-row-binding-${suffix}`
  );
  const attachmentPublicationBindingId = branded<AttachmentPublicationBindingId>(
    `attachment-publication-${suffix}`
  );
  const attachmentToPositionBindingId = branded<AttachmentToPositionBindingId>(
    `attachment-row-${suffix}`
  );
  const positionVersionId = branded<PositionVersionId>(`position-version-${suffix}`);
  const authorityId = baseline.authority_assertions[0].authority_assertion_id;
  const selectionId = baseline.source_version_selections[0].source_version_selection_id;
  const publicationBinding: AttachmentPublicationBinding = {
    ...baseline.source_surface_bindings[0],
    source_surface_binding_id: publicationBindingId,
    source_surface_id: attachmentSurfaceId,
    target_type: "ANNOUNCEMENT_VERSION",
    target_id: `announcement-version-${suffix}`,
    target_version_id: `announcement-version-${suffix}`,
    binding_kind: "ATTACHMENT_PUBLICATION",
    attachment_publication_binding_id: attachmentPublicationBindingId,
    attachment_surface_id: attachmentSurfaceId,
    publication_source_surface_id: announcementSurfaceId
  };
  const rowBinding: AttachmentToPositionBinding = {
    ...baseline.source_surface_bindings[0],
    source_surface_binding_id: rowBindingId,
    source_surface_id: attachmentSurfaceId,
    target_type: "OPPORTUNITY_VERSION",
    target_id: baseline.opportunity_version_id,
    target_version_id: baseline.opportunity_version_id,
    binding_kind: "ATTACHMENT_ROW",
    attachment_to_position_binding_id: attachmentToPositionBindingId,
    attachment_publication_binding_id: attachmentPublicationBindingId,
    attachment_surface_id: attachmentSurfaceId,
    position_version_id: positionVersionId,
    opportunity_version_id: baseline.opportunity_version_id,
    row_locator: "12",
    binding_version: "synthetic-binding/1"
  };

  return {
    ...baseline,
    discovery_boundary: {
      ...baseline.discovery_boundary,
      initiating_source_surface_ids: [announcementSurfaceId]
    },
    inventory: {
      ...baseline.inventory,
      discovered_source_surface_ids: [announcementSurfaceId, attachmentSurfaceId],
      expected_surface_entries: [
        {
          ...baseline.inventory.expected_surface_entries[0],
          expected_surface_manifest_entry_id: branded(
            `announcement-reference-entry-${suffix}`
          ),
          expected_surface_key: `announcement-reference-${suffix}`,
          source_surface_id: announcementSurfaceId,
          expectedness: "REFERENCE_ONLY",
          requirement_level: "NON_REQUIREMENT_REFERENCE",
          authority_status: "UNRESOLVED",
          authority_assertion_id: undefined,
          binding_status: "UNRESOLVED",
          material_binding_ids: [],
          version_selection_status: "UNRESOLVED",
          source_version_selection_id: undefined,
          coverage_status: "COVERED",
          resolution_status: "RESOLVED"
        },
        {
          ...baseline.inventory.expected_surface_entries[0],
          source_surface_id: attachmentSurfaceId,
          material_binding_ids: [rowBindingId]
        }
      ]
    },
    source_surfaces: [
      {
        ...baseline.source_surfaces[0],
        source_surface_id: announcementSurfaceId,
        surface_kind: "ANNOUNCEMENT_BODY",
        surface_content_hash: `announcement-content-${suffix}`
      },
      {
        ...baseline.source_surfaces[0],
        source_surface_id: attachmentSurfaceId,
        surface_kind: "ANNOUNCEMENT_ATTACHMENT",
        surface_content_hash: `attachment-content-${suffix}`
      }
    ],
    source_surface_bindings: [publicationBinding, rowBinding],
    authority_assertions: [{
      ...baseline.authority_assertions[0],
      authority_assertion_id: authorityId,
      asserted_source_surface_id: attachmentSurfaceId,
      authority_basis_source_surface_id: announcementSurfaceId,
      authority_basis_binding_id: publicationBindingId
    }],
    source_version_selections: [{
      ...baseline.source_version_selections[0],
      source_version_selection_id: selectionId,
      candidate_source_surface_ids: [attachmentSurfaceId],
      selected_source_surface_id: attachmentSurfaceId
    }],
    precedence_decisions: [{
      ...baseline.precedence_decisions[0],
      selected_source_surface_ids: [attachmentSurfaceId]
    }]
  };
}

test("complete composition is hash-verified and records all material contracts", () => {
  const result = buildSourceCompositionResult(completeInput());

  assert.equal(result.status, "COMPLETE");
  assert.equal(result.source_surfaces.length, 1);
  assert.equal(result.source_surface_bindings.length, 1);
  assert.equal(result.authority_assertions.length, 1);
  assert.doesNotThrow(() => assertSourceCompositionResultIntegrity(result));
});

test("OPTIONAL requirement-bearing unresolved surfaces cannot derive COMPLETE", () => {
  const baseline = completeInput("optional-requirement-bearing-unresolved");
  const unresolvedEntryId = branded<ExpectedSurfaceManifestEntryId>(
    "entry-optional-requirement-bearing-unresolved-extra"
  );
  const input: SourceCompositionInput = {
    ...baseline,
    inventory: {
      ...baseline.inventory,
      expected_surface_entries: [
        ...baseline.inventory.expected_surface_entries,
        {
          expected_surface_manifest_entry_id: unresolvedEntryId,
          expected_surface_key: "official-conditional-attachment",
          source_surface_id: null,
          expectedness: "OPTIONAL",
          requirement_level: "REQUIREMENT_BEARING",
          authority_status: "UNRESOLVED",
          binding_status: "UNRESOLVED",
          material_binding_ids: [],
          version_selection_status: "UNRESOLVED",
          coverage_status: "UNRESOLVED",
          resolution_status: "UNRESOLVED",
          target_scope: "opportunity-version",
          evidence_ids: baseline.discovery_boundary.evidence_ids
        }
      ],
      inventory_completeness_status: "CLOSED",
      unexpected_surface_dispositions: [{
        expected_surface_manifest_entry_id: unresolvedEntryId,
        disposition: "UNRESOLVED",
        evidence_ids: baseline.discovery_boundary.evidence_ids,
        resolver_version: "synthetic-discovery/1",
        schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
      }]
    }
  };

  assert.equal(buildSourceCompositionResult(input).status, "REVIEW_REQUIRED");
});

test("required missing attachment blocks COMPLETE without candidate failure", () => {
  const baseline = completeInput("missing-attachment");
  const input: SourceCompositionInput = {
    ...baseline,
    inventory: {
      ...baseline.inventory,
      expected_surface_entries: [
        {
          ...baseline.inventory.expected_surface_entries[0],
          expected_surface_manifest_entry_id: branded("announcement-surface-retained"),
          expected_surface_key: "announcement-surface-retained",
          expectedness: "REFERENCE_ONLY",
          requirement_level: "NON_REQUIREMENT_REFERENCE",
          authority_status: "UNRESOLVED",
          authority_assertion_id: undefined,
          binding_status: "UNRESOLVED",
          material_binding_ids: [],
          version_selection_status: "UNRESOLVED",
          source_version_selection_id: undefined
        },
        {
          ...baseline.inventory.expected_surface_entries[0],
          expected_surface_manifest_entry_id: branded("missing-attachment-entry"),
          expected_surface_key: "missing-attachment",
          source_surface_id: null,
          authority_status: "UNRESOLVED",
          authority_assertion_id: undefined,
          binding_status: "UNRESOLVED",
          material_binding_ids: [],
          version_selection_status: "UNRESOLVED",
          source_version_selection_id: undefined,
          coverage_status: "MISSING",
          resolution_status: "UNRESOLVED"
        }
      ]
    }
  };

  const result = buildSourceCompositionResult(input);
  assert.equal(result.status, "INCOMPLETE");
});

test("parser-version mutation invalidates a composition hash", () => {
  const result = buildSourceCompositionResult(completeInput("parser-hash"));
  const mutated = structuredClone(result);
  (mutated as { parser_version: string }).parser_version = "synthetic-parser/2";

  assert.throws(() => assertSourceCompositionResultIntegrity(mutated));
});

test("unresolved authority, binding, version, and conflict never become COMPLETE", () => {
  const authorityBaseline = completeInput("authority-unknown");
  const authority: SourceCompositionInput = {
    ...authorityBaseline,
    inventory: {
      ...authorityBaseline.inventory,
    expected_surface_entries: [{
        ...authorityBaseline.inventory.expected_surface_entries[0],
      authority_status: "UNKNOWN",
      resolution_status: "UNRESOLVED"
      }]
    },
    authority_assertions: [{
      ...authorityBaseline.authority_assertions[0],
      authority_state: "UNKNOWN"
    }]
  };
  assert.equal(buildSourceCompositionResult(authority).status, "REVIEW_REQUIRED");

  const bindingBaseline = completeInput("binding-unknown");
  const binding: SourceCompositionInput = {
    ...bindingBaseline,
    inventory: {
      ...bindingBaseline.inventory,
    expected_surface_entries: [{
        ...bindingBaseline.inventory.expected_surface_entries[0],
      binding_status: "TARGET_VERSION_MISMATCH",
      resolution_status: "UNRESOLVED"
      }]
    },
    source_surface_bindings: [{
      ...bindingBaseline.source_surface_bindings[0],
      binding_status: "TARGET_VERSION_MISMATCH"
    }]
  };
  assert.equal(buildSourceCompositionResult(binding).status, "REVIEW_REQUIRED");

  const versionBaseline = completeInput("version-unknown");
  const version: SourceCompositionInput = {
    ...versionBaseline,
    inventory: {
      ...versionBaseline.inventory,
    expected_surface_entries: [{
        ...versionBaseline.inventory.expected_surface_entries[0],
      version_selection_status: "EFFECTIVE_TIME_UNKNOWN",
      resolution_status: "UNRESOLVED"
      }]
    },
    source_version_selections: [{
      ...versionBaseline.source_version_selections[0],
      selected_source_surface_id: null,
      selection_status: "EFFECTIVE_TIME_UNKNOWN"
    }]
  };
  assert.equal(buildSourceCompositionResult(version).status, "REVIEW_REQUIRED");

  const conflictBaseline = completeInput("required-conflict");
  const conflict: SourceCompositionInput = {
    ...conflictBaseline,
    source_conflicts: [{
    source_conflict_id: branded("conflict-required"),
      competing_source_surface_ids: [
        conflictBaseline.source_surfaces[0].source_surface_id
      ],
    target_scope: "opportunity-version",
    requirement_scope: "education",
    competing_observation_ids: ["observation-a", "observation-b"],
      authority_assertion_ids: [
        conflictBaseline.authority_assertions[0].authority_assertion_id
      ],
    effective_period: { effective_from: observedAt },
      evidence_ids: [
        conflictBaseline.evidence_registry[0].source_composition_evidence_id
      ],
    status: "DETECTED",
    affects_required_coverage: true,
    resolver_version: "synthetic-conflict/1",
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }]
  };
  assert.equal(buildSourceCompositionResult(conflict).status, "CONFLICT");
});

test("third-party and unexpected Requirement surfaces cannot manufacture COMPLETE", () => {
  const thirdPartyBaseline = completeInput("third-party-required");
  const thirdParty: SourceCompositionInput = {
    ...thirdPartyBaseline,
    inventory: {
      ...thirdPartyBaseline.inventory,
    expected_surface_entries: [{
        ...thirdPartyBaseline.inventory.expected_surface_entries[0],
      authority_status: "THIRD_PARTY_REFERENCE_ONLY",
        authority_assertion_id:
          thirdPartyBaseline.authority_assertions[0].authority_assertion_id
      }]
    },
    authority_assertions: [{
      ...thirdPartyBaseline.authority_assertions[0],
      authority_state: "THIRD_PARTY_REFERENCE_ONLY"
    }]
  };
  assert.equal(buildSourceCompositionResult(thirdParty).status, "REVIEW_REQUIRED");

  const unexpectedBaseline = completeInput("unexpected-requirement-surface");
  const unexpected: SourceCompositionInput = {
    ...unexpectedBaseline,
    inventory: {
      ...unexpectedBaseline.inventory,
    expected_surface_entries: [
        ...unexpectedBaseline.inventory.expected_surface_entries,
      {
          ...unexpectedBaseline.inventory.expected_surface_entries[0],
        expected_surface_manifest_entry_id: branded("unexpected-entry"),
        expected_surface_key: "unexpected-requirement-surface",
        expectedness: "UNEXPECTED",
        requirement_level: "REQUIREMENT_BEARING",
        resolution_status: "UNRESOLVED"
      }
      ]
    }
  };
  assert.equal(buildSourceCompositionResult(unexpected).status, "REVIEW_REQUIRED");
});

test("an official and third-party Requirement disagreement remains an evidenced CONFLICT", () => {
  const baseline = completeInput("official-third-party-conflict");
  const thirdPartySurfaceId = branded<SourceSurfaceId>("third-party-surface");
  const thirdPartyEvidenceId = branded<SourceCompositionEvidenceId>(
    "third-party-evidence"
  );
  const thirdPartyBindingId = branded<SourceSurfaceBindingId>(
    "third-party-binding"
  );
  const thirdPartyAuthorityId = branded<AuthorityAssertionId>(
    "third-party-authority"
  );
  const thirdPartySelectionId = branded<SourceVersionSelectionId>(
    "third-party-selection"
  );
  const thirdPartySnapshotId = branded<SnapshotId>("third-party-snapshot");
  const thirdPartyRecordId = branded<ExtractedRecordId>("third-party-record");
  const thirdPartyOccurrenceId = branded<SourceOccurrenceVersionId>(
    "third-party-occurrence"
  );
  const input: SourceCompositionInput = {
    ...baseline,
    inventory: {
      ...baseline.inventory,
      discovered_source_surface_ids: [
        ...baseline.inventory.discovered_source_surface_ids,
        thirdPartySurfaceId
      ],
      expected_surface_entries: [
        ...baseline.inventory.expected_surface_entries,
        {
          ...baseline.inventory.expected_surface_entries[0],
          expected_surface_manifest_entry_id: branded("third-party-entry"),
          expected_surface_key: "third-party-reference",
          source_surface_id: thirdPartySurfaceId,
          expectedness: "REFERENCE_ONLY",
          requirement_level: "REQUIREMENT_BEARING",
          authority_status: "THIRD_PARTY_REFERENCE_ONLY",
          authority_assertion_id: thirdPartyAuthorityId,
          binding_status: "RESOLVED",
          material_binding_ids: [thirdPartyBindingId],
          version_selection_status: "RESOLVED",
          source_version_selection_id: thirdPartySelectionId,
          coverage_status: "COVERED",
          resolution_status: "RESOLVED",
          evidence_ids: [thirdPartyEvidenceId]
        }
      ]
    },
    evidence_registry: [
      ...baseline.evidence_registry,
      {
        ...baseline.evidence_registry[0],
        source_composition_evidence_id: thirdPartyEvidenceId,
        snapshot_id: thirdPartySnapshotId,
        extracted_record_id: thirdPartyRecordId,
        source_occurrence_version_id: thirdPartyOccurrenceId
      }
    ],
    source_surfaces: [
      ...baseline.source_surfaces,
      {
        ...baseline.source_surfaces[0],
        source_surface_id: thirdPartySurfaceId,
        surface_kind: "THIRD_PARTY_RECORD",
        source_occurrence_version_id: thirdPartyOccurrenceId,
        snapshot_id: thirdPartySnapshotId,
        extracted_record_id: thirdPartyRecordId,
        surface_content_hash: "third-party-content",
        evidence_ids: [thirdPartyEvidenceId],
        composition_role: "REFERENCE"
      }
    ],
    source_surface_bindings: [
      ...baseline.source_surface_bindings,
      {
        ...baseline.source_surface_bindings[0],
        source_surface_binding_id: thirdPartyBindingId,
        source_surface_id: thirdPartySurfaceId,
        evidence_ids: [thirdPartyEvidenceId],
        created_context: {
          ...baseline.source_surface_bindings[0].created_context,
          source_occurrence_version_id: thirdPartyOccurrenceId,
          snapshot_id: thirdPartySnapshotId,
          extracted_record_id: thirdPartyRecordId
        },
        observed_context: {
          ...baseline.source_surface_bindings[0].observed_context,
          source_occurrence_version_id: thirdPartyOccurrenceId,
          snapshot_id: thirdPartySnapshotId,
          extracted_record_id: thirdPartyRecordId
        }
      }
    ],
    authority_assertions: [
      ...baseline.authority_assertions,
      {
        ...baseline.authority_assertions[0],
        authority_assertion_id: thirdPartyAuthorityId,
        asserted_source_surface_id: thirdPartySurfaceId,
        authority_basis_source_surface_id: thirdPartySurfaceId,
        authority_basis_binding_id: undefined,
        authority_state: "THIRD_PARTY_REFERENCE_ONLY",
        evidence_ids: [thirdPartyEvidenceId]
      }
    ],
    source_version_selections: [
      ...baseline.source_version_selections,
      {
        ...baseline.source_version_selections[0],
        source_version_selection_id: thirdPartySelectionId,
        candidate_source_surface_ids: [thirdPartySurfaceId],
        selected_source_surface_id: thirdPartySurfaceId,
        evidence_ids: [thirdPartyEvidenceId]
      }
    ],
    source_conflicts: [{
      source_conflict_id: branded("official-third-party-conflict"),
      competing_source_surface_ids: [
        baseline.source_surfaces[0].source_surface_id,
        thirdPartySurfaceId
      ],
      target_scope: "opportunity-version",
      requirement_scope: "education",
      competing_observation_ids: ["official-observation", "third-party-observation"],
      authority_assertion_ids: [
        baseline.authority_assertions[0].authority_assertion_id,
        thirdPartyAuthorityId
      ],
      effective_period: { effective_from: observedAt },
      evidence_ids: [
        baseline.evidence_registry[0].source_composition_evidence_id,
        thirdPartyEvidenceId
      ],
      status: "DETECTED",
      affects_required_coverage: true,
      resolver_version: "synthetic-conflict/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }]
  };

  assert.equal(buildSourceCompositionResult(input).status, "CONFLICT");
});

test("a RESOLVED version selection requires an actual selected surface", () => {
  const baseline = completeInput("selection-without-selected-surface");
  const input: SourceCompositionInput = {
    ...baseline,
    source_version_selections: [{
      ...baseline.source_version_selections[0],
      selected_source_surface_id: null
    }]
  };

  assert.throws(() => buildSourceCompositionResult(input));
});

test("unresolved discovery boundaries and inventories never produce COMPLETE", () => {
  const boundaryBaseline = completeInput("unresolved-boundary");
  const unresolvedBoundary: SourceCompositionInput = {
    ...boundaryBaseline,
    discovery_boundary: {
      ...boundaryBaseline.discovery_boundary,
      boundary_kind: "UNRESOLVED"
    }
  };
  assert.equal(buildSourceCompositionResult(unresolvedBoundary).status, "UNRESOLVED");

  const inventoryBaseline = completeInput("unresolved-inventory");
  const unresolvedInventory: SourceCompositionInput = {
    ...inventoryBaseline,
    inventory: {
      ...inventoryBaseline.inventory,
      inventory_completeness_status: "OPEN_UNRESOLVED"
    }
  };
  assert.equal(buildSourceCompositionResult(unresolvedInventory).status, "UNRESOLVED");
});

test("a classified-looking unexpected Requirement surface still blocks COMPLETE", () => {
  const baseline = completeInput("unexpected-classification-required");
  const input: SourceCompositionInput = {
    ...baseline,
    inventory: {
      ...baseline.inventory,
      expected_surface_entries: [
        ...baseline.inventory.expected_surface_entries,
        {
          ...baseline.inventory.expected_surface_entries[0],
          expected_surface_manifest_entry_id: branded("unexpected-classified-entry"),
          expected_surface_key: "unexpected-classified-surface",
          expectedness: "UNEXPECTED",
          requirement_level: "REQUIREMENT_BEARING",
          resolution_status: "RESOLVED"
        }
      ]
    }
  };

  assert.equal(buildSourceCompositionResult(input).status, "REVIEW_REQUIRED");
});

test("an evidenced out-of-scope unexpected surface remains retained without blocking", () => {
  const baseline = completeInput("unexpected-out-of-scope");
  const unexpectedEntryId = branded<ExpectedSurfaceManifestEntryId>(
    "unexpected-out-of-scope-entry"
  );
  const input: SourceCompositionInput = {
    ...baseline,
    inventory: {
      ...baseline.inventory,
      expected_surface_entries: [
        ...baseline.inventory.expected_surface_entries,
        {
          ...baseline.inventory.expected_surface_entries[0],
          expected_surface_manifest_entry_id: unexpectedEntryId,
          expected_surface_key: "unexpected-out-of-scope-surface",
          expectedness: "UNEXPECTED",
          requirement_level: "REQUIREMENT_BEARING"
        }
      ],
      unexpected_surface_dispositions: [{
        expected_surface_manifest_entry_id: unexpectedEntryId,
        disposition: "EVIDENCED_OUT_OF_SCOPE",
        evidence_ids: [
          baseline.evidence_registry[0].source_composition_evidence_id
        ],
        resolver_version: "synthetic-disposition/1",
        schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
      }]
    }
  };

  assert.equal(buildSourceCompositionResult(input).status, "COMPLETE");
});

test("an unresolved material revision relation blocks COMPLETE and remains retained", () => {
  const baseline = completeInput("unresolved-revision-relation");
  const input: SourceCompositionInput = {
    ...baseline,
    surface_revision_relations: [{
      surface_revision_relation_id: branded("revision-unresolved"),
      source_surface_id: baseline.source_surfaces[0].source_surface_id,
      target_surface_ids: [baseline.source_surfaces[0].source_surface_id],
      relation_kind: "CORRECTION",
      relation_status: "UNRESOLVED",
      target_scope: "opportunity-version",
      requirement_scope: "education",
      effective_period: { effective_from: observedAt },
      authority_assertion_ids: [
        baseline.authority_assertions[0].authority_assertion_id
      ],
      evidence_ids: [
        baseline.evidence_registry[0].source_composition_evidence_id
      ],
      resolver_version: "synthetic-revision/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
      affects_required_coverage: true
    }]
  };

  assert.equal(buildSourceCompositionResult(input).status, "REVIEW_REQUIRED");
});

test("evidenced correction, supplement, and superseding relations retain history and remain composable", () => {
  for (const relationKind of [
    "CORRECTION",
    "SUPPLEMENT",
    "SUPERSEDES"
  ] as const) {
    const baseline = completeInput(`resolved-${relationKind.toLowerCase()}`);
    const input: SourceCompositionInput = {
      ...baseline,
      surface_revision_relations: [{
        surface_revision_relation_id: branded(
          `revision-${relationKind.toLowerCase()}`
        ),
        source_surface_id: baseline.source_surfaces[0].source_surface_id,
        target_surface_ids: [baseline.source_surfaces[0].source_surface_id],
        relation_kind: relationKind,
        relation_status: "RESOLVED",
        target_scope: "opportunity-version",
        requirement_scope: "education",
        effective_period: { effective_from: observedAt },
        authority_assertion_ids: [
          baseline.authority_assertions[0].authority_assertion_id
        ],
        evidence_ids: [
          baseline.evidence_registry[0].source_composition_evidence_id
        ],
        resolver_version: "synthetic-revision/1",
        schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
        affects_required_coverage: true
      }]
    };
    const result = buildSourceCompositionResult(input);

    assert.equal(result.status, "COMPLETE");
    assert.equal(result.surface_revision_relations.length, 1);
    assert.equal(result.source_surfaces.length, 1);
  }
});

test("historical/current version uncertainty and required source conflicts never become COMPLETE", () => {
  const historicalBaseline = completeInput("historical-current-unresolved");
  const historical: SourceCompositionInput = {
    ...historicalBaseline,
    inventory: {
      ...historicalBaseline.inventory,
      expected_surface_entries: [{
        ...historicalBaseline.inventory.expected_surface_entries[0],
        version_selection_status: "RELATION_UNRESOLVED",
        resolution_status: "UNRESOLVED"
      }]
    },
    source_version_selections: [{
      ...historicalBaseline.source_version_selections[0],
      selected_source_surface_id: null,
      selection_status: "RELATION_UNRESOLVED"
    }]
  };
  assert.equal(buildSourceCompositionResult(historical).status, "REVIEW_REQUIRED");

  const conflictBaseline = completeInput("required-source-conflict");
  const conflict: SourceCompositionInput = {
    ...conflictBaseline,
    source_conflicts: [{
      source_conflict_id: branded("required-source-conflict"),
      competing_source_surface_ids: [
        conflictBaseline.source_surfaces[0].source_surface_id
      ],
      target_scope: "opportunity-version",
      requirement_scope: "education",
      competing_observation_ids: ["official-observation", "third-party-observation"],
      authority_assertion_ids: [
        conflictBaseline.authority_assertions[0].authority_assertion_id
      ],
      effective_period: { effective_from: observedAt },
      evidence_ids: [
        conflictBaseline.evidence_registry[0].source_composition_evidence_id
      ],
      status: "DETECTED",
      affects_required_coverage: true,
      resolver_version: "synthetic-conflict/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }]
  };
  assert.equal(buildSourceCompositionResult(conflict).status, "CONFLICT");
});

test("an official attachment requires a verified publication-to-row binding chain", () => {
  const result = buildSourceCompositionResult(attachmentBackedInput());

  assert.equal(result.status, "COMPLETE");
  assert.equal(result.source_surfaces.length, 2);
  assert.equal(result.source_surface_bindings.length, 2);

  const mutated = structuredClone(result) as unknown as {
    source_surface_bindings: Array<{ row_locator?: string }>;
  };
  mutated.source_surface_bindings[1].row_locator = "13";
  assert.throws(() => assertSourceCompositionResultIntegrity(mutated as never));
});

test("attachment rows cannot target a different OpportunityVersion", () => {
  const baseline = attachmentBackedInput("row-target-mismatch");
  const input: SourceCompositionInput = {
    ...baseline,
    source_surface_bindings: baseline.source_surface_bindings.map((binding) => {
      if (binding.binding_kind !== "ATTACHMENT_ROW") return binding;
      return {
        ...binding,
        opportunity_version_id: branded<OpportunityVersionId>("opportunity-version-other")
      };
    })
  };

  assert.throws(() => buildSourceCompositionResult(input));
});

test("a material SourceSurface requires an exact OpportunityVersion binding", () => {
  const baseline = completeInput("binding-without-exact-opportunity");
  const input: SourceCompositionInput = {
    ...baseline,
    source_surface_bindings: [{
      ...baseline.source_surface_bindings[0],
      target_type: "POSITION_VERSION",
      target_id: "position-version-only",
      target_version_id: "position-version-only",
      binding_kind: "SURFACE_DECLARATION"
    }]
  };

  assert.throws(() => buildSourceCompositionResult(input));
});

test("legacy Requirement Sets remain readable and explicitly uncomposed", () => {
  const classification = classifyLegacyRequirementSet(
    branded<RequirementSetId>("requirement-set:legacy-historical")
  );

  assert.equal(classification.readability, "READABLE");
  assert.equal(classification.composition_state, "LEGACY_UNCOMPOSED");
});

test("a closed inventory cannot omit a discovered SourceSurface from its manifest", () => {
  const baseline = completeInput("unmanifested-surface");
  const input: SourceCompositionInput = {
    ...baseline,
    inventory: {
      ...baseline.inventory,
      expected_surface_entries: []
    }
  };

  assert.throws(() => buildSourceCompositionResult(input));
});

test("nested canonical hashes are persisted, self-excluding, and verification-required", () => {
  const result = buildSourceCompositionResult(completeInput("nested-hashes"));
  const nested = result as unknown as {
    discovery_boundary: { discovery_boundary_hash?: string };
    inventory: {
      source_package_inventory_hash?: string;
      expected_surface_entries: Array<{
        expected_surface_manifest_entry_hash?: string;
      }>;
    };
    source_surface_bindings: Array<{ binding_hash?: string }>;
    authority_assertions: Array<{ authority_assertion_hash?: string }>;
    source_version_selections: Array<{
      source_version_selection_hash?: string;
    }>;
    precedence_decisions: Array<{
      source_precedence_decision_hash?: string;
    }>;
  };
  const hashPattern = /^sha256:[a-f0-9]{64}$/;

  assert.match(nested.discovery_boundary.discovery_boundary_hash ?? "", hashPattern);
  assert.match(nested.inventory.source_package_inventory_hash ?? "", hashPattern);
  assert.match(
    nested.inventory.expected_surface_entries[0].expected_surface_manifest_entry_hash ?? "",
    hashPattern
  );
  assert.match(nested.source_surface_bindings[0].binding_hash ?? "", hashPattern);
  assert.match(
    nested.authority_assertions[0].authority_assertion_hash ?? "",
    hashPattern
  );
  assert.match(
    nested.source_version_selections[0].source_version_selection_hash ?? "",
    hashPattern
  );
  assert.match(
    nested.precedence_decisions[0].source_precedence_decision_hash ?? "",
    hashPattern
  );

  const binding = nested.source_surface_bindings[0];
  assert.equal(
    sourceSurfaceBindingHash({ ...binding, binding_hash: "sha256:0".padEnd(71, "0") } as never),
    sourceSurfaceBindingHash({ ...binding, binding_hash: "sha256:f".padEnd(71, "f") } as never)
  );

  const missingBindingHash = structuredClone(result) as unknown as {
    source_surface_bindings: Array<{ binding_hash?: string }>;
  };
  delete missingBindingHash.source_surface_bindings[0].binding_hash;
  assert.throws(() => assertSourceCompositionResultIntegrity(missingBindingHash as never));

  const tamperedSelectionHash = structuredClone(result) as unknown as {
    source_version_selections: Array<{ source_version_selection_hash?: string }>;
  };
  tamperedSelectionHash.source_version_selections[0].source_version_selection_hash =
    "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  assert.throws(() => assertSourceCompositionResultIntegrity(tamperedSelectionHash as never));

  const mutatedBinding = structuredClone(result) as unknown as {
    source_surface_bindings: Array<{ target_id: string }>;
  };
  mutatedBinding.source_surface_bindings[0].target_id = "opportunity-version-mutated";
  assert.throws(() => assertSourceCompositionResultIntegrity(mutatedBinding as never));

  const attachmentResult = buildSourceCompositionResult(
    attachmentBackedInput("nested-attachment-hashes")
  ) as unknown as {
    source_surface_bindings: Array<{ binding_hash?: string }>;
  };
  assert.match(attachmentResult.source_surface_bindings[0].binding_hash ?? "", hashPattern);
  assert.match(attachmentResult.source_surface_bindings[1].binding_hash ?? "", hashPattern);
});

test("every nested canonical hash rejects absence or tampering without changing candidate semantics", () => {
  const baseline = buildSourceCompositionResult(completeInput("all-nested-hashes"));
  assertNestedHashIntegrityFailures(baseline, [
    (result, hash) => {
      result.discovery_boundary.discovery_boundary_hash = hash;
    },
    (result, hash) => {
      result.inventory.source_package_inventory_hash = hash;
    },
    (result, hash) => {
      result.inventory.expected_surface_entries[0].expected_surface_manifest_entry_hash = hash;
    },
    (result, hash) => {
      result.source_surface_bindings[0].binding_hash = hash;
    },
    (result, hash) => {
      result.authority_assertions[0].authority_assertion_hash = hash;
    },
    (result, hash) => {
      result.source_version_selections[0].source_version_selection_hash = hash;
    },
    (result, hash) => {
      result.precedence_decisions[0].source_precedence_decision_hash = hash;
    }
  ]);

  const revisionBaseline = completeInput("revision-nested-hash");
  const revision = buildSourceCompositionResult({
    ...revisionBaseline,
    surface_revision_relations: [{
      surface_revision_relation_id: branded("revision-nested-hash"),
      source_surface_id: revisionBaseline.source_surfaces[0].source_surface_id,
      target_surface_ids: [revisionBaseline.source_surfaces[0].source_surface_id],
      relation_kind: "CORRECTION",
      relation_status: "RESOLVED",
      target_scope: "opportunity-version",
      requirement_scope: "education",
      effective_period: { effective_from: observedAt },
      authority_assertion_ids: [
        revisionBaseline.authority_assertions[0].authority_assertion_id
      ],
      evidence_ids: [
        revisionBaseline.evidence_registry[0].source_composition_evidence_id
      ],
      resolver_version: "synthetic-revision/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
      affects_required_coverage: true
    }]
  });
  assertNestedHashIntegrityFailures(revision, [(result, hash) => {
    result.surface_revision_relations[0].surface_revision_relation_hash = hash;
  }]);

  const conflictBaseline = completeInput("conflict-nested-hash");
  const conflict = buildSourceCompositionResult({
    ...conflictBaseline,
    source_conflicts: [{
      source_conflict_id: branded("conflict-nested-hash"),
      competing_source_surface_ids: [
        conflictBaseline.source_surfaces[0].source_surface_id
      ],
      target_scope: "opportunity-version",
      requirement_scope: "education",
      competing_observation_ids: ["observation-a", "observation-b"],
      authority_assertion_ids: [
        conflictBaseline.authority_assertions[0].authority_assertion_id
      ],
      effective_period: { effective_from: observedAt },
      evidence_ids: [
        conflictBaseline.evidence_registry[0].source_composition_evidence_id
      ],
      status: "DETECTED",
      affects_required_coverage: true,
      resolver_version: "synthetic-conflict/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }]
  });
  assert.equal(conflict.status, "CONFLICT");
  assertNestedHashIntegrityFailures(conflict, [(result, hash) => {
    result.source_conflicts[0].source_conflict_hash = hash;
  }]);
});

type MutableNestedHashResult = {
  discovery_boundary: { discovery_boundary_hash?: string };
  inventory: {
    source_package_inventory_hash?: string;
    expected_surface_entries: Array<{
      expected_surface_manifest_entry_hash?: string;
    }>;
  };
  source_surface_bindings: Array<{ binding_hash?: string }>;
  authority_assertions: Array<{ authority_assertion_hash?: string }>;
  source_version_selections: Array<{
    source_version_selection_hash?: string;
  }>;
  surface_revision_relations: Array<{
    surface_revision_relation_hash?: string;
  }>;
  precedence_decisions: Array<{
    source_precedence_decision_hash?: string;
  }>;
  source_conflicts: Array<{ source_conflict_hash?: string }>;
};

function assertNestedHashIntegrityFailures(
  result: unknown,
  mutators: ReadonlyArray<
    (result: MutableNestedHashResult, hash: string | undefined) => void
  >
) {
  for (const mutate of mutators) {
    const missing = structuredClone(result) as MutableNestedHashResult;
    mutate(missing, undefined);
    assert.throws(() => assertSourceCompositionResultIntegrity(missing as never));

    const tampered = structuredClone(result) as MutableNestedHashResult;
    mutate(
      tampered,
      "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    );
    assert.throws(() => assertSourceCompositionResultIntegrity(tampered as never));
  }
}
