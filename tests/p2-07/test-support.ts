import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  CandidateProfile,
  EligibilityAssessment,
  ExtractedRecord,
  IsoDateTime,
  Organization,
  RawBlob,
  RawBlobId,
  RawContentSha256,
  RecruitmentEndpoint,
  RequirementEvidence,
  RequirementFact,
  Snapshot,
  SnapshotId,
  SourceDefinition
} from "../../lib/ingestion";
import {
  BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
  BeijingPublicInstitutionDetailHtmlAdapter
} from "../../lib/live-canary/p2-04d/beijing-public-institution-detail-html-adapter";
import {
  createProductionLikeDatabase,
  ProductionIngestionRepository,
  type ProductionCaptureWriteInput
} from "../../lib/production-ingestion";
import type { SourceHealth } from "../../lib/source-scheduler/types";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const observedAt = "2026-09-02T13:49:21.756Z" as IsoDateTime;

export function createProjectionTestDatabase() {
  const database = createProductionLikeDatabase();
  const repository = new ProductionIngestionRepository(database);
  const beijing = beijingDetailCapture();
  const beijingResult = repository.writeCapturedRecords(beijing.input);
  const synthetic = syntheticCapture();
  const syntheticResult = repository.writeCapturedRecords(synthetic.input);
  const opportunityVersionId = syntheticResult.opportunity_version_ids[0]!;
  const fact = syntheticRequirementFact(opportunityVersionId);
  const evidence = syntheticRequirementEvidence(fact, synthetic.input.snapshot.snapshot_id);
  const candidate = syntheticCandidateProfile();
  const assessment = syntheticEligibilityAssessment({ candidate, opportunityVersionId, fact, evidence });
  repository.appendObservedRequirements({ facts: [fact], evidence: [evidence] });
  repository.appendEligibilityAssessment({ candidate_profile: candidate, assessment });

  return {
    database,
    beijing,
    beijingResult,
    synthetic,
    syntheticResult,
    fact,
    evidence,
    candidate,
    assessment,
    sourceHealth: [beijingSourceHealth(beijing.input)] as const
  };
}

function beijingDetailCapture() {
  const bytes = new Uint8Array(readFileSync(path.join(
    repositoryRoot,
    "fixtures/p2-04d/beijing-public-institution-job-detail.html"
  )));
  const sourceDefinitionId = "source-cn-beijing-government-public-institution-recruitment" as SourceDefinition["source_definition_id"];
  const organizations: readonly Organization[] = [{
    organization_id: "organization-cn-beijing-municipal-government" as Organization["organization_id"],
    name: traceable("北京市人民政府"),
    aliases: [],
    country_code: "CN"
  }, {
    organization_id: "organization-cn-beijing-emergency-medical-center" as Organization["organization_id"],
    name: traceable("北京急救中心"),
    aliases: [],
    country_code: "CN"
  }];
  const sourceDefinition: SourceDefinition = {
    source_definition_id: sourceDefinitionId,
    publisher_organization_id: organizations[0]!.organization_id,
    name: traceable("北京市人民政府事业单位招聘"),
    publisher_kind: "GOVERNMENT_PORTAL",
    authority_level: "OFFICIAL",
    scope: "REGIONAL",
    enabled: false
  };
  const endpoint: RecruitmentEndpoint = {
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
    source_definition_id: sourceDefinitionId,
    name: traceable("北京急救中心2026年度第四批公开招聘公告详情"),
    coverage_regions: [{ raw_text: original("北京市") }],
    locator: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
    request_method: "GET",
    content_kind: "HTML",
    adapter_key: BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY,
    decoded_text_encoding: "UTF-8",
    collection_config: { timeout_ms: 10_000, max_items: 1, max_pages: 1, follow_redirects: false, retry_limit: 0 },
    enabled: false
  };
  const rawBlob = createRawBlob(bytes, observedAt);
  const snapshot = successfulSnapshot({
    snapshotId: "p2-04d-snapshot:d46a0d70-f9d4-46d9-a9ca-bd010d0caec4",
    endpoint,
    rawBlob,
    observedAt,
    requestedAt: "2026-09-02T13:49:21.344Z" as IsoDateTime
  });
  const extractedRecords = new BeijingPublicInstitutionDetailHtmlAdapter().extract({ endpoint, snapshot, raw_blob: rawBlob });
  const input: ProductionCaptureWriteInput = {
    organizations,
    source_definition: sourceDefinition,
    endpoint,
    authorization: {
      authorization_id: "p2-04d-authorization:e3846158-b6f6-4010-b88d-c870d7ca20f0",
      source_admission_id: "admission-beijing-public-institution-job-detail",
      admission_level: "B",
      admission_decision: "APPROVED",
      automation_basis: "HUMAN_REVIEWED_CANARY",
      endpoint: endpoint.locator,
      recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
      endpoint_purpose: "JOB_DETAIL",
      allowed_http_method: "GET",
      collection_run_id: "p2-04d-run:3648affe-5bd5-471c-b557-085bfed0a3be",
      reviewer: "human-approved-by-user",
      issued_at: "2026-09-02T13:49:21.334Z",
      evidence_id: "p2-04d-evidence:human-canary:f173a55a-c864-4071-b9c8-447f236b5ef6",
      scope: "ONE_ENDPOINT_ONE_RUN",
      manual_confirmation: true,
      authorization_consumed: true,
      replay_denial_code: "AUTHORIZATION_ALREADY_USED"
    },
    collection_run: collectionRun({
      collectionRunId: "p2-04d-run:3648affe-5bd5-471c-b557-085bfed0a3be",
      authorizationId: "p2-04d-authorization:e3846158-b6f6-4010-b88d-c870d7ca20f0",
      sourceDefinitionId,
      endpoint,
      startedAt: "2026-09-02T13:49:21.344Z",
      completedAt: "2026-09-02T13:49:21.756Z"
    }),
    raw_blob: rawBlob,
    raw_object_path: `local-production-like://raw/${rawBlob.raw_content_sha256}`,
    original_url: endpoint.locator,
    snapshot,
    extracted_records: extractedRecords
  };
  return { input, rawBlob, snapshot, extractedRecords };
}

