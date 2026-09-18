import type {
  IdentityReconciliation,
  PositionVersionId,
  PresentationDecisionId,
  PositionId,
  IsoDateTime,
  SourceCompositionResultId,
  SourceOccurrenceVersionId
} from "../domain";
import {
  InMemoryPositionBoundOpportunityTracker,
  InMemoryPositionVersionTracker,
  InMemoryTrustedSourceOccurrenceTracker,
  createInMemoryOpportunityRecallBoundary,
  resolvePositionIdentity,
  type ApprovedRecallExclusionInput,
  type ApprovedRecallExclusionPolicy,
  type OpportunityDiscoveryRegistrationInput,
  type PositionIdentityResolutionInput,
  type RecallDispositionRevisionInput,
  type TrustedOpportunityCandidateResolver,
  type TrustedPositionBoundOpportunityResolver,
  type TrustedRecallDispositionResolver,
  type TrustedSourceOccurrenceArtifact,
  type TrustedSourceOccurrenceMaterializationInput,
  type TrustedSourceOccurrenceVersionResolver
} from "../normalization";
import { SOVDiscoverySupportError, type SOVDiscoverySupportCommand } from "../normalization/source-discovery-support";
import {
  canonicalHash,
  canonicalSerialize
} from "../normalization/canonical-artifact-registry";
import {
  InMemoryLegalEmploymentRelevanceTracker,
  type LegalEmploymentRelevanceCommand
} from "./legal-employment-relevance";
import {
  createPresentationDecisionBoundary,
  type PresentationDecisionCommand
} from "./presentation-decision";
import { createPresentationReadModelMaterializer } from "./presentation-read-model";
import { PresentationSemanticProjectionError } from "./presentation-semantic-projection";
import {
  createTrustedArtifactChain,
  type TrustedArtifactChain,
  type TrustedEligibilityAssessmentCommand,
  type TrustedEligibilityAssessmentResolver,
  type TrustedPredicateResolutionResolver,
  type TrustedPredicateResolutionCommand,
  type TrustedSourceCompositionCommand
} from "./trusted-artifact-chain";
import type {
  CandidateProfileEvidenceMaterializationCommand,
  IssueCandidateEvidenceCommand,
  TrustedCandidateEvidenceResolver,
  TrustedCandidateEvidenceSourceVerifier
} from "./trusted-candidate-evidence";
import type { TrustedRequirementSetVersionResolver } from
  "./position-bound-requirement-set";
import type { TrustedSourceCompositionResolver } from
  "./position-bound-source-composition";
import type { TrustedRequirementProjectionResolver } from
  "./trusted-requirement-projection";
import type { TrustedLegalEmploymentRelevanceResolver } from
  "./legal-employment-relevance";
import type { TrustedPresentationDecisionResolver } from
  "./presentation-decision";
import {
  TrustedRestorationError,
  assertTrustedRestorationExecution,
  assertTrustedArtifactEnvelopeIntegrity,
  assertTrustedRestorationSequence,
  createTrustedRestorationRecord,
  type TrustedPresentationReadModelProjection,
  type TrustedRestorationArtifactEnvelope,
  type TrustedRestorationArtifactSeal,
  type TrustedRestorationJournalRepository,
  type TrustedRestorationProvenance,
  type TrustedRestorationScope,
  type TrustedRestorationRecord
} from "./trusted-chain-restoration";

export interface TrustedPositionIdentitySourceReference {
  readonly source_occurrence_version_id: SourceOccurrenceVersionId;
  readonly reconciliation?: {
    readonly reconciliation: IdentityReconciliation;
    readonly related_source_occurrence_version_ids:
      readonly SourceOccurrenceVersionId[];
  };
}

export type TrustedChainCommand =
  | {
      readonly kind: "SOURCE_OCCURRENCE_MATERIALIZE";
      readonly input: TrustedSourceOccurrenceMaterializationInput;
    }
  | {
      readonly kind: "SOURCE_DISCOVERY_SUPPORT_VERIFY";
      readonly input: SOVDiscoverySupportCommand;
    }
  | {
      readonly kind: "OPPORTUNITY_REGISTER";
      readonly source_binding?: { readonly kind: "ORIGINAL_ISSUANCE" }
        | { readonly kind: "VERIFIED_DISCOVERY_SUPPORT"; readonly support_id: string };
      readonly input: OpportunityDiscoveryRegistrationInput;
    }
  | {
      readonly kind: "RECALL_DISPOSITION_RECORD";
      readonly input: RecallDispositionRevisionInput;
    }
  | {
      readonly kind: "RECALL_APPROVED_EXCLUSION_RECORD";
      readonly input: ApprovedRecallExclusionInput;
    }
  | {
      readonly kind: "POSITION_VERSION_MATERIALIZE";
      readonly source_references: readonly TrustedPositionIdentitySourceReference[];
    }
  | {
      readonly kind: "PBOV_MATERIALIZE";
      readonly position_version_id: PositionVersionId;
      readonly source_references: readonly TrustedPositionIdentitySourceReference[];
    }
  | {
      readonly kind: "SOURCE_COMPOSITION_MATERIALIZE";
      readonly input: TrustedSourceCompositionCommand;
    }
  | {
      readonly kind: "LEGAL_RELEVANCE_ASSESS";
      readonly input: LegalEmploymentRelevanceCommand;
    }
  | {
      readonly kind: "REQUIREMENT_PROJECTION_MATERIALIZE";
      readonly source_composition_id: SourceCompositionResultId;
    }
  | {
      readonly kind: "REQUIREMENT_SET_MATERIALIZE";
      readonly source_composition_id: SourceCompositionResultId;
    }
  | {
      readonly kind: "CANDIDATE_EVIDENCE_ISSUE";
      readonly input: IssueCandidateEvidenceCommand;
    }
  | {
      readonly kind: "CANDIDATE_EVIDENCE_MATERIALIZE_SYNTHETIC";
      readonly input: CandidateProfileEvidenceMaterializationCommand;
    }
  | {
      readonly kind: "PREDICATE_RESOLUTION_MATERIALIZE";
      readonly input: TrustedPredicateResolutionCommand;
    }
  | {
      readonly kind: "ELIGIBILITY_MATERIALIZE";
      readonly input: TrustedEligibilityAssessmentCommand;
    }
  | {
      readonly kind: "PRESENTATION_DECIDE";
      readonly input: PresentationDecisionCommand;
    }
  | {
      readonly kind: "PRESENTATION_MIGRATE_V1";
      readonly input: { readonly position_id: PositionId; readonly anchored_input_head: string;
        readonly actor: string; readonly created_at: IsoDateTime };
    }
  | {
      readonly kind: "PRESENTATION_READ_MODEL_MATERIALIZE";
      readonly presentation_decision_id: PresentationDecisionId;
    };

