import type { CandidateProfileId, IsoDateTime } from "../../ingestion";
import {
  createRealOfficial2027TrustedRun,
  type Zhenghan2027TrustedRunReport
} from "../real-2027-zhenghan/zhenghan-2027-trusted-run";
import {
  HAIER_2027_ADAPTER_KEY,
  HAIER_2027_LEGAL_URL,
  HAIER_2027_PACKAGE_RECORD_ID,
  HAIER_2027_POSITION_RECORD_ID
} from "./haier-2027-source";

export type Haier2027TrustedRunReport = Zhenghan2027TrustedRunReport;

export function createHaier2027TrustedRun(observedAt: IsoDateTime) {
  return createRealOfficial2027TrustedRun(observedAt, {
    report_name: "Haier",
    candidate_profile_id:
      "candidate-profile:haier-2027-canary-asserted" as CandidateProfileId,
    candidate_manifest_stream_id: "haier-2027-canary-candidate-assertion",
    candidate_claim_locator: "candidate-claim://haier-2027-canary/education",
    candidate_actor: "user-approved-second-real-2027-canary",
    candidate_evidence_prefix: "haier-2027-canary",
    package_source_record_id: HAIER_2027_PACKAGE_RECORD_ID,
    position_source_record_ids: [HAIER_2027_POSITION_RECORD_ID],
    publisher_subject_identity: "organization-cn-haier-group",
    publisher_subject_display_name: "海尔集团",
    adapter_key: HAIER_2027_ADAPTER_KEY,
    source_urls: [HAIER_2027_LEGAL_URL],
    composition_version: "haier-2027-source-composition/1.0.0",
    discovery_scope: "One exact user-approved Haier 2027 legal job page",
    package_selector: ".campus_joblist_wrap",
    package_field_path: "job_page_package",
    authority_issuer: "海尔集团"
  });
}
