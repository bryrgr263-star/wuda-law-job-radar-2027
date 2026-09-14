import { createHash } from "node:crypto";

import type {
  CanonicalOpportunityId,
  IdentityEvidenceId,
  IdentityHash,
  IdentityReconciliation,
  IsoDate,
  IsoDateTime,
  NonEmptyReadonlyArray,
  OpportunityContent,
  OpportunityRecruitmentContext,
  OpportunityVersionId,
  Organization,
  OrganizationId,
  PositionId,
  RecruitmentBatchId,
  RecruitmentIdentityClaim,
  RecruitmentIdentityState,
  RecruitmentPlanId,
  SemanticHash,
  SourceOccurrenceVersionId,
  TraceableText
} from "../domain";
import type {
  CanonicalizationCandidate,
  CanonicalizationContext,
  CanonicalizationDecision,
  CanonicalizationReasonCode,
  CanonicalizationResult,
  CanonicalizedOpportunity
} from "./types";

export const CONSERVATIVE_CANONICALIZER_VERSION = "conservative-canonicalizer/2.0.0";

const authorityRank = {
  OFFICIAL: 0,
  AUTHORIZED: 1,
  THIRD_PARTY: 2,
  UNKNOWN: 3
} as const;

interface ResolvedCandidate {
  readonly candidate: CanonicalizationCandidate;
  readonly organization_id: OrganizationId | null;
  readonly employer_organization_id: OrganizationId | null;
  readonly title: string;
  readonly recruitment_year: number | null;
  readonly recruitment_batch: string | null;
  readonly locations: readonly string[];
  readonly published_on: IsoDate | null;
  readonly closes_on: IsoDate | null;
  readonly recruitment_context: OpportunityRecruitmentContext | null;
  readonly identity_evidence_valid: boolean;
  readonly has_separation_evidence: boolean;
  readonly location_identity_discriminators: readonly string[] | null;
}

export class CanonicalizationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationInputError";
  }
}

export class ConservativeCanonicalizer {
  canonicalize(
    candidates: readonly CanonicalizationCandidate[],
    context: CanonicalizationContext
  ): CanonicalizationResult {
    const resolved = candidates
      .map((candidate) => resolveCandidate(candidate, context))
      .sort((left, right) => versionId(left).localeCompare(versionId(right)));
    const rawDecisions = new Map<string, CanonicalizationDecision>();

    for (let leftIndex = 0; leftIndex < resolved.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < resolved.length; rightIndex += 1) {
        rawDecisions.set(
          pairKey(leftIndex, rightIndex),
          compareCandidates(resolved[leftIndex], resolved[rightIndex], context)
        );
      }
    }

    const groupedIndexes: number[][] = [];
    for (let candidateIndex = 0; candidateIndex < resolved.length; candidateIndex += 1) {
      const compatibleGroup = groupedIndexes.find((group) => group.every((memberIndex) => {
        return rawDecisions.get(pairKey(memberIndex, candidateIndex))?.outcome === "MERGE";
      }));
      if (compatibleGroup) compatibleGroup.push(candidateIndex);
      else groupedIndexes.push([candidateIndex]);
    }

    const groupByCandidate = new Map<number, number>();
    groupedIndexes.forEach((group, groupIndex) => {
      group.forEach((candidateIndex) => groupByCandidate.set(candidateIndex, groupIndex));
    });
    const decisions = [...rawDecisions.entries()].map(([key, rawDecision]) => {
      const [leftIndex, rightIndex] = key.split(":").map(Number);
      if (rawDecision.outcome !== "MERGE"
          || groupByCandidate.get(leftIndex) === groupByCandidate.get(rightIndex)) {
        return rawDecision;
      }
      return {
        ...rawDecision,
        outcome: "SEPARATE" as const,
        reason_codes: [
          ...rawDecision.reason_codes,
          "TRANSITIVE_MERGE_CONFLICT_BLOCKED" as const
        ],
        canonical_identity_hash: undefined
      };
    });

    const opportunities = groupedIndexes
      .map((indexes) => createCanonicalizedOpportunity(
        indexes.map((index) => resolved[index])
      ))
      .sort((left, right) => left.canonical_opportunity.identity_hash.localeCompare(
        right.canonical_opportunity.identity_hash
      ));

