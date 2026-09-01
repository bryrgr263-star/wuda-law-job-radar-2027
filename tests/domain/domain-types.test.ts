import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type {
  CandidateProfile,
  CandidateProfileId,
  CanonicalOpportunity,
  CanonicalOpportunityId,
  EligibilityAssessment,
  EligibilityAssessmentId,
  ExtractedRecord,
  ExtractedRecordId,
  IdentityHash,
  IsoDateTime,
  LifecycleEvent,
  LifecycleEventId,
  LogicGroupId,
  OpportunityContent,
  OpportunityVersion,
  OpportunityVersionId,
  Organization,
  OrganizationId,
  RawBlob,
  RawBlobId,
  RawContentSha256,
  RecruitmentEndpoint,
  RecruitmentEndpointId,
  RequirementEvidence,
  RequirementEvidenceId,
  RequirementFact,
  RequirementFactId,
  SemanticHash,
  Snapshot,
  SnapshotId,
  SourceDefinition,
  SourceDefinitionId,
  SourceOccurrence,
  SourceOccurrenceId,
  SourceOccurrenceVersion,
  SourceOccurrenceVersionId,
  TraceableText
} from "../../lib/ingestion";
import {
  AUTHORITY_LEVELS,
  CONTENT_KINDS,
  PUBLISHER_KINDS,
  SOURCE_SCOPES,
  UTF8_TEXT_ENCODING
} from "../../lib/ingestion";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const domainRoot = path.join(repositoryRoot, "lib", "ingestion", "domain");
const chineseFixturePath = path.join(
  repositoryRoot,
  "fixtures",
  "domain",
  "chinese-recruitment.json"
);

function branded<Value extends string>(value: string) {
  return value as Value;
}

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function normalized(text: string) {
  return {
    text,
    unicode_form: "NFKC",
    normalizer_version: "fixture-normalizer/1",
    operations: [
      "UNICODE_NORMALIZATION",
      "WIDTH_FOLDING",
      "PUNCTUATION_FOLDING"
    ]
  } as const;
}

function traceable(originalText: string, normalizedText = originalText): TraceableText {
  return {
    original: original(originalText),
    normalized: normalized(normalizedText)
  };
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
  }));
  return files.flat();
}

const ids = {
  organization: branded<OrganizationId>("org-1"),
  source: branded<SourceDefinitionId>("source-1"),
  endpoint: branded<RecruitmentEndpointId>("endpoint-1"),
  blob: branded<RawBlobId>("blob-1"),
  snapshot: branded<SnapshotId>("snapshot-1"),
  extracted: branded<ExtractedRecordId>("record-1"),
  occurrence: branded<SourceOccurrenceId>("occurrence-1"),
  occurrenceVersion: branded<SourceOccurrenceVersionId>("occurrence-version-1"),
  canonical: branded<CanonicalOpportunityId>("opportunity-1"),
  opportunityVersion: branded<OpportunityVersionId>("opportunity-version-1"),
  lifecycle: branded<LifecycleEventId>("lifecycle-1"),
  factBachelor: branded<RequirementFactId>("fact-bachelor"),
  factMaster: branded<RequirementFactId>("fact-master"),
  factIp: branded<RequirementFactId>("fact-ip"),
  evidence: branded<RequirementEvidenceId>("evidence-1"),
  logicAnd: branded<LogicGroupId>("logic-and"),
  logicOr: branded<LogicGroupId>("logic-or"),
  candidate: branded<CandidateProfileId>("candidate-1"),
  assessment: branded<EligibilityAssessmentId>("assessment-1")
};

const observedAt = branded<IsoDateTime>("2026-09-01T08:00:00+08:00");
const identityHash = branded<IdentityHash>("identity:source-1:record-1");
const semanticHash = branded<SemanticHash>("semantic:content-v1");
const rawHash = branded<RawContentSha256>("sha256:raw-content");

