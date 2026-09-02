import "../helpers/network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type {
  AdapterExtractionInput,
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
  BEIJING_PUBLIC_INSTITUTION_HTML_ADAPTER_KEY,
  BEIJING_PUBLIC_INSTITUTION_JOB_LIST_LOCATOR,
  BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID,
  BeijingPublicInstitutionHtmlAdapter
} from "../../lib/live-canary/p2-04/beijing-public-institution-html-adapter";
import {
  BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
  BeijingPublicInstitutionDetailHtmlAdapter
} from "../../lib/live-canary/p2-04d/beijing-public-institution-detail-html-adapter";
import {
  createProductionLikeDatabase,
  ProductionIngestionRepository,
  ProductionIngestionWriteError,
  PRODUCTION_INGESTION_CONTRACT,
  type ProductionCaptureWriteInput
} from "../../lib/production-ingestion";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const listBytes = new Uint8Array(readFileSync(path.join(
  repositoryRoot,
  "fixtures/p2-04/beijing-public-institution-job-list.html"
)));
const detailBytes = new Uint8Array(readFileSync(path.join(
  repositoryRoot,
  "fixtures/p2-04d/beijing-public-institution-job-detail.html"
)));
const sourceDefinitionId = "source-cn-beijing-government-public-institution-recruitment" as SourceDefinition["source_definition_id"];
const observedAt = "2026-09-02T13:49:21.756Z" as IsoDateTime;

test("production schema contract is isolated and is not a real production connection", () => {
  const up = readFileSync(path.join(
    repositoryRoot,
    "production/ingestion/migrations/001_ingestion_production.up.sql"
  ), "utf8");
  const down = readFileSync(path.join(
    repositoryRoot,
    "production/ingestion/migrations/001_ingestion_production.down.sql"
  ), "utf8");
  assert.equal(PRODUCTION_INGESTION_CONTRACT.real_production_connection_configured, false);
  assert.equal(PRODUCTION_INGESTION_CONTRACT.real_production_write_authorized, false);
  assert.match(up, /CREATE SCHEMA IF NOT EXISTS ingestion_production/u);
  assert.match(up, /ingestion_production\.collection_runs/u);
  assert.match(up, /ingestion_production\.raw_blob_runs/u);
  assert.match(up, /ingestion_production\.assessment_deferrals/u);
  assert.match(down, /DROP SCHEMA IF EXISTS ingestion_production CASCADE/u);
  assert.doesNotMatch(`${up}\n${down}`, /\b(?:preview_ingestion|supabase|jobs|sync_runs|applications)\b/iu);
});

test("local production-like write preserves List uncertainty and Detail provenance without Requirements", () => {
  const database = createProductionLikeDatabase();
  const repository = new ProductionIngestionRepository(database);
  const listResult = repository.writeCapturedRecords(listCapture());
  assert.equal(listResult.status, "IDENTITY_UNCERTAIN");
  assert.equal(listResult.canonical_opportunity_ids.length, 0);
  assert.equal(repository.count("ingestion_extracted_records"), 25);

  const detailResult = repository.writeCapturedRecords(detailCapture());
  assert.equal(detailResult.status, "CREATED");
  assert.equal(detailResult.canonical_opportunity_ids.length, 1);
  assert.equal(detailResult.eligibility_status, "NOT_ASSESSED_INSUFFICIENT_REQUIREMENT_EVIDENCE");
  assert.deepEqual(detailResult.requirement_fact_ids, []);
  const provenance = repository.provenanceForCanonical(detailResult.canonical_opportunity_ids[0]!);
  assert.deepEqual({ ...provenance }, {
    canonical_opportunity_id: detailResult.canonical_opportunity_ids[0],
    opportunity_version_id: detailResult.opportunity_version_ids[0],
    source_occurrence_id: detailResult.source_occurrence_ids[0],
    source_occurrence_version_id: detailResult.source_occurrence_version_ids[0],
    extracted_record_id: detailRecord().extracted_record_id,
    snapshot_id: "p2-04d-snapshot:d46a0d70-f9d4-46d9-a9ca-bd010d0caec4",
    raw_blob_id: "sha256:8a44dad79da041e1aefb7d9aed442df40f5de844eefe5d1708cb52996f511d8a",
    collection_run_id: "p2-04d-run:3648affe-5bd5-471c-b557-085bfed0a3be",
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
    source_definition_id: sourceDefinitionId,
    original_url: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT
  });
  assert.equal(repository.count("ingestion_requirement_facts"), 0);
  assert.equal(repository.count("ingestion_requirement_evidence"), 0);
  assert.equal(repository.count("ingestion_eligibility_assessments"), 0);
  assert.equal(repository.count("ingestion_assessment_deferrals"), 1);
  database.close();
});

