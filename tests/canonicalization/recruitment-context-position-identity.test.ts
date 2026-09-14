import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  ConservativeCanonicalizer,
  DeterministicEligibilityEngine,
  DeterministicRequirementParser,
  EligibilityInputError,
  InMemoryCanonicalOpportunityVersionTracker,
  InMemorySourceOccurrenceTracker,
  POSITION_IDENTITY_BASIS_KINDS,
  POSITION_IDENTITY_CONTRACT_VERSION,
  POSITION_VERSION_MATERIALIZATION_VERSION,
  POSITION_VERSION_SCHEMA_VERSION,
  OpportunityContractValidationError,
  PositionContractValidationError,
  SourceNormalizationError,
  UTF8_TEXT_ENCODING,
  buildIdentityBasis,
  canonicalizePositionIdentityBasis,
  normalizeExtractedRecord,
  positionIdForIdentityBasis,
  positionCanonicalHashFor,
  positionIdentityHashFor,
  positionVersionIdFor,
  positionVersionIntegrityHashFor,
  positionVersionSemanticHashFor,
  semanticHashFor,
  validateHeadcountObservation,
  validateIdentityAlias,
  validateIdentityReconciliation,
  validatePosition,
  validatePositionBoundOpportunityVersion,
  validatePositionIdentityBasis,
  validatePositionVersion,
  type Announcement,
  type AnnouncementId,
  type AnnouncementVersion,
  type AnnouncementVersionId,
  type CandidateProfile,
  type CandidateProfileId,
  type CanonicalOpportunityId,
  type CanonicalizationCandidate,
  type ExtractedRecord,
  type ExtractedRecordId,
  type ExtractedRecruitmentIdentityClaim,
  type HeadcountObservation,
  type HeadcountObservationId,
  type IdentityAlias,
  type IdentityAliasId,
  type IdentityEvidenceId,
  type IdentityHash,
  type IdentityReconciliation,
  type IdentityReconciliationId,
  type IsoDate,
  type IsoDateTime,
  type LocationAssignment,
  type LocationAssignmentId,
  type OpportunityVersion,
  type OpportunityVersionId,
  type Organization,
  type OrganizationId,
  type OrganizationRoleAssignment,
  type OrganizationRoleAssignmentId,
  type OriginalText,
  type Position,
  type PositionId,
  type PositionVersion,
  type PositionVersionId,
  type PositionIdentityBasis,
  type RecruitmentBatch,
  type RecruitmentBatchId,
  type RecruitmentEndpoint,
  type RecruitmentEndpointId,
  type RecruitmentPlan,
  type RecruitmentPlanId,
  type RecruitmentPopulationReference,
  type RecruitmentPopulationReferenceId,
  type RecruitmentRevisionRelation,
  type RecruitmentRevisionRelationId,
  type SemanticHash,
  type SnapshotId,
  type SourceDefinition,
  type SourceDefinitionId,
  type SourceOccurrenceId,
  type SourceOccurrenceVersionId
} from "../../lib/ingestion";

function branded<Value extends string>(value: string) {
  return value as Value;
}

function original(text: string): OriginalText {
  return { text, encoding: UTF8_TEXT_ENCODING };
}

function traceable(text: string) {
  return {
    original: original(text),
    normalized: {
      text,
      unicode_form: "NFKC" as const,
      normalizer_version: "recruitment-context-test/1.0.0",
      operations: []
    }
  };
}

const publisherId = branded<OrganizationId>("organization-official-publisher");
const recruiterId = branded<OrganizationId>("organization-recruiter");
const employerId = branded<OrganizationId>("organization-employer");
const otherEmployerId = branded<OrganizationId>("organization-other-employer");
const platformId = branded<OrganizationId>("organization-platform");

const organizations: readonly Organization[] = [
  {
    organization_id: publisherId,
    name: traceable("示例政府发布机关"),
    aliases: [],
    country_code: "CN"
  },
  {
    organization_id: recruiterId,
    name: traceable("示例招聘主管单位"),
    aliases: [],
    country_code: "CN"
  },
  {
    organization_id: employerId,
    name: traceable("示例用人单位"),
    aliases: [],
    country_code: "CN"
  },
  {
    organization_id: otherEmployerId,
    name: traceable("另一示例用人单位"),
    aliases: [],
    country_code: "CN"
  },
  {
    organization_id: platformId,
    name: traceable("示例第三方平台"),
    aliases: [],
    country_code: "CN"
  }
];

const officialSource: SourceDefinition = {
  source_definition_id: branded<SourceDefinitionId>("source-context-official"),
  publisher_organization_id: publisherId,
  name: traceable("示例政府官方招聘"),
  publisher_kind: "GOVERNMENT_PORTAL",
  authority_level: "OFFICIAL",
  scope: "MULTI_ORGANIZATION",
  enabled: true
};

const authorizedSource: SourceDefinition = {
  source_definition_id: branded<SourceDefinitionId>("source-context-authorized"),
  publisher_organization_id: recruiterId,
  name: traceable("示例招聘主管单位网站"),
  publisher_kind: "INDUSTRY_SYSTEM",
  authority_level: "AUTHORIZED",
  scope: "MULTI_ORGANIZATION",
  enabled: true
};

const thirdPartySource: SourceDefinition = {
  source_definition_id: branded<SourceDefinitionId>("source-context-platform"),
  publisher_organization_id: platformId,
  name: traceable("示例第三方招聘平台"),
  publisher_kind: "THIRD_PARTY_PLATFORM",
  authority_level: "THIRD_PARTY",
  scope: "NATIONAL",
  enabled: true
};

type IdentityState = "CONFIRMED" | "PROVISIONAL" | "UNRESOLVED";

interface ContextOptions {
  readonly source?: SourceDefinition;
  readonly recordId?: string;
  readonly row?: number;
  readonly title?: string;
  readonly announcementCode?: string;
  readonly announcementUrl?: string;
  readonly planCode?: string;
  readonly planState?: IdentityState;
  readonly batchCode?: string;
  readonly batchState?: IdentityState;
  readonly batchApplicability?: "APPLICABLE" | "NOT_APPLICABLE" | "UNRESOLVED";
  readonly positionCode?: string;
  readonly positionNamespace?: string;
  readonly positionState?: IdentityState;
  readonly opportunityCode?: string;
  readonly requirementText?: string | null;
  readonly employer?: OrganizationId | null;
  readonly employerName?: string;
  readonly employerLocation?: string;
  readonly workLocation?: string;
  readonly locationDiscriminator?: boolean;
  readonly headcount?: "SEVERAL" | number | "NOT_OBSERVED";
  readonly revisionRelationIds?: readonly RecruitmentRevisionRelationId[];
}

let sequence = 0;

function evidenceLocator(row: number, fieldPath: string) {
  return {
    kind: "SPREADSHEET" as const,
    sheet: "岗位表",
    cell_or_range: `A${row}:Z${row}`,
    field_path: fieldPath
  };
}