const content: OpportunityContent = {
  organization: {
    organization_id: ids.organization,
    name: traceable("中国科学院某研究所")
  },
  title: traceable("法律事务岗（2027届）", "法律事务岗(2027届)"),
  requirement_text: traceable(
    "硕士专业：法律硕士（非法学）专业；工作地点：武汉、北京。",
    "硕士专业:法律硕士(非法学)专业;工作地点:武汉、北京。"
  ),
  locations: [
    {
      country: "中国",
      province: "湖北省",
      city: "武汉市",
      raw_text: original("武汉"),
      is_nationwide: false,
      normalization_confidence: 1
    },
    {
      country: "中国",
      city: "北京市",
      raw_text: original("北京"),
      is_nationwide: false,
      normalization_confidence: 1
    }
  ],
  recruitment_year: 2027,
  recruitment_batch: traceable("2027届秋季校园招聘", "2027届秋季校园招聘"),
  announcement_locator: "fixture://official/announcement/record-1",
  application_locator: "fixture://official/recruitment/2027/legal"
};

const organization: Organization = {
  organization_id: ids.organization,
  name: content.organization.name,
  aliases: []
};

const source: SourceDefinition = {
  source_definition_id: ids.source,
  publisher_organization_id: ids.organization,
  name: traceable("官方人才招聘公告"),
  publisher_kind: "RESEARCH_INSTITUTE",
  authority_level: "OFFICIAL",
  scope: "SINGLE_ORGANIZATION",
  enabled: true
};

const endpoint: RecruitmentEndpoint = {
  recruitment_endpoint_id: ids.endpoint,
  source_definition_id: ids.source,
  name: traceable("2027届招聘公告"),
  description: traceable("面向全国发布的中文招聘公告"),
  coverage_regions: [
    { raw_text: original("全国") },
    { raw_text: original("北京市") }
  ],
  locator: "fixture://official/recruitment/2027",
  content_kind: "HTML",
  adapter_key: "fixture-html",
  decoded_text_encoding: "UTF-8",
  collection_config: {
    timeout_ms: 10_000,
    max_items: 100,
    max_pages: 5,
    follow_redirects: true,
    retry_limit: 1
  },
  enabled: true
};

const rawChineseBytes = new TextEncoder().encode(
  "硕士专业：法律硕士（非法学）专业；工作地点：武汉、北京。"
);

const blob: RawBlob = {
  raw_blob_id: ids.blob,
  bytes: rawChineseBytes,
  mime_type: "text/html; charset=utf-8",
  byte_length: rawChineseBytes.byteLength,
  raw_content_sha256: rawHash,
  created_at: observedAt
};

const snapshot: Snapshot = {
  snapshot_id: ids.snapshot,
  recruitment_endpoint_id: ids.endpoint,
  request_metadata: {
    locator: endpoint.locator,
    method: null,
    requested_at: observedAt,
    headers: {},
    parameters: {}
  },
  response_metadata: {
    http_status: null,
    headers: { "content-type": "text/html; charset=utf-8" },
    mime_type: "text/html; charset=utf-8",
    content_length: rawChineseBytes.byteLength,
    transport_error: null
  },
  transport_status: "SUCCESS",
  raw_blob_id: ids.blob,
  content_hash: rawHash,
  content_length: rawChineseBytes.byteLength,
  observed_at: observedAt
};

const extracted: ExtractedRecord = {
  extracted_record_id: ids.extracted,
  snapshot_id: ids.snapshot,
  source_definition_id: ids.source,
  identity_candidates: [
    { kind: "SOURCE_RECORD_ID", value: "record-1", confidence: "HIGH" }
  ],
  raw_source_record_id: "record-1",
  raw_title: content.title.original,
  raw_organization_name: content.organization.name.original,
  raw_location_text: content.locations.map((location) => location.raw_text),
  raw_requirement_text: content.requirement_text?.original,
  announcement_url: "fixture://official/announcement/record-1",
  application_url: content.application_locator,
  recruitment_year: original("2027届"),
  source_record_locator: {
    kind: "HTML",
    selector: "[data-fixture-record='record-1']",
    path: "body > main > article:nth-of-type(1)"
  },
  adapter_metadata: {
    fixture: { record_index: 0 }
  },
  extraction: {
    extractor_name: "fixture-extractor",
    extractor_version: "1",
    extracted_at: observedAt
  }
};

