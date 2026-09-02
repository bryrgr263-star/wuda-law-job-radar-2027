import type {
  LiveCanaryAuthorizationDecision,
  LiveCanaryDenialCode,
  LiveCanaryExecutionRequest,
  LiveCanaryManualAuthorization,
  SourceAdmission
} from "./types";

export function evaluateLiveCanaryAuthorization(
  admission: SourceAdmission,
  execution: LiveCanaryExecutionRequest,
  authorization: LiveCanaryManualAuthorization | null
): LiveCanaryAuthorizationDecision {
  if (!authorization) {
    return denied(admission, ["NO_MANUAL_AUTHORIZATION"]);
  }
  if (!hasRequiredBinding(execution, authorization)) {
    return denied(admission, ["AUTHORIZATION_BINDING_INVALID"]);
  }
  if (admission.admission_decision !== "APPROVED") {
    return denied(admission, ["ADMISSION_NOT_APPROVED"]);
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
    execution.collection_run_id,
    authorization.live_canary_authorization_id,
    authorization.source_admission_id,
    authorization.endpoint,
    authorization.collection_run_id,
    authorization.authorized_by,
    authorization.authorized_at
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
    if (this.#usedAuthorizationIds.has(authorization.live_canary_authorization_id)) {
      return denied(admission, ["AUTHORIZATION_ALREADY_USED"]);
    }
    this.#usedAuthorizationIds.add(authorization.live_canary_authorization_id);
    return decision;
  }
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
