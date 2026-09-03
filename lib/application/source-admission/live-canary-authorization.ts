import type {
  LiveCanaryAuthorizationDecision,
  LiveCanaryDenialCode,
  LiveCanaryExecutionRequest,
  LiveCanaryManualAuthorization,
  ObservationCanaryAuthorizationDecision,
  ObservationCanaryManualAuthorization,
  SourceAdmission
} from "./types";
import { evaluateSourceAutomationPermission } from "./source-admission-register";

export function evaluateLiveCanaryAuthorization(
  admission: SourceAdmission,
  execution: LiveCanaryExecutionRequest,
  authorization: LiveCanaryManualAuthorization | null
): LiveCanaryAuthorizationDecision {
  if (!authorization) {
    return denied(admission, ["NO_MANUAL_AUTHORIZATION"]);
  }
  if (!isAutomationCanaryAuthorization(authorization)) {
    return denied(admission, ["AUTHORIZATION_MODE_MISMATCH"]);
  }
  if (!hasRequiredBinding(execution, authorization)) {
    return denied(admission, ["AUTHORIZATION_BINDING_INVALID"]);
  }
  if (admission.admission_level === "C" || admission.admission_level === "D") {
    return denied(admission, ["ADMISSION_LEVEL_DENIED"]);
  }
  if (admission.admission_decision !== "APPROVED") {
    return denied(admission, ["ADMISSION_NOT_APPROVED"]);
  }
  if (!evaluateSourceAutomationPermission(admission).allowed) {
    return denied(admission, ["ADMISSION_LEVEL_DENIED"]);
  }
  if (
    execution.source_admission_id !== admission.source_admission_id
    || authorization.source_admission_id !== admission.source_admission_id
  ) {
    return denied(admission, ["AUTHORIZATION_SOURCE_MISMATCH"]);
  }
  if (
    execution.endpoint !== admission.endpoint
    || authorization.endpoint !== admission.endpoint
  ) {
    return denied(admission, ["AUTHORIZATION_ENDPOINT_MISMATCH"]);
  }
  if (
    authorization.recruitment_endpoint_id
      !== execution.recruitment_endpoint_id
    || authorization.recruitment_endpoint_id
      !== execution.recruitment_endpoint.recruitment_endpoint_id
    || authorization.recruitment_endpoint_id
      !== admission.recruitment_endpoint_id
    || execution.recruitment_endpoint.recruitment_endpoint_id
      !== admission.recruitment_endpoint_id
    || execution.recruitment_endpoint.locator !== admission.endpoint
    || execution.recruitment_endpoint.content_kind !== admission.content_kind
  ) {
    return denied(admission, ["AUTHORIZATION_ENDPOINT_REFERENCE_MISMATCH"]);
  }
  if (
    authorization.endpoint_purpose !== execution.endpoint_purpose
    || authorization.endpoint_purpose !== admission.endpoint_purpose
  ) {
    return denied(admission, ["AUTHORIZATION_ENDPOINT_PURPOSE_MISMATCH"]);
  }
  if (
    authorization.allowed_http_method !== execution.allowed_http_method
    || authorization.allowed_http_method !== admission.allowed_http_method
    || execution.recruitment_endpoint.request_method
      !== execution.allowed_http_method
  ) {
    return denied(admission, ["AUTHORIZATION_HTTP_METHOD_MISMATCH"]);
  }
  if (authorization.collection_run_id !== execution.collection_run_id) {
    return denied(admission, ["AUTHORIZATION_RUN_MISMATCH"]);
  }
  if (!admission.evidence.some((evidence) => {
    return evidence.source_admission_evidence_id === authorization.evidence_id;
  })) {
    return denied(admission, ["AUTHORIZATION_EVIDENCE_MISSING"]);
  }
  if (authorization.scope !== "ONE_ENDPOINT_ONE_RUN" || !authorization.manual_confirmation) {
    return denied(admission, ["LIVE_CANARY_SCOPE_INVALID"]);
  }
  return {
    allowed: true,
    source_admission_id: admission.source_admission_id,
    authorization
  };
}