test("replay is idempotent and a test-only changed Raw creates an UPDATED version", () => {
  const database = createProductionLikeDatabase();
  const repository = new ProductionIngestionRepository(database);
  const first = repository.writeCapturedRecords(detailCapture());
  const replay = repository.writeCapturedRecords(detailCapture());
  assert.equal(first.status, "CREATED");
  assert.equal(replay.status, "UNCHANGED");
  assert.equal(repository.count("ingestion_raw_blobs"), 1);
  assert.equal(repository.count("ingestion_snapshots"), 1);
  assert.equal(repository.count("ingestion_source_occurrences"), 1);
  assert.equal(repository.count("ingestion_source_occurrence_versions"), 1);
  assert.equal(repository.count("ingestion_canonical_opportunities"), 1);
  assert.equal(repository.count("ingestion_opportunity_versions"), 1);

  const updated = repository.writeCapturedRecords(updatedDetailCapture());
  assert.equal(updated.status, "UPDATED");
  assert.equal(repository.count("ingestion_source_occurrences"), 1);
  assert.equal(repository.count("ingestion_source_occurrence_versions"), 2);
  assert.equal(repository.count("ingestion_canonical_opportunities"), 1);
  assert.equal(repository.count("ingestion_opportunity_versions"), 2);
  database.close();
});

test("test-only Requirement and Eligibility writes retain Fact, Evidence, and Snapshot provenance", () => {
  const database = createProductionLikeDatabase();
  const repository = new ProductionIngestionRepository(database);
  const capture = syntheticCapture();
  const captureResult = repository.writeCapturedRecords(capture);
  const opportunityVersionId = captureResult.opportunity_version_ids[0]!;
  const fact = syntheticRequirementFact(opportunityVersionId);
  const evidence = syntheticRequirementEvidence(fact, capture.snapshot.snapshot_id);
  const candidate = syntheticCandidateProfile();
  const assessment = syntheticEligibilityAssessment({
    candidate,
    opportunity_version_id: opportunityVersionId,
    fact,
    evidence
  });

  assert.equal(captureResult.status, "CREATED");
  repository.appendObservedRequirements({ facts: [fact], evidence: [evidence] });
  repository.appendObservedRequirements({ facts: [fact], evidence: [evidence] });
  repository.appendEligibilityAssessment({ candidate_profile: candidate, assessment });
  repository.appendEligibilityAssessment({ candidate_profile: candidate, assessment });

  assert.equal(repository.count("ingestion_requirement_facts"), 1);
  assert.equal(repository.count("ingestion_requirement_evidence"), 1);
  assert.equal(repository.count("ingestion_candidate_profiles"), 1);
  assert.equal(repository.count("ingestion_eligibility_assessments"), 1);
  assert.equal(repository.count("ingestion_eligibility_assessment_facts"), 1);
  assert.equal(repository.count("ingestion_eligibility_assessment_evidence"), 1);
  assert.equal(repository.count("ingestion_assessment_deferrals"), 0);

  const requirementProvenance = database.prepare(`
    SELECT fact.opportunity_version_id, evidence.snapshot_id, snapshot.raw_blob_id, raw.original_url
    FROM ingestion_requirement_facts fact
    JOIN ingestion_requirement_evidence evidence ON evidence.requirement_fact_id = fact.requirement_fact_id
    JOIN ingestion_snapshots snapshot ON snapshot.snapshot_id = evidence.snapshot_id
    JOIN ingestion_raw_blobs raw ON raw.raw_blob_id = snapshot.raw_blob_id
    WHERE fact.requirement_fact_id = ?
  `).get(fact.requirement_fact_id) as {
    opportunity_version_id: string;
    snapshot_id: string;
    raw_blob_id: string;
    original_url: string;
  };
  assert.deepEqual({ ...requirementProvenance }, {
    opportunity_version_id: opportunityVersionId,
    snapshot_id: capture.snapshot.snapshot_id,
    raw_blob_id: capture.raw_blob.raw_blob_id,
    original_url: capture.original_url
  });

  const eligibilityProvenance = database.prepare(`
    SELECT assessment.candidate_profile_id, assessment.opportunity_version_id,
      fact_link.requirement_fact_id, evidence_link.requirement_evidence_id
    FROM ingestion_eligibility_assessments assessment
    JOIN ingestion_eligibility_assessment_facts fact_link
      ON fact_link.eligibility_assessment_id = assessment.eligibility_assessment_id
    JOIN ingestion_eligibility_assessment_evidence evidence_link
      ON evidence_link.eligibility_assessment_id = assessment.eligibility_assessment_id
    WHERE assessment.eligibility_assessment_id = ?
  `).get(assessment.eligibility_assessment_id) as {
    candidate_profile_id: string;
    opportunity_version_id: string;
    requirement_fact_id: string;
    requirement_evidence_id: string;
  };
  assert.deepEqual({ ...eligibilityProvenance }, {
    candidate_profile_id: candidate.candidate_profile_id,
    opportunity_version_id: opportunityVersionId,
    requirement_fact_id: fact.requirement_fact_id,
    requirement_evidence_id: evidence.requirement_evidence_id
  });
  database.close();
});