function extractedClaim(
  state: IdentityState,
  value: string,
  namespace: string,
  row: number,
  fieldPath: string
): ExtractedRecruitmentIdentityClaim {
  if (state === "CONFIRMED") {
    return {
      identity_state: "CONFIRMED",
      official_identifier: original(value),
      identifier_namespace: namespace,
      evidence_locator: evidenceLocator(row, fieldPath)
    };
  }
  if (state === "PROVISIONAL") {
    return {
      identity_state: "PROVISIONAL",
      source_local_identifier: original(value),
      evidence_locator: evidenceLocator(row, fieldPath)
    };
  }
  return {
    identity_state: "UNRESOLVED",
    raw_text: original(value),
    evidence_locator: evidenceLocator(row, fieldPath)
  };
}

function endpointFor(source: SourceDefinition, label: string): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: branded<RecruitmentEndpointId>(`endpoint-${label}`),
    source_definition_id: source.source_definition_id,
    name: traceable(`Endpoint ${label}`),
    coverage_regions: [{ raw_text: original("全国") }],
    locator: `fixture://recruitment-context/${label}`,
    content_kind: "FILE",
    adapter_key: "synthetic-recruitment-context",
    decoded_text_encoding: "UTF-8",
    collection_config: {
      max_items: 1,
      max_pages: 1,
      follow_redirects: false,
      retry_limit: 0
    },
    enabled: true
  };
}

function recordFor(options: ContextOptions = {}): ExtractedRecord {
  sequence += 1;
  const row = options.row ?? sequence + 1;
  const source = options.source ?? officialSource;
  const planCode = options.planCode ?? "PLAN-2027";
  const batchApplicability = options.batchApplicability ?? "APPLICABLE";
  const positionCode = options.positionCode ?? "POSITION-001";
  const recordId = options.recordId ?? `row-${row}-${sequence}`;
  return {
    extracted_record_id: branded<ExtractedRecordId>(`extracted-context-${sequence}`),
    snapshot_id: branded<SnapshotId>(`snapshot-context-${sequence}`),
    source_definition_id: source.source_definition_id,
    identity_candidates: [{
      kind: "SOURCE_RECORD_ID",
      value: recordId,
      confidence: "HIGH"
    }],
    raw_source_record_id: recordId,
    raw_title: original(options.title ?? "法务岗"),
    raw_organization_name: original(options.employerName ?? "示例用人单位"),
    raw_location_text: [original(options.workLocation ?? "北京")],
    raw_requirement_text: options.requirementText === null
      ? undefined
      : original(options.requirementText ?? "本科及以上，法学专业"),
    announcement_url: options.announcementUrl
      ?? "https://official.example.test/announcement/2027",
    recruitment_year: original("2027年"),
    recruitment_batch: original(options.batchCode ?? "第一批"),
    recruitment_context: {
      announcement: extractedClaim(
        "CONFIRMED",
        options.announcementCode ?? "ANNOUNCEMENT-2027",
        "official:announcement",
        row,
        "announcement_code"
      ),
      recruitment_plan: extractedClaim(
        options.planState ?? "CONFIRMED",
        planCode,
        "official:recruitment-plan",
        row,
        "plan_code"
      ),
      recruitment_batch: {
        applicability: batchApplicability,
        ...(batchApplicability === "NOT_APPLICABLE"
          ? {}
          : {
              identity: extractedClaim(
                options.batchState ?? "CONFIRMED",
                options.batchCode ?? "BATCH-1",
                `official:recruitment-plan:${planCode}:batch`,
                row,
                "batch_code"
              )
            })
      },
      position: extractedClaim(
        options.positionState ?? "CONFIRMED",
        positionCode,
        options.positionNamespace ?? `official:recruitment-plan:${planCode}:position`,
        row,
        "position_code"
      ),
      opportunity: options.opportunityCode
        ? extractedClaim(
            "CONFIRMED",
            options.opportunityCode,
            "official:opportunity",
            row,
            "opportunity_code"
          )
        : { identity_state: "UNRESOLVED" }
    },
    source_record_locator: {
      kind: "DOCUMENT",
      section: "岗位表",
      text_locator: `row:${row}`
    },
    adapter_metadata: {
      synthetic: { row }
    },
    extraction: {
      extractor_name: "synthetic-recruitment-context",
      extractor_version: "1.0.0",
      extracted_at: branded<IsoDateTime>(
        `2026-09-${String(Math.min(sequence, 28)).padStart(2, "0")}T08:00:00+08:00`
      )
    }
  };
}

function contextCandidate(options: ContextOptions = {}): CanonicalizationCandidate {
  const source = options.source ?? officialSource;
  const record = recordFor({ ...options, source });
  const endpoint = endpointFor(source, `${sequence}`);
  const tracked = new InMemorySourceOccurrenceTracker().process(endpoint, record);
  const evidenceIds = tracked.version.identity_evidence!.map((evidence) => {
    return evidence.identity_evidence_id;
  });
  const primaryEvidence = evidenceIds[0] as IdentityEvidenceId;
  const effectiveEmployer = options.employer === undefined ? employerId : options.employer;
  const organizationRoleAssignments: readonly OrganizationRoleAssignment[] = [
    {
      organization_role_assignment_id: branded<OrganizationRoleAssignmentId>(
        `organization-role-publisher-${sequence}`
      ),
      role: "PUBLISHER",
      organization_id: source.publisher_organization_id,
      identity_state: "CONFIRMED",
      identity_evidence_ids: [primaryEvidence]
    },
    {
      organization_role_assignment_id: branded<OrganizationRoleAssignmentId>(
        `organization-role-recruiter-${sequence}`
      ),
      role: "RECRUITING_ENTITY",
      organization_id: recruiterId,
      identity_state: "CONFIRMED",
      identity_evidence_ids: [primaryEvidence]
    },
    {
      organization_role_assignment_id: branded<OrganizationRoleAssignmentId>(
        `organization-role-employer-${sequence}`
      ),
      role: "EMPLOYER_ENTITY",
      ...(effectiveEmployer ? { organization_id: effectiveEmployer } : {}),
      identity_state: effectiveEmployer ? "CONFIRMED" : "UNRESOLVED",
      raw_name: traceable(options.employerName ?? "示例用人单位"),
      identity_evidence_ids: [primaryEvidence]
    }
  ];
  const employerLocation = options.employerLocation ?? "北京";
  const workLocation = options.workLocation ?? "北京";
  const locationAssignments: readonly LocationAssignment[] = [
    {
      location_assignment_id: branded<LocationAssignmentId>(
        `location-employer-${sequence}`
      ),
      role: "EMPLOYER_LOCATION",
      assignment_mode: "SINGLE",
      locations: [{
        city: employerLocation,
        raw_text: original(employerLocation),
        is_nationwide: false,
        normalization_confidence: 1
      }],
      identity_discriminator: false,
      identity_state: "CONFIRMED",
      identity_evidence_ids: [primaryEvidence]
    },
    {
      location_assignment_id: branded<LocationAssignmentId>(
        `location-work-${sequence}`
      ),
      role: "WORK_LOCATION",
      assignment_mode: "SINGLE",
      locations: [{
        city: workLocation,
        raw_text: original(workLocation),
        is_nationwide: false,
        normalization_confidence: 1
      }],
      identity_discriminator: options.locationDiscriminator ?? false,
      identity_state: "CONFIRMED",
      identity_evidence_ids: [primaryEvidence]
    }
  ];
  const headcountObservations = options.headcount === undefined
    ? undefined
    : [headcountObservation(options.headcount, primaryEvidence, sequence)];
  const content = {
    ...tracked.version.content,
    organization: {
      ...tracked.version.content.organization,
      ...(effectiveEmployer ? { organization_id: effectiveEmployer } : {})
    },
    organization_role_assignments: organizationRoleAssignments,
    location_assignments: locationAssignments,
    ...(headcountObservations
      ? { headcount_observations: headcountObservations }
      : {}),
    ...(options.revisionRelationIds
      ? { recruitment_revision_relation_ids: options.revisionRelationIds }
      : {})
  };
  return {
    occurrence: tracked.occurrence,
    version: {
      ...tracked.version,
      content,
      semantic_hash: semanticHashFor(content)
    },
    source_definition: source
  };
}