const occurrence: SourceOccurrence = {
  source_occurrence_id: ids.occurrence,
  source_definition_id: ids.source,
  recruitment_endpoint_id: ids.endpoint,
  source_record_key: "record-1",
  identity_basis: {
    kind: "SOURCE_RECORD_ID",
    source_record_id: "record-1",
    recruitment_cycle: "year:2027|batch:2027届秋季校园招聘"
  },
  identity_hash: identityHash,
  first_observed_at: observedAt
};

const occurrenceVersion: SourceOccurrenceVersion = {
  source_occurrence_version_id: ids.occurrenceVersion,
  source_occurrence_id: ids.occurrence,
  extracted_record_id: ids.extracted,
  revision: 1,
  semantic_hash: semanticHash,
  content,
  first_observed_at: observedAt
};

const canonical: CanonicalOpportunity = {
  canonical_opportunity_id: ids.canonical,
  identity_hash: branded<IdentityHash>("identity:canonical:1"),
  created_at: observedAt
};

const opportunityVersion: OpportunityVersion = {
  opportunity_version_id: ids.opportunityVersion,
  canonical_opportunity_id: ids.canonical,
  revision: 1,
  semantic_hash: semanticHash,
  content,
  source_occurrence_version_ids: [ids.occurrenceVersion],
  effective_from: observedAt
};

const bachelorFact: RequirementFact = {
  requirement_fact_id: ids.factBachelor,
  opportunity_version_id: ids.opportunityVersion,
  dimension: "MAJOR",
  operator: "ONE_OF",
  value: { kind: "CODE_SET", codes: ["LAW_STUDIES", "LAW"] },
  subject_scope: "BACHELOR",
  logic_group: { logic_group_id: ids.logicAnd, operator: "AND" },
  polarity: "POSITIVE",
  certainty: "EXPLICIT",
  parser_version: "fixture-parser/1"
};

const masterFact: RequirementFact = {
  requirement_fact_id: ids.factMaster,
  opportunity_version_id: ids.opportunityVersion,
  dimension: "MAJOR",
  operator: "EQUALS",
  value: { kind: "CODE", code: "JURIS_MASTER_NON_LAW" },
  subject_scope: "MASTER",
  logic_group: { logic_group_id: ids.logicAnd, operator: "AND" },
  polarity: "POSITIVE",
  certainty: "EXPLICIT",
  parser_version: "fixture-parser/1"
};

const intellectualPropertyFact: RequirementFact = {
  requirement_fact_id: ids.factIp,
  opportunity_version_id: ids.opportunityVersion,
  dimension: "MAJOR",
  operator: "EQUALS",
  value: { kind: "CODE", code: "INTELLECTUAL_PROPERTY" },
  subject_scope: "MASTER",
  logic_group: { logic_group_id: ids.logicOr, operator: "OR" },
  polarity: "POSITIVE",
  certainty: "EXPLICIT",
  parser_version: "fixture-parser/1"
};

const evidence: RequirementEvidence = {
  requirement_evidence_id: ids.evidence,
  requirement_fact_id: ids.factMaster,
  snapshot_id: ids.snapshot,
  locator: { field_path: "requirements.education", start_offset: 0, end_offset: 18 },
  evidence_text: original("硕士专业：法律硕士（非法学）专业"),
  normalized_text: normalized("硕士专业:法律硕士(非法学)专业"),
  extractor_name: "fixture-extractor",
  extractor_version: "1",
  parser_version: "fixture-parser/1"
};