test("Requirement and Eligibility references reject missing rows and persisted facts stay append-only", () => {
  const database = createProductionLikeDatabase();
  const repository = new ProductionIngestionRepository(database);
  const capture = syntheticCapture();
  const captureResult = repository.writeCapturedRecords(capture);
  const opportunityVersionId = captureResult.opportunity_version_ids[0]!;
  const fact = syntheticRequirementFact(opportunityVersionId);
  const evidence = syntheticRequirementEvidence(fact, capture.snapshot.snapshot_id);
  const evidenceWithMissingSnapshot: RequirementEvidence = {
    ...evidence,
    requirement_evidence_id: "requirement-evidence:p2-06-test-only-missing-snapshot" as RequirementEvidence["requirement_evidence_id"],
    snapshot_id: "snapshot:p2-06-test-only-missing" as SnapshotId
  };

  assert.throws(
    () => repository.appendObservedRequirements({ facts: [fact], evidence: [evidenceWithMissingSnapshot] }),
    /Required persisted reference is missing/u
  );
  assert.equal(repository.count("ingestion_requirement_facts"), 0);
  assert.equal(repository.count("ingestion_requirement_evidence"), 0);

  repository.appendObservedRequirements({ facts: [fact], evidence: [evidence] });
  repository.writeCapturedRecords(listCapture());
  const evidenceFromOtherSnapshot: RequirementEvidence = {
    ...evidence,
    requirement_evidence_id: "requirement-evidence:p2-06-test-only-other-snapshot" as RequirementEvidence["requirement_evidence_id"],
    snapshot_id: listCapture().snapshot.snapshot_id
  };
  assert.throws(
    () => repository.appendObservedRequirements({ facts: [fact], evidence: [evidenceFromOtherSnapshot] }),
    /RequirementEvidence Snapshot must be traceable/u
  );
  assert.equal(repository.count("ingestion_requirement_evidence"), 1);
  const candidate = syntheticCandidateProfile();
  const assessmentWithMissingFact = syntheticEligibilityAssessment({
    candidate,
    opportunity_version_id: opportunityVersionId,
    fact: {
      ...fact,
      requirement_fact_id: "requirement-fact:p2-06-test-only-missing" as RequirementFact["requirement_fact_id"]
    },
    evidence
  });
  assert.throws(
    () => repository.appendEligibilityAssessment({ candidate_profile: candidate, assessment: assessmentWithMissingFact }),
    /Required persisted reference is missing/u
  );
  assert.equal(repository.count("ingestion_candidate_profiles"), 0);
  assert.equal(repository.count("ingestion_eligibility_assessments"), 0);

  const candidateWithMismatchedId: CandidateProfile = {
    ...candidate,
    candidate_profile_id: "candidate:p2-06-test-only-mismatched" as CandidateProfile["candidate_profile_id"]
  };
  const validAssessment = syntheticEligibilityAssessment({ candidate, opportunity_version_id: opportunityVersionId, fact, evidence });
  assert.throws(
    () => repository.appendEligibilityAssessment({ candidate_profile: candidateWithMismatchedId, assessment: validAssessment }),
    /CandidateProfile must match/u
  );
  assert.equal(repository.count("ingestion_candidate_profiles"), 0);

  const assessment = syntheticEligibilityAssessment({ candidate, opportunity_version_id: opportunityVersionId, fact, evidence });
  repository.appendEligibilityAssessment({ candidate_profile: candidate, assessment });
  assert.throws(
    () => database.prepare("UPDATE ingestion_requirement_facts SET logic_group_id = ? WHERE requirement_fact_id = ?")
      .run("changed", fact.requirement_fact_id),
    /append-only/u
  );
  assert.throws(
    () => database.prepare("DELETE FROM ingestion_requirement_evidence WHERE requirement_evidence_id = ?")
      .run(evidence.requirement_evidence_id),
    /append-only/u
  );
  assert.throws(
    () => database.prepare("UPDATE ingestion_eligibility_assessments SET result = ? WHERE eligibility_assessment_id = ?")
      .run("INELIGIBLE", assessment.eligibility_assessment_id),
    /append-only/u
  );
  database.close();
});

