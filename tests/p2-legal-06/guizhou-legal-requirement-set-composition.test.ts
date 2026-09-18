import "../helpers/network-guard";
import { readHistoricalEvidenceBytes, readHistoricalEvidenceJson } from "../helpers/historical-evidence";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  UTF8_TEXT_ENCODING,
  type AdapterExtractionInput,
  type ExtractedRecordId,
  type RawBlob,
  type RawBlobId,
  type RawContentSha256,
  type RequirementEvidenceFragment,
  type RequirementEvidenceFragmentId,
  type Snapshot,
  type SnapshotId
} from "../../lib/ingestion";
import { GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID } from "../../lib/live-canary/p2-legal-01/guizhou-legal-canary-admission-preflight";
import { GUIZHOU_ATTACHMENT_EXPECTED_MIME } from "../../lib/live-canary/p2-legal-04/guizhou-attachment-observation-canary";
import {
  GuizhouLegalXlsxRequirementObservationAdapter,
  P2_LEGAL_05_RAW_SHA256,
  P2_LEGAL_05_SNAPSHOT_ID,
  createGuizhouLegalRequirementEndpoint
} from "../../lib/live-canary/p2-legal-05/guizhou-legal-xlsx-requirement-adapter";
import {
  P2_LEGAL_06_NOTICE_RAW_SHA256,
  P2_LEGAL_06_NOTICE_SNAPSHOT_ID,
  buildGuizhouJobTableRequirementSource,
  buildGuizhouNoticeRequirementSource,
  composeRequirementSet,
  createP2Legal06OpportunityVersionId,
  type RequirementCompositionFactInput,
  type RequirementCompositionIdentity,
  type RequirementCompositionSource,
  type RequirementCompositionSourceKind
} from "../../lib/live-canary/p2-legal-06/guizhou-legal-requirement-set-composer";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const noticeCapture = loadCapture(
  "guizhou-notice",
  P2_LEGAL_06_NOTICE_SNAPSHOT_ID,
  P2_LEGAL_06_NOTICE_RAW_SHA256
);
const attachmentCapture = loadCapture(
  "guizhou-attachment",
  P2_LEGAL_05_SNAPSHOT_ID,
  P2_LEGAL_05_RAW_SHA256
);
const xlsxParsed = new GuizhouLegalXlsxRequirementObservationAdapter().parse(xlsxInput());
const noticeSource = buildGuizhouNoticeRequirementSource(
  noticeCapture.bytes,
  noticeCapture.snapshot.snapshot_id
);
const jobTableSource = buildGuizhouJobTableRequirementSource(xlsxParsed);
const actual = composeRequirementSet(actualIdentity(), [noticeSource, jobTableSource]);

test("announcement and XLSX compose into one Requirement Set with both sources", () => {
  assert.equal(actual.requirement_set.completeness.status, "REVIEW_REQUIRED");
  assert.deepEqual(actual.requirement_set.completeness.covered_snapshot_ids, [
    P2_LEGAL_06_NOTICE_SNAPSHOT_ID,
    P2_LEGAL_05_SNAPSHOT_ID
  ].sort());
  assert.equal(actual.requirement_set.completeness.covered_extracted_record_ids.length, 2);
  assert.equal(actual.requirement_set.facts.length, 6);
  assert.ok(actual.observation_audit.some((item) => item.source === "ANNOUNCEMENT"));
  assert.ok(actual.observation_audit.some((item) => item.source === "JOB_TABLE"));
});

test("the same source-neutral Fact merges while retaining two Evidence Fragments", () => {
  const first = syntheticSource("ANNOUNCEMENT", "BACHELOR", "same-html");
  const second = syntheticSource("JOB_TABLE", "BACHELOR", "same-sheet");
  const composed = composeRequirementSet(syntheticIdentity("same"), [first, second]);
  assert.equal(composed.requirement_set.completeness.status, "COMPLETE");
  assert.equal(composed.requirement_set.facts.length, 1);
  assert.equal(composed.requirement_set.evidence.length, 2);
  assert.deepEqual(composed.fact_audit[0]?.sources, ["ANNOUNCEMENT", "JOB_TABLE"]);
  assert.equal(composed.fact_audit[0]?.evidence_fragment_ids.length, 2);
});

