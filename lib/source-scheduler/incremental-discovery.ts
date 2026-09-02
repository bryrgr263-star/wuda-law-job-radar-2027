import { createHash } from "node:crypto";

import type { ExtractedRecord, Snapshot } from "../ingestion";
import type {
  IncrementalDiscoveryInput,
  IncrementalDiscoveryResult,
  IncrementalRecordDiff,
  PageSnapshotDiff,
  SnapshotRecordSet
} from "./types";

interface FingerprintedRecord {
  readonly record: ExtractedRecord;
  readonly identity_fingerprint: string | null;
  readonly content_fingerprint: string;
}

export function discoverIncrementalChanges(
  input: IncrementalDiscoveryInput
): IncrementalDiscoveryResult {
  validateRecordSet(input.current);
  if (input.previous) validateComparableRecordSets(input.previous, input.current);
  const pageDiff = comparePageSnapshots(input.previous?.snapshot ?? null, input.current.snapshot);
  if (input.current.snapshot.transport_status === "FAILED") {
    return {
      page_diff: pageDiff,
      record_diffs: [],
      missing_observation_complete: false
    };
  }

  const current = input.current.records.map((record) => fingerprint(input.current.snapshot, record));
  const previous = input.previous?.records.map((record) => fingerprint(input.previous!.snapshot, record)) ?? [];
  const currentByIdentity = groupByIdentity(current);
  const previousByIdentity = groupByIdentity(previous);
  const uncertainCurrent = current.some((record) => record.identity_fingerprint === null)
    || hasCollisions(currentByIdentity)
    || hasCollisions(previousByIdentity);
  const recordDiffs: IncrementalRecordDiff[] = [];

  for (const currentRecord of current) {
    const identity = currentRecord.identity_fingerprint;
    if (!identity) {
      recordDiffs.push(uncertain(currentRecord.record, null, "NO_STABLE_SOURCE_IDENTITY"));
      continue;
    }
    const matchingCurrent = currentByIdentity.get(identity)!;
    const matchingPrevious = previousByIdentity.get(identity) ?? [];
    if (matchingCurrent.length !== 1 || matchingPrevious.length > 1) {
      recordDiffs.push(uncertain(currentRecord.record, identity, "IDENTITY_COLLISION"));
      continue;
    }
    const previousRecord = matchingPrevious[0];
    if (!previousRecord) {
      recordDiffs.push({
        status: "NEW",
        identity_fingerprint: identity,
        content_fingerprint: currentRecord.content_fingerprint,
        previous_extracted_record_id: null,
        current_extracted_record_id: currentRecord.record.extracted_record_id,
        reason_code: null
      });
      continue;
    }
    recordDiffs.push({
      status: previousRecord.content_fingerprint === currentRecord.content_fingerprint
        ? "UNCHANGED"
        : "UPDATED",
      identity_fingerprint: identity,
      content_fingerprint: currentRecord.content_fingerprint,
      previous_extracted_record_id: previousRecord.record.extracted_record_id,
      current_extracted_record_id: currentRecord.record.extracted_record_id,
      reason_code: null
    });
  }

  const missingObservationComplete = input.previous !== null && !uncertainCurrent;
  if (missingObservationComplete) {
    for (const previousRecord of previous) {
      const identity = previousRecord.identity_fingerprint;
      if (!identity || currentByIdentity.has(identity)) continue;
      recordDiffs.push({
        status: "MISSING_OBSERVED",
        identity_fingerprint: identity,
        content_fingerprint: previousRecord.content_fingerprint,
        previous_extracted_record_id: previousRecord.record.extracted_record_id,
        current_extracted_record_id: null,
        reason_code: "ABSENT_FROM_SUCCESSFUL_CURRENT_SNAPSHOT"
      });
    }
  }

  return {
    page_diff: pageDiff,
    record_diffs: recordDiffs,
    missing_observation_complete: missingObservationComplete
  };
}

export function comparePageSnapshots(
  previous: Snapshot | null,
  current: Snapshot
): PageSnapshotDiff {
  if (!previous) {
    return {
      status: "NO_PREVIOUS",
      previous_snapshot_id: null,
      current_snapshot_id: current.snapshot_id,
      previous_content_hash: null,
      current_content_hash: current.transport_status === "SUCCESS" ? current.content_hash : null
    };
  }
  if (previous.recruitment_endpoint_id !== current.recruitment_endpoint_id) {
    throw new Error("Page Snapshot Diff requires one RecruitmentEndpoint");
  }
  if (previous.transport_status === "FAILED" || current.transport_status === "FAILED") {
    return {
      status: "CURRENT_UNAVAILABLE",
      previous_snapshot_id: previous.snapshot_id,
      current_snapshot_id: current.snapshot_id,
      previous_content_hash: previous.transport_status === "SUCCESS" ? previous.content_hash : null,
      current_content_hash: current.transport_status === "SUCCESS" ? current.content_hash : null
    };
  }
  return {
    status: previous.content_hash === current.content_hash ? "UNCHANGED" : "CHANGED",
    previous_snapshot_id: previous.snapshot_id,
    current_snapshot_id: current.snapshot_id,
    previous_content_hash: previous.content_hash,
    current_content_hash: current.content_hash
  };
}

