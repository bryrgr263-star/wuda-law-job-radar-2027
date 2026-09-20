import { createHash } from "node:crypto";

import type { CollectionRequestResult, CollectionRunRuntimeResult } from "../collection-runtime";
import { SourceRunMissingGuard, type EmptyResultValidation, type SourceRunAssessment, type SourceRunId } from "../ingestion";
import type { ContentKind } from "../ingestion/domain/source";
import type { SourceExecutionStatus } from "./source-execution-outcome";

export interface PriorVerifiedSourceContent {
  readonly source_execution_id: string;
  readonly requests: readonly { readonly locator: string; readonly raw_hash: string }[];
}

export interface TrustedAcquisitionClassification {
  readonly status: SourceExecutionStatus;
  readonly assessment: SourceRunAssessment | null;
  readonly empty_validation: EmptyResultValidation | null;
  readonly prior_source_execution_id: string | null;
  readonly raw_content_hashes: readonly string[];
}

export type TrustedAcquisitionObservation = Pick<CollectionRunRuntimeResult,
  "collection_run_id" | "source_definition_id" | "recruitment_endpoint_id" | "started_at" |
  "completed_at" | "status" | "reason_codes" | "snapshots" | "raw_blobs" |
  "extracted_records" | "pages_collected" | "requests_made"> & {
  readonly request_results: readonly Pick<CollectionRequestResult,
    "request" | "response" | "snapshot" | "raw_blob">[];
};

export function classifyTrustedAcquisition(input: {
  readonly collection: TrustedAcquisitionObservation;
  readonly previous: PriorVerifiedSourceContent | null;
  readonly content_kind: ContentKind;
}): TrustedAcquisitionClassification {
  const { collection, previous } = input;
  const rawHashes = collection.request_results.flatMap(result => result.raw_blob
    ? [result.raw_blob.raw_content_sha256] : []);
  const base = { assessment: null, empty_validation: null,
    prior_source_execution_id: previous?.source_execution_id ?? null,
    raw_content_hashes: rawHashes };
  if (collection.status === "FAILED" || collection.status === "PARTIAL") {
    return { ...base, status: collection.status === "FAILED" && collection.extracted_records.length > 0
      ? "PARTIAL" : collection.status };
  }
  const unchanged = collection.status === "SUCCESS" && previous !== null
    && previous.requests.length === collection.request_results.length
    && collection.request_results.every((result, index) => {
      const prior = previous.requests[index];
      return result.response.status === "SUCCESS" && result.raw_blob !== null
        && result.request.locator === prior?.locator
        && result.raw_blob.raw_content_sha256 === prior.raw_hash
        && hashBytes(result.raw_blob.bytes) === prior.raw_hash;
    });
  if (unchanged) {
    const assessment = new SourceRunMissingGuard().assessRun({
      source_run_id: collection.collection_run_id as SourceRunId,
      source_definition_id: collection.source_definition_id as never,
      recruitment_endpoint_id: collection.recruitment_endpoint_id as never,
      started_at: collection.started_at, completed_at: collection.completed_at,
      snapshots: collection.snapshots,
      collection_completeness: { status: "COMPLETE", reason_codes: collection.reason_codes },
      observed_source_occurrence_ids: [], not_modified: true
    });
    return { ...base, status: assessment.status, assessment };
  }
  if (collection.status === "SUCCESS") return { ...base, status: "SUCCESS" };

  const emptyValidation = proveClosedOfficialJsonEmpty(collection, input.content_kind, previous);
  const assessment = new SourceRunMissingGuard().assessRun({
    source_run_id: collection.collection_run_id as SourceRunId,
    source_definition_id: collection.source_definition_id as never,
    recruitment_endpoint_id: collection.recruitment_endpoint_id as never,
    started_at: collection.started_at, completed_at: collection.completed_at,
    snapshots: collection.snapshots,
    collection_completeness: { status: "SUSPICIOUS_EMPTY", reason_codes: collection.reason_codes },
    observed_source_occurrence_ids: [], not_modified: false,
    ...(emptyValidation ? { empty_result_validation: emptyValidation } : {})
  });
  return { ...base, status: assessment.status, assessment,
    empty_validation: emptyValidation };
}

function proveClosedOfficialJsonEmpty(
  collection: TrustedAcquisitionObservation,
  contentKind: ContentKind,
  previous: PriorVerifiedSourceContent | null
): EmptyResultValidation | null {
  if (contentKind !== "JSON" || collection.request_results.length !== 1
    || collection.pages_collected !== 1 || collection.requests_made !== 1
    || collection.reason_codes.some(code => code !== "ZERO_EXTRACTED_RECORDS")) return null;
  const result = collection.request_results[0]!;
  if (result.response.status !== "SUCCESS" || !result.raw_blob
    || !result.raw_blob.mime_type.toLowerCase().includes("json")
    || hashBytes(result.raw_blob.bytes) !== result.raw_blob.raw_content_sha256) return null;
  if (!isClosedOfficialJsonEmpty(result.raw_blob.bytes)) return null;
  return {
    response_structure_valid: true, pagination_complete: true,
    explicit_empty_signal: true, official_result_count: 0,
    authentication_wall_detected: false, captcha_detected: false,
    error_page_detected: false, structure_drift_detected: false,
    historical_comparison: previous ? "CONSISTENT" : "UNAVAILABLE"
  };
}

export function isClosedOfficialJsonEmpty(bytes: Uint8Array) {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return false; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const response = parsed as Record<string, unknown>;
  return Object.keys(response).sort().join(",") === "jobs,next,total"
    && Array.isArray(response.jobs) && response.jobs.length === 0
    && response.total === 0 && response.next === null;
}

function hashBytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
