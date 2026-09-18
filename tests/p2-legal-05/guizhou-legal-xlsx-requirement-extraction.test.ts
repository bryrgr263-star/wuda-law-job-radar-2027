import "../helpers/network-guard";
import { readHistoricalEvidenceBytes, readHistoricalEvidenceJson } from "../helpers/historical-evidence";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  materializeSourceOccurrenceVersion,
  prepareSourceOccurrenceMaterialization,
  validateSourceOccurrenceVersionBinding,
  type AdapterExtractionInput,
  type RawBlob,
  type RawBlobId,
  type RawContentSha256,
  type Snapshot
} from "../../lib/ingestion";
import { GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID } from "../../lib/live-canary/p2-legal-01/guizhou-legal-canary-admission-preflight";
import { GUIZHOU_ATTACHMENT_EXPECTED_MIME } from "../../lib/live-canary/p2-legal-04/guizhou-attachment-observation-canary";
import {
  GuizhouLegalXlsxRequirementObservationAdapter,
  P2_LEGAL_05_ADAPTER_KEY,
  P2_LEGAL_05_PARSER_VERSION,
  P2_LEGAL_05_RAW_SHA256,
  P2_LEGAL_05_SNAPSHOT_ID,
  P2_LEGAL_05_TARGET_JOB_CODE,
  createGuizhouLegalRequirementEndpoint
} from "../../lib/live-canary/p2-legal-05/guizhou-legal-xlsx-requirement-adapter";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rawBytes = new Uint8Array(readHistoricalEvidenceBytes("guizhou-attachment-xlsx"));
const snapshot = readHistoricalEvidenceJson<Snapshot>("guizhou-attachment-snapshot");
const parsed = new GuizhouLegalXlsxRequirementObservationAdapter().parse(captured());

test("sealed P2-LEGAL-04 Raw and Snapshot are the only offline inputs", () => {
  assert.equal(sha256(rawBytes), P2_LEGAL_05_RAW_SHA256);
  assert.equal(snapshot.snapshot_id, P2_LEGAL_05_SNAPSHOT_ID);
  assert.equal(snapshot.content_hash, P2_LEGAL_05_RAW_SHA256);
  assert.equal(snapshot.content_length, rawBytes.byteLength);
  assert.equal(snapshot.response_metadata.mime_type, GUIZHOU_ATTACHMENT_EXPECTED_MIME);
});

test("workbook and exact target job row are located deterministically", () => {
  assert.equal(parsed.workbook_audit.sheet_count, 1);
  assert.equal(parsed.workbook_audit.selected_sheet, "Sheet1");
  assert.equal(parsed.workbook_audit.sheets[0]?.used_range, "A1:O288");
  assert.equal(parsed.workbook_audit.header_row, 3);
  assert.equal(parsed.workbook_audit.header_range, "A3:O3");
  assert.equal(parsed.workbook_audit.job_data_start_row, 4);
  assert.equal(parsed.workbook_audit.job_data_end_row, 5);
  assert.equal(parsed.workbook_audit.target_job_code, P2_LEGAL_05_TARGET_JOB_CODE);
  assert.equal(parsed.workbook_audit.target_row, 4);
  assert.equal(parsed.workbook_audit.target_row_range, "A4:O4");
  assert.equal(parsed.workbook_audit.matching_target_rows, 1);
});

test("merged cells, hidden state, and formula audit remain source-faithful", () => {
  const sheet = parsed.workbook_audit.sheets[0]!;
  assert.deepEqual(sheet.merged_cells, ["A1:B1", "A2:O2", "A6:O6"]);
  assert.deepEqual(sheet.hidden_rows, []);
  assert.deepEqual(sheet.hidden_columns, []);
  assert.deepEqual(sheet.formula_cells, []);
  assert.deepEqual(sheet.merged_cell_anchors.map((anchor) => anchor.anchor), ["A1", "A2", "A6"]);
});

test("target row field values and exact Cell Evidence are preserved", () => {
  assert.equal(parsed.fields.job_code.raw_value, 22828700101);
  assert.equal(parsed.fields.job_code.normalized_value, "22828700101");
  assert.equal(parsed.fields.job_code.cell_or_range, "E4");
  assert.equal(parsed.fields.title.raw_value, "助理研究员1");
  assert.equal(parsed.fields.title.cell_or_range, "D4");
  assert.equal(parsed.fields.organization.raw_value, "贵州省法治研究服务保障中心");
  assert.equal(parsed.fields.organization.cell_or_range, "B4");
  assert.equal(parsed.fields.recruitment_count.raw_value, 1);
  assert.equal(parsed.fields.recruitment_count.cell_or_range, "G4");
  for (const field of Object.values(parsed.fields)) {
    assert.equal(field.snapshot_id, P2_LEGAL_05_SNAPSHOT_ID);
    assert.equal(field.sheet, "Sheet1");
    assert.equal(field.parser_version, P2_LEGAL_05_PARSER_VERSION);
  }
});

