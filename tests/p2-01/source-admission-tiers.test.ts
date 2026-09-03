import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateLiveCanaryAuthorization,
  evaluateSourceAutomationPermission,
  InMemoryLiveCanaryAuthorizationGate,
  InMemorySourceAdmissionRegister,
  SOURCE_PROHIBITED_ACTIONS,
  SourceAdmissionError,
  type AccessReviewStatus,
  type LiveCanaryCollectionRunId,
  type LiveCanaryExecutionRequest,
  type LiveCanaryManualAuthorization,
  type SourceAdmission,
  type SourceAdmissionEvidence,
  type SourceAdmissionEvidenceId,
  type SourceAdmissionEvidenceKind,
  type SourceAdmissionId,
  type SourceAdmissionLevel,
  type SourceAdmissionStatus,
  type SourceAutomationBasis
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

interface AdmissionFixtureOptions {
  readonly level: SourceAdmissionLevel;
  readonly automationBasis: SourceAutomationBasis;
  readonly decision: SourceAdmissionStatus;
  readonly robots: AccessReviewStatus;
  readonly terms: AccessReviewStatus;
  readonly sourceAdmissionId?: SourceAdmissionId;
  readonly sourceName?: string;
  readonly officialOwner?: string;
  readonly sourceUrl?: string;
  readonly endpoint?: string;
  readonly loginRequirement?: SourceAdmission["login_requirement"];
  readonly captcha?: SourceAdmission["captcha"];
}

function evidence(
  sourceAdmissionId: SourceAdmissionId,
  sourceUrl: string,
  endpoint: string,
  evidenceId: SourceAdmissionEvidenceId,
  kind: SourceAdmissionEvidenceKind,
  decision: AccessReviewStatus,
  summary: string
): SourceAdmissionEvidence {
  return {
    source_admission_evidence_id: evidenceId,
    source_admission_id: sourceAdmissionId,
    endpoint,
    source_url: sourceUrl,
    kind,
    locator: kind === "MANUAL_REVIEW"
      ? `manual://source-admission/${evidenceId}`
      : `${sourceUrl}${kind.toLowerCase()}`,
    captured_at: "2026-09-04T09:00:00+08:00",
    reviewer: "source-governance-reviewer",
    decision,
    summary: original(summary)
  };
}

function admission(options: AdmissionFixtureOptions): SourceAdmission {
  const sourceAdmissionId = options.sourceAdmissionId
    ?? branded<SourceAdmissionId>("admission-tier-test");
  const sourceUrl = options.sourceUrl ?? "https://example.invalid/";
  const endpoint = options.endpoint ?? `${sourceUrl}careers`;
  const robotsEvidenceId = branded<SourceAdmissionEvidenceId>("evidence-robots-initial");
  const termsEvidenceId = branded<SourceAdmissionEvidenceId>("evidence-terms-initial");
  const reviewEvidenceId = branded<SourceAdmissionEvidenceId>("evidence-review-initial");
  return {
    source_admission_id: sourceAdmissionId,
    admission_level: options.level,
    automation_basis: options.automationBasis,
    source_name: traceable(options.sourceName ?? "官方招聘来源"),
    source_type: "OFFICIAL_RECRUITMENT_PAGE",
    official_owner: traceable(options.officialOwner ?? "官方单位"),
    endpoint,
    recruitment_endpoint_id: branded("endpoint-tier-test"),
    endpoint_purpose: "JOB_LIST",
    allowed_http_method: "GET",
    content_kind: "HTML",
    source_authority: "OFFICIAL",
    robots: { status: options.robots, evidence_id: robotsEvidenceId },
    terms: { status: options.terms, evidence_id: termsEvidenceId },
    login_requirement: options.loginRequirement ?? "NONE",
    captcha: options.captcha ?? "NONE_OBSERVED",
    structure: "STATIC_HTML",
    stability: "HIGH",
    update_frequency: "IRREGULAR",
    priority: "HIGH",
    prohibited_actions: SOURCE_PROHIBITED_ACTIONS,
    evidence: [
      evidence(
        sourceAdmissionId,
        sourceUrl,
        endpoint,
        robotsEvidenceId,
        "ROBOTS",
        options.robots,
        "记录目标路径适用的 robots 规则。"
      ),
      evidence(
        sourceAdmissionId,
        sourceUrl,
        endpoint,
        termsEvidenceId,
        "TERMS",
        options.terms,
        "记录官方自动化访问条款的观察结果。"
      ),
      evidence(
        sourceAdmissionId,
        sourceUrl,
        endpoint,
        reviewEvidenceId,
        "MANUAL_REVIEW",
        options.decision === "REJECTED" ? "PROHIBITED" : "UNKNOWN",
        "记录来源准入的人工审查结论。"
      )
    ],
    review_records: [{
      source_admission_review_id: branded("review-initial"),
      reviewer: "source-governance-reviewer",
      reviewed_at: "2026-09-04T09:05:00+08:00",
      decision: options.decision,
      rationale: original("根据当前官方证据确定准入等级。"),
      evidence_ids: [robotsEvidenceId, termsEvidenceId, reviewEvidenceId]
    }],
    admission_decision: options.decision
  };
}

