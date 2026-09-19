import {
  SOURCE_ADMISSION_ENDPOINT_PURPOSES,
  SOURCE_PROHIBITED_ACTIONS,
  type SourceAdmission,
  type SourceAdmissionEvidenceId,
  type SourceAdmissionId,
  type SourceAutomationPermission
} from "./types";
import {
  issueContinuousRecord, replayContinuousRecords, currentContinuousGrant, pendingContinuousAttempt,
  revokeContinuousRecord, reserveContinuousRecord, closeContinuousRecord,
  type ContinuousRecord, type ContinuousSourceContext, type ContinuousIssueCommand,
  type ContinuousContextResolver, type ContinuousFencingVerifier
} from "./continuous-acquisition";
import { canonicalSerialize } from "../../ingestion/normalization/canonical-artifact-registry";

const phaseTwoApprovedSourceTypes = new Set([
  "OFFICIAL_CAREER_SITE",
  "OFFICIAL_RECRUITMENT_PAGE",
  "OFFICIAL_FEED"
]);

export class SourceAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceAdmissionError";
  }
}

export class InMemorySourceAdmissionRegister {
  readonly #admissions = new Map<SourceAdmissionId, SourceAdmission>();
  #continuousRecords: ContinuousRecord[] = [];

  restoreContinuousRecords(records: readonly ContinuousRecord[], resolve: ContinuousContextResolver, verifier?: ContinuousFencingVerifier) {
    const restored = replayContinuousRecords(records, resolve, verifier);
    this.#continuousRecords = restored;
  }

