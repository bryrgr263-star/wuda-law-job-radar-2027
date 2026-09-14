import type {
  ExtractedRecordId,
  IsoDateTime,
  OpportunityCandidate,
  OpportunityCandidateId,
  OpportunityCandidateSubjectObservation,
  PrePolicyRecallDispositionStatus,
  RecallDisposition,
  RecallDispositionId,
  RecallExclusionRuleReference,
  RecruitmentEndpointId,
  SnapshotId,
  SourceDefinitionId,
  SourceOccurrenceVersionId
} from "../domain";
import {
  OPPORTUNITY_CANDIDATE_SCHEMA_VERSION,
  RECALL_DISPOSITION_SCHEMA_VERSION,
  RECALL_DISPOSITION_STATUSES
} from "../domain";
import {
  CanonicalArtifactRegistryError,
  canonicalHash,
  canonicalSerialize,
  createCanonicalArtifactRegistryAuthority
} from "./canonical-artifact-registry";

export interface OpportunityDiscoveryRegistrationInput {
  readonly source_definition_id: SourceDefinitionId;
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly discovery_locator: string;
  readonly snapshot_id: SnapshotId | null;
  readonly extracted_record_id: ExtractedRecordId | null;
  readonly source_occurrence_version_id: SourceOccurrenceVersionId | null;
  readonly publisher_subject: OpportunityCandidateSubjectObservation | null;
  readonly discovery_evidence_ids: readonly string[];
  readonly first_observed_at: IsoDateTime;
  readonly initial_disposition: {
    readonly status: PrePolicyRecallDispositionStatus;
    readonly reason_codes: readonly string[];
    readonly evidence_ids: readonly string[];
    readonly decided_at: IsoDateTime;
  };
}

export interface RecallDispositionRevisionInput {
  readonly opportunity_candidate_id: OpportunityCandidateId;
  readonly status: PrePolicyRecallDispositionStatus;
  readonly reason_codes: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly decided_at: IsoDateTime;
}

export interface ApprovedRecallExclusionInput {
  readonly opportunity_candidate_id: OpportunityCandidateId;
  readonly decided_at: IsoDateTime;
}

export interface OpportunityRecallRegistrationResult {
  readonly registration_status: "SEALED" | "IDEMPOTENT_REUSE";
  readonly candidate: OpportunityCandidate;
  readonly disposition: RecallDisposition;
}

export interface RecallDispositionRevisionResult {
  readonly version_created: boolean;
  readonly disposition: RecallDisposition;
}

export interface TrustedOpportunityCandidateResolver {
  resolve(opportunityCandidateId: OpportunityCandidateId): OpportunityCandidate | null;
}

export interface TrustedRecallDispositionResolver {
  resolve(recallDispositionId: RecallDispositionId): RecallDisposition | null;
  resolveCurrent(opportunityCandidateId: OpportunityCandidateId): RecallDisposition | null;
  list(opportunityCandidateId: OpportunityCandidateId): readonly RecallDisposition[];
}

export interface ApprovedRecallExclusionPolicy {
  readonly policy_id: string;
  readonly policy_version: string;
}

export interface OpportunityRecallBoundary {
  register(input: OpportunityDiscoveryRegistrationInput): OpportunityRecallRegistrationResult;
  recordDisposition(input: RecallDispositionRevisionInput): RecallDispositionRevisionResult;
  recordApprovedExclusion(input: ApprovedRecallExclusionInput): RecallDispositionRevisionResult;
  readonly candidates: TrustedOpportunityCandidateResolver;
  readonly dispositions: TrustedRecallDispositionResolver;
}

interface OpportunityRecallRegistration {
  readonly candidate: OpportunityCandidate;
  readonly initial_disposition: RecallDisposition;
}

interface InternalApprovedRecallExclusionPolicy extends ApprovedRecallExclusionPolicy {
  decide(candidate: OpportunityCandidate): RecallExclusionRuleReference | null;
}

const trustedCandidateResolvers = new WeakSet<object>();
const trustedDispositionResolvers = new WeakSet<object>();
const approvedExclusionPolicies = new WeakSet<object>();