const candidate: CandidateProfile = {
  candidate_profile_id: ids.candidate,
  education: [
    {
      level: "BACHELOR",
      institution: traceable("某大学"),
      program_name: traceable("非法律专业"),
      normalized_program_codes: [],
      academic_background: "NON_LAW",
      graduation_year: 2024
    },
    {
      level: "MASTER",
      institution: traceable("武汉大学"),
      program_name: traceable("法律硕士（非法学）", "法律硕士(非法学)"),
      normalized_program_codes: ["JURIS_MASTER", "JURIS_MASTER_NON_LAW"],
      academic_background: "NON_LAW",
      graduation_year: 2027
    }
  ],
  target_graduation_year: 2027,
  professional_qualifications: [],
  languages: ["中文"]
};

const assessment: EligibilityAssessment = {
  eligibility_assessment_id: ids.assessment,
  candidate_profile_id: ids.candidate,
  opportunity_version_id: ids.opportunityVersion,
  result: "ELIGIBLE",
  reason_codes: ["REQUIREMENT_SATISFIED"],
  requirement_fact_ids: [ids.factMaster],
  evidence_ids: [ids.evidence],
  engine_version: "fixture-engine/1",
  parser_versions: ["fixture-parser/1"],
  unresolved_conflicts: [],
  assessed_at: observedAt
};