test("step failures leave only completed traceable stages and recover through replay", () => {
  const expectations = [
    ["RAW", 1, 0, 0, 0, "CREATED"],
    ["SNAPSHOT", 1, 1, 0, 0, "CREATED"],
    ["EXTRACTED_RECORD", 1, 1, 1, 0, "CREATED"],
    ["CANONICAL", 1, 1, 1, 1, "UNCHANGED"],
    ["REQUIREMENT", 1, 1, 1, 1, "UNCHANGED"],
    ["ELIGIBILITY", 1, 1, 1, 1, "UNCHANGED"]
  ] as const;
  for (const [stage, rawCount, snapshotCount, extractedCount, canonicalCount, recoveryStatus] of expectations) {
    const database = createProductionLikeDatabase();
    const repository = new ProductionIngestionRepository(database);
    assert.throws(
      () => repository.writeCapturedRecords(detailCapture(), { fail_after: stage }),
      ProductionIngestionWriteError
    );
    assert.equal(repository.count("ingestion_raw_blobs"), rawCount, stage);
    assert.equal(repository.count("ingestion_snapshots"), snapshotCount, stage);
    assert.equal(repository.count("ingestion_extracted_records"), extractedCount, stage);
    assert.equal(repository.count("ingestion_canonical_opportunities"), canonicalCount, stage);
    assert.equal(repository.writeCapturedRecords(detailCapture()).status, recoveryStatus, stage);
    database.close();
  }
});

test("B audit binding is exact; C/D and an unauthorized endpoint do not write", () => {
  const database = createProductionLikeDatabase();
  const repository = new ProductionIngestionRepository(database);
  const detail = detailCapture();
  assert.throws(() => repository.writeCapturedRecords({
    ...detail,
    authorization: { ...detail.authorization, admission_level: "C" }
  }), /approved B Canary authorization/u);
  assert.throws(() => repository.writeCapturedRecords({
    ...detail,
    endpoint: { ...detail.endpoint, locator: "https://www.beijing.gov.cn/unauthorized.html" }
  }), /exactly bound/u);
  assert.equal(repository.count("ingestion_organizations"), 0);
  database.close();
});

test("P2-06 code is offline, does not schedule, and does not reach legacy or Supabase paths", () => {
  const sources = [
    "lib/production-ingestion/repository.ts",
    "lib/production-ingestion/local-production-like-database.ts",
    "lib/production-ingestion/types.ts"
  ].map((file) => readFileSync(path.join(repositoryRoot, file), "utf8")).join("\n");
  assert.doesNotMatch(sources, /node:(?:http|https|net|tls|dns)|\bfetch\s*\(/u);
  assert.doesNotMatch(sources, /(?:source-scheduler|supabase|lib\/jobs|lib\/sync|app\/api|app\/site)/u);
});

test("P2-06 tests retain the shared external Network Guard", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});

function sourceDefinition(): SourceDefinition {
  return {
    source_definition_id: sourceDefinitionId,
    publisher_organization_id: organizations()[0]!.organization_id,
    name: traceable("北京市人民政府事业单位招聘"),
    publisher_kind: "GOVERNMENT_PORTAL",
    authority_level: "OFFICIAL",
    scope: "REGIONAL",
    enabled: false
  };
}