function validateComparableRecordSets(previous: SnapshotRecordSet, current: SnapshotRecordSet) {
  validateRecordSet(previous);
  if (previous.snapshot.recruitment_endpoint_id !== current.snapshot.recruitment_endpoint_id) {
    throw new Error("Incremental discovery requires snapshots from one RecruitmentEndpoint");
  }
  const previousSource = previous.records[0]?.source_definition_id;
  const currentSource = current.records[0]?.source_definition_id;
  if (previousSource && currentSource && previousSource !== currentSource) {
    throw new Error("Incremental discovery requires records from one SourceDefinition");
  }
}

function validateRecordSet(recordSet: SnapshotRecordSet) {
  if (recordSet.snapshot.transport_status === "FAILED" && recordSet.records.length > 0) {
    throw new Error("A failed Snapshot cannot provide ExtractedRecords");
  }
  for (const record of recordSet.records) {
    if (record.snapshot_id !== recordSet.snapshot.snapshot_id) {
      throw new Error("ExtractedRecord must reference the compared Snapshot");
    }
  }
}

function fingerprint(snapshot: Snapshot, record: ExtractedRecord): FingerprintedRecord {
  return {
    record,
    identity_fingerprint: identityFingerprint(snapshot, record),
    content_fingerprint: contentFingerprint(record)
  };
}

function identityFingerprint(snapshot: Snapshot, record: ExtractedRecord) {
  const announcementLocator = normalizeLocator(
    record.announcement_url
      ?? record.identity_candidates.find((candidate) => {
        return candidate.kind === "ANNOUNCEMENT_URL" && candidate.confidence === "HIGH";
      })?.value
  );
  if (announcementLocator) {
    return sha256(stableSerialize({
      recruitment_endpoint_id: snapshot.recruitment_endpoint_id,
      source_definition_id: record.source_definition_id,
      kind: "DETAIL_LOCATOR",
      value: announcementLocator
    }));
  }
  const sourceRecordId = record.raw_source_record_id
    ?? record.identity_candidates.find((candidate) => {
      return candidate.kind === "SOURCE_RECORD_ID" && candidate.confidence === "HIGH";
    })?.value;
  if (!sourceRecordId?.trim()) return null;
  return sha256(stableSerialize({
    recruitment_endpoint_id: snapshot.recruitment_endpoint_id,
    source_definition_id: record.source_definition_id,
    kind: "SOURCE_RECORD_ID",
    value: sourceRecordId.trim()
  }));
}

function contentFingerprint(record: ExtractedRecord) {
  return sha256(stableSerialize({
    title: textValue(record.raw_title),
    organization: textValue(record.raw_organization_name),
    locations: record.raw_location_text.map((value) => canonicalText(value.text)).sort(),
    description: textValue(record.raw_description),
    requirement_text: textValue(record.raw_requirement_text),
    application_url: normalizeLocator(record.application_url),
    deadline: textValue(record.deadline),
    recruitment_year: textValue(record.recruitment_year),
    recruitment_batch: textValue(record.recruitment_batch)
  }));
}

function groupByIdentity(records: readonly FingerprintedRecord[]) {
  const groups = new Map<string, FingerprintedRecord[]>();
  for (const record of records) {
    if (!record.identity_fingerprint) continue;
    const group = groups.get(record.identity_fingerprint) ?? [];
    group.push(record);
    groups.set(record.identity_fingerprint, group);
  }
  return groups;
}

function hasCollisions(groups: ReadonlyMap<string, readonly FingerprintedRecord[]>) {
  return [...groups.values()].some((records) => records.length > 1);
}

function uncertain(
  record: ExtractedRecord,
  identityFingerprintValue: string | null,
  reasonCode: string
): IncrementalRecordDiff {
  return {
    status: "IDENTITY_UNCERTAIN",
    identity_fingerprint: identityFingerprintValue,
    content_fingerprint: contentFingerprint(record),
    previous_extracted_record_id: null,
    current_extracted_record_id: record.extracted_record_id,
    reason_code: reasonCode
  };
}

function normalizeLocator(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:")
      || url.username
      || url.password
    ) {
      return null;
    }
    url.hash = "";
    url.searchParams.sort();
    return url.href;
  } catch {
    return null;
  }
}

function textValue(value: ExtractedRecord["raw_title"]) {
  return value ? canonicalText(value.text) : null;
}

function canonicalText(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
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
