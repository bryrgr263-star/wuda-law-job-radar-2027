import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateLiveCanaryAuthorization,
  InMemoryLiveCanaryAuthorizationGate,
  InMemorySourceAdmissionRegister,
  SOURCE_PROHIBITED_ACTIONS,
  SourceAdmissionError,
  type SourceAdmission,
  type SourceAdmissionEvidenceId,
  type SourceAdmissionId,
  type LiveCanaryCollectionRunId,
  type LiveCanaryExecutionRequest,
  type LiveCanaryManualAuthorization
} from "../../lib/application";
import { UTF8_TEXT_ENCODING } from "../../lib/ingestion";

function branded<Value extends string>(value: string) {
  return value as Value;
}

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}

function admission(
  decision: SourceAdmission["admission_decision"] = "APPROVED",
  overrides: Partial<SourceAdmission> = {}
): SourceAdmission {
  const robotsEvidenceId = branded<SourceAdmissionEvidenceId>("admission-evidence-robots");
  const termsEvidenceId = branded<SourceAdmissionEvidenceId>("admission-evidence-terms");
  const reviewEvidenceId = branded<SourceAdmissionEvidenceId>("admission-evidence-review");
  return {
    source_admission_id: branded<SourceAdmissionId>("admission-official-html"),
    source_name: traceable("某研究所官方人才招聘"),
    source_type: "OFFICIAL_CAREER_SITE",
    official_owner: traceable("中国科学院某研究所"),
    endpoint: "https://example.invalid/careers",
    content_kind: "HTML",
    source_authority: "OFFICIAL",
    robots: { status: "ALLOWED", evidence_id: robotsEvidenceId },
    terms: { status: "ALLOWED", evidence_id: termsEvidenceId },
    login_requirement: "NONE",
    captcha: "NONE_OBSERVED",
    structure: "STATIC_HTML",
    stability: "HIGH",
    update_frequency: "WEEKLY",
    priority: "HIGH",
    prohibited_actions: SOURCE_PROHIBITED_ACTIONS,
    evidence: [
      {
        source_admission_evidence_id: robotsEvidenceId,
        kind: "ROBOTS",
        locator: "https://example.invalid/robots.txt",
        captured_at: "2026-09-03T09:00:00+08:00",
        summary: original("允许公开招聘页面的低频读取。")
      },
      {
        source_admission_evidence_id: termsEvidenceId,
        kind: "TERMS",
        locator: "https://example.invalid/terms",
        captured_at: "2026-09-03T09:00:00+08:00",
        summary: original("未要求登录，未声明禁止公开页面访问。")
      },
      {
        source_admission_evidence_id: reviewEvidenceId,
        kind: "MANUAL_REVIEW",
        locator: "manual://source-admission/admission-official-html",
        captured_at: "2026-09-03T09:05:00+08:00",
        summary: original("人工审查确认仅允许一个公开 Endpoint 的低频 Canary。")
      }
    ],
    review_records: [{
      source_admission_review_id: branded("admission-review-1"),
      reviewer: "source-governance-reviewer",
      reviewed_at: "2026-09-03T09:05:00+08:00",
      decision,
      rationale: original("符合 Phase 2 官方来源准入范围。"),
      evidence_ids: [robotsEvidenceId, termsEvidenceId, reviewEvidenceId]
    }],
    admission_decision: decision,
    ...overrides
  };
}

function execution(
  source: SourceAdmission,
  overrides: Partial<LiveCanaryExecutionRequest> = {}
): LiveCanaryExecutionRequest {
  return {
    source_admission_id: source.source_admission_id,
    endpoint: source.endpoint,
    collection_run_id: branded<LiveCanaryCollectionRunId>("canary-run-once"),
    ...overrides
  };
}

function authorization(
  source: SourceAdmission,
  overrides: Partial<LiveCanaryManualAuthorization> = {}
): LiveCanaryManualAuthorization {
  return {
    live_canary_authorization_id: branded("canary-authorization-once"),
    source_admission_id: source.source_admission_id,
    endpoint: source.endpoint,
    collection_run_id: branded<LiveCanaryCollectionRunId>("canary-run-once"),
    authorized_by: "reviewer",
    authorized_at: "2026-09-03T10:00:00+08:00",
    evidence_id: source.evidence[2].source_admission_evidence_id,
    scope: "ONE_ENDPOINT_ONE_RUN",
    manual_confirmation: true,
    ...overrides
  };
}

test("Source Admission Register preserves Chinese review evidence and all required fields", () => {
  const register = new InMemorySourceAdmissionRegister();
  const registered = register.register(admission());

  assert.equal(registered.source_name.original.text, "某研究所官方人才招聘");
  assert.equal(registered.official_owner.original.text, "中国科学院某研究所");
  assert.equal(registered.robots.status, "ALLOWED");
  assert.equal(registered.terms.status, "ALLOWED");
  assert.equal(registered.review_records[0].decision, "APPROVED");
  assert.equal(registered.evidence.length, 3);
  assert.equal(register.listApproved().length, 1);
});

