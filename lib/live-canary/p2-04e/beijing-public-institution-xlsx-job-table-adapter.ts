import { createHash } from "node:crypto";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

import * as cheerio from "cheerio";

import {
  AdapterExtractionError,
  UTF8_TEXT_ENCODING,
  type AdapterCompletenessAssessment,
  type AdapterCompletenessInput,
  type AdapterDescriptor,
  type AdapterExtractionInput,
  type AdapterNextPageInput,
  type AdapterRequestPlan,
  type EndpointValidationResult,
  type ExtractedRecord,
  type ExtractedRecordId,
  type OriginalText,
  type RawBlob,
  type RecruitmentAdapter,
  type RecruitmentEndpoint,
  type SnapshotId,
  type SourceRecordLocator
} from "../../ingestion";
import {
  BEIJING_ATTACHMENT_ENDPOINT,
  BEIJING_ATTACHMENT_EXPECTED_MIME,
  BEIJING_ATTACHMENT_MAX_DECOMPRESSED_BYTES,
  BEIJING_ATTACHMENT_MAX_EXPANSION_RATIO,
  BEIJING_ATTACHMENT_MAX_RESPONSE_BYTES,
  BEIJING_ATTACHMENT_MAX_SINGLE_ENTRY_BYTES,
  BEIJING_ATTACHMENT_MAX_ZIP_ENTRIES,
  BEIJING_ATTACHMENT_REFERRING_DETAIL_ENDPOINT,
  BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID,
  BEIJING_ATTACHMENT_SOURCE_DEFINITION_ID
} from "./beijing-public-institution-attachment-contract";

export const BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_ADAPTER_KEY =
  "cn-beijing-government-public-institution-xlsx-job-table";
export const BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION =
  "1.0.0-p2-04e-real-raw";
export const BEIJING_PUBLIC_INSTITUTION_XLSX_RAW_SHA256 =
  "b8a3c2832ab77782b2215370a72f40c524ab1e8179731fc025aafd6452514766";
export const BEIJING_PUBLIC_INSTITUTION_XLSX_SNAPSHOT_ID =
  "p2-04e-observation-snapshot:d6368e80-f6b9-4f18-ad9a-2727a7dd8c8b";

const descriptor: AdapterDescriptor = {
  adapter_key: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_ADAPTER_KEY,
  name: "BeijingPublicInstitutionXlsxJobTableAdapter",
  version: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION,
  supported_content_kinds: ["FILE"],
  capabilities: ["SINGLE_PAGE", "DOCUMENT_TEXT_EXTRACTION"]
};

const requiredHeaders = [
  "序号",
  "单位名称",
  "招聘岗位",
  "招聘人数",
  "学历要求",
  "专业要求"
] as const;

const fieldHeaders = {
  serial_number: "序号",
  supervising_department: "主管部门",
  organization: "单位名称",
  employing_department: "用人部门",
  title: "招聘岗位",
  description: "职位简介",
  position_category: "岗位类别",
  position_grade: "拟聘岗位等级",
  recruitment_count: "招聘人数",
  education_requirement: "学历要求",
  degree_requirement: "学位要求",
  major_requirement: "专业要求",
  age_requirement: "年龄",
  work_experience_requirement: "专业工作年限",
  professional_qualification_indicator: "是否要求相关职业资格",
  political_status_requirement: "政治面貌",
  other_conditions: "其他条件",
  recruitment_scope: "招聘范围",
  recruitment_method: "招聘方式",
  professional_exam: "是否组织专业考试",
  interview_ratio: "计划聘用人数与面试人选的确定比例",
  contact_information: "联系信息",
  notes: "备注"
} as const;

const requirementFieldNames = [
  "education_requirement",
  "degree_requirement",
  "major_requirement",
  "age_requirement",
  "work_experience_requirement",
  "professional_qualification_indicator",
  "political_status_requirement",
  "other_conditions",
  "recruitment_scope",
  "recruitment_method",
  "professional_exam",
  "interview_ratio",
  "notes"
] as const;

const domainGapFieldNames = new Set<JobFieldName>([
  "degree_requirement",
  "age_requirement",
  "recruitment_scope",
  "recruitment_method",
  "professional_exam",
  "interview_ratio"
]);

type JobFieldName = keyof typeof fieldHeaders;
export type SourceFactStatus =
  | "OBSERVED"
  | "NOT_OBSERVED"
  | "AMBIGUOUS"
  | "UNPARSED_CLAUSE"
  | "DOMAIN_GAP_OBSERVED";

export interface XlsxCellEvidence {
  readonly snapshot_id: SnapshotId;
  readonly sheet: string;
  readonly cell: string;
  readonly field_path: string;
  readonly header: string;
  readonly raw_value: string | number | boolean | null;
  readonly storage_value: string | null;
  readonly normalized_value: string | number | boolean | null;
  readonly formula: string | null;
  readonly cached_value: string | null;
  readonly status: "OBSERVED" | "NOT_OBSERVED" | "AMBIGUOUS";
  readonly flags: readonly SourceFactStatus[];
  readonly parser_version: string;
}

export interface ScopedMajorEvidence {
  readonly snapshot_id: SnapshotId;
  readonly scope: "BACHELOR" | "GRADUATE" | "MASTER";
  readonly sheet: string;
  readonly cell: string;
  readonly field_path: string;
  readonly raw_cell_value: string | null;
  readonly extracted_raw_text: string | null;
  readonly normalized_value: string | null;
  readonly status: "OBSERVED" | "NOT_OBSERVED" | "AMBIGUOUS";
  readonly flags: readonly string[];
  readonly parser_version: string;
}

export interface DerivedSourceFactEvidence {
  readonly snapshot_id: SnapshotId;
  readonly field: string;
  readonly sheet: string;
  readonly cell_or_range: string;
  readonly field_path: string;
  readonly raw_cell_value: string | number | boolean | null;
  readonly extracted_raw_text: string | null;
  readonly normalized_value: string | null;
  readonly status: "OBSERVED" | "NOT_OBSERVED" | "AMBIGUOUS";
  readonly flags: readonly string[];
  readonly parser_version: string;
}