export interface TrustedChainExecutionMetadata {
  readonly actor: string;
  readonly recorded_at: string;
}

export interface TrustedChainCompositionRoot {
  readonly scope: TrustedRestorationScope;
  readonly resolvers: {
    readonly source_occurrences: TrustedSourceOccurrenceVersionResolver
      & Pick<InMemoryTrustedSourceOccurrenceTracker, "resolveSupport" | "resolveForDiscovery">;
    readonly opportunity_candidates: TrustedOpportunityCandidateResolver;
    readonly recall_dispositions: TrustedRecallDispositionResolver;
    readonly position_versions: Pick<InMemoryPositionVersionTracker, "resolve">;
    readonly position_bound_opportunities: TrustedPositionBoundOpportunityResolver;
    readonly source_compositions: TrustedSourceCompositionResolver;
    readonly relevance: TrustedLegalEmploymentRelevanceResolver;
    readonly requirement_projections: Pick<
      TrustedRequirementProjectionResolver,
      "resolve"
    >;
    readonly requirement_sets: TrustedRequirementSetVersionResolver;
    readonly candidate_evidence: TrustedCandidateEvidenceResolver;
    readonly predicate_resolutions: TrustedPredicateResolutionResolver;
    readonly eligibility_assessments: TrustedEligibilityAssessmentResolver;
    readonly presentation_decisions: TrustedPresentationDecisionResolver;
    readonly presentation_read_models: Pick<
      ReturnType<typeof createPresentationReadModelMaterializer>,
      "resolve"
    >;
  };
  execute(
    command: TrustedChainCommand,
    metadata: TrustedChainExecutionMetadata
  ): Promise<unknown>;
}

export interface TrustedChainBootstrapResult {
  readonly root: TrustedChainCompositionRoot;
  readonly restored_record_count: number;
}

export async function bootstrapTrustedChainCompositionRoot(options: {
  readonly scope: TrustedRestorationScope;
  readonly restoration_journal: TrustedRestorationJournalRepository<TrustedChainCommand>;
  readonly recall_exclusion_policy?: ApprovedRecallExclusionPolicy;
  readonly candidate_evidence_source_verifier?: TrustedCandidateEvidenceSourceVerifier;
  readonly anchored_history_head?: string;
}): Promise<TrustedChainBootstrapResult> {
  const records = (await options.restoration_journal.list()).map((record) => {
    return structuredClone(record);
  });
  const sequenceState = assertTrustedRestorationSequence(records, options.scope);
  const sealIndex = new Map<string, TrustedRestorationArtifactSeal>();
  const runtime = createRuntime(options.recall_exclusion_policy, options.scope, options.restoration_journal);
  runtime.history_anchor = options.anchored_history_head ?? await options.restoration_journal.readAuthoritativeHead?.() ?? null;
  for (const record of records) {
    if (record.command.kind === "PRESENTATION_MIGRATE_V1" && record.command.input.actor !== record.provenance.actor) {
      throw new TrustedRestorationError("ARTIFACT_INTEGRITY_FAILURE", "Migration actor differs from its verified execution provenance");
    }
    await verifyCandidateEvidenceSource(record.command, options);
    const result = await executeTrustedCommand(runtime, record.command, options.scope, true);
    const actualResultHash = canonicalHash(result);
    const actualArtifacts = sortedArtifactSeals(
      artifactSealsFor(record.command, result)
    );
    if (actualResultHash !== record.result_hash
        || canonicalHash(actualArtifacts) !== canonicalHash(record.expected_artifacts)) {
      throw new TrustedRestorationError(
        "COMMAND_REPLAY_MISMATCH",
        `Trusted command replay diverged at sequence ${record.sequence} `
          + `(${record.command_kind}); result ${record.result_hash}/${actualResultHash}; `
          + `artifacts ${canonicalHash(record.expected_artifacts)}/${canonicalHash(actualArtifacts)}`
      );
    }
    indexArtifactSeals(sealIndex, record.expected_artifacts);
    runtime.journal_records.push(record);
  }

  let nextSequence = sequenceState.next_sequence;
  let previousRecordHash: string | null = sequenceState.previous_record_hash;
  let halted = false;
  const resolvers = readOnlyResolvers(runtime);
  const root: TrustedChainCompositionRoot = Object.freeze({
    scope: options.scope,
    resolvers,
    async execute(
      command: TrustedChainCommand,
      metadata: TrustedChainExecutionMetadata
    ) {
      if (halted) {
        throw new TrustedRestorationError(
          "ROOT_HALTED",
          "Composition root is halted after a restoration journal failure"
        );
      }
      await verifyCandidateEvidenceSource(command, options);
      if (options.scope === "PRODUCTION" && command.kind === "PRESENTATION_DECIDE"
          && command.input.contract_version !== "presentation-decision/2.0.0") {
        throw new TrustedRestorationError("INVALID_RECORD", "Live production Presentation writes require explicit V2; V1 is historical replay only");
      }
      if (command.kind === "PRESENTATION_MIGRATE_V1" && command.input.actor !== metadata.actor) {
        throw new TrustedRestorationError("INVALID_RECORD", "Migration actor must match root execution actor");
      }
      if (!metadata.actor.trim() || !Number.isFinite(Date.parse(metadata.recorded_at))) {
        throw new TrustedRestorationError("INVALID_RECORD", "Execution actor/time is invalid");
      }
      const result = await executeTrustedCommand(runtime, structuredClone(command), options.scope);
      const provenance: TrustedRestorationProvenance = {
        scope: options.scope,
        actor: metadata.actor,
        recorded_at: metadata.recorded_at
      };
      const record = createTrustedRestorationRecord({
        sequence: nextSequence,
        previous_record_hash: previousRecordHash,
        command_kind: command.kind,
        command,
        result,
        expected_artifacts: artifactSealsFor(command, result),
        provenance
      });
      try {
        const envelopes = await artifactEnvelopesFor(
          command,
          result,
          record,
          sealIndex,
          options.restoration_journal
        );
        const execution = assertTrustedRestorationExecution({
          record,
          artifact_envelopes: envelopes,
          read_model_projection: readModelProjectionFor(command, result, envelopes)
        });
        await options.restoration_journal.appendExecution(execution);
        indexArtifactSeals(sealIndex, record.expected_artifacts);
        runtime.journal_records.push(record);
      } catch (error) {
        halted = true;
        throw new TrustedRestorationError(
          "JOURNAL_WRITE_FAILURE",
          `Trusted command result could not be journaled: ${errorMessage(error)}`
        );
      }
      nextSequence += 1;
      previousRecordHash = record.integrity_hash;
      return structuredClone(result);
    }
  });
  return { root, restored_record_count: records.length };
}