    return {
      opportunities: clone(opportunities),
      decisions: clone(decisions)
    };
  }
}

function resolveCandidate(
  candidate: CanonicalizationCandidate,
  context: CanonicalizationContext
): ResolvedCandidate {
  validateReferences(candidate, context.organizations);
  const content = candidate.version.content;
  const recruitmentContext = content.recruitment_context ?? null;
  return {
    candidate,
    organization_id: resolveOrganization(content, context.organizations),
    employer_organization_id: resolveEmployerOrganization(content),
    title: normalizedValue(content.title),
    recruitment_year: content.recruitment_year ?? null,
    recruitment_batch: content.recruitment_batch
      ? normalizedValue(content.recruitment_batch)
      : null,
    locations: normalizedLocations(content),
    published_on: content.published_on ?? null,
    closes_on: content.application_window?.closes_on ?? null,
    recruitment_context: recruitmentContext,
    identity_evidence_valid: recruitmentContext
      ? hasValidContextIdentityEvidence(candidate, recruitmentContext)
      : true,
    has_separation_evidence: candidate.version.identity_evidence?.some((evidence) => {
      return evidence.decision === "SUPPORTS_SEPARATION"
        || evidence.decision === "SPLIT_CANDIDATE";
    }) ?? false,
    location_identity_discriminators: recruitmentContext
      ? locationIdentityDiscriminators(content)
      : []
  };
}

function validateReferences(
  candidate: CanonicalizationCandidate,
  organizations: readonly Organization[]
) {
  if (candidate.version.source_occurrence_id !== candidate.occurrence.source_occurrence_id) {
    throw new CanonicalizationInputError(
      "SourceOccurrenceVersion must reference the supplied SourceOccurrence"
    );
  }
  if (candidate.occurrence.source_definition_id
      !== candidate.source_definition.source_definition_id) {
    throw new CanonicalizationInputError(
      "SourceOccurrence must reference the supplied SourceDefinition"
    );
  }
  if (!organizations.some((organization) => {
    return organization.organization_id === candidate.source_definition.publisher_organization_id;
  })) {
    throw new CanonicalizationInputError(
      "SourceDefinition publisher Organization must exist in the canonicalization context"
    );
  }
}

function compareCandidates(
  left: ResolvedCandidate,
  right: ResolvedCandidate,
  context: CanonicalizationContext
): CanonicalizationDecision {
  if (left.recruitment_context && right.recruitment_context) {
    return compareRecruitmentContextCandidates(left, right, context);
  }
  if (left.recruitment_context || right.recruitment_context) {
    if (hasConfirmedReconciliation(left, right, context.identity_reconciliations ?? [])) {
      return decision(left, right, "MERGE", ["EXPLICIT_RECONCILIATION_MATCH"],
        canonicalIdentityHashForContext(left.recruitment_context ? left : right));
    }
    return decision(left, right, "SEPARATE", [
      "LEGACY_CONTEXT_RECONCILIATION_MISSING"
    ]);
  }
  return compareLegacyCandidates(left, right);
}