export interface LegalDegreeObservation {
  readonly explicit_juris_master_non_law: boolean;
  readonly ambiguous_juris_master: boolean;
  readonly law_academic_master: boolean;
  readonly law_studies: boolean;
  readonly law_category: boolean;
  readonly legal_major: boolean;
  readonly legal_professional_qualification: boolean;
  readonly classification:
    | "EXPLICIT_JURIS_MASTER_NON_LAW"
    | "AMBIGUOUS_JURIS_MASTER"
    | "NOT_OBSERVED";
}

export interface BeijingXlsxWorkbookAudit {
  readonly workbook_sha256: string;
  readonly sheet_count: number;
  readonly sheets: readonly {
    readonly name: string;
    readonly state: string;
    readonly used_range: string | null;
    readonly merged_cells: readonly string[];
    readonly merged_cell_anchors: readonly {
      readonly range: string;
      readonly anchor: string;
      readonly raw_value: string | number | boolean | null;
    }[];
    readonly hidden_rows: readonly number[];
    readonly hidden_columns: readonly string[];
    readonly formula_cells: readonly string[];
  }[];
  readonly selected_sheet: string;
  readonly selection_basis: readonly string[];
  readonly title_cell: string | null;
  readonly title_text: string | null;
  readonly header_row: number;
  readonly header_range: string;
  readonly data_start_row: number;
  readonly data_end_row: number;
  readonly data_range: string;
  readonly total_candidate_rows: number;
  readonly successful_rows: number;
  readonly empty_rows: readonly number[];
  readonly unparseable_rows: readonly {
    readonly row: number;
    readonly reason_codes: readonly string[];
  }[];
}

export interface BeijingXlsxParseResult {
  readonly records: readonly ExtractedRecord[];
  readonly workbook_audit: BeijingXlsxWorkbookAudit;
}

interface ZipEntry {
  readonly name: string;
  readonly flags: number;
  readonly compression_method: number;
  readonly compressed_size: number;
  readonly uncompressed_size: number;
  readonly local_header_offset: number;
}

interface ParsedCell {
  readonly coordinate: string;
  readonly raw_value: string | number | boolean | null;
  readonly storage_value: string | null;
  readonly formula: string | null;
  readonly cached_value: string | null;
}

interface ParsedRow {
  readonly row_number: number;
  readonly hidden: boolean;
  readonly cells: ReadonlyMap<string, ParsedCell>;
}

interface ParsedSheet {
  readonly name: string;
  readonly state: string;
  readonly used_range: string | null;
  readonly merged_cells: readonly string[];
  readonly hidden_rows: readonly number[];
  readonly hidden_columns: readonly string[];
  readonly rows: readonly ParsedRow[];
  readonly cells: ReadonlyMap<string, ParsedCell>;
}

interface JobTableCandidate {
  readonly sheet: ParsedSheet;
  readonly header_row: number;
  readonly headers: ReadonlyMap<string, number>;
}

type CheerioNodeSet = ReturnType<ReturnType<typeof cheerio.load>>;

export class BeijingPublicInstitutionXlsxJobTableAdapter implements RecruitmentAdapter {
  readonly descriptor = descriptor;

  validateEndpoint(endpoint: RecruitmentEndpoint): EndpointValidationResult {
    const issues: string[] = [];
    if (endpoint.adapter_key !== this.descriptor.adapter_key) {
      issues.push(`Endpoint adapter_key must be ${this.descriptor.adapter_key}`);
    }
    if (endpoint.recruitment_endpoint_id !== BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID) {
      issues.push("Endpoint must use the admitted Beijing attachment RecruitmentEndpoint reference");
    }
    if (endpoint.source_definition_id !== BEIJING_ATTACHMENT_SOURCE_DEFINITION_ID) {
      issues.push("Endpoint must use the Beijing public-institution SourceDefinition reference");
    }
    if (endpoint.locator !== BEIJING_ATTACHMENT_ENDPOINT) {
      issues.push("Endpoint locator must exactly match the captured Beijing XLSX locator");
    }
    if (endpoint.request_method !== "GET") issues.push("Beijing XLSX Endpoint must use GET");
    if (endpoint.content_kind !== "FILE") issues.push("Beijing XLSX Endpoint must use FILE");
    if ((endpoint.collection_config.max_pages ?? 1) !== 1) {
      issues.push("P2-04E permits one captured attachment only");
    }
    if (endpoint.collection_config.follow_redirects !== false) {
      issues.push("P2-04E must not follow redirects");
    }
    if (endpoint.enabled) issues.push("P2-04E offline Adapter requires a disabled Endpoint");
    return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
  }

  plan(endpoint: RecruitmentEndpoint): readonly AdapterRequestPlan[] {
    this.assertEndpoint(endpoint);
    return [{
      recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
      locator: endpoint.locator,
      method: "GET",
      parameters: {},
      pagination_state: {
        page_index: 1,
        cursor: null,
        visited_locators: [endpoint.locator]
      }
    }];
  }

  extract(input: AdapterExtractionInput): readonly ExtractedRecord[] {
    return this.parse(input).records;
  }

  parse(input: AdapterExtractionInput): BeijingXlsxParseResult {
    this.assertEndpoint(input.endpoint);
    const rawBlob = assertTraceability(input);
    return parseWorkbook(input, rawBlob);
  }

  nextPage(_input: AdapterNextPageInput): AdapterRequestPlan | null {
    return null;
  }

  assessCompleteness(input: AdapterCompletenessInput): AdapterCompletenessAssessment {
    if (input.extraction_errors.length > 0) {
      return input.records.length > 0
        ? { status: "PARTIAL", reason_codes: ["XLSX_EXTRACTION_ERROR"] }
        : { status: "FAILED", reason_codes: ["XLSX_EXTRACTION_ERROR"] };
    }
    if (input.snapshots.some((snapshot) => snapshot.transport_status === "FAILED")) {
      return { status: "FAILED", reason_codes: ["FAILED_SNAPSHOT"] };
    }
    if (input.records.length === 0) {
      return { status: "SUSPICIOUS_EMPTY", reason_codes: ["ZERO_EXTRACTED_RECORDS"] };
    }
    return { status: "COMPLETE", reason_codes: ["REAL_XLSX_JOB_ROWS_EXTRACTED"] };
  }

