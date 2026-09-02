import {
  SOURCE_ADMISSION_ENDPOINT_PURPOSES,
  SOURCE_PROHIBITED_ACTIONS,
  type SourceAdmission,
  type SourceAdmissionEvidenceId,
  type SourceAdmissionId
} from "./types";

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

  if (admission.admission_decision === "APPROVED") {
    validateApprovedAdmission(admission);
  }
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

function validateApprovedAdmission(admission: SourceAdmission) {
  if (!phaseTwoApprovedSourceTypes.has(admission.source_type)) {
    throw new SourceAdmissionError(
      `P2 cannot approve source type: ${admission.source_type}`
    );
  }
  if (admission.source_authority !== "OFFICIAL" && admission.source_authority !== "AUTHORIZED") {
    throw new SourceAdmissionError("P2 approved sources must be OFFICIAL or AUTHORIZED");
  }
  if (admission.robots.status !== "ALLOWED" || admission.terms.status !== "ALLOWED") {
    throw new SourceAdmissionError("P2 approved sources require allowed robots and terms reviews");
  }
  if (admission.login_requirement !== "NONE" || admission.captcha !== "NONE_OBSERVED") {
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
  if (!admission.review_records.some((review) => review.decision === "APPROVED")) {
    throw new SourceAdmissionError("P2 approved sources require an APPROVED review record");
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
    requireText(evidence.locator, "Admission evidence locator");
    requireText(evidence.summary.text, "Admission evidence summary");
  }
  if (!ids.has(admission.robots.evidence_id) || !ids.has(admission.terms.evidence_id)) {
    throw new SourceAdmissionError("Robots and terms reviews must reference admission evidence");
  }
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
