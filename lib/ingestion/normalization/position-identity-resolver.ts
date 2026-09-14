import {
  POSITION_IDENTITY_CONTRACT_VERSION,
  PositionContractValidationError,
  type ExtractedRecordV2,
  type IdentityEvidence,
  type IdentityEvidenceId,
  type IdentityReconciliation,
  type MaterializedSourceOccurrenceVersion,
  type Position,
  type PositionId,
  type PositionIdentityBasis,
  type RecruitmentEndpoint,
  type Snapshot,
  type SourceOccurrence
} from "../domain";
import {
  positionIdForIdentityBasis,
  positionIdentityHashFor,
  validateIdentityReconciliation,
  validatePosition
} from "../domain/recruitment-context";
import {
  SourceOccurrenceMaterializationError,
  validateSourceOccurrenceVersionBinding
} from "./source-occurrence-materializer";

export interface ValidatedPositionIdentitySource {
  readonly endpoint: RecruitmentEndpoint;
  readonly occurrence: SourceOccurrence;
  readonly version: MaterializedSourceOccurrenceVersion;
  readonly extracted_record: ExtractedRecordV2;
  readonly snapshot: Snapshot;
}

export interface PositionReconciliationResolutionInput {
  readonly reconciliation: IdentityReconciliation;
  readonly related_sources: readonly ValidatedPositionIdentitySource[];
}

export interface PositionIdentityResolutionInput
  extends ValidatedPositionIdentitySource {
  readonly reconciliation?: PositionReconciliationResolutionInput;
}

export const POSITION_IDENTITY_RESOLUTION_REASONS = [
  "POSITION_CONTEXT_MISSING",
  "POSITION_IDENTITY_UNRESOLVED",
  "RECONCILIATION_REVIEW_REQUIRED"
] as const;

export type PositionIdentityResolutionReason =
  (typeof POSITION_IDENTITY_RESOLUTION_REASONS)[number];

export type PositionIdentityResolution =
  | {
      readonly status: "RESOLVED";
      readonly identity_state: Position["identity_state"];
      readonly position: Position;
      readonly reason_codes: readonly [];
    }
  | {
      readonly status: "REVIEW_REQUIRED";
      readonly identity_state: "UNRESOLVED";
      readonly position: null;
      readonly reason_codes: readonly PositionIdentityResolutionReason[];
    };

export function resolvePositionIdentity(
  input: PositionIdentityResolutionInput
): PositionIdentityResolution {
  const primary = validateSource(input);
  if (input.reconciliation) {
    return resolveReconciliation(primary, input.reconciliation);
  }

  const context = primary.version.content.recruitment_context;
  if (!context) {
    return reviewRequired("POSITION_CONTEXT_MISSING");
  }
  const claim = context.position;
  if (claim.identity_state === "UNRESOLVED") {
    return reviewRequired("POSITION_IDENTITY_UNRESOLVED");
  }
  const identityEvidenceIds = positionEvidenceIds(
    [primary],
    claim.identity_evidence_ids
  );
  const planIdentityState = context.recruitment_plan.identity_state;

  if (claim.identity_state === "CONFIRMED") {
    const basis: PositionIdentityBasis = {
      kind: "OFFICIAL_POSITION_CODE",
      source_definition_id: primary.occurrence.source_definition_id,
      position_code_namespace: claim.identifier_namespace,
      official_position_code: semanticText(claim.official_identifier)
    };
    return resolvedPosition({
      basis,
      identity_state: "CONFIRMED",
      plan_identity_state: planIdentityState,
      official_position_code: claim.official_identifier,
      position_code_namespace: claim.identifier_namespace,
      identity_evidence_ids: identityEvidenceIds,
      created_at: primary.version.first_observed_at
    });
  }

  const sourceLocalRecordKey = semanticText(claim.source_local_identifier);
  const basis: PositionIdentityBasis = {
    kind: "SOURCE_LOCAL_RECORD",
    source_definition_id: primary.occurrence.source_definition_id,
    source_occurrence_id: primary.occurrence.source_occurrence_id,
    source_local_record_key: sourceLocalRecordKey
  };
  return resolvedPosition({
    basis,
    identity_state: "PROVISIONAL",
    plan_identity_state: planIdentityState,
    source_local_record_identifier: claim.source_local_identifier,
    identity_evidence_ids: identityEvidenceIds,
    created_at: primary.version.first_observed_at
  });
}