  private assertEndpoint(endpoint: RecruitmentEndpoint) {
    const validation = this.validateEndpoint(endpoint);
    if (!validation.valid) {
      throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", validation.issues.join("; "));
    }
  }
}

export function classifyLegalDegreeText(text: string): LegalDegreeObservation {
  const explicit = /法律硕士\s*[（(]\s*非法学\s*[）)]/u.test(text);
  const withoutExplicit = text.replace(/法律硕士\s*[（(]\s*非法学\s*[）)]/gu, "");
  const ambiguous = /法律硕士/u.test(withoutExplicit);
  return {
    explicit_juris_master_non_law: explicit,
    ambiguous_juris_master: ambiguous,
    law_academic_master: /法学硕士/u.test(text),
    law_studies: /法学专业/u.test(text),
    law_category: /(?:法学类|法律类)/u.test(text),
    legal_major: /法律专业/u.test(text),
    legal_professional_qualification:
      /(?:法律职业资格|国家统一法律职业资格考试|A类法律职业资格|通过法律职业资格考试)/u.test(text),
    classification: explicit
      ? "EXPLICIT_JURIS_MASTER_NON_LAW"
      : ambiguous
        ? "AMBIGUOUS_JURIS_MASTER"
        : "NOT_OBSERVED"
  };
}

function parseWorkbook(input: AdapterExtractionInput, rawBlob: RawBlob): BeijingXlsxParseResult {
  const archive = new ZipPackage(rawBlob.bytes);
  const sharedStrings = parseSharedStrings(archive.optionalText("xl/sharedStrings.xml"));
  const workbook = parseWorkbookDefinition(archive);
  const sheets = workbook.sheets.map((definition) => parseWorksheet(
    archive.text(definition.path),
    definition.name,
    definition.state,
    sharedStrings
  ));
  const candidates = sheets.flatMap(findCandidates);
  if (candidates.length === 0) {
    throw malformed("No Sheet has both a job-table name and the required exact headers");
  }
  if (candidates.length > 1) {
    throw malformed(`Multiple job-table candidates require review: ${candidates.map(
      (candidate) => `${candidate.sheet.name}!${candidate.header_row}`
    ).join(", ")}`);
  }
  const candidate = candidates[0]!;
  const usedRange = parseRange(candidate.sheet.used_range);
  if (!usedRange) throw malformed("Selected Sheet has no valid used range");
  const dataStartRow = candidate.header_row + 1;
  const dataEndRow = usedRange.end_row;
  const emptyRows: number[] = [];
  const unparseableRows: Array<{ row: number; reason_codes: string[] }> = [];
  const records: ExtractedRecord[] = [];
  const title = findTableTitle(candidate);
  for (let rowNumber = dataStartRow; rowNumber <= dataEndRow; rowNumber += 1) {
    const row = candidate.sheet.rows.find((item) => item.row_number === rowNumber);
    const rowCells = row?.cells ?? new Map<string, ParsedCell>();
    const fields = buildFieldEvidence(
      input.snapshot.snapshot_id,
      candidate,
      rowNumber,
      rowCells
    );
    if (Object.values(fields).every((field) => field.status === "NOT_OBSERVED")) {
      emptyRows.push(rowNumber);
      continue;
    }
    const reasonCodes: string[] = [];
    if (fields.serial_number.status !== "OBSERVED") reasonCodes.push("SERIAL_NUMBER_MISSING");
    if (fields.organization.status !== "OBSERVED") reasonCodes.push("ORGANIZATION_MISSING");
    if (fields.title.status !== "OBSERVED") reasonCodes.push("JOB_TITLE_MISSING");
    if (reasonCodes.length > 0) {
      unparseableRows.push({ row: rowNumber, reason_codes: reasonCodes });
      continue;
    }
    records.push(jobRecord(input, candidate, rowNumber, fields, title));
  }
  const workbookAudit: BeijingXlsxWorkbookAudit = {
    workbook_sha256: rawBlob.raw_content_sha256,
    sheet_count: sheets.length,
    sheets: sheets.map((sheet) => ({
      name: sheet.name,
      state: sheet.state,
      used_range: sheet.used_range,
      merged_cells: sheet.merged_cells,
      merged_cell_anchors: sheet.merged_cells.map((range) => {
        const anchor = range.split(":", 1)[0]!;
        return { range, anchor, raw_value: sheet.cells.get(anchor)?.raw_value ?? null };
      }),
      hidden_rows: sheet.hidden_rows,
      hidden_columns: sheet.hidden_columns,
      formula_cells: [...sheet.cells.values()].filter((cell) => cell.formula !== null).map(
        (cell) => cell.coordinate
      )
    })),
    selected_sheet: candidate.sheet.name,
    selection_basis: [
      `Sheet name ${candidate.sheet.name} matches 职位/岗位/招聘 semantics`,
      `Header row ${candidate.header_row} contains exact headers: ${requiredHeaders.join("、")}`
    ],
    title_cell: title?.cell ?? null,
    title_text: title?.text ?? null,
    header_row: candidate.header_row,
    header_range: `${columnName(usedRange.start_column)}${candidate.header_row}:${columnName(
      usedRange.end_column
    )}${candidate.header_row}`,
    data_start_row: dataStartRow,
    data_end_row: dataEndRow,
    data_range: `${columnName(usedRange.start_column)}${dataStartRow}:${columnName(
      usedRange.end_column
    )}${dataEndRow}`,
    total_candidate_rows: Math.max(0, dataEndRow - dataStartRow + 1),
    successful_rows: records.length,
    empty_rows: emptyRows,
    unparseable_rows: unparseableRows
  };
  return { records, workbook_audit: workbookAudit };
}

