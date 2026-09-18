import type {
  IsoDateTime,
  LegalEmploymentRelevanceAssessment,
  OpportunityCandidate,
  OpportunityCandidateId,
  PresentationDecision,
  PresentationDecisionV1,
  PositionPresentationDecisionV2,
  PositionId,
  PresentationScope,
  PresentationMigrationAudit,
  PresentationV1MigrationReference,
  PresentationDecisionId,
  RecallDispositionId
} from "../domain";
import {
  PRESENTATION_DECISION_SCHEMA_VERSION,
  PRESENTATION_DECISION_V2_SCHEMA_VERSION,
  PRESENTATION_DECISION_STATUSES,
  PRESENTATION_POLICY_V1_ID,
  PRESENTATION_POLICY_V1_VERSION
} from "../domain";
import {
  assertTrustedOpportunityCandidateResolver,
  assertTrustedPositionBoundOpportunityResolver,
  assertTrustedRecallDispositionResolver,
  assertTrustedSourceOccurrenceVersionResolver,
  type TrustedOpportunityCandidateResolver,
  type TrustedPositionBoundOpportunityResolver,
  type TrustedRecallDispositionResolver
} from "../normalization";
import {
  canonicalHash,
  canonicalSerialize,
  createCanonicalArtifactRegistryAuthority
} from "../normalization/canonical-artifact-registry";
import {
  assertLegalEmploymentRelevanceAssessmentIntegrity,
  assertTrustedLegalEmploymentRelevanceResolver,
  type TrustedLegalEmploymentRelevanceResolver
} from "./legal-employment-relevance";
import {
  assertPositionBoundEligibilityAssessmentIntegrity,
  type PositionBoundEligibilityAssessment
} from "./position-bound-eligibility-assessment";
import {
  assertTrustedEligibilityAssessmentResolver,
  type TrustedEligibilityAssessmentResolver
} from "./trusted-artifact-chain";
import { assertTrustedSourceCompositionResolver, type TrustedSourceCompositionResolver } from "./position-bound-source-composition";
import { assertTrustedRequirementSetVersionResolver, type TrustedRequirementSetVersionResolver } from "./position-bound-requirement-set";
import { assertRequirementProjectionIntegrity, type RequirementProjectionArtifact } from "./trusted-requirement-projection";
import { buildPresentationSemanticProjectionV2, presentationSemanticHash, PresentationSemanticProjectionError } from "./presentation-semantic-projection";

export interface ApprovedPresentationPolicy {
  readonly policy_id: typeof PRESENTATION_POLICY_V1_ID;
  readonly policy_version: typeof PRESENTATION_POLICY_V1_VERSION;
}

export interface PresentationDecisionCommand {
  readonly contract_version?: typeof PRESENTATION_DECISION_V2_SCHEMA_VERSION;
  readonly expected_current_presentation_decision_id?: PresentationDecisionId | null;
  readonly opportunity_version_id?: import("../domain").OpportunityVersionId;
  readonly opportunity_candidate_id: OpportunityCandidateId;
  readonly recall_disposition_id: RecallDispositionId;
  readonly relevance_assessment_id: string | null;
  readonly eligibility_assessment_id: string | null;
  readonly decided_at: IsoDateTime;
}

export interface TrustedPresentationDecisionResolver {
  resolve(presentationDecisionId: PresentationDecisionId): PresentationDecision | null;
  resolveCurrent(opportunityCandidateId: OpportunityCandidateId): PresentationDecision | null;
  list(opportunityCandidateId: OpportunityCandidateId): readonly PresentationDecision[];
  resolvePositionCurrent(scope: PresentationScope, positionId: PositionId): PositionPresentationDecisionV2 | null;
  listPosition(scope: PresentationScope, positionId: PositionId): readonly PositionPresentationDecisionV2[];
  resolveMigration(migrationId: string): PresentationMigrationAudit | null;
}

export interface PresentationDecisionBoundary {
  readonly policy: ApprovedPresentationPolicy;
  readonly decisions: TrustedPresentationDecisionResolver;
  decide(command: PresentationDecisionCommand): {
    readonly version_created: boolean;
    readonly decision: PresentationDecision;
  };
  migrateV1(input: {
    readonly position_id: PositionId;
    readonly anchored_input_head: string;
    readonly inventory: readonly PresentationV1MigrationReference[];
    readonly actor: string;
    readonly created_at: IsoDateTime;
  }): { readonly audit: PresentationMigrationAudit; readonly decision: PresentationDecision | null };
}

export interface PresentationDecisionBoundaryOptions {
  readonly scope?: PresentationScope;
  readonly source_compositions?: TrustedSourceCompositionResolver;
  readonly source_occurrences?: import("../normalization").TrustedSourceOccurrenceVersionResolver;
  readonly requirement_sets?: TrustedRequirementSetVersionResolver;
  readonly requirement_projections?: { resolve(id: string): RequirementProjectionArtifact | null };
  readonly policy?: ApprovedPresentationPolicy;
  readonly candidates: TrustedOpportunityCandidateResolver;
  readonly recall_dispositions: TrustedRecallDispositionResolver;
  readonly position_bound_opportunities: TrustedPositionBoundOpportunityResolver;
  readonly relevance: TrustedLegalEmploymentRelevanceResolver;
  readonly eligibility: TrustedEligibilityAssessmentResolver;
}