function compareRecruitmentContextCandidates(
  left: ResolvedCandidate,
  right: ResolvedCandidate,
  context: CanonicalizationContext
): CanonicalizationDecision {
  if (left.has_separation_evidence || right.has_separation_evidence) {
    return decision(left, right, "SEPARATE", ["IDENTITY_EVIDENCE_CONFLICT"]);
  }
  if (!left.identity_evidence_valid || !right.identity_evidence_valid) {
    return decision(left, right, "SEPARATE", ["IDENTITY_EVIDENCE_INSUFFICIENT"]);
  }
  if (hasConfirmedReconciliation(left, right, context.identity_reconciliations ?? [])) {
    return decision(left, right, "MERGE", ["EXPLICIT_RECONCILIATION_MATCH"],
      canonicalIdentityHashForContext(left));
  }

  const reasons: CanonicalizationReasonCode[] = [];
  if (contextIdentityConflicts(left, right, reasons)) {
    return decision(left, right, "SEPARATE", reasons);
  }

  const leftContext = left.recruitment_context!;
  const rightContext = right.recruitment_context!;
  const leftOpportunityKey = confirmedKey(leftContext.opportunity);
  const rightOpportunityKey = confirmedKey(rightContext.opportunity);
  if (leftOpportunityKey && rightOpportunityKey
      && leftOpportunityKey === rightOpportunityKey) {
    reasons.push("OPPORTUNITY_IDENTITY_MATCH", "RECRUITMENT_CONTEXT_MATCH");
    return decision(left, right, "MERGE", reasons,
      canonicalIdentityHashForContext(left));
  }

  if (!requireConfirmedMatchingClaim(
    leftContext.position,
    rightContext.position,
    reasons,
    "POSITION_IDENTITY_MATCH",
    "POSITION_IDENTITY_PROVISIONAL",
    "POSITION_IDENTITY_UNRESOLVED"
  )) {
    return decision(left, right, "SEPARATE", reasons);
  }
  if (!requireConfirmedMatchingClaim(
    leftContext.recruitment_plan,
    rightContext.recruitment_plan,
    reasons,
    "RECRUITMENT_PLAN_IDENTITY_MATCH",
    "RECRUITMENT_PLAN_IDENTITY_PROVISIONAL",
    "RECRUITMENT_PLAN_IDENTITY_UNRESOLVED"
  )) {
    return decision(left, right, "SEPARATE", reasons);
  }
  if (!requireMatchingBatch(leftContext, rightContext, reasons)) {
    return decision(left, right, "SEPARATE", reasons);
  }
  if (!left.employer_organization_id || !right.employer_organization_id) {
    reasons.push("EMPLOYER_IDENTITY_UNRESOLVED");
    return decision(left, right, "SEPARATE", reasons);
  }
  reasons.push("EMPLOYER_IDENTITY_MATCH");
  if (!requireMatchingLocationDiscriminators(left, right, reasons)) {
    return decision(left, right, "SEPARATE", reasons);
  }

  reasons.push("RECRUITMENT_CONTEXT_MATCH");
  return decision(left, right, "MERGE", reasons,
    canonicalIdentityHashForContext(left));
}

function contextIdentityConflicts(
  left: ResolvedCandidate,
  right: ResolvedCandidate,
  reasons: CanonicalizationReasonCode[]
) {
  const leftContext = left.recruitment_context!;
  const rightContext = right.recruitment_context!;
  const claimConflicts = [
    [leftContext.opportunity, rightContext.opportunity,
      "OPPORTUNITY_IDENTITY_CONFLICT"],
    [leftContext.position, rightContext.position,
      "POSITION_IDENTITY_CONFLICT"],
    [leftContext.recruitment_plan, rightContext.recruitment_plan,
      "RECRUITMENT_PLAN_IDENTITY_CONFLICT"]
  ] as const;
  for (const [leftClaim, rightClaim, reason] of claimConflicts) {
    const leftKey = confirmedKey(leftClaim);
    const rightKey = confirmedKey(rightClaim);
    if (leftKey && rightKey && leftKey !== rightKey) reasons.push(reason);
  }

  const leftBatch = leftContext.recruitment_batch;
  const rightBatch = rightContext.recruitment_batch;
  if (leftBatch.applicability !== "UNRESOLVED"
      && rightBatch.applicability !== "UNRESOLVED"
      && leftBatch.applicability !== rightBatch.applicability) {
    reasons.push("RECRUITMENT_BATCH_APPLICABILITY_CONFLICT");
  }
  const leftBatchKey = confirmedKey(leftBatch.identity);
  const rightBatchKey = confirmedKey(rightBatch.identity);
  if (leftBatchKey && rightBatchKey && leftBatchKey !== rightBatchKey) {
    reasons.push("RECRUITMENT_BATCH_IDENTITY_CONFLICT");
  }
  if (left.employer_organization_id && right.employer_organization_id
      && left.employer_organization_id !== right.employer_organization_id) {
    reasons.push("EMPLOYER_IDENTITY_CONFLICT");
  }
  if (left.location_identity_discriminators
      && right.location_identity_discriminators
      && left.location_identity_discriminators.length > 0
      && right.location_identity_discriminators.length > 0
      && !sameArray(
        left.location_identity_discriminators,
        right.location_identity_discriminators
      )) {
    reasons.push("LOCATION_IDENTITY_DISCRIMINATOR_CONFLICT");
  }
  return reasons.length > 0;
}