function jobRecord(
  input: AdapterExtractionInput,
  candidate: JobTableCandidate,
  rowNumber: number,
  fields: Readonly<Record<JobFieldName, XlsxCellEvidence>>,
  tableTitle: { readonly cell: string; readonly text: string } | null
): ExtractedRecord {
  const serialNumber = String(fields.serial_number.raw_value);
  const sourceRecordId = `${BEIJING_ATTACHMENT_ENDPOINT}#sheet=${encodeURIComponent(
    candidate.sheet.name
  )}&serial=${encodeURIComponent(serialNumber)}`;
  const rowRange = `A${rowNumber}:${lastColumn(candidate.headers)}${rowNumber}`;
  const requirementText = requirementFieldNames.flatMap((fieldName) => {
    const evidence = fields[fieldName];
    return evidence.status === "NOT_OBSERVED"
      ? []
      : [`${evidence.header}：${String(evidence.raw_value)}`];
  }).join("\n");
  const majorEvidence = scopedMajorEvidence(fields.major_requirement);
  const allRowText = Object.values(fields).flatMap((field) => {
    return typeof field.raw_value === "string" ? [field.raw_value] : [];
  }).join("\n");
  const requestedSourceFacts = buildRequestedSourceFacts(fields, majorEvidence, rowNumber);
  const sourceRecordLocator: SourceRecordLocator = {
    kind: "DOCUMENT",
    section: candidate.sheet.name,
    text_locator: rowRange
  };
  const titleText = requiredText(fields.title);
  const organizationText = requiredText(fields.organization);
  return {
    extracted_record_id: `extracted:${sha256(
      `${input.snapshot.snapshot_id}|${sourceRecordId}|${rowRange}`
    )}` as ExtractedRecordId,
    snapshot_id: input.snapshot.snapshot_id,
    source_definition_id: input.endpoint.source_definition_id,
    identity_candidates: [{
      kind: "SOURCE_RECORD_ID",
      value: sourceRecordId,
      confidence: "HIGH"
    }],
    raw_source_record_id: sourceRecordId,
    raw_title: original(titleText),
    raw_organization_name: original(organizationText),
    raw_location_text: [],
    raw_description: optionalOriginal(fields.description.raw_value),
    raw_requirement_text: requirementText ? original(requirementText) : undefined,
    announcement_url: BEIJING_ATTACHMENT_REFERRING_DETAIL_ENDPOINT,
    recruitment_year: extractFirst(tableTitle?.text, /((?:19|20)\d{2})年度/u),
    recruitment_batch: extractFirst(tableTitle?.text, /(第[一二三四五六七八九十]+批)/u),
    source_record_locator: sourceRecordLocator,
    adapter_metadata: {
      [BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_ADAPTER_KEY]: {
        source_fact_scope: "CAPTURED_XLSX_JOB_ROW_ONLY",
        parser_version: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION,
        workbook_sha256: input.snapshot.content_hash,
        snapshot_id: input.snapshot.snapshot_id,
        attachment_locator: BEIJING_ATTACHMENT_ENDPOINT,
        referring_announcement_locator: BEIJING_ATTACHMENT_REFERRING_DETAIL_ENDPOINT,
        sheet: candidate.sheet.name,
        row_number: rowNumber,
        row_range: rowRange,
        table_title: tableTitle,
        fields,
        scoped_major_evidence: majorEvidence,
        requested_source_facts: requestedSourceFacts,
        legal_degree_observations: classifyLegalDegreeText(allRowText),
        completeness: fieldCompleteness(fields, requestedSourceFacts),
        facts_not_inferred: [
          "Empty cells remain NOT_OBSERVED and are never interpreted as unrestricted.",
          "Formula cells preserve formula and cached value but formulas are never executed or recalculated.",
          "法律硕士 is never normalized to 法律硕士（非法学） without the explicit source phrase.",
          "No Requirement, EligibilityAssessment, CandidateProfile, or CanonicalOpportunity is produced."
        ]
      }
    },
    extraction: {
      extractor_name: descriptor.name,
      extractor_version: descriptor.version,
      extracted_at: input.snapshot.observed_at
    }
  };
}

function buildFieldEvidence(
  snapshotId: SnapshotId,
  candidate: JobTableCandidate,
  rowNumber: number,
  rowCells: ReadonlyMap<string, ParsedCell>
) {
  const fields = Object.fromEntries(Object.entries(fieldHeaders).map(([fieldName, header]) => {
    const column = candidate.headers.get(header);
    if (!column) throw malformed(`Selected table is missing header ${header}`);
    const cellCoordinate = `${columnName(column)}${rowNumber}`;
    const cell = rowCells.get(cellCoordinate);
    const flags: SourceFactStatus[] = [];
    const hasValue = cell?.raw_value !== null && cell?.raw_value !== undefined
      && String(cell.raw_value).trim() !== "";
    let status: XlsxCellEvidence["status"] = hasValue ? "OBSERVED" : "NOT_OBSERVED";
    if (cell?.formula !== null && cell?.formula !== undefined) {
      status = "AMBIGUOUS";
      flags.push("AMBIGUOUS");
    }
    if (hasValue && domainGapFieldNames.has(fieldName as JobFieldName)) {
      flags.push("DOMAIN_GAP_OBSERVED");
    }
    if (hasValue && cell?.raw_value === "见公告") flags.push("AMBIGUOUS");
    if (hasValue && fieldName === "other_conditions") flags.push("UNPARSED_CLAUSE");
    const evidence: XlsxCellEvidence = {
      snapshot_id: snapshotId,
      sheet: candidate.sheet.name,
      cell: cellCoordinate,
      field_path: `workbook.sheet[${JSON.stringify(candidate.sheet.name)}].cell[${cellCoordinate}]`,
      header,
      raw_value: cell?.raw_value ?? null,
      storage_value: cell?.storage_value ?? null,
      normalized_value: normalizeCellValue(cell?.raw_value ?? null),
      formula: cell?.formula ?? null,
      cached_value: cell?.cached_value ?? null,
      status,
      flags: [...new Set(flags)],
      parser_version: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION
    };
    return [fieldName, evidence];
  })) as Record<JobFieldName, XlsxCellEvidence>;
  if (
    fields.professional_qualification_indicator.raw_value === "否"
    && typeof fields.other_conditions.raw_value === "string"
    && /资格(?:证|考试)?/u.test(fields.other_conditions.raw_value)
  ) {
    fields.professional_qualification_indicator = {
      ...fields.professional_qualification_indicator,
      flags: [...fields.professional_qualification_indicator.flags, "AMBIGUOUS"]
    };
  }
  return fields;
}