  issueContinuousAuthorization(context: ContinuousSourceContext, command: ContinuousIssueCommand) {
    const current = this.get(context.admission.source_admission_id);
    if (canonicalSerialize(current) !== canonicalSerialize(context.admission)) throw new SourceAdmissionError("Admission binding is not current");
    return issueContinuousRecord(this.#continuousRecords, context, command);
  }

  revokeContinuousAuthorization(id: string, actor: string, at: string, reference: string) {
    return revokeContinuousRecord(this.#continuousRecords, id, actor, at, reference);
  }

  reserveContinuousAttempt(...input: Parameters<typeof reserveContinuousRecord> extends [unknown, ...infer Rest] ? Rest : never) {
    const context = input[1];
    if (canonicalSerialize(this.get(context.admission.source_admission_id)) !== canonicalSerialize(context.admission)) {
      throw new SourceAdmissionError("Admission binding is not current");
    }
    return reserveContinuousRecord(this.#continuousRecords, ...input);
  }

  closeContinuousAttempt(...input: Parameters<typeof closeContinuousRecord> extends [unknown, ...infer Rest] ? Rest : never) {
    return closeContinuousRecord(this.#continuousRecords, ...input);
  }

  listContinuousRecords() { return clone(this.#continuousRecords); }

  resolveContinuousAuthorization(id: string) {
    const grant = currentContinuousGrant(this.#continuousRecords, id);
    const revocation = this.#continuousRecords.find(record => record.kind === "REVOKE" && record.payload.authorization_id === id);
    return { grant, state: revocation ? "REVOKED" as const : "ACTIVE" as const,
      revocation: clone(revocation ?? null), pending_attempt: pendingContinuousAttempt(this.#continuousRecords) };
  }

  register(admission: SourceAdmission): SourceAdmission {
    validateSourceAdmission(admission);
    if (this.#admissions.has(admission.source_admission_id)) {
      throw new SourceAdmissionError(
        `Source Admission already exists: ${admission.source_admission_id}`
      );
    }
    const stored = clone(admission);
    this.#admissions.set(stored.source_admission_id, stored);
    return clone(stored);
  }

  revise(admission: SourceAdmission): SourceAdmission {
    const current = this.#admissions.get(admission.source_admission_id);
    if (!current) {
      throw new SourceAdmissionError(
        `Source Admission does not exist: ${admission.source_admission_id}`
      );
    }
    validateSourceAdmission(admission);
    validateAdmissionRevision(current, admission);
    const stored = clone(admission);
    this.#admissions.set(stored.source_admission_id, stored);
    return clone(stored);
  }

  get(sourceAdmissionId: SourceAdmissionId): SourceAdmission {
    const admission = this.#admissions.get(sourceAdmissionId);
    if (!admission) {
      throw new SourceAdmissionError(`Source Admission does not exist: ${sourceAdmissionId}`);
    }
    return clone(admission);
  }

  list(): readonly SourceAdmission[] {
    return [...this.#admissions.values()].map(clone);
  }

  listApproved(): readonly SourceAdmission[] {
    return this.list().filter((admission) => admission.admission_decision === "APPROVED");
  }
}

export function validateSourceAdmission(admission: SourceAdmission) {
  requireText(admission.source_name.original.text, "Source name");
  requireText(admission.official_owner.original.text, "Official owner");
  validateEndpoint(admission.endpoint);
  validateEndpointContract(admission);
  validateEvidence(admission);
  validateReviews(admission);
  validateAdmissionTier(admission);
}

export function evaluateSourceAutomationPermission(
  admission: SourceAdmission
): SourceAutomationPermission {
  if (admission.admission_decision !== "APPROVED") {
    return deniedAutomation(admission);
  }
  if (admission.automation_basis === "HUMAN_APPROVED_CONTINUOUS_SCOPE") {
    validateSourceAdmission(admission);
    return { allowed: true, admission_level: admission.admission_level as "A" | "B",
      mode: "REVOCABLE_CONTINUOUS_UNATTENDED_ACQUISITION", requires_current_authorization: true };
  }
  if (admission.admission_level === "A") {
    return {
      allowed: true,
      admission_level: "A",
      mode: "CONTROLLED_COLLECTION"
    };
  }
  if (
    admission.admission_level === "B"
    && admission.automation_basis === "HUMAN_REVIEWED_CANARY"
  ) {
    return {
      allowed: true,
      admission_level: "B",
      mode: "ONE_ENDPOINT_ONE_RUN",
      requires_manual_authorization: true
    };
  }
  return deniedAutomation(admission);
}

function validateEndpointContract(admission: SourceAdmission) {
  if (
    typeof admission.recruitment_endpoint_id !== "string"
    || admission.recruitment_endpoint_id.trim().length === 0
  ) {
    throw new SourceAdmissionError("P1 RecruitmentEndpoint reference cannot be empty");
  }
  if (!SOURCE_ADMISSION_ENDPOINT_PURPOSES.includes(admission.endpoint_purpose)) {
    throw new SourceAdmissionError(`Unsupported endpoint purpose: ${admission.endpoint_purpose}`);
  }
  if (admission.allowed_http_method !== "GET") {
    throw new SourceAdmissionError(
      `P2-04 Source Admission only permits GET: ${admission.allowed_http_method}`
    );
  }
}

function validateAdmissionTier(admission: SourceAdmission) {
  if (admission.automation_basis === "HUMAN_APPROVED_CONTINUOUS_SCOPE") {
    const scope = admission.continuous_acquisition_scope;
    if ((admission.admission_level !== "A" && admission.admission_level !== "B")
      || admission.admission_decision !== "APPROVED" || !scope
      || !scope.exact_targets.length || !Number.isSafeInteger(scope.min_interval_seconds) || scope.min_interval_seconds < 1
      || !["PRODUCTION", "CONTROLLED_TEST"].includes(scope.scope)
      || !Number.isFinite(Date.parse(scope.effective_from))
      || new Set(scope.exact_targets.map(item => item.allowlist_entry_id)).size !== scope.exact_targets.length
      || !admission.review_records.some(review => review.source_admission_review_id === scope.approval_review_id && review.decision === "APPROVED")) {
      throw new SourceAdmissionError("Continuous approval requires exact scope and explicit review");
    }
    for (const target of scope.exact_targets) {
      validateEndpoint(target.exact_url);
      const url = new URL(target.exact_url);
      if (!target.allowlist_entry_id.trim() || url.protocol !== "https:" || url.search || url.hash || url.href !== target.exact_url) {
        throw new SourceAdmissionError("Continuous approval requires exact HTTPS targets without query or fragment");
      }
    }
    if (hasProhibitedAccessEvidence(admission)) throw new SourceAdmissionError("Continuous approval cannot override prohibited evidence");
    validateApprovedOfficialAdmission(admission);
    return;
  }
  if (
    admission.source_type === "THIRD_PARTY_PLATFORM"
    && (admission.admission_level !== "D" || admission.admission_decision !== "REJECTED")
  ) {
    throw new SourceAdmissionError("Third-party platforms must remain Level D and REJECTED");
  }
  if (admission.admission_level === "A") {
    if (admission.admission_decision !== "APPROVED") {
      throw new SourceAdmissionError("Level A sources must be APPROVED");
    }
    if (
      admission.automation_basis !== "EXPLICIT_OFFICIAL_POLICY"
      && admission.automation_basis !== "ROBOTS_ALLOW"
      && admission.automation_basis !== "OFFICIAL_API"
    ) {
      throw new SourceAdmissionError("Level A requires an explicit automation basis");
    }
    if (admission.robots.status !== "ALLOWED" || admission.terms.status !== "ALLOWED") {
      throw new SourceAdmissionError("Level A requires allowed robots and terms evidence");
    }
    validateApprovedOfficialAdmission(admission);
    return;
  }

  if (admission.admission_level === "B") {
    validateOfficialPublicAccess(
      admission,
      admission.admission_decision === "REVIEW"
        && admission.automation_basis === "INSUFFICIENT_EVIDENCE"
    );
    if (hasProhibitedAccessEvidence(admission)) {
      throw new SourceAdmissionError("Level B cannot contain prohibited access evidence");
    }
    if (admission.robots.status !== "UNKNOWN" && admission.terms.status !== "UNKNOWN") {
      throw new SourceAdmissionError("Level B requires unresolved robots or terms evidence");
    }
    if (
      admission.automation_basis !== "ROBOTS_ALLOW"
      && admission.automation_basis !== "INSUFFICIENT_EVIDENCE"
      && admission.automation_basis !== "HUMAN_REVIEWED_CANARY"
    ) {
      throw new SourceAdmissionError("Level B has an incompatible automation basis");
    }
    if (
      admission.admission_decision !== "REVIEW"
      && admission.admission_decision !== "APPROVED"
    ) {
      throw new SourceAdmissionError("Level B must remain REVIEW or APPROVED");
    }
    if (admission.admission_decision === "APPROVED") {
      if (admission.automation_basis !== "HUMAN_REVIEWED_CANARY") {
        throw new SourceAdmissionError(
          "Approved Level B sources require HUMAN_REVIEWED_CANARY"
        );
      }
      validateApprovedOfficialAdmission(admission);
    } else if (admission.automation_basis === "HUMAN_REVIEWED_CANARY") {
      throw new SourceAdmissionError(
        "HUMAN_REVIEWED_CANARY requires an APPROVED admission decision"
      );
    }
    return;
  }

  if (admission.admission_level === "C") {
    if (admission.admission_decision !== "REVIEW") {
      throw new SourceAdmissionError("Level C sources must remain REVIEW");
    }
    if (
      admission.automation_basis !== "INSUFFICIENT_EVIDENCE"
      && admission.automation_basis !== "CONFLICTING_EVIDENCE"
    ) {
      throw new SourceAdmissionError("Level C requires insufficient or conflicting evidence");
    }
    return;
  }

  if (admission.admission_decision !== "REJECTED") {
    throw new SourceAdmissionError("Level D sources must be REJECTED");
  }
  if (admission.automation_basis !== "NO_AUTOMATION_ALLOWED") {
    throw new SourceAdmissionError("Level D requires NO_AUTOMATION_ALLOWED");
  }
  if (!hasHardAccessBlocker(admission)) {
    throw new SourceAdmissionError("Level D requires explicit prohibited-access evidence");
  }
}

function validateApprovedOfficialAdmission(admission: SourceAdmission) {
  validateOfficialPublicAccess(admission);
  if (!admission.review_records.some((review) => review.decision === "APPROVED")) {
    throw new SourceAdmissionError("P2 approved sources require an APPROVED review record");
  }
}

function validateOfficialPublicAccess(
  admission: SourceAdmission,
  allowUnknownAccessSignals = false
) {
  if (!phaseTwoApprovedSourceTypes.has(admission.source_type)) {
    throw new SourceAdmissionError(
      `P2 cannot approve source type: ${admission.source_type}`
    );
  }
  if (admission.source_authority !== "OFFICIAL" && admission.source_authority !== "AUTHORIZED") {
    throw new SourceAdmissionError("P2 approved sources must be OFFICIAL or AUTHORIZED");
  }
  const loginAccepted = admission.login_requirement === "NONE"
    || (allowUnknownAccessSignals && admission.login_requirement === "UNKNOWN");
  const captchaAccepted = admission.captcha === "NONE_OBSERVED"
    || (allowUnknownAccessSignals && admission.captcha === "UNKNOWN");
  if (!loginAccepted || !captchaAccepted) {
    throw new SourceAdmissionError("P2 approved sources cannot require login or CAPTCHA handling");
  }
  const missingProhibitions = SOURCE_PROHIBITED_ACTIONS.filter((action) => {
    return !admission.prohibited_actions.includes(action);
  });
  if (missingProhibitions.length > 0) {
    throw new SourceAdmissionError(
      `P2 approved sources must retain prohibited actions: ${missingProhibitions.join(", ")}`
    );
  }
}

function validateEvidence(admission: SourceAdmission) {
  const ids = new Set<SourceAdmissionEvidenceId>();
  for (const evidence of admission.evidence) {
    if (ids.has(evidence.source_admission_evidence_id)) {
      throw new SourceAdmissionError(
        `Duplicate source admission evidence: ${evidence.source_admission_evidence_id}`
      );
    }
    ids.add(evidence.source_admission_evidence_id);
    if (evidence.source_admission_id !== admission.source_admission_id) {
      throw new SourceAdmissionError("Admission evidence must reference its source admission");
    }
    if (evidence.endpoint !== admission.endpoint) {
      throw new SourceAdmissionError("Admission evidence must reference the admitted endpoint");
    }
    validateEndpoint(evidence.source_url);
    requireText(evidence.locator, "Admission evidence locator");
    requireText(evidence.captured_at, "Admission evidence observed time");
    requireText(evidence.reviewer, "Admission evidence reviewer");
    requireText(evidence.summary.text, "Admission evidence summary");
  }
  if (!ids.has(admission.robots.evidence_id) || !ids.has(admission.terms.evidence_id)) {
    throw new SourceAdmissionError("Robots and terms reviews must reference admission evidence");
  }
  const evidenceById = new Map(admission.evidence.map((evidence) => {
    return [evidence.source_admission_evidence_id, evidence] as const;
  }));
  const robotsEvidence = evidenceById.get(admission.robots.evidence_id);
  const termsEvidence = evidenceById.get(admission.terms.evidence_id);
  if (robotsEvidence?.kind !== "ROBOTS" || robotsEvidence.decision !== admission.robots.status) {
    throw new SourceAdmissionError("Robots review must match its ROBOTS evidence decision");
  }
  if (termsEvidence?.kind !== "TERMS" || termsEvidence.decision !== admission.terms.status) {
    throw new SourceAdmissionError("Terms review must match its TERMS evidence decision");
  }
}

function validateAdmissionRevision(current: SourceAdmission, next: SourceAdmission) {
  const immutableBindings = [
    [current.source_admission_id, next.source_admission_id],
    [current.endpoint, next.endpoint],
    [current.recruitment_endpoint_id, next.recruitment_endpoint_id],
    [current.endpoint_purpose, next.endpoint_purpose],
    [current.allowed_http_method, next.allowed_http_method],
    [current.content_kind, next.content_kind]
  ];
  if (immutableBindings.some(([before, after]) => before !== after)) {
    throw new SourceAdmissionError(
      "Admission revisions cannot change source or P1 Endpoint bindings"
    );
  }
  const governanceChanged = current.admission_level !== next.admission_level
    || current.admission_decision !== next.admission_decision
    || current.automation_basis !== next.automation_basis
    || canonicalSerialize(current.continuous_acquisition_scope ?? null) !== canonicalSerialize(next.continuous_acquisition_scope ?? null);
  if (!governanceChanged) return;

  const evidenceIds = new Set(current.evidence.map((evidence) => {
    return evidence.source_admission_evidence_id;
  }));
  const reviewIds = new Set(current.review_records.map((review) => {
    return review.source_admission_review_id;
  }));
  const hasNewEvidence = next.evidence.some((evidence) => {
    return !evidenceIds.has(evidence.source_admission_evidence_id);
  });
  const hasNewReview = next.review_records.some((review) => {
    return !reviewIds.has(review.source_admission_review_id);
  });
  if (!hasNewEvidence || !hasNewReview) {
    throw new SourceAdmissionError(
      "Admission level, decision, or automation basis changes require new evidence and review"
    );
  }
}

function hasProhibitedAccessEvidence(admission: SourceAdmission) {
  return isProhibited(admission.robots.status) || isProhibited(admission.terms.status);
}

function hasHardAccessBlocker(admission: SourceAdmission) {
  return hasProhibitedAccessEvidence(admission)
    || admission.login_requirement === "REQUIRED"
    || admission.captcha === "PRESENT"
    || admission.source_type === "THIRD_PARTY_PLATFORM";
}

function isProhibited(status: SourceAdmission["robots"]["status"]) {
  return status === "DISALLOWED" || status === "PROHIBITED";
}

function deniedAutomation(admission: SourceAdmission): SourceAutomationPermission {
  return {
    allowed: false,
    admission_level: admission.admission_level,
    mode: "DENIED"
  };
}

function validateReviews(admission: SourceAdmission) {
  const evidenceIds = new Set(admission.evidence.map((evidence) => {
    return evidence.source_admission_evidence_id;
  }));
  if (admission.review_records.length === 0) {
    throw new SourceAdmissionError("Source Admission requires at least one review record");
  }
  for (const review of admission.review_records) {
    requireText(review.reviewer, "Admission reviewer");
    requireText(review.rationale.text, "Admission review rationale");
    for (const evidenceId of review.evidence_ids) {
      if (!evidenceIds.has(evidenceId)) {
        throw new SourceAdmissionError(
          `Review references unknown admission evidence: ${evidenceId}`
        );
      }
    }
  }
}

function validateEndpoint(endpoint: string) {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new SourceAdmissionError("Source Admission endpoint must be an absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SourceAdmissionError("Source Admission endpoint must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new SourceAdmissionError("Source Admission endpoint cannot contain credentials");
  }
  for (const name of parsed.searchParams.keys()) {
    if (/(?:authorization|cookie|password|secret|token|api[_-]?key)/iu.test(name)) {
      throw new SourceAdmissionError(
        `Source Admission endpoint cannot contain sensitive parameter: ${name}`
      );
    }
  }
}

function requireText(value: string, label: string) {
  if (value.trim().length === 0) throw new SourceAdmissionError(`${label} cannot be empty`);
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}