function requireConfirmedMatchingClaim(
  left: RecruitmentIdentityClaim,
  right: RecruitmentIdentityClaim,
  reasons: CanonicalizationReasonCode[],
  matchReason: CanonicalizationReasonCode,
  provisionalReason: CanonicalizationReasonCode,
  unresolvedReason: CanonicalizationReasonCode
) {
  if (left.identity_state === "PROVISIONAL"
      || right.identity_state === "PROVISIONAL") {
    reasons.push(provisionalReason);
    return false;
  }
  if (left.identity_state !== "CONFIRMED"
      || right.identity_state !== "CONFIRMED") {
    reasons.push(unresolvedReason);
    return false;
  }
  reasons.push(matchReason);
  return left.identity_key === right.identity_key;
}

function requireMatchingBatch(
  left: OpportunityRecruitmentContext,
  right: OpportunityRecruitmentContext,
  reasons: CanonicalizationReasonCode[]
) {
  const leftBatch = left.recruitment_batch;
  const rightBatch = right.recruitment_batch;
  if (leftBatch.applicability === "UNRESOLVED"
      || rightBatch.applicability === "UNRESOLVED") {
    reasons.push("RECRUITMENT_BATCH_IDENTITY_UNRESOLVED");
    return false;
  }
  if (leftBatch.applicability !== rightBatch.applicability) {
    reasons.push("RECRUITMENT_BATCH_APPLICABILITY_CONFLICT");
    return false;
  }
  if (leftBatch.applicability === "NOT_APPLICABLE") {
    reasons.push("RECRUITMENT_BATCH_IDENTITY_MATCH");
    return true;
  }
  return requireConfirmedMatchingClaim(
    leftBatch.identity,
    rightBatch.identity,
    reasons,
    "RECRUITMENT_BATCH_IDENTITY_MATCH",
    "RECRUITMENT_BATCH_IDENTITY_PROVISIONAL",
    "RECRUITMENT_BATCH_IDENTITY_UNRESOLVED"
  );
}

function requireMatchingLocationDiscriminators(
  left: ResolvedCandidate,
  right: ResolvedCandidate,
  reasons: CanonicalizationReasonCode[]
) {
  const leftValues = left.location_identity_discriminators;
  const rightValues = right.location_identity_discriminators;
  if (leftValues === null || rightValues === null
      || (leftValues.length === 0) !== (rightValues.length === 0)) {
    reasons.push("LOCATION_IDENTITY_DISCRIMINATOR_UNRESOLVED");
    return false;
  }
  if (leftValues.length > 0) {
    if (!sameArray(leftValues, rightValues)) {
      reasons.push("LOCATION_IDENTITY_DISCRIMINATOR_CONFLICT");
      return false;
    }
    reasons.push("LOCATION_IDENTITY_DISCRIMINATOR_MATCH");
  }
  return true;
}

function compareLegacyCandidates(
  left: ResolvedCandidate,
  right: ResolvedCandidate
): CanonicalizationDecision {
  const reasons: CanonicalizationReasonCode[] = [];
  const conflict = compareLegacyRequiredIdentity(left, right, reasons);
  if (conflict) return decision(left, right, "SEPARATE", reasons);

  reasons.push("EXACT_ORGANIZATION_MATCH");
  reasons.push("EXACT_NORMALIZED_TITLE_MATCH");
  reasons.push("RECRUITMENT_YEAR_MATCH");
  reasons.push("RECRUITMENT_BATCH_MATCH");
  reasons.push("LOCATION_SET_MATCH");
  reasons.push("TIME_WINDOW_COMPATIBLE");
  const canonicalIdentityHash = canonicalIdentityHashForLegacy(left);
  return decision(left, right, "MERGE", reasons, canonicalIdentityHash);
}