function scopedMajorEvidence(major: XlsxCellEvidence): readonly ScopedMajorEvidence[] {
  const raw = typeof major.raw_value === "string" ? major.raw_value : null;
  const bachelor = raw ? /(?:^|\n)本科[：:]\s*([^\n；;]+)/u.exec(raw)?.[1]?.trim() ?? null : null;
  const graduate = raw ? /(?:^|\n)研究生[：:]\s*([^\n]+)/u.exec(raw)?.[1]?.trim() ?? null : null;
  return [{
    snapshot_id: major.snapshot_id,
    scope: "BACHELOR",
    sheet: major.sheet,
    cell: major.cell,
    field_path: `${major.field_path}.bachelor_segment`,
    raw_cell_value: raw,
    extracted_raw_text: bachelor,
    normalized_value: bachelor,
    status: bachelor ? "OBSERVED" : "NOT_OBSERVED",
    flags: bachelor ? [] : ["BACHELOR_SCOPE_NOT_EXPLICIT"],
    parser_version: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION
  }, {
    snapshot_id: major.snapshot_id,
    scope: "GRADUATE",
    sheet: major.sheet,
    cell: major.cell,
    field_path: `${major.field_path}.graduate_segment`,
    raw_cell_value: raw,
    extracted_raw_text: graduate,
    normalized_value: graduate,
    status: graduate ? "OBSERVED" : "NOT_OBSERVED",
    flags: graduate ? [] : ["GRADUATE_SCOPE_NOT_EXPLICIT"],
    parser_version: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION
  }, {
    snapshot_id: major.snapshot_id,
    scope: "MASTER",
    sheet: major.sheet,
    cell: major.cell,
    field_path: `${major.field_path}.master_segment`,
    raw_cell_value: raw,
    extracted_raw_text: graduate,
    normalized_value: graduate,
    status: graduate ? "AMBIGUOUS" : "NOT_OBSERVED",
    flags: graduate
      ? ["SOURCE_SCOPE_IS_GRADUATE_NOT_MASTER_SPECIFIC"]
      : ["MASTER_SCOPE_NOT_EXPLICIT"],
    parser_version: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION
  }];
}

function buildRequestedSourceFacts(
  fields: Readonly<Record<JobFieldName, XlsxCellEvidence>>,
  scopedMajors: readonly ScopedMajorEvidence[],
  rowNumber: number
): Readonly<Record<string, DerivedSourceFactEvidence>> {
  const bachelor = scopedMajors.find((item) => item.scope === "BACHELOR")!;
  const master = scopedMajors.find((item) => item.scope === "MASTER")!;
  const recruitmentScope = fields.recruitment_scope;
  const otherConditions = fields.other_conditions;
  const professionalQualification = fields.professional_qualification_indicator;
  const studentOriginClause = typeof otherConditions.raw_value === "string"
    ? /非北京生源应届毕业生需符合引进毕业生相关政策。?/u.exec(
        otherConditions.raw_value
      )?.[0] ?? null
    : null;
  const legalObservation = classifyLegalDegreeText([
    professionalQualification.raw_value,
    otherConditions.raw_value
  ].filter((value): value is string => typeof value === "string").join("\n"));
  return {
    bachelor_major_requirement: derivedFromScoped("bachelor_major_requirement", bachelor),
    master_major_requirement: derivedFromScoped("master_major_requirement", master),
    fresh_graduate_requirement: {
      snapshot_id: recruitmentScope.snapshot_id,
      field: "fresh_graduate_requirement",
      sheet: recruitmentScope.sheet,
      cell_or_range: recruitmentScope.cell,
      field_path: `${recruitmentScope.field_path}.fresh_graduate_scope`,
      raw_cell_value: recruitmentScope.raw_value,
      extracted_raw_text: typeof recruitmentScope.raw_value === "string"
        ? recruitmentScope.raw_value
        : null,
      normalized_value: typeof recruitmentScope.raw_value === "string"
        ? recruitmentScope.raw_value.trim()
        : null,
      status: recruitmentScope.status,
      flags: ["DOMAIN_GAP_OBSERVED", "RECRUITMENT_SCOPE_PRESERVED_WITHOUT_ELIGIBILITY_INFERENCE"],
      parser_version: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION
    },
    household_registration_requirement: {
      snapshot_id: otherConditions.snapshot_id,
      field: "household_registration_requirement",
      sheet: otherConditions.sheet,
      cell_or_range: otherConditions.cell,
      field_path: `${otherConditions.field_path}.household_registration`,
      raw_cell_value: otherConditions.raw_value,
      extracted_raw_text: null,
      normalized_value: null,
      status: "NOT_OBSERVED",
      flags: studentOriginClause
        ? ["STUDENT_ORIGIN_CLAUSE_IS_NOT_HOUSEHOLD_REGISTRATION"]
        : ["HOUSEHOLD_REGISTRATION_NOT_EXPLICIT"],
      parser_version: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION
    },
    beijing_student_origin_clause: {
      snapshot_id: otherConditions.snapshot_id,
      field: "beijing_student_origin_clause",
      sheet: otherConditions.sheet,
      cell_or_range: otherConditions.cell,
      field_path: `${otherConditions.field_path}.student_origin_clause`,
      raw_cell_value: otherConditions.raw_value,
      extracted_raw_text: studentOriginClause,
      normalized_value: studentOriginClause,
      status: studentOriginClause ? "OBSERVED" : "NOT_OBSERVED",
      flags: studentOriginClause ? ["DOMAIN_GAP_OBSERVED"] : [],
      parser_version: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION
    },
    legal_professional_qualification_requirement: {
      snapshot_id: professionalQualification.snapshot_id,
      field: "legal_professional_qualification_requirement",
      sheet: professionalQualification.sheet,
      cell_or_range: `O${rowNumber}:Q${rowNumber}`,
      field_path: `workbook.sheet[${JSON.stringify(professionalQualification.sheet)}].range[O${rowNumber}:Q${rowNumber}].legal_professional_qualification`,
      raw_cell_value: [
        professionalQualification.raw_value,
        otherConditions.raw_value
      ].filter((value) => value !== null).join("\n"),
      extracted_raw_text: legalObservation.legal_professional_qualification
        ? [professionalQualification.raw_value, otherConditions.raw_value].filter(
            (value): value is string => typeof value === "string"
          ).join("\n")
        : null,
      normalized_value: null,
      status: legalObservation.legal_professional_qualification ? "OBSERVED" : "NOT_OBSERVED",
      flags: legalObservation.legal_professional_qualification
        ? []
        : ["LEGAL_PROFESSIONAL_QUALIFICATION_NOT_OBSERVED"],
      parser_version: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION
    }
  };
}