function organizations(): readonly Organization[] {
  return [{
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
}

function listCapture(): ProductionCaptureWriteInput {
  const endpoint = listEndpoint();
  const rawBlob = createRawBlob(listBytes, "2026-09-02T07:44:43.576Z" as IsoDateTime);
  const snapshot = successfulSnapshot({
    snapshot_id: "p2-04-snapshot:b2ecbdd4-03f8-4c90-bbef-c1c85c2b310e",
    endpoint,
    raw_blob: rawBlob,
    observed_at: "2026-09-02T07:44:43.576Z" as IsoDateTime,
    requested_at: "2026-09-02T07:44:43.266Z" as IsoDateTime
  });
  const extracted = new BeijingPublicInstitutionHtmlAdapter().extract({ endpoint, snapshot, raw_blob: rawBlob });
  return {
    organizations: organizations(),
    source_definition: sourceDefinition(),
    endpoint,
    authorization: authorizedListAudit(),
    collection_run: collectionRun({
      collection_run_id: "p2-04-run:e31df3a6-d762-4d02-9e3e-df2fdacc4334",
      authorization_id: "p2-04-authorization:8450b2d1-eb8c-439c-8263-e02b01376829",
      endpoint,
      started_at: "2026-09-02T07:44:43.266Z",
      completed_at: "2026-09-02T07:44:43.576Z"
    }),
    raw_blob: rawBlob,
    raw_object_path: `local-production-like://raw/${rawBlob.raw_content_sha256}`,
    original_url: endpoint.locator,
    snapshot,
    extracted_records: extracted
  };
}

function detailCapture(): ProductionCaptureWriteInput {
  const endpoint = detailEndpoint();
  const rawBlob = createRawBlob(detailBytes, observedAt);
  const snapshot = successfulSnapshot({
    snapshot_id: "p2-04d-snapshot:d46a0d70-f9d4-46d9-a9ca-bd010d0caec4",
    endpoint,
    raw_blob: rawBlob,
    observed_at: observedAt,
    requested_at: "2026-09-02T13:49:21.344Z" as IsoDateTime
  });
  const extracted = new BeijingPublicInstitutionDetailHtmlAdapter().extract({ endpoint, snapshot, raw_blob: rawBlob });
  return {
    organizations: organizations(),
    source_definition: sourceDefinition(),
    endpoint,
    authorization: authorizedDetailAudit(),
    collection_run: collectionRun({
      collection_run_id: "p2-04d-run:3648affe-5bd5-471c-b557-085bfed0a3be",
      authorization_id: "p2-04d-authorization:e3846158-b6f6-4010-b88d-c870d7ca20f0",
      endpoint,
      started_at: "2026-09-02T13:49:21.344Z",
      completed_at: "2026-09-02T13:49:21.756Z"
    }),
    raw_blob: rawBlob,
    raw_object_path: `local-production-like://raw/${rawBlob.raw_content_sha256}`,
    original_url: endpoint.locator,
    snapshot,
    extracted_records: extracted
  };
}

function updatedDetailCapture(): ProductionCaptureWriteInput {
  const html = new TextDecoder("utf-8", { fatal: true }).decode(detailBytes)
    .replaceAll("第四批", "第五批");
  const bytes = new TextEncoder().encode(html);
  const endpoint = detailEndpoint();
  const rawBlob = createRawBlob(bytes, "2026-09-02T14:00:00.000Z" as IsoDateTime);
  const snapshot = successfulSnapshot({
    snapshot_id: "p2-06-test-only-updated-detail-snapshot",
    endpoint,
    raw_blob: rawBlob,
    observed_at: "2026-09-02T14:00:00.000Z" as IsoDateTime,
    requested_at: "2026-09-02T14:00:00.000Z" as IsoDateTime
  });
  const extracted = new BeijingPublicInstitutionDetailHtmlAdapter().extract({ endpoint, snapshot, raw_blob: rawBlob });
  return {
    ...detailCapture(),
    authorization: {
      ...authorizedDetailAudit(),
      authorization_id: "p2-06-test-only-updated-authorization",
      collection_run_id: "p2-06-test-only-updated-run",
      evidence_id: "p2-06-test-only-updated-evidence",
      issued_at: "2026-09-02T14:00:00.000Z"
    },
    collection_run: collectionRun({
      collection_run_id: "p2-06-test-only-updated-run",
      authorization_id: "p2-06-test-only-updated-authorization",
      endpoint,
      started_at: "2026-09-02T14:00:00.000Z",
      completed_at: "2026-09-02T14:00:00.000Z"
    }),
    raw_blob: rawBlob,
    raw_object_path: `local-production-like://test-only/${rawBlob.raw_content_sha256}`,
    snapshot,
    extracted_records: extracted
  };
}

function detailRecord() {
  return detailCapture().extracted_records[0]!;
}

function syntheticCapture(): ProductionCaptureWriteInput {
  const organization: Organization = {
    organization_id: "organization-p2-06-test-only" as Organization["organization_id"],
    name: traceable("P2-06 合成测试单位"),
    aliases: [],
    country_code: "CN"
  };
  const source: SourceDefinition = {
    source_definition_id: "source-p2-06-test-only" as SourceDefinition["source_definition_id"],
    publisher_organization_id: organization.organization_id,
    name: traceable("P2-06 合成测试来源"),
    publisher_kind: "GOVERNMENT_PORTAL",
    authority_level: "OFFICIAL",
    scope: "SINGLE_ORGANIZATION",
    enabled: false
  };
  const syntheticEndpoint: RecruitmentEndpoint = {
    recruitment_endpoint_id: "endpoint-p2-06-test-only" as RecruitmentEndpoint["recruitment_endpoint_id"],
    source_definition_id: source.source_definition_id,
    name: traceable("P2-06 合成测试详情页"),
    coverage_regions: [{ raw_text: original("测试地区") }],
    locator: "https://example.invalid/p2-06-test-only/notice-1",
    request_method: "GET",
    content_kind: "HTML",
    adapter_key: "p2-06-synthetic-test-only",
    decoded_text_encoding: "UTF-8",
    collection_config: { timeout_ms: 1_000, max_items: 1, max_pages: 1, follow_redirects: false, retry_limit: 0 },
    enabled: false
  };
  const rawBlob = createRawBlob(
    new TextEncoder().encode("<!doctype html><title>P2-06 synthetic fixture</title>"),
    "2026-09-02T15:00:00.000Z" as IsoDateTime
  );
  const snapshot = successfulSnapshot({
    snapshot_id: "snapshot:p2-06-test-only",
    endpoint: syntheticEndpoint,
    raw_blob: rawBlob,
    observed_at: "2026-09-02T15:00:00.000Z" as IsoDateTime,
    requested_at: "2026-09-02T15:00:00.000Z" as IsoDateTime
  });
  const extractedRecord: ExtractedRecord = {
    extracted_record_id: "extracted-record:p2-06-test-only" as ExtractedRecord["extracted_record_id"],
    snapshot_id: snapshot.snapshot_id,
    source_definition_id: source.source_definition_id,
    identity_candidates: [{ kind: "ANNOUNCEMENT_URL", value: syntheticEndpoint.locator, confidence: "HIGH" }],
    raw_source_record_id: "p2-06-test-only-notice-1",
    raw_title: original("P2-06 合成测试招聘公告"),
    raw_organization_name: original("P2-06 合成测试单位"),
    raw_location_text: [original("测试地区")],
    raw_requirement_text: original("仅用于验证已观察 Requirement 写入链路的合成文本。"),
    announcement_url: syntheticEndpoint.locator,
    source_record_locator: { kind: "HTML", selector: "article.test-only" },
    adapter_metadata: { "p2-06-synthetic-test-only": { test_only: true } },
    extraction: {
      extractor_name: "P2-06SyntheticTestAdapter",
      extractor_version: "1.0.0-test",
      extracted_at: snapshot.observed_at
    }
  };
  return {
    organizations: [organization],
    source_definition: source,
    endpoint: syntheticEndpoint,
    authorization: {
      authorization_id: "authorization:p2-06-test-only",
      source_admission_id: "admission:p2-06-test-only",
      admission_level: "B",
      admission_decision: "APPROVED",
      automation_basis: "HUMAN_REVIEWED_CANARY",
      endpoint: syntheticEndpoint.locator,
      recruitment_endpoint_id: syntheticEndpoint.recruitment_endpoint_id,
      endpoint_purpose: "JOB_DETAIL",
      allowed_http_method: "GET",
      collection_run_id: "collection-run:p2-06-test-only",
      reviewer: "p2-06-test-only",
      issued_at: "2026-09-02T15:00:00.000Z",
      evidence_id: "evidence:p2-06-test-only",
      scope: "ONE_ENDPOINT_ONE_RUN",
      manual_confirmation: true,
      authorization_consumed: true,
      replay_denial_code: "AUTHORIZATION_ALREADY_USED"
    },
    collection_run: {
      collection_run_id: "collection-run:p2-06-test-only",
      source_definition_id: source.source_definition_id,
      recruitment_endpoint_id: syntheticEndpoint.recruitment_endpoint_id,
      authorization_id: "authorization:p2-06-test-only",
      started_at: "2026-09-02T15:00:00.000Z",
      completed_at: "2026-09-02T15:00:00.000Z",
      status: "SUCCESS",
      request_metadata: { locator: syntheticEndpoint.locator, method: "GET", test_only: true },
      result_metadata: { request_count: 1, transport_status: "SUCCESS", test_only: true },
      scheduler_dispatch_reference: null
    },
    raw_blob: rawBlob,
    raw_object_path: `local-production-like://test-only/${rawBlob.raw_content_sha256}`,
    original_url: syntheticEndpoint.locator,
    snapshot,
    extracted_records: [extractedRecord]
  };
}

function syntheticRequirementFact(opportunityVersionId: string): RequirementFact {
  return {
    requirement_fact_id: "requirement-fact:p2-06-test-only" as RequirementFact["requirement_fact_id"],
    opportunity_version_id: opportunityVersionId as RequirementFact["opportunity_version_id"],
    dimension: "MAJOR",
    operator: "EQUALS",
    value: { kind: "CODE", code: "JURIS_MASTER_NON_LAW" },
    subject_scope: "MASTER",
    logic_group: {
      logic_group_id: "logic-group:p2-06-test-only" as RequirementFact["logic_group"]["logic_group_id"],
      operator: "AND"
    },
    polarity: "POSITIVE",
    certainty: "EXPLICIT",
    parser_version: "p2-06-synthetic-test-only/1.0.0"
  };
}

function syntheticRequirementEvidence(fact: RequirementFact, snapshotId: SnapshotId): RequirementEvidence {
  return {
    requirement_evidence_id: "requirement-evidence:p2-06-test-only" as RequirementEvidence["requirement_evidence_id"],
    requirement_fact_id: fact.requirement_fact_id,
    snapshot_id: snapshotId,
    locator: { field_path: "article.test-only", start_offset: 0, end_offset: 21 },
    evidence_text: original("仅用于验证已观察 Requirement 写入链路的合成文本。"),
    extractor_name: "P2-06SyntheticTestAdapter",
    extractor_version: "1.0.0-test",
    parser_version: fact.parser_version
  };
}

function syntheticCandidateProfile(): CandidateProfile {
  return {
    candidate_profile_id: "candidate:p2-06-test-only" as CandidateProfile["candidate_profile_id"],
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
  readonly opportunity_version_id: string;
  readonly fact: RequirementFact;
  readonly evidence: RequirementEvidence;
}): EligibilityAssessment {
  return {
    eligibility_assessment_id: "eligibility-assessment:p2-06-test-only" as EligibilityAssessment["eligibility_assessment_id"],
    candidate_profile_id: input.candidate.candidate_profile_id,
    opportunity_version_id: input.opportunity_version_id as EligibilityAssessment["opportunity_version_id"],
    result: "ELIGIBLE",
    reason_codes: ["REQUIREMENT_SATISFIED"],
    requirement_fact_ids: [input.fact.requirement_fact_id],
    evidence_ids: [input.evidence.requirement_evidence_id],
    engine_version: "p2-06-synthetic-test-engine/1.0.0",
    parser_versions: [input.fact.parser_version],
    unresolved_conflicts: [],
    assessed_at: "2026-09-02T15:00:00.000Z" as IsoDateTime
  };
}

function listEndpoint(): RecruitmentEndpoint {
  return endpoint({
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID,
    locator: BEIJING_PUBLIC_INSTITUTION_JOB_LIST_LOCATOR,
    adapter_key: BEIJING_PUBLIC_INSTITUTION_HTML_ADAPTER_KEY,
    name: "北京市事业单位招聘列表"
  });
}

function detailEndpoint(): RecruitmentEndpoint {
  return endpoint({
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
    locator: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
    adapter_key: BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY,
    name: "北京急救中心2026年度第四批公开招聘公告详情"
  });
}

function endpoint(input: {
  readonly recruitment_endpoint_id: string;
  readonly locator: string;
  readonly adapter_key: string;
  readonly name: string;
}): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: input.recruitment_endpoint_id as RecruitmentEndpoint["recruitment_endpoint_id"],
    source_definition_id: sourceDefinitionId,
    name: traceable(input.name),
    coverage_regions: [{ raw_text: original("北京市") }],
    locator: input.locator,
    request_method: "GET",
    content_kind: "HTML",
    adapter_key: input.adapter_key,
    decoded_text_encoding: "UTF-8",
    collection_config: { timeout_ms: 10_000, max_items: 25, max_pages: 1, follow_redirects: false, retry_limit: 0 },
    enabled: false
  };
}

