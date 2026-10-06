import type { ExtractedRecord, RawBlob } from "../ingestion/domain";
import { canonicalHash, canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";

export function paginationContentFingerprint(records: readonly ExtractedRecord[]): string {
  const fields = ["raw_source_record_id", "raw_title", "raw_organization_name", "raw_location_text", "raw_description", "raw_requirement_text",
    "announcement_url", "application_url", "publish_time", "deadline", "recruitment_year", "recruitment_batch", "recruitment_context"] as const;
  const content = records.map(record => Object.fromEntries(fields.flatMap(field => record[field] === undefined ? [] : [[field, record[field]]])));
  return canonicalHash({ schema_version: "pagination-vacancy-content/1.0.0", records: content.map(canonicalSerialize).sort() });
}

export function explicitPaginationEmpty(raw: RawBlob | null, records: readonly ExtractedRecord[]): boolean {
  if (!raw || records.length || !raw.mime_type.toLowerCase().includes("json")) return false;
  try {
    const content: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw.bytes));
    return !!content && typeof content === "object" && !Array.isArray(content)
      && Object.keys(content).length === 1 && "records" in content && Array.isArray(content.records) && content.records.length === 0;
  } catch { return false; }
}