function headcountObservation(
  value: ContextOptions["headcount"],
  evidenceId: IdentityEvidenceId,
  suffix: number
): HeadcountObservation {
  const base = {
    headcount_observation_id: branded<HeadcountObservationId>(
      `headcount-${suffix}`
    ),
    evidence_ids: [evidenceId] as const,
    observer_version: "headcount-test/1.0.0"
  };
  if (typeof value === "number") {
    return {
      ...base,
      state: "EXACT",
      raw_text: original(`${value}人`),
      normalized_count: value
    };
  }
  if (value === "SEVERAL") {
    return {
      ...base,
      state: "SEVERAL",
      raw_text: original("若干")
    };
  }
  return {
    ...base,
    state: "NOT_OBSERVED",
    raw_text: null
  };
}

function canonicalize(candidates: readonly CanonicalizationCandidate[]) {
  return new ConservativeCanonicalizer().canonicalize(candidates, { organizations });
}

test("Control A: one announcement with same-title Positions remains row-scoped", () => {
  const first = contextCandidate({
    positionCode: "001",
    row: 10,
    requirementText: "本科法学专业"
  });
  const second = contextCandidate({
    positionCode: "002",
    row: 11,
    requirementText: "研究生法律专业"
  });
  const result = canonicalize([first, second]);

  assert.equal(result.opportunities.length, 2);
  assert.deepEqual(result.decisions[0].reason_codes, ["POSITION_IDENTITY_CONFLICT"]);
  assert.deepEqual(
    result.opportunities.map((item) => {
      return item.opportunity_version.content.requirement_text?.original.text;
    }).sort(),
    ["本科法学专业", "研究生法律专业"].sort()
  );
});

test("Control B: one Position in different confirmed Batches stays separate", () => {
  const firstBatch = contextCandidate({ positionCode: "010", batchCode: "BATCH-1" });
  const secondBatch = contextCandidate({ positionCode: "010", batchCode: "BATCH-2" });
  const result = canonicalize([firstBatch, secondBatch]);

  assert.equal(result.opportunities.length, 2);
  assert.ok(result.decisions[0].reason_codes.includes(
    "RECRUITMENT_BATCH_IDENTITY_CONFLICT"
  ));
});

test("Control C: officially distinct location-coded Positions stay separate", () => {
  const beijing = contextCandidate({
    positionCode: "BJ-001",
    workLocation: "北京",
    locationDiscriminator: true
  });
  const shanghai = contextCandidate({
    positionCode: "SH-001",
    workLocation: "上海",
    locationDiscriminator: true
  });
  const result = canonicalize([beijing, shanghai]);

  assert.equal(result.opportunities.length, 2);
  assert.ok(result.decisions[0].reason_codes.includes("POSITION_IDENTITY_CONFLICT"));
  assert.ok(result.decisions[0].reason_codes.includes(
    "LOCATION_IDENTITY_DISCRIMINATOR_CONFLICT"
  ));
});

test("Control D: equal title/year/batch/location cannot override different codes", () => {
  const left = contextCandidate({ positionCode: "CODE-A" });
  const right = contextCandidate({ positionCode: "CODE-B" });
  const result = canonicalize([left, right]);

  assert.equal(result.opportunities.length, 2);
  assert.equal(result.decisions[0].outcome, "SEPARATE");
  assert.ok(result.decisions[0].reason_codes.includes("POSITION_IDENTITY_CONFLICT"));
});

test("Control E: explicit announcement correction creates source versions without identity loss", () => {
  const endpoint = endpointFor(officialSource, "control-e");
  const tracker = new InMemorySourceOccurrenceTracker();
  const firstRecord = recordFor({
    source: officialSource,
    recordId: "correction-row-1",
    row: 30,
    positionCode: "CORRECTED-001",
    requirementText: "法学、法律专业"
  });
  const secondRecord = recordFor({
    source: officialSource,
    recordId: "correction-row-1",
    row: 30,
    positionCode: "CORRECTED-001",
    requirementText: "法学专业"
  });
  const first = tracker.process(endpoint, firstRecord);
  const second = tracker.process(endpoint, secondRecord);

  assert.equal(first.occurrence.source_occurrence_id, second.occurrence.source_occurrence_id);
  assert.equal(second.version.revision, 2);
  assert.equal(tracker.listVersions(first.occurrence.source_occurrence_id).length, 2);
  assert.notEqual(first.version.semantic_hash, second.version.semantic_hash);
  assert.ok(first.version.identity_evidence?.length);
  assert.ok(second.version.identity_evidence?.length);
});

test("Control F: a shared Announcement URL never merges different Positions", () => {
  const sharedUrl = "https://official.example.test/shared-announcement";
  const first = contextCandidate({
    announcementUrl: sharedUrl,
    positionCode: "SHARED-001"
  });
  const second = contextCandidate({
    announcementUrl: sharedUrl,
    positionCode: "SHARED-002"
  });
  const result = canonicalize([first, second]);

  assert.equal(first.occurrence.identity_basis.kind, "RECRUITMENT_CONTEXT");
  assert.equal(second.occurrence.identity_basis.kind, "RECRUITMENT_CONTEXT");
  assert.equal(result.opportunities.length, 2);
});

test("Control G: publisher, recruiter, and employer roles remain distinct", () => {
  const official = contextCandidate({ source: officialSource, positionCode: "ROLE-001" });
  const authorized = contextCandidate({
    source: authorizedSource,
    positionCode: "ROLE-001"
  });
  const result = canonicalize([authorized, official]);

  assert.equal(result.opportunities.length, 1);
  const assignments = result.opportunities[0].opportunity_version.content
    .organization_role_assignments!;
  assert.equal(assignments.find((item) => item.role === "PUBLISHER")?.organization_id,
    publisherId);
  assert.equal(assignments.find((item) => item.role === "RECRUITING_ENTITY")?.organization_id,
    recruiterId);
  assert.equal(assignments.find((item) => item.role === "EMPLOYER_ENTITY")?.organization_id,
    employerId);
});