async function verifyCandidateEvidenceSource(
  command: TrustedChainCommand,
  options: {
    readonly scope: TrustedRestorationScope;
    readonly candidate_evidence_source_verifier?: TrustedCandidateEvidenceSourceVerifier;
  }
) {
  if (command.kind !== "CANDIDATE_EVIDENCE_ISSUE"
      || command.input.source_manifest.evidence_class !== "DOCUMENT_VERIFIED") {
    return;
  }
  if (!options.candidate_evidence_source_verifier) {
    throw new Error(
      "DOCUMENT_VERIFIED requires a root-owned Candidate Evidence object verifier"
    );
  }
  await options.candidate_evidence_source_verifier.verify(
    command.input.source_manifest
  );
}

async function artifactEnvelopesFor(
  command: TrustedChainCommand,
  result: unknown,
  record: ReturnType<typeof createTrustedRestorationRecord<TrustedChainCommand>>,
  priorSeals: ReadonlyMap<string, TrustedRestorationArtifactSeal>,
  repository: TrustedRestorationJournalRepository<TrustedChainCommand>
): Promise<TrustedRestorationArtifactEnvelope[]> {
  const seals = artifactSealsFor(command, result);
  const artifacts = artifactValuesFor(command, result);
  if (seals.length !== artifacts.length) {
    throw new TrustedRestorationError(
      "ARTIFACT_INTEGRITY_FAILURE",
      `Artifact extraction mismatch for ${command.kind}`
    );
  }
  const available = new Map(priorSeals);
  indexArtifactSeals(available, seals);
  return Promise.all(artifacts.map(async (artifact, index) => {
    const artifactSeal = seals[index]!;
    const canonicalBytes = canonicalSerialize(artifact);
    if (priorSeals.has(artifactSeal.artifact_id)
        && (command.kind === "SOURCE_DISCOVERY_SUPPORT_VERIFY" || repository.readArtifactEnvelope)) {
      const original = await repository.readArtifactEnvelope?.(artifactSeal.artifact_kind, artifactSeal.artifact_id, record.provenance.scope);
      if (!original) throw new TrustedRestorationError("ARTIFACT_INTEGRITY_FAILURE", "Original artifact issuance envelope is missing");
      const verified = assertTrustedArtifactEnvelopeIntegrity(original);
      if (verified.artifact_kind !== artifactSeal.artifact_kind || verified.artifact_id !== artifactSeal.artifact_id
          || verified.scope !== record.provenance.scope || verified.canonical_bytes !== canonicalBytes
          || verified.artifact_hash !== canonicalHash(artifact) || verified.seal !== artifactSeal.content_hash) {
        throw new TrustedRestorationError("ARTIFACT_INTEGRITY_FAILURE", "Original artifact issuance envelope collision");
      }
      for (const reference of verified.upstream_references) {
        const dependency = priorSeals.get(reference.upstream_artifact_id);
        if (!dependency || dependency.artifact_kind !== reference.upstream_artifact_kind || dependency.content_hash !== reference.expected_seal) {
          throw new TrustedRestorationError("UPSTREAM_REFERENCE_FAILURE", "Original artifact issuance dependency mismatch");
        }
      }
      return verified;
    }
    const metadata = artifactRevisionMetadata(artifactSeal.artifact_kind, artifact);
    const withoutIntegrity = {
      artifact_type: ledgerArtifactType(artifactSeal.artifact_kind),
      artifact_kind: artifactSeal.artifact_kind,
      artifact_id: artifactSeal.artifact_id,
      stream_id: metadata.stream_id,
      revision: metadata.revision,
      supersedes_artifact_id: metadata.supersedes_artifact_id,
      schema_version: artifactSchemaVersion(artifact),
      canonical_bytes: canonicalBytes,
      artifact_hash: canonicalHash(artifact),
      seal: artifactSeal.content_hash,
      scope: record.provenance.scope,
      provenance: structuredClone(record.provenance),
      created_at: record.provenance.recorded_at,
      producer: {
        name: "bootstrapTrustedChainCompositionRoot" as const,
        version: record.schema_version,
        command_kind: record.command_kind
      },
      upstream_references: upstreamReferencesFor(
        command.kind === "OPPORTUNITY_REGISTER" && command.source_binding?.kind === "VERIFIED_DISCOVERY_SUPPORT"
          ? { artifact, discovery_support_id: command.source_binding.support_id }
          : artifact,
        artifactSeal.artifact_id,
        available
      )
    };
    const integrityBytes = canonicalSerialize(withoutIntegrity);
    return {
      ...withoutIntegrity,
      integrity_bytes: integrityBytes,
      integrity_hash: canonicalHash(withoutIntegrity)
    };
  }));
}