test("education, degree, majors, qualification, and note retain exact raw text", () => {
  assert.equal(parsed.fields.education_requirement.raw_value, "本科及以上");
  assert.equal(parsed.fields.degree_requirement.raw_value, "学士及以上");
  assert.equal(
    parsed.fields.major_requirement.raw_value,
    "本科：法学类\n研究生：法学（0301）；法律（0351）"
  );
  assert.equal(
    parsed.fields.other_qualification_conditions.raw_value,
    "1.限男性；\n2.具有A类法律职业资格证书。"
  );
  assert.equal(parsed.fields.notes.raw_value, "需到男犯监狱、男性戒毒场所开展调研工作。");
  assert.equal(parsed.fields.education_requirement.cell_or_range, "K4");
  assert.equal(parsed.fields.degree_requirement.cell_or_range, "L4");
  assert.equal(parsed.fields.major_requirement.cell_or_range, "M4");
  assert.equal(parsed.fields.other_qualification_conditions.cell_or_range, "N4");
  assert.equal(parsed.fields.notes.cell_or_range, "O4");
});

test("法律 and code 0351 never become 法律硕士（非法学）", () => {
  assert.equal(parsed.legal_focus.explicit_law_non_law, "NOT_OBSERVED");
  assert.equal(parsed.legal_focus.explicit_juris_master_non_law, "NOT_OBSERVED");
  assert.equal(parsed.legal_focus.juris_master_only, "NOT_OBSERVED");
  assert.equal(parsed.legal_focus.law_academic_master, "NOT_OBSERVED");
  assert.equal(parsed.legal_focus.non_law_eligibility_from_0351, "AMBIGUOUS");
  assert.equal(
    parsed.fact_candidates.some((fact) => {
      return fact.value.kind === "CODE" && fact.value.code === "JURIS_MASTER_NON_LAW";
    }),
    false
  );
});

test("BACHELOR and GRADUATE majors stay isolated from MASTER", () => {
  const majorFacts = parsed.fact_candidates.filter((fact) => fact.dimension === "MAJOR");
  assert.deepEqual(
    [...new Set(majorFacts.map((fact) => fact.subject_scope))].sort(),
    ["BACHELOR", "GRADUATE"]
  );
  assert.equal(majorFacts.some((fact) => fact.subject_scope === "MASTER"), false);
  const graduateReferences = majorFacts
    .filter((fact) => fact.subject_scope === "GRADUATE")
    .map((fact) => {
      assert.equal(fact.value.kind, "PROGRAM_REFERENCE");
      if (fact.value.kind !== "PROGRAM_REFERENCE") throw new Error("Expected program reference");
      return fact.value.reference;
    });
  assert.deepEqual(graduateReferences.map((reference) => reference.program_code), ["0301", "0351"]);
  for (const reference of graduateReferences) {
    assert.equal(reference.directory_namespace, "研究生教育学科专业目录");
    assert.equal(reference.directory_version, "2022年");
  }
});

test("every fact candidate resolves to source-neutral Snapshot and Cell Evidence", () => {
  const fragments = new Map(parsed.evidence_fragments.map((fragment) => [
    fragment.requirement_evidence_fragment_id,
    fragment
  ]));
  for (const fact of parsed.fact_candidates) {
    assert.ok(fact.evidence_fragment_ids.length > 0);
    for (const fragmentId of fact.evidence_fragment_ids) {
      const fragment = fragments.get(fragmentId);
      assert.ok(fragment);
      assert.equal(fragment.snapshot_id, P2_LEGAL_05_SNAPSHOT_ID);
      assert.equal(fragment.locator.kind, "SPREADSHEET");
      if (fragment.locator.kind === "SPREADSHEET") {
        assert.equal(fragment.locator.sheet, "Sheet1");
        assert.match(fragment.locator.cell_or_range, /^(?:[A-Z]+\d+)(?::[A-Z]+\d+)?$/u);
      }
      assert.equal(fragment.parser_version, P2_LEGAL_05_PARSER_VERSION);
    }
  }
});

test("unparsed, ambiguous, domain-gap, and not-observed items block downstream completion", () => {
  const byStatus = (status: string) => parsed.observation_candidates.filter(
    (observation) => observation.status === status
  );
  assert.equal(byStatus("UNPARSED_CLAUSE").length, 1);
  assert.equal(byStatus("AMBIGUOUS").length, 2);
  assert.equal(byStatus("DOMAIN_GAP_OBSERVED").length, 1);
  assert.equal(byStatus("NOT_OBSERVED").length, 5);
  assert.ok(parsed.observation_candidates
    .filter((observation) => observation.status !== "CONFIRMED_REQUIREMENT")
    .every((observation) => observation.blocks_completeness));
  assert.equal(parsed.requirement_set_readiness.final_requirement_set_ready, false);
  assert.ok(parsed.requirement_set_readiness.reason_codes.includes("GENDER_REQUIREMENT_DOMAIN_GAP"));
  assert.ok(parsed.requirement_set_readiness.reason_codes.includes("JOB_NOTE_CLASSIFICATION_UNRESOLVED"));
});