test("Control H: employer location differing from work location is not identity conflict", () => {
  const left = contextCandidate({
    positionCode: "LOCATION-001",
    employerLocation: "北京",
    workLocation: "上海"
  });
  const right = contextCandidate({
    source: authorizedSource,
    positionCode: "LOCATION-001",
    employerLocation: "北京",
    workLocation: "上海"
  });
  const result = canonicalize([left, right]);

  assert.equal(result.opportunities.length, 1);
  assert.equal(result.decisions[0].outcome, "MERGE");
  assert.equal(result.decisions[0].reason_codes.includes("LOCATION_CONFLICT"), false);
});

test("Control I: headcount changes from several to three without changing identity", () => {
  const several = contextCandidate({ positionCode: "HEADCOUNT-001", headcount: "SEVERAL" });
  const exact = contextCandidate({
    source: authorizedSource,
    positionCode: "HEADCOUNT-001",
    headcount: 3
  });
  const severalCanonical = canonicalize([several]).opportunities[0];
  const exactCanonical = canonicalize([exact]).opportunities[0];
  const versionTracker = new InMemoryCanonicalOpportunityVersionTracker();
  const firstVersion = versionTracker.process(severalCanonical);
  const secondVersion = versionTracker.process(exactCanonical);

  assert.equal(
    severalCanonical.canonical_opportunity.identity_hash,
    exactCanonical.canonical_opportunity.identity_hash
  );
  assert.notEqual(several.version.semantic_hash, exact.version.semantic_hash);
  assert.equal(firstVersion.opportunity_version.revision, 1);
  assert.equal(secondVersion.opportunity_version.revision, 2);
  assert.equal(versionTracker.listVersions(
    firstVersion.canonical_opportunity.canonical_opportunity_id
  ).length, 2);
  assert.equal(validateHeadcountObservation(
    exact.version.content.headcount_observations![0]
  ).state, "EXACT");
});

test("Control J: missing Requirement attachment preserves Opportunity and blocks Eligibility", () => {
  const candidate = contextCandidate({
    positionCode: "MISSING-ATTACHMENT-001",
    requirementText: null
  });
  const canonicalized = canonicalize([candidate]).opportunities[0];
  const snapshotId = candidate.version.identity_evidence![0].snapshot_id;
  const parsed = new DeterministicRequirementParser().parse({
    opportunity_version: canonicalized.opportunity_version,
    evidence_fragments: [],
    expected_sources: [{
      extracted_record_id: candidate.version.extracted_record_id,
      snapshot_id: snapshotId
    }],
    blockers: [{
      code: "ATTACHMENT_MISSING",
      description: "Official announcement references an unavailable attachment"
    }]
  });

  assert.equal(canonicalized.canonical_opportunity.identity_state, "CONFIRMED");
  assert.equal(parsed.completeness.status, "INCOMPLETE");
  assert.equal(parsed.complete_requirement_set, null);
  let assessmentCreated = false;
  assert.throws(() => {
    const assessment = new DeterministicEligibilityEngine().evaluate({
      opportunity_version: canonicalized.opportunity_version,
      complete_requirement_set: parsed.requirement_set as never,
      candidate_profile: syntheticCandidateProfile(),
      assessed_at: branded<IsoDateTime>("2026-09-30T08:00:00+08:00")
    });
    assessmentCreated = assessment !== undefined;
  }, (error) => {
    return error instanceof EligibilityInputError
      && error.code === "REQUIREMENT_SET_INCOMPLETE";
  });
  assert.equal(assessmentCreated, false);
});

test("Control K: Requirement correction retains old and new Evidence lineage", () => {
  const relationId = branded<RecruitmentRevisionRelationId>("revision-relation-k");
  const oldVersion = contextCandidate({
    positionCode: "REQUIREMENT-CORRECTION-001",
    requirementText: "法学、法律专业"
  });
  const correctedVersion = contextCandidate({
    source: authorizedSource,
    positionCode: "REQUIREMENT-CORRECTION-001",
    requirementText: "法学专业",
    revisionRelationIds: [relationId]
  });
  const result = canonicalize([oldVersion, correctedVersion]);

  assert.equal(result.opportunities.length, 1);
  assert.equal(result.opportunities[0].opportunity_version.source_occurrence_version_ids.length,
    2);
  assert.equal(oldVersion.version.content.requirement_text?.original.text,
    "法学、法律专业");
  assert.equal(correctedVersion.version.content.requirement_text?.original.text,
    "法学专业");
  assert.deepEqual(correctedVersion.version.content.recruitment_revision_relation_ids,
    [relationId]);
});

test("Control L: third-party conflict cannot override official content", () => {
  const official = contextCandidate({
    source: officialSource,
    positionCode: "AUTHORITY-001",
    requirementText: "本科法学专业"
  });
  const thirdParty = contextCandidate({
    source: thirdPartySource,
    positionCode: "AUTHORITY-001",
    requirementText: "专业不限"
  });
  const result = canonicalize([thirdParty, official]);

  assert.equal(result.opportunities.length, 1);
  assert.equal(
    result.opportunities[0].opportunity_version.content.requirement_text?.original.text,
    "本科法学专业"
  );
  assert.equal(result.opportunities[0].opportunity_version.source_occurrence_version_ids.length,
    2);
});

test("unresolved Plan, Batch, Position, or Employer never drops an Opportunity", () => {
  const unresolvedPlan = contextCandidate({
    positionCode: "UNRESOLVED-PLAN",
    planState: "UNRESOLVED"
  });
  const unresolvedBatch = contextCandidate({
    positionCode: "UNRESOLVED-BATCH",
    batchState: "UNRESOLVED"
  });
  const unresolvedPosition = contextCandidate({
    positionCode: "UNRESOLVED-POSITION",
    positionState: "UNRESOLVED"
  });
  const unresolvedEmployer = contextCandidate({
    positionCode: "UNRESOLVED-EMPLOYER",
    employer: null
  });

  for (const candidate of [
    unresolvedPlan,
    unresolvedBatch,
    unresolvedPosition,
    unresolvedEmployer
  ]) {
    assert.equal(canonicalize([candidate]).opportunities.length, 1);
  }
  assert.equal(
    canonicalize([unresolvedPlan]).opportunities[0].canonical_opportunity.identity_state,
    "PROVISIONAL"
  );
  assert.equal(
    canonicalize([unresolvedBatch]).opportunities[0].canonical_opportunity.identity_state,
    "PROVISIONAL"
  );
  assert.equal(
    canonicalize([unresolvedPosition]).opportunities[0].canonical_opportunity.identity_state,
    "UNRESOLVED"
  );
  assert.equal(
    canonicalize([unresolvedEmployer]).opportunities[0].canonical_opportunity.identity_state,
    "PROVISIONAL"
  );
});

test("context identity rejects URL-only, title-only, and synthetic default identities", () => {
  const contextual = recordFor({
    positionCode: "URL-BOUNDARY-001",
    announcementUrl: "https://official.example.test/shared"
  });
  const basis = buildIdentityBasis(normalizeExtractedRecord(contextual));
  assert.equal(basis.kind, "RECRUITMENT_CONTEXT");

  const unresolvedFirst = contextCandidate({
    positionCode: "未知岗位",
    positionState: "UNRESOLVED",
    title: "同名法务岗"
  });
  const unresolvedSecond = contextCandidate({
    positionCode: "未知岗位",
    positionState: "UNRESOLVED",
    title: "同名法务岗"
  });
  assert.equal(canonicalize([unresolvedFirst, unresolvedSecond]).opportunities.length, 2);

  assert.throws(() => normalizeExtractedRecord(recordFor({
    planCode: "DEFAULT_PLAN"
  })), SourceNormalizationError);
  assert.throws(() => normalizeExtractedRecord(recordFor({
    batchCode: "DEFAULT_BATCH"
  })), SourceNormalizationError);
});