function artifactValuesFor(command: TrustedChainCommand, result: unknown): unknown[] {
  const value = result as Record<string, any>;
  switch (command.kind) {
    case "SOURCE_DISCOVERY_SUPPORT_VERIFY":
      return [value.support];
    case "SOURCE_OCCURRENCE_MATERIALIZE":
      return [value];
    case "OPPORTUNITY_REGISTER":
      return [value.candidate, value.disposition];
    case "RECALL_DISPOSITION_RECORD":
    case "RECALL_APPROVED_EXCLUSION_RECORD":
      return [value.disposition];
    case "POSITION_VERSION_MATERIALIZE":
      return [value.position_version];
    case "PBOV_MATERIALIZE":
      return [value.opportunity_version];
    case "SOURCE_COMPOSITION_MATERIALIZE":
      return [value];
    case "LEGAL_RELEVANCE_ASSESS":
      return [value.assessment];
    case "REQUIREMENT_PROJECTION_MATERIALIZE":
    case "REQUIREMENT_SET_MATERIALIZE":
      return [value];
    case "CANDIDATE_EVIDENCE_ISSUE":
      return [value.source_manifest, ...value.evidence];
    case "CANDIDATE_EVIDENCE_MATERIALIZE_SYNTHETIC":
      return value.evidence;
    case "PREDICATE_RESOLUTION_MATERIALIZE":
      return value.status === "RESOLUTION_SET" ? value.resolutions : [];
    case "ELIGIBILITY_MATERIALIZE":
      return value.status === "ASSESSMENT" ? [value.assessment] : [];
    case "PRESENTATION_DECIDE":
      return value.decision ? [value.decision] : [];
    case "PRESENTATION_MIGRATE_V1":
      return [value.audit, ...(value.decision ? [value.decision, value.read_model] : [])];
    case "PRESENTATION_READ_MODEL_MATERIALIZE":
      return [value.read_model];
  }
}

function readModelProjectionFor(
  command: TrustedChainCommand,
  result: unknown,
  envelopes: readonly TrustedRestorationArtifactEnvelope[]
): TrustedPresentationReadModelProjection | null {
  if (command.kind !== "PRESENTATION_READ_MODEL_MATERIALIZE" && command.kind !== "PRESENTATION_MIGRATE_V1") return null;
  const record = (result as Record<string, any>).read_model;
  if (!record && command.kind === "PRESENTATION_MIGRATE_V1") return null;
  const envelope = envelopes.find((item) => item.artifact_kind === "PRESENTATION_READ_MODEL");
  if (!envelope) {
    throw new TrustedRestorationError(
      "ARTIFACT_INTEGRITY_FAILURE",
      "PresentationReadModel execution did not produce an artifact"
    );
  }
  return {
    presentation_read_model_id: envelope.artifact_id,
    canonical_bytes: envelope.canonical_bytes,
    artifact_hash: envelope.artifact_hash,
    seal: envelope.seal,
    record: structuredClone(record)
  };
}

function upstreamReferencesFor(
  artifact: unknown,
  ownArtifactId: string,
  available: ReadonlyMap<string, TrustedRestorationArtifactSeal>
) {
  const ids = new Set<string>();
  collectStrings(artifact, ids);
  return [...ids]
    .filter((id) => id !== ownArtifactId && available.has(id))
    .map((id) => {
      const seal = available.get(id)!;
      return {
        relation: "ARTIFACT_REFERENCE" as const,
        upstream_artifact_kind: seal.artifact_kind,
        upstream_artifact_id: seal.artifact_id,
        expected_seal: seal.content_hash
      };
    })
    .sort((left, right) => canonicalSerialize(left).localeCompare(
      canonicalSerialize(right)
    ));
}

function collectStrings(value: unknown, output: Set<string>) {
  if (typeof value === "string") {
    output.add(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, output));
    return;
  }
  Object.values(value).forEach((item) => collectStrings(item, output));
}

function artifactRevisionMetadata(artifactKind: string, artifact: unknown) {
  const value = artifact as Record<string, any>;
  const revision = Number.isSafeInteger(value.revision)
    ? value.revision as number
    : artifactKind === "LEGAL_RELEVANCE" && Number.isSafeInteger(value.assessment_version)
      ? value.assessment_version as number
      : artifactKind === "PRESENTATION_READ_MODEL" && Number.isSafeInteger(value.decision_revision)
        ? value.decision_revision as number
        : null;
  const v2Presentation = (artifactKind === "PRESENTATION_DECISION" || artifactKind === "PRESENTATION_READ_MODEL")
    && (value.schema_version === "presentation-decision/2.0.0" || value.schema_version === "presentation-read-model/2.0.0");
  const streamId = v2Presentation
    ? value.record_kind === "POSITION_PRESENTATION" ? `${value.scope}:${value.position_id}` : artifactIdFor(artifactKind, value)
    : artifactKind === "RECALL_DISPOSITION"
    || artifactKind === "PRESENTATION_DECISION"
    || artifactKind === "PRESENTATION_READ_MODEL"
    ? value.opportunity_candidate_id
    : artifactKind === "POSITION_VERSION" || artifactKind === "LEGAL_RELEVANCE"
      ? value.position_id
      : artifactKind === "PBOV"
        ? value.canonical_opportunity_id
        : artifactKind === "REQUIREMENT_SET_VERSION"
          ? value.position_id
          : artifactKind === "PREDICATE_RESOLUTION"
            ? `${value.candidate_profile_id}:${value.requirement_fact_id}`
            : artifactKind === "TRUSTED_ELIGIBILITY"
              ? `${value.candidate_profile_id}:${value.canonical_opportunity_id}`
              : artifactKind === "CANDIDATE_EVIDENCE_SOURCE_MANIFEST"
                ? value.manifest_stream_id
              : artifactIdFor(artifactKind, value);
  const supersedesArtifactId = artifactKind === "RECALL_DISPOSITION"
    ? value.supersedes_recall_disposition_id ?? null
    : artifactKind === "PRESENTATION_DECISION"
      ? value.supersedes_presentation_decision_id ?? null
      : artifactKind === "CANDIDATE_EVIDENCE_SOURCE_MANIFEST"
        ? value.supersedes_manifest_id ?? null
      : null;
  return {
    stream_id: String(streamId),
    revision,
    supersedes_artifact_id: supersedesArtifactId === null
      ? null
      : String(supersedesArtifactId)
  };
}

