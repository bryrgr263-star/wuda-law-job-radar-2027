import { createHash } from "node:crypto";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

import * as cheerio from "cheerio";

import {
  AdapterExtractionError,
  UTF8_TEXT_ENCODING,
  createExtractedRecordV2,
  type AdapterCompletenessAssessment,
  type AdapterCompletenessInput,
  type AdapterDescriptor,
  type AdapterExtractionInput,
  type AdapterNextPageInput,
  type AdapterRequestPlan,
  type EndpointValidationResult,
  type ExtractedRecord,
  type ExtractedRecordId,
  type ExtractedRecordV2,
  type NormalizedText,
  type OriginalText,
  type RawBlob,
  type RecruitmentAdapter,
  type RecruitmentEndpoint,
  type RequirementCertainty,
  type RequirementClauseRole,
  type RequirementDimension,
  type RequirementEvidenceFragment,
  type RequirementEvidenceFragmentId,
  type RequirementObservationStatus,
  type RequirementOperator,
  type RequirementPolarity,
  type RequirementSubjectScope,
  type RequirementValue,
  type SnapshotId,
  type SourceRecordLocator
} from "../../ingestion";
import { GUIZHOU_LEGAL_CANARY_NOTICE_URL } from "../p2-legal-01/guizhou-legal-canary-admission-preflight";
import {
  GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID,
  GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL
} from "../p2-legal-03/guizhou-attachment-admission-preflight";
import {
  GUIZHOU_ATTACHMENT_EXPECTED_MIME,
  GUIZHOU_ATTACHMENT_MAX_RESPONSE_BYTES
} from "../p2-legal-04/guizhou-attachment-observation-canary";

export const P2_LEGAL_05_ADAPTER_KEY =
  "cn-guizhou-judicial-public-institution-xlsx-requirement-observation";
export const P2_LEGAL_05_PARSER_VERSION =
  "p2-legal-05-offline-xlsx-requirement-observation/1.0.0";
export const P2_LEGAL_05_SOURCE_OCCURRENCE_SCHEMA_VERSION =
  "p2-legal-05-source-occurrence-extracted-record/2.0.0";
export const P2_LEGAL_05_TARGET_JOB_CODE = "22828700101";
export const P2_LEGAL_05_SNAPSHOT_ID =
  "p2-legal-04-snapshot:194cfc4e-18ec-4f79-9a61-0551bafbcfa9" as SnapshotId;
export const P2_LEGAL_05_RAW_SHA256 =
  "87b013e13ea78cd1de130553f203024fbd8c274479219b39ae1bd4280fc8f7ec";

const MAX_ZIP_ENTRIES = 256;
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_SINGLE_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_EXPANSION_RATIO = 100;

const descriptor: AdapterDescriptor = {
  adapter_key: P2_LEGAL_05_ADAPTER_KEY,
  name: "GuizhouLegalXlsxRequirementObservationAdapter",
  version: P2_LEGAL_05_PARSER_VERSION,
  supported_content_kinds: ["FILE"],
  capabilities: ["SINGLE_PAGE", "DOCUMENT_TEXT_EXTRACTION"]
};

const fieldHeaders = {
  sequence_number: "序号",
  organization: "单位名称",
  organization_code: "单位代码",
  title: "岗位名称",
  job_code: "岗位代码",
  job_category: "岗位类别",
  recruitment_count: "招聘人数",
  exam_category: "考试类别",
  exam_category_code: "考试类别代码",
  position_grade: "岗位等级",
  education_requirement: "学历",
  degree_requirement: "学位",
  major_requirement: "专业",
  other_qualification_conditions: "其他资格条件",
  notes: "备注"
} as const;

const requiredHeaders = Object.values(fieldHeaders);

type JobFieldName = keyof typeof fieldHeaders;
type CheerioNodeSet = ReturnType<ReturnType<typeof cheerio.load>>;

export type SourceObservationStatus =
  | "OBSERVED"
  | "NOT_OBSERVED"
  | "AMBIGUOUS"
  | "UNPARSED_CLAUSE"
  | "DOMAIN_GAP_OBSERVED";

export interface XlsxCellEvidence {
  readonly snapshot_id: SnapshotId;
  readonly sheet: string;
  readonly cell_or_range: string;
  readonly field_path: string;
  readonly header: string;
  readonly raw_value: string | number | boolean | null;
  readonly storage_value: string | null;
  readonly normalized_value: string | number | boolean | null;
  readonly formula: string | null;
  readonly cached_value: string | null;
  readonly status: "OBSERVED" | "NOT_OBSERVED" | "AMBIGUOUS";
  readonly flags: readonly SourceObservationStatus[];
  readonly parser_version: string;
}

export interface SourceNeutralRequirementFactCandidate {
  readonly fact_candidate_id: string;
  readonly dimension: RequirementDimension;
  readonly operator: RequirementOperator;
  readonly value: RequirementValue;
  readonly subject_scope: RequirementSubjectScope;
  readonly logic_operator: "AND" | "OR";
  readonly polarity: RequirementPolarity;
  readonly certainty: RequirementCertainty;
  readonly evidence_fragment_ids: readonly RequirementEvidenceFragmentId[];
  readonly parser_version: string;
}

export interface SourceNeutralRequirementObservationCandidate {
  readonly observation_candidate_id: string;
  readonly status: RequirementObservationStatus;
  readonly clause_role: RequirementClauseRole;
  readonly dimension_hint?: RequirementDimension;
  readonly subject_scope?: RequirementSubjectScope;
  readonly raw_value: string | null;
  readonly normalized_value: string | null;
  readonly certainty: RequirementCertainty | null;
  readonly fact_candidate_ids: readonly string[];
  readonly evidence_fragment_ids: readonly RequirementEvidenceFragmentId[];
  readonly blocks_completeness: boolean;
  readonly parser_version: string;
}