const approvedPolicies = new WeakSet<object>();
const trustedDecisionResolvers = new WeakSet<object>();

export class PresentationDecisionError extends Error {
  readonly code:
    | "INVALID_INPUT"
    | "TRUSTED_ARTIFACT_UNAVAILABLE"
    | "TRUSTED_ARTIFACT_MISMATCH"
    | "IDENTITY_COLLISION";

  constructor(code: PresentationDecisionError["code"], message: string) {
    super(message);
    this.name = "PresentationDecisionError";
    this.code = code;
  }
}

export function createApprovedPresentationPolicyV1(): ApprovedPresentationPolicy {
  const policy: ApprovedPresentationPolicy = Object.freeze({
    policy_id: PRESENTATION_POLICY_V1_ID,
    policy_version: PRESENTATION_POLICY_V1_VERSION
  });
  approvedPolicies.add(policy);
  return policy;
}

export function assertApprovedPresentationPolicy(
  policy: ApprovedPresentationPolicy
) {
  if (!approvedPolicies.has(policy as object)) {
    throw invalid("Presentation policy must be composition-root approved");
  }
  return policy;
}

export function createPresentationDecisionBoundary(
  options: PresentationDecisionBoundaryOptions
): PresentationDecisionBoundary {
  const sourceOccurrences = options.source_occurrences ? assertTrustedSourceOccurrenceVersionResolver(options.source_occurrences) : null;
  const policy = assertApprovedPresentationPolicy(
    options.policy ?? createApprovedPresentationPolicyV1()
  );
  const candidates = assertTrustedOpportunityCandidateResolver(options.candidates);
  const recallDispositions = assertTrustedRecallDispositionResolver(
    options.recall_dispositions
  );
  const opportunities = assertTrustedPositionBoundOpportunityResolver(
    options.position_bound_opportunities
  );
  const relevance = assertTrustedLegalEmploymentRelevanceResolver(options.relevance);
  const eligibility = assertTrustedEligibilityAssessmentResolver(options.eligibility);
  const registry = createCanonicalArtifactRegistryAuthority<
    string,
    PresentationDecision | PresentationMigrationAudit
  >((artifact) => "presentation_decision_id" in artifact ? artifact.presentation_decision_id : artifact.migration_id);
  const idsByCandidate = new Map<OpportunityCandidateId, PresentationDecisionId[]>();
  const idsByPosition = new Map<string, PresentationDecisionId[]>();
  const scope = options.scope ?? "SYNTHETIC_TEST";
  const compositions = options.source_compositions ? assertTrustedSourceCompositionResolver(options.source_compositions) : null;
  const requirementSets = options.requirement_sets ? assertTrustedRequirementSetVersionResolver(options.requirement_sets) : null;

  const decisions: TrustedPresentationDecisionResolver = Object.freeze({
    resolve(id: PresentationDecisionId) {
      const decision = registry.resolver.resolve(id);
      return decision && "presentation_decision_id" in decision ? assertPresentationDecisionIntegrity(decision) : null;
    },
    resolveCurrent(candidateId: OpportunityCandidateId) {
      const history = this.list(candidateId);
      const bound = history.filter((decision): decision is PositionPresentationDecisionV2 =>
        decision.schema_version === PRESENTATION_DECISION_V2_SCHEMA_VERSION && decision.record_kind === "POSITION_PRESENTATION");
      if (new Set(bound.map((decision) => `${decision.scope}:${decision.position_id}`)).size > 1) {
        throw mismatch("Presentation Candidate association conflicts across Positions");
      }
      const association = bound.at(-1);
      return association ? this.resolvePositionCurrent(association.scope, association.position_id) : history.at(-1) ?? null;
    },
    list(candidateId: OpportunityCandidateId) {
      return (idsByCandidate.get(candidateId) ?? []).map((id) => {
        const decision = this.resolve(id);
        if (!decision) throw unavailable("Presentation decision index is incomplete");
        return decision;
      });
    },
    resolvePositionCurrent(subjectScope: PresentationScope, positionId: PositionId) {
      return this.listPosition(subjectScope, positionId).at(-1) ?? null;
    },
    listPosition(subjectScope: PresentationScope, positionId: PositionId) {
      return (idsByPosition.get(`${subjectScope}:${positionId}`) ?? []).map((id) => {
        const decision = this.resolve(id);
        if (!decision || decision.schema_version !== PRESENTATION_DECISION_V2_SCHEMA_VERSION
            || decision.record_kind !== "POSITION_PRESENTATION"
            || decision.scope !== subjectScope || decision.position_id !== positionId) {
          throw mismatch("Presentation Position index integrity failure");
        }
        return decision;
      });
    },
    resolveMigration(id: string) {
      const audit = registry.resolver.resolve(id);
      return audit && "migration_id" in audit && audit.schema_version === "presentation-v1-migration/2.0.0"
        ? assertPresentationMigrationIntegrity(audit) : null;
    }
  });
  trustedDecisionResolvers.add(decisions as object);

  const boundary: PresentationDecisionBoundary = {
    policy,
    decisions,
    decide(command) {
      requireCommand(command);
      const candidate = candidates.resolve(command.opportunity_candidate_id);
      const recall = recallDispositions.resolve(command.recall_disposition_id);
      const currentRecall = recallDispositions.resolveCurrent(
        command.opportunity_candidate_id
      );
      if (!candidate || !recall || !currentRecall) {
        throw unavailable("Trusted OpportunityCandidate or RecallDisposition is unavailable");
      }
      if (recall.opportunity_candidate_id !== candidate.opportunity_candidate_id
          || currentRecall.recall_disposition_id !== recall.recall_disposition_id) {
        throw mismatch("Presentation requires the current RecallDisposition for its Candidate");
      }

      const previous = decisions.list(candidate.opportunity_candidate_id).filter((decision) =>
        decision.schema_version === PRESENTATION_DECISION_SCHEMA_VERSION);
      const materialized = materializeDecision({
        command,
        candidate,
        recall,
        policy,
        opportunities,
        relevance,
        eligibility
      });
      if (command.contract_version === PRESENTATION_DECISION_V2_SCHEMA_VERSION) {
        const graphId = command.opportunity_version_id ?? materialized.opportunity_version_id;
        const graph = graphId ? opportunities.resolve(graphId) : null;
        if (command.opportunity_version_id && (!graph || (materialized.opportunity_version_id
            && command.opportunity_version_id !== materialized.opportunity_version_id))) {
          throw mismatch("Explicit Presentation PBOV does not match trusted upstream");
        }
        const bound = graph && candidate.source_occurrence_version_id
          && graph.opportunity_version.source_occurrence_version_ids.includes(candidate.source_occurrence_version_id);
        const payload = bound ? {
          ...materialized,
          opportunity_version_id: graph.opportunity_version.opportunity_version_id,
          position_id: graph.position.position_id,
          position_version_id: graph.position_version.position_version_id,
          decision_basis: { ...materialized.decision_basis, candidate_source_binding: "BOUND" as const }
        } : { ...materialized, position_id: null };
        if (!bound || !graph) {
          const auditPayload = {
            ...payload, schema_version: PRESENTATION_DECISION_V2_SCHEMA_VERSION, scope,
            record_kind: "UNBOUND_RETAINED_OUTCOME" as const, public_series_member: false as const,
            position_id: null, revision: null, supersedes_presentation_decision_id: null,
            decided_at: requireDate(command.decided_at)
          };
          const decision = assertPresentationDecisionIntegrity({
            ...auditPayload, presentation_decision_id: auditDecisionIdFor(auditPayload),
            integrity_hash: canonicalHash({ ...auditPayload, presentation_decision_id: auditDecisionIdFor(auditPayload) })
          });
          const sealed = sealDecision(decision);
          associateCandidate(candidate.opportunity_candidate_id, decision.presentation_decision_id);
          return { version_created: sealed.status === "SEALED", decision: sealed.artifact };
        }
        const head = decisions.resolvePositionCurrent(scope, graph.position.position_id);
        if (command.expected_current_presentation_decision_id === undefined
            || command.expected_current_presentation_decision_id !== (head?.presentation_decision_id ?? null)) {
          throw mismatch("Presentation writer is stale or lacks an explicit expected head");
        }
        if (!head && previousBoundV1(graph.position.position_id)) {
          throw mismatch("V1 bound history requires verified migration before V2 issuance");
        }
        const semanticProjection = projectPayload(payload, recall);
        const semanticHash = presentationSemanticHash(semanticProjection);
        if (head && head.semantic_hash === semanticHash
            && canonicalSerialize(head.semantic_projection) === canonicalSerialize(semanticProjection)) {
          associateCandidate(candidate.opportunity_candidate_id, head.presentation_decision_id);
          return { version_created: false, decision: head };
        }
        const revision = (head?.revision ?? 0) + 1;
        const withoutIntegrity = {
          ...payload, position_id: graph.position.position_id,
          presentation_decision_id: positionDecisionIdFor(scope, graph.position.position_id, revision),
          schema_version: PRESENTATION_DECISION_V2_SCHEMA_VERSION, scope,
          record_kind: "POSITION_PRESENTATION" as const, public_series_member: true as const,
          revision, supersedes_presentation_decision_id: head?.presentation_decision_id ?? null,
          semantic_projection: semanticProjection, semantic_hash: semanticHash,
          decided_at: requireDate(command.decided_at), origin: head?.origin ?? "PRODUCTION_FIRST", migration_id: head?.migration_id ?? null
        };
        const decision = assertPresentationDecisionIntegrity({ ...withoutIntegrity, integrity_hash: canonicalHash(withoutIntegrity) });
        const sealed = sealDecision(decision);
        const key = `${scope}:${graph.position.position_id}`;
        if (sealed.status === "SEALED") idsByPosition.set(key, [...(idsByPosition.get(key) ?? []), decision.presentation_decision_id]);
        associateCandidate(candidate.opportunity_candidate_id, decision.presentation_decision_id);
        return { version_created: sealed.status === "SEALED", decision: sealed.artifact };
      }
      const semantic = canonicalSerialize(materialized);
      const existing = previous.find((item) => {
        return canonicalSerialize(semanticInput(item)) === semantic;
      });
      if (existing) return { version_created: false, decision: existing };

      const revision = previous.length + 1;
      const withoutIntegrity = {
        presentation_decision_id: decisionIdFor(candidate.opportunity_candidate_id, revision),
        ...materialized,
        revision,
        supersedes_presentation_decision_id:
          previous.at(-1)?.presentation_decision_id ?? null,
        decided_at: requireDate(command.decided_at),
        schema_version: PRESENTATION_DECISION_SCHEMA_VERSION
      } as const;
      const decision = assertPresentationDecisionIntegrity({
        ...withoutIntegrity,
        integrity_hash: canonicalHash(withoutIntegrity)
      });
      const sealed = sealDecision(decision);
      if (sealed.status === "SEALED") {
        const ids = idsByCandidate.get(candidate.opportunity_candidate_id) ?? [];
        ids.push(decision.presentation_decision_id);
        idsByCandidate.set(candidate.opportunity_candidate_id, ids);
      }
      return {
        version_created: sealed.status === "SEALED",
        decision: assertPresentationDecisionIntegrity(sealed.artifact)
      };
    },
    migrateV1(input) {
      if (!input.anchored_input_head || !input.actor.trim()) throw invalid("Migration requires verified anchor and actor");
      requireDate(input.created_at);
      const boundV1 = [...new Set([...idsByCandidate.values()].flat())].flatMap((id) => {
        const decision = decisions.resolve(id);
        return decision?.schema_version === PRESENTATION_DECISION_SCHEMA_VERSION
          && decision.position_id === input.position_id && decision.decision_basis.candidate_source_binding === "BOUND" ? [decision] : [];
      });
      const inventory = [...input.inventory].sort((left, right) => left.issuance_sequence - right.issuance_sequence
        || left.presentation_decision_id.localeCompare(right.presentation_decision_id));
      if (boundV1.length === 0 || inventory.length !== boundV1.length
          || new Set(inventory.map((item) => item.presentation_decision_id)).size !== inventory.length) {
        throw mismatch("Migration inventory is incomplete or ambiguous");
      }
      for (const decision of boundV1) {
        const reference = inventory.find((item) => item.presentation_decision_id === decision.presentation_decision_id);
        if (!reference || reference.integrity_hash !== decision.integrity_hash || !reference.envelope_integrity_hash
            || !Number.isSafeInteger(reference.issuance_sequence) || reference.issuance_sequence < 1) throw mismatch("Migration issuance proof mismatch");
      }
      const migrationId = `presentation-migration-v2:${canonicalHash({ schema_version: "presentation-v1-migration/2.0.0",
        scope, position_id: input.position_id, anchored_input_head: input.anchored_input_head, inventory })}`;
      const existing = decisions.resolveMigration(migrationId);
      if (existing) return { audit: existing, decision: existing.output_decision_id ? decisions.resolve(existing.output_decision_id) : null };
      if (decisions.resolvePositionCurrent(scope, input.position_id)) throw mismatch("Migration cannot overwrite a Position series");
      let classification: PresentationMigrationAudit["classification"] = "EQUIVALENT";
      let reasonCode = "V1_SEMANTIC_EQUIVALENCE_VERIFIED";
      const projected = [];
      for (const reference of inventory) {
        const decision = decisions.resolve(reference.presentation_decision_id);
        if (!decision || decision.schema_version !== PRESENTATION_DECISION_SCHEMA_VERSION) throw mismatch("V1 migration input is unavailable");
        const recall = recallDispositions.resolve(decision.recall_disposition_id);
        const candidate = candidates.resolve(decision.opportunity_candidate_id);
        const graph = decision.opportunity_version_id ? opportunities.resolve(decision.opportunity_version_id) : null;
        if (!recall || !candidate || !graph || recall.opportunity_candidate_id !== candidate.opportunity_candidate_id
            || recall.integrity_hash !== decision.recall_disposition_integrity_hash
            || !candidate.source_occurrence_version_id || !graph.opportunity_version.source_occurrence_version_ids.includes(candidate.source_occurrence_version_id)) {
          classification = "BLOCKED"; reasonCode = "V1_BINDING_NOT_PROVEN"; break;
        }
        try { projected.push({ decision, projection: projectPayload(semanticInput(decision), recall) }); }
        catch (error) {
          if (error instanceof PresentationSemanticProjectionError) {
            classification = "BLOCKED"; reasonCode = error.code; break;
          }
          if (error instanceof PresentationDecisionError && error.code === "TRUSTED_ARTIFACT_UNAVAILABLE") {
            classification = "BLOCKED"; reasonCode = "V1_UPSTREAM_NOT_PROVEN"; break;
          }
          throw error;
        }
      }
      if (classification === "EQUIVALENT" && new Set(projected.map((item) => canonicalSerialize(item.projection))).size !== 1) {
        classification = "BLOCKED"; reasonCode = "V1_SEMANTIC_CONFLICT";
      }
      let output: PresentationDecision | null = null;
      if (classification === "EQUIVALENT") {
        const primary = projected[0]!;
        const payload = { ...semanticInput(primary.decision),
          presentation_decision_id: positionDecisionIdFor(scope, input.position_id, 1), position_id: input.position_id,
          schema_version: PRESENTATION_DECISION_V2_SCHEMA_VERSION, scope,
          record_kind: "POSITION_PRESENTATION" as const, public_series_member: true as const,
          revision: 1, supersedes_presentation_decision_id: null,
          semantic_projection: primary.projection, semantic_hash: presentationSemanticHash(primary.projection),
          origin: "V1_MIGRATION" as const, migration_id: migrationId, decided_at: input.created_at };
        output = sealDecision(assertPresentationDecisionIntegrity({ ...payload, integrity_hash: canonicalHash(payload) })).artifact;
        idsByPosition.set(`${scope}:${input.position_id}`, [output.presentation_decision_id]);
        for (const item of boundV1) associateCandidate(item.opportunity_candidate_id, output.presentation_decision_id);
      }
      const payload = { migration_id: migrationId, schema_version: "presentation-v1-migration/2.0.0" as const,
        scope, position_id: input.position_id, anchored_input_head: input.anchored_input_head, inventory,
        classification, reason_code: reasonCode,
        primary_issuance_sequence: output ? inventory[0]!.issuance_sequence : null,
        output_decision_id: output?.presentation_decision_id ?? null,
        output_decision_integrity_hash: output?.integrity_hash ?? null,
        semantic_hash: output && output.schema_version === PRESENTATION_DECISION_V2_SCHEMA_VERSION
          && output.record_kind === "POSITION_PRESENTATION" ? output.semantic_hash : null,
        actor: input.actor, created_at: input.created_at };
      const audit = assertPresentationMigrationIntegrity({ ...payload, integrity_hash: canonicalHash(payload) });
      const sealed = registry.writer.seal(audit.migration_id, audit);
      if (sealed.artifact.schema_version !== "presentation-v1-migration/2.0.0") throw mismatch("Migration audit namespace collision");
      return { audit: assertPresentationMigrationIntegrity(sealed.artifact), decision: output };
    }
  };
  return Object.freeze(boundary);

  function associateCandidate(candidateId: OpportunityCandidateId, decisionId: PresentationDecisionId) {
    const ids = idsByCandidate.get(candidateId) ?? [];
    if (!ids.includes(decisionId)) idsByCandidate.set(candidateId, [...ids, decisionId]);
  }
  function previousBoundV1(positionId: PositionId) {
    return [...idsByCandidate.values()].flat().some((id) => {
      const decision = registry.resolver.resolve(id);
      return decision?.schema_version === PRESENTATION_DECISION_SCHEMA_VERSION
        && decision.position_id === positionId && decision.decision_basis.candidate_source_binding === "BOUND";
    });
  }
  function sealDecision(decision: PresentationDecision) {
    const sealed = registry.writer.seal(decision.presentation_decision_id, decision);
    if (!("presentation_decision_id" in sealed.artifact)) throw mismatch("Presentation artifact namespace collision");
    return { ...sealed, artifact: assertPresentationDecisionIntegrity(sealed.artifact) };
  }
  function projectPayload(payload: ReturnType<typeof semanticInput>, recall: NonNullable<ReturnType<TrustedRecallDispositionResolver["resolve"]>>) {
    const graph = payload.opportunity_version_id ? opportunities.resolve(payload.opportunity_version_id) : null;
    if (!graph || graph.position.position_id !== payload.position_id || graph.position_version.position_version_id !== payload.position_version_id) {
      throw mismatch("Presentation semantic projection requires verified PBOV bindings");
    }
    const relevanceAssessment = payload.relevance_assessment_id ? relevance.resolve(payload.relevance_assessment_id) : null;
    const eligibilityAssessment = payload.eligibility_assessment_id ? eligibility.resolve(payload.eligibility_assessment_id) : null;
    if (payload.relevance_assessment_id && (!relevanceAssessment || relevanceAssessment.integrity_hash !== payload.relevance_integrity_hash)) throw mismatch("Relevance seal mismatch");
    if (payload.eligibility_assessment_id && (!eligibilityAssessment || eligibilityAssessment.integrity_hash !== payload.eligibility_integrity_hash)) throw mismatch("Eligibility seal mismatch");
    if (eligibilityAssessment && eligibilityAssessment.assessment_scope !== scope) throw mismatch("Presentation scope mixing");
    const composition = payload.source_composition_id ? compositions?.resolve(payload.source_composition_id as never) : null;
    if (payload.source_composition_id && (!composition || composition.composition_hash !== payload.source_composition_hash)) throw unavailable("Trusted Presentation source composition is unavailable");
    const requirement = payload.requirement_set_version_id ? requirementSets?.resolve(payload.requirement_set_version_id) : null;
    if (payload.requirement_set_version_id && (!requirement || requirement.position_id !== graph.position.position_id
        || requirement.opportunity_version_id !== graph.opportunity_version.opportunity_version_id
        || requirement.source_composition_id !== payload.source_composition_id)) throw mismatch("Trusted Presentation requirement binding is unavailable or mismatched");
    const projection = requirement ? options.requirement_projections?.resolve(requirement.requirement_projection_id) : null;
    if (requirement && (!projection || assertRequirementProjectionIntegrity(projection).integrity_hash !== requirement.requirement_projection_integrity_hash)) throw mismatch("Trusted Requirement projection binding mismatch");
    const sourceBindings = [...(opportunities.resolveSources(graph.opportunity_version.opportunity_version_id) ?? [])];
    for (const surface of composition?.source_surfaces ?? []) {
      if (sourceBindings.some((binding) => binding.version.source_occurrence_version_id === surface.source_occurrence_version_id)) continue;
      const source = sourceOccurrences?.resolve(surface.source_occurrence_version_id);
      if (!source) throw new PresentationSemanticProjectionError("SourceComposition surface has no authoritative SOV descriptor");
      sourceBindings.push(source);
    }
    return buildPresentationSemanticProjectionV2({ scope, graph, source_bindings: sourceBindings,
      decision: payload, recall, relevance: relevanceAssessment, eligibility: eligibilityAssessment,
      composition: composition ?? null, requirement: requirement ?? null, requirement_projection: projection ?? null });
  }
}

