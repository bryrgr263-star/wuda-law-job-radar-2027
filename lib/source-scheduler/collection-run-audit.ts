import type { CollectionRunRuntimeResult } from "../collection-runtime";
import type { SourceSchedule, CollectionRunAuditView } from "./types";

export function summarizeCollectionRun(
  schedule: SourceSchedule,
  run: CollectionRunRuntimeResult
): CollectionRunAuditView {
  if (run.recruitment_endpoint_id !== schedule.recruitment_endpoint_id) {
    throw new Error("Collection Run must belong to the scheduled RecruitmentEndpoint");
  }
  const transportErrors = run.request_results.flatMap((result) => {
    return result.response.status === "FAILED" ? [result.response.error.code] : [];
  });
  return {
    collection_run_id: run.collection_run_id,
    source_admission_id: schedule.source_admission_id,
    recruitment_endpoint_id: schedule.recruitment_endpoint_id,
    started_at: run.started_at,
    completed_at: run.completed_at,
    status: run.status,
    request_count: run.requests_made,
    page_count: run.pages_collected,
    bytes: run.raw_blobs.reduce((total, rawBlob) => total + rawBlob.byte_length, 0),
    retry_count: run.request_results.filter((result) => result.attempt > 0).length,
    error_classifications: [...new Set([...run.reason_codes, ...transportErrors])].sort()
  };
}