function artifactIdFor(artifactKind: string, value: Record<string, any>) {
  const fields: Record<string, string> = {
    SOV_DISCOVERY_SUPPORT: "support_id",
    SOURCE_OCCURRENCE_VERSION: "source_occurrence_version_id",
    OPPORTUNITY_CANDIDATE: "opportunity_candidate_id",
    SOURCE_COMPOSITION: "source_composition_id",
    REQUIREMENT_PROJECTION: "requirement_projection_id",
    CANDIDATE_EVIDENCE: "predicate_candidate_evidence_id",
    CANDIDATE_EVIDENCE_SOURCE_MANIFEST: "candidate_evidence_source_manifest_id",
    PRESENTATION_DECISION: "presentation_decision_id",
    PRESENTATION_READ_MODEL: "presentation_read_model_id",
    PRESENTATION_MIGRATION_AUDIT: "migration_id"
  };
  return String(value[fields[artifactKind] ?? ""] ?? "artifact-stream:unknown");
}

function artifactSchemaVersion(artifact: unknown) {
  const value = artifact as Record<string, any>;
  return String(value.schema_version ?? value.materialization_version ?? "UNVERSIONED");
}

function ledgerArtifactType(artifactKind: string) {
  return artifactKind === "LEGAL_RELEVANCE"
    ? "LEGAL_EMPLOYMENT_RELEVANCE_ASSESSMENT"
    : artifactKind;
}

function indexArtifactSeals(
  index: Map<string, TrustedRestorationArtifactSeal>,
  seals: readonly TrustedRestorationArtifactSeal[]
) {
  for (const seal of seals) {
    const current = index.get(seal.artifact_id);
    if (current && canonicalSerialize(current) !== canonicalSerialize(seal)) {
      throw new TrustedRestorationError(
        "ARTIFACT_INTEGRITY_FAILURE",
        `Artifact seal identity collision: ${seal.artifact_id}`
      );
    }
    index.set(seal.artifact_id, structuredClone(seal));
  }
}

interface TrustedChainRuntime {
  readonly journal_records: TrustedRestorationRecord<TrustedChainCommand>[];
  readonly repository: TrustedRestorationJournalRepository<TrustedChainCommand>;
  history_anchor: string | null;
  readonly source_occurrences: InMemoryTrustedSourceOccurrenceTracker;
  readonly opportunity_recall: ReturnType<typeof createInMemoryOpportunityRecallBoundary>;
  readonly position_versions: InMemoryPositionVersionTracker;
  readonly position_bound_opportunities: InMemoryPositionBoundOpportunityTracker;
  readonly trusted_artifacts: TrustedArtifactChain;
  readonly relevance: InMemoryLegalEmploymentRelevanceTracker;
  readonly presentation: ReturnType<typeof createPresentationDecisionBoundary>;
  readonly presentation_read_models: ReturnType<
    typeof createPresentationReadModelMaterializer
  >;
}

function createRuntime(
  recallExclusionPolicy: ApprovedRecallExclusionPolicy | undefined,
  scope: TrustedRestorationScope,
  repository: TrustedRestorationJournalRepository<TrustedChainCommand>
): TrustedChainRuntime {
  const sourceOccurrences = new InMemoryTrustedSourceOccurrenceTracker({ scope,
    readDiscovery: repository.readVerifiedDiscovery ? async (snapshotId, recordId) => {
      const evidence = await repository.readVerifiedDiscovery!(snapshotId, recordId);
      const recordKeys = new Set(["contract_version", "extracted_record_id", "snapshot_id", "source_definition_id", "identity_candidates",
        "raw_source_record_id", "raw_title", "raw_organization_name", "raw_location_text", "raw_description", "raw_requirement_text",
        "announcement_url", "application_url", "publish_time", "deadline", "recruitment_year", "recruitment_batch", "recruitment_context",
        "source_record_locator", "adapter_metadata", "extraction", "snapshot_content_hash", "observed_at", "semantic_hash"]);
      if (Object.keys(evidence.extracted_record).some((key) => !recordKeys.has(key))) {
        throw new SOVDiscoverySupportError("REVIEW_REQUIRED", "Unsupported ExtractedRecord contract field");
      }
      return evidence;
    } : undefined });
  const positionVersions = new InMemoryPositionVersionTracker();
  const positionBoundOpportunities = new InMemoryPositionBoundOpportunityTracker(
    positionVersions
  );
  const opportunityRecall = createInMemoryOpportunityRecallBoundary({
    ...(recallExclusionPolicy ? { exclusion_policy: recallExclusionPolicy } : {})
  });
  const trustedArtifacts = createTrustedArtifactChain(
    positionBoundOpportunities,
    sourceOccurrences
  );
  const relevance = new InMemoryLegalEmploymentRelevanceTracker(
    positionBoundOpportunities,
    trustedArtifacts.source_composition_resolver,
    sourceOccurrences
  );
  const presentation = createPresentationDecisionBoundary({
    source_occurrences: sourceOccurrences,
    scope,
    source_compositions: trustedArtifacts.source_composition_resolver,
    requirement_sets: trustedArtifacts.requirement_set_resolver,
    requirement_projections: trustedArtifacts.requirement_projections,
    candidates: opportunityRecall.candidates,
    recall_dispositions: opportunityRecall.dispositions,
    position_bound_opportunities: positionBoundOpportunities,
    relevance,
    eligibility: trustedArtifacts.eligibility_assessments
  });
  const presentationReadModels = createPresentationReadModelMaterializer({
    source_occurrences: sourceOccurrences,
    source_compositions: trustedArtifacts.source_composition_resolver,
    decisions: presentation.decisions,
    position_bound_opportunities: positionBoundOpportunities,
    requirement_sets: trustedArtifacts.requirement_set_resolver
  });
  return {
    journal_records: [], repository, history_anchor: null,
    source_occurrences: sourceOccurrences,
    opportunity_recall: opportunityRecall,
    position_versions: positionVersions,
    position_bound_opportunities: positionBoundOpportunities,
    trusted_artifacts: trustedArtifacts,
    relevance,
    presentation,
    presentation_read_models: presentationReadModels
  };
}