const APPROVED_CONSTRUCTION_SUBJECT_RULES = [
  {
    identities: [
      "organization:中国建筑",
      "organization:中国建筑集团有限公司",
      "organization:中国建筑股份有限公司"
    ],
    rule_id: "recall-exclusion:construction-subject:china-state-construction"
  },
  {
    identities: [
      "organization:中国中铁",
      "organization:中国中铁股份有限公司"
    ],
    rule_id: "recall-exclusion:construction-subject:china-railway-group"
  },
  {
    identities: [
      "organization:中国铁建",
      "organization:中国铁建股份有限公司"
    ],
    rule_id: "recall-exclusion:construction-subject:china-railway-construction"
  },
  {
    identities: [
      "organization:中交",
      "organization:中国交通建设股份有限公司"
    ],
    rule_id: "recall-exclusion:construction-subject:china-communications-construction"
  }
] as const;

export class OpportunityRecallRegistryError extends Error {
  readonly code:
    | "INVALID_INPUT"
    | "IDENTITY_COLLISION"
    | "CANDIDATE_NOT_FOUND"
    | "EXCLUSION_POLICY_NOT_AVAILABLE"
    | "EXCLUSION_NOT_APPROVED";

  constructor(code: OpportunityRecallRegistryError["code"], message: string) {
    super(message);
    this.name = "OpportunityRecallRegistryError";
    this.code = code;
  }
}

export function createApprovedRecallExclusionPolicyV1(): ApprovedRecallExclusionPolicy {
  const policy: InternalApprovedRecallExclusionPolicy = Object.freeze({
    policy_id: "approved-product-recall-exclusions",
    policy_version: "1.0.0",
    decide(candidate: OpportunityCandidate) {
      const subject = candidate.publisher_subject;
      if (!subject) return null;
      const rule = APPROVED_CONSTRUCTION_SUBJECT_RULES.find((candidateRule) => {
        return (candidateRule.identities as readonly string[]).includes(
          subject.subject_identity
        );
      });
      if (!rule) return null;
      return {
        policy_id: policy.policy_id,
        policy_version: policy.policy_version,
        rule_id: rule.rule_id,
        rule_version: "1.0.0",
        reason_code: "PRODUCT_SCOPE_EXCLUDED_CONSTRUCTION_SUBJECT",
        matched_subject_identity: subject.subject_identity
      };
    }
  });
  approvedExclusionPolicies.add(policy);
  return policy;
}