function derivedFromScoped(field: string, source: ScopedMajorEvidence): DerivedSourceFactEvidence {
  return {
    snapshot_id: source.snapshot_id,
    field,
    sheet: source.sheet,
    cell_or_range: source.cell,
    field_path: source.field_path,
    raw_cell_value: source.raw_cell_value,
    extracted_raw_text: source.extracted_raw_text,
    normalized_value: source.normalized_value,
    status: source.status,
    flags: source.flags,
    parser_version: source.parser_version
  };
}

function fieldCompleteness(
  fields: Readonly<Record<JobFieldName, XlsxCellEvidence>>,
  requestedSourceFacts: Readonly<Record<string, DerivedSourceFactEvidence>> = {}
) {
  const fieldEntries = Object.entries(fields) as Array<[JobFieldName, XlsxCellEvidence]>;
  const requestedEntries = Object.entries(requestedSourceFacts);
  return {
    not_observed: [
      ...fieldEntries.filter(([, field]) => field.status === "NOT_OBSERVED").map(([name]) => name),
      ...requestedEntries.filter(([, field]) => field.status === "NOT_OBSERVED").map(([name]) => name)
    ],
    unparsed_clause: fieldEntries.filter(([, field]) => field.flags.includes("UNPARSED_CLAUSE")).map(
      ([name]) => name
    ),
    ambiguous: [
      ...fieldEntries.filter(([, field]) => field.flags.includes("AMBIGUOUS")).map(([name]) => name),
      ...requestedEntries.filter(([, field]) => field.status === "AMBIGUOUS").map(([name]) => name)
    ],
    domain_gap_observed: [
      ...fieldEntries.filter(([, field]) => {
        return field.flags.includes("DOMAIN_GAP_OBSERVED");
      }).map(([name]) => name),
      ...requestedEntries.filter(([, field]) => {
        return field.flags.includes("DOMAIN_GAP_OBSERVED");
      }).map(([name]) => name)
    ]
  };
}

function findCandidates(sheet: ParsedSheet): readonly JobTableCandidate[] {
  if (!/(?:职位|岗位|招聘)/u.test(sheet.name)) return [];
  return sheet.rows.flatMap((row) => {
    const headers = new Map<string, number>();
    for (const cell of row.cells.values()) {
      if (typeof cell.raw_value !== "string") continue;
      const header = cell.raw_value.trim();
      const column = columnIndex(cell.coordinate);
      if (header && column !== null) headers.set(header, column);
    }
    return requiredHeaders.every((header) => headers.has(header))
      ? [{ sheet, header_row: row.row_number, headers }]
      : [];
  });
}

function findTableTitle(candidate: JobTableCandidate) {
  for (let rowNumber = candidate.header_row - 1; rowNumber >= 1; rowNumber -= 1) {
    const row = candidate.sheet.rows.find((item) => item.row_number === rowNumber);
    if (!row) continue;
    for (const cell of row.cells.values()) {
      if (typeof cell.raw_value === "string" && /(?:职位及要求表|招聘岗位|职位表)/u.test(cell.raw_value)) {
        return { cell: cell.coordinate, text: cell.raw_value };
      }
    }
  }
  return null;
}

function parseWorkbookDefinition(archive: ZipPackage) {
  const workbookXml = archive.text("xl/workbook.xml");
  const relationshipXml = archive.text("xl/_rels/workbook.xml.rels");
  const workbook = cheerio.load(workbookXml, { xmlMode: true });
  const relationships = cheerio.load(relationshipXml, { xmlMode: true });
  const targets = new Map<string, string>();
  relationships("Relationship").each((_index, element) => {
    const node = relationships(element);
    const id = node.attr("Id");
    const target = node.attr("Target");
    const targetMode = node.attr("TargetMode");
    if (!id || !target || targetMode === "External") return;
    const resolved = path.posix.normalize(path.posix.join("xl", target));
    if (resolved.startsWith("xl/worksheets/") && !resolved.includes("..")) targets.set(id, resolved);
  });
  const sheets: Array<{ name: string; state: string; path: string }> = [];
  workbook("sheet").each((_index, element) => {
    const node = workbook(element);
    const name = node.attr("name");
    const relationshipId = node.attr("r:id");
    const target = relationshipId ? targets.get(relationshipId) : undefined;
    if (!name || !target) throw malformed("Workbook Sheet relationship is incomplete or unsafe");
    sheets.push({ name, state: node.attr("state") ?? "visible", path: target });
  });
  if (sheets.length === 0) throw malformed("Workbook has no Sheets");
  return { sheets };
}

function parseSharedStrings(xml: string | null) {
  if (!xml) return [];
  const document = cheerio.load(xml, { xmlMode: true });
  return document("si").toArray().map((element) => {
    return document(element).find("t").toArray().map((text) => document(text).text()).join("");
  });
}