export interface GuizhouWorkbookAudit {
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
    readonly formula_cells: readonly {
      readonly cell: string;
      readonly formula: string;
      readonly cached_value: string | null;
    }[];
  }[];
  readonly selected_sheet: string;
  readonly selection_basis: readonly string[];
  readonly title_cell: string;
  readonly title_text: string;
  readonly header_row: number;
  readonly header_range: string;
  readonly job_data_start_row: number;
  readonly job_data_end_row: number;
  readonly target_job_code: string;
  readonly target_row: number;
  readonly target_row_range: string;
  readonly matching_target_rows: number;
}

export interface LegalFocusAudit {
  readonly explicit_law_non_law: "YES" | "NO" | "NOT_OBSERVED";
  readonly explicit_juris_master_non_law: "YES" | "NO" | "NOT_OBSERVED";
  readonly juris_master_only: "YES" | "NO" | "NOT_OBSERVED";
  readonly law_academic_master: "YES" | "NO" | "NOT_OBSERVED";
  readonly bachelor_law_or_legal_restriction: "YES" | "NO" | "NOT_OBSERVED";
  readonly bachelor_graduate_combination: "EXPLICIT_SCOPES_AMBIGUOUS_APPLICABILITY";
  readonly legal_professional_qualification: "YES" | "NO" | "NOT_OBSERVED";
  readonly graduate_program_codes: readonly {
    readonly code: string;
    readonly label: string;
    readonly directory_namespace: string;
    readonly directory_version: string;
    readonly evidence_cell: string;
  }[];
  readonly non_law_eligibility_from_0351: "AMBIGUOUS";
}

export interface GuizhouLegalXlsxRequirementParseResult {
  readonly record: ExtractedRecord;
  readonly source_occurrence_record: ExtractedRecordV2;
  readonly workbook_audit: GuizhouWorkbookAudit;
  readonly fields: Readonly<Record<JobFieldName, XlsxCellEvidence>>;
  readonly evidence_fragments: readonly RequirementEvidenceFragment[];
  readonly fact_candidates: readonly SourceNeutralRequirementFactCandidate[];
  readonly observation_candidates: readonly SourceNeutralRequirementObservationCandidate[];
  readonly legal_focus: LegalFocusAudit;
  readonly requirement_set_readiness: {
    readonly xlsx_observation_ready: true;
    readonly final_requirement_set_ready: false;
    readonly reason_codes: readonly string[];
  };
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
  readonly title_cell: string;
  readonly title_text: string;
}

interface FragmentCatalog {
  readonly by_key: ReadonlyMap<string, RequirementEvidenceFragment>;
  readonly fragments: readonly RequirementEvidenceFragment[];
}

export class GuizhouLegalXlsxRequirementObservationAdapter implements RecruitmentAdapter {
  readonly descriptor = descriptor;

  validateEndpoint(endpoint: RecruitmentEndpoint): EndpointValidationResult {
    const issues: string[] = [];
    if (endpoint.adapter_key !== P2_LEGAL_05_ADAPTER_KEY) {
      issues.push(`Endpoint adapter_key must be ${P2_LEGAL_05_ADAPTER_KEY}`);
    }
    if (endpoint.recruitment_endpoint_id !== GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID) {
      issues.push("Endpoint must use the admitted Guizhou attachment reference");
    }
    if (endpoint.locator !== GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL) {
      issues.push("Endpoint locator must match the sealed Guizhou XLSX locator");
    }
    if (endpoint.request_method !== "GET") issues.push("Endpoint must retain GET");
    if (endpoint.content_kind !== "FILE") issues.push("Endpoint must retain FILE");
    if (endpoint.collection_config.max_items !== 1 || endpoint.collection_config.max_pages !== 1) {
      issues.push("Offline adapter retains the one-endpoint one-run collection boundary");
    }
    if (endpoint.collection_config.follow_redirects !== false) {
      issues.push("Offline adapter endpoint must not follow redirects");
    }
    if (endpoint.collection_config.retry_limit !== 0) {
      issues.push("Offline adapter endpoint must retain retry_limit 0");
    }
    if (endpoint.enabled) issues.push("Offline adapter requires a disabled Endpoint");
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
    return [this.parse(input).record];
  }

  parse(input: AdapterExtractionInput): GuizhouLegalXlsxRequirementParseResult {
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
    if (input.records.length !== 1) {
      return { status: "SUSPICIOUS_EMPTY", reason_codes: ["TARGET_JOB_RECORD_NOT_UNIQUE"] };
    }
    return { status: "COMPLETE", reason_codes: ["TARGET_XLSX_JOB_ROW_EXTRACTED"] };
  }

  private assertEndpoint(endpoint: RecruitmentEndpoint) {
    const validation = this.validateEndpoint(endpoint);
    if (!validation.valid) {
      throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", validation.issues.join("; "));
    }
  }
}

export function createGuizhouLegalRequirementEndpoint(
  sourceDefinitionId: RecruitmentEndpoint["source_definition_id"]
): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID,
    source_definition_id: sourceDefinitionId,
    name: traceable("贵州省司法厅所属事业单位2025年公开招聘岗位及要求一览表"),
    description: traceable("已封存 P2-LEGAL-04 Raw/Snapshot 的离线岗位级 Evidence 提取。"),
    coverage_regions: [{ raw_text: original("贵州省") }],
    locator: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
    request_method: "GET",
    content_kind: "FILE",
    adapter_key: P2_LEGAL_05_ADAPTER_KEY,
    decoded_text_encoding: UTF8_TEXT_ENCODING,
    collection_config: {
      timeout_ms: 20_000,
      max_items: 1,
      max_pages: 1,
      follow_redirects: false,
      retry_limit: 0
    },
    enabled: false
  };
}

