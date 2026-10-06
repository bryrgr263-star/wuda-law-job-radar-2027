import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import type { SourceAdmission } from "../../lib/application/source-admission/types";
import { validateDiscoveryAdmissionDraft } from "../../lib/source-discovery/admission-proposal";
import { createDiscoveryRecord } from "../../lib/source-discovery/contracts";

test("existing Source Admission validates review drafts but discovery cannot approve or grant", () => {
  const endpoint = "https://example.org/careers";
  const candidate = createDiscoveryRecord("CANDIDATE", "discovery:review", { recruitment_entry_url: endpoint });
  const draft = {
    source_admission_id: "fixture-admission", admission_level: "C", automation_basis: "INSUFFICIENT_EVIDENCE",
    source_name: { original: { text: "Unverified recruitment", encoding: "UTF-8" } },
    official_owner: { original: { text: "Unknown owner claim", encoding: "UTF-8" } },
    source_type: "OFFICIAL_RECRUITMENT_PAGE", endpoint, recruitment_endpoint_id: "fixture-endpoint",
    endpoint_purpose: "JOB_LIST", allowed_http_method: "GET", content_kind: "HTML", source_authority: "OFFICIAL",
    robots: { status: "UNKNOWN", evidence_id: "robots" }, terms: { status: "UNKNOWN", evidence_id: "terms" },
    login_requirement: "UNKNOWN", captcha: "UNKNOWN", structure: "UNKNOWN", stability: "UNKNOWN",
    update_frequency: "UNKNOWN", priority: "LOW", prohibited_actions: [],
    evidence: ["ROBOTS", "TERMS"].map(kind => ({ source_admission_evidence_id: kind.toLowerCase(),
      source_admission_id: "fixture-admission", endpoint, source_url: endpoint, kind,
      locator: `fixture:${kind}:NOT_OBSERVED`, captured_at: "2026-10-06T00:00:00.000Z", reviewer: "TEST_ONLY",
      decision: "UNKNOWN", summary: { text: "Not observed, no access permission established", encoding: "UTF-8" } })),
    review_records: [{ source_admission_review_id: "review", reviewer: "TEST_ONLY", reviewed_at: "2026-10-06T00:00:00.000Z",
      decision: "REVIEW", rationale: { text: "Unverified candidate requires review", encoding: "UTF-8" }, evidence_ids: ["robots", "terms"] }],
    admission_decision: "REVIEW"
  } as unknown as SourceAdmission;
  const proposal = validateDiscoveryAdmissionDraft(candidate, draft);
  assert.equal(proposal.production_activation, false);
  assert.equal(proposal.existing_validator, "validateSourceAdmission");
  assert.throws(() => validateDiscoveryAdmissionDraft(candidate, { ...draft, admission_decision: "APPROVED" }), /REVIEW_ONLY/);
  assert.throws(() => validateDiscoveryAdmissionDraft(candidate, { ...draft, allowed_http_method: "POST" as never }), /only permits GET/);
  assert.throws(() => validateDiscoveryAdmissionDraft(candidate, { ...draft, source_type: "THIRD_PARTY_PLATFORM" }), /Third-party/);
});