function compareLegacyRequiredIdentity(
  left: ResolvedCandidate,
  right: ResolvedCandidate,
  reasons: CanonicalizationReasonCode[]
) {
  if (!left.organization_id || !right.organization_id) {
    reasons.push("ORGANIZATION_UNRESOLVED");
    return true;
  }
  if (left.organization_id !== right.organization_id) {
    reasons.push("ORGANIZATION_CONFLICT");
    return true;
  }
  if (!left.title || left.title !== right.title) {
    reasons.push("TITLE_CONFLICT");
    return true;
  }
  if (left.recruitment_year === null || right.recruitment_year === null) {
    reasons.push("RECRUITMENT_YEAR_MISSING");
    return true;
  }
  if (left.recruitment_year !== right.recruitment_year) {
    reasons.push("RECRUITMENT_YEAR_CONFLICT");
    return true;
  }
  if (!left.recruitment_batch || !right.recruitment_batch) {
    reasons.push("RECRUITMENT_BATCH_MISSING");
    return true;
  }
  if (left.recruitment_batch !== right.recruitment_batch) {
    reasons.push("RECRUITMENT_BATCH_CONFLICT");
    return true;
  }
  if (left.locations.length === 0 || right.locations.length === 0) {
    reasons.push("LOCATION_MISSING");
    return true;
  }
  if (!sameArray(left.locations, right.locations)) {
    reasons.push("LOCATION_CONFLICT");
    return true;
  }
  if (!left.published_on || !right.published_on || !left.closes_on || !right.closes_on) {
    reasons.push("TIME_WINDOW_MISSING");
    return true;
  }
  if (dateConflict(left.published_on, right.published_on)
      || dateConflict(left.closes_on, right.closes_on)) {
    reasons.push("TIME_WINDOW_CONFLICT");
    return true;
  }
  return false;
}

function decision(
  left: ResolvedCandidate,
  right: ResolvedCandidate,
  outcome: "MERGE" | "SEPARATE",
  reasonCodes: readonly CanonicalizationReasonCode[],
  canonicalIdentityHash?: IdentityHash
): CanonicalizationDecision {
  const resolvedOrganizationId = left.organization_id
    && left.organization_id === right.organization_id
    ? left.organization_id
    : undefined;
  return {
    left_source_occurrence_version_id: versionId(left),
    right_source_occurrence_version_id: versionId(right),
    outcome,
    reason_codes: [...reasonCodes],
    resolved_organization_id: resolvedOrganizationId,
    canonical_identity_hash: canonicalIdentityHash,
    resolver_version: CONSERVATIVE_CANONICALIZER_VERSION
  };
}

function createCanonicalizedOpportunity(
  group: readonly ResolvedCandidate[]
): CanonicalizedOpportunity {
  const selected = [...group].sort(compareAuthority)[0];
  const identityHash = canonicalIdentityHashForGroup(group);
  const canonicalOpportunityId =
    `canonical-opportunity:${identityHash}` as CanonicalOpportunityId;
  const sourceVersionIds = group
    .map((item) => versionId(item))
    .sort() as unknown as NonEmptyReadonlyArray<SourceOccurrenceVersionId>;
  const selectedContent = clone(selected.candidate.version.content);
  const content: OpportunityContent = selected.organization_id
    ? {
        ...selectedContent,
        organization: {
          ...selectedContent.organization,
          organization_id: selected.organization_id
        }
      }
    : selectedContent;
  const identityEvidenceIds = aggregateIdentityEvidenceIds(group);
  const contextual = selected.recruitment_context
    ? selected
    : group.find((item) => item.recruitment_context);

  return {
    canonical_opportunity: {
      canonical_opportunity_id: canonicalOpportunityId,
      identity_hash: identityHash,
      ...(contextual
        ? {
            identity_state: contextualIdentityState(contextual),
            identity_basis: contextualIdentityBasis(contextual),
            identity_evidence_ids: identityEvidenceIds
          }
        : {
            identity_state: "PROVISIONAL" as const,
            identity_basis: {
              kind: "LEGACY_COMPARISON" as const,
              legacy_identity_hash: identityHash
            }
          }),
      created_at: earliestObservedAt(group)
    },
    opportunity_version: {
      opportunity_version_id:
        `opportunity-version:${identityHash}:1` as OpportunityVersionId,
      canonical_opportunity_id: canonicalOpportunityId,
      revision: 1,
      semantic_hash: selected.candidate.version.semantic_hash as SemanticHash,
      content,
      source_occurrence_version_ids: sourceVersionIds,
      ...(contextual ? { identity_evidence_ids: identityEvidenceIds } : {}),
      effective_from: earliestObservedAt(group)
    }
  };
}