export function assertTrustedPresentationDecisionResolver(
  resolver: TrustedPresentationDecisionResolver
) {
  if (!trustedDecisionResolvers.has(resolver as object)) {
    throw invalid("Presentation decision resolver must be composition-root controlled");
  }
  return resolver;
}

export function assertPresentationDecisionIntegrity(
  decision: PresentationDecision
): PresentationDecision {
  if (!PRESENTATION_DECISION_STATUSES.includes(decision.status)) {
    throw invalid("Presentation status is unsupported");
  }
  if (decision.schema_version === PRESENTATION_DECISION_V2_SCHEMA_VERSION) {
    if (!["PRODUCTION", "SYNTHETIC_TEST"].includes(decision.scope)
        || (decision.eligibility_assessment_scope && decision.eligibility_assessment_scope !== decision.scope)) {
      throw invalid("Presentation V2 scope mixing");
    }
    if (decision.record_kind === "UNBOUND_RETAINED_OUTCOME") {
      const { presentation_decision_id: _id, integrity_hash: _hash, ...payload } = decision;
      if (decision.public_series_member || decision.position_id !== null || decision.revision !== null
          || decision.supersedes_presentation_decision_id !== null
          || decision.presentation_decision_id !== auditDecisionIdFor(payload)) throw invalid("Invalid retained audit identity");
    } else if (decision.record_kind === "POSITION_PRESENTATION") {
      if (!decision.public_series_member || !decision.position_id || !Number.isSafeInteger(decision.revision)
          || decision.revision < 1 || decision.decision_basis.candidate_source_binding !== "BOUND"
          || decision.presentation_decision_id !== positionDecisionIdFor(decision.scope, decision.position_id, decision.revision)
          || decision.semantic_projection.scope !== decision.scope
          || decision.semantic_projection.subject.position_id !== decision.position_id
          || decision.semantic_projection.decision.status !== decision.status
          || canonicalSerialize(decision.semantic_projection.decision.reason_codes) !== canonicalSerialize(decision.reason_codes)
          || canonicalSerialize(decision.semantic_projection.decision.decision_basis) !== canonicalSerialize(decision.decision_basis)
          || decision.semantic_projection.policy.policy_id !== decision.policy_id
          || decision.semantic_projection.policy.policy_version !== decision.policy_version
          || !["PRODUCTION_FIRST", "V1_MIGRATION"].includes(decision.origin)
          || (decision.origin === "V1_MIGRATION" ? !decision.migration_id : decision.migration_id !== null)
          || decision.semantic_hash !== presentationSemanticHash(decision.semantic_projection)
          || (decision.revision === 1 ? decision.supersedes_presentation_decision_id !== null : !decision.supersedes_presentation_decision_id)) {
        throw invalid("Invalid Position-scoped Presentation identity or projection");
      }
    } else throw invalid("Unsupported Presentation V2 kind");
    if (decision.policy_id !== PRESENTATION_POLICY_V1_ID || decision.policy_version !== PRESENTATION_POLICY_V1_VERSION) {
      throw invalid("Unsupported Presentation policy");
    }
    requireDate(decision.decided_at);
    const { integrity_hash, ...payload } = decision;
    if (integrity_hash !== canonicalHash(payload)) throw invalid("Presentation decision integrity hash does not match content");
    return structuredClone(decision);
  }
  if (!Number.isInteger(decision.revision) || decision.revision < 1) {
    throw invalid("Presentation revision must be a positive integer");
  }
  if (decision.presentation_decision_id !== decisionIdFor(
    decision.opportunity_candidate_id,
    decision.revision
  )) {
    throw invalid("Presentation decision ID does not match Candidate revision");
  }
  if (decision.policy_id !== PRESENTATION_POLICY_V1_ID
      || decision.policy_version !== PRESENTATION_POLICY_V1_VERSION
      || decision.schema_version !== PRESENTATION_DECISION_SCHEMA_VERSION) {
    throw invalid("Presentation decision contract version is unsupported");
  }
  if (decision.revision === 1 && decision.supersedes_presentation_decision_id) {
    throw invalid("Initial presentation decision cannot supersede another revision");
  }
  if (decision.revision > 1 && !decision.supersedes_presentation_decision_id) {
    throw invalid("Later presentation decision must supersede the previous revision");
  }
  requireDate(decision.decided_at);
  const { integrity_hash: integrityHash, ...canonical } = decision;
  if (integrityHash !== canonicalHash(canonical)) {
    throw invalid("Presentation decision integrity hash does not match content");
  }
  return structuredClone(decision);
}

