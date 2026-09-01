import { createHash } from "node:crypto";

import type {
  CanonicalOpportunityId,
  IdentityHash,
  IsoDate,
  IsoDateTime,
  NonEmptyReadonlyArray,
  OpportunityContent,
  OpportunityVersionId,
  Organization,
  OrganizationId,
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

export const CONSERVATIVE_CANONICALIZER_VERSION = "conservative-canonicalizer/1.0.0";

const authorityRank = {
  OFFICIAL: 0,
  AUTHORIZED: 1,
  THIRD_PARTY: 2,
  UNKNOWN: 3
} as const;

interface ResolvedCandidate {
  readonly candidate: CanonicalizationCandidate;
  readonly organization_id: OrganizationId | null;
  readonly title: string;
  readonly recruitment_year: number | null;
  readonly recruitment_batch: string | null;
  readonly locations: readonly string[];
  readonly published_on: IsoDate | null;
  readonly closes_on: IsoDate | null;
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
    const resolved = candidates.map((candidate) => resolveCandidate(candidate, context));
    const parent = resolved.map((_, index) => index);
    const decisions: CanonicalizationDecision[] = [];

    for (let leftIndex = 0; leftIndex < resolved.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < resolved.length; rightIndex += 1) {
        const decision = compareCandidates(resolved[leftIndex], resolved[rightIndex]);
        decisions.push(decision);
        if (decision.outcome === "MERGE") union(parent, leftIndex, rightIndex);
      }
    }

    const groups = new Map<number, ResolvedCandidate[]>();
    for (let index = 0; index < resolved.length; index += 1) {
      const root = find(parent, index);
      const group = groups.get(root) ?? [];
      group.push(resolved[index]);
      groups.set(root, group);
    }

    const opportunities = [...groups.values()]
      .map(createCanonicalizedOpportunity)
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
  return {
    candidate,
    organization_id: resolveOrganization(content, context.organizations),
    title: normalizedValue(content.title),
    recruitment_year: content.recruitment_year ?? null,
    recruitment_batch: content.recruitment_batch
      ? normalizedValue(content.recruitment_batch)
      : null,
    locations: normalizedLocations(content),
    published_on: content.published_on ?? null,
    closes_on: content.application_window?.closes_on ?? null
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
  right: ResolvedCandidate
): CanonicalizationDecision {
  const reasons: CanonicalizationReasonCode[] = [];
  const conflict = compareRequiredIdentity(left, right, reasons);
  if (conflict) {
    return decision(left, right, "SEPARATE", reasons);
  }

  reasons.push("EXACT_ORGANIZATION_MATCH");
  reasons.push("EXACT_NORMALIZED_TITLE_MATCH");
  reasons.push("RECRUITMENT_YEAR_MATCH");
  reasons.push("RECRUITMENT_BATCH_MATCH");
  reasons.push("LOCATION_SET_MATCH");
  reasons.push("TIME_WINDOW_COMPATIBLE");
  const canonicalIdentityHash = canonicalIdentityHashFor(left);
  return decision(left, right, "MERGE", reasons, canonicalIdentityHash);
}

function compareRequiredIdentity(
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
    left_source_occurrence_version_id:
      left.candidate.version.source_occurrence_version_id,
    right_source_occurrence_version_id:
      right.candidate.version.source_occurrence_version_id,
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
  const sourceVersionIds = group
    .map((item) => item.candidate.version.source_occurrence_version_id)
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

  return {
    canonical_opportunity: {
      canonical_opportunity_id: `canonical-opportunity:${identityHash}` as CanonicalOpportunityId,
      identity_hash: identityHash,
      created_at: earliestObservedAt(group)
    },
    opportunity_version: {
      opportunity_version_id: `opportunity-version:${identityHash}:1` as OpportunityVersionId,
      canonical_opportunity_id:
        `canonical-opportunity:${identityHash}` as CanonicalOpportunityId,
      revision: 1,
      semantic_hash: selected.candidate.version.semantic_hash as SemanticHash,
      content,
      source_occurrence_version_ids: sourceVersionIds,
      effective_from: earliestObservedAt(group)
    }
  };
}

function canonicalIdentityHashForGroup(group: readonly ResolvedCandidate[]) {
  const baseIdentityHash = canonicalIdentityHashFor(group[0]);
  if (group.length > 1) return baseIdentityHash;
  return sha256(stableSerialize({
    canonical_basis_hash: baseIdentityHash,
    source_occurrence_id: group[0].candidate.occurrence.source_occurrence_id
  })) as IdentityHash;
}

function canonicalIdentityHashFor(candidate: ResolvedCandidate) {
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
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareAuthority(left: ResolvedCandidate, right: ResolvedCandidate) {
  const rank = authorityRank[left.candidate.source_definition.authority_level]
    - authorityRank[right.candidate.source_definition.authority_level];
  if (rank !== 0) return rank;
  return left.candidate.version.source_occurrence_version_id.localeCompare(
    right.candidate.version.source_occurrence_version_id
  );
}

function earliestObservedAt(group: readonly ResolvedCandidate[]) {
  return group
    .map((item) => item.candidate.version.first_observed_at)
    .sort()[0] as IsoDateTime;
}

function find(parent: number[], index: number): number {
  if (parent[index] !== index) parent[index] = find(parent, parent[index]);
  return parent[index];
}

function union(parent: number[], left: number, right: number) {
  const leftRoot = find(parent, left);
  const rightRoot = find(parent, right);
  if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
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