function contextualIdentityBasis(candidate: ResolvedCandidate) {
  const context = candidate.recruitment_context!;
  const planKey = context.recruitment_plan.identity_key;
  const batchKey = context.recruitment_batch.identity.identity_key;
  return {
    kind: "RECRUITMENT_CONTEXT" as const,
    position_id: positionIdFor(candidate),
    ...(planKey
      ? { recruitment_plan_id: entityId("recruitment-plan", planKey) as RecruitmentPlanId }
      : {}),
    ...(batchKey
      ? { recruitment_batch_id: entityId("recruitment-batch", batchKey) as RecruitmentBatchId }
      : {}),
    ...(context.opportunity.identity_state === "CONFIRMED"
      ? { official_opportunity_identity_key: context.opportunity.identity_key }
      : {})
  };
}

function contextualIdentityState(candidate: ResolvedCandidate): RecruitmentIdentityState {
  const context = candidate.recruitment_context!;
  if (context.position.identity_state === "UNRESOLVED") return "UNRESOLVED";
  const authoritative = candidate.candidate.source_definition.authority_level === "OFFICIAL"
    || candidate.candidate.source_definition.authority_level === "AUTHORIZED";
  if (context.opportunity.identity_state === "CONFIRMED" && authoritative) {
    return "CONFIRMED";
  }
  if (context.position.identity_state === "CONFIRMED"
      && context.recruitment_plan.identity_state === "CONFIRMED"
      && batchContextIsConfirmed(context)
      && candidate.employer_organization_id
      && candidate.identity_evidence_valid
      && authoritative) {
    return "CONFIRMED";
  }
  return "PROVISIONAL";
}

function batchContextIsConfirmed(context: OpportunityRecruitmentContext) {
  return context.recruitment_batch.applicability === "NOT_APPLICABLE"
    || (context.recruitment_batch.applicability === "APPLICABLE"
      && context.recruitment_batch.identity.identity_state === "CONFIRMED");
}

function canonicalIdentityHashForGroup(group: readonly ResolvedCandidate[]) {
  const contextual = group.find((item) => item.recruitment_context);
  if (contextual) {
    const baseIdentityHash = canonicalIdentityHashForContext(contextual);
    if (group.length > 1 || contextualIdentityState(contextual) === "CONFIRMED") {
      return baseIdentityHash;
    }
    return sha256(stableSerialize({
      canonical_basis_hash: baseIdentityHash,
      source_occurrence_id: contextual.candidate.occurrence.source_occurrence_id
    })) as IdentityHash;
  }
  const baseIdentityHash = canonicalIdentityHashForLegacy(group[0]);
  if (group.length > 1) return baseIdentityHash;
  return sha256(stableSerialize({
    canonical_basis_hash: baseIdentityHash,
    source_occurrence_id: group[0].candidate.occurrence.source_occurrence_id
  })) as IdentityHash;
}

function canonicalIdentityHashForContext(candidate: ResolvedCandidate) {
  const context = candidate.recruitment_context!;
  if (context.opportunity.identity_state === "CONFIRMED") {
    return sha256(stableSerialize({
      kind: "OFFICIAL_OPPORTUNITY_IDENTITY",
      opportunity_identity_key: context.opportunity.identity_key
    })) as IdentityHash;
  }
  return sha256(stableSerialize({
    kind: "RECRUITMENT_CONTEXT",
    position_identity_key: contextPositionKey(candidate),
    recruitment_plan_identity_key: context.recruitment_plan.identity_key,
    recruitment_batch_applicability: context.recruitment_batch.applicability,
    recruitment_batch_identity_key: context.recruitment_batch.identity.identity_key
  })) as IdentityHash;
}