test("same Position code in different namespaces remains separate", () => {
  const first = contextCandidate({
    positionCode: "001",
    positionNamespace: "publisher-a:plan-2027:position"
  });
  const second = contextCandidate({
    positionCode: "001",
    positionNamespace: "publisher-b:plan-2027:position"
  });
  const result = canonicalize([first, second]);

  assert.equal(result.opportunities.length, 2);
  assert.ok(result.decisions[0].reason_codes.includes("POSITION_IDENTITY_CONFLICT"));
});

test("missing headcount is never normalized to zero", () => {
  const candidate = contextCandidate({
    positionCode: "NO-HEADCOUNT-001",
    headcount: "NOT_OBSERVED"
  });
  const observation = candidate.version.content.headcount_observations![0];
  assert.equal(observation.state, "NOT_OBSERVED");
  assert.equal("normalized_count" in observation, false);

  assert.throws(() => validateHeadcountObservation({
    ...observation,
    normalized_count: 0
  } as unknown as HeadcountObservation), /Only EXACT headcount/);
});

test("legacy identity remains provisional and requires explicit reconciliation", () => {
  const contextual = contextCandidate({ positionCode: "LEGACY-TARGET-001" });
  const legacy = legacyCandidate();
  const legacyId = branded<CanonicalOpportunityId>("legacy-opportunity-preserved");
  const legacyWithHistory = {
    ...legacy,
    legacy_canonical_opportunity_id: legacyId
  };
  const withoutReconciliation = new ConservativeCanonicalizer().canonicalize(
    [legacyWithHistory, contextual],
    { organizations }
  );
  assert.equal(withoutReconciliation.opportunities.length, 2);
  assert.ok(withoutReconciliation.decisions[0].reason_codes.includes(
    "LEGACY_CONTEXT_RECONCILIATION_MISSING"
  ));

  const contextualOnly = canonicalize([contextual]).opportunities[0];
  assert.equal(contextualOnly.canonical_opportunity.identity_basis?.kind,
    "RECRUITMENT_CONTEXT");
  if (contextualOnly.canonical_opportunity.identity_basis?.kind
      !== "RECRUITMENT_CONTEXT") {
    throw new Error("Expected contextual identity basis");
  }
  const reconciliation: IdentityReconciliation = {
    identity_reconciliation_id: branded<IdentityReconciliationId>(
      "legacy-context-reconciliation"
    ),
    reconciliation_kind: "MERGE",
    state: "CONFIRMED",
    from: [{ kind: "OPPORTUNITY", id: legacyId }],
    to: [{
      kind: "POSITION",
      id: contextualOnly.canonical_opportunity.identity_basis.position_id
    }],
    evidence_ids: [contextual.version.identity_evidence![0].identity_evidence_id],
    resolver_version: "manual-reconciliation/1.0.0",
    created_at: branded<IsoDateTime>("2026-09-30T09:00:00+08:00")
  };
  const reconciled = new ConservativeCanonicalizer().canonicalize(
    [legacyWithHistory, contextual],
    { organizations, identity_reconciliations: [reconciliation] }
  );

  assert.equal(validateIdentityReconciliation(reconciliation).state, "CONFIRMED");
  assert.equal(reconciled.opportunities.length, 1);
  assert.equal(reconciled.opportunities[0].opportunity_version
    .source_occurrence_version_ids.length, 2);
  assert.notEqual(reconciled.opportunities[0].canonical_opportunity
    .canonical_opportunity_id, legacyId);
  assert.equal(legacyWithHistory.legacy_canonical_opportunity_id, legacyId);
});

test("transitive merge is blocked when any pair has conflicting identity Evidence", () => {
  const first = contextCandidate({ positionCode: "TRANSITIVE-A" });
  const second = contextCandidate({ positionCode: "TRANSITIVE-B" });
  const third = contextCandidate({ positionCode: "TRANSITIVE-C" });
  const firstOutput = canonicalize([first]).opportunities[0].canonical_opportunity;
  const secondOutput = canonicalize([second]).opportunities[0].canonical_opportunity;
  const thirdOutput = canonicalize([third]).opportunities[0].canonical_opportunity;
  const positionId = (candidate: typeof firstOutput) => {
    if (candidate.identity_basis?.kind !== "RECRUITMENT_CONTEXT") {
      throw new Error("Expected contextual identity basis");
    }
    return candidate.identity_basis.position_id;
  };
  const relation = (
    id: string,
    from: PositionId,
    to: PositionId
  ): IdentityReconciliation => ({
    identity_reconciliation_id: branded<IdentityReconciliationId>(id),
    reconciliation_kind: "MERGE",
    state: "CONFIRMED",
    from: [{ kind: "POSITION", id: from }],
    to: [{ kind: "POSITION", id: to }],
    evidence_ids: [first.version.identity_evidence![0].identity_evidence_id],
    resolver_version: "manual-reconciliation/1.0.0",
    created_at: branded<IsoDateTime>("2026-09-30T10:00:00+08:00")
  });
  const result = new ConservativeCanonicalizer().canonicalize(
    [first, second, third],
    {
      organizations,
      identity_reconciliations: [
        relation("relation-a-b", positionId(firstOutput), positionId(secondOutput)),
        relation("relation-b-c", positionId(secondOutput), positionId(thirdOutput))
      ]
    }
  );

  assert.equal(result.opportunities.length, 2);
  assert.ok(result.decisions.some((item) => {
    return item.reason_codes.includes("TRANSITIVE_MERGE_CONFLICT_BLOCKED");
  }));
});