test("different aligned source values preserve Facts and create SOURCE_CONFLICT", () => {
  const first = syntheticSource("ANNOUNCEMENT", "BACHELOR", "conflict-html");
  const second = syntheticSource("JOB_TABLE", "MASTER", "conflict-sheet");
  const composed = composeRequirementSet(syntheticIdentity("conflict"), [first, second]);
  assert.equal(composed.requirement_set.completeness.status, "REVIEW_REQUIRED");
  assert.equal(composed.requirement_set.facts.length, 2);
  assert.equal(composed.source_conflicts.length, 1);
  assert.equal(composed.source_conflicts[0]?.code, "SOURCE_CONFLICT");
  assert.ok(composed.requirement_set.completeness.blockers.some(
    (blocker) => blocker.code === "AMBIGUOUS"
  ));
});

test("actual AMBIGUOUS clauses block completeness with source Evidence", () => {
  const ambiguous = actual.composition_blockers.filter((blocker) => blocker.code === "AMBIGUOUS");
  assert.ok(ambiguous.length >= 5);
  assert.ok(ambiguous.some((blocker) => blocker.source_kinds.includes("ANNOUNCEMENT")));
  assert.ok(ambiguous.some((blocker) => blocker.source_kinds.includes("JOB_TABLE")));
  assert.ok(ambiguous.every((blocker) => blocker.evidence_fragment_ids.length > 0));
});

test("actual UNPARSED_CLAUSE clauses block completeness", () => {
  const unparsed = actual.composition_blockers.filter(
    (blocker) => blocker.code === "UNPARSED_CLAUSE"
  );
  assert.ok(unparsed.length >= 4);
  assert.ok(unparsed.some((blocker) => blocker.source_kinds.includes("ANNOUNCEMENT")));
  assert.ok(unparsed.some((blocker) => blocker.source_kinds.includes("JOB_TABLE")));
});

test("actual DOMAIN_GAP includes the gender restriction and announcement exclusions", () => {
  const domainGaps = actual.observation_audit.filter(
    (observation) => observation.status === "DOMAIN_GAP_OBSERVED"
  );
  assert.ok(domainGaps.some((observation) => observation.raw_value === "限男性"));
  assert.ok(domainGaps.some((observation) => observation.raw_value?.includes("中华人民共和国国籍")));
  assert.ok(domainGaps.some((observation) => observation.raw_value?.includes("现役军人")));
  assert.ok(domainGaps.every((observation) => observation.evidence_fragment_ids.length > 0));
});

test("0351 法律 is retained as a directory reference and never inferred as non-law JM", () => {
  const code0351 = actual.requirement_set.facts.find((fact) => {
    return fact.value.kind === "PROGRAM_REFERENCE"
      && fact.value.reference.program_code === "0351";
  });
  assert.ok(code0351);
  if (code0351.value.kind !== "PROGRAM_REFERENCE") throw new Error("Expected program reference");
  assert.equal(code0351.value.reference.program_label?.text, "法律");
  assert.equal(code0351.value.reference.directory_namespace, "研究生教育学科专业目录");
  assert.equal(code0351.subject_scope, "GRADUATE");
  assert.equal(actual.requirement_set.facts.some((fact) => {
    return fact.value.kind === "CODE" && fact.value.code === "JURIS_MASTER_NON_LAW";
  }), false);
});

test("bachelor and graduate scopes stay separate and never become MASTER", () => {
  const majorFacts = actual.requirement_set.facts.filter((fact) => fact.dimension === "MAJOR");
  assert.ok(majorFacts.some((fact) => fact.subject_scope === "BACHELOR"));
  assert.equal(majorFacts.filter((fact) => fact.subject_scope === "GRADUATE").length, 2);
  assert.equal(majorFacts.some((fact) => fact.subject_scope === "MASTER"), false);
  assert.ok(actual.composition_blockers.some((blocker) => {
    return blocker.code === "AMBIGUOUS" && blocker.source_kinds.includes("JOB_TABLE");
  }));
});