function canonicalIdentityHashForLegacy(candidate: ResolvedCandidate) {
  if (!candidate.organization_id
      || !candidate.title
      || candidate.recruitment_year === null
      || !candidate.recruitment_batch
      || candidate.locations.length === 0) {
    return sha256(stableSerialize({
      source_occurrence_id: candidate.candidate.occurrence.source_occurrence_id
    })) as IdentityHash;
  }
  return sha256(stableSerialize({
    organization_id: candidate.organization_id,
    title: candidate.title,
    recruitment_year: candidate.recruitment_year,
    recruitment_batch: candidate.recruitment_batch,
    locations: candidate.locations
  })) as IdentityHash;
}

function hasValidContextIdentityEvidence(
  candidate: CanonicalizationCandidate,
  context: OpportunityRecruitmentContext
) {
  const evidenceById = new Map(
    (candidate.version.identity_evidence ?? []).map((evidence) => [
      evidence.identity_evidence_id,
      evidence
    ])
  );
  const claims: readonly [RecruitmentIdentityClaim, string][] = [
    [context.announcement, "ANNOUNCEMENT"],
    [context.recruitment_plan, "RECRUITMENT_PLAN"],
    [context.recruitment_batch.identity, "RECRUITMENT_BATCH"],
    [context.position, "POSITION"],
    [context.opportunity, "OPPORTUNITY"]
  ];
  return claims.every(([claim, entityKind]) => {
    if (claim.identity_state === "UNRESOLVED") {
      return claim.identity_evidence_ids.every((id) => {
        const evidence = evidenceById.get(id);
        return evidence?.entity_kind === entityKind
          && evidence.source_occurrence_version_id
            === candidate.version.source_occurrence_version_id
          && evidence.decision === "OBSERVES_UNRESOLVED";
      });
    }
    return claim.identity_evidence_ids.length > 0
      && claim.identity_evidence_ids.every((id) => {
        const evidence = evidenceById.get(id);
        return evidence?.entity_kind === entityKind
          && evidence.source_occurrence_version_id
            === candidate.version.source_occurrence_version_id
          && evidence.decision === "SUPPORTS_IDENTITY"
          && (evidence.certainty === "EXPLICIT"
            || evidence.certainty === "CORROBORATED"
            || (claim.identity_state === "PROVISIONAL"
              && evidence.certainty === "PROVISIONAL"));
      });
  });
}

function hasConfirmedReconciliation(
  left: ResolvedCandidate,
  right: ResolvedCandidate,
  reconciliations: readonly IdentityReconciliation[]
) {
  const leftReferences = candidateIdentityReferences(left);
  const rightReferences = candidateIdentityReferences(right);
  return reconciliations.some((reconciliation) => {
    if (reconciliation.state !== "CONFIRMED"
        || !["MERGE", "CORRECTION"].includes(reconciliation.reconciliation_kind)
        || reconciliation.evidence_ids.length === 0) {
      return false;
    }
    const from = new Set(reconciliation.from.map(identityReferenceKey));
    const to = new Set(reconciliation.to.map(identityReferenceKey));
    return (leftReferences.some((reference) => from.has(reference))
        && rightReferences.some((reference) => to.has(reference)))
      || (rightReferences.some((reference) => from.has(reference))
        && leftReferences.some((reference) => to.has(reference)));
  });
}

function candidateIdentityReferences(candidate: ResolvedCandidate) {
  const references: string[] = [];
  if (candidate.recruitment_context) {
    references.push(identityReferenceKey({
      kind: "POSITION",
      id: positionIdFor(candidate)
    }));
    references.push(identityReferenceKey({
      kind: "OPPORTUNITY",
      id: (
        `canonical-opportunity:${canonicalIdentityHashForContext(candidate)}`
      ) as CanonicalOpportunityId
    }));
  }
  if (candidate.candidate.legacy_canonical_opportunity_id) {
    references.push(identityReferenceKey({
      kind: "OPPORTUNITY",
      id: candidate.candidate.legacy_canonical_opportunity_id
    }));
  }
  return references;
}

function identityReferenceKey(reference: IdentityReconciliation["from"][number]) {
  return `${reference.kind}:${reference.id}`;
}

function positionIdFor(candidate: ResolvedCandidate) {
  return entityId("position", contextPositionKey(candidate)) as PositionId;
}