test("domain contracts preserve the complete recruitment object chain", () => {
  const evidenceId = branded<IdentityEvidenceId>("identity-evidence-domain-chain");
  const announcementId = branded<AnnouncementId>("announcement-domain-chain");
  const announcementVersionId = branded<AnnouncementVersionId>(
    "announcement-version-domain-chain"
  );
  const planId = branded<RecruitmentPlanId>("plan-domain-chain");
  const batchId = branded<RecruitmentBatchId>("batch-domain-chain");
  const positionBasis: PositionIdentityBasis = {
    kind: "OFFICIAL_POSITION_CODE",
    source_definition_id: officialSource.source_definition_id,
    position_code_namespace: "official:plan-domain-chain:position",
    official_position_code: "001"
  };
  const positionIdentityHash = positionIdentityHashFor(positionBasis);
  const positionId = positionIdForIdentityBasis(positionBasis);
  const positionVersionId = positionVersionIdFor(positionIdentityHash, 1);
  const sourceVersionId = branded<SourceOccurrenceVersionId>(
    "source-version-domain-chain"
  );
  const now = branded<IsoDateTime>("2026-09-30T11:00:00+08:00");
  const announcement: Announcement = {
    announcement_id: announcementId,
    identity_state: "CONFIRMED",
    publisher_organization_id: publisherId,
    identity_evidence_ids: [evidenceId],
    created_at: now
  };
  const announcementVersion: AnnouncementVersion = {
    announcement_version_id: announcementVersionId,
    announcement_id: announcementId,
    revision: 1,
    title: traceable("2027年度招聘公告"),
    locators: ["https://official.example.test/announcement/2027"],
    source_occurrence_version_ids: [sourceVersionId],
    snapshot_ids: [branded<SnapshotId>("snapshot-domain-chain")],
    relation_ids: [],
    effective_from: now
  };
  const plan: RecruitmentPlan = {
    recruitment_plan_id: planId,
    identity_state: "CONFIRMED",
    recruiting_entity_id: recruiterId,
    recruitment_year: 2027,
    project_name: traceable("2027年度招聘计划"),
    identity_evidence_ids: [evidenceId],
    announcement_ids: [announcementId],
    created_at: now
  };
  const batch: RecruitmentBatch = {
    recruitment_batch_id: batchId,
    recruitment_plan_id: planId,
    plan_identity_state: "CONFIRMED",
    identity_state: "CONFIRMED",
    official_batch_code: traceable("BATCH-1"),
    batch_label: traceable("第一批"),
    batch_kind: "FIRST_BATCH",
    identity_evidence_ids: [evidenceId],
    announcement_ids: [announcementId],
    created_at: now
  };
  const position: Position = {
    position_id: positionId,
    identity_state: "CONFIRMED",
    identity_basis: positionBasis,
    identity_hash: positionIdentityHash,
    identity_resolver_version: POSITION_IDENTITY_CONTRACT_VERSION,
    recruitment_plan_id: planId,
    plan_identity_state: "CONFIRMED",
    official_position_code: traceable("001"),
    position_code_namespace: "official:plan-domain-chain:position",
    identity_evidence_ids: [evidenceId],
    created_at: now
  };
  const roleAssignment: OrganizationRoleAssignment = {
    organization_role_assignment_id: branded<OrganizationRoleAssignmentId>(
      "organization-role-domain-chain"
    ),
    role: "EMPLOYER_ENTITY",
    organization_id: employerId,
    identity_state: "CONFIRMED",
    identity_evidence_ids: [evidenceId]
  };
  const locationAssignment: LocationAssignment = {
    location_assignment_id: branded<LocationAssignmentId>(
      "location-domain-chain"
    ),
    role: "WORK_LOCATION",
    assignment_mode: "SINGLE",
    locations: [{
      city: "北京",
      raw_text: original("北京"),
      is_nationwide: false,
      normalization_confidence: 1
    }],
    identity_discriminator: false,
    identity_state: "CONFIRMED",
    identity_evidence_ids: [evidenceId]
  };
  const population: RecruitmentPopulationReference = {
    recruitment_population_reference_id:
      branded<RecruitmentPopulationReferenceId>("population-domain-chain"),
    state: "CONFIRMED",
    raw_text: original("2027届毕业生"),
    population_kind: "FRESH_GRADUATE",
    recruitment_cycle: traceable("2027届"),
    related_requirement_observation_ids: [],
    evidence_ids: [evidenceId],
    observer_version: "population-observer/1.0.0"
  };
  const headcount = validateHeadcountObservation({
    headcount_observation_id: branded<HeadcountObservationId>(
      "headcount-domain-chain"
    ),
    state: "EXACT",
    raw_text: original("3人"),
    normalized_count: 3,
    evidence_ids: [evidenceId],
    observer_version: "headcount-observer/1.0.0"
  });
  const positionVersionSemanticPayload = {
    position_id: positionId,
    title: traceable("法务岗"),
    recruitment_batch_id: batchId,
    organization_role_assignments: [roleAssignment],
    location_assignments: [locationAssignment],
    headcount_observation_ids: [headcount.headcount_observation_id],
    recruitment_population_reference_ids: [
      population.recruitment_population_reference_id
    ],
    requirement_surface_reference_keys: ["announcement", "position-row"]
  };
  const positionVersionWithoutIntegrity: Omit<PositionVersion, "integrity_hash"> = {
    ...positionVersionSemanticPayload,
    position_version_id: positionVersionId,
    revision: 1,
    semantic_hash: positionVersionSemanticHashFor(positionVersionSemanticPayload),
    position_identity_hash: position.identity_hash,
    position_canonical_hash: positionCanonicalHashFor(position),
    source_occurrence_version_ids: [sourceVersionId],
    identity_evidence_ids: [evidenceId],
    effective_from: now,
    schema_version: POSITION_VERSION_SCHEMA_VERSION,
    materialization_version: POSITION_VERSION_MATERIALIZATION_VERSION
  };
  const positionVersion: PositionVersion = {
    ...positionVersionWithoutIntegrity,
    integrity_hash: positionVersionIntegrityHashFor(positionVersionWithoutIntegrity)
  };
  const revisionRelation: RecruitmentRevisionRelation = {
    recruitment_revision_relation_id: branded<RecruitmentRevisionRelationId>(
      "revision-domain-chain"
    ),
    relation_kind: "CORRECTION",
    source_announcement_version_id: announcementVersionId,
    target: { kind: "POSITION", position_id: positionId },
    affected_scope: original("岗位代码001专业要求"),
    certainty: "EXPLICIT",
    evidence_ids: [evidenceId],
    resolver_version: "revision-resolver/1.0.0"
  };

  assert.equal(announcementVersion.announcement_id, announcement.announcement_id);
  assert.equal(batch.recruitment_plan_id, plan.recruitment_plan_id);
  assert.equal(position.recruitment_plan_id, plan.recruitment_plan_id);
  assert.equal(positionVersion.position_id, position.position_id);
  assert.equal(headcount.normalized_count, 3);
  assert.equal(population.population_kind, "FRESH_GRADUATE");
  assert.equal(revisionRelation.target.kind, "POSITION");
});

test("aliases preserve legacy identifiers without establishing automatic equality", () => {
  const evidenceId = branded<IdentityEvidenceId>("identity-evidence-alias");
  const targetId = branded<PositionId>("position-alias-target");
  const alias: IdentityAlias = {
    identity_alias_id: branded<IdentityAliasId>("identity-alias-legacy-position"),
    target: { kind: "POSITION", id: targetId },
    alias_namespace: "legacy-opportunity-id",
    alias_value: traceable("legacy-position-123"),
    evidence_ids: [evidenceId],
    created_at: branded<IsoDateTime>("2026-09-30T12:00:00+08:00")
  };

  assert.equal(validateIdentityAlias(alias).target.id, targetId);
  assert.equal(alias.alias_value.original.text, "legacy-position-123");
});

test("identity Evidence is copied onto SourceOccurrenceVersion and excluded from semantic hash", () => {
  const candidate = contextCandidate({ positionCode: "EVIDENCE-001" });
  assert.ok(candidate.version.identity_evidence?.length);
  assert.ok(candidate.version.identity_evidence?.every((evidence) => {
    return evidence.source_occurrence_version_id
      === candidate.version.source_occurrence_version_id;
  }));
  const withoutEvidence = {
    ...candidate.version,
    identity_evidence: []
  };
  assert.equal(
    semanticHashFor(candidate.version.content),
    semanticHashFor(withoutEvidence.content)
  );
});

