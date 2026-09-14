import { createHash } from "node:crypto";

import type {
  ExtractedRecord,
  ExtractedRecordId,
  ExtractedRecruitmentContext,
  IdentityEvidence,
  IdentityEvidenceId,
  OpportunityContent,
  OpportunityRecruitmentContext,
  RecruitmentContextEvidenceLocator,
  RecruitmentEntityKind,
  RecruitmentIdentityClaim,
  SnapshotId,
  SourceDefinitionId
} from "../domain";
import {
  normalizeLocationName,
  normalizeTraceableText,
  normalizeUrl,
  parseDeterministicDate,
  parseRecruitmentYear
} from "./text-normalizer";

export interface NormalizedSourceRecord {
  readonly extracted_record_id: ExtractedRecordId;
  readonly snapshot_id: SnapshotId;
  readonly source_definition_id: SourceDefinitionId;
  readonly raw_source_record_id?: string;
  readonly source_local_record_key: string;
  readonly content: OpportunityContent;
  readonly identity_evidence: readonly IdentityEvidence[];
}

export const RECRUITMENT_CONTEXT_NORMALIZER_VERSION =
  "recruitment-context-normalizer/1.0.0";

export class SourceNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceNormalizationError";
  }
}

export function normalizeExtractedRecord(record: ExtractedRecord): NormalizedSourceRecord {
  if (!record.raw_organization_name) {
    throw new SourceNormalizationError("ExtractedRecord requires raw_organization_name");
  }
  if (!record.raw_title) {
    throw new SourceNormalizationError("ExtractedRecord requires raw_title");
  }

  const deadline = parseDeterministicDate(record.deadline);
  const normalizedRecruitmentContext = record.recruitment_context
    ? normalizeExtractedRecruitmentContext(record, record.recruitment_context)
    : null;
  const content: OpportunityContent = {
    organization: {
      name: normalizeTraceableText(record.raw_organization_name)
    },
    title: normalizeTraceableText(record.raw_title),
    description: record.raw_description
      ? normalizeTraceableText(record.raw_description)
      : undefined,
    requirement_text: record.raw_requirement_text
      ? normalizeTraceableText(record.raw_requirement_text)
      : undefined,
    locations: record.raw_location_text
      .map((location) => ({
        city: normalizeLocationName(location.text),
        raw_text: location,
        is_nationwide: normalizeLocationName(location.text) === "全国",
        normalization_confidence: 1
      }))
      .sort((left, right) => (left.city ?? "").localeCompare(right.city ?? "", "zh-CN")),
    recruitment_year: parseRecruitmentYear(record.recruitment_year),
    recruitment_batch: record.recruitment_batch
      ? normalizeTraceableText(record.recruitment_batch)
      : undefined,
    published_on: parseDeterministicDate(record.publish_time),
    application_window: record.deadline
      ? { closes_on: deadline, raw_text: record.deadline }
      : undefined,
    announcement_locator: record.announcement_url
      ? normalizeUrl(record.announcement_url)
      : undefined,
    application_locator: record.application_url
      ? normalizeUrl(record.application_url)
      : undefined,
    ...(normalizedRecruitmentContext
      ? { recruitment_context: normalizedRecruitmentContext.context }
      : {})
  };

  return {
    extracted_record_id: record.extracted_record_id,
    snapshot_id: record.snapshot_id,
    source_definition_id: record.source_definition_id,
    raw_source_record_id: record.raw_source_record_id
      ?? record.identity_candidates.find((candidate) => {
        return candidate.kind === "SOURCE_RECORD_ID" && candidate.confidence === "HIGH";
      })?.value,
    source_local_record_key: sourceLocalRecordKey(record),
    content,
    identity_evidence: normalizedRecruitmentContext?.evidence ?? []
  };
}

