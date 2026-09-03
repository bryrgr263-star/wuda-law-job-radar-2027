import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateLiveCanaryAuthorization,
  evaluateObservationCanaryAuthorization,
  evaluateSourceAutomationPermission,
  InMemoryLiveCanaryAuthorizationGate,
  InMemoryObservationCanaryAuthorizationGate,
  InMemorySourceAdmissionRegister,
  SOURCE_PROHIBITED_ACTIONS,
  SourceAdmissionError,
  type LiveCanaryExecutionRequest,
  type LiveCanaryManualAuthorization,
  type ObservationCanaryManualAuthorization,
  type SourceAdmission,
  type SourceAdmissionEvidenceId,
  type SourceAdmissionId
} from "../../lib/application";
import {
  UTF8_TEXT_ENCODING,
  type RecruitmentEndpoint
} from "../../lib/ingestion";

function branded<Value extends string>(value: string) {
  return value as Value;
}

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}

function reviewAdmission(): SourceAdmission {
  const sourceAdmissionId = branded<SourceAdmissionId>("admission-observation-attachment");
  const robotsEvidenceId = branded<SourceAdmissionEvidenceId>("evidence-observation-robots");
  const termsEvidenceId = branded<SourceAdmissionEvidenceId>("evidence-observation-terms");
  const reviewEvidenceId = branded<SourceAdmissionEvidenceId>("evidence-observation-review");
  const attachmentEndpoint = "https://example.invalid/careers/position-table.xlsx";
  const evidence = [
    {
      source_admission_evidence_id: robotsEvidenceId,
      source_admission_id: sourceAdmissionId,
      endpoint: attachmentEndpoint,
      source_url: "https://example.invalid/robots.txt",
      kind: "ROBOTS",
      locator: "https://example.invalid/robots.txt",
      captured_at: "2026-09-05T09:00:00+08:00",
      reviewer: "observation-reviewer",
      decision: "UNKNOWN",
      summary: original("附件路径的 robots 访问属性尚未观察。")
    },
    {
      source_admission_evidence_id: termsEvidenceId,
      source_admission_id: sourceAdmissionId,
      endpoint: attachmentEndpoint,
      source_url: "https://example.invalid/",
      kind: "TERMS",
      locator: "https://example.invalid/",
      captured_at: "2026-09-05T09:00:00+08:00",
      reviewer: "observation-reviewer",
      decision: "UNKNOWN",
      summary: original("附件 Endpoint 的自动化访问条款尚未观察。")
    },
    {
      source_admission_evidence_id: reviewEvidenceId,
      source_admission_id: sourceAdmissionId,
      endpoint: attachmentEndpoint,
      source_url: "https://example.invalid/careers/notice.html",
      kind: "MANUAL_REVIEW",
      locator: "snapshot://detail/attachment-reference",
      captured_at: "2026-09-05T09:00:00+08:00",
      reviewer: "observation-reviewer",
      decision: "UNKNOWN",
      summary: original("官方公告引用附件，但附件访问属性仍需一次性观察。")
    }
  ] as const;
  return {
    source_admission_id: sourceAdmissionId,
    admission_level: "B",
    automation_basis: "INSUFFICIENT_EVIDENCE",
    source_name: traceable("官方招聘职位及要求表"),
    source_type: "OFFICIAL_RECRUITMENT_PAGE",
    official_owner: traceable("官方单位"),
    endpoint: attachmentEndpoint,
    recruitment_endpoint_id: branded("endpoint-observation-attachment"),
    endpoint_purpose: "RECRUITMENT_ATTACHMENT",
    allowed_http_method: "GET",
    content_kind: "FILE",
    source_authority: "OFFICIAL",
    robots: { status: "UNKNOWN", evidence_id: robotsEvidenceId },
    terms: { status: "UNKNOWN", evidence_id: termsEvidenceId },
    login_requirement: "UNKNOWN",
    captcha: "UNKNOWN",
    structure: "DOCUMENT",
    stability: "UNKNOWN",
    update_frequency: "UNKNOWN",
    priority: "HIGH",
    prohibited_actions: SOURCE_PROHIBITED_ACTIONS,
    evidence,
    review_records: [{
      source_admission_review_id: branded("review-observation-attachment"),
      reviewer: "observation-reviewer",
      reviewed_at: "2026-09-05T09:05:00+08:00",
      decision: "REVIEW",
      rationale: original("访问属性 UNKNOWN，仅允许人工一次性 Observation Canary。"),
      evidence_ids: [robotsEvidenceId, termsEvidenceId, reviewEvidenceId]
    }],
    admission_decision: "REVIEW"
  };
}