function syntheticCapture() {
  const sourceDefinitionId = "source-p2-07-synthetic" as SourceDefinition["source_definition_id"];
  const organization: Organization = {
    organization_id: "organization-p2-07-synthetic" as Organization["organization_id"],
    name: traceable("P2-07合成测试单位"),
    aliases: [],
    country_code: "CN"
  };
  const sourceDefinition: SourceDefinition = {
    source_definition_id: sourceDefinitionId,
    publisher_organization_id: organization.organization_id,
    name: traceable("P2-07合成官方测试来源"),
    publisher_kind: "GOVERNMENT_PORTAL",
    authority_level: "OFFICIAL",
    scope: "SINGLE_ORGANIZATION",
    enabled: false
  };
  const endpoint: RecruitmentEndpoint = {
    recruitment_endpoint_id: "endpoint-p2-07-synthetic" as RecruitmentEndpoint["recruitment_endpoint_id"],
    source_definition_id: sourceDefinitionId,
    name: traceable("P2-07合成测试详情页"),
    coverage_regions: [{ raw_text: original("测试地区") }],
    locator: "https://example.invalid/p2-07-synthetic/notice-1",
    request_method: "GET",
    content_kind: "HTML",
    adapter_key: "p2-07-synthetic-test-only",
    decoded_text_encoding: "UTF-8",
    collection_config: { timeout_ms: 1_000, max_items: 1, max_pages: 1, follow_redirects: false, retry_limit: 0 },
    enabled: false
  };
  const rawBlob = createRawBlob(
    new TextEncoder().encode("<!doctype html><title>P2-07 synthetic fixture</title>"),
    "2026-09-02T15:00:00.000Z" as IsoDateTime
  );
  const snapshot = successfulSnapshot({
    snapshotId: "snapshot:p2-07-synthetic",
    endpoint,
    rawBlob,
    observedAt: "2026-09-02T15:00:00.000Z" as IsoDateTime,
    requestedAt: "2026-09-02T15:00:00.000Z" as IsoDateTime
  });
  const extractedRecord: ExtractedRecord = {
    extracted_record_id: "extracted-record:p2-07-synthetic" as ExtractedRecord["extracted_record_id"],
    snapshot_id: snapshot.snapshot_id,
    source_definition_id: sourceDefinitionId,
    identity_candidates: [{ kind: "ANNOUNCEMENT_URL", value: endpoint.locator, confidence: "HIGH" }],
    raw_source_record_id: "p2-07-synthetic-notice-1",
    raw_title: original("P2-07 合成法务招聘公告"),
    raw_organization_name: original("P2-07合成测试单位"),
    raw_location_text: [original("测试地区")],
    raw_requirement_text: original("硕士专业：法律硕士（非法学）。"),
    announcement_url: endpoint.locator,
    source_record_locator: { kind: "HTML", selector: "article.test-only" },
    adapter_metadata: { "p2-07-synthetic-test-only": { test_only: true } },
    extraction: {
      extractor_name: "P2-07SyntheticTestAdapter",
      extractor_version: "1.0.0-test",
      extracted_at: snapshot.observed_at
    }
  };
  const input: ProductionCaptureWriteInput = {
    organizations: [organization],
    source_definition: sourceDefinition,
    endpoint,
    authorization: {
      authorization_id: "authorization:p2-07-synthetic",
      source_admission_id: "admission:p2-07-synthetic",
      admission_level: "B",
      admission_decision: "APPROVED",
      automation_basis: "HUMAN_REVIEWED_CANARY",
      endpoint: endpoint.locator,
      recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
      endpoint_purpose: "JOB_DETAIL",
      allowed_http_method: "GET",
      collection_run_id: "collection-run:p2-07-synthetic",
      reviewer: "p2-07-test-only",
      issued_at: "2026-09-02T15:00:00.000Z",
      evidence_id: "evidence:p2-07-synthetic",
      scope: "ONE_ENDPOINT_ONE_RUN",
      manual_confirmation: true,
      authorization_consumed: true,
      replay_denial_code: "AUTHORIZATION_ALREADY_USED"
    },
    collection_run: collectionRun({
      collectionRunId: "collection-run:p2-07-synthetic",
      authorizationId: "authorization:p2-07-synthetic",
      sourceDefinitionId,
      endpoint,
      startedAt: "2026-09-02T15:00:00.000Z",
      completedAt: "2026-09-02T15:00:00.000Z"
    }),
    raw_blob: rawBlob,
    raw_object_path: `local-production-like://test-only/${rawBlob.raw_content_sha256}`,
    original_url: endpoint.locator,
    snapshot,
    extracted_records: [extractedRecord]
  };
  return { input, rawBlob, snapshot };
}

