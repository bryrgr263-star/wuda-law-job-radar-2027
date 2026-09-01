import type {
  ExtractedRecord,
  ExtractedRecordId,
  OpportunityContent,
  SnapshotId,
  SourceDefinitionId
} from "../domain";
import {
  normalizeLocationName,
  normalizeTraceableText,
  normalizeUrl,
  parseDeterministicDate,
  parseRecruitmentYear
} from "./text-normalizer";

export interface NormalizedSourceRecord {
  readonly extracted_record_id: ExtractedRecordId;
  readonly snapshot_id: SnapshotId;
  readonly source_definition_id: SourceDefinitionId;
  readonly raw_source_record_id?: string;
  readonly content: OpportunityContent;
}

export class SourceNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceNormalizationError";
  }
}

export function normalizeExtractedRecord(record: ExtractedRecord): NormalizedSourceRecord {
  if (!record.raw_organization_name) {
    throw new SourceNormalizationError("ExtractedRecord requires raw_organization_name");
  }
  if (!record.raw_title) {
    throw new SourceNormalizationError("ExtractedRecord requires raw_title");
  }

  const deadline = parseDeterministicDate(record.deadline);
  const content: OpportunityContent = {
    organization: {
      name: normalizeTraceableText(record.raw_organization_name)
    },
    title: normalizeTraceableText(record.raw_title),
    description: record.raw_description
      ? normalizeTraceableText(record.raw_description)
      : undefined,
    requirement_text: record.raw_requirement_text
      ? normalizeTraceableText(record.raw_requirement_text)
      : undefined,
    locations: record.raw_location_text
      .map((location) => ({
        city: normalizeLocationName(location.text),
        raw_text: location,
        is_nationwide: normalizeLocationName(location.text) === "全国",
        normalization_confidence: 1
      }))
      .sort((left, right) => (left.city ?? "").localeCompare(right.city ?? "", "zh-CN")),
    recruitment_year: parseRecruitmentYear(record.recruitment_year),
    recruitment_batch: record.recruitment_batch
      ? normalizeTraceableText(record.recruitment_batch)
      : undefined,
    published_on: parseDeterministicDate(record.publish_time),
    application_window: record.deadline
      ? { closes_on: deadline, raw_text: record.deadline }
      : undefined,
    announcement_locator: record.announcement_url
      ? normalizeUrl(record.announcement_url)
      : undefined,
    application_locator: record.application_url
      ? normalizeUrl(record.application_url)
      : undefined
  };

  return {
    extracted_record_id: record.extracted_record_id,
    snapshot_id: record.snapshot_id,
    source_definition_id: record.source_definition_id,
    raw_source_record_id: record.raw_source_record_id
      ?? record.identity_candidates.find((candidate) => {
        return candidate.kind === "SOURCE_RECORD_ID" && candidate.confidence === "HIGH";
      })?.value,
    content
  };
}