function hasRequiredBinding(
  execution: LiveCanaryExecutionRequest,
  authorization: LiveCanaryManualAuthorization
) {
  return [
    execution.source_admission_id,
    execution.endpoint,
    execution.recruitment_endpoint_id,
    execution.recruitment_endpoint.recruitment_endpoint_id,
    execution.collection_run_id,
    authorization.authorization_id,
    authorization.source_admission_id,
    authorization.endpoint,
    authorization.recruitment_endpoint_id,
    authorization.endpoint_purpose,
    authorization.allowed_http_method,
    authorization.collection_run_id,
    authorization.reviewer,
    authorization.issued_at
  ].every((value) => value.trim().length > 0);
}

export class InMemoryLiveCanaryAuthorizationGate {
  readonly #usedAuthorizationIds = new Set<string>();

  authorize(
    admission: SourceAdmission,
    execution: LiveCanaryExecutionRequest,
    authorization: LiveCanaryManualAuthorization | null
  ): LiveCanaryAuthorizationDecision {
    const decision = evaluateLiveCanaryAuthorization(admission, execution, authorization);
    if (!decision.allowed || !authorization) return decision;
    if (this.#usedAuthorizationIds.has(authorization.authorization_id)) {
      return denied(admission, ["AUTHORIZATION_ALREADY_USED"]);
    }
    this.#usedAuthorizationIds.add(authorization.authorization_id);
    return decision;
  }
}

export function evaluateObservationCanaryAuthorization(
  admission: SourceAdmission,
  execution: LiveCanaryExecutionRequest,
  authorization: ObservationCanaryManualAuthorization | null
): ObservationCanaryAuthorizationDecision {
  if (!authorization) {
    return observationDenied(admission, ["NO_MANUAL_AUTHORIZATION"]);
  }
  if (authorization.authorization_mode !== "OBSERVATION_CANARY") {
    return observationDenied(admission, ["AUTHORIZATION_MODE_MISMATCH"]);
  }
  if (authorization.authorization_purpose !== "OBSERVE_ACCESS_PROPERTIES") {
    return observationDenied(admission, ["OBSERVATION_CANARY_PURPOSE_INVALID"]);
  }
  if (!hasRequiredObservationBinding(execution, authorization)) {
    return observationDenied(admission, ["AUTHORIZATION_BINDING_INVALID"]);
  }
  if (admission.admission_level !== "B") {
    return observationDenied(admission, ["ADMISSION_LEVEL_DENIED"]);
  }
  if (
    admission.admission_decision !== "REVIEW"
    || admission.automation_basis !== "INSUFFICIENT_EVIDENCE"
  ) {
    return observationDenied(admission, ["OBSERVATION_CANARY_ADMISSION_INVALID"]);
  }
  if (
    execution.source_admission_id !== admission.source_admission_id
    || authorization.source_admission_id !== admission.source_admission_id
  ) {
    return observationDenied(admission, ["AUTHORIZATION_SOURCE_MISMATCH"]);
  }
  if (
    execution.endpoint !== admission.endpoint
    || authorization.endpoint !== admission.endpoint
  ) {
    return observationDenied(admission, ["AUTHORIZATION_ENDPOINT_MISMATCH"]);
  }
  if (
    authorization.recruitment_endpoint_id !== execution.recruitment_endpoint_id
    || authorization.recruitment_endpoint_id
      !== execution.recruitment_endpoint.recruitment_endpoint_id
    || authorization.recruitment_endpoint_id !== admission.recruitment_endpoint_id
    || execution.recruitment_endpoint.recruitment_endpoint_id
      !== admission.recruitment_endpoint_id
    || execution.recruitment_endpoint.locator !== admission.endpoint
    || execution.recruitment_endpoint.content_kind !== admission.content_kind
    || authorization.content_kind !== admission.content_kind
  ) {
    return observationDenied(admission, ["AUTHORIZATION_ENDPOINT_REFERENCE_MISMATCH"]);
  }
  if (
    authorization.endpoint_purpose !== execution.endpoint_purpose
    || authorization.endpoint_purpose !== admission.endpoint_purpose
  ) {
    return observationDenied(admission, ["AUTHORIZATION_ENDPOINT_PURPOSE_MISMATCH"]);
  }
  if (
    authorization.allowed_http_method !== "GET"
    || authorization.allowed_http_method !== execution.allowed_http_method
    || authorization.allowed_http_method !== admission.allowed_http_method
    || execution.recruitment_endpoint.request_method !== execution.allowed_http_method
  ) {
    return observationDenied(admission, ["AUTHORIZATION_HTTP_METHOD_MISMATCH"]);
  }
  if (authorization.collection_run_id !== execution.collection_run_id) {
    return observationDenied(admission, ["AUTHORIZATION_RUN_MISMATCH"]);
  }
  if (!admission.evidence.some((evidence) => {
    return evidence.source_admission_evidence_id === authorization.evidence_id;
  })) {
    return observationDenied(admission, ["AUTHORIZATION_EVIDENCE_MISSING"]);
  }
  if (authorization.scope !== "ONE_ENDPOINT_ONE_RUN" || !authorization.manual_confirmation) {
    return observationDenied(admission, ["LIVE_CANARY_SCOPE_INVALID"]);
  }
  const config = execution.recruitment_endpoint.collection_config;
  if (
    config.max_items !== 1
    || config.max_pages !== 1
    || config.retry_limit !== 0
    || config.follow_redirects !== false
  ) {
    return observationDenied(admission, ["OBSERVATION_CANARY_REQUEST_BUDGET_INVALID"]);
  }
  return {
    allowed: true,
    source_admission_id: admission.source_admission_id,
    authorization
  };
}