function materializeDecision(input: {
  readonly command: PresentationDecisionCommand;
  readonly candidate: OpportunityCandidate;
  readonly recall: NonNullable<ReturnType<TrustedRecallDispositionResolver["resolve"]>>;
  readonly policy: ApprovedPresentationPolicy;
  readonly opportunities: TrustedPositionBoundOpportunityResolver;
  readonly relevance: TrustedLegalEmploymentRelevanceResolver;
  readonly eligibility: TrustedEligibilityAssessmentResolver;
}) {
  const excluded = input.recall.status === "EXCLUDED"
    && input.recall.exclusion_rule !== null;
  if (excluded) {
    return decisionPayload(input, null, null, "NOT_DISPLAY", [
      "APPROVED_RECALL_EXCLUSION"
    ], "NOT_APPLICABLE", true);
  }
  if (!input.command.relevance_assessment_id) {
    return decisionPayload(input, null, null, "EVIDENCE_BLOCKED", [
      "RELEVANCE_ASSESSMENT_MISSING"
    ], "UNBOUND", false);
  }
  const relevanceAssessment = input.relevance.resolve(
    input.command.relevance_assessment_id as import("../domain").LegalEmploymentRelevanceAssessmentId
  );
  if (!relevanceAssessment) throw unavailable("Trusted Relevance assessment is unavailable");
  assertLegalEmploymentRelevanceAssessmentIntegrity(relevanceAssessment);
  const graph = input.opportunities.resolve(relevanceAssessment.opportunity_version_id);
  if (!graph
      || graph.position.position_id !== relevanceAssessment.position_id
      || graph.position_version.position_version_id
        !== relevanceAssessment.position_version_id) {
    throw mismatch("Relevance assessment does not match a trusted Position-bound Opportunity");
  }
  const candidateBinding = input.candidate.source_occurrence_version_id
    && relevanceAssessment.source_occurrence_version_ids.includes(
      input.candidate.source_occurrence_version_id
    )
    ? "BOUND" as const
    : "UNBOUND" as const;
  if (candidateBinding === "UNBOUND") {
    return decisionPayload(input, relevanceAssessment, null, "EVIDENCE_BLOCKED", [
      "OPPORTUNITY_CANDIDATE_POSITION_BINDING_UNRESOLVED"
    ], candidateBinding, false);
  }
  if (relevanceAssessment.assessment_state === "NOT_RELEVANT") {
    return decisionPayload(input, relevanceAssessment, null, "NOT_DISPLAY", [
      "TRUSTED_NOT_RELEVANT"
    ], candidateBinding, false);
  }
  if (relevanceAssessment.assessment_state === "EVIDENCE_BLOCKED") {
    return decisionPayload(input, relevanceAssessment, null, "EVIDENCE_BLOCKED", [
      "RELEVANCE_EVIDENCE_BLOCKED"
    ], candidateBinding, false);
  }
  if (!input.command.eligibility_assessment_id) {
    return decisionPayload(input, relevanceAssessment, null, "EVIDENCE_BLOCKED", [
      "ELIGIBILITY_ASSESSMENT_MISSING"
    ], candidateBinding, false);
  }
  const assessment = input.eligibility.resolve(input.command.eligibility_assessment_id);
  if (!assessment) throw unavailable("Trusted Eligibility assessment is unavailable");
  assertPositionBoundEligibilityAssessmentIntegrity(assessment);
  if (assessment.opportunity_version_id !== relevanceAssessment.opportunity_version_id
      || assessment.position_id !== relevanceAssessment.position_id
      || assessment.position_version_id !== relevanceAssessment.position_version_id
      || assessment.source_composition_id !== relevanceAssessment.source_composition_id) {
    throw mismatch("Eligibility assessment and Relevance assessment must describe one Position");
  }
  const status = input.relevance.resolve(relevanceAssessment.assessment_id)
    ?.assessment_state === "RELEVANT"
    && (assessment.result === "ELIGIBLE" || assessment.result === "LIKELY_ELIGIBLE")
    ? "DISPLAY" as const
    : "DISPLAY_WITH_REVIEW" as const;
  return decisionPayload(input, relevanceAssessment, assessment, status, [
    status === "DISPLAY" ? "TRUSTED_ELIGIBILITY_CONFIRMED" : "REVIEW_OR_INSUFFICIENT_ELIGIBILITY"
  ], candidateBinding, false);
}