export function createInMemoryOpportunityRecallBoundary(options?: {
  readonly exclusion_policy?: ApprovedRecallExclusionPolicy;
}): OpportunityRecallBoundary {
  const exclusionPolicy = (options?.exclusion_policy ?? null) as
    InternalApprovedRecallExclusionPolicy | null;
  if (exclusionPolicy) assertApprovedRecallExclusionPolicy(exclusionPolicy);
  const registrations = createCanonicalArtifactRegistryAuthority<
    OpportunityCandidateId,
    OpportunityRecallRegistration
  >((registration) => registration.candidate.opportunity_candidate_id);
  const revisions = createCanonicalArtifactRegistryAuthority<
    RecallDispositionId,
    RecallDisposition
  >((disposition) => disposition.recall_disposition_id);
  const dispositionIdsByCandidate = new Map<
    OpportunityCandidateId,
    RecallDispositionId[]
  >();
  const candidateIdByInitialDisposition = new Map<
    RecallDispositionId,
    OpportunityCandidateId
  >();

  const resolveDisposition = (recallDispositionId: RecallDispositionId) => {
    const candidateId = candidateIdByInitialDisposition.get(recallDispositionId);
    if (candidateId) {
      const registration = registrations.resolver.resolve(candidateId);
      return registration
        ? assertRecallDispositionIntegrity(registration.initial_disposition)
        : null;
    }
    const disposition = revisions.resolver.resolve(recallDispositionId);
    return disposition ? assertRecallDispositionIntegrity(disposition) : null;
  };

  const candidates: TrustedOpportunityCandidateResolver = Object.freeze({
    resolve(opportunityCandidateId: OpportunityCandidateId) {
      const registration = registrations.resolver.resolve(opportunityCandidateId);
      return registration
        ? assertOpportunityCandidateIntegrity(registration.candidate)
        : null;
    }
  });

  const dispositions: TrustedRecallDispositionResolver = Object.freeze({
    resolve: resolveDisposition,
    resolveCurrent(opportunityCandidateId: OpportunityCandidateId) {
      const ids = dispositionIdsByCandidate.get(opportunityCandidateId) ?? [];
      const currentId = ids.at(-1);
      return currentId ? resolveDisposition(currentId) : null;
    },
    list(opportunityCandidateId: OpportunityCandidateId) {
      return (dispositionIdsByCandidate.get(opportunityCandidateId) ?? []).map((id) => {
        const disposition = resolveDisposition(id);
        if (!disposition) {
          throw invalid("Recall disposition index is internally incomplete");
        }
        return disposition;
      });
    }
  });

  trustedCandidateResolvers.add(candidates as object);
  trustedDispositionResolvers.add(dispositions as object);

  const appendDisposition = (input: {
    readonly opportunity_candidate_id: OpportunityCandidateId;
    readonly status: RecallDisposition["status"];
    readonly reason_codes: readonly string[];
    readonly evidence_ids: readonly string[];
    readonly exclusion_rule: RecallExclusionRuleReference | null;
    readonly decided_at: IsoDateTime;
  }): RecallDispositionRevisionResult => {
    const candidate = candidates.resolve(input.opportunity_candidate_id);
    if (!candidate) {
      throw new OpportunityRecallRegistryError(
        "CANDIDATE_NOT_FOUND",
        `OpportunityCandidate is unavailable: ${input.opportunity_candidate_id}`
      );
    }
    const existing = dispositions.list(input.opportunity_candidate_id);
    const replay = existing.find((disposition) => sameDispositionCommand(
      disposition,
      input
    ));
    if (replay) return { version_created: false, disposition: replay };
    const previous = existing.at(-1);
    if (!previous) {
      throw invalid("OpportunityCandidate is missing its initial RecallDisposition");
    }
    const disposition = dispositionFor({
      ...input,
      revision: previous.revision + 1,
      supersedes_recall_disposition_id: previous.recall_disposition_id
    });
    validateDispositionForCandidate(candidate, disposition);
    let sealed;
    try {
      sealed = revisions.writer.seal(disposition.recall_disposition_id, disposition);
    } catch (error) {
      throw translateCollision(error, disposition.recall_disposition_id);
    }
    if (sealed.status === "SEALED") {
      dispositionIdsByCandidate.get(candidate.opportunity_candidate_id)!.push(
        disposition.recall_disposition_id
      );
    }
    return {
      version_created: sealed.status === "SEALED",
      disposition: assertRecallDispositionIntegrity(sealed.artifact)
    };
  };

  const boundary: OpportunityRecallBoundary = {
    register(input) {
      const candidate = candidateFor(input);
      const initialDisposition = dispositionFor({
        opportunity_candidate_id: candidate.opportunity_candidate_id,
        revision: 1,
        status: requirePrePolicyStatus(input.initial_disposition.status),
        reason_codes: input.initial_disposition.reason_codes,
        evidence_ids: input.initial_disposition.evidence_ids,
        exclusion_rule: null,
        decided_at: input.initial_disposition.decided_at,
        supersedes_recall_disposition_id: null
      });
      validateDispositionForCandidate(candidate, initialDisposition);
      let sealed;
      try {
        sealed = registrations.writer.seal(candidate.opportunity_candidate_id, {
          candidate,
          initial_disposition: initialDisposition
        });
      } catch (error) {
        throw translateCollision(error, candidate.opportunity_candidate_id);
      }
      const sealedCandidate = assertOpportunityCandidateIntegrity(sealed.artifact.candidate);
      const sealedDisposition = assertRecallDispositionIntegrity(
        sealed.artifact.initial_disposition
      );
      if (sealed.status === "SEALED") {
        dispositionIdsByCandidate.set(sealedCandidate.opportunity_candidate_id, [
          sealedDisposition.recall_disposition_id
        ]);
        candidateIdByInitialDisposition.set(
          sealedDisposition.recall_disposition_id,
          sealedCandidate.opportunity_candidate_id
        );
      }
      return {
        registration_status: sealed.status,
        candidate: sealedCandidate,
        disposition: sealedDisposition
      };
    },
    recordDisposition(input) {
      return appendDisposition({
        ...input,
        status: requirePrePolicyStatus(input.status),
        exclusion_rule: null
      });
    },
    recordApprovedExclusion(input) {
      if (!exclusionPolicy) {
        throw new OpportunityRecallRegistryError(
          "EXCLUSION_POLICY_NOT_AVAILABLE",
          "The composition root did not install an approved exclusion policy"
        );
      }
      const candidate = candidates.resolve(input.opportunity_candidate_id);
      if (!candidate) {
        throw new OpportunityRecallRegistryError(
          "CANDIDATE_NOT_FOUND",
          `OpportunityCandidate is unavailable: ${input.opportunity_candidate_id}`
        );
      }
      const decision = exclusionPolicy.decide(candidate);
      if (!decision || !candidate.publisher_subject) {
        throw new OpportunityRecallRegistryError(
          "EXCLUSION_NOT_APPROVED",
          "OpportunityCandidate does not match an approved exact exclusion rule"
        );
      }
      return appendDisposition({
        opportunity_candidate_id: candidate.opportunity_candidate_id,
        status: "EXCLUDED",
        reason_codes: [decision.reason_code],
        evidence_ids: [candidate.publisher_subject.evidence_id],
        exclusion_rule: decision,
        decided_at: input.decided_at
      });
    },
    candidates,
    dispositions
  };
  return Object.freeze(boundary);
}