function createRawBlob(bytes: Uint8Array, createdAt: IsoDateTime): RawBlob {
  const hash = sha256(bytes) as RawContentSha256;
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
  readonly snapshot_id: string;
  readonly endpoint: RecruitmentEndpoint;
  readonly raw_blob: RawBlob;
  readonly observed_at: IsoDateTime;
  readonly requested_at: IsoDateTime;
}): Snapshot {
  return {
    snapshot_id: input.snapshot_id as SnapshotId,
    recruitment_endpoint_id: input.endpoint.recruitment_endpoint_id,
    request_metadata: { locator: input.endpoint.locator, method: "GET", requested_at: input.requested_at, headers: {}, parameters: {} },
    response_metadata: { http_status: 200, headers: { "content-type": "text/html; charset=utf-8" }, mime_type: "text/html; charset=utf-8", content_length: input.raw_blob.byte_length, transport_error: null },
    raw_blob_id: input.raw_blob.raw_blob_id,
    observed_at: input.observed_at,
    transport_status: "SUCCESS",
    content_hash: input.raw_blob.raw_content_sha256,
    content_length: input.raw_blob.byte_length
  };
}

function collectionRun(input: {
  readonly collection_run_id: string;
  readonly authorization_id: string;
  readonly endpoint: RecruitmentEndpoint;
  readonly started_at: string;
  readonly completed_at: string;
}) {
  return {
    collection_run_id: input.collection_run_id,
    source_definition_id: sourceDefinitionId,
    recruitment_endpoint_id: input.endpoint.recruitment_endpoint_id,
    authorization_id: input.authorization_id,
    started_at: input.started_at,
    completed_at: input.completed_at,
    status: "SUCCESS" as const,
    request_metadata: { locator: input.endpoint.locator, method: "GET" },
    result_metadata: { request_count: 1, page_count: 1, transport_status: "SUCCESS" },
    scheduler_dispatch_reference: null
  };
}

