import type {
  LiveCanaryAuthorizationDecision,
  LiveCanaryDenialCode,
  LiveCanaryManualAuthorization,
  SourceAdmission
} from "./types";

export function evaluateLiveCanaryAuthorization(
  admission: SourceAdmission,
  authorization: LiveCanaryManualAuthorization | null
): LiveCanaryAuthorizationDecision {
  if (!authorization) {
    return denied(admission, ["NO_MANUAL_AUTHORIZATION"]);
  }
  if (admission.admission_decision !== "APPROVED") {
    return denied(admission, ["ADMISSION_NOT_APPROVED"]);
  }
  if (authorization.source_admission_id !== admission.source_admission_id) {
    return denied(admission, ["AUTHORIZATION_TARGET_MISMATCH"]);
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