function syntheticRequirementFact(opportunityVersionId: string): RequirementFact {
  return {
    requirement_fact_id: "requirement-fact:p2-07-synthetic" as RequirementFact["requirement_fact_id"],
    opportunity_version_id: opportunityVersionId as RequirementFact["opportunity_version_id"],
    dimension: "MAJOR",
    operator: "EQUALS",
    value: { kind: "CODE", code: "JURIS_MASTER_NON_LAW" },
    subject_scope: "MASTER",
    logic_group: {
      logic_group_id: "logic-group:p2-07-synthetic" as RequirementFact["logic_group"]["logic_group_id"],
      operator: "AND"
    },
    polarity: "POSITIVE",
    certainty: "EXPLICIT",
    parser_version: "p2-07-synthetic-test-only/1.0.0"
  };
}

function syntheticRequirementEvidence(fact: RequirementFact, snapshotId: SnapshotId): RequirementEvidence {
  return {
    requirement_evidence_id: "requirement-evidence:p2-07-synthetic" as RequirementEvidence["requirement_evidence_id"],
    requirement_fact_id: fact.requirement_fact_id,
    snapshot_id: snapshotId,
    locator: { field_path: "article.test-only", start_offset: 0, end_offset: 16 },
    evidence_text: original("硕士专业：法律硕士（非法学）。"),
    extractor_name: "P2-07SyntheticTestAdapter",
    extractor_version: "1.0.0-test",
    parser_version: fact.parser_version
  };
}

function syntheticCandidateProfile(): CandidateProfile {
  return {
    candidate_profile_id: "candidate:p2-07-synthetic" as CandidateProfile["candidate_profile_id"],
    education: [{
      level: "MASTER",
      institution: traceable("测试大学"),
      program_name: traceable("法律硕士（非法学）"),
      normalized_program_codes: ["JURIS_MASTER", "JURIS_MASTER_NON_LAW"],
      academic_background: "NON_LAW",
      graduation_year: 2027
    }],
    target_graduation_year: 2027,
    professional_qualifications: [],
    languages: []
  };
}