function parseWorkbook(
  input: AdapterExtractionInput,
  rawBlob: RawBlob
): GuizhouLegalXlsxRequirementParseResult {
  const archive = new ZipPackage(rawBlob.bytes);
  const sharedStrings = parseSharedStrings(archive.optionalText("xl/sharedStrings.xml"));
  const workbook = parseWorkbookDefinition(archive);
  const sheets = workbook.sheets.map((definition) => parseWorksheet(
    archive.text(definition.path),
    definition.name,
    definition.state,
    sharedStrings
  ));
  const candidates = sheets.flatMap(findTableCandidates);
  if (candidates.length !== 1) {
    throw malformed(
      candidates.length === 0
        ? "No worksheet contains the exact Guizhou job-table headers and title"
        : `Multiple worksheet tables require review: ${candidates.map(
            (candidate) => `${candidate.sheet.name}!${candidate.header_row}`
          ).join(", ")}`
    );
  }
  const candidate = candidates[0]!;
  const usedRange = parseRange(candidate.sheet.used_range);
  if (!usedRange) throw malformed("Selected worksheet has no valid used range");
  const jobCodeColumn = candidate.headers.get(fieldHeaders.job_code);
  if (!jobCodeColumn) throw malformed("Target table has no job-code column");
  const matchingRows = candidate.sheet.rows.filter((row) => {
    const value = row.cells.get(`${columnName(jobCodeColumn)}${row.row_number}`)?.raw_value;
    return value !== null && value !== undefined && String(value).trim() === P2_LEGAL_05_TARGET_JOB_CODE;
  });
  if (matchingRows.length !== 1) {
    throw malformed(`Target job code must match exactly one row; observed ${matchingRows.length}`);
  }
  const targetRow = matchingRows[0]!;
  const fields = buildFieldEvidence(
    input.snapshot.snapshot_id,
    candidate,
    targetRow.row_number,
    targetRow.cells
  );
  const targetRowRange = `${columnName(usedRange.start_column)}${targetRow.row_number}:${columnName(
    usedRange.end_column
  )}${targetRow.row_number}`;
  const record = buildExtractedRecord(input, candidate, targetRowRange, fields);
  const sourceOccurrenceRecord = buildSourceOccurrenceExtractedRecord(
    input,
    candidate,
    targetRowRange,
    fields
  );
  const fragments = buildEvidenceFragments(record.extracted_record_id, input.snapshot.snapshot_id, fields, candidate);
  const facts = buildFactCandidates(fragments);
  const observations = buildObservationCandidates(fragments, facts);
  const jobRows = candidate.sheet.rows.filter((row) => {
    if (row.row_number <= candidate.header_row) return false;
    const value = row.cells.get(`${columnName(jobCodeColumn)}${row.row_number}`)?.raw_value;
    return value !== null && value !== undefined && String(value).trim() !== "";
  }).map((row) => row.row_number);
  const workbookAudit: GuizhouWorkbookAudit = {
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
      formula_cells: [...sheet.cells.values()].flatMap((cell) => cell.formula === null
        ? []
        : [{
            cell: cell.coordinate,
            formula: cell.formula,
            cached_value: cell.cached_value
          }])
    })),
    selected_sheet: candidate.sheet.name,
    selection_basis: [
      `Table title ${candidate.title_text} observed at ${candidate.title_cell}`,
      `Header row ${candidate.header_row} contains exact headers: ${requiredHeaders.join("、")}`,
      `Target job code ${P2_LEGAL_05_TARGET_JOB_CODE} appears exactly once`
    ],
    title_cell: candidate.title_cell,
    title_text: candidate.title_text,
    header_row: candidate.header_row,
    header_range: `${columnName(usedRange.start_column)}${candidate.header_row}:${columnName(
      usedRange.end_column
    )}${candidate.header_row}`,
    job_data_start_row: Math.min(...jobRows),
    job_data_end_row: Math.max(...jobRows),
    target_job_code: P2_LEGAL_05_TARGET_JOB_CODE,
    target_row: targetRow.row_number,
    target_row_range: targetRowRange,
    matching_target_rows: matchingRows.length
  };
  return {
    record,
    source_occurrence_record: sourceOccurrenceRecord,
    workbook_audit: workbookAudit,
    fields,
    evidence_fragments: fragments.fragments,
    fact_candidates: facts,
    observation_candidates: observations,
    legal_focus: legalFocus(fields),
    requirement_set_readiness: {
      xlsx_observation_ready: true,
      final_requirement_set_ready: false,
      reason_codes: [
        "ANNOUNCEMENT_LEVEL_REQUIREMENTS_NOT_MERGED",
        "OPPORTUNITY_VERSION_NOT_CREATED",
        "BACHELOR_GRADUATE_APPLICABILITY_AMBIGUOUS",
        "GENDER_REQUIREMENT_DOMAIN_GAP",
        "JOB_NOTE_CLASSIFICATION_UNRESOLVED"
      ]
    }
  };
}

function buildSourceOccurrenceExtractedRecord(
  input: AdapterExtractionInput,
  candidate: JobTableCandidate,
  targetRowRange: string,
  fields: Readonly<Record<JobFieldName, XlsxCellEvidence>>
): ExtractedRecordV2 {
  const jobCode = requiredValue(fields.job_code);
  const sourceRecordId = `${GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL}#sheet=${encodeURIComponent(
    candidate.sheet.name
  )}&job_code=${encodeURIComponent(jobCode)}`;
  return createExtractedRecordV2(input.snapshot, {
    source_definition_id: input.endpoint.source_definition_id,
    identity_candidates: [
      { kind: "SOURCE_RECORD_ID", value: sourceRecordId, confidence: "HIGH" },
      { kind: "RAW_FIELD_COMBINATION", value: jobCode, confidence: "HIGH" }
    ],
    raw_source_record_id: sourceRecordId,
    raw_title: original(requiredValue(fields.title)),
    raw_organization_name: original(requiredValue(fields.organization)),
    raw_location_text: [original("贵州省")],
    announcement_url: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
    recruitment_year: original("2025"),
    recruitment_context: {
      recruitment_batch: { applicability: "UNRESOLVED" },
      position: {
        identity_state: "PROVISIONAL",
        source_local_identifier: original(jobCode),
        evidence_locator: {
          kind: "SPREADSHEET",
          sheet: candidate.sheet.name,
          cell_or_range: fields.job_code.cell_or_range,
          field_path: fields.job_code.field_path
        }
      },
      opportunity: {
        identity_state: "PROVISIONAL",
        source_local_identifier: original(`${candidate.sheet.name}!${targetRowRange}`),
        evidence_locator: {
          kind: "SPREADSHEET",
          sheet: candidate.sheet.name,
          cell_or_range: targetRowRange
        }
      }
    },
    source_record_locator: {
      kind: "DOCUMENT",
      section: candidate.sheet.name,
      text_locator: targetRowRange
    },
    adapter_metadata: {
      [P2_LEGAL_05_ADAPTER_KEY]: {
        source_fact_scope: "SEALED_XLSX_TARGET_JOB_ROW_ONLY",
        target_job_code: P2_LEGAL_05_TARGET_JOB_CODE,
        sheet: candidate.sheet.name,
        row_range: targetRowRange,
        parser_version: P2_LEGAL_05_PARSER_VERSION,
        source_occurrence_materialization_only: true,
        requirement_set_created: false,
        eligibility_executed: false
      }
    },
    extraction: {
      extractor_name: descriptor.name,
      extractor_version: descriptor.version,
      schema_version: P2_LEGAL_05_SOURCE_OCCURRENCE_SCHEMA_VERSION
    }
  });
}

