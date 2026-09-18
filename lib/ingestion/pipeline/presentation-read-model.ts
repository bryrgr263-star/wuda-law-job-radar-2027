import type {
  PresentationDecision,
  PresentationReadModel,
  PresentationReadModelId
} from "../domain";
import { PRESENTATION_READ_MODEL_SCHEMA_VERSION, PRESENTATION_DECISION_V2_SCHEMA_VERSION,
  PRESENTATION_READ_MODEL_V2_SCHEMA_VERSION } from "../domain";
import {
  assertTrustedPositionBoundOpportunityResolver,
  assertTrustedSourceOccurrenceVersionResolver,
  type TrustedPositionBoundOpportunityResolver
} from "../normalization";
import {
  canonicalHash,
  createCanonicalArtifactRegistryAuthority
} from "../normalization/canonical-artifact-registry";
import {
  assertTrustedRequirementSetVersionResolver,
  type TrustedRequirementSetVersionResolver
} from "./position-bound-requirement-set";
import {
  assertPresentationDecisionIntegrity,
  assertTrustedPresentationDecisionResolver,
  type TrustedPresentationDecisionResolver
} from "./presentation-decision";
import { presentationDisplay, presentationRequirementSummary } from "./presentation-semantic-projection";
import { assertTrustedSourceCompositionResolver, type TrustedSourceCompositionResolver } from "./position-bound-source-composition";
import { canonicalSerialize } from "../normalization/canonical-artifact-registry";

export interface PresentationReadModelMaterializer {
  materialize(presentationDecisionId: string): {
    readonly version_created: boolean;
    readonly read_model: PresentationReadModel;
  };
  resolve(presentationReadModelId: PresentationReadModelId): PresentationReadModel | null;
}

const trustedReadModelMaterializers = new WeakSet<object>();