async function executeTrustedCommand(
  runtime: TrustedChainRuntime,
  command: TrustedChainCommand,
  scope: TrustedRestorationScope,
  historicalReplay = false
): Promise<unknown> {
  switch (command.kind) {
    case "SOURCE_DISCOVERY_SUPPORT_VERIFY":
      return runtime.source_occurrences.processDiscoverySupport(command.input);
    case "SOURCE_OCCURRENCE_MATERIALIZE":
      return runtime.source_occurrences.process(command.input);
    case "OPPORTUNITY_REGISTER":
      if (command.source_binding?.kind === "VERIFIED_DISCOVERY_SUPPORT") {
        const support = runtime.source_occurrences.resolveSupport(command.source_binding.support_id);
        const input = command.input;
        if (!support || support.scope !== scope || support.target.sov_id !== input.source_occurrence_version_id
            || support.target.source_definition_id !== input.source_definition_id
            || support.target.endpoint_id !== input.recruitment_endpoint_id
            || support.discovery.snapshot_id !== input.snapshot_id
            || support.discovery.extracted_record_id !== input.extracted_record_id
            || support.discovery.exact_locator !== input.discovery_locator
            || support.discovery.observed_at !== input.first_observed_at
            || canonicalHash(requireSource(runtime, support.target.sov_id)) !== support.target.original_sov_artifact_seal) {
          throw new TrustedRestorationError("UPSTREAM_REFERENCE_FAILURE", "Candidate exact discovery support binding mismatch");
        }
      } else {
        if (command.source_binding && command.source_binding.kind !== "ORIGINAL_ISSUANCE") {
          throw new TrustedRestorationError("UPSTREAM_REFERENCE_FAILURE", "Unknown Candidate source binding contract");
        }
        validateRecallSource(runtime, command.input);
      }
      return runtime.opportunity_recall.register(command.input);
    case "RECALL_DISPOSITION_RECORD":
      return runtime.opportunity_recall.recordDisposition(command.input);
    case "RECALL_APPROVED_EXCLUSION_RECORD":
      return runtime.opportunity_recall.recordApprovedExclusion(command.input);
    case "POSITION_VERSION_MATERIALIZE": {
      const sources = resolvePositionSources(runtime, command.source_references);
      const resolution = resolvePositionIdentity(sources[0]!);
      if (resolution.status !== "RESOLVED") {
        throw new Error("Position identity is not resolved by trusted SOV evidence");
      }
      return runtime.position_versions.process({
        position: resolution.position,
        sources
      });
    }
    case "PBOV_MATERIALIZE": {
      const artifact = runtime.position_versions.resolve(command.position_version_id);
      if (!artifact) throw new Error("Trusted PositionVersion is unavailable");
      return runtime.position_bound_opportunities.process({
        position: artifact.position,
        position_version: artifact.position_version,
        sources: resolvePositionSources(runtime, command.source_references)
      });
    }
    case "SOURCE_COMPOSITION_MATERIALIZE":
      return runtime.trusted_artifacts.source_compositions.materialize(command.input);
    case "LEGAL_RELEVANCE_ASSESS":
      return runtime.relevance.process(command.input);
    case "REQUIREMENT_PROJECTION_MATERIALIZE":
      return runtime.trusted_artifacts.requirement_projections.materialize(
        command.source_composition_id
      );
    case "REQUIREMENT_SET_MATERIALIZE":
      return runtime.trusted_artifacts.requirement_sets.materialize(
        command.source_composition_id
      );
    case "CANDIDATE_EVIDENCE_ISSUE":
      if (command.input.source_manifest.scope !== scope) {
        throw new Error("Candidate Evidence issuance scope does not match the root");
      }
      return runtime.trusted_artifacts.candidate_evidence.issue(command.input);
    case "CANDIDATE_EVIDENCE_MATERIALIZE_SYNTHETIC":
      if (scope !== "SYNTHETIC_TEST") {
        throw new Error("Synthetic Candidate Evidence is forbidden in production roots");
      }
      return runtime.trusted_artifacts.candidate_evidence.materialize_synthetic_fixture(
        command.input
      );
    case "PREDICATE_RESOLUTION_MATERIALIZE":
      return runtime.trusted_artifacts.predicate_resolutions.materialize(command.input);
    case "ELIGIBILITY_MATERIALIZE":
      return runtime.trusted_artifacts.eligibility_assessments.materialize(command.input);
    case "PRESENTATION_DECIDE":
      try {
        return runtime.presentation.decide(command.input);
      } catch (error) {
        if (!(error instanceof PresentationSemanticProjectionError)) throw error;
        return { status: error.code, reason: error.message,
          opportunity_candidate_id: command.input.opportunity_candidate_id,
          existing_current_presentation_decision_id: command.input.expected_current_presentation_decision_id ?? null };
      }
    case "PRESENTATION_MIGRATE_V1": {
      if (!historicalReplay && (!runtime.history_anchor || command.input.anchored_input_head !== runtime.history_anchor)) {
        throw new TrustedRestorationError("ARTIFACT_INTEGRITY_FAILURE", "Migration must use the root-owned verified history anchor");
      }
      if (!runtime.repository.readArtifactEnvelope) throw new TrustedRestorationError("ARTIFACT_INTEGRITY_FAILURE", "Migration requires verified original issuance envelopes");
      const first = new Map<string, { readonly sequence: number; readonly seal: string }>();
      for (const record of runtime.journal_records) for (const artifact of record.expected_artifacts) {
        if (artifact.artifact_kind === "PRESENTATION_DECISION" && !first.has(artifact.artifact_id)) {
          first.set(artifact.artifact_id, { sequence: record.sequence, seal: artifact.content_hash });
        }
      }
      const inventory = [];
      for (const [id, issuance] of first) {
        const decision = runtime.presentation.decisions.resolve(id as PresentationDecisionId);
        if (!decision || decision.schema_version !== "presentation-decision/1.0.0"
            || decision.position_id !== command.input.position_id || decision.decision_basis.candidate_source_binding !== "BOUND") continue;
        const envelope = await runtime.repository.readArtifactEnvelope("PRESENTATION_DECISION", id, scope);
        if (!envelope) throw new TrustedRestorationError("ARTIFACT_INTEGRITY_FAILURE", "Migration original envelope is unavailable");
        assertTrustedArtifactEnvelopeIntegrity(envelope);
        if (envelope.scope !== scope || envelope.seal !== issuance.seal || envelope.seal !== decision.integrity_hash
            || envelope.canonical_bytes !== canonicalSerialize(decision)) throw new TrustedRestorationError("ARTIFACT_INTEGRITY_FAILURE", "Migration original issuance bytes/seal mismatch");
        inventory.push({ presentation_decision_id: decision.presentation_decision_id, integrity_hash: decision.integrity_hash,
          envelope_integrity_hash: envelope.integrity_hash, issuance_sequence: issuance.sequence });
      }
      const migrated = runtime.presentation.migrateV1({ ...command.input, inventory });
      return { ...migrated, read_model: migrated.decision ? runtime.presentation_read_models.materialize(
        migrated.decision.presentation_decision_id).read_model : null };
    }
    case "PRESENTATION_READ_MODEL_MATERIALIZE":
      return runtime.presentation_read_models.materialize(
        command.presentation_decision_id
      );
  }
}