function buildExtractedRecord(
  input: AdapterExtractionInput,
  candidate: JobTableCandidate,
  targetRowRange: string,
  fields: Readonly<Record<JobFieldName, XlsxCellEvidence>>
): ExtractedRecord {
  const jobCode = requiredValue(fields.job_code);
  const sourceRecordId = `${GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL}#sheet=${encodeURIComponent(
    candidate.sheet.name
  )}&job_code=${encodeURIComponent(jobCode)}`;
  const sourceRecordLocator: SourceRecordLocator = {
    kind: "DOCUMENT",
    section: candidate.sheet.name,
    text_locator: targetRowRange
  };
  return {
    extracted_record_id: `extracted:${sha256(
      `${input.snapshot.snapshot_id}|${sourceRecordId}|${targetRowRange}`
    )}` as ExtractedRecordId,
    snapshot_id: input.snapshot.snapshot_id,
    source_definition_id: input.endpoint.source_definition_id,
    identity_candidates: [
      { kind: "SOURCE_RECORD_ID", value: sourceRecordId, confidence: "HIGH" },
      { kind: "RAW_FIELD_COMBINATION", value: jobCode, confidence: "HIGH" }
    ],
    raw_source_record_id: sourceRecordId,
    raw_title: original(requiredValue(fields.title)),
    raw_organization_name: original(requiredValue(fields.organization)),
    raw_location_text: [original("贵州省")],
    announcement_url: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
    recruitment_year: original("2025"),
    source_record_locator: sourceRecordLocator,
    adapter_metadata: {
      [P2_LEGAL_05_ADAPTER_KEY]: {
        source_fact_scope: "SEALED_XLSX_TARGET_JOB_ROW_ONLY",
        target_job_code: P2_LEGAL_05_TARGET_JOB_CODE,
        sheet: candidate.sheet.name,
        row_range: targetRowRange,
        parser_version: P2_LEGAL_05_PARSER_VERSION,
        no_combined_requirement_text: true,
        eligibility_executed: false,
        requirement_set_created: false
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
): Readonly<Record<JobFieldName, XlsxCellEvidence>> {
  const build = (fieldName: JobFieldName) => buildCellEvidence(
    snapshotId,
    candidate,
    rowNumber,
    rowCells,
    fieldName
  );
  return {
    sequence_number: build("sequence_number"),
    organization: build("organization"),
    organization_code: build("organization_code"),
    title: build("title"),
    job_code: build("job_code"),
    job_category: build("job_category"),
    recruitment_count: build("recruitment_count"),
    exam_category: build("exam_category"),
    exam_category_code: build("exam_category_code"),
    position_grade: build("position_grade"),
    education_requirement: build("education_requirement"),
    degree_requirement: build("degree_requirement"),
    major_requirement: build("major_requirement"),
    other_qualification_conditions: build("other_qualification_conditions"),
    notes: build("notes")
  };
}

function buildCellEvidence(
  snapshotId: SnapshotId,
  candidate: JobTableCandidate,
  rowNumber: number,
  rowCells: ReadonlyMap<string, ParsedCell>,
  fieldName: JobFieldName
): XlsxCellEvidence {
  const header = fieldHeaders[fieldName];
  const column = candidate.headers.get(header);
  if (!column) throw malformed(`Selected table is missing header ${header}`);
  const cellCoordinate = `${columnName(column)}${rowNumber}`;
  const cell = rowCells.get(cellCoordinate);
  const hasValue = cell?.raw_value !== null && cell?.raw_value !== undefined
    && String(cell.raw_value).trim() !== "";
  const status = cell?.formula
    ? "AMBIGUOUS"
    : hasValue
      ? "OBSERVED"
      : "NOT_OBSERVED";
  const flags: SourceObservationStatus[] = [];
  if (cell?.formula) flags.push("AMBIGUOUS");
  return {
    snapshot_id: snapshotId,
    sheet: candidate.sheet.name,
    cell_or_range: cellCoordinate,
    field_path: `workbook.sheet[${JSON.stringify(candidate.sheet.name)}].cell[${cellCoordinate}]`,
    header,
    raw_value: cell?.raw_value ?? null,
    storage_value: cell?.storage_value ?? null,
    normalized_value: normalizeCellValue(fieldName, cell?.raw_value ?? null),
    formula: cell?.formula ?? null,
    cached_value: cell?.cached_value ?? null,
    status,
    flags,
    parser_version: P2_LEGAL_05_PARSER_VERSION
  };
}

function buildEvidenceFragments(
  extractedRecordId: ExtractedRecordId,
  snapshotId: SnapshotId,
  fields: Readonly<Record<JobFieldName, XlsxCellEvidence>>,
  candidate: JobTableCandidate
): FragmentCatalog {
  const majorRaw = textValue(fields.major_requirement);
  const bachelorMajor = /(?:^|\n)本科[：:]\s*([^\n]+)/u.exec(majorRaw)?.[1]?.trim() ?? null;
  const graduateMajor = /(?:^|\n)研究生[：:]\s*([^\n]+)/u.exec(majorRaw)?.[1]?.trim() ?? null;
  const otherConditions = textValue(fields.other_qualification_conditions);
  const gender = /限男性/u.exec(otherConditions)?.[0] ?? null;
  const legalQualification = /具有A类法律职业资格证书/u.exec(otherConditions)?.[0] ?? null;
  const catalogCell = candidate.sheet.cells.get("A6");
  const catalogText = typeof catalogCell?.raw_value === "string"
    ? catalogCell.raw_value
    : null;
  if (!bachelorMajor || !graduateMajor || !gender || !legalQualification || !catalogText) {
    throw malformed("Target row requirement segments or catalog note are incomplete");
  }
  const fragments = [
    textFragment(extractedRecordId, snapshotId, "education", fields.education_requirement, textValue(fields.education_requirement)),
    textFragment(extractedRecordId, snapshotId, "degree", fields.degree_requirement, textValue(fields.degree_requirement)),
    textFragment(
      extractedRecordId,
      snapshotId,
      "bachelor-major",
      fields.major_requirement,
      bachelorMajor,
      { directory_namespace: "普通高等学校本科专业目录", directory_version: "2024年" },
      ".bachelor_segment"
    ),
    textFragment(
      extractedRecordId,
      snapshotId,
      "graduate-major",
      fields.major_requirement,
      graduateMajor,
      { directory_namespace: "研究生教育学科专业目录", directory_version: "2022年" },
      ".graduate_segment"
    ),
    textFragment(
      extractedRecordId,
      snapshotId,
      "major-scope-relationship",
      fields.major_requirement,
      majorRaw,
      undefined,
      ".scope_relationship"
    ),
    directTextFragment(
      extractedRecordId,
      snapshotId,
      "catalog-note",
      candidate.sheet.name,
      "A6:O6",
      `workbook.sheet[${JSON.stringify(candidate.sheet.name)}].range[A6:O6].catalog_note`,
      catalogText
    ),
    textFragment(
      extractedRecordId,
      snapshotId,
      "gender",
      fields.other_qualification_conditions,
      gender,
      undefined,
      ".gender_clause"
    ),
    textFragment(
      extractedRecordId,
      snapshotId,
      "other-qualification-full",
      fields.other_qualification_conditions,
      otherConditions,
      undefined,
      ".other_qualification_full"
    ),
    textFragment(
      extractedRecordId,
      snapshotId,
      "legal-qualification",
      fields.other_qualification_conditions,
      legalQualification,
      undefined,
      ".legal_professional_qualification_clause"
    ),
    textFragment(
      extractedRecordId,
      snapshotId,
      "job-note",
      fields.notes,
      textValue(fields.notes),
      undefined,
      ".job_note"
    )
  ];
  return {
    fragments,
    by_key: new Map(fragments.map((fragment) => {
      const key = fragment.locator.field_path?.split(".").at(-1) ?? fragment.requirement_evidence_fragment_id;
      return [key, fragment] as const;
    }))
  };
}

function buildFactCandidates(catalog: FragmentCatalog): readonly SourceNeutralRequirementFactCandidate[] {
  const education = requiredFragment(catalog, "education");
  const degree = requiredFragment(catalog, "degree");
  const bachelor = requiredFragment(catalog, "bachelor_segment");
  const graduate = requiredFragment(catalog, "graduate_segment");
  const catalogNote = requiredFragment(catalog, "catalog_note");
  const qualification = requiredFragment(catalog, "legal_professional_qualification_clause");
  const graduateEvidence = [
    graduate.requirement_evidence_fragment_id,
    catalogNote.requirement_evidence_fragment_id
  ];
  return [
    factCandidate("education", {
      dimension: "EDUCATION_LEVEL",
      operator: "AT_LEAST",
      value: { kind: "CODE", code: "BACHELOR" },
      subject_scope: "CANDIDATE",
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT",
      evidence_fragment_ids: [education.requirement_evidence_fragment_id]
    }),
    factCandidate("degree", {
      dimension: "ACADEMIC_DEGREE",
      operator: "AT_LEAST",
      value: { kind: "CODE", code: "BACHELOR_DEGREE" },
      subject_scope: "CANDIDATE",
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT",
      evidence_fragment_ids: [degree.requirement_evidence_fragment_id]
    }),
    factCandidate("bachelor-major", {
      dimension: "MAJOR",
      operator: "EQUALS",
      value: { kind: "TEXT", value: normalized("法学类") },
      subject_scope: "BACHELOR",
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT",
      evidence_fragment_ids: [bachelor.requirement_evidence_fragment_id]
    }),
    factCandidate("graduate-major-0301", {
      dimension: "MAJOR",
      operator: "EQUALS",
      value: {
        kind: "PROGRAM_REFERENCE",
        reference: {
          directory_namespace: "研究生教育学科专业目录",
          directory_version: "2022年",
          program_code: "0301",
          program_label: normalized("法学")
        }
      },
      subject_scope: "GRADUATE",
      logic_operator: "OR",
      polarity: "POSITIVE",
      certainty: "EXPLICIT",
      evidence_fragment_ids: graduateEvidence
    }),
    factCandidate("graduate-major-0351", {
      dimension: "MAJOR",
      operator: "EQUALS",
      value: {
        kind: "PROGRAM_REFERENCE",
        reference: {
          directory_namespace: "研究生教育学科专业目录",
          directory_version: "2022年",
          program_code: "0351",
          program_label: normalized("法律")
        }
      },
      subject_scope: "GRADUATE",
      logic_operator: "OR",
      polarity: "POSITIVE",
      certainty: "EXPLICIT",
      evidence_fragment_ids: graduateEvidence
    }),
    factCandidate("legal-qualification-a", {
      dimension: "PROFESSIONAL_QUALIFICATION",
      operator: "EXISTS",
      value: { kind: "CODE", code: "LEGAL_PROFESSIONAL_QUALIFICATION_A" },
      subject_scope: "CANDIDATE",
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT",
      evidence_fragment_ids: [qualification.requirement_evidence_fragment_id]
    })
  ];
}

function buildObservationCandidates(
  catalog: FragmentCatalog,
  facts: readonly SourceNeutralRequirementFactCandidate[]
): readonly SourceNeutralRequirementObservationCandidate[] {
  const fact = (label: string) => facts.filter((item) => item.fact_candidate_id.includes(`:${label}:`));
  return [
    confirmedObservation("education", "EDUCATION_LEVEL", "CANDIDATE", catalog, fact("education")),
    confirmedObservation("degree", "ACADEMIC_DEGREE", "CANDIDATE", catalog, fact("degree")),
    confirmedObservation("bachelor-major", "MAJOR", "BACHELOR", catalog, fact("bachelor-major"), "bachelor_segment"),
    confirmedObservation(
      "graduate-major",
      "MAJOR",
      "GRADUATE",
      catalog,
      facts.filter((item) => item.fact_candidate_id.includes(":graduate-major-")),
      "graduate_segment",
      ["catalog_note"]
    ),
    unresolvedObservation(
      "major-scope-relationship",
      "AMBIGUOUS",
      "MANDATORY",
      "MAJOR",
      undefined,
      catalog,
      "scope_relationship"
    ),
    unresolvedObservation(
      "0351-non-law-applicability",
      "AMBIGUOUS",
      "MANDATORY",
      "MAJOR",
      "GRADUATE",
      catalog,
      "graduate_segment",
      ["catalog_note"]
    ),
    unresolvedObservation(
      "gender",
      "DOMAIN_GAP_OBSERVED",
      "MANDATORY",
      undefined,
      "CANDIDATE",
      catalog,
      "gender_clause"
    ),
    confirmedObservation(
      "legal-qualification",
      "PROFESSIONAL_QUALIFICATION",
      "CANDIDATE",
      catalog,
      fact("legal-qualification-a"),
      "legal_professional_qualification_clause"
    ),
    unresolvedObservation(
      "job-note",
      "UNPARSED_CLAUSE",
      "UNKNOWN",
      undefined,
      "CANDIDATE",
      catalog,
      "job_note"
    ),
    notObserved("age", "AGE", "CANDIDATE", catalog, requirementSurfaceFragmentKeys),
    notObserved(
      "work-experience",
      "WORK_EXPERIENCE",
      "CANDIDATE",
      catalog,
      requirementSurfaceFragmentKeys
    ),
    notObserved(
      "candidate-cohort",
      "CANDIDATE_COHORT",
      "CANDIDATE",
      catalog,
      requirementSurfaceFragmentKeys
    ),
    notObserved(
      "household-registration",
      "HOUSEHOLD_REGISTRATION",
      "CANDIDATE",
      catalog,
      requirementSurfaceFragmentKeys
    ),
    notObserved(
      "student-origin",
      "STUDENT_ORIGIN",
      "CANDIDATE",
      catalog,
      requirementSurfaceFragmentKeys
    )
  ];
}

const requirementSurfaceFragmentKeys = [
  "scope_relationship",
  "other_qualification_full",
  "job_note"
] as const;

function confirmedObservation(
  label: string,
  dimension: RequirementDimension,
  scope: RequirementSubjectScope,
  catalog: FragmentCatalog,
  facts: readonly SourceNeutralRequirementFactCandidate[],
  fragmentKey = label,
  additionalFragmentKeys: readonly string[] = []
): SourceNeutralRequirementObservationCandidate {
  const fragments = [fragmentKey, ...additionalFragmentKeys].map((key) => requiredFragment(catalog, key));
  const primary = fragments[0]!;
  return observationCandidate(label, {
    status: "CONFIRMED_REQUIREMENT",
    clause_role: "MANDATORY",
    dimension_hint: dimension,
    subject_scope: scope,
    raw_value: fragmentText(primary),
    normalized_value: normalizedFragmentText(primary),
    certainty: "EXPLICIT",
    fact_candidate_ids: facts.map((item) => item.fact_candidate_id),
    evidence_fragment_ids: fragments.map((item) => item.requirement_evidence_fragment_id),
    blocks_completeness: false
  });
}

function unresolvedObservation(
  label: string,
  status: Extract<RequirementObservationStatus, "AMBIGUOUS" | "UNPARSED_CLAUSE" | "DOMAIN_GAP_OBSERVED">,
  clauseRole: RequirementClauseRole,
  dimension: RequirementDimension | undefined,
  scope: RequirementSubjectScope | undefined,
  catalog: FragmentCatalog,
  fragmentKey: string,
  additionalFragmentKeys: readonly string[] = []
): SourceNeutralRequirementObservationCandidate {
  const fragments = [fragmentKey, ...additionalFragmentKeys].map((key) => requiredFragment(catalog, key));
  const primary = fragments[0]!;
  return observationCandidate(label, {
    status,
    clause_role: clauseRole,
    ...(dimension ? { dimension_hint: dimension } : {}),
    ...(scope ? { subject_scope: scope } : {}),
    raw_value: fragmentText(primary),
    normalized_value: normalizedFragmentText(primary),
    certainty: status === "AMBIGUOUS" ? "AMBIGUOUS" : "EXPLICIT",
    fact_candidate_ids: [],
    evidence_fragment_ids: fragments.map((item) => item.requirement_evidence_fragment_id),
    blocks_completeness: true
  });
}

function notObserved(
  label: string,
  dimension: RequirementDimension,
  scope: RequirementSubjectScope,
  catalog: FragmentCatalog,
  fragmentKeys: readonly string[]
): SourceNeutralRequirementObservationCandidate {
  const fragments = fragmentKeys.map((key) => requiredFragment(catalog, key));
  return observationCandidate(label, {
    status: "NOT_OBSERVED",
    clause_role: "UNKNOWN",
    dimension_hint: dimension,
    subject_scope: scope,
    raw_value: null,
    normalized_value: null,
    certainty: null,
    fact_candidate_ids: [],
    evidence_fragment_ids: fragments.map((fragment) => fragment.requirement_evidence_fragment_id),
    blocks_completeness: true
  });
}

function legalFocus(fields: Readonly<Record<JobFieldName, XlsxCellEvidence>>): LegalFocusAudit {
  const major = textValue(fields.major_requirement);
  const other = textValue(fields.other_qualification_conditions);
  const explicitLawNonLaw = /法律\s*[（(]\s*非法学\s*[）)]/u.test(major);
  const explicitJurisNonLaw = /法律硕士\s*[（(]\s*非法学\s*[）)]/u.test(major);
  const withoutNonLaw = major.replace(/法律硕士\s*[（(]\s*非法学\s*[）)]/gu, "");
  return {
    explicit_law_non_law: explicitLawNonLaw ? "YES" : "NOT_OBSERVED",
    explicit_juris_master_non_law: explicitJurisNonLaw ? "YES" : "NOT_OBSERVED",
    juris_master_only: /法律硕士/u.test(withoutNonLaw) ? "YES" : "NOT_OBSERVED",
    law_academic_master: /法学硕士/u.test(major) ? "YES" : "NOT_OBSERVED",
    bachelor_law_or_legal_restriction: /本科[：:]\s*(?:法学类|法律类)/u.test(major)
      ? "YES"
      : "NOT_OBSERVED",
    bachelor_graduate_combination: "EXPLICIT_SCOPES_AMBIGUOUS_APPLICABILITY",
    legal_professional_qualification: /A类法律职业资格证书/u.test(other)
      ? "YES"
      : "NOT_OBSERVED",
    graduate_program_codes: [
      {
        code: "0301",
        label: "法学",
        directory_namespace: "研究生教育学科专业目录",
        directory_version: "2022年",
        evidence_cell: fields.major_requirement.cell_or_range
      },
      {
        code: "0351",
        label: "法律",
        directory_namespace: "研究生教育学科专业目录",
        directory_version: "2022年",
        evidence_cell: fields.major_requirement.cell_or_range
      }
    ],
    non_law_eligibility_from_0351: "AMBIGUOUS"
  };
}

function textFragment(
  extractedRecordId: ExtractedRecordId,
  snapshotId: SnapshotId,
  label: string,
  cell: XlsxCellEvidence,
  text: string,
  academicProgramDirectory?: RequirementEvidenceFragment["academic_program_directory"],
  fieldPathSuffix = ""
): RequirementEvidenceFragment {
  return directTextFragment(
    extractedRecordId,
    snapshotId,
    label,
    cell.sheet,
    cell.cell_or_range,
    `${cell.field_path}${fieldPathSuffix || `.${label}`}`,
    text,
    academicProgramDirectory
  );
}

function directTextFragment(
  extractedRecordId: ExtractedRecordId,
  snapshotId: SnapshotId,
  label: string,
  sheet: string,
  cellOrRange: string,
  fieldPath: string,
  text: string,
  academicProgramDirectory?: RequirementEvidenceFragment["academic_program_directory"]
): RequirementEvidenceFragment {
  return {
    requirement_evidence_fragment_id: fragmentId(
      extractedRecordId,
      snapshotId,
      label,
      cellOrRange,
      text
    ),
    extracted_record_id: extractedRecordId,
    snapshot_id: snapshotId,
    locator: {
      kind: "SPREADSHEET",
      sheet,
      cell_or_range: cellOrRange,
      field_path: fieldPath
    },
    ...(academicProgramDirectory ? { academic_program_directory: academicProgramDirectory } : {}),
    extractor_name: descriptor.name,
    extractor_version: descriptor.version,
    parser_version: P2_LEGAL_05_PARSER_VERSION,
    observed_value_state: "TEXT",
    original_text: original(text),
    normalized_text: normalized(text)
  };
}

function factCandidate(
  label: string,
  input: Omit<SourceNeutralRequirementFactCandidate, "fact_candidate_id" | "parser_version">
): SourceNeutralRequirementFactCandidate {
  return {
    fact_candidate_id: `requirement-fact-candidate:${label}:${sha256(stableSerialize(input))}`,
    ...input,
    parser_version: P2_LEGAL_05_PARSER_VERSION
  };
}

function observationCandidate(
  label: string,
  input: Omit<SourceNeutralRequirementObservationCandidate, "observation_candidate_id" | "parser_version">
): SourceNeutralRequirementObservationCandidate {
  return {
    observation_candidate_id: `requirement-observation-candidate:${label}:${sha256(stableSerialize(input))}`,
    ...input,
    parser_version: P2_LEGAL_05_PARSER_VERSION
  };
}

function requiredFragment(catalog: FragmentCatalog, key: string) {
  const fragment = catalog.by_key.get(key);
  if (!fragment) throw malformed(`Requirement Evidence Fragment missing: ${key}`);
  return fragment;
}

function fragmentText(fragment: RequirementEvidenceFragment) {
  return fragment.observed_value_state === "TEXT" ? fragment.original_text.text : null;
}

function normalizedFragmentText(fragment: RequirementEvidenceFragment) {
  return fragment.observed_value_state === "TEXT"
    ? fragment.normalized_text?.text ?? null
    : null;
}

function fragmentId(
  extractedRecordId: ExtractedRecordId,
  snapshotId: SnapshotId,
  label: string,
  cellOrRange: string,
  text: string
) {
  return `requirement-evidence-fragment:${sha256(stableSerialize({
    extracted_record_id: extractedRecordId,
    snapshot_id: snapshotId,
    label,
    cell_or_range: cellOrRange,
    text
  }))}` as RequirementEvidenceFragmentId;
}

function findTableCandidates(sheet: ParsedSheet): readonly JobTableCandidate[] {
  const candidates: JobTableCandidate[] = [];
  for (const row of sheet.rows) {
    const headers = new Map<string, number>();
    for (const cell of row.cells.values()) {
      if (typeof cell.raw_value !== "string") continue;
      const value = cell.raw_value.trim();
      if (!requiredHeaders.includes(value as (typeof requiredHeaders)[number])) continue;
      const column = columnIndex(cell.coordinate);
      if (column) headers.set(value, column);
    }
    if (!requiredHeaders.every((header) => headers.has(header))) continue;
    const title = sheet.rows
      .filter((candidate) => candidate.row_number < row.row_number)
      .flatMap((candidate) => [...candidate.cells.values()])
      .find((cell) => typeof cell.raw_value === "string" && /岗位及要求一览表/u.test(cell.raw_value));
    if (!title || typeof title.raw_value !== "string") continue;
    candidates.push({
      sheet,
      header_row: row.row_number,
      headers,
      title_cell: title.coordinate,
      title_text: title.raw_value
    });
  }
  return candidates;
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
    if (!id || !target || node.attr("TargetMode") === "External") return;
    const resolved = target.startsWith("/")
      ? path.posix.normalize(target.slice(1))
      : path.posix.normalize(path.posix.join("xl", target));
    if (resolved.startsWith("xl/worksheets/") && !resolved.includes("..")) {
      targets.set(id, resolved);
    }
  });
  const sheets: Array<{ name: string; state: string; path: string }> = [];
  workbook("sheet").each((_index, element) => {
    const node = workbook(element);
    const name = node.attr("name");
    const relationshipId = node.attr("r:id");
    const target = relationshipId ? targets.get(relationshipId) : undefined;
    if (!name || !target) throw malformed("Workbook worksheet relationship is incomplete");
    sheets.push({ name, state: node.attr("state") ?? "visible", path: target });
  });
  if (sheets.length === 0) throw malformed("Workbook contains no worksheets");
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
    if (!Number.isInteger(rowNumber) || rowNumber < 1) {
      throw malformed("Worksheet row has no valid index");
    }
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
      const cell: ParsedCell = {
        coordinate,
        raw_value: decodeCellValue(cellNode, type, storageValue, sharedStrings),
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
    return Array.from(
      { length: maximum - minimum + 1 },
      (_value, index) => columnName(minimum + index)
    );
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
    if (bytes.byteLength > GUIZHOU_ATTACHMENT_MAX_RESPONSE_BYTES) {
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
    if (entries.length === 0 || entries.length > MAX_ZIP_ENTRIES) {
      throw malformed("XLSX ZIP entry count exceeds its safety boundary");
    }
    const compressed = entries.reduce((sum, entry) => sum + entry.compressed_size, 0);
    const uncompressed = entries.reduce((sum, entry) => sum + entry.uncompressed_size, 0);
    if (uncompressed > MAX_DECOMPRESSED_BYTES) {
      throw malformed("XLSX decompressed size exceeds its safety boundary");
    }
    if (entries.some((entry) => {
      const ratio = entry.uncompressed_size / Math.max(entry.compressed_size, 1);
      return entry.uncompressed_size > MAX_SINGLE_ENTRY_BYTES || ratio > MAX_EXPANSION_RATIO;
    }) || uncompressed / Math.max(compressed, 1) > MAX_EXPANSION_RATIO) {
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
  const end = findEndOfCentralDirectory(view);
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = start;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) {
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
    if (!name || names.has(name)) throw malformed("OOXML entry names must be unique");
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

function assertTraceability(input: AdapterExtractionInput): RawBlob {
  const rawBlob = input.raw_blob;
  if (input.snapshot.transport_status === "FAILED") {
    throw new AdapterExtractionError("SNAPSHOT_FAILED", "Cannot extract a failed Snapshot");
  }
  if (!rawBlob) {
    throw new AdapterExtractionError("RAW_BLOB_REQUIRED", "Successful Snapshot requires RawBlob");
  }
  if (
    input.snapshot.snapshot_id !== P2_LEGAL_05_SNAPSHOT_ID
    || input.snapshot.recruitment_endpoint_id !== input.endpoint.recruitment_endpoint_id
    || input.snapshot.raw_blob_id !== rawBlob.raw_blob_id
    || input.snapshot.content_hash !== rawBlob.raw_content_sha256
    || input.snapshot.content_length !== rawBlob.byte_length
    || rawBlob.raw_content_sha256 !== P2_LEGAL_05_RAW_SHA256
    || sha256Bytes(rawBlob.bytes) !== P2_LEGAL_05_RAW_SHA256
  ) {
    throw new AdapterExtractionError("RAW_BLOB_MISMATCH", "Snapshot/Raw provenance is not the sealed P2-LEGAL-04 capture");
  }
  if (
    normalizeMime(rawBlob.mime_type) !== GUIZHOU_ATTACHMENT_EXPECTED_MIME
    || normalizeMime(input.snapshot.response_metadata.mime_type) !== GUIZHOU_ATTACHMENT_EXPECTED_MIME
  ) {
    throw malformed("Offline adapter accepts the captured XLSX MIME only");
  }
  return rawBlob;
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

function parseRange(value: string | null) {
  if (!value) return null;
  const match = /^([A-Z]+)([1-9]\d*)(?::([A-Z]+)([1-9]\d*))?$/u.exec(value);
  if (!match) return null;
  const startColumn = columnIndex(match[1]!);
  const endColumn = columnIndex(match[3] ?? match[1]!);
  if (!startColumn || !endColumn) return null;
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

function requiredValue(field: XlsxCellEvidence) {
  if (field.raw_value === null || String(field.raw_value).trim() === "") {
    throw malformed(`Required source field missing: ${field.field_path}`);
  }
  return String(field.raw_value);
}

function textValue(field: XlsxCellEvidence) {
  return requiredValue(field);
}

function normalizeCellValue(fieldName: JobFieldName, value: ParsedCell["raw_value"]) {
  if (["organization_code", "job_code", "exam_category_code"].includes(fieldName)) {
    return value === null ? null : normalizeText(String(value));
  }
  return typeof value === "string" ? normalizeText(value) : value;
}

function normalizeText(text: string) {
  return text.normalize("NFKC").replace(/\r\n?/gu, "\n").replace(/[\t ]+/gu, " ").trim();
}

function normalized(text: string): NormalizedText {
  return {
    text: normalizeText(text),
    unicode_form: "NFKC",
    normalizer_version: `${P2_LEGAL_05_PARSER_VERSION}/text-normalizer`,
    operations: ["UNICODE_NORMALIZATION", "WIDTH_FOLDING", "WHITESPACE_FOLDING"]
  };
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

function traceable(text: string) {
  return { original: original(text) } as const;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => {
      return `${JSON.stringify(key)}:${stableSerialize(record[key])}`;
    }).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