test("COMPLETE is possible only without blockers; the real set remains REVIEW_REQUIRED", () => {
  const complete = composeRequirementSet(
    syntheticIdentity("complete"),
    [syntheticSource("ANNOUNCEMENT", "BACHELOR", "complete")]
  );
  assert.equal(complete.requirement_set.completeness.status, "COMPLETE");
  assert.equal(complete.requirement_set.completeness.blockers.length, 0);
  assert.equal(actual.requirement_set.completeness.status, "REVIEW_REQUIRED");
  assert.ok(actual.requirement_set.completeness.blockers.length > 0);
});

test("each real Fact and Observation remains traceable to HTML or Sheet/Cell", () => {
  const fragments = new Map(actual.requirement_set.evidence_fragments.map((fragment) => [
    fragment.requirement_evidence_fragment_id,
    fragment
  ]));
  for (const evidence of actual.requirement_set.evidence) {
    assert.ok([P2_LEGAL_06_NOTICE_SNAPSHOT_ID, P2_LEGAL_05_SNAPSHOT_ID].includes(
      evidence.snapshot_id
    ));
    assert.ok(evidence.locator.kind === "HTML" || evidence.locator.kind === "SPREADSHEET");
  }
  for (const observation of actual.requirement_set.observations) {
    for (const fragmentId of observation.evidence_fragment_ids) {
      const fragment = fragments.get(fragmentId);
      assert.ok(fragment);
      assert.ok(fragment.locator.kind === "HTML" || fragment.locator.kind === "SPREADSHEET");
      if (fragment.locator.kind === "SPREADSHEET") {
        assert.equal(fragment.locator.sheet, "Sheet1");
        assert.ok(fragment.locator.cell_or_range.length > 0);
      } else {
        assert.match(fragment.locator.selector ?? "", /p:nth-of-type\(\d+\)/u);
      }
    }
  }
});

test("composition performs zero network requests and creates no Eligibility objects", () => {
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = async () => {
    networkRequests += 1;
    throw new Error("P2-LEGAL-06 must remain offline");
  };
  try {
    const composed = composeRequirementSet(actualIdentity(), [noticeSource, jobTableSource]);
    assert.equal(networkRequests, 0);
    assert.equal(composed.network_requests, 0);
    assert.equal("candidate_profile" in composed, false);
    assert.equal("eligibility_assessment" in composed, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const source = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-legal-06/guizhou-legal-requirement-set-composer.ts"
  ), "utf8");
  assert.doesNotMatch(source, /globalThis\.fetch|node:(?:http|https|net|tls|dns)/u);
  assert.doesNotMatch(source, /EligibilityEngine|CandidateProfile|EligibilityAssessment/u);
});

interface Capture {
  readonly bytes: Uint8Array;
  readonly snapshot: Snapshot;
}

interface ExecutionIndex {
  readonly report: {
    readonly raw: {
      readonly local_artifact: string;
    };
  };
}

function loadCapture(captureId: "guizhou-notice" | "guizhou-attachment", snapshotId: SnapshotId, rawHash: string): Capture {
  const bytes = new Uint8Array(readHistoricalEvidenceBytes(
    captureId === "guizhou-notice" ? "guizhou-notice-html" : "guizhou-attachment-xlsx"
  ));
  const snapshot = readHistoricalEvidenceJson<Snapshot>(`${captureId}-snapshot`);
  assert.equal(sha256(bytes), rawHash);
  assert.equal(snapshot.snapshot_id, snapshotId);
  return { bytes, snapshot };
}

function xlsxInput(): AdapterExtractionInput {
  const rawBlob: RawBlob = {
    raw_blob_id: `sha256:${P2_LEGAL_05_RAW_SHA256}` as RawBlobId,
    bytes: attachmentCapture.bytes,
    raw_content_sha256: P2_LEGAL_05_RAW_SHA256 as RawContentSha256,
    mime_type: GUIZHOU_ATTACHMENT_EXPECTED_MIME,
    byte_length: attachmentCapture.bytes.byteLength,
    created_at: attachmentCapture.snapshot.observed_at
  };
  return {
    endpoint: createGuizhouLegalRequirementEndpoint(GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID),
    snapshot: attachmentCapture.snapshot,
    raw_blob: rawBlob
  };
}