function validateRecallSource(
  runtime: TrustedChainRuntime,
  input: OpportunityDiscoveryRegistrationInput
) {
  if (!input.source_occurrence_version_id) return;
  const source = requireSource(runtime, input.source_occurrence_version_id);
  if (source.endpoint.source_definition_id !== input.source_definition_id
      || source.endpoint.recruitment_endpoint_id !== input.recruitment_endpoint_id
      || source.snapshot.snapshot_id !== input.snapshot_id
      || source.extracted_record.extracted_record_id !== input.extracted_record_id) {
    throw new Error(
      "OpportunityCandidate discovery provenance does not match the trusted SOV"
    );
  }
}

function resolvePositionSources(
  runtime: TrustedChainRuntime,
  references: readonly TrustedPositionIdentitySourceReference[]
): PositionIdentityResolutionInput[] {
  if (references.length === 0) {
    throw new Error("Position materialization requires trusted SOV references");
  }
  const ids = references.map((reference) => reference.source_occurrence_version_id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Position materialization SOV references must be unique");
  }
  return references.map((reference) => {
    const source = requireSource(runtime, reference.source_occurrence_version_id);
    if (source.source_role !== "POSITION_BEARING") {
      throw new Error("Position identity cannot be derived from a package-only SOV");
    }
    return {
      endpoint: source.endpoint,
      occurrence: source.occurrence,
      version: source.version,
      extracted_record: source.extracted_record,
      snapshot: source.snapshot,
      ...(reference.reconciliation ? {
        reconciliation: {
          reconciliation: reference.reconciliation.reconciliation,
          related_sources: reference.reconciliation.related_source_occurrence_version_ids
            .map((id) => sourceInput(requireSource(runtime, id)))
        }
      } : {})
    };
  });
}

function requireSource(
  runtime: TrustedChainRuntime,
  sourceOccurrenceVersionId: SourceOccurrenceVersionId
): TrustedSourceOccurrenceArtifact {
  const source = runtime.source_occurrences.resolve(sourceOccurrenceVersionId);
  if (!source) throw new Error("Trusted SourceOccurrenceVersion is unavailable");
  return source;
}

function sourceInput(source: TrustedSourceOccurrenceArtifact) {
  return {
    endpoint: source.endpoint,
    occurrence: source.occurrence,
    version: source.version,
    extracted_record: source.extracted_record,
    snapshot: source.snapshot
  };
}