export function assertApprovedRecallExclusionPolicy(
  policy: ApprovedRecallExclusionPolicy
) {
  if (!approvedExclusionPolicies.has(policy as object)) {
    throw new OpportunityRecallRegistryError(
      "EXCLUSION_POLICY_NOT_AVAILABLE",
      "Recall exclusion policy must be an approved composition-root capability"
    );
  }
  return policy;
}

export function assertTrustedOpportunityCandidateResolver(
  resolver: TrustedOpportunityCandidateResolver
) {
  if (!trustedCandidateResolvers.has(resolver as object)) {
    throw invalid("OpportunityCandidate resolver must be composition-root controlled");
  }
  return resolver;
}

export function assertTrustedRecallDispositionResolver(
  resolver: TrustedRecallDispositionResolver
) {
  if (!trustedDispositionResolvers.has(resolver as object)) {
    throw invalid("RecallDisposition resolver must be composition-root controlled");
  }
  return resolver;
}

export function assertOpportunityCandidateIntegrity(
  candidate: OpportunityCandidate
): OpportunityCandidate {
  validateCandidate(candidate);
  const { integrity_hash: integrityHash, ...canonical } = candidate;
  if (integrityHash !== canonicalHash(canonical)) {
    throw invalid("OpportunityCandidate integrity hash does not match canonical content");
  }
  if (candidate.opportunity_candidate_id !== candidateIdFor(candidate)) {
    throw invalid("OpportunityCandidate ID does not match discovery provenance");
  }
  return structuredClone(candidate);
}

export function assertRecallDispositionIntegrity(
  disposition: RecallDisposition
): RecallDisposition {
  validateDisposition(disposition);
  const { integrity_hash: integrityHash, ...canonical } = disposition;
  if (integrityHash !== canonicalHash(canonical)) {
    throw invalid("RecallDisposition integrity hash does not match canonical content");
  }
  if (disposition.recall_disposition_id !== dispositionIdFor(
    disposition.opportunity_candidate_id,
    disposition.revision
  )) {
    throw invalid("RecallDisposition ID does not match Candidate and revision");
  }
  return structuredClone(disposition);
}

function candidateFor(input: OpportunityDiscoveryRegistrationInput): OpportunityCandidate {
  const discoveryLocator = requireText(input.discovery_locator, "Discovery locator");
  const firstObservedAt = requireDate(input.first_observed_at, "First observed at");
  const candidateWithoutIntegrity = {
    opportunity_candidate_id: candidateIdFor({
      ...input,
      discovery_locator: discoveryLocator,
      first_observed_at: firstObservedAt
    }),
    source_definition_id: input.source_definition_id,
    recruitment_endpoint_id: input.recruitment_endpoint_id,
    discovery_locator: discoveryLocator,
    snapshot_id: input.snapshot_id,
    extracted_record_id: input.extracted_record_id,
    source_occurrence_version_id: input.source_occurrence_version_id,
    publisher_subject: normalizePublisherSubject(input.publisher_subject),
    discovery_evidence_ids: uniqueSorted(input.discovery_evidence_ids, "Discovery Evidence"),
    first_observed_at: firstObservedAt,
    schema_version: OPPORTUNITY_CANDIDATE_SCHEMA_VERSION
  } as const;
  const candidate = {
    ...candidateWithoutIntegrity,
    integrity_hash: canonicalHash(candidateWithoutIntegrity)
  };
  validateCandidate(candidate);
  return candidate;
}

