import "../helpers/network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  UTF8_TEXT_ENCODING,
  type AdapterExtractionInput,
  type IsoDateTime,
  type RawBlob,
  type RawBlobId,
  type RawContentSha256,
  type RecruitmentEndpoint,
  type Snapshot,
  type SnapshotId
} from "../../lib/ingestion";
import {
  BEIJING_ATTACHMENT_ENDPOINT,
  BEIJING_ATTACHMENT_EXPECTED_MIME,
  BEIJING_ATTACHMENT_REFERRING_DETAIL_ENDPOINT,
  BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID,
  BEIJING_ATTACHMENT_SOURCE_DEFINITION_ID
} from "../../lib/live-canary/p2-04e/beijing-public-institution-attachment-observation-canary";
import {
  BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_ADAPTER_KEY,
  BEIJING_PUBLIC_INSTITUTION_XLSX_RAW_SHA256,
  BEIJING_PUBLIC_INSTITUTION_XLSX_SNAPSHOT_ID,
  BeijingPublicInstitutionXlsxJobTableAdapter,
  classifyLegalDegreeText,
  type DerivedSourceFactEvidence,
  type ScopedMajorEvidence,
  type XlsxCellEvidence
} from "../../lib/live-canary/p2-04e/beijing-public-institution-xlsx-job-table-adapter";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = path.join(
  repositoryRoot,
  "fixtures",
  "p2-04e",
  "beijing-public-institution-job-table.xlsx"
);
const provenancePath = path.join(
  repositoryRoot,
  "fixtures",
  "p2-04e",
  "beijing-public-institution-job-table.fixture.json"
);
const fixtureBytes = new Uint8Array(readFileSync(fixturePath));
const provenance = JSON.parse(readFileSync(provenancePath, "utf8")) as {
  readonly fixture_status: string;
  readonly offline_only: boolean;
  readonly snapshot_id: string;
  readonly raw_sha256: string;
  readonly raw_byte_length: number;
};
const observedAt = "2026-09-03T05:47:22.872Z" as IsoDateTime;
const parsed = new BeijingPublicInstitutionXlsxJobTableAdapter().parse(captured(fixtureBytes));

test("real XLSX fixture is byte-identical to the sealed Observation Canary Raw", () => {
  assert.equal(provenance.fixture_status, "TEST_FIXTURE_FROM_REAL_P2_04E_OBSERVATION_CANARY");
  assert.equal(provenance.offline_only, true);
  assert.equal(provenance.snapshot_id, BEIJING_PUBLIC_INSTITUTION_XLSX_SNAPSHOT_ID);
  assert.equal(fixtureBytes.byteLength, provenance.raw_byte_length);
  assert.equal(sha256(fixtureBytes), provenance.raw_sha256);
  assert.equal(sha256(fixtureBytes), BEIJING_PUBLIC_INSTITUTION_XLSX_RAW_SHA256);
});

test("real workbook has one unambiguous job table and three stable job rows", () => {
  assert.equal(parsed.workbook_audit.sheet_count, 1);
  assert.equal(parsed.workbook_audit.selected_sheet, "职位表");
  assert.equal(parsed.workbook_audit.sheets[0]?.state, "visible");
  assert.equal(parsed.workbook_audit.sheets[0]?.used_range, "A2:W6");
  assert.equal(parsed.workbook_audit.header_row, 3);
  assert.equal(parsed.workbook_audit.header_range, "A3:W3");
  assert.equal(parsed.workbook_audit.data_range, "A4:W6");
  assert.equal(parsed.workbook_audit.total_candidate_rows, 3);
  assert.equal(parsed.workbook_audit.successful_rows, 3);
  assert.deepEqual(parsed.workbook_audit.empty_rows, []);
  assert.deepEqual(parsed.workbook_audit.unparseable_rows, []);
  assert.equal(parsed.records.length, 3);
  assert.deepEqual(parsed.records.map((record) => record.raw_title?.text), [
    "医生",
    "急救调度",
    "院前急救学科骨干"
  ]);
});