export function createPresentationReadModelMaterializer(options: {
  readonly decisions: TrustedPresentationDecisionResolver;
  readonly position_bound_opportunities: TrustedPositionBoundOpportunityResolver;
  readonly requirement_sets: TrustedRequirementSetVersionResolver;
  readonly source_compositions?: TrustedSourceCompositionResolver;
  readonly source_occurrences?: import("../normalization").TrustedSourceOccurrenceVersionResolver;
}): PresentationReadModelMaterializer {
  const decisions = assertTrustedPresentationDecisionResolver(options.decisions);
  const opportunities = assertTrustedPositionBoundOpportunityResolver(
    options.position_bound_opportunities
  );
  const requirementSets = assertTrustedRequirementSetVersionResolver(
    options.requirement_sets
  );
  const compositions = options.source_compositions ? assertTrustedSourceCompositionResolver(options.source_compositions) : null;
  const sourceOccurrences = options.source_occurrences ? assertTrustedSourceOccurrenceVersionResolver(options.source_occurrences) : null;
  const registry = createCanonicalArtifactRegistryAuthority<
    PresentationReadModelId,
    PresentationReadModel
  >((model) => model.presentation_read_model_id);
  const materializer: PresentationReadModelMaterializer = Object.freeze({
    materialize(presentationDecisionId: string) {
      const decision = decisions.resolve(presentationDecisionId as never);
      if (!decision) throw new Error("Trusted PresentationDecision is unavailable");
      const model = project(assertPresentationDecisionIntegrity(decision));
      const sealed = registry.writer.seal(model.presentation_read_model_id, model);
      return { version_created: sealed.status === "SEALED", read_model: sealed.artifact };
    },
    resolve(id: PresentationReadModelId) {
      const model = registry.resolver.resolve(id);
      return model ? assertPresentationReadModelIntegrity(model) : null;
    }
  });
  trustedReadModelMaterializers.add(materializer as object);
  return materializer;

  function project(decision: PresentationDecision): PresentationReadModel {
    const graph = decision.opportunity_version_id
      ? opportunities.resolve(decision.opportunity_version_id)
      : null;
    if (decision.opportunity_version_id && !graph) {
      throw new Error("PresentationDecision PBOV provenance is unavailable");
    }
    if (graph && decision.position_id && (graph.position.position_id !== decision.position_id
        || graph.position_version.position_version_id !== decision.position_version_id)) {
      throw new Error("PresentationDecision PBOV provenance does not match");
    }
    const content = graph?.opportunity_version.content;
    const requirementSet = decision.requirement_set_version_id
      ? requirementSets.resolve(decision.requirement_set_version_id)
      : null;
    if (decision.requirement_set_version_id && !requirementSet) {
      throw new Error("PresentationDecision RequirementSetVersion is unavailable");
    }
    const unavailable = (reason: string) => ({ state: "NOT_YET_AVAILABLE" as const, reason });
    const value = <Value>(item: Value | null | undefined, reason: string) => {
      return item === null || item === undefined ? unavailable(reason) : {
        state: "AVAILABLE" as const, value: item
      };
    };
    const sourceIds = graph?.opportunity_version.source_occurrence_version_ids ?? [];
    const withoutIntegrity = {
      presentation_read_model_id: `presentation-read-model:${canonicalHash({
        presentation_decision_id: decision.presentation_decision_id,
        decision_integrity_hash: decision.integrity_hash,
        opportunity_version_integrity_hash: graph?.opportunity_version.integrity_hash ?? null,
        requirement_set_semantic_hash: requirementSet?.semantic_hash ?? null
      })}` as PresentationReadModelId,
      presentation_decision_id: decision.presentation_decision_id,
      opportunity_candidate_id: decision.opportunity_candidate_id,
      decision_revision: decision.revision,
      presentation_status: decision.status,
      reason_codes: [...decision.reason_codes],
      policy_id: decision.policy_id,
      policy_version: decision.policy_version,
      opportunity_version_id: decision.opportunity_version_id,
      position_id: decision.position_id,
      position_version_id: decision.position_version_id,
      employer: value(content?.organization.name.original.text, "EMPLOYER_NOT_AVAILABLE"),
      position_title: value(graph?.position_version.title.original.text, "POSITION_TITLE_NOT_AVAILABLE"),
      locations: value(content?.locations.map((location) => location.raw_text.text), "LOCATION_NOT_AVAILABLE"),
      recruitment_year: value(content?.recruitment_year, "RECRUITMENT_YEAR_NOT_AVAILABLE"),
      recruitment_batch: value(content?.recruitment_batch?.original.text, "RECRUITMENT_BATCH_NOT_AVAILABLE"),
      announcement_link: value(content?.announcement_locator, "ANNOUNCEMENT_LINK_NOT_AVAILABLE"),
      application_link: value(content?.application_locator, "APPLICATION_LINK_NOT_AVAILABLE"),
      requirement_summary: requirementSet ? {
        state: "AVAILABLE" as const,
        value: requirementSet.requirement_set.fact_registry.map((fact) => ({
          requirement_fact_id: fact.requirement_fact_id,
          dimension: fact.dimension,
          subject_scope: fact.subject_scope,
          polarity: fact.polarity,
          certainty: fact.certainty
        }))
      } : unavailable("REQUIREMENT_SET_NOT_AVAILABLE"),
      updated_at: decision.decided_at,
      effective_at: value(graph?.opportunity_version.effective_from, "EFFECTIVE_TIME_NOT_AVAILABLE"),
      upstream: {
        decision_integrity_hash: decision.integrity_hash,
        recall_disposition_id: decision.recall_disposition_id,
        recall_disposition_integrity_hash: decision.recall_disposition_integrity_hash,
        relevance_assessment_id: decision.relevance_assessment_id,
        relevance_integrity_hash: decision.relevance_integrity_hash,
        requirement_set_version_id: decision.requirement_set_version_id,
        eligibility_assessment_id: decision.eligibility_assessment_id,
        eligibility_integrity_hash: decision.eligibility_integrity_hash,
        eligibility_assessment_scope: decision.eligibility_assessment_scope,
        source_composition_id: decision.source_composition_id,
        source_composition_hash: decision.source_composition_hash,
        opportunity_version_semantic_hash: graph?.opportunity_version.semantic_hash ?? null,
        opportunity_version_integrity_hash: graph?.opportunity_version.integrity_hash ?? null,
        position_version_semantic_hash: graph?.position_version.semantic_hash ?? null,
        position_version_integrity_hash: graph?.position_version.integrity_hash ?? null,
        source_occurrence_version_ids: [...sourceIds]
      },
      schema_version: PRESENTATION_READ_MODEL_SCHEMA_VERSION
    } as const;
    if (decision.schema_version === PRESENTATION_DECISION_V2_SCHEMA_VERSION) {
      const modelId = presentationReadModelV2Id(decision);
      if (decision.record_kind === "POSITION_PRESENTATION") {
        const composition = decision.source_composition_id ? compositions?.resolve(decision.source_composition_id as import("../domain").SourceCompositionResultId) ?? null : null;
        const sourceBindings = graph ? [...(opportunities.resolveSources(graph.opportunity_version.opportunity_version_id) ?? [])] : [];
        for (const surface of composition?.source_surfaces ?? []) {
          if (sourceBindings.some((binding) => binding.version.source_occurrence_version_id === surface.source_occurrence_version_id)) continue;
          const source = sourceOccurrences?.resolve(surface.source_occurrence_version_id);
          if (!source) throw new Error("Presentation source surface has no authoritative SOV descriptor");
          sourceBindings.push(source);
        }
        const summary = graph && requirementSet && compositions ? presentationRequirementSummary({
          requirement: requirementSet, graph,
          composition, source_bindings: sourceBindings
        }) : undefined;
        if (!graph || canonicalSerialize(presentationDisplay(graph, requirementSet, summary))
            !== canonicalSerialize(decision.semantic_projection.display)) {
          throw new Error("Presentation V2 display differs from its sealed semantic basis");
        }
        const payload = {
          ...withoutIntegrity, ...decision.semantic_projection.display,
          presentation_read_model_id: modelId,
          schema_version: PRESENTATION_READ_MODEL_V2_SCHEMA_VERSION,
          record_kind: decision.record_kind, public_series_member: true as const,
          scope: decision.scope, position_id: decision.position_id,
          decision_revision: decision.revision, semantic_hash: decision.semantic_hash
        };
        return assertPresentationReadModelIntegrity({ ...payload, integrity_hash: canonicalHash(payload) });
      }
      const payload = {
        ...withoutIntegrity, presentation_read_model_id: modelId,
        schema_version: PRESENTATION_READ_MODEL_V2_SCHEMA_VERSION,
        record_kind: decision.record_kind, public_series_member: false as const,
        scope: decision.scope, position_id: null, decision_revision: null,
        requirement_summary: unavailable("POSITION_BINDING_REQUIRED")
      };
      return assertPresentationReadModelIntegrity({ ...payload, integrity_hash: canonicalHash(payload) });
    }
    return assertPresentationReadModelIntegrity({
      ...withoutIntegrity,
      decision_revision: decision.revision,
      integrity_hash: canonicalHash(withoutIntegrity)
    });
  }
}