function dispositionFor(input: {
  readonly opportunity_candidate_id: OpportunityCandidateId;
  readonly revision: number;
  readonly status: RecallDisposition["status"];
  readonly reason_codes: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly exclusion_rule: RecallExclusionRuleReference | null;
  readonly decided_at: IsoDateTime;
  readonly supersedes_recall_disposition_id: RecallDispositionId | null;
}): RecallDisposition {
  const dispositionWithoutIntegrity = {
    recall_disposition_id: dispositionIdFor(
      input.opportunity_candidate_id,
      input.revision
    ),
    opportunity_candidate_id: input.opportunity_candidate_id,
    revision: input.revision,
    status: input.status,
    reason_codes: uniqueSorted(input.reason_codes, "Recall reason codes"),
    evidence_ids: uniqueSorted(input.evidence_ids, "Recall Evidence"),
    exclusion_rule: input.exclusion_rule ? structuredClone(input.exclusion_rule) : null,
    decided_at: requireDate(input.decided_at, "Recall decision time"),
    supersedes_recall_disposition_id: input.supersedes_recall_disposition_id,
    schema_version: RECALL_DISPOSITION_SCHEMA_VERSION
  } as const;
  const disposition = {
    ...dispositionWithoutIntegrity,
    integrity_hash: canonicalHash(dispositionWithoutIntegrity)
  };
  validateDisposition(disposition);
  return disposition;
}

function validateCandidate(candidate: OpportunityCandidate) {
  requireText(candidate.source_definition_id, "SourceDefinition ID");
  requireText(candidate.recruitment_endpoint_id, "RecruitmentEndpoint ID");
  requireText(candidate.discovery_locator, "Discovery locator");
  requireDate(candidate.first_observed_at, "First observed at");
  uniqueSorted(candidate.discovery_evidence_ids, "Discovery Evidence");
  const publisherSubject = normalizePublisherSubject(candidate.publisher_subject);
  if (publisherSubject
      && !candidate.discovery_evidence_ids.includes(publisherSubject.evidence_id)) {
    throw invalid("Publisher subject evidence must be part of discovery provenance");
  }
  if (candidate.schema_version !== OPPORTUNITY_CANDIDATE_SCHEMA_VERSION) {
    throw invalid("OpportunityCandidate schema version is unsupported");
  }
  if (candidate.extracted_record_id && !candidate.snapshot_id) {
    throw invalid("ExtractedRecord provenance requires a Snapshot");
  }
  if (candidate.source_occurrence_version_id && !candidate.extracted_record_id) {
    throw invalid("SOV provenance requires an ExtractedRecord");
  }
}

function validateDisposition(disposition: RecallDisposition) {
  requireText(disposition.opportunity_candidate_id, "OpportunityCandidate ID");
  if (!Number.isInteger(disposition.revision) || disposition.revision < 1) {
    throw invalid("RecallDisposition revision must be a positive integer");
  }
  if (!RECALL_DISPOSITION_STATUSES.includes(disposition.status)) {
    throw invalid("RecallDisposition status is unsupported");
  }
  uniqueSorted(disposition.reason_codes, "Recall reason codes");
  uniqueSorted(disposition.evidence_ids, "Recall Evidence");
  requireDate(disposition.decided_at, "Recall decision time");
  if (disposition.schema_version !== RECALL_DISPOSITION_SCHEMA_VERSION) {
    throw invalid("RecallDisposition schema version is unsupported");
  }
  if ((disposition.status === "EXCLUDED") !== (disposition.exclusion_rule !== null)) {
    throw invalid("Only EXCLUDED dispositions may carry an approved exclusion rule");
  }
  if (disposition.revision === 1 && disposition.supersedes_recall_disposition_id !== null) {
    throw invalid("Initial RecallDisposition cannot supersede another revision");
  }
  if (disposition.revision > 1 && !disposition.supersedes_recall_disposition_id) {
    throw invalid("Later RecallDisposition must supersede the previous revision");
  }
}