test("every job preserves official provenance and exact row/cell locators", () => {
  for (const [index, record] of parsed.records.entries()) {
    const row = index + 4;
    assert.equal(record.snapshot_id, BEIJING_PUBLIC_INSTITUTION_XLSX_SNAPSHOT_ID);
    assert.equal(record.source_definition_id, BEIJING_ATTACHMENT_SOURCE_DEFINITION_ID);
    assert.equal(record.announcement_url, BEIJING_ATTACHMENT_REFERRING_DETAIL_ENDPOINT);
    assert.equal(record.source_record_locator.kind, "DOCUMENT");
    if (record.source_record_locator.kind === "DOCUMENT") {
      assert.equal(record.source_record_locator.section, "职位表");
      assert.equal(record.source_record_locator.text_locator, `A${row}:W${row}`);
    }
    const metadata = metadataFor(record);
    assert.equal(metadata.fields.title.cell, `E${row}`);
    assert.equal(metadata.fields.title.sheet, "职位表");
    assert.equal(metadata.fields.title.snapshot_id, BEIJING_PUBLIC_INSTITUTION_XLSX_SNAPSHOT_ID);
  }
});

test("merged title stays anchored at A2 and is not copied into merged cells", () => {
  const sheet = parsed.workbook_audit.sheets[0]!;
  assert.deepEqual(sheet.merged_cells, ["A2:W2"]);
  assert.deepEqual(sheet.merged_cell_anchors, [{
    range: "A2:W2",
    anchor: "A2",
    raw_value: "北京急救中心2026年度第四批公开招聘工作人员职位及要求表"
  }]);
  assert.equal(parsed.records.length, 3);
});

test("empty cells remain NOT_OBSERVED while explicit 不限 remains source text", () => {
  const third = metadataFor(parsed.records[2]!);
  assert.equal(third.fields.notes.cell, "W6");
  assert.equal(third.fields.notes.raw_value, null);
  assert.equal(third.fields.notes.normalized_value, null);
  assert.equal(third.fields.notes.status, "NOT_OBSERVED");

  const first = metadataFor(parsed.records[0]!);
  assert.equal(first.fields.work_experience_requirement.raw_value, "不限");
  assert.equal(first.fields.work_experience_requirement.status, "OBSERVED");
});

test("raw Chinese source text and separate education scopes are preserved", () => {
  const first = metadataFor(parsed.records[0]!);
  assert.equal(
    first.fields.other_conditions.raw_value,
    "1.需取得执业医师资格证和住院医师规范化培训结业证，且医师定期考核合格。\r\n2.非北京生源应届毕业生需符合引进毕业生相关政策。"
  );
  const third = metadataFor(parsed.records[2]!);
  assert.equal(
    third.fields.major_requirement.raw_value,
    "本科：临床医学类（1002）；\r\n研究生：临床医学（1002、1051）、中西医结合临床（100602、105709）"
  );
  const bachelor = third.scoped_major_evidence.find((item) => item.scope === "BACHELOR");
  const graduate = third.scoped_major_evidence.find((item) => item.scope === "GRADUATE");
  const master = third.scoped_major_evidence.find((item) => item.scope === "MASTER");
  assert.equal(bachelor?.status, "OBSERVED");
  assert.equal(bachelor?.extracted_raw_text, "临床医学类（1002）");
  assert.equal(graduate?.status, "OBSERVED");
  assert.equal(
    graduate?.extracted_raw_text,
    "临床医学（1002、1051）、中西医结合临床（100602、105709）"
  );
  assert.equal(master?.status, "AMBIGUOUS");
  assert.deepEqual(master?.flags, ["SOURCE_SCOPE_IS_GRADUATE_NOT_MASTER_SPECIFIC"]);
  assert.equal(third.requested_source_facts.bachelor_major_requirement.status, "OBSERVED");
  assert.equal(third.requested_source_facts.master_major_requirement.status, "AMBIGUOUS");
  assert.equal(third.requested_source_facts.household_registration_requirement.status, "NOT_OBSERVED");
  assert.equal(
    third.requested_source_facts.legal_professional_qualification_requirement.status,
    "NOT_OBSERVED"
  );

  const firstFacts = first.requested_source_facts;
  assert.equal(firstFacts.fresh_graduate_requirement.raw_cell_value, "应届毕业生");
  assert.equal(firstFacts.beijing_student_origin_clause.status, "OBSERVED");
  assert.equal(
    firstFacts.beijing_student_origin_clause.extracted_raw_text,
    "非北京生源应届毕业生需符合引进毕业生相关政策。"
  );
  assert.equal(firstFacts.household_registration_requirement.status, "NOT_OBSERVED");

  const second = metadataFor(parsed.records[1]!);
  assert.equal(second.fields.professional_qualification_indicator.raw_value, "否");
  assert.equal(second.fields.other_conditions.raw_value?.toString().includes("执业医师资格证"), true);
  assert.deepEqual(second.fields.professional_qualification_indicator.flags, ["AMBIGUOUS"]);
});