test("domain source contains no platform or legacy scoring fields", async () => {
  const forbiddenPatterns = [
    /zhaopin/i,
    /positionNumber/,
    /boss_id/i,
    /\bjobId\b/,
    /match_score/,
    /recommendation_score/,
    /recommendation_level/,
    /non_law_rule/
  ];
  const violations: string[] = [];
  for (const filePath of await collectFiles(domainRoot)) {
    const sourceText = await readFile(filePath, "utf8");
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(sourceText)) violations.push(`${path.basename(filePath)}: ${pattern}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("source dimensions are independent and complete", () => {
  assert.equal(organization.organization_id, ids.organization);
  assert.equal(source.publisher_organization_id, ids.organization);
  assert.equal(endpoint.source_definition_id, ids.source);
  assert.equal(endpoint.description?.original.text, "面向全国发布的中文招聘公告");
  assert.deepEqual(endpoint.coverage_regions.map((region) => region.raw_text.text), ["全国", "北京市"]);
  assert.equal(PUBLISHER_KINDS.length, 7);
  assert.deepEqual(AUTHORITY_LEVELS, ["OFFICIAL", "AUTHORIZED", "THIRD_PARTY", "UNKNOWN"]);
  assert.deepEqual(SOURCE_SCOPES, ["SINGLE_ORGANIZATION", "MULTI_ORGANIZATION", "REGIONAL", "NATIONAL"]);
  assert.deepEqual(CONTENT_KINDS, ["HTML", "JSON", "PDF", "RSS", "SITEMAP", "FILE"]);
});

test("requirements distinguish bachelor and master scopes", () => {
  assert.equal(bachelorFact.subject_scope, "BACHELOR");
  assert.equal(masterFact.subject_scope, "MASTER");
  assert.notEqual(bachelorFact.requirement_fact_id, masterFact.requirement_fact_id);
});

test("requirements support AND and OR logic without turning alternatives into AND", () => {
  assert.equal(bachelorFact.logic_group.operator, "AND");
  assert.equal(masterFact.logic_group.operator, "AND");
  assert.equal(intellectualPropertyFact.logic_group.operator, "OR");
  assert.notEqual(intellectualPropertyFact.logic_group.logic_group_id, ids.logicAnd);
});

test("evidence and eligibility retain fact and snapshot references", () => {
  assert.equal(evidence.requirement_fact_id, masterFact.requirement_fact_id);
  assert.equal(evidence.snapshot_id, snapshot.snapshot_id);
  assert.deepEqual(assessment.requirement_fact_ids, [masterFact.requirement_fact_id]);
  assert.deepEqual(assessment.evidence_ids, [evidence.requirement_evidence_id]);
});

test("an opportunity supports multiple structured locations", () => {
  assert.equal(opportunityVersion.content.locations.length, 2);
  assert.deepEqual(opportunityVersion.content.locations.map((location) => location.raw_text.text), ["武汉", "北京"]);
});

test("occurrence identity and semantic versions are independent", () => {
  assert.equal(occurrence.identity_hash, identityHash);
  assert.equal(occurrenceVersion.source_occurrence_id, occurrence.source_occurrence_id);
  assert.equal(occurrenceVersion.semantic_hash, semanticHash);
  assert.equal(extracted.snapshot_id, snapshot.snapshot_id);
  assert.equal(canonical.canonical_opportunity_id, opportunityVersion.canonical_opportunity_id);
});

test("lifecycle events do not create or replace content versions", () => {
  const event: LifecycleEvent = {
    lifecycle_event_id: ids.lifecycle,
    target: { kind: "SOURCE_OCCURRENCE", source_occurrence_id: ids.occurrence },
    event_kind: "ACTIVE_CONFIRMED",
    observed_at: observedAt,
    snapshot_ids: [ids.snapshot],
    reason_code: "SOURCE_PRESENT"
  };
  assert.equal(event.target.kind, "SOURCE_OCCURRENCE");
  assert.equal(occurrenceVersion.revision, 1);
  assert.equal(opportunityVersion.revision, 1);
});

test("raw SHA-256, identity hash, and semantic hash remain separate concepts", () => {
  assert.equal(blob.raw_content_sha256, rawHash);
  assert.equal(occurrence.identity_hash, identityHash);
  assert.equal(occurrenceVersion.semantic_hash, semanticHash);
  assert.notEqual(blob.raw_content_sha256, occurrenceVersion.semantic_hash);
});

test("Chinese UTF-8 originals survive width and punctuation normalization", async () => {
  const fixture = JSON.parse(await readFile(chineseFixturePath, "utf8")) as {
    organization_name: { original: string; normalized: string };
    opportunity_title: { original: string; normalized: string };
    requirement: { original: string; normalized: string };
    locations: string[];
  };
  assert.equal(new TextDecoder("utf-8").decode(blob.bytes), fixture.requirement.original);
  assert.equal(snapshot.raw_blob_id, blob.raw_blob_id);
  assert.equal(snapshot.content_hash, blob.raw_content_sha256);
  assert.equal(extracted.raw_organization_name?.text, fixture.organization_name.original);
  assert.equal(occurrenceVersion.content.title.original.text, fixture.opportunity_title.original);
  assert.equal(occurrenceVersion.content.requirement_text?.original.text, fixture.requirement.original);
  assert.equal(fixture.opportunity_title.original, "法律事务岗（2027届）");
  assert.equal(fixture.opportunity_title.normalized, "法律事务岗(2027届)");
  assert.equal(evidence.evidence_text.text, "硕士专业：法律硕士（非法学）专业");
  assert.equal(evidence.normalized_text?.text, "硕士专业:法律硕士(非法学)专业");
  assert.notEqual(evidence.evidence_text.text, evidence.normalized_text?.text);
  assert.deepEqual(content.locations.map((location) => location.raw_text.text), fixture.locations);
  assert.equal(candidate.education[1].institution.original.text, "武汉大学");
});

const incompatibleRawHash = branded<RawContentSha256>("sha256:not-semantic");
// @ts-expect-error Raw content hashes cannot be assigned to semantic hashes.
const invalidSemanticHash: SemanticHash = incompatibleRawHash;

// @ts-expect-error ELIGIBLE assessments require at least one evidence reference.
const invalidEligibleAssessment: EligibilityAssessment = {
  ...assessment,
  evidence_ids: []
};

void invalidSemanticHash;
void invalidEligibleAssessment;