function actualIdentity(): RequirementCompositionIdentity {
  return {
    opportunity_version_id: createP2Legal06OpportunityVersionId(
      GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID,
      "22828700101",
      [P2_LEGAL_06_NOTICE_SNAPSHOT_ID, P2_LEGAL_05_SNAPSHOT_ID]
    ),
    source_definition_id: GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID,
    job_code: "22828700101",
    title: "助理研究员1",
    organization: "贵州省法治研究服务保障中心"
  };
}

function syntheticIdentity(label: string): RequirementCompositionIdentity {
  return {
    opportunity_version_id: `opportunity-version:synthetic-${label}` as RequirementCompositionIdentity["opportunity_version_id"],
    source_definition_id: "source-synthetic",
    job_code: `job-${label}`,
    title: "Synthetic",
    organization: "Synthetic"
  };
}

function syntheticSource(
  sourceKind: RequirementCompositionSourceKind,
  educationCode: string,
  label: string
): RequirementCompositionSource {
  const extractedRecordId = `extracted:synthetic-${label}` as ExtractedRecordId;
  const snapshotId = `snapshot:synthetic-${label}` as SnapshotId;
  const fragmentId = `requirement-evidence-fragment:synthetic-${label}` as RequirementEvidenceFragmentId;
  const fragment: RequirementEvidenceFragment = sourceKind === "ANNOUNCEMENT"
    ? {
        requirement_evidence_fragment_id: fragmentId,
        extracted_record_id: extractedRecordId,
        snapshot_id: snapshotId,
        locator: { kind: "HTML", selector: "#requirement" },
        extractor_name: "Synthetic",
        extractor_version: "1",
        parser_version: "1",
        observed_value_state: "TEXT",
        original_text: { text: educationCode, encoding: UTF8_TEXT_ENCODING },
        normalized_text: normalized(educationCode)
      }
    : {
        requirement_evidence_fragment_id: fragmentId,
        extracted_record_id: extractedRecordId,
        snapshot_id: snapshotId,
        locator: { kind: "SPREADSHEET", sheet: "Sheet1", cell_or_range: "A1" },
        extractor_name: "Synthetic",
        extractor_version: "1",
        parser_version: "1",
        observed_value_state: "TEXT",
        original_text: { text: educationCode, encoding: UTF8_TEXT_ENCODING },
        normalized_text: normalized(educationCode)
      };
  const fact: RequirementCompositionFactInput = {
    source_fact_id: `fact:${label}`,
    alignment_key: "EDUCATION_LEVEL:CANDIDATE",
    dimension: "EDUCATION_LEVEL",
    operator: "EQUALS",
    value: { kind: "CODE", code: educationCode },
    subject_scope: "CANDIDATE",
    logic_operator: "AND",
    polarity: "POSITIVE",
    certainty: "EXPLICIT",
    evidence_fragment_ids: [fragmentId]
  };
  return {
    source_kind: sourceKind,
    source_label: `Synthetic ${sourceKind}`,
    extracted_record_id: extractedRecordId,
    snapshot_id: snapshotId,
    evidence_fragments: [fragment],
    facts: [fact],
    observations: [{
      source_observation_id: `observation:${label}`,
      status: "CONFIRMED_REQUIREMENT",
      clause_role: "MANDATORY",
      dimension_hint: "EDUCATION_LEVEL",
      subject_scope: "CANDIDATE",
      raw_value: educationCode,
      normalized_value: educationCode,
      source_fact_ids: [fact.source_fact_id],
      evidence_fragment_ids: [fragmentId]
    }],
    absences: []
  };
}

function normalized(text: string) {
  return {
    text,
    unicode_form: "NFKC" as const,
    normalizer_version: "synthetic/1",
    operations: ["UNICODE_NORMALIZATION" as const]
  };
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