function revisedWithEvidence(
  current: SourceAdmission,
  label: string,
  changes: Pick<SourceAdmission, "admission_level" | "automation_basis" | "admission_decision">,
  kind: SourceAdmissionEvidenceKind = "MANUAL_REVIEW",
  decision: AccessReviewStatus = "UNKNOWN"
): SourceAdmission {
  const evidenceId = branded<SourceAdmissionEvidenceId>(`evidence-${label}`);
  const addedEvidence = evidence(
    current.source_admission_id,
    current.evidence[0].source_url,
    current.endpoint,
    evidenceId,
    kind,
    decision,
    `支持 ${label} 准入修订的新增证据。`
  );
  return {
    ...current,
    ...changes,
    robots: kind === "ROBOTS"
      ? { status: decision, evidence_id: evidenceId }
      : current.robots,
    terms: kind === "TERMS"
      ? { status: decision, evidence_id: evidenceId }
      : current.terms,
    evidence: [...current.evidence, addedEvidence],
    review_records: [
      ...current.review_records,
      {
        source_admission_review_id: branded(`review-${label}`),
        reviewer: "source-governance-reviewer",
        reviewed_at: "2026-09-04T10:00:00+08:00",
        decision: changes.admission_decision,
        rationale: original(`人工审核确认 ${label} 准入修订。`),
        evidence_ids: [evidenceId]
      }
    ]
  };
}

function recruitmentEndpoint(source: SourceAdmission): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: source.recruitment_endpoint_id,
    source_definition_id: branded("source-tier-test"),
    name: traceable("官方招聘列表"),
    description: traceable("CR#4 离线权限测试 Endpoint"),
    coverage_regions: [],
    locator: source.endpoint,
    request_method: "GET",
    content_kind: source.content_kind,
    adapter_key: "source-admission-tier-test-only",
    decoded_text_encoding: UTF8_TEXT_ENCODING,
    collection_config: { timeout_ms: 5_000, max_pages: 1, retry_limit: 0 },
    enabled: true
  };
}

function execution(source: SourceAdmission): LiveCanaryExecutionRequest {
  return {
    source_admission_id: source.source_admission_id,
    endpoint: source.endpoint,
    recruitment_endpoint_id: source.recruitment_endpoint_id,
    recruitment_endpoint: recruitmentEndpoint(source),
    endpoint_purpose: source.endpoint_purpose,
    allowed_http_method: "GET",
    collection_run_id: branded<LiveCanaryCollectionRunId>("tier-test-run-once")
  };
}

function authorization(
  source: SourceAdmission,
  evidenceId: SourceAdmissionEvidenceId
): LiveCanaryManualAuthorization {
  return {
    authorization_id: branded("tier-test-authorization-once"),
    source_admission_id: source.source_admission_id,
    endpoint: source.endpoint,
    recruitment_endpoint_id: source.recruitment_endpoint_id,
    endpoint_purpose: source.endpoint_purpose,
    allowed_http_method: "GET",
    collection_run_id: branded<LiveCanaryCollectionRunId>("tier-test-run-once"),
    reviewer: "source-governance-reviewer",
    issued_at: "2026-09-04T10:05:00+08:00",
    evidence_id: evidenceId,
    scope: "ONE_ENDPOINT_ONE_RUN",
    manual_confirmation: true
  };
}