function endpoint(
  source: SourceAdmission,
  collectionConfig: RecruitmentEndpoint["collection_config"] = {
    timeout_ms: 5_000,
    max_items: 1,
    max_pages: 1,
    follow_redirects: false,
    retry_limit: 0
  }
): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: source.recruitment_endpoint_id,
    source_definition_id: branded("source-observation-test"),
    name: traceable("一次性访问属性观察 Endpoint"),
    coverage_regions: [],
    locator: source.endpoint,
    request_method: "GET",
    content_kind: source.content_kind,
    adapter_key: "observation-canary-no-adapter",
    decoded_text_encoding: UTF8_TEXT_ENCODING,
    collection_config: collectionConfig,
    enabled: false
  };
}

function execution(
  source: SourceAdmission,
  overrides: Partial<LiveCanaryExecutionRequest> = {}
): LiveCanaryExecutionRequest {
  return {
    source_admission_id: source.source_admission_id,
    endpoint: source.endpoint,
    recruitment_endpoint_id: source.recruitment_endpoint_id,
    recruitment_endpoint: endpoint(source),
    endpoint_purpose: source.endpoint_purpose,
    allowed_http_method: "GET",
    collection_run_id: branded("observation-run-once"),
    ...overrides
  };
}

function authorization(
  source: SourceAdmission,
  overrides: Partial<ObservationCanaryManualAuthorization> = {}
): ObservationCanaryManualAuthorization {
  return {
    authorization_mode: "OBSERVATION_CANARY",
    authorization_purpose: "OBSERVE_ACCESS_PROPERTIES",
    authorization_id: branded("observation-authorization-once"),
    source_admission_id: source.source_admission_id,
    endpoint: source.endpoint,
    recruitment_endpoint_id: source.recruitment_endpoint_id,
    endpoint_purpose: source.endpoint_purpose,
    allowed_http_method: "GET",
    content_kind: source.content_kind,
    collection_run_id: branded("observation-run-once"),
    reviewer: "human-observation-reviewer",
    issued_at: "2026-09-05T10:00:00+08:00",
    evidence_id: source.evidence[2].source_admission_evidence_id,
    scope: "ONE_ENDPOINT_ONE_RUN",
    manual_confirmation: true,
    ...overrides
  };
}

function approvedAdmission(): SourceAdmission {
  const review = reviewAdmission();
  return {
    ...review,
    admission_decision: "APPROVED",
    automation_basis: "HUMAN_REVIEWED_CANARY",
    login_requirement: "NONE",
    captcha: "NONE_OBSERVED",
    review_records: [{
      ...review.review_records[0],
      decision: "APPROVED"
    }]
  };
}

test("B review with insufficient evidence can use one Observation Canary without upgrading", () => {
  const register = new InMemorySourceAdmissionRegister();
  const source = register.register(reviewAdmission());
  const signed = authorization(source);
  const gate = new InMemoryObservationCanaryAuthorizationGate();

  const first = gate.authorize(source, execution(source), signed);
  assert.equal(first.allowed, true);
  assert.equal(register.get(source.source_admission_id).admission_decision, "REVIEW");
  assert.equal(register.get(source.source_admission_id).automation_basis, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(evaluateSourceAutomationPermission(source), {
    allowed: false,
    admission_level: "B",
    mode: "DENIED"
  });
  const replay = gate.authorize(source, execution(source), signed);
  assert.equal(replay.allowed, false);
  if (!replay.allowed) assert.deepEqual(replay.reason_codes, ["AUTHORIZATION_ALREADY_USED"]);
});

test("Observation Canary rejects approved B with unknown access signals", () => {
  const review = reviewAdmission();
  const invalidApproved = {
    ...review,
    admission_decision: "APPROVED",
    automation_basis: "HUMAN_REVIEWED_CANARY",
    review_records: [{
      ...review.review_records[0],
      decision: "APPROVED"
    }]
  } as const satisfies SourceAdmission;
  assert.throws(
    () => new InMemorySourceAdmissionRegister().register(invalidApproved),
    SourceAdmissionError
  );
  const decision = evaluateObservationCanaryAuthorization(
    invalidApproved,
    execution(invalidApproved),
    authorization(invalidApproved)
  );
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.deepEqual(decision.reason_codes, ["OBSERVATION_CANARY_ADMISSION_INVALID"]);
  }
});

test("Observation Canary rejects C and D admissions", () => {
  const review = reviewAdmission();
  for (const source of [
    { ...review, admission_level: "C" },
    { ...review, admission_level: "D" }
  ] as const satisfies readonly SourceAdmission[]) {
    const decision = evaluateObservationCanaryAuthorization(
      source,
      execution(source),
      authorization(source)
    );
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.deepEqual(decision.reason_codes, ["ADMISSION_LEVEL_DENIED"]);
  }
});