function decisionPayload(
  input: Parameters<typeof materializeDecision>[0],
  relevance: LegalEmploymentRelevanceAssessment | null,
  assessment: PositionBoundEligibilityAssessment | null,
  status: PresentationDecision["status"],
  reasonCodes: readonly string[],
  candidateSourceBinding: PresentationDecision["decision_basis"]["candidate_source_binding"],
  approvedExclusion: boolean
) {
  return {
    opportunity_candidate_id: input.candidate.opportunity_candidate_id,
    recall_disposition_id: input.recall.recall_disposition_id,
    recall_disposition_integrity_hash: input.recall.integrity_hash,
    relevance_assessment_id: relevance?.assessment_id ?? null,
    relevance_integrity_hash: relevance?.integrity_hash ?? null,
    opportunity_version_id: relevance?.opportunity_version_id ?? null,
    position_id: relevance?.position_id ?? null,
    position_version_id: relevance?.position_version_id ?? null,
    source_composition_id: relevance?.source_composition_id ?? null,
    source_composition_hash: relevance?.source_composition_hash ?? null,
    requirement_set_version_id: assessment?.requirement_set_version_id ?? null,
    eligibility_assessment_id: assessment?.eligibility_assessment_id ?? null,
    eligibility_integrity_hash: assessment?.integrity_hash ?? null,
    eligibility_assessment_scope: assessment?.assessment_scope ?? null,
    policy_id: input.policy.policy_id,
    policy_version: input.policy.policy_version,
    status,
    reason_codes: [...reasonCodes].sort(),
    decision_basis: {
      recall_status: input.recall.status,
      relevance_state: relevance?.assessment_state ?? null,
      eligibility_result: assessment?.result ?? null,
      candidate_source_binding: candidateSourceBinding,
      approved_exclusion: approvedExclusion
    }
  } as const;
}