function levelBReview(overrides: Partial<AdmissionFixtureOptions> = {}) {
  return admission({
    level: "B",
    automationBasis: "ROBOTS_ALLOW",
    decision: "REVIEW",
    robots: "ALLOWED",
    terms: "UNKNOWN",
    ...overrides
  });
}

test("Level A expresses approved normal controlled collection permission", () => {
  const source = admission({
    level: "A",
    automationBasis: "EXPLICIT_OFFICIAL_POLICY",
    decision: "APPROVED",
    robots: "ALLOWED",
    terms: "ALLOWED"
  });
  new InMemorySourceAdmissionRegister().register(source);
  assert.deepEqual(evaluateSourceAutomationPermission(source), {
    allowed: true,
    admission_level: "A",
    mode: "CONTROLLED_COLLECTION"
  });
});

test("Beijing public institution recruitment remains Level B while terms are UNKNOWN", () => {
  const source = levelBReview({
    sourceAdmissionId: branded<SourceAdmissionId>("admission-beijing-public-institution"),
    sourceName: "北京市人民政府事业单位招聘",
    officialOwner: "北京市人民政府",
    sourceUrl: "https://www.beijing.gov.cn/",
    endpoint: "https://www.beijing.gov.cn/gongkai/rsxx/sydwzp/"
  });
  const registered = new InMemorySourceAdmissionRegister().register(source);
  assert.equal(registered.admission_level, "B");
  assert.equal(registered.admission_decision, "REVIEW");
  assert.equal(registered.robots.status, "ALLOWED");
  assert.equal(registered.terms.status, "UNKNOWN");
  assert.deepEqual(evaluateSourceAutomationPermission(registered), {
    allowed: false,
    admission_level: "B",
    mode: "DENIED"
  });
  const decision = evaluateLiveCanaryAuthorization(
    registered,
    execution(registered),
    authorization(registered, registered.evidence[2].source_admission_evidence_id)
  );
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.deepEqual(decision.reason_codes, ["ADMISSION_NOT_APPROVED"]);
});

test("B review with insufficient evidence preserves unknown login and CAPTCHA signals", () => {
  const source = {
    ...admission({
      level: "B",
      automationBasis: "INSUFFICIENT_EVIDENCE",
      decision: "REVIEW",
      robots: "UNKNOWN",
      terms: "UNKNOWN",
      loginRequirement: "UNKNOWN",
      captcha: "UNKNOWN",
      sourceAdmissionId: branded<SourceAdmissionId>("admission-attachment-review-unknown"),
      endpoint: "https://example.invalid/careers/position-table.xlsx"
    }),
    endpoint_purpose: "RECRUITMENT_ATTACHMENT",
    content_kind: "FILE",
    structure: "DOCUMENT"
  } as const satisfies SourceAdmission;
  const registered = new InMemorySourceAdmissionRegister().register(source);

  assert.equal(registered.login_requirement, "UNKNOWN");
  assert.equal(registered.captcha, "UNKNOWN");
  assert.deepEqual(evaluateSourceAutomationPermission(registered), {
    allowed: false,
    admission_level: "B",
    mode: "DENIED"
  });
  const decision = evaluateLiveCanaryAuthorization(registered, execution(registered), null);
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.deepEqual(decision.reason_codes, ["NO_MANUAL_AUTHORIZATION"]);
});

test("approved B rejects unknown login or CAPTCHA signals", () => {
  const approved = {
    level: "B",
    automationBasis: "HUMAN_REVIEWED_CANARY",
    decision: "APPROVED",
    robots: "ALLOWED",
    terms: "UNKNOWN"
  } as const;
  for (const accessSignals of [
    { loginRequirement: "UNKNOWN", captcha: "NONE_OBSERVED" },
    { loginRequirement: "NONE", captcha: "UNKNOWN" }
  ] as const) {
    assert.throws(
      () => new InMemorySourceAdmissionRegister().register(admission({
        ...approved,
        ...accessSignals
      })),
      SourceAdmissionError
    );
  }
});