function validateDispositionForCandidate(
  candidate: OpportunityCandidate,
  disposition: RecallDisposition
) {
  if (candidate.opportunity_candidate_id !== disposition.opportunity_candidate_id) {
    throw invalid("RecallDisposition must reference its OpportunityCandidate");
  }
  if (disposition.status === "ACQUISITION_UNSUPPORTED"
      && (candidate.snapshot_id
        || candidate.extracted_record_id
        || candidate.source_occurrence_version_id)) {
    throw invalid("Acquisition-unsupported Candidate cannot claim acquired artifacts");
  }
  if (disposition.status === "PARSING_UNSUPPORTED"
      && (!candidate.snapshot_id
        || candidate.extracted_record_id
        || candidate.source_occurrence_version_id)) {
    throw invalid("Parsing-unsupported Candidate requires only acquired Snapshot provenance");
  }
  if ((disposition.status === "RETAINED" || disposition.status === "IDENTITY_UNCERTAIN")
      && (!candidate.snapshot_id || !candidate.extracted_record_id)) {
    throw invalid(`${disposition.status} Candidate requires extracted source provenance`);
  }
}

function requirePrePolicyStatus(
  status: RecallDisposition["status"]
): PrePolicyRecallDispositionStatus {
  if (status === "EXCLUDED") {
    throw new OpportunityRecallRegistryError(
      "EXCLUSION_POLICY_NOT_AVAILABLE",
      "EXCLUDED is available only through the approved exclusion policy capability"
    );
  }
  return status;
}

function candidateIdFor(input: {
  readonly source_definition_id: SourceDefinitionId;
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly discovery_locator: string;
  readonly first_observed_at: IsoDateTime;
}) {
  return `opportunity-candidate:${canonicalHash({
    source_definition_id: input.source_definition_id,
    recruitment_endpoint_id: input.recruitment_endpoint_id,
    discovery_locator: input.discovery_locator,
    first_observed_at: input.first_observed_at
  })}` as OpportunityCandidateId;
}

function dispositionIdFor(opportunityCandidateId: OpportunityCandidateId, revision: number) {
  return `recall-disposition:${canonicalHash({
    opportunity_candidate_id: opportunityCandidateId,
    revision
  })}` as RecallDispositionId;
}

function sameDispositionCommand(
  disposition: RecallDisposition,
  input: {
    readonly status: RecallDisposition["status"];
    readonly reason_codes: readonly string[];
    readonly evidence_ids: readonly string[];
    readonly exclusion_rule: RecallExclusionRuleReference | null;
    readonly decided_at: IsoDateTime;
  }
) {
  return canonicalSerialize({
    status: disposition.status,
    reason_codes: disposition.reason_codes,
    evidence_ids: disposition.evidence_ids,
    exclusion_rule: disposition.exclusion_rule,
    decided_at: disposition.decided_at
  }) === canonicalSerialize({
    status: input.status,
    reason_codes: uniqueSorted(input.reason_codes, "Recall reason codes"),
    evidence_ids: uniqueSorted(input.evidence_ids, "Recall Evidence"),
    exclusion_rule: input.exclusion_rule,
    decided_at: requireDate(input.decided_at, "Recall decision time")
  });
}

function normalizePublisherSubject(
  subject: OpportunityCandidateSubjectObservation | null
): OpportunityCandidateSubjectObservation | null {
  if (!subject) return null;
  return {
    subject_identity: requireText(subject.subject_identity, "Publisher subject identity"),
    subject_display_name: requireText(
      subject.subject_display_name,
      "Publisher subject display name"
    ),
    evidence_id: requireText(subject.evidence_id, "Publisher subject evidence")
  };
}

function uniqueSorted(values: readonly string[], label: string) {
  if (values.length === 0 || values.some((value) => !value.trim())) {
    throw invalid(`${label} must contain non-empty references`);
  }
  return [...new Set(values.map((value) => value.trim()))].sort();
}

function requireText<Value extends string>(value: Value, label: string): Value {
  if (!value.trim()) throw invalid(`${label} is required`);
  return value;
}

function requireDate<Value extends string>(value: Value, label: string): Value {
  requireText(value, label);
  if (Number.isNaN(Date.parse(value))) throw invalid(`${label} must be an ISO timestamp`);
  return value;
}

function invalid(message: string) {
  return new OpportunityRecallRegistryError("INVALID_INPUT", message);
}

function translateCollision(error: unknown, identity: string): Error {
  if (error instanceof CanonicalArtifactRegistryError
      && error.code === "IDENTITY_COLLISION") {
    return new OpportunityRecallRegistryError(
      "IDENTITY_COLLISION",
      `Recall artifact identity collision: ${identity}`
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}
