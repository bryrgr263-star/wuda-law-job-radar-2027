import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT_ID,
  GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION
} from "../../lib/live-canary/p2-legal-01/guizhou-legal-canary-admission-preflight";
import {
  GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION,
  GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION_PREFLIGHT,
  GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT,
  GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID,
  GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
  inspectGuizhouAttachmentAdmissionPreflight
} from "../../lib/live-canary/p2-legal-03/guizhou-attachment-admission-preflight";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("attachment reuses the source definition but has an independent exact endpoint", () => {
  const preflight = GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION_PREFLIGHT;
  assert.equal(
    preflight.source_definition.source_definition_id,
    GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION.source_definition_id
  );
  assert.notEqual(GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID, GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT_ID);
  assert.equal(GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT.locator, GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL);
  assert.equal(GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT.request_method, "GET");
  assert.equal(GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT.content_kind, "FILE");
  assert.equal(GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT.enabled, false);
});

test("attachment endpoint is constrained to one item and page without redirect or retry", () => {
  const config = GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT.collection_config;
  assert.equal(config.max_items, 1);
  assert.equal(config.max_pages, 1);
  assert.equal(config.follow_redirects, false);
  assert.equal(config.retry_limit, 0);
  assert.equal(GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION.endpoint_purpose, "RECRUITMENT_ATTACHMENT");
  assert.equal(GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION.allowed_http_method, "GET");
  assert.equal(GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION.content_kind, "FILE");
});

test("attachment admission remains B REVIEW with insufficient evidence", () => {
  assert.deepEqual(inspectGuizhouAttachmentAdmissionPreflight(), {
    source_admission_valid: true,
    admission_level: "B",
    admission_decision: "REVIEW",
    automation_basis: "INSUFFICIENT_EVIDENCE",
    long_term_automation_allowed: false,
    observation_canary_requires_separate_human_approval: true,
    endpoint_executable: false,
    network_requests_performed: 0
  });
});

test("notice Snapshot proves locator provenance but is not reused as attachment capture", () => {
  const provenance = GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION_PREFLIGHT.locator_provenance;
  assert.equal(provenance.exact_locator, GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL);
  assert.equal(provenance.proves_official_notice_reference_only, true);
  assert.equal(provenance.reused_as_attachment_snapshot, false);
  assert.equal(provenance.raw_href, "./P020250210600360721175.xlsx");
  for (const evidence of GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION.evidence) {
    assert.match(evidence.source_admission_evidence_id, /^p2-legal-03-evidence:/u);
  }
  assert.deepEqual(GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION_PREFLIGHT.attachment_capture_state, {
    authorization_created: false,
    collection_run_created: false,
    evidence_captured: false,
    raw_created: false,
    snapshot_created: false,
    parsed: false
  });
});

test("unobserved access and file properties remain UNKNOWN", () => {
  const preflight = GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION_PREFLIGHT;
  assert.equal(preflight.robots_evidence.status, "UNKNOWN");
  assert.equal(preflight.terms_evidence.status, "UNKNOWN");
  assert.deepEqual(preflight.access_properties, {
    login_state: "UNKNOWN",
    captcha_state: "UNKNOWN",
    cookie_state: "UNKNOWN",
    anti_bot_state: "UNKNOWN",
    redirect_behavior: "UNKNOWN"
  });
  assert.equal(preflight.file_risk_preflight.actual_mime, "UNKNOWN");
  assert.equal(preflight.file_risk_preflight.actual_file_type, "UNKNOWN");
  assert.equal(preflight.file_risk_preflight.file_signature, "UNKNOWN");
  assert.equal(preflight.file_risk_preflight.content_length, "UNKNOWN");
});

test("notice and attachment require independent future artifacts", () => {
  const separation = GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION_PREFLIGHT.endpoint_separation;
  assert.notEqual(separation.notice_endpoint_id, separation.attachment_endpoint_id);
  assert.equal(separation.independent_authorization_required, true);
  assert.equal(separation.independent_collection_run_required, true);
  assert.equal(separation.independent_evidence_required, true);
  assert.equal(separation.independent_raw_required, true);
  assert.equal(separation.independent_snapshot_required, true);
});

test("next gate is a new exact one-endpoint observation authorization", () => {
  const gate = GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION_PREFLIGHT.next_authorization_gate;
  assert.equal(gate.required, true);
  assert.equal(gate.status, "PENDING_SEPARATE_HUMAN_APPROVAL");
  assert.deepEqual(gate.target, {
    source_admission_id: GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION.source_admission_id,
    recruitment_endpoint_id: GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID,
    locator: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
    endpoint_purpose: "RECRUITMENT_ATTACHMENT",
    method: "GET",
    content_kind: "FILE",
    authorization_mode: "OBSERVATION_CANARY",
    authorization_purpose: "OBSERVE_ACCESS_PROPERTIES",
    scope: "ONE_ENDPOINT_ONE_RUN"
  });
});

test("preflight has no network, parser, or downstream business execution", () => {
  const source = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-legal-03/guizhou-attachment-admission-preflight.ts"
  ), "utf8");
  assert.doesNotMatch(source, /from\s+["']node:(?:http|https|net|tls|dns)["']/u);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /CollectionRunner|createCollectionRun|SourceScheduler/u);
  assert.doesNotMatch(source, /RequirementFact|RequirementSet|Eligibility|CandidateProfile|CanonicalOpportunity/u);
  assert.doesNotMatch(source, /xlsx-job-table|parseWorkbook|readWorkbook/iu);
});