function parseWorksheet(
  xml: string,
  name: string,
  state: string,
  sharedStrings: readonly string[]
): ParsedSheet {
  const document = cheerio.load(xml, { xmlMode: true });
  const rows: ParsedRow[] = [];
  const cells = new Map<string, ParsedCell>();
  document("sheetData > row").each((_rowIndex, rowElement) => {
    const rowNode = document(rowElement);
    const rowNumber = Number(rowNode.attr("r"));
    if (!Number.isInteger(rowNumber) || rowNumber < 1) throw malformed("Worksheet row has no valid index");
    const rowCells = new Map<string, ParsedCell>();
    rowNode.children("c").each((_cellIndex, cellElement) => {
      const cellNode = document(cellElement);
      const coordinate = cellNode.attr("r");
      if (!coordinate || !/^[A-Z]+[1-9]\d*$/u.test(coordinate)) {
        throw malformed("Worksheet cell has no valid coordinate");
      }
      const type = cellNode.attr("t") ?? "n";
      const storageValue = cellNode.children("v").first().text() || null;
      const formulaNode = cellNode.children("f").first();
      const formula = formulaNode.length > 0 ? formulaNode.text() : null;
      const rawValue = decodeCellValue(cellNode, type, storageValue, sharedStrings);
      const cell: ParsedCell = {
        coordinate,
        raw_value: rawValue,
        storage_value: storageValue,
        formula,
        cached_value: formula === null ? null : storageValue
      };
      rowCells.set(coordinate, cell);
      cells.set(coordinate, cell);
    });
    rows.push({
      row_number: rowNumber,
      hidden: rowNode.attr("hidden") === "1" || rowNode.attr("hidden") === "true",
      cells: rowCells
    });
  });
  const mergedCells = document("mergeCell").toArray().flatMap((element) => {
    const range = document(element).attr("ref");
    return range ? [range] : [];
  });
  const hiddenColumns = document("cols > col").toArray().flatMap((element) => {
    const node = document(element);
    if (node.attr("hidden") !== "1" && node.attr("hidden") !== "true") return [];
    const minimum = Number(node.attr("min"));
    const maximum = Number(node.attr("max"));
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum)) return [];
    return Array.from({ length: maximum - minimum + 1 }, (_value, index) => columnName(minimum + index));
  });
  return {
    name,
    state,
    used_range: document("dimension").first().attr("ref") ?? null,
    merged_cells: mergedCells,
    hidden_rows: rows.filter((row) => row.hidden).map((row) => row.row_number),
    hidden_columns: hiddenColumns,
    rows,
    cells
  };
}

function decodeCellValue(
  cell: CheerioNodeSet,
  type: string,
  storageValue: string | null,
  sharedStrings: readonly string[]
): string | number | boolean | null {
  if (type === "inlineStr") return cell.children("is").find("t").text();
  if (storageValue === null) return null;
  if (type === "s") {
    const index = Number(storageValue);
    if (!Number.isInteger(index) || index < 0 || sharedStrings[index] === undefined) {
      throw malformed(`Shared String index is invalid: ${storageValue}`);
    }
    return sharedStrings[index]!;
  }
  if (type === "b") return storageValue === "1";
  if (type === "str" || type === "e" || type === "d") return storageValue;
  if (/^-?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/u.test(storageValue)) {
    const numeric = Number(storageValue);
    if (Number.isFinite(numeric)) return numeric;
  }
  return storageValue;
}