test("approved B still accepts confirmed public access signals", () => {
  const source = admission({
    level: "B",
    automationBasis: "HUMAN_REVIEWED_CANARY",
    decision: "APPROVED",
    robots: "ALLOWED",
    terms: "UNKNOWN",
    loginRequirement: "NONE",
    captcha: "NONE_OBSERVED"
  });
  const registered = new InMemorySourceAdmissionRegister().register(source);

  assert.equal(registered.login_requirement, "NONE");
  assert.equal(registered.captcha, "NONE_OBSERVED");
  assert.deepEqual(evaluateSourceAutomationPermission(registered), {
    allowed: true,
    admission_level: "B",
    mode: "ONE_ENDPOINT_ONE_RUN",
    requires_manual_authorization: true
  });
});

test("approved Level B uses one endpoint, one run, and consumes manual authorization", () => {
  const register = new InMemorySourceAdmissionRegister();
  const source = register.register(levelBReview());
  const approved = register.revise(revisedWithEvidence(source, "b-canary-approval", {
    admission_level: "B",
    automation_basis: "HUMAN_REVIEWED_CANARY",
    admission_decision: "APPROVED"
  }, "MANUAL_REVIEW", "ALLOWED"));
  assert.deepEqual(evaluateSourceAutomationPermission(approved), {
    allowed: true,
    admission_level: "B",
    mode: "ONE_ENDPOINT_ONE_RUN",
    requires_manual_authorization: true
  });

  const request = execution(approved);
  const signed = authorization(
    approved,
    approved.evidence.at(-1)!.source_admission_evidence_id
  );
  const gate = new InMemoryLiveCanaryAuthorizationGate();
  assert.equal(gate.authorize(approved, request, signed).allowed, true);
  const replay = gate.authorize(approved, request, signed);
  assert.equal(replay.allowed, false);
  if (!replay.allowed) assert.deepEqual(replay.reason_codes, ["AUTHORIZATION_ALREADY_USED"]);
  assert.equal(register.get(approved.source_admission_id).admission_level, "B");
});

test("a B-level recruitment attachment never gains permanent automation permission", () => {
  const register = new InMemorySourceAdmissionRegister();
  const review = register.register({
    ...levelBReview({
      sourceAdmissionId: branded<SourceAdmissionId>("admission-tier-attachment"),
      endpoint: "https://example.invalid/careers/position-table.xlsx"
    }),
    source_type: "OFFICIAL_RECRUITMENT_PAGE",
    endpoint_purpose: "RECRUITMENT_ATTACHMENT",
    content_kind: "FILE",
    structure: "DOCUMENT"
  });
  const approved = register.revise(revisedWithEvidence(review, "attachment-canary-approval", {
    admission_level: "B",
    automation_basis: "HUMAN_REVIEWED_CANARY",
    admission_decision: "APPROVED"
  }, "MANUAL_REVIEW", "ALLOWED"));

  assert.deepEqual(evaluateSourceAutomationPermission(approved), {
    allowed: true,
    admission_level: "B",
    mode: "ONE_ENDPOINT_ONE_RUN",
    requires_manual_authorization: true
  });
  const signed = authorization(
    approved,
    approved.evidence.at(-1)!.source_admission_evidence_id
  );
  const gate = new InMemoryLiveCanaryAuthorizationGate();
  assert.equal(gate.authorize(approved, execution(approved), signed).allowed, true);
  const replay = gate.authorize(approved, execution(approved), signed);
  assert.equal(replay.allowed, false);
  if (!replay.allowed) assert.deepEqual(replay.reason_codes, ["AUTHORIZATION_ALREADY_USED"]);
  assert.equal(register.get(approved.source_admission_id).admission_level, "B");
});