function resolveReconciliation(
  primary: ValidatedPositionIdentitySource,
  input: PositionReconciliationResolutionInput
): PositionIdentityResolution {
  const relatedSources = input.related_sources.map(validateSource);
  const sources = uniqueSources([primary, ...relatedSources]);
  const reconciliation = validateIdentityReconciliation(input.reconciliation);
  if (reconciliation.state === "REVIEW_REQUIRED") {
    return reviewRequired("RECONCILIATION_REVIEW_REQUIRED");
  }
  if (reconciliation.state !== "CONFIRMED") {
    throw new PositionContractValidationError(
      "Position reconciliation state is not supported"
    );
  }
  const references = [...reconciliation.from, ...reconciliation.to];
  if (references.some((reference) => reference.kind !== "POSITION")) {
    throw new PositionContractValidationError(
      "Position reconciliation may contain only Position references"
    );
  }
  const reconciledPositionIds = uniqueSorted(
    references.map((reference) => reference.id as PositionId)
  );
  if (reconciledPositionIds.length === 0) {
    throw new PositionContractValidationError(
      "Position reconciliation requires Position references"
    );
  }
  const identityEvidenceIds = positionEvidenceIds(
    sources,
    reconciliation.evidence_ids
  );
  const basis: PositionIdentityBasis = {
    kind: "EXPLICIT_RECONCILIATION",
    identity_reconciliation_id: reconciliation.identity_reconciliation_id,
    reconciled_position_ids: asNonEmpty(reconciledPositionIds),
    identity_evidence_ids: asNonEmpty(identityEvidenceIds)
  };
  return resolvedPosition({
    basis,
    identity_state: "CONFIRMED",
    plan_identity_state:
      primary.version.content.recruitment_context?.recruitment_plan.identity_state
        ?? "UNRESOLVED",
    identity_evidence_ids: identityEvidenceIds,
    created_at: sources
      .map((source) => source.version.first_observed_at)
      .sort()[0]!
  });
}

function validateSource(
  input: ValidatedPositionIdentitySource
): ValidatedPositionIdentitySource {
  if (
    !input
    || typeof input !== "object"
    || !input.endpoint
    || !input.occurrence
    || !input.version
    || !input.extracted_record
    || !input.snapshot
  ) {
    throw new SourceOccurrenceMaterializationError(
      "Position identity resolution requires a complete validated SOV input"
    );
  }
  validateSourceOccurrenceVersionBinding(input);
  return input;
}

function positionEvidenceIds(
  sources: readonly ValidatedPositionIdentitySource[],
  requiredIds: readonly IdentityEvidenceId[]
) {
  const ids = uniqueSorted(requiredIds);
  if (ids.length === 0) {
    throw new PositionContractValidationError(
      "Position identity resolution requires Position Evidence"
    );
  }
  const evidenceById = new Map<IdentityEvidenceId, IdentityEvidence>();
  for (const source of sources) {
    for (const evidence of source.version.identity_evidence) {
      if (evidence.entity_kind === "POSITION") {
        evidenceById.set(evidence.identity_evidence_id, evidence);
      }
    }
  }
  if (ids.some((id) => !evidenceById.has(id))) {
    throw new PositionContractValidationError(
      "Position identity Evidence must belong to an independently validated SOV"
    );
  }
  return ids;
}

function resolvedPosition(input: {
  readonly basis: PositionIdentityBasis;
  readonly identity_state: "CONFIRMED" | "PROVISIONAL";
  readonly plan_identity_state: Position["plan_identity_state"];
  readonly official_position_code?: Position["official_position_code"];
  readonly position_code_namespace?: string;
  readonly source_local_record_identifier?: Position["source_local_record_identifier"];
  readonly identity_evidence_ids: readonly IdentityEvidenceId[];
  readonly created_at: Position["created_at"];
}): PositionIdentityResolution {
  const identityHash = positionIdentityHashFor(input.basis);
  const position = validatePosition({
    position_id: positionIdForIdentityBasis(input.basis),
    identity_state: input.identity_state,
    identity_basis: input.basis,
    identity_hash: identityHash,
    identity_resolver_version: POSITION_IDENTITY_CONTRACT_VERSION,
    plan_identity_state: input.plan_identity_state,
    ...(input.official_position_code
      ? { official_position_code: input.official_position_code }
      : {}),
    ...(input.position_code_namespace
      ? { position_code_namespace: input.position_code_namespace }
      : {}),
    ...(input.source_local_record_identifier
      ? { source_local_record_identifier: input.source_local_record_identifier }
      : {}),
    identity_evidence_ids: uniqueSorted(input.identity_evidence_ids),
    created_at: input.created_at
  });
  return {
    status: "RESOLVED",
    identity_state: position.identity_state,
    position,
    reason_codes: []
  };
}

function reviewRequired(
  reason: PositionIdentityResolutionReason
): PositionIdentityResolution {
  return {
    status: "REVIEW_REQUIRED",
    identity_state: "UNRESOLVED",
    position: null,
    reason_codes: [reason]
  };
}

function semanticText(value: {
  readonly original: { readonly text: string };
  readonly normalized?: { readonly text: string };
}) {
  return (value.normalized?.text ?? value.original.text).trim();
}

function uniqueSources(
  sources: readonly ValidatedPositionIdentitySource[]
) {
  const byVersionId = new Map(
    sources.map((source) => [source.version.source_occurrence_version_id, source])
  );
  return [...byVersionId.values()];
}

function uniqueSorted<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)].sort();
}

function asNonEmpty<Value>(values: readonly Value[]): readonly [Value, ...Value[]] {
  if (values.length === 0) {
    throw new PositionContractValidationError("A non-empty identity list is required");
  }
  return values as readonly [Value, ...Value[]];
}