test("Phase A closes Position identity to exactly three non-provisional bases", () => {
  assert.deepEqual(POSITION_IDENTITY_BASIS_KINDS, [
    "OFFICIAL_POSITION_CODE",
    "SOURCE_LOCAL_RECORD",
    "EXPLICIT_RECONCILIATION"
  ]);
  assert.equal(POSITION_IDENTITY_CONTRACT_VERSION, "POSITION_IDENTITY_V1");
  assert.throws(() => validatePositionIdentityBasis({
    kind: "PROVISIONAL"
  } as unknown as PositionIdentityBasis), PositionContractValidationError);
});

test("Position identity canonicalization is deterministic and excludes weak identity fields", () => {
  const sourceDefinitionId = branded<SourceDefinitionId>("source-position-contract");
  const first: PositionIdentityBasis = {
    kind: "OFFICIAL_POSITION_CODE",
    source_definition_id: sourceDefinitionId,
    position_code_namespace: "official-plan-2027",
    official_position_code: "001"
  };
  const reordered = {
    official_position_code: "001",
    position_code_namespace: "official-plan-2027",
    source_definition_id: sourceDefinitionId,
    kind: "OFFICIAL_POSITION_CODE"
  } as PositionIdentityBasis;
  const differentCode: PositionIdentityBasis = {
    ...first,
    official_position_code: "002"
  };

  assert.equal(
    canonicalizePositionIdentityBasis(first),
    canonicalizePositionIdentityBasis(reordered)
  );
  assert.equal(positionIdentityHashFor(first), positionIdentityHashFor(reordered));
  assert.equal(positionIdForIdentityBasis(first), positionIdForIdentityBasis(reordered));
  assert.notEqual(positionIdForIdentityBasis(first), positionIdForIdentityBasis(differentCode));

  for (const forbidden of [
    "title",
    "url",
    "filename",
    "attachment_index",
    "organization_name",
    "requirement_text"
  ]) {
    assert.throws(() => validatePositionIdentityBasis({
      ...first,
      [forbidden]: "forbidden"
    } as unknown as PositionIdentityBasis), PositionContractValidationError);
  }
});

test("SOURCE_LOCAL_RECORD maps to PROVISIONAL status without creating a fourth basis", () => {
  const basis: PositionIdentityBasis = {
    kind: "SOURCE_LOCAL_RECORD",
    source_definition_id: branded<SourceDefinitionId>("source-local-position-contract"),
    source_occurrence_id: branded<SourceOccurrenceId>("source-occurrence-local-position"),
    source_local_record_key: "sheet=Sheet1&job_code=001"
  };
  const position = validatePosition({
    position_id: positionIdForIdentityBasis(basis),
    identity_state: "PROVISIONAL",
    identity_basis: basis,
    identity_hash: positionIdentityHashFor(basis),
    identity_resolver_version: POSITION_IDENTITY_CONTRACT_VERSION,
    plan_identity_state: "UNRESOLVED",
    source_local_record_identifier: traceable("sheet=Sheet1&job_code=001"),
    identity_evidence_ids: [branded<IdentityEvidenceId>("identity-evidence-local-position")],
    created_at: branded<IsoDateTime>("2026-09-08T10:00:00+08:00")
  });

  assert.equal(position.identity_basis.kind, "SOURCE_LOCAL_RECORD");
  assert.equal(position.identity_state, "PROVISIONAL");
  assert.throws(() => validatePosition({
    ...position,
    identity_state: "CONFIRMED"
  }), PositionContractValidationError);
});

test("EXPLICIT_RECONCILIATION identity is deterministic and requires traceable Evidence", () => {
  const firstPositionId = branded<PositionId>("position-reconciliation-first");
  const secondPositionId = branded<PositionId>("position-reconciliation-second");
  const evidenceId = branded<IdentityEvidenceId>("identity-evidence-reconciliation");
  const reconciliationId = branded<IdentityReconciliationId>(
    "identity-reconciliation-position-contract"
  );
  const first: PositionIdentityBasis = {
    kind: "EXPLICIT_RECONCILIATION",
    identity_reconciliation_id: reconciliationId,
    reconciled_position_ids: [firstPositionId, secondPositionId],
    identity_evidence_ids: [evidenceId]
  };
  const reordered: PositionIdentityBasis = {
    kind: "EXPLICIT_RECONCILIATION",
    identity_reconciliation_id: reconciliationId,
    reconciled_position_ids: [secondPositionId, firstPositionId],
    identity_evidence_ids: [evidenceId]
  };

  assert.equal(positionIdentityHashFor(first), positionIdentityHashFor(reordered));
  assert.equal(positionIdForIdentityBasis(first), positionIdForIdentityBasis(reordered));
  assert.throws(() => validatePositionIdentityBasis({
    ...first,
    identity_evidence_ids: []
  } as unknown as PositionIdentityBasis), PositionContractValidationError);
});

test("PositionVersion hashes semantic content deterministically and validates revision identity", () => {
  const basis: PositionIdentityBasis = {
    kind: "OFFICIAL_POSITION_CODE",
    source_definition_id: branded<SourceDefinitionId>("source-position-version-contract"),
    position_code_namespace: "official-plan-2027",
    official_position_code: "001"
  };
  const position = validatePosition({
    position_id: positionIdForIdentityBasis(basis),
    identity_state: "CONFIRMED",
    identity_basis: basis,
    identity_hash: positionIdentityHashFor(basis),
    identity_resolver_version: POSITION_IDENTITY_CONTRACT_VERSION,
    plan_identity_state: "UNRESOLVED",
    official_position_code: traceable("001"),
    position_code_namespace: "official-plan-2027",
    identity_evidence_ids: [branded<IdentityEvidenceId>("identity-evidence-version-position")],
    created_at: branded<IsoDateTime>("2026-09-08T10:00:00+08:00")
  });
  const sourceVersionIds = [
    branded<SourceOccurrenceVersionId>("source-version-b"),
    branded<SourceOccurrenceVersionId>("source-version-a")
  ] as const;
  const semanticPayload = {
    position_id: position.position_id,
    title: traceable("法务岗"),
    organization_role_assignments: [],
    location_assignments: [],
    headcount_observation_ids: [],
    recruitment_population_reference_ids: [],
    requirement_surface_reference_keys: ["position-row", "announcement"]
  };
  const reorderedPayload = {
    requirement_surface_reference_keys: ["announcement", "position-row"],
    recruitment_population_reference_ids: [],
    headcount_observation_ids: [],
    location_assignments: [],
    organization_role_assignments: [],
    title: traceable("法务岗"),
    position_id: position.position_id
  };
  const semanticHash = positionVersionSemanticHashFor(semanticPayload);
  assert.equal(semanticHash, positionVersionSemanticHashFor(reorderedPayload));

  const versionWithoutIntegrity: Omit<PositionVersion, "integrity_hash"> = {
    ...semanticPayload,
    position_version_id: positionVersionIdFor(position.identity_hash, 1),
    revision: 1,
    semantic_hash: semanticHash,
    position_identity_hash: position.identity_hash,
    position_canonical_hash: positionCanonicalHashFor(position),
    source_occurrence_version_ids: sourceVersionIds,
    identity_evidence_ids: position.identity_evidence_ids,
    effective_from: position.created_at,
    schema_version: POSITION_VERSION_SCHEMA_VERSION,
    materialization_version: POSITION_VERSION_MATERIALIZATION_VERSION
  };
  const version = validatePositionVersion({
    ...versionWithoutIntegrity,
    integrity_hash: positionVersionIntegrityHashFor(versionWithoutIntegrity)
  }, position);
  assert.equal(version.position_version_id, positionVersionIdFor(position.identity_hash, 1));
  assert.throws(() => validatePositionVersion({
    ...version,
    revision: 0
  }, position), PositionContractValidationError);
  assert.throws(() => validatePositionVersion({
    ...version,
    semantic_hash: branded<SemanticHash>("tampered-semantic-hash")
  }, position), PositionContractValidationError);
});