function authorizedListAudit() {
  return {
    authorization_id: "p2-04-authorization:8450b2d1-eb8c-439c-8263-e02b01376829",
    source_admission_id: "admission-beijing-public-institution",
    admission_level: "B" as const,
    admission_decision: "APPROVED" as const,
    automation_basis: "HUMAN_REVIEWED_CANARY",
    endpoint: BEIJING_PUBLIC_INSTITUTION_JOB_LIST_LOCATOR,
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID,
    endpoint_purpose: "JOB_LIST" as const,
    allowed_http_method: "GET" as const,
    collection_run_id: "p2-04-run:e31df3a6-d762-4d02-9e3e-df2fdacc4334",
    reviewer: "human-approved-by-user",
    issued_at: "2026-09-02T07:44:43.256Z",
    evidence_id: "p2-04-evidence:human-canary:600d2cdb-2bbb-423b-b6ea-632bef5da24e",
    scope: "ONE_ENDPOINT_ONE_RUN" as const,
    manual_confirmation: true as const,
    authorization_consumed: true as const,
    replay_denial_code: "AUTHORIZATION_ALREADY_USED" as const
  };
}

function authorizedDetailAudit() {
  return {
    authorization_id: "p2-04d-authorization:e3846158-b6f6-4010-b88d-c870d7ca20f0",
    source_admission_id: "admission-beijing-public-institution-job-detail",
    admission_level: "B" as const,
    admission_decision: "APPROVED" as const,
    automation_basis: "HUMAN_REVIEWED_CANARY",
    endpoint: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
    endpoint_purpose: "JOB_DETAIL" as const,
    allowed_http_method: "GET" as const,
    collection_run_id: "p2-04d-run:3648affe-5bd5-471c-b557-085bfed0a3be",
    reviewer: "human-approved-by-user",
    issued_at: "2026-09-02T13:49:21.334Z",
    evidence_id: "p2-04d-evidence:human-canary:f173a55a-c864-4071-b9c8-447f236b5ef6",
    scope: "ONE_ENDPOINT_ONE_RUN" as const,
    manual_confirmation: true as const,
    authorization_consumed: true as const,
    replay_denial_code: "AUTHORIZATION_ALREADY_USED" as const
  };
}

function original(text: string) {
  return { text, encoding: "UTF-8" } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