test("法律硕士 never becomes 法律硕士（非法学） without exact source text", () => {
  assert.deepEqual(classifyLegalDegreeText("专业要求：法律硕士"), {
    explicit_juris_master_non_law: false,
    ambiguous_juris_master: true,
    law_academic_master: false,
    law_studies: false,
    law_category: false,
    legal_major: false,
    legal_professional_qualification: false,
    classification: "AMBIGUOUS_JURIS_MASTER"
  });
  const explicit = classifyLegalDegreeText("专业要求：法律硕士（非法学）");
  assert.equal(explicit.explicit_juris_master_non_law, true);
  assert.equal(explicit.ambiguous_juris_master, false);
  assert.equal(explicit.classification, "EXPLICIT_JURIS_MASTER_NON_LAW");
});

test("real workbook reports zero observed legal-master or legal-qualification terms", () => {
  for (const record of parsed.records) {
    assert.deepEqual(metadataFor(record).legal_degree_observations, {
      explicit_juris_master_non_law: false,
      ambiguous_juris_master: false,
      law_academic_master: false,
      law_studies: false,
      law_category: false,
      legal_major: false,
      legal_professional_qualification: false,
      classification: "NOT_OBSERVED"
    });
  }
});

test("formula source is preserved with cached value and never evaluated", () => {
  const formulaBytes = syntheticWorkbook({
    recruitmentCountCell: "<c r=\"I4\"><f>1+1</f><v>7</v></c>"
  });
  const result = new BeijingPublicInstitutionXlsxJobTableAdapter().parse(captured(formulaBytes));
  const evidence = metadataFor(result.records[0]!).fields.recruitment_count;
  assert.equal(evidence.formula, "1+1");
  assert.equal(evidence.cached_value, "7");
  assert.equal(evidence.raw_value, 7);
  assert.equal(evidence.status, "AMBIGUOUS");
  assert.deepEqual(evidence.flags, ["AMBIGUOUS"]);
});