function contextPositionKey(candidate: ResolvedCandidate) {
  const contextKey = candidate.recruitment_context?.position.identity_key;
  if (contextKey) return contextKey;
  if (candidate.candidate.occurrence.identity_basis.kind === "RECRUITMENT_CONTEXT") {
    return candidate.candidate.occurrence.identity_basis.position_identity_key;
  }
  return `source-occurrence:${candidate.candidate.occurrence.source_occurrence_id}`;
}

function entityId(prefix: string, identityKey: string) {
  return `${prefix}:${sha256(identityKey)}`;
}

function confirmedKey(claim: RecruitmentIdentityClaim) {
  return claim.identity_state === "CONFIRMED" ? claim.identity_key : null;
}

function aggregateIdentityEvidenceIds(group: readonly ResolvedCandidate[]) {
  return [...new Set(group.flatMap((item) => {
    return item.candidate.version.identity_evidence?.map((evidence) => {
      return evidence.identity_evidence_id;
    }) ?? [];
  }))].sort() as IdentityEvidenceId[];
}

function resolveEmployerOrganization(content: OpportunityContent) {
  const employerIds = [...new Set((content.organization_role_assignments ?? [])
    .filter((assignment) => {
      return assignment.role === "EMPLOYER_ENTITY"
        && assignment.identity_state === "CONFIRMED"
        && assignment.organization_id;
    })
    .map((assignment) => assignment.organization_id!))];
  return employerIds.length === 1 ? employerIds[0] : null;
}

function locationIdentityDiscriminators(content: OpportunityContent) {
  const discriminators = (content.location_assignments ?? [])
    .filter((assignment) => assignment.identity_discriminator);
  if (discriminators.some((assignment) => assignment.identity_state !== "CONFIRMED")) {
    return null;
  }
  return discriminators.map((assignment) => stableSerialize({
    role: assignment.role,
    assignment_mode: assignment.assignment_mode,
    locations: assignment.locations.map((location) => ({
      country: location.country ?? null,
      province: location.province ?? null,
      city: location.city ?? null,
      district: location.district ?? null,
      raw_text: location.raw_text.text
    }))
  })).sort();
}

function resolveOrganization(
  content: OpportunityContent,
  organizations: readonly Organization[]
) {
  const referenceId = content.organization.organization_id;
  if (referenceId) {
    return organizations.some((organization) => organization.organization_id === referenceId)
      ? referenceId
      : null;
  }
  const sourceName = normalizedValue(content.organization.name);
  const matches = organizations.filter((organization) => {
    return organizationNames(organization).includes(sourceName);
  });
  return matches.length === 1 ? matches[0].organization_id : null;
}

function organizationNames(organization: Organization) {
  return [organization.name, ...organization.aliases].map(normalizedValue);
}

function normalizedLocations(content: OpportunityContent) {
  return [...new Set(content.locations.map((location) => {
    return location.city ?? location.district ?? location.province ?? location.country
      ?? location.raw_text.text;
  }))].sort();
}

function normalizedValue(value: TraceableText) {
  return value.normalized?.text ?? value.original.text;
}

function dateConflict(left: IsoDate | null, right: IsoDate | null) {
  return left !== null && right !== null && left !== right;
}

function sameArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function compareAuthority(left: ResolvedCandidate, right: ResolvedCandidate) {
  const rank = authorityRank[left.candidate.source_definition.authority_level]
    - authorityRank[right.candidate.source_definition.authority_level];
  if (rank !== 0) return rank;
  return versionId(left).localeCompare(versionId(right));
}

function earliestObservedAt(group: readonly ResolvedCandidate[]) {
  return group
    .map((item) => item.candidate.version.first_observed_at)
    .sort()[0] as IsoDateTime;
}

function versionId(candidate: ResolvedCandidate) {
  return candidate.candidate.version.source_occurrence_version_id;
}

function pairKey(leftIndex: number, rightIndex: number) {
  return leftIndex < rightIndex
    ? `${leftIndex}:${rightIndex}`
    : `${rightIndex}:${leftIndex}`;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => {
      return `${JSON.stringify(key)}:${stableSerialize(record[key])}`;
    }).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}