function syntheticEligibilityAssessment(input: {
  readonly candidate: CandidateProfile;
  readonly opportunityVersionId: string;
  readonly fact: RequirementFact;
  readonly evidence: RequirementEvidence;
}): EligibilityAssessment {
  return {
    eligibility_assessment_id: "eligibility-assessment:p2-07-synthetic" as EligibilityAssessment["eligibility_assessment_id"],
    candidate_profile_id: input.candidate.candidate_profile_id,
    opportunity_version_id: input.opportunityVersionId as EligibilityAssessment["opportunity_version_id"],
    result: "ELIGIBLE",
    reason_codes: ["REQUIREMENT_SATISFIED"],
    requirement_fact_ids: [input.fact.requirement_fact_id],
    evidence_ids: [input.evidence.requirement_evidence_id],
    engine_version: "p2-07-synthetic-test-engine/1.0.0",
    parser_versions: [input.fact.parser_version],
    unresolved_conflicts: [],
    assessed_at: "2026-09-02T15:00:00.000Z" as IsoDateTime
  };
}

function beijingSourceHealth(input: ProductionCaptureWriteInput): SourceHealth {
  return {
    source_admission_id: input.authorization.source_admission_id as SourceHealth["source_admission_id"],
    recruitment_endpoint_id: input.endpoint.recruitment_endpoint_id,
    consecutive_success: 1,
    consecutive_failure: 0,
    last_success: input.snapshot.observed_at,
    last_failure: null,
    last_http_status: 200,
    last_content_hash: input.raw_blob.raw_content_sha256,
    structure_change_detected: false,
    robots_status: "ALLOWED",
    terms_status: "UNKNOWN",
    status: "HEALTHY"
  };
}

function createRawBlob(bytes: Uint8Array, createdAt: IsoDateTime): RawBlob {
  const hash = createHash("sha256").update(bytes).digest("hex") as RawContentSha256;
  return {
    raw_blob_id: `sha256:${hash}` as RawBlobId,
    bytes: new Uint8Array(bytes),
    raw_content_sha256: hash,
    mime_type: "text/html; charset=utf-8",
    byte_length: bytes.byteLength,
    created_at: createdAt
  };
}

function successfulSnapshot(input: {
  readonly snapshotId: string;
  readonly endpoint: RecruitmentEndpoint;
  readonly rawBlob: RawBlob;
  readonly observedAt: IsoDateTime;
  readonly requestedAt: IsoDateTime;
}): Snapshot {
  return {
    snapshot_id: input.snapshotId as SnapshotId,
    recruitment_endpoint_id: input.endpoint.recruitment_endpoint_id,
    request_metadata: { locator: input.endpoint.locator, method: "GET", requested_at: input.requestedAt, headers: {}, parameters: {} },
    response_metadata: { http_status: 200, headers: { "content-type": "text/html; charset=utf-8" }, mime_type: "text/html; charset=utf-8", content_length: input.rawBlob.byte_length, transport_error: null },
    raw_blob_id: input.rawBlob.raw_blob_id,
    observed_at: input.observedAt,
    transport_status: "SUCCESS",
    content_hash: input.rawBlob.raw_content_sha256,
    content_length: input.rawBlob.byte_length
  };
}

function collectionRun(input: {
  readonly collectionRunId: string;
  readonly authorizationId: string;
  readonly sourceDefinitionId: SourceDefinition["source_definition_id"];
  readonly endpoint: RecruitmentEndpoint;
  readonly startedAt: string;
  readonly completedAt: string;
}) {
  return {
    collection_run_id: input.collectionRunId,
    source_definition_id: input.sourceDefinitionId,
    recruitment_endpoint_id: input.endpoint.recruitment_endpoint_id,
    authorization_id: input.authorizationId,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    status: "SUCCESS" as const,
    request_metadata: { locator: input.endpoint.locator, method: "GET" },
    result_metadata: { request_count: 1, page_count: 1, transport_status: "SUCCESS" },
    scheduler_dispatch_reference: null
  };
}

function original(text: string) {
  return { text, encoding: "UTF-8" } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}
