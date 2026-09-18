import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  GUIZHOU_LEGAL_CANARY_ADMISSION_PREFLIGHT,
  GUIZHOU_LEGAL_CANARY_NOTICE_ADMISSION,
  GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT,
  GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT_ID,
  GUIZHOU_LEGAL_CANARY_NOTICE_URL,
  GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION,
  GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID,
  inspectGuizhouLegalCanaryAdmissionPreflight
} from "../../lib/live-canary/p2-legal-01/guizhou-legal-canary-admission-preflight";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("preflight binds the official source to the exact notice endpoint", () => {
  assert.equal(GUIZHOU_LEGAL_CANARY_ADMISSION_PREFLIGHT.official_domain, "rst.guizhou.gov.cn");
  assert.equal(
    GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION.source_definition_id,
    GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID
  );
  assert.equal(GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION.authority_level, "OFFICIAL");
  assert.equal(GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION.publisher_kind, "GOVERNMENT_PORTAL");
  assert.equal(GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION.enabled, false);
  assert.equal(
    GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT.recruitment_endpoint_id,
    GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT_ID
  );
  assert.equal(
    GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT.source_definition_id,
    GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID
  );
  assert.equal(GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT.locator, GUIZHOU_LEGAL_CANARY_NOTICE_URL);
});

test("notice endpoint is disabled and constrained to one GET without redirects or retries", () => {
  const endpoint = GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT;
  assert.equal(endpoint.request_method, "GET");
  assert.equal(endpoint.content_kind, "HTML");
  assert.equal(endpoint.collection_config.max_items, 1);
  assert.equal(endpoint.collection_config.max_pages, 1);
  assert.equal(endpoint.collection_config.follow_redirects, false);
  assert.equal(endpoint.collection_config.retry_limit, 0);
  assert.equal(endpoint.enabled, false);

  const admission = GUIZHOU_LEGAL_CANARY_NOTICE_ADMISSION;
  assert.equal(admission.endpoint, GUIZHOU_LEGAL_CANARY_NOTICE_URL);
  assert.equal(admission.recruitment_endpoint_id, GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT_ID);
  assert.equal(admission.endpoint_purpose, "RECRUITMENT_NOTICE");
  assert.equal(admission.allowed_http_method, "GET");
  assert.equal(admission.content_kind, "HTML");
});

test("admission remains B REVIEW with insufficient evidence", () => {
  const admission = GUIZHOU_LEGAL_CANARY_NOTICE_ADMISSION;
  assert.equal(admission.admission_level, "B");
  assert.equal(admission.admission_decision, "REVIEW");
  assert.equal(admission.automation_basis, "INSUFFICIENT_EVIDENCE");

  assert.deepEqual(inspectGuizhouLegalCanaryAdmissionPreflight(), {
    source_admission_valid: true,
    admission_level: "B",
    admission_decision: "REVIEW",
    automation_basis: "INSUFFICIENT_EVIDENCE",
    long_term_automation_allowed: false,
    observation_canary_requires_separate_human_approval: true,
    endpoint_executable: false,
    attachment_endpoint_created: false,
    network_requests_performed: 0
  });
});

test("all unobserved access properties stay UNKNOWN", () => {
  const preflight = GUIZHOU_LEGAL_CANARY_ADMISSION_PREFLIGHT;
  assert.equal(preflight.robots_evidence.status, "UNKNOWN");
  assert.equal(preflight.robots_evidence.network_observed, false);
  assert.equal(preflight.terms_evidence.status, "UNKNOWN");
  assert.equal(preflight.terms_evidence.network_observed, false);
  assert.deepEqual(preflight.access_properties, {
    login_state: "UNKNOWN",
    captcha_state: "UNKNOWN",
    cookie_state: "UNKNOWN",
    authorization_state: "NOT_CREATED",
    anti_bot_state: "UNKNOWN",
    redirect_behavior: "UNKNOWN"
  });
});

test("network and redirect policies cannot execute during preflight", () => {
  const { network_policy: network, redirect_policy: redirect } =
    GUIZHOU_LEGAL_CANARY_ADMISSION_PREFLIGHT;
  assert.equal(network.mode, "NO_NETWORK_PREFLIGHT");
  assert.equal(network.requests_performed, 0);
  assert.equal(network.exact_endpoint_only, true);
  assert.equal(network.allowed_method, "GET");
  assert.equal(network.request_budget_after_separate_approval, 1);
  assert.equal(network.retry_limit, 0);
  assert.equal(network.send_cookie, false);
  assert.equal(network.send_authorization_header, false);
  assert.equal(network.use_proxy_bypass, false);
  assert.equal(network.use_browser_automation, false);
  assert.equal(redirect.follow_redirects, false);
  assert.equal(redirect.on_redirect, "STOP_AND_REVIEW");
});

test("unknown XLSX locator does not create or guess an attachment endpoint", () => {
  const attachment = GUIZHOU_LEGAL_CANARY_ADMISSION_PREFLIGHT.attachment_candidate;
  assert.equal(attachment.expected_file_type, "XLSX");
  assert.equal(attachment.locator, null);
  assert.equal(attachment.endpoint_created, false);
  assert.equal(attachment.status, "EXACT_LOCATOR_PENDING_NOTICE_OBSERVATION");
});

test("the only next gate is a separately approved exact observation canary", () => {
  const gate = GUIZHOU_LEGAL_CANARY_ADMISSION_PREFLIGHT.next_authorization_gate;
  assert.equal(gate.required, true);
  assert.equal(gate.status, "PENDING_SEPARATE_HUMAN_APPROVAL");
  assert.deepEqual(gate.target, {
    source_admission_id: GUIZHOU_LEGAL_CANARY_NOTICE_ADMISSION.source_admission_id,
    recruitment_endpoint_id: GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT_ID,
    locator: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
    endpoint_purpose: "RECRUITMENT_NOTICE",
    method: "GET",
    content_kind: "HTML",
    authorization_mode: "OBSERVATION_CANARY",
    authorization_purpose: "OBSERVE_ACCESS_PROPERTIES",
    scope: "ONE_ENDPOINT_ONE_RUN"
  });
  const serialized = JSON.stringify(GUIZHOU_LEGAL_CANARY_ADMISSION_PREFLIGHT);
  assert.doesNotMatch(serialized, /authorization_id|collection_run_id/u);
});

test("preflight source contains no network, scheduler, requirement, or eligibility execution", () => {
  const sourcePath = path.join(
    repositoryRoot,
    "lib",
    "live-canary",
    "p2-legal-01",
    "guizhou-legal-canary-admission-preflight.ts"
  );
  const source = readFileSync(sourcePath, "utf8");
  assert.doesNotMatch(source, /from\s+["']node:(?:http|https|net|tls|dns)["']/u);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /CollectionRunner|createCollectionRun|SourceScheduler/u);
  assert.doesNotMatch(source, /RequirementFact|RequirementSet|EligibilityAssessment/u);
});