test("Level C and D both deny collection and Live Canary execution", () => {
  const restricted = admission({
    level: "C",
    automationBasis: "INSUFFICIENT_EVIDENCE",
    decision: "REVIEW",
    robots: "UNKNOWN",
    terms: "UNKNOWN"
  });
  const prohibited = admission({
    level: "D",
    automationBasis: "NO_AUTOMATION_ALLOWED",
    decision: "REJECTED",
    robots: "ALLOWED",
    terms: "PROHIBITED",
    sourceAdmissionId: branded<SourceAdmissionId>("admission-tier-d")
  });
  const register = new InMemorySourceAdmissionRegister();
  register.register(restricted);
  register.register(prohibited);

  for (const source of [restricted, prohibited]) {
    assert.deepEqual(evaluateSourceAutomationPermission(source), {
      allowed: false,
      admission_level: source.admission_level,
      mode: "DENIED"
    });
    const decision = evaluateLiveCanaryAuthorization(
      source,
      execution(source),
      authorization(source, source.evidence[2].source_admission_evidence_id)
    );
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.deepEqual(decision.reason_codes, ["ADMISSION_LEVEL_DENIED"]);
  }

  assert.throws(() => register.register({
    ...restricted,
    source_admission_id: branded<SourceAdmissionId>("admission-third-party-review"),
    source_type: "THIRD_PARTY_PLATFORM",
    source_authority: "THIRD_PARTY",
    evidence: restricted.evidence.map((item) => ({
      ...item,
      source_admission_id: branded<SourceAdmissionId>("admission-third-party-review")
    }))
  }), SourceAdmissionError);
});

test("B to A, B to C, B to D, and C to B require auditable new evidence", () => {
  const transitions: Array<[SourceAdmission, SourceAdmission]> = [];

  const toAStart = levelBReview({
    sourceAdmissionId: branded<SourceAdmissionId>("transition-b-a")
  });
  transitions.push([toAStart, revisedWithEvidence(toAStart, "b-to-a", {
    admission_level: "A",
    automation_basis: "EXPLICIT_OFFICIAL_POLICY",
    admission_decision: "APPROVED"
  }, "TERMS", "ALLOWED")]);

  const toCStart = levelBReview({
    sourceAdmissionId: branded<SourceAdmissionId>("transition-b-c")
  });
  transitions.push([toCStart, revisedWithEvidence(toCStart, "b-to-c", {
    admission_level: "C",
    automation_basis: "CONFLICTING_EVIDENCE",
    admission_decision: "REVIEW"
  })]);

  const toDStart = levelBReview({
    sourceAdmissionId: branded<SourceAdmissionId>("transition-b-d")
  });
  transitions.push([toDStart, revisedWithEvidence(toDStart, "b-to-d", {
    admission_level: "D",
    automation_basis: "NO_AUTOMATION_ALLOWED",
    admission_decision: "REJECTED"
  }, "TERMS", "PROHIBITED")]);

  const toBStart = admission({
    level: "C",
    automationBasis: "INSUFFICIENT_EVIDENCE",
    decision: "REVIEW",
    robots: "UNKNOWN",
    terms: "UNKNOWN",
    sourceAdmissionId: branded<SourceAdmissionId>("transition-c-b")
  });
  transitions.push([toBStart, revisedWithEvidence(toBStart, "c-to-b", {
    admission_level: "B",
    automation_basis: "INSUFFICIENT_EVIDENCE",
    admission_decision: "REVIEW"
  })]);

  for (const [before, after] of transitions) {
    const register = new InMemorySourceAdmissionRegister();
    register.register(before);
    assert.equal(register.revise(after).admission_level, after.admission_level);
  }
});

test("Level B cannot become A without new evidence and a new review", () => {
  const source = levelBReview();
  const register = new InMemorySourceAdmissionRegister();
  register.register(source);
  const silentlyPromoted: SourceAdmission = {
    ...source,
    admission_level: "A",
    automation_basis: "EXPLICIT_OFFICIAL_POLICY",
    admission_decision: "APPROVED",
    terms: { ...source.terms, status: "ALLOWED" },
    evidence: source.evidence.map((item) => item.kind === "TERMS"
      ? { ...item, decision: "ALLOWED" }
      : item),
    review_records: source.review_records.map((review) => ({
      ...review,
      decision: "APPROVED"
    }))
  };
  assert.throws(() => register.revise(silentlyPromoted), SourceAdmissionError);
});

test("CR#4 admission tier tests remain offline", async () => {
  await assert.rejects(fetch("https://www.beijing.gov.cn/"), /Network access is disabled in tests/);
});