function semanticInput(decision: PresentationDecisionV1) {
  const {
    presentation_decision_id: _id,
    revision: _revision,
    supersedes_presentation_decision_id: _supersedes,
    decided_at: _decidedAt,
    schema_version: _schemaVersion,
    integrity_hash: _integrityHash,
    ...semantic
  } = decision;
  return semantic;
}

export function assertPresentationMigrationIntegrity(audit: PresentationMigrationAudit) {
  const { integrity_hash, ...payload } = audit;
  const inventory = [...audit.inventory].sort((left, right) => left.issuance_sequence - right.issuance_sequence
    || left.presentation_decision_id.localeCompare(right.presentation_decision_id));
  const expectedId = `presentation-migration-v2:${canonicalHash({ schema_version: audit.schema_version,
    scope: audit.scope, position_id: audit.position_id, anchored_input_head: audit.anchored_input_head, inventory })}`;
  if (audit.schema_version !== "presentation-v1-migration/2.0.0" || integrity_hash !== canonicalHash(payload)
      || !["PRODUCTION", "SYNTHETIC_TEST"].includes(audit.scope) || !audit.position_id
      || !audit.anchored_input_head || !audit.actor.trim() || !Number.isFinite(Date.parse(audit.created_at))
      || audit.migration_id !== expectedId || inventory.length === 0
      || canonicalSerialize(inventory) !== canonicalSerialize(audit.inventory)
      || new Set(inventory.map((reference) => reference.presentation_decision_id)).size !== inventory.length
      || inventory.some((reference) => !reference.presentation_decision_id
        || !/^[a-f0-9]{64}$/u.test(reference.integrity_hash)
        || !/^[a-f0-9]{64}$/u.test(reference.envelope_integrity_hash)
        || !Number.isSafeInteger(reference.issuance_sequence) || reference.issuance_sequence < 1)
      || (audit.classification === "EQUIVALENT"
        ? audit.reason_code !== "V1_SEMANTIC_EQUIVALENCE_VERIFIED"
          || audit.primary_issuance_sequence !== inventory[0]!.issuance_sequence
          || audit.output_decision_id !== positionDecisionIdFor(audit.scope, audit.position_id, 1)
          || !/^[a-f0-9]{64}$/u.test(audit.output_decision_integrity_hash ?? "")
          || !/^[a-f0-9]{64}$/u.test(audit.semantic_hash ?? "")
        : audit.classification !== "BLOCKED" || !audit.reason_code
          || audit.primary_issuance_sequence !== null || audit.output_decision_id !== null
          || audit.output_decision_integrity_hash !== null || audit.semantic_hash !== null)) {
    throw invalid("Presentation migration integrity failure");
  }
  return structuredClone(audit);
}