test("PositionBoundOpportunityVersion requires a matching PositionVersion and never upgrades legacy", () => {
  const basis: PositionIdentityBasis = {
    kind: "SOURCE_LOCAL_RECORD",
    source_definition_id: branded<SourceDefinitionId>("source-position-bound-opportunity"),
    source_occurrence_id: branded<SourceOccurrenceId>("source-occurrence-position-bound"),
    source_local_record_key: "Sheet1!A4:O4#001"
  };
  const position = validatePosition({
    position_id: positionIdForIdentityBasis(basis),
    identity_state: "PROVISIONAL",
    identity_basis: basis,
    identity_hash: positionIdentityHashFor(basis),
    identity_resolver_version: POSITION_IDENTITY_CONTRACT_VERSION,
    plan_identity_state: "UNRESOLVED",
    source_local_record_identifier: traceable("Sheet1!A4:O4#001"),
    identity_evidence_ids: [branded<IdentityEvidenceId>("identity-evidence-position-bound")],
    created_at: branded<IsoDateTime>("2026-09-08T10:00:00+08:00")
  });
  const semanticPayload = {
    position_id: position.position_id,
    title: traceable("法务岗"),
    organization_role_assignments: [],
    location_assignments: [],
    headcount_observation_ids: [],
    recruitment_population_reference_ids: [],
    requirement_surface_reference_keys: []
  };
  const positionVersionWithoutIntegrity: Omit<PositionVersion, "integrity_hash"> = {
    ...semanticPayload,
    position_version_id: positionVersionIdFor(position.identity_hash, 1),
    revision: 1,
    semantic_hash: positionVersionSemanticHashFor(semanticPayload),
    position_identity_hash: position.identity_hash,
    position_canonical_hash: positionCanonicalHashFor(position),
    source_occurrence_version_ids: [
      branded<SourceOccurrenceVersionId>("source-version-position-bound")
    ],
    identity_evidence_ids: position.identity_evidence_ids,
    effective_from: position.created_at,
    schema_version: POSITION_VERSION_SCHEMA_VERSION,
    materialization_version: POSITION_VERSION_MATERIALIZATION_VERSION
  };
  const positionVersion = validatePositionVersion({
    ...positionVersionWithoutIntegrity,
    integrity_hash: positionVersionIntegrityHashFor(positionVersionWithoutIntegrity)
  }, position);
  const legacy: OpportunityVersion = {
    opportunity_version_id: branded<OpportunityVersionId>("legacy-opportunity-version"),
    canonical_opportunity_id: branded<CanonicalOpportunityId>("legacy-opportunity"),
    revision: 1,
    semantic_hash: branded<SemanticHash>("legacy-opportunity-semantic"),
    content: {
      organization: { name: traceable("示例单位") },
      title: traceable("法务岗"),
      locations: []
    },
    source_occurrence_version_ids: positionVersion.source_occurrence_version_ids,
    effective_from: position.created_at
  };

  assert.equal(legacy.position_version_id, undefined);
  assert.throws(() => validatePositionBoundOpportunityVersion(
    legacy,
    position,
    positionVersion
  ), OpportunityContractValidationError);
  assert.equal(legacy.position_version_id, undefined);

  const bound = validatePositionBoundOpportunityVersion({
    ...legacy,
    opportunity_version_id: branded<OpportunityVersionId>("position-bound-opportunity-version"),
    position_version_id: positionVersion.position_version_id
  }, position, positionVersion);
  assert.equal(bound.position_version_id, positionVersion.position_version_id);

  const differentPosition = {
    ...position,
    position_id: branded<PositionId>("different-position")
  };
  assert.throws(() => validatePositionBoundOpportunityVersion(
    bound,
    differentPosition,
    positionVersion
  ), OpportunityContractValidationError);
});

test("Recruitment Context & Position Identity implementation remains offline", async () => {
  await assert.rejects(fetch("https://example.invalid"),
    /Network access is disabled in tests/);
});

function syntheticCandidateProfile(): CandidateProfile {
  return {
    candidate_profile_id: branded<CandidateProfileId>("synthetic-candidate-context-test"),
    education: [],
    professional_qualifications: [],
    languages: []
  };
}

function legacyCandidate(): CanonicalizationCandidate {
  sequence += 1;
  const occurrenceId = branded<SourceOccurrenceId>(
    `legacy-source-occurrence-${sequence}`
  );
  const versionId = branded<SourceOccurrenceVersionId>(
    `legacy-source-occurrence-version-${sequence}`
  );
  return {
    source_definition: officialSource,
    occurrence: {
      source_occurrence_id: occurrenceId,
      source_definition_id: officialSource.source_definition_id,
      recruitment_endpoint_id: branded<RecruitmentEndpointId>(
        `legacy-endpoint-${sequence}`
      ),
      identity_basis: {
        kind: "COMPOSITE_FIELDS",
        normalized_organization: "示例用人单位",
        normalized_title: "法务岗",
        normalized_locations: ["北京"],
        recruitment_batch: "第一批"
      },
      identity_hash: branded<IdentityHash>(`legacy-identity-${sequence}`),
      first_observed_at: branded<IsoDateTime>("2026-09-01T08:00:00+08:00")
    },
    version: {
      source_occurrence_version_id: versionId,
      source_occurrence_id: occurrenceId,
      extracted_record_id: branded<ExtractedRecordId>(`legacy-record-${sequence}`),
      revision: 1,
      semantic_hash: branded<SemanticHash>(`legacy-semantic-${sequence}`),
      content: {
        organization: {
          organization_id: employerId,
          name: traceable("示例用人单位")
        },
        title: traceable("法务岗"),
        locations: [{
          city: "北京",
          raw_text: original("北京"),
          is_nationwide: false,
          normalization_confidence: 1
        }],
        recruitment_year: 2027,
        recruitment_batch: traceable("第一批"),
        published_on: branded<IsoDate>("2026-09-01"),
        application_window: { closes_on: branded<IsoDate>("2026-10-01") }
      },
      first_observed_at: branded<IsoDateTime>("2026-09-01T08:00:00+08:00")
    }
  };
}