export function normalizeExtractedRecruitmentContext(
  record: ExtractedRecord,
  context: ExtractedRecruitmentContext
): {
  readonly context: OpportunityRecruitmentContext;
  readonly evidence: readonly IdentityEvidence[];
} {
  const evidence: IdentityEvidence[] = [];
  const normalizeClaim = (
    entityKind: RecruitmentEntityKind,
    claim: ExtractedRecruitmentContext["position"] | undefined
  ): RecruitmentIdentityClaim => {
    if (!claim) return unresolvedClaim();

    if (claim.identity_state === "CONFIRMED") {
      rejectSyntheticDefault(entityKind, claim.official_identifier.text);
      requireIdentityValue(entityKind, claim.official_identifier.text);
      const officialIdentifier = normalizeTraceableText(claim.official_identifier);
      const namespace = claim.identifier_namespace.trim();
      if (!namespace) {
        throw new SourceNormalizationError(
          `${entityKind} confirmed identity requires a non-empty namespace`
        );
      }
      const identityKey = stableIdentityKey(
        entityKind,
        namespace,
        officialIdentifier.normalized?.text ?? officialIdentifier.original.text
      );
      const identityEvidence = createIdentityEvidence(
        record,
        entityKind,
        claim.evidence_locator,
        claim.official_identifier,
        officialIdentifier.normalized,
        "EXPLICIT",
        "SUPPORTS_IDENTITY"
      );
      evidence.push(identityEvidence);
      return {
        identity_state: "CONFIRMED",
        identity_key: identityKey,
        official_identifier: officialIdentifier,
        identifier_namespace: namespace,
        identity_evidence_ids: [identityEvidence.identity_evidence_id]
      };
    }

    if (claim.identity_state === "PROVISIONAL") {
      rejectSyntheticDefault(entityKind, claim.source_local_identifier.text);
      requireIdentityValue(entityKind, claim.source_local_identifier.text);
      const sourceLocalIdentifier = normalizeTraceableText(
        claim.source_local_identifier
      );
      const identityKey = stableIdentityKey(
        entityKind,
        `source:${record.source_definition_id}`,
        sourceLocalIdentifier.normalized?.text
          ?? sourceLocalIdentifier.original.text
      );
      const identityEvidence = createIdentityEvidence(
        record,
        entityKind,
        claim.evidence_locator,
        claim.source_local_identifier,
        sourceLocalIdentifier.normalized,
        "PROVISIONAL",
        "SUPPORTS_IDENTITY"
      );
      evidence.push(identityEvidence);
      return {
        identity_state: "PROVISIONAL",
        identity_key: identityKey,
        source_local_identifier: sourceLocalIdentifier,
        identity_evidence_ids: [identityEvidence.identity_evidence_id]
      };
    }

    if (!claim.raw_text && !claim.evidence_locator) return unresolvedClaim();
    const normalized = claim.raw_text
      ? normalizeTraceableText(claim.raw_text)
      : undefined;
    const identityEvidence = createIdentityEvidence(
      record,
      entityKind,
      claim.evidence_locator ?? sourceRecordLocator(record),
      claim.raw_text,
      normalized?.normalized,
      "UNRESOLVED",
      "OBSERVES_UNRESOLVED"
    );
    evidence.push(identityEvidence);
    return {
      identity_state: "UNRESOLVED",
      identity_key: null,
      ...(normalized ? { raw_text: normalized } : {}),
      identity_evidence_ids: [identityEvidence.identity_evidence_id]
    };
  };

  const batch = context.recruitment_batch;
  return {
    context: {
      announcement: normalizeClaim("ANNOUNCEMENT", context.announcement),
      recruitment_plan: normalizeClaim(
        "RECRUITMENT_PLAN",
        context.recruitment_plan
      ),
      recruitment_batch: {
        applicability: batch?.applicability ?? "UNRESOLVED",
        identity: normalizeClaim("RECRUITMENT_BATCH", batch?.identity)
      },
      position: normalizeClaim("POSITION", context.position),
      opportunity: normalizeClaim("OPPORTUNITY", context.opportunity)
    },
    evidence
  };
}

function unresolvedClaim(): RecruitmentIdentityClaim {
  return {
    identity_state: "UNRESOLVED",
    identity_key: null,
    identity_evidence_ids: []
  };
}

function rejectSyntheticDefault(entityKind: RecruitmentEntityKind, value: string) {
  const normalized = value.trim().toUpperCase();
  if ((entityKind === "RECRUITMENT_PLAN" && normalized === "DEFAULT_PLAN")
      || (entityKind === "RECRUITMENT_BATCH" && normalized === "DEFAULT_BATCH")) {
    throw new SourceNormalizationError(
      `${entityKind} cannot use a synthetic default identity`
    );
  }
}

function requireIdentityValue(entityKind: RecruitmentEntityKind, value: string) {
  if (!value.trim()) {
    throw new SourceNormalizationError(
      `${entityKind} identity requires a non-empty observed value`
    );
  }
}

function stableIdentityKey(
  entityKind: RecruitmentEntityKind,
  namespace: string,
  value: string
) {
  return `${entityKind}:${hash(stableSerialize({ namespace, value }))}`;
}

function createIdentityEvidence(
  record: ExtractedRecord,
  entityKind: RecruitmentEntityKind,
  locator: RecruitmentContextEvidenceLocator,
  observedValue: IdentityEvidence["observed_value"],
  normalizedValue: IdentityEvidence["normalized_value"],
  certainty: IdentityEvidence["certainty"],
  decision: IdentityEvidence["decision"]
): IdentityEvidence {
  const identityEvidenceId = `identity-evidence:${hash(stableSerialize({
    entity_kind: entityKind,
    source_definition_id: record.source_definition_id,
    snapshot_id: record.snapshot_id,
    extracted_record_id: record.extracted_record_id,
    locator,
    observed_value: observedValue ?? null,
    resolver_version: RECRUITMENT_CONTEXT_NORMALIZER_VERSION
  }))}` as IdentityEvidenceId;
  return {
    identity_evidence_id: identityEvidenceId,
    entity_kind: entityKind,
    source_definition_id: record.source_definition_id,
    snapshot_id: record.snapshot_id,
    extracted_record_id: record.extracted_record_id,
    locator,
    ...(observedValue ? { observed_value: observedValue } : {}),
    ...(normalizedValue ? { normalized_value: normalizedValue } : {}),
    certainty,
    decision,
    resolver_version: RECRUITMENT_CONTEXT_NORMALIZER_VERSION
  };
}

function sourceRecordLocator(
  record: ExtractedRecord
): RecruitmentContextEvidenceLocator {
  return {
    kind: "SOURCE_RECORD",
    locator: stableSerialize(record.source_record_locator)
  };
}

function sourceLocalRecordKey(record: ExtractedRecord) {
  const sourceRecordId = record.raw_source_record_id
    ?? record.identity_candidates.find((candidate) => {
      return candidate.kind === "SOURCE_RECORD_ID" && candidate.confidence === "HIGH";
    })?.value;
  return `source-local-record:${hash(stableSerialize({
    source_definition_id: record.source_definition_id,
    source_record_id: sourceRecordId ?? null,
    source_record_locator: record.source_record_locator
  }))}`;
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

function hash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