test("Observation Canary requires manual confirmation and an exact non-empty binding", () => {
  const source = reviewAdmission();
  const missing = evaluateObservationCanaryAuthorization(source, execution(source), null);
  assert.equal(missing.allowed, false);
  if (!missing.allowed) assert.deepEqual(missing.reason_codes, ["NO_MANUAL_AUTHORIZATION"]);

  const unsigned = {
    ...authorization(source),
    manual_confirmation: false
  } as unknown as ObservationCanaryManualAuthorization;
  const noConfirmation = evaluateObservationCanaryAuthorization(
    source,
    execution(source),
    unsigned
  );
  assert.equal(noConfirmation.allowed, false);
  if (!noConfirmation.allowed) {
    assert.deepEqual(noConfirmation.reason_codes, ["LIVE_CANARY_SCOPE_INVALID"]);
  }

  const incomplete = authorization(source, { endpoint: "" });
  const noBinding = evaluateObservationCanaryAuthorization(
    source,
    execution(source),
    incomplete
  );
  assert.equal(noBinding.allowed, false);
  if (!noBinding.allowed) {
    assert.deepEqual(noBinding.reason_codes, ["AUTHORIZATION_BINDING_INVALID"]);
  }

  const wrongPurpose = {
    ...authorization(source),
    authorization_purpose: "COLLECT_RECRUITMENT_DATA"
  } as unknown as ObservationCanaryManualAuthorization;
  const purposeDecision = evaluateObservationCanaryAuthorization(
    source,
    execution(source),
    wrongPurpose
  );
  assert.equal(purposeDecision.allowed, false);
  if (!purposeDecision.allowed) {
    assert.deepEqual(purposeDecision.reason_codes, ["OBSERVATION_CANARY_PURPOSE_INVALID"]);
  }
});

test("Observation Canary rejects locator, purpose, content kind, and run mismatches", () => {
  const source = reviewAdmission();
  const signed = authorization(source);
  const cases: Array<[LiveCanaryExecutionRequest, string]> = [
    [execution(source, { endpoint: "https://example.invalid/careers/other.xlsx" }),
      "AUTHORIZATION_ENDPOINT_MISMATCH"],
    [execution(source, { endpoint_purpose: "JOB_DETAIL" }),
      "AUTHORIZATION_ENDPOINT_PURPOSE_MISMATCH"],
    [execution(source, {
      recruitment_endpoint: { ...endpoint(source), content_kind: "HTML" }
    }), "AUTHORIZATION_ENDPOINT_REFERENCE_MISMATCH"],
    [execution(source, {
      allowed_http_method: "HEAD",
      recruitment_endpoint: { ...endpoint(source), request_method: "HEAD" }
    }), "AUTHORIZATION_HTTP_METHOD_MISMATCH"],
    [execution(source, {
      collection_run_id: branded<LiveCanaryExecutionRequest["collection_run_id"]>(
        "observation-other-run"
      )
    }),
      "AUTHORIZATION_RUN_MISMATCH"]
  ];
  for (const [request, reason] of cases) {
    const decision = evaluateObservationCanaryAuthorization(source, request, signed);
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.deepEqual(decision.reason_codes, [reason]);
  }
});

test("Observation Canary enforces one GET with no retry, pagination, or redirect follow", () => {
  const source = reviewAdmission();
  for (const collectionConfig of [
    { max_items: 2, max_pages: 1, retry_limit: 0, follow_redirects: false },
    { max_items: 1, max_pages: 2, retry_limit: 0, follow_redirects: false },
    { max_items: 1, max_pages: 1, retry_limit: 1, follow_redirects: false },
    { max_items: 1, max_pages: 1, retry_limit: 0, follow_redirects: true }
  ]) {
    const request = execution(source, {
      recruitment_endpoint: endpoint(source, collectionConfig)
    });
    const decision = evaluateObservationCanaryAuthorization(
      source,
      request,
      authorization(source)
    );
    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.deepEqual(decision.reason_codes, ["OBSERVATION_CANARY_REQUEST_BUDGET_INVALID"]);
    }
  }
});

test("Observation authorization cannot become Scheduler automation authorization", () => {
  type ObservationAssignableToAutomation =
    ObservationCanaryManualAuthorization extends LiveCanaryManualAuthorization ? true : false;
  const structurallyAssignable: ObservationAssignableToAutomation = false;
  assert.equal(structurallyAssignable, false);

  const approved = new InMemorySourceAdmissionRegister().register(approvedAdmission());
  const observation = authorization(approved);
  const automationDecision = evaluateLiveCanaryAuthorization(
    approved,
    execution(approved),
    observation as unknown as LiveCanaryManualAuthorization
  );
  assert.equal(automationDecision.allowed, false);
  if (!automationDecision.allowed) {
    assert.deepEqual(automationDecision.reason_codes, ["AUTHORIZATION_MODE_MISMATCH"]);
  }
  const automationGateDecision = new InMemoryLiveCanaryAuthorizationGate().authorize(
    approved,
    execution(approved),
    observation as unknown as LiveCanaryManualAuthorization
  );
  assert.equal(automationGateDecision.allowed, false);
});
