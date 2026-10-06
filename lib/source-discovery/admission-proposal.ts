import type { SourceAdmission, SourceAdmissionStatus } from "../application/source-admission/types";
import { validateSourceAdmission } from "../application/source-admission/source-admission-register";
import { verifyDiscoveryRecord, type DiscoveryRecord } from "./contracts";

export function prepareAdmissionProposal(candidate: DiscoveryRecord): {
  candidate_record_id: string; candidate_integrity_hash: string;
  proposed_review_status: SourceAdmissionStatus; disposition: "REVIEW_REQUIRED";
  production_activation: false; reason: string;
} {
  verifyDiscoveryRecord(candidate);
  if (candidate.kind !== "CANDIDATE") throw new Error("CANDIDATE_REQUIRED");
  return {
    candidate_record_id: candidate.record_id, candidate_integrity_hash: candidate.integrity_hash,
    proposed_review_status: "REVIEW", disposition: "REVIEW_REQUIRED", production_activation: false,
    reason: "UNTRUSTED_DISCOVERY_REQUIRES_EXISTING_SOURCE_ADMISSION_REVIEW"
  };
}

export function validateDiscoveryAdmissionDraft(candidate: DiscoveryRecord, draft: SourceAdmission) {
  const proposal = prepareAdmissionProposal(candidate);
  if (draft.admission_decision !== "REVIEW" || draft.continuous_acquisition_scope
    || draft.review_records.some(review => review.decision !== "REVIEW")
    || draft.automation_basis !== "INSUFFICIENT_EVIDENCE"
    || draft.endpoint !== candidate.payload.recruitment_entry_url) throw new Error("DISCOVERY_REVIEW_ONLY");
  validateSourceAdmission(draft);
  return { ...proposal, existing_validator: "validateSourceAdmission", validated_review_draft: structuredClone(draft) };
}