class ZipPackage {
  readonly #bytes: Uint8Array;
  readonly #entries: ReadonlyMap<string, ZipEntry>;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
    if (bytes.byteLength > BEIJING_ATTACHMENT_MAX_RESPONSE_BYTES) {
      throw malformed("XLSX exceeds the 10 MiB parser limit");
    }
    const entries = parseCentralDirectory(bytes);
    this.#entries = new Map(entries.map((entry) => [entry.name, entry]));
    this.assertSafe(entries);
  }

  text(name: string) {
    const entry = this.#entries.get(name);
    if (!entry) throw malformed(`OOXML package entry is missing: ${name}`);
    return decodeXml(readZipEntry(this.#bytes, entry));
  }

  optionalText(name: string) {
    const entry = this.#entries.get(name);
    return entry ? decodeXml(readZipEntry(this.#bytes, entry)) : null;
  }

  private assertSafe(entries: readonly ZipEntry[]) {
    if (entries.length === 0 || entries.length > BEIJING_ATTACHMENT_MAX_ZIP_ENTRIES) {
      throw malformed("XLSX ZIP entry count exceeds its safety boundary");
    }
    const totalCompressed = entries.reduce((sum, entry) => sum + entry.compressed_size, 0);
    const totalUncompressed = entries.reduce((sum, entry) => sum + entry.uncompressed_size, 0);
    if (totalUncompressed > BEIJING_ATTACHMENT_MAX_DECOMPRESSED_BYTES) {
      throw malformed("XLSX decompressed size exceeds its safety boundary");
    }
    if (entries.some((entry) => {
      const ratio = entry.uncompressed_size / Math.max(entry.compressed_size, 1);
      return entry.uncompressed_size > BEIJING_ATTACHMENT_MAX_SINGLE_ENTRY_BYTES
        || ratio > BEIJING_ATTACHMENT_MAX_EXPANSION_RATIO;
    }) || totalUncompressed / Math.max(totalCompressed, 1) > BEIJING_ATTACHMENT_MAX_EXPANSION_RATIO) {
      throw malformed("XLSX ZIP entry size or expansion ratio exceeds its safety boundary");
    }
    if (entries.some((entry) => !isSafeZipPath(entry.name))) {
      throw malformed("XLSX contains an unsafe ZIP path");
    }
    if (entries.some((entry) => nestedArchiveExtension.test(entry.name))) {
      throw malformed("XLSX contains a nested archive");
    }
    if (entries.some((entry) => (entry.flags & 0x41) !== 0)) {
      throw malformed("Encrypted XLSX content is not allowed");
    }
    if (entries.some((entry) => entry.compression_method !== 0 && entry.compression_method !== 8)) {
      throw malformed("Unsupported XLSX ZIP compression method");
    }
    if (entries.some((entry) => forbiddenEmbeddedPath.test(entry.name))) {
      throw malformed("VBA, OLE, ActiveX, or embedded objects are not allowed");
    }
    for (const required of ["[Content_Types].xml", "xl/workbook.xml"] as const) {
      if (!this.#entries.has(required)) throw malformed(`Required OOXML entry is missing: ${required}`);
    }
    const contentTypes = this.text("[Content_Types].xml");
    if (/(?:macroEnabled|vbaProject|oleObject|activeX)/iu.test(contentTypes)) {
      throw malformed("OOXML content types declare executable or embedded content");
    }
    for (const entry of entries.filter((item) => item.name.endsWith(".rels"))) {
      const relationships = this.text(entry.name);
      if (
        /Type\s*=\s*["'][^"']*\/externalLink["']/iu.test(relationships)
        || /Target\s*=\s*["'][^"']*externalLinks?\//iu.test(relationships)
      ) {
        throw malformed("External workbook relationships are not allowed");
      }
    }
  }
}

function parseCentralDirectory(bytes: Uint8Array): readonly ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const start = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = start;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) {
      throw malformed("Invalid OOXML central directory");
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const entry = {
      name,
      flags: view.getUint16(offset + 8, true),
      compression_method: view.getUint16(offset + 10, true),
      compressed_size: view.getUint32(offset + 20, true),
      uncompressed_size: view.getUint32(offset + 24, true),
      local_header_offset: view.getUint32(offset + 42, true)
    };
    if (!name || names.has(name)) throw malformed("OOXML entry names must be non-empty and unique");
    if (
      entry.compressed_size === 0xffffffff
      || entry.uncompressed_size === 0xffffffff
      || entry.local_header_offset === 0xffffffff
    ) {
      throw malformed("ZIP64 entries require separate review");
    }
    names.add(name);
    entries.push(entry);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== start + size) throw malformed("OOXML central directory size mismatch");
  return entries;
}

function readZipEntry(bytes: Uint8Array, entry: ZipEntry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.local_header_offset;
  if (offset + 30 > bytes.byteLength || view.getUint32(offset, true) !== 0x04034b50) {
    throw malformed(`Invalid local ZIP header for ${entry.name}`);
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataOffset = offset + 30 + nameLength + extraLength;
  if (dataOffset + entry.compressed_size > bytes.byteLength) {
    throw malformed(`Compressed ZIP data exceeds archive boundary for ${entry.name}`);
  }
  const compressed = bytes.subarray(dataOffset, dataOffset + entry.compressed_size);
  const decoded = entry.compression_method === 0
    ? new Uint8Array(compressed)
    : new Uint8Array(inflateRawSync(compressed, { maxOutputLength: entry.uncompressed_size }));
  if (decoded.byteLength !== entry.uncompressed_size || (entry.flags & 0x41) !== 0) {
    throw malformed(`Unsafe or inconsistent ZIP entry ${entry.name}`);
  }
  return decoded;
}

const nestedArchiveExtension = /\.(?:7z|bz2|docx|gz|rar|tar|tgz|xlsm|xlsx|xlam|xz|zip)$/iu;
const forbiddenEmbeddedPath = /(?:^|\/)(?:activeX|embeddings|oleObjects)(?:\/|$)|(?:^|\/)vbaProject\.bin$/iu;

function isSafeZipPath(name: string) {
  if (name.includes("\\") || name.startsWith("/") || /^[a-z]:/iu.test(name)) return false;
  return name.split("/").every((segment) => segment !== "..");
}

function findEndOfCentralDirectory(view: DataView) {
  const minimum = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw malformed("OOXML end-of-central-directory record is missing");
}

function assertTraceability(input: AdapterExtractionInput): RawBlob {
  const { endpoint, snapshot, raw_blob: rawBlob } = input;
  if (snapshot.transport_status === "FAILED") {
    throw new AdapterExtractionError("SNAPSHOT_FAILED", "Cannot extract a failed Snapshot");
  }
  if (!rawBlob) {
    throw new AdapterExtractionError("RAW_BLOB_REQUIRED", "Successful Snapshot requires RawBlob");
  }
  if (
    snapshot.recruitment_endpoint_id !== endpoint.recruitment_endpoint_id
    || snapshot.raw_blob_id !== rawBlob.raw_blob_id
    || snapshot.content_hash !== rawBlob.raw_content_sha256
    || snapshot.content_length !== rawBlob.byte_length
  ) {
    throw new AdapterExtractionError("RAW_BLOB_MISMATCH", "Snapshot does not reference the supplied RawBlob");
  }
  if (
    normalizeMime(rawBlob.mime_type) !== BEIJING_ATTACHMENT_EXPECTED_MIME
    || normalizeMime(snapshot.response_metadata.mime_type) !== BEIJING_ATTACHMENT_EXPECTED_MIME
  ) {
    throw malformed("Beijing XLSX Adapter accepts the captured XLSX MIME only");
  }
  return rawBlob;
}

function parseRange(value: string | null) {
  if (!value) return null;
  const match = /^([A-Z]+)([1-9]\d*)(?::([A-Z]+)([1-9]\d*))?$/u.exec(value);
  if (!match) return null;
  const startColumn = columnIndex(match[1]!);
  const endColumn = columnIndex(match[3] ?? match[1]!);
  if (startColumn === null || endColumn === null) return null;
  return {
    start_column: startColumn,
    start_row: Number(match[2]),
    end_column: endColumn,
    end_row: Number(match[4] ?? match[2])
  };
}

function columnIndex(value: string) {
  const letters = /^[A-Z]+/u.exec(value)?.[0];
  if (!letters) return null;
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result;
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

function lastColumn(headers: ReadonlyMap<string, number>) {
  return columnName(Math.max(...headers.values()));
}

function normalizeCellValue(value: ParsedCell["raw_value"]) {
  return typeof value === "string" ? value.trim() : value;
}

function requiredText(field: XlsxCellEvidence) {
  if (typeof field.raw_value !== "string" || !field.raw_value.trim()) {
    throw malformed(`Required text field ${field.field_path} is missing`);
  }
  return field.raw_value;
}

function optionalOriginal(value: XlsxCellEvidence["raw_value"]) {
  return typeof value === "string" && value !== "" ? original(value) : undefined;
}

function extractFirst(value: string | undefined, pattern: RegExp) {
  const match = value ? pattern.exec(value)?.[1] : undefined;
  return match ? original(match) : undefined;
}

function decodeXml(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw malformed("OOXML XML entry is not valid UTF-8");
  }
}

function normalizeMime(value: string | null) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function malformed(message: string) {
  return new AdapterExtractionError("MALFORMED_CONTENT", message);
}

function original(text: string): OriginalText {
  return { text, encoding: UTF8_TEXT_ENCODING };
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