export class InMemoryObservationCanaryAuthorizationGate {
  readonly #usedAuthorizationIds = new Set<string>();

  authorize(
    admission: SourceAdmission,
    execution: LiveCanaryExecutionRequest,
    authorization: ObservationCanaryManualAuthorization | null
  ): ObservationCanaryAuthorizationDecision {
    const decision = evaluateObservationCanaryAuthorization(admission, execution, authorization);
    if (!decision.allowed || !authorization) return decision;
    if (this.#usedAuthorizationIds.has(authorization.authorization_id)) {
      return observationDenied(admission, ["AUTHORIZATION_ALREADY_USED"]);
    }
    this.#usedAuthorizationIds.add(authorization.authorization_id);
    return decision;
  }
}

function hasRequiredObservationBinding(
  execution: LiveCanaryExecutionRequest,
  authorization: ObservationCanaryManualAuthorization
) {
  return [
    authorization.authorization_mode,
    authorization.authorization_purpose,
    authorization.authorization_id,
    authorization.source_admission_id,
    authorization.endpoint,
    authorization.recruitment_endpoint_id,
    authorization.endpoint_purpose,
    authorization.allowed_http_method,
    authorization.content_kind,
    authorization.collection_run_id,
    authorization.reviewer,
    authorization.issued_at,
    execution.source_admission_id,
    execution.endpoint,
    execution.recruitment_endpoint_id,
    execution.recruitment_endpoint.recruitment_endpoint_id,
    execution.collection_run_id
  ].every((value) => value.trim().length > 0);
}

function isAutomationCanaryAuthorization(authorization: LiveCanaryManualAuthorization) {
  const mode = (authorization as { readonly authorization_mode?: unknown }).authorization_mode;
  return mode === undefined || mode === "AUTOMATION_CANARY";
}

function denied(
  admission: SourceAdmission,
  reasonCodes: readonly LiveCanaryDenialCode[]
): LiveCanaryAuthorizationDecision {
  return {
    allowed: false,
    source_admission_id: admission.source_admission_id,
    reason_codes: reasonCodes
  };
}

function observationDenied(
  admission: SourceAdmission,
  reasonCodes: readonly LiveCanaryDenialCode[]
): ObservationCanaryAuthorizationDecision {
  return {
    allowed: false,
    source_admission_id: admission.source_admission_id,
    reason_codes: reasonCodes
  };
}