test("APPROVED, REJECTED, and REVIEW remain distinct auditable admission states", () => {
  const register = new InMemorySourceAdmissionRegister();
  register.register(admission("APPROVED"));
  register.register(admission("REJECTED", {
    source_admission_id: branded<SourceAdmissionId>("admission-rejected"),
    source_type: "THIRD_PARTY_PLATFORM",
    source_authority: "THIRD_PARTY",
    login_requirement: "REQUIRED",
    captcha: "PRESENT",
    robots: { status: "DISALLOWED", evidence_id: branded("admission-evidence-robots") },
    terms: { status: "DISALLOWED", evidence_id: branded("admission-evidence-terms") }
  }));
  register.register(admission("REVIEW", {
    source_admission_id: branded<SourceAdmissionId>("admission-review"),
    robots: { status: "UNKNOWN", evidence_id: branded("admission-evidence-robots") },
    terms: { status: "UNKNOWN", evidence_id: branded("admission-evidence-terms") }
  }));

  assert.deepEqual(register.list().map((item) => item.admission_decision), [
    "APPROVED",
    "REJECTED",
    "REVIEW"
  ]);
  assert.deepEqual(register.listApproved().map((item) => item.source_admission_id), [
    branded<SourceAdmissionId>("admission-official-html")
  ]);
});

test("P2 rejects approval for third-party, credentialed, CAPTCHA, or unreviewed sources", () => {
  const register = new InMemorySourceAdmissionRegister();
  const rejected = admission("APPROVED", {
    source_type: "THIRD_PARTY_PLATFORM",
    source_authority: "THIRD_PARTY"
  });
  assert.throws(() => register.register(rejected), SourceAdmissionError);
  assert.throws(() => register.register(admission("APPROVED", {
    login_requirement: "REQUIRED"
  })), SourceAdmissionError);
  assert.throws(() => register.register(admission("APPROVED", {
    captcha: "PRESENT"
  })), SourceAdmissionError);
  assert.throws(() => register.register(admission("APPROVED", {
    review_records: [{
      ...admission().review_records[0],
      decision: "REVIEW"
    }]
  })), SourceAdmissionError);
});

test("Live Canary allows only an exact approved source, endpoint, run, and evidence binding", () => {
  const approved = admission();
  const request = execution(approved);
  const deniedWithoutAuthorization = evaluateLiveCanaryAuthorization(approved, request, null);
  assert.deepEqual(deniedWithoutAuthorization, {
    allowed: false,
    source_admission_id: approved.source_admission_id,
    reason_codes: ["NO_MANUAL_AUTHORIZATION"]
  });

  const allowed = evaluateLiveCanaryAuthorization(approved, request, authorization(approved));
  assert.equal(allowed.allowed, true);
});

test("Live Canary denies rejected or review admissions", () => {
  for (const source of [admission("REJECTED"), admission("REVIEW")]) {
    const decision = evaluateLiveCanaryAuthorization(source, execution(source), authorization(source));
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.deepEqual(decision.reason_codes, ["ADMISSION_NOT_APPROVED"]);
  }
});

test("Live Canary denies source, endpoint, run, and evidence binding mismatches", () => {
  const approved = admission();
  const auth = authorization(approved);
  const cases: Array<[string, LiveCanaryExecutionRequest, LiveCanaryManualAuthorization, string]> = [
    ["wrong source", execution(approved, { source_admission_id: branded<SourceAdmissionId>("another-source") }), auth, "AUTHORIZATION_SOURCE_MISMATCH"],
    ["wrong endpoint", execution(approved, { endpoint: "https://example.invalid/other" }), auth, "AUTHORIZATION_ENDPOINT_MISMATCH"],
    ["wrong run", execution(approved, { collection_run_id: branded<LiveCanaryCollectionRunId>("another-run") }), auth, "AUTHORIZATION_RUN_MISMATCH"],
    ["missing evidence", execution(approved), authorization(approved, { evidence_id: branded<SourceAdmissionEvidenceId>("missing-evidence") }), "AUTHORIZATION_EVIDENCE_MISSING"]
  ];
  for (const [, request, candidate, expected] of cases) {
    const decision = evaluateLiveCanaryAuthorization(approved, request, candidate);
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.deepEqual(decision.reason_codes, [expected]);
  }
});

test("Live Canary requires a non-empty signed binding", () => {
  const approved = admission();
  const decision = evaluateLiveCanaryAuthorization(
    approved,
    execution(approved),
    authorization(approved, { authorized_at: "" })
  );
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.deepEqual(decision.reason_codes, ["AUTHORIZATION_BINDING_INVALID"]);
});

test("a Live Canary authorization is single-use", () => {
  const approved = admission();
  const request = execution(approved);
  const gate = new InMemoryLiveCanaryAuthorizationGate();
  const first = gate.authorize(approved, request, authorization(approved));
  const second = gate.authorize(approved, request, authorization(approved));
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  if (!second.allowed) assert.deepEqual(second.reason_codes, ["AUTHORIZATION_ALREADY_USED"]);
});

test("P2-01 source admission tests remain offline", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});
