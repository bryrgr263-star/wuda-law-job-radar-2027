import type { SourceAdmissionStatus } from "../application/source-admission/types";
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