test("Adapter remains offline and creates no downstream decision objects", () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("Network must not be called");
  };
  try {
    assert.equal(new BeijingPublicInstitutionXlsxJobTableAdapter().extract(captured(fixtureBytes)).length, 3);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const source = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-04e/beijing-public-institution-xlsx-job-table-adapter.ts"
  ), "utf8");
  assert.doesNotMatch(source, /globalThis\.fetch|node:(?:http|https|net|tls|dns)/u);
  assert.doesNotMatch(source, /from\s+["'][^"']*\/(?:requirements|eligibility|canonicalization)[^"']*["']/u);
  assert.doesNotMatch(source, /from\s+["'][^"']*\/(?:application|collection-runtime|source-scheduler|production-ingestion)[^"']*["']/u);
  for (const record of parsed.records) {
    assert.equal("requirement_fact" in record, false);
    assert.equal("eligibility_assessment" in record, false);
    assert.equal("candidate_profile" in record, false);
    assert.equal("canonical_opportunity" in record, false);
  }
});

interface JobMetadata {
  readonly fields: Readonly<Record<string, XlsxCellEvidence>>;
  readonly scoped_major_evidence: readonly ScopedMajorEvidence[];
  readonly requested_source_facts: Readonly<Record<string, DerivedSourceFactEvidence>>;
  readonly legal_degree_observations: ReturnType<typeof classifyLegalDegreeText>;
}

function metadataFor(record: (typeof parsed.records)[number]) {
  return record.adapter_metadata[
    BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_ADAPTER_KEY
  ] as unknown as JobMetadata;
}

function endpoint(): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID,
    source_definition_id: BEIJING_ATTACHMENT_SOURCE_DEFINITION_ID,
    name: traceable("北京急救中心职位及要求表"),
    description: traceable("P2-04E 真实 Observation Canary XLSX 的离线 Fixture。"),
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

function captured(bytes: Uint8Array): AdapterExtractionInput {
  const hash = sha256(bytes) as RawContentSha256;
  const rawBlob: RawBlob = {
    raw_blob_id: `sha256:${hash}` as RawBlobId,
    bytes: new Uint8Array(bytes),
    raw_content_sha256: hash,
    mime_type: BEIJING_ATTACHMENT_EXPECTED_MIME,
    byte_length: bytes.byteLength,
    created_at: observedAt
  };
  const snapshot: Snapshot = {
    snapshot_id: BEIJING_PUBLIC_INSTITUTION_XLSX_SNAPSHOT_ID as SnapshotId,
    recruitment_endpoint_id: BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID,
    request_metadata: {
      locator: BEIJING_ATTACHMENT_ENDPOINT,
      method: "GET",
      requested_at: observedAt,
      headers: {},
      parameters: {}
    },
    response_metadata: {
      http_status: 200,
      headers: { "content-type": BEIJING_ATTACHMENT_EXPECTED_MIME },
      mime_type: BEIJING_ATTACHMENT_EXPECTED_MIME,
      content_length: bytes.byteLength,
      transport_error: null
    },
    raw_blob_id: rawBlob.raw_blob_id,
    observed_at: observedAt,
    transport_status: "SUCCESS",
    content_hash: hash,
    content_length: bytes.byteLength
  };
  return { endpoint: endpoint(), snapshot, raw_blob: rawBlob };
}

function syntheticWorkbook(options: { readonly recruitmentCountCell: string }) {
  const headers = [
    "序号", "主管部门", "单位名称", "用人部门", "招聘岗位", "职位简介", "岗位类别",
    "拟聘岗位等级", "招聘人数", "学历要求", "学位要求", "专业要求", "年龄",
    "专业工作年限", "是否要求相关职业资格", "政治面貌", "其他条件", "招聘范围",
    "招聘方式", "是否组织专业考试", "计划聘用人数与面试人选的确定比例", "联系信息", "备注"
  ];
  const headerCells = headers.map((header, index) => inlineCell(`${columnName(index + 1)}3`, header)).join("");
  const dataCells = [
    numberCell("A4", 1),
    inlineCell("C4", "测试单位"),
    inlineCell("E4", "测试岗位"),
    options.recruitmentCountCell,
    inlineCell("J4", "硕士研究生及以上"),
    inlineCell("L4", "法律硕士")
  ].join("");
  return zipArchive({
    "[Content_Types].xml":
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>",
    "xl/workbook.xml":
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"职位表\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>",
    "xl/_rels/workbook.xml.rels":
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>",
    "xl/worksheets/sheet1.xml":
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:W4"/><sheetData><row r="2">${inlineCell("A2", "测试招聘职位及要求表")}</row><row r="3">${headerCells}</row><row r="4">${dataCells}</row></sheetData><mergeCells count="1"><mergeCell ref="A2:W2"/></mergeCells></worksheet>`
  });
}

function inlineCell(coordinate: string, value: string) {
  return `<c r="${coordinate}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function numberCell(coordinate: string, value: number) {
  return `<c r="${coordinate}"><v>${value}</v></c>`;
}

function zipArchive(entries: Readonly<Record<string, string>>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const [nameValue, contentValue] of Object.entries(entries)) {
    const name = encoder.encode(nameValue);
    const content = encoder.encode(contentValue);
    const local = new Uint8Array(30 + name.byteLength + content.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(18, content.byteLength, true);
    localView.setUint32(22, content.byteLength, true);
    localView.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    local.set(content, 30 + name.byteLength);
    localParts.push(local);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(20, content.byteLength, true);
    centralView.setUint32(24, content.byteLength, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.byteLength;
  }
  const centralOffset = localOffset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, localParts.length, true);
  endView.setUint16(10, localParts.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  return concatenate([...localParts, ...centralParts, end]);
}

function concatenate(parts: readonly Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function columnName(index: number) {
  let value = index;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