function positionDecisionIdFor(scope: PresentationScope, positionId: PositionId, revision: number) {
  return `presentation-decision-v2:${canonicalHash({ schema_version: PRESENTATION_DECISION_V2_SCHEMA_VERSION,
    scope, position_id: positionId, revision })}` as PresentationDecisionId;
}
function auditDecisionIdFor(payload: unknown) {
  return `presentation-audit-v2:${canonicalHash(payload)}` as PresentationDecisionId;
}

function decisionIdFor(candidateId: OpportunityCandidateId, revision: number) {
  return `presentation-decision:${canonicalHash({
    opportunity_candidate_id: candidateId,
    revision
  })}` as PresentationDecisionId;
}

function requireCommand(command: PresentationDecisionCommand) {
  if (!command || !command.opportunity_candidate_id || !command.recall_disposition_id) {
    throw invalid("Presentation decision requires trusted artifact references");
  }
  requireDate(command.decided_at);
}

function requireDate(value: IsoDateTime) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw invalid("Presentation decision time must be an ISO date-time");
  }
  return value;
}

function unavailable(message: string) {
  return new PresentationDecisionError("TRUSTED_ARTIFACT_UNAVAILABLE", message);
}

function mismatch(message: string) {
  return new PresentationDecisionError("TRUSTED_ARTIFACT_MISMATCH", message);
}

function invalid(message: string) {
  return new PresentationDecisionError("INVALID_INPUT", message);
}
