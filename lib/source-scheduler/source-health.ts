import type { SourceAdmission } from "../application/source-admission";
import type { CollectionRunRuntimeResult } from "../collection-runtime";
import type { SourceHealth, SourceHealthUpdateInput } from "./types";

const REVIEW_AFTER_CONSECUTIVE_FAILURES = 2;

export function initialSourceHealth(admission: SourceAdmission): SourceHealth {
  return {
    source_admission_id: admission.source_admission_id,
    recruitment_endpoint_id: admission.recruitment_endpoint_id,
    consecutive_success: 0,
    consecutive_failure: 0,
    last_success: null,
    last_failure: null,
    last_http_status: null,
    last_content_hash: null,
    structure_change_detected: false,
    robots_status: admission.robots.status,
    terms_status: admission.terms.status,
    status: hasProhibitedAccess(admission) ? "REVIEW_REQUIRED" : "HEALTHY"
  };
}

export function updateSourceHealth(input: SourceHealthUpdateInput): SourceHealth {
  const previous = input.previous ?? initialSourceHealth(input.admission);
  assertSameBinding(previous, input.admission, input.run);
  const lastHttpStatus = input.run.request_results.at(-1)?.response.http_status ?? null;
  const latestContentHash = latestSuccessfulContentHash(input.run) ?? previous.last_content_hash;
  const successful = input.run.status === "SUCCESS";
  const consecutiveFailure = successful ? 0 : previous.consecutive_failure + 1;
  const accessRisk = hasAccessRisk(input.run);
  const reviewRequired = hasProhibitedAccess(input.admission)
    || input.structure_change_detected
    || accessRisk;
  const status = reviewRequired
    ? "REVIEW_REQUIRED"
    : successful
      ? "HEALTHY"
      : consecutiveFailure >= REVIEW_AFTER_CONSECUTIVE_FAILURES
        ? "FAILED"
        : "DEGRADED";
  return {
    source_admission_id: input.admission.source_admission_id,
    recruitment_endpoint_id: input.admission.recruitment_endpoint_id,
    consecutive_success: successful ? previous.consecutive_success + 1 : 0,
    consecutive_failure: consecutiveFailure,
    last_success: successful ? input.run.completed_at : previous.last_success,
    last_failure: successful ? previous.last_failure : input.run.completed_at,
    last_http_status: lastHttpStatus,
    last_content_hash: latestContentHash,
    structure_change_detected: input.structure_change_detected,
    robots_status: input.admission.robots.status,
    terms_status: input.admission.terms.status,
    status
  };
}

export function requiresSchedulerReview(health: SourceHealth) {
  return health.status === "REVIEW_REQUIRED" || health.status === "FAILED";
}

function assertSameBinding(
  health: SourceHealth,
  admission: SourceAdmission,
  run: CollectionRunRuntimeResult
) {
  if (
    health.source_admission_id !== admission.source_admission_id
    || health.recruitment_endpoint_id !== admission.recruitment_endpoint_id
    || run.recruitment_endpoint_id !== admission.recruitment_endpoint_id
  ) {
    throw new Error("Source health, admission, and Collection Run must share one Endpoint binding");
  }
}

function latestSuccessfulContentHash(run: CollectionRunRuntimeResult) {
  return run.snapshots.filter((snapshot) => snapshot.transport_status === "SUCCESS").at(-1)?.content_hash ?? null;
}

function hasProhibitedAccess(admission: SourceAdmission) {
  return isProhibited(admission.robots.status) || isProhibited(admission.terms.status);
}

function isProhibited(status: SourceAdmission["robots"]["status"]) {
  return status === "DISALLOWED" || status === "PROHIBITED";
}

function hasAccessRisk(run: CollectionRunRuntimeResult) {
  return run.request_results.some((result) => {
    if (result.response.http_status === 403 || result.response.http_status === 404 || result.response.http_status === 429) {
      return true;
    }
    if (result.response.status !== "FAILED") return false;
    return /(?:dns|tls|certificate|captcha|login|egress)/iu.test(result.response.error.code);
  });
}