export function assertTrustedPresentationReadModelMaterializer(
  materializer: PresentationReadModelMaterializer
) {
  if (!trustedReadModelMaterializers.has(materializer as object)) {
    throw new Error("PresentationReadModel materializer must be composition-root controlled");
  }
  return materializer;
}

export function assertPresentationReadModelIntegrity(
  model: PresentationReadModel
): PresentationReadModel {
  if (model.schema_version !== PRESENTATION_READ_MODEL_SCHEMA_VERSION
      && model.schema_version !== PRESENTATION_READ_MODEL_V2_SCHEMA_VERSION) {
    throw new Error("PresentationReadModel schema is unsupported");
  }
  if (model.schema_version === PRESENTATION_READ_MODEL_V2_SCHEMA_VERSION) {
    if (model.record_kind !== "POSITION_PRESENTATION" && model.record_kind !== "UNBOUND_RETAINED_OUTCOME") {
      throw new Error("Unsupported Presentation V2 ReadModel kind");
    }
    if ((model.record_kind === "POSITION_PRESENTATION" && (!model.public_series_member || !model.position_id
        || !Number.isSafeInteger(model.decision_revision) || model.decision_revision < 1))
        || (model.record_kind === "UNBOUND_RETAINED_OUTCOME" && (model.public_series_member
          || model.position_id !== null || model.decision_revision !== null))) {
      throw new Error("Presentation V2 ReadModel subject/revision mismatch");
    }
    if (!["PRODUCTION", "SYNTHETIC_TEST"].includes(model.scope)
        || (model.upstream.eligibility_assessment_scope && model.upstream.eligibility_assessment_scope !== model.scope)
        || model.presentation_read_model_id !== presentationReadModelV2Id({
          presentation_decision_id: model.presentation_decision_id, integrity_hash: model.upstream.decision_integrity_hash,
          scope: model.scope, position_id: model.position_id
        })) throw new Error("Presentation V2 ReadModel identity/scope mismatch");
  }
  const { integrity_hash, ...canonical } = model;
  if (integrity_hash !== canonicalHash(canonical)) {
    throw new Error("PresentationReadModel integrity hash does not match content");
  }
  return structuredClone(model);
}

function presentationReadModelV2Id(decision: Pick<PresentationDecision, "presentation_decision_id" | "integrity_hash" | "position_id">
  & { readonly scope: "PRODUCTION" | "SYNTHETIC_TEST" }) {
  return `presentation-read-model-v2:${canonicalHash({ schema_version: PRESENTATION_READ_MODEL_V2_SCHEMA_VERSION,
    scope: decision.scope, position_id: decision.position_id, presentation_decision_id: decision.presentation_decision_id,
    decision_integrity_hash: decision.integrity_hash, projector_version: "presentation-read-model-projector/2.0.0" })}` as PresentationReadModelId;
}