test("A-class legal qualification is explicit while age and work experience stay NOT_OBSERVED", () => {
  const qualification = parsed.fact_candidates.find(
    (fact) => fact.dimension === "PROFESSIONAL_QUALIFICATION"
  );
  assert.ok(qualification);
  assert.deepEqual(qualification.value, {
    kind: "CODE",
    code: "LEGAL_PROFESSIONAL_QUALIFICATION_A"
  });
  const notObservedDimensions = parsed.observation_candidates
    .filter((observation) => observation.status === "NOT_OBSERVED")
    .map((observation) => observation.dimension_hint);
  assert.ok(notObservedDimensions.includes("AGE"));
  assert.ok(notObservedDimensions.includes("WORK_EXPERIENCE"));
  assert.ok(notObservedDimensions.includes("CANDIDATE_COHORT"));
  assert.ok(notObservedDimensions.includes("HOUSEHOLD_REGISTRATION"));
  assert.ok(notObservedDimensions.includes("STUDENT_ORIGIN"));
});

test("adapter performs zero network requests and creates no downstream decision objects", () => {
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = async () => {
    networkRequests += 1;
    throw new Error("Network access is forbidden in P2-LEGAL-05");
  };
  try {
    const result = new GuizhouLegalXlsxRequirementObservationAdapter().parse(captured());
    assert.equal(networkRequests, 0);
    assert.equal(result.record.adapter_metadata[P2_LEGAL_05_ADAPTER_KEY]?.requirement_set_created, false);
    assert.equal(result.record.adapter_metadata[P2_LEGAL_05_ADAPTER_KEY]?.eligibility_executed, false);
    assert.equal("requirement_set" in result, false);
    assert.equal("eligibility_assessment" in result, false);
    assert.equal("candidate_profile" in result, false);
    assert.equal("canonical_opportunity" in result, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const adapterSource = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-legal-05/guizhou-legal-xlsx-requirement-adapter.ts"
  ), "utf8");
  assert.doesNotMatch(adapterSource, /globalThis\.fetch|node:(?:http|https|net|tls|dns)/u);
  assert.doesNotMatch(adapterSource, /\beval\s*\(|new\s+Function\s*\(/u);
});

test("target 22828700101 materializes only a test-scoped verified SOV", () => {
  const endpoint = createGuizhouLegalRequirementEndpoint(
    GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID
  );
  const prepared = prepareSourceOccurrenceMaterialization(
    endpoint,
    parsed.source_occurrence_record,
    snapshot
  );
  const result = materializeSourceOccurrenceVersion({
    prepared,
    existing_occurrence: null,
    existing_versions: []
  });
  assert.equal(result.version.extracted_record_id, parsed.source_occurrence_record.extracted_record_id);
  assert.equal(result.version.content.recruitment_context?.position.identity_state, "PROVISIONAL");
  assert.equal(
    result.version.content.recruitment_context?.position.source_local_identifier.original.text,
    P2_LEGAL_05_TARGET_JOB_CODE
  );
  assert.equal(validateSourceOccurrenceVersionBinding({
    endpoint,
    occurrence: result.occurrence,
    version: result.version,
    extracted_record: parsed.source_occurrence_record,
    snapshot
  }), result.version);
  assert.equal("position" in result, false);
  assert.equal("opportunity" in result, false);
  assert.equal("source_composition_result" in result, false);
  assert.equal("requirement_set" in result, false);
  assert.equal("eligibility_assessment" in result, false);
});

test("target legacy ExtractedRecord remains byte-for-byte compatible", () => {
  assert.equal(
    parsed.record.extracted_record_id,
    "extracted:582390b5214a33f10ba73bab9abcc90ee36e367bc90db3f30a6ae1f4bc79bdb7"
  );
  assert.equal("contract_version" in parsed.record, false);
  assert.equal("recruitment_context" in parsed.record, false);
  assert.notEqual(
    parsed.source_occurrence_record.extracted_record_id,
    parsed.record.extracted_record_id
  );
  assert.equal(
    new GuizhouLegalXlsxRequirementObservationAdapter().extract(captured())[0]
      ?.extracted_record_id,
    parsed.record.extracted_record_id
  );
});

interface P2Legal04ExecutionIndex {
  readonly report: {
    readonly raw: {
      readonly local_artifact: string;
    };
  };
}

function captured(): AdapterExtractionInput {
  const hash = sha256(rawBytes) as RawContentSha256;
  const rawBlob: RawBlob = {
    raw_blob_id: `sha256:${hash}` as RawBlobId,
    bytes: new Uint8Array(rawBytes),
    raw_content_sha256: hash,
    mime_type: GUIZHOU_ATTACHMENT_EXPECTED_MIME,
    byte_length: rawBytes.byteLength,
    created_at: snapshot.observed_at
  };
  return {
    endpoint: createGuizhouLegalRequirementEndpoint(GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID),
    snapshot,
    raw_blob: rawBlob
  };
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