function artifactSealsFor(
  command: TrustedChainCommand,
  result: unknown
): TrustedRestorationArtifactSeal[] {
  const value = result as Record<string, any>;
  switch (command.kind) {
    case "SOURCE_DISCOVERY_SUPPORT_VERIFY":
      return [seal("SOV_DISCOVERY_SUPPORT", value.support.support_id, value.support.integrity_hash)];
    case "SOURCE_OCCURRENCE_MATERIALIZE":
      return [seal("SOURCE_OCCURRENCE_VERSION", value.version.source_occurrence_version_id,
        canonicalHash(value))];
    case "OPPORTUNITY_REGISTER":
      return [
        seal("OPPORTUNITY_CANDIDATE", value.candidate.opportunity_candidate_id,
          value.candidate.integrity_hash),
        seal("RECALL_DISPOSITION", value.disposition.recall_disposition_id,
          value.disposition.integrity_hash)
      ];
    case "RECALL_DISPOSITION_RECORD":
    case "RECALL_APPROVED_EXCLUSION_RECORD":
      return [seal("RECALL_DISPOSITION", value.disposition.recall_disposition_id,
        value.disposition.integrity_hash)];
    case "POSITION_VERSION_MATERIALIZE":
      return [seal("POSITION_VERSION", value.position_version.position_version_id,
        value.position_version.integrity_hash)];
    case "PBOV_MATERIALIZE":
      return [seal("PBOV", value.opportunity_version.opportunity_version_id,
        value.opportunity_version.integrity_hash)];
    case "SOURCE_COMPOSITION_MATERIALIZE":
      return [seal("SOURCE_COMPOSITION", value.source_composition_id,
        value.composition_hash)];
    case "LEGAL_RELEVANCE_ASSESS":
      return [seal("LEGAL_RELEVANCE", value.assessment.assessment_id,
        value.assessment.integrity_hash)];
    case "REQUIREMENT_PROJECTION_MATERIALIZE":
      return [seal("REQUIREMENT_PROJECTION", value.requirement_projection_id,
        value.integrity_hash)];
    case "REQUIREMENT_SET_MATERIALIZE":
      return [seal("REQUIREMENT_SET_VERSION", value.requirement_set_version_id,
        value.semantic_hash)];
    case "CANDIDATE_EVIDENCE_ISSUE":
      return [
        seal(
          "CANDIDATE_EVIDENCE_SOURCE_MANIFEST",
          value.source_manifest.candidate_evidence_source_manifest_id,
          value.source_manifest.integrity_hash
        ),
        ...value.evidence.map((item: Record<string, string>) => {
          return seal("CANDIDATE_EVIDENCE", item.predicate_candidate_evidence_id,
            item.predicate_candidate_evidence_hash);
        })
      ];
    case "CANDIDATE_EVIDENCE_MATERIALIZE_SYNTHETIC":
      return value.evidence.map((item: Record<string, string>) => {
        return seal("CANDIDATE_EVIDENCE", item.predicate_candidate_evidence_id,
          item.predicate_candidate_evidence_hash);
      });
    case "PREDICATE_RESOLUTION_MATERIALIZE":
      return value.status === "RESOLUTION_SET"
        ? value.resolutions.map((item: Record<string, string>) => {
            return seal("PREDICATE_RESOLUTION", item.predicate_resolution_id,
              item.integrity_hash);
          })
        : [];
    case "ELIGIBILITY_MATERIALIZE":
      return value.status === "ASSESSMENT"
        ? [seal("TRUSTED_ELIGIBILITY", value.assessment.eligibility_assessment_id,
            value.assessment.integrity_hash)]
        : [];
    case "PRESENTATION_DECIDE":
      return value.decision ? [seal("PRESENTATION_DECISION", value.decision.presentation_decision_id,
        value.decision.integrity_hash)] : [];
    case "PRESENTATION_MIGRATE_V1":
      return [seal("PRESENTATION_MIGRATION_AUDIT", value.audit.migration_id, value.audit.integrity_hash),
        ...(value.decision ? [seal("PRESENTATION_DECISION", value.decision.presentation_decision_id, value.decision.integrity_hash),
          seal("PRESENTATION_READ_MODEL", value.read_model.presentation_read_model_id, value.read_model.integrity_hash)] : [])];
    case "PRESENTATION_READ_MODEL_MATERIALIZE":
      return [seal("PRESENTATION_READ_MODEL", value.read_model.presentation_read_model_id,
        value.read_model.integrity_hash)];
  }
}

function readOnlyResolvers(runtime: TrustedChainRuntime):
TrustedChainCompositionRoot["resolvers"] {
  return Object.freeze({
    source_occurrences: Object.freeze({
      resolve: runtime.source_occurrences.resolve.bind(runtime.source_occurrences),
      resolveSupport: runtime.source_occurrences.resolveSupport.bind(runtime.source_occurrences),
      resolveForDiscovery: runtime.source_occurrences.resolveForDiscovery.bind(runtime.source_occurrences)
    }),
    opportunity_candidates: runtime.opportunity_recall.candidates,
    recall_dispositions: runtime.opportunity_recall.dispositions,
    position_versions: Object.freeze({
      resolve: runtime.position_versions.resolve.bind(runtime.position_versions)
    }),
    position_bound_opportunities: Object.freeze({
      resolve: runtime.position_bound_opportunities.resolve.bind(
        runtime.position_bound_opportunities
      ),
      resolveSources: runtime.position_bound_opportunities.resolveSources.bind(
        runtime.position_bound_opportunities
      )
    }),
    source_compositions: Object.freeze({
      resolve: runtime.trusted_artifacts.source_composition_resolver.resolve.bind(
        runtime.trusted_artifacts.source_composition_resolver
      )
    }),
    relevance: Object.freeze({
      resolve: runtime.relevance.resolve.bind(runtime.relevance),
      list: runtime.relevance.list.bind(runtime.relevance)
    }),
    requirement_projections: Object.freeze({
      resolve: runtime.trusted_artifacts.requirement_projections.resolve
    }),
    requirement_sets: Object.freeze({
      resolve: runtime.trusted_artifacts.requirement_set_resolver.resolve.bind(
        runtime.trusted_artifacts.requirement_set_resolver
      )
    }),
    candidate_evidence: Object.freeze({
      resolve: runtime.trusted_artifacts.candidate_evidence.resolve
    }),
    predicate_resolutions: Object.freeze({
      resolve: runtime.trusted_artifacts.predicate_resolutions.resolve
    }),
    eligibility_assessments: Object.freeze({
      resolve: runtime.trusted_artifacts.eligibility_assessments.resolve
    }),
    presentation_decisions: runtime.presentation.decisions,
    presentation_read_models: Object.freeze({
      resolve: runtime.presentation_read_models.resolve
    })
  });
}

function seal(
  artifactKind: string,
  artifactId: string,
  contentHash: string
): TrustedRestorationArtifactSeal {
  return {
    artifact_kind: artifactKind,
    artifact_id: artifactId,
    content_hash: contentHash
  };
}

function sortedArtifactSeals(
  artifacts: readonly TrustedRestorationArtifactSeal[]
) {
  return [...artifacts].sort((left, right) => {
    return canonicalSerialize(left).localeCompare(canonicalSerialize(right));
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
