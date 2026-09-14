import { createHash } from "node:crypto";

import type {
  CanonicalOpportunity,
  Cr12RequirementCondition,
  Cr12RequirementLogicNode,
  Cr12StructuredRequirementSet,
  Position,
  PositionBoundOpportunityVersion,
  PositionVersion,
  RequirementContextBinding,
  RequirementContextTarget,
  RequirementEvidenceFragment,
  RequirementFact,
  RequirementObservation,
  SelectorLogicNode,
  SourceCompositionResult
} from "../domain";
import type {
  Cr12StructuredRequirementSetInput
} from "../requirements";
import {
  assertCr12StructuredRequirementSetIntegrity,
  assertSourceCompositionResultIntegrity,
  buildCr12StructuredRequirementSet
} from "../requirements";
import type { PositionIdentityResolutionInput } from "../normalization";
import {
  CanonicalArtifactRegistryError,
  createCanonicalArtifactRegistryAuthority
} from "../normalization/canonical-artifact-registry";
import {
  assertRequirementProjectionIntegrity,
  type RequirementProjectionArtifact
} from "./trusted-requirement-projection";

export const POSITION_BOUND_REQUIREMENT_SET_MATERIALIZATION_VERSION =
  "position-bound-requirement-set/2.0.0" as const;

export type PositionBoundRequirementProjectionInput = Omit<
  Cr12StructuredRequirementSetInput,
  "opportunity_version_id" | "source_composition_result"
>;

export interface PositionBoundRequirementSetVersion {
  readonly requirement_set_version_id: string;
  readonly position_id: Position["position_id"];
  readonly opportunity_version_id:
    PositionBoundOpportunityVersion["opportunity_version_id"];
  readonly position_version_id: PositionVersion["position_version_id"];
  readonly position_version_semantic_hash: PositionVersion["semantic_hash"];
  readonly canonical_opportunity_id:
    CanonicalOpportunity["canonical_opportunity_id"];
  readonly opportunity_version_semantic_hash:
    PositionBoundOpportunityVersion["semantic_hash"];
  readonly opportunity_version_integrity_hash:
    PositionBoundOpportunityVersion["integrity_hash"];
  readonly source_composition_id:
    SourceCompositionResult["source_composition_id"];
  readonly source_composition_hash: SourceCompositionResult["composition_hash"];
  readonly requirement_projection_id: string;
  readonly requirement_projection_key: string;
  readonly requirement_projection_output_hash: string;
  readonly requirement_projection_integrity_hash: string;
  readonly source_occurrence_version_ids:
    PositionBoundOpportunityVersion["source_occurrence_version_ids"];
  readonly source_composition_source_occurrence_version_ids:
    readonly PositionBoundOpportunityVersion["source_occurrence_version_ids"][number][];
  readonly revision: number;
  readonly semantic_hash: string;
  readonly requirement_set: Cr12StructuredRequirementSet;
  readonly materialization_version:
    typeof POSITION_BOUND_REQUIREMENT_SET_MATERIALIZATION_VERSION;
}

export interface PositionBoundRequirementSetMaterializationResult
  extends PositionBoundRequirementSetVersion {
  readonly version_created: boolean;
}

export interface PositionBoundRequirementSetMaterializationInput {
  readonly position: Position;
  readonly position_version: PositionVersion;
  readonly canonical_opportunity: CanonicalOpportunity;
  readonly opportunity_version: PositionBoundOpportunityVersion;
  readonly sources: readonly PositionIdentityResolutionInput[];
  readonly source_composition_result: SourceCompositionResult;
  readonly requirement_projection: RequirementProjectionArtifact;
}

export class PositionBoundRequirementSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PositionBoundRequirementSetError";
  }
}

export interface TrustedRequirementSetVersionResolver {
  resolve(requirementSetVersionId: string): PositionBoundRequirementSetVersion | null;
}

const trustedRequirementSetVersionResolvers = new WeakSet<object>();

export class InMemoryPositionBoundRequirementSetTracker
implements TrustedRequirementSetVersionResolver {
  readonly #versions = new Map<string, PositionBoundRequirementSetVersion[]>();
  readonly #registry = createCanonicalArtifactRegistryAuthority<
    string,
    PositionBoundRequirementSetVersion
  >((artifact) => artifact.requirement_set_version_id);

  constructor() {
    trustedRequirementSetVersionResolvers.add(this);
  }

  process(
    input: PositionBoundRequirementSetMaterializationInput
  ): PositionBoundRequirementSetMaterializationResult {
    const sourceComposition = validateTrustedComposition(input);
    if (sourceComposition.status !== "COMPLETE") {
      throw new PositionBoundRequirementSetError(
        "RequirementSet materialization requires a verified COMPLETE SourceCompositionResult"
      );
    }
    const projection = assertRequirementProjectionIntegrity(
      input.requirement_projection
    );
    if (projection.source_composition_id !== sourceComposition.source_composition_id
        || projection.source_composition_hash !== sourceComposition.composition_hash
        || projection.opportunity_version_id
          !== input.opportunity_version.opportunity_version_id) {
      throw new PositionBoundRequirementSetError(
        "RequirementProjection does not match the trusted SourceComposition/PBOV graph"
      );
    }
    const requirementInput = projection.output;
    requireRequirementProjectionShape(requirementInput);
    validateRequirementSourceBoundary(
      requirementInput,
      input.position,
      input.position_version,
      input.opportunity_version,
      sourceComposition
    );

    const requirementSet = buildCr12StructuredRequirementSet({
      ...requirementInput,
      opportunity_version_id: input.opportunity_version.opportunity_version_id,
      source_composition_result: sourceComposition
    }).structured_requirement_set;
    assertCr12StructuredRequirementSetIntegrity(requirementSet);

    const semanticHash = requirementSetSemanticHash(requirementSet);
    const opportunityVersionId = input.opportunity_version.opportunity_version_id;
    const existingVersions = this.#versions.get(opportunityVersionId) ?? [];
    const existing = existingVersions.find((version) => {
      return matchesTrustedMaterialization(
        version,
        input,
        sourceComposition,
        projection,
        requirementSet,
        semanticHash
      );
    });
    if (existing) {
      assertPositionBoundRequirementSetVersionIntegrity(existing);
      const sealed = this.#registry.writer.seal(
        existing.requirement_set_version_id,
        existing
      );
      return {
        ...clone(sealed.artifact),
        version_created: false
      };
    }

    const revision = existingVersions.length + 1;
    const requirementSetVersionId = requirementSetVersionIdFor(
      opportunityVersionId,
      input.position_version.position_version_id,
      input.position.position_id,
      input.position_version.semantic_hash,
      input.canonical_opportunity.canonical_opportunity_id,
      input.opportunity_version.semantic_hash,
      input.opportunity_version.integrity_hash,
      sourceComposition.source_composition_id,
      sourceComposition.composition_hash,
      input.opportunity_version.source_occurrence_version_ids,
      compositionSourceOccurrenceVersionIds(sourceComposition),
      projection,
      revision,
      semanticHash,
      requirementSet
    );
    const version = materializedVersion(
      input,
      sourceComposition,
      projection,
      requirementSet,
      semanticHash,
      revision,
      requirementSetVersionId
    );
    assertPositionBoundRequirementSetVersionIntegrity(version);
    let sealed;
    try {
      sealed = this.#registry.writer.seal(version.requirement_set_version_id, version);
    } catch (error) {
      if (error instanceof CanonicalArtifactRegistryError
          && error.code === "IDENTITY_COLLISION") {
        throw new PositionBoundRequirementSetError(
          `RequirementSetVersion identity collision: ${version.requirement_set_version_id}`
        );
      }
      throw error;
    }
    this.#versions.set(opportunityVersionId, [
      ...existingVersions,
      clone(sealed.artifact)
    ]);
    return { ...clone(sealed.artifact), version_created: true };
  }

  listVersions(
    opportunityVersionId: PositionBoundOpportunityVersion["opportunity_version_id"]
  ) {
    return (this.#versions.get(opportunityVersionId) ?? []).map(clone);
  }

  resolve(requirementSetVersionId: string) {
    const version = this.#registry.resolver.resolve(requirementSetVersionId);
    return version ? assertPositionBoundRequirementSetVersionIntegrity(version) : null;
  }
}

export function assertTrustedRequirementSetVersionResolver(
  resolver: TrustedRequirementSetVersionResolver
) {
  if (!trustedRequirementSetVersionResolvers.has(resolver as object)
      || Object.getPrototypeOf(resolver)
        !== InMemoryPositionBoundRequirementSetTracker.prototype) {
    throw new PositionBoundRequirementSetError(
      "Trusted RequirementSetVersion resolver must be composition-root controlled"
    );
  }
  return resolver;
}

function validateTrustedComposition(
  input: PositionBoundRequirementSetMaterializationInput
) {
  const rebuilt = assertSourceCompositionResultIntegrity(
    input.source_composition_result
  );
  if (rebuilt.opportunity_version_id
      !== input.opportunity_version.opportunity_version_id) {
    throw new PositionBoundRequirementSetError(
      "SourceCompositionResult does not match its validated Position-bound source graph"
    );
  }
  return rebuilt;
}

function requireRequirementProjectionShape(
  input: PositionBoundRequirementProjectionInput
) {
  const candidate = input as PositionBoundRequirementProjectionInput
    & Record<string, unknown>;
  if (!candidate.mandatory_root
      || !Array.isArray(candidate.conditions)
      || !Array.isArray(candidate.requirement_logic_trees)
      || !Array.isArray(candidate.facts)
      || !Array.isArray(candidate.candidate_credential_applicabilities)
      || !Array.isArray(candidate.candidate_state_applicabilities)
      || !Array.isArray(candidate.context_bindings)
      || !Array.isArray(candidate.source_references)
      || !Array.isArray(candidate.selector_predicates)
      || !Array.isArray(candidate.selector_logic_trees)
      || !Array.isArray(candidate.conditional_branch_sets)
      || !Array.isArray(candidate.evidence_fragments)
      || !Array.isArray(candidate.requirement_evidence)
      || !Array.isArray(candidate.observations)) {
    throw new PositionBoundRequirementSetError(
      "Legacy RequirementSet data is not a CR#12 Requirement projection"
    );
  }
}

function validateRequirementSourceBoundary(
  requirementInput: PositionBoundRequirementProjectionInput,
  position: Position,
  positionVersion: PositionVersion,
  opportunityVersion: PositionBoundOpportunityVersion,
  sourceComposition: SourceCompositionResult
) {
  const materialSurfaceIds = new Set(
    sourceComposition.inventory.expected_surface_entries.filter((entry) => {
      return entry.expectedness === "REQUIRED"
        && entry.coverage_status === "COVERED"
        && entry.resolution_status === "RESOLVED"
        && entry.source_surface_id !== null;
    }).map((entry) => entry.source_surface_id)
  );
  const surfaces = new Map(sourceComposition.source_surfaces.map((surface) => {
    return [surface.source_surface_id, surface] as const;
  }));
  const bindings = new Map(requirementInput.context_bindings.map((binding) => {
    return [binding.requirement_context_binding_id, binding] as const;
  }));
  const sourceExtractorsByTuple = new Map<string, string>();

  for (const source of requirementInput.source_references) {
    if (!source.source_surface_id
        || !materialSurfaceIds.has(source.source_surface_id)) {
      throw new PositionBoundRequirementSetError(
        "Requirement source must reference a selected material SourceSurface"
      );
    }
    const surface = surfaces.get(source.source_surface_id);
    const positionBoundSource = surface
      ? opportunityVersion.source_occurrence_version_ids.includes(
          surface.source_occurrence_version_id
        )
      : false;
    if (!surface
        || surface.snapshot_id !== source.snapshot_id
        || surface.extracted_record_id !== source.extracted_record_id
        || surface.extractor_version !== source.extractor_version
        || (surface.surface_kind === "POSITION_TABLE_ROW" && !positionBoundSource)
        || (source.source_role === "POSITION_TABLE_ROW" && !positionBoundSource)) {
      throw new PositionBoundRequirementSetError(
        "Requirement source does not match trusted Position/package SourceComposition provenance"
      );
    }
    assertTargetCompatible(
      source.source_context_target,
      position,
      positionVersion,
      opportunityVersion
    );
    const applicableBindings = source.applicable_binding_ids.map((bindingId) => {
      const binding = bindings.get(bindingId);
      if (!binding) {
        throw new PositionBoundRequirementSetError(
          "Requirement source references an unavailable context binding"
        );
      }
      return binding;
    });
    if (!applicableBindings.some((binding) => {
      return bindingTargetsOpportunity(
        binding,
        position,
        positionVersion,
        opportunityVersion
      );
    })) {
      throw new PositionBoundRequirementSetError(
        "Requirement source has no exact Position/PV/Opportunity applicability binding"
      );
    }
    sourceExtractorsByTuple.set(
      sourceTuple(source.snapshot_id, source.extracted_record_id),
      source.extractor_version
    );
  }

  for (const binding of requirementInput.context_bindings) {
    if (binding.opportunity_version_id
        !== opportunityVersion.opportunity_version_id) {
      throw new PositionBoundRequirementSetError(
        "Requirement context binding belongs to another OpportunityVersion"
      );
    }
    assertTargetCompatible(
      binding.source_context_target,
      position,
      positionVersion,
      opportunityVersion
    );
    for (const target of binding.effective_targets) {
      assertTargetCompatible(target, position, positionVersion, opportunityVersion);
    }
  }

  for (const fragment of requirementInput.evidence_fragments) {
    const sourceExtractor = sourceExtractorsByTuple.get(sourceTuple(
      fragment.snapshot_id,
      fragment.extracted_record_id
    ));
    if (!sourceExtractor || sourceExtractor !== fragment.extractor_version) {
      throw new PositionBoundRequirementSetError(
        "Requirement Evidence Fragment is not bound to a material source reference"
      );
    }
  }
  const fragmentProvenance = new Set(
    requirementInput.evidence_fragments.map((fragment) => {
      return evidenceExtractorTuple(fragment.snapshot_id, fragment.extractor_version);
    })
  );
  for (const evidence of requirementInput.requirement_evidence) {
    if (!fragmentProvenance.has(evidenceExtractorTuple(
      evidence.snapshot_id,
      evidence.extractor_version
    ))) {
      throw new PositionBoundRequirementSetError(
        "Requirement Evidence is not bound to a source Evidence Fragment"
      );
    }
  }
}

function bindingTargetsOpportunity(
  binding: RequirementContextBinding,
  position: Position,
  positionVersion: PositionVersion,
  opportunityVersion: PositionBoundOpportunityVersion
) {
  return binding.effective_targets.some((target) => {
    return targetMatches(target, position, positionVersion, opportunityVersion);
  });
}

function assertTargetCompatible(
  target: RequirementContextTarget,
  position: Position,
  positionVersion: PositionVersion,
  opportunityVersion: PositionBoundOpportunityVersion
) {
  if ((target.kind === "POSITION" && target.position_id !== position.position_id)
      || (target.kind === "POSITION_VERSION"
        && target.position_version_id !== positionVersion.position_version_id)
      || (target.kind === "OPPORTUNITY"
        && target.opportunity_id !== opportunityVersion.canonical_opportunity_id)
      || (target.kind === "OPPORTUNITY_VERSION"
        && target.opportunity_version_id
          !== opportunityVersion.opportunity_version_id)) {
    throw new PositionBoundRequirementSetError(
      "Requirement context crosses the supplied Position-bound Opportunity"
    );
  }
  if (target.kind === "REVISION_RELATION") {
    assertTargetCompatible(
      target.affected_target,
      position,
      positionVersion,
      opportunityVersion
    );
  }
}

function targetMatches(
  target: RequirementContextTarget,
  position: Position,
  positionVersion: PositionVersion,
  opportunityVersion: PositionBoundOpportunityVersion
): boolean {
  if (target.kind === "POSITION") return target.position_id === position.position_id;
  if (target.kind === "POSITION_VERSION") {
    return target.position_version_id === positionVersion.position_version_id;
  }
  if (target.kind === "OPPORTUNITY") {
    return target.opportunity_id === opportunityVersion.canonical_opportunity_id;
  }
  if (target.kind === "OPPORTUNITY_VERSION") {
    return target.opportunity_version_id === opportunityVersion.opportunity_version_id;
  }
  return target.kind === "REVISION_RELATION"
    && targetMatches(
      target.affected_target,
      position,
      positionVersion,
      opportunityVersion
    );
}

function sourceTuple(snapshotId: string, extractedRecordId: string) {
  return `${snapshotId}\u0000${extractedRecordId}`;
}

function evidenceExtractorTuple(snapshotId: string, extractorVersion: string) {
  return `${snapshotId}\u0000${extractorVersion}`;
}

function materializedVersion(
  input: PositionBoundRequirementSetMaterializationInput,
  sourceComposition: SourceCompositionResult,
  projection: Pick<RequirementProjectionArtifact,
    "requirement_projection_id" | "projection_key" | "output_hash" | "integrity_hash">,
  requirementSet: Cr12StructuredRequirementSet,
  semanticHash: string,
  revision: number,
  requirementSetVersionId: string
): PositionBoundRequirementSetVersion {
  return {
    requirement_set_version_id: requirementSetVersionId,
    position_id: input.position.position_id,
    opportunity_version_id: input.opportunity_version.opportunity_version_id,
    position_version_id: input.position_version.position_version_id,
    position_version_semantic_hash: input.position_version.semantic_hash,
    canonical_opportunity_id: input.canonical_opportunity.canonical_opportunity_id,
    opportunity_version_semantic_hash: input.opportunity_version.semantic_hash,
    opportunity_version_integrity_hash: input.opportunity_version.integrity_hash,
    source_composition_id: sourceComposition.source_composition_id,
    source_composition_hash: sourceComposition.composition_hash,
    requirement_projection_id: projection.requirement_projection_id,
    requirement_projection_key: projection.projection_key,
    requirement_projection_output_hash: projection.output_hash,
    requirement_projection_integrity_hash: projection.integrity_hash,
    source_occurrence_version_ids: clone(
      input.opportunity_version.source_occurrence_version_ids
    ),
    source_composition_source_occurrence_version_ids:
      compositionSourceOccurrenceVersionIds(sourceComposition),
    revision,
    semantic_hash: semanticHash,
    requirement_set: clone(requirementSet),
    materialization_version: POSITION_BOUND_REQUIREMENT_SET_MATERIALIZATION_VERSION
  };
}

function requirementSetVersionIdFor(
  opportunityVersionId: string,
  positionVersionId: string,
  positionId: string,
  positionVersionSemanticHash: string,
  canonicalOpportunityId: string,
  opportunityVersionSemanticHash: string,
  opportunityVersionIntegrityHash: string,
  sourceCompositionId: string,
  sourceCompositionHash: string,
  sourceOccurrenceVersionIds: readonly string[],
  sourceCompositionSourceOccurrenceVersionIds: readonly string[],
  projection: Pick<RequirementProjectionArtifact,
    "requirement_projection_id" | "projection_key" | "output_hash" | "integrity_hash">,
  revision: number,
  semanticHash: string,
  requirementSet: Cr12StructuredRequirementSet
) {
  return `requirement-set-version:${sha256(stableSerialize({
    opportunity_version_id: opportunityVersionId,
    position_version_id: positionVersionId,
    position_id: positionId,
    position_version_semantic_hash: positionVersionSemanticHash,
    canonical_opportunity_id: canonicalOpportunityId,
    opportunity_version_semantic_hash: opportunityVersionSemanticHash,
    opportunity_version_integrity_hash: opportunityVersionIntegrityHash,
    source_composition_id: sourceCompositionId,
    source_composition_hash: sourceCompositionHash,
    source_occurrence_version_ids:
      [...new Set(sourceOccurrenceVersionIds)].sort(),
    source_composition_source_occurrence_version_ids:
      [...new Set(sourceCompositionSourceOccurrenceVersionIds)].sort(),
    requirement_projection_id: projection.requirement_projection_id,
    requirement_projection_key: projection.projection_key,
    requirement_projection_output_hash: projection.output_hash,
    requirement_projection_integrity_hash: projection.integrity_hash,
    revision,
    semantic_hash: semanticHash,
    requirement_set_id: requirementSet.requirement_set_id,
    requirement_set_content_hash:
      requirementSet.completeness.requirement_set_content_hash,
    materialization_version: POSITION_BOUND_REQUIREMENT_SET_MATERIALIZATION_VERSION
  }))}`;
}

export function assertPositionBoundRequirementSetVersionIntegrity(
  version: PositionBoundRequirementSetVersion
) {
  assertCr12StructuredRequirementSetIntegrity(version.requirement_set);
  const semanticHash = requirementSetSemanticHash(version.requirement_set);
  const expectedId = requirementSetVersionIdFor(
    version.opportunity_version_id,
    version.position_version_id,
    version.position_id,
    version.position_version_semantic_hash,
    version.canonical_opportunity_id,
    version.opportunity_version_semantic_hash,
    version.opportunity_version_integrity_hash,
    version.source_composition_id,
    version.source_composition_hash,
    version.source_occurrence_version_ids,
    version.source_composition_source_occurrence_version_ids,
    {
      requirement_projection_id: version.requirement_projection_id,
      projection_key: version.requirement_projection_key,
      output_hash: version.requirement_projection_output_hash,
      integrity_hash: version.requirement_projection_integrity_hash
    },
    version.revision,
    semanticHash,
    version.requirement_set
  );
  const compositionReference = version.requirement_set.source_composition_reference;
  if (version.materialization_version
      !== POSITION_BOUND_REQUIREMENT_SET_MATERIALIZATION_VERSION
      || !Number.isSafeInteger(version.revision)
      || version.revision < 1
      || !version.position_id.trim()
      || !version.position_version_id.trim()
      || !version.position_version_semantic_hash.trim()
      || !version.canonical_opportunity_id.trim()
      || !version.opportunity_version_semantic_hash.trim()
      || !version.opportunity_version_integrity_hash.trim()
      || !version.source_composition_id.trim()
      || !/^sha256:[a-f0-9]{64}$/u.test(version.source_composition_hash)
      || !version.requirement_projection_id.trim()
      || !version.requirement_projection_key.trim()
      || !/^[a-f0-9]{64}$/u.test(version.requirement_projection_output_hash)
      || !/^[a-f0-9]{64}$/u.test(version.requirement_projection_integrity_hash)
      || version.source_occurrence_version_ids.length === 0
      || version.source_occurrence_version_ids.some((sourceVersionId) => {
        return !sourceVersionId.trim();
      })
      || new Set(version.source_occurrence_version_ids).size
        !== version.source_occurrence_version_ids.length
      || version.source_composition_source_occurrence_version_ids.length === 0
      || version.source_composition_source_occurrence_version_ids.some(
        (sourceVersionId) => !sourceVersionId.trim()
      )
      || new Set(version.source_composition_source_occurrence_version_ids).size
        !== version.source_composition_source_occurrence_version_ids.length
      || !/^[a-f0-9]{64}$/u.test(version.semantic_hash)
      || version.semantic_hash !== semanticHash
      || version.requirement_set_version_id !== expectedId
      || version.requirement_set.opportunity_version_id
        !== version.opportunity_version_id
      || version.requirement_set.source_composition_state !== "COMPOSITION_BACKED"
      || !compositionReference
      || compositionReference.source_composition_id
        !== version.source_composition_id
       || compositionReference.composition_hash
        !== version.source_composition_hash) {
    throw new PositionBoundRequirementSetError(
      "RequirementSet version identity does not match its immutable RequirementSet artifact"
    );
  }
  return version;
}

function requirementSetSemanticHash(requirementSet: Cr12StructuredRequirementSet) {
  const facts = new Map(requirementSet.fact_registry.map((fact) => {
    return [fact.requirement_fact_id, factSemantic(fact)] as const;
  }));
  const fragments = new Map(requirementSet.evidence_fragment_registry.map((fragment) => {
    return [fragment.requirement_evidence_fragment_id, fragmentSemantic(fragment)] as const;
  }));
  const credentialApplicabilities = new Map(
    requirementSet.candidate_credential_applicability_registry.map((item) => {
      return [item.candidate_credential_applicability_id,
        semanticObject(item)] as const;
    })
  );
  const contextBindings = new Map(requirementSet.context_binding_registry.map((binding) => {
    return [binding.requirement_context_binding_id, bindingSemantic(binding)] as const;
  }));
  const requirementTrees = new Map(
    requirementSet.requirement_logic_tree_registry.map((tree) => {
      return [tree.requirement_logic_tree_id, tree] as const;
    })
  );
  const observations = new Map(requirementSet.observation_registry.map((observation) => {
    return [observation.requirement_observation_id,
      observationSemantic(observation, facts, fragments)] as const;
  }));
  const selectorPredicates = new Map(
    requirementSet.selector_predicate_registry.map((predicate) => {
      return [predicate.requirement_selector_predicate_id,
        selectorPredicateSemantic(
          predicate,
          credentialApplicabilities,
          contextBindings
        )] as const;
    })
  );
  const selectorTrees = new Map(
    requirementSet.selector_logic_tree_registry.map((tree) => {
      return [tree.selector_logic_tree_id, tree] as const;
    })
  );
  const stateApplicabilities = new Map(
    requirementSet.candidate_state_applicability_registry.map((item) => {
      const semantic = semanticObject(item);
      return [item.candidate_state_applicability_id,
        item.mode === "STATE_SELECTOR" ? {
          ...semantic as Record<string, unknown>,
          selector: selectorTreeSemantic(
            item.selector_logic_tree_id,
            selectorPredicates,
            contextBindings,
            selectorTrees
          )
        } : semantic] as const;
    })
  );
  const branchSets = new Map(requirementSet.conditional_branch_set_registry.map((branch) => {
    return [branch.conditional_branch_set_id, branch] as const;
  }));
  const conditions = new Map(requirementSet.condition_registry.map((condition) => {
    return [condition.requirement_condition_id, conditionSemantic(
      condition,
      facts,
      credentialApplicabilities,
      stateApplicabilities,
      contextBindings,
      requirementTrees,
      observations,
      selectorPredicates,
      selectorTrees,
      branchSets
    )] as const;
  }));
  const payload = {
    logic_model_version: requirementSet.logic_model_version,
    mandatory_root: mandatoryRootSemantic(requirementSet, conditions, fragments),
    conditions: uniqueCanonical([...conditions.values()]),
    facts: uniqueCanonical([...facts.values()]),
    observations: uniqueCanonical([...observations.values()])
  };
  return sha256(stableSerialize(payload));
}

function factSemantic(fact: RequirementFact) {
  return semanticObject({
    dimension: fact.dimension,
    operator: fact.operator,
    value: fact.value,
    subject_scope: fact.subject_scope,
    logic_operator: fact.logic_group.operator,
    polarity: fact.polarity,
    certainty: fact.certainty,
    applicability: fact.applicability ?? null
  });
}

function fragmentSemantic(fragment: RequirementEvidenceFragment) {
  return semanticObject({
    observed_value_state: fragment.observed_value_state,
    text: fragment.observed_value_state === "TEXT"
      ? (fragment.normalized_text?.text ?? fragment.original_text.text)
        .normalize("NFKC").trim()
      : null,
    academic_program_directory: fragment.academic_program_directory ?? null,
    academic_program_directories: fragment.academic_program_directories ?? null
  });
}

function matchesTrustedMaterialization(
  version: PositionBoundRequirementSetVersion,
  input: PositionBoundRequirementSetMaterializationInput,
  sourceComposition: SourceCompositionResult,
  projection: RequirementProjectionArtifact,
  requirementSet: Cr12StructuredRequirementSet,
  semanticHash: string
) {
  return version.position_id === input.position.position_id
    && version.position_version_id === input.position_version.position_version_id
    && version.position_version_semantic_hash === input.position_version.semantic_hash
    && version.canonical_opportunity_id
      === input.canonical_opportunity.canonical_opportunity_id
    && version.opportunity_version_id
      === input.opportunity_version.opportunity_version_id
    && version.opportunity_version_semantic_hash
      === input.opportunity_version.semantic_hash
    && version.opportunity_version_integrity_hash
      === input.opportunity_version.integrity_hash
    && version.source_composition_id === sourceComposition.source_composition_id
    && version.source_composition_hash === sourceComposition.composition_hash
    && version.requirement_projection_id === projection.requirement_projection_id
    && version.requirement_projection_key === projection.projection_key
    && version.requirement_projection_output_hash === projection.output_hash
    && version.requirement_projection_integrity_hash === projection.integrity_hash
    && sameStringSet(
      version.source_occurrence_version_ids,
      input.opportunity_version.source_occurrence_version_ids
    )
    && sameStringSet(
      version.source_composition_source_occurrence_version_ids,
      compositionSourceOccurrenceVersionIds(sourceComposition)
    )
    && version.semantic_hash === semanticHash
    && version.requirement_set.requirement_set_id === requirementSet.requirement_set_id
    && version.requirement_set.completeness.requirement_set_content_hash
      === requirementSet.completeness.requirement_set_content_hash;
}

function compositionSourceOccurrenceVersionIds(
  sourceComposition: SourceCompositionResult
) {
  return [...new Set(sourceComposition.source_surfaces.map((surface) => {
    return surface.source_occurrence_version_id;
  }))].sort();
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function observationSemantic(
  observation: RequirementObservation,
  facts: ReadonlyMap<string, unknown>,
  fragments: ReadonlyMap<string, unknown>
) {
  return {
    status: observation.status,
    clause_role: observation.clause_role,
    dimension_hint: observation.dimension_hint ?? null,
    facts: uniqueCanonical(observation.requirement_fact_ids.map((id) => facts.get(id))),
    fragments: uniqueCanonical(observation.evidence_fragment_ids.map((id) => {
      return fragments.get(id);
    }))
  };
}

function conditionSemantic(
  condition: Cr12RequirementCondition,
  facts: ReadonlyMap<string, unknown>,
  credentialApplicabilities: ReadonlyMap<string, unknown>,
  stateApplicabilities: ReadonlyMap<string, unknown>,
  contextBindings: ReadonlyMap<string, unknown>,
  requirementTrees: ReadonlyMap<string, Cr12StructuredRequirementSet["requirement_logic_tree_registry"][number]>,
  observations: ReadonlyMap<string, unknown>,
  selectorPredicates: ReadonlyMap<string, unknown>,
  selectorTrees: ReadonlyMap<string, Cr12StructuredRequirementSet["selector_logic_tree_registry"][number]>,
  branchSets: ReadonlyMap<string, Cr12StructuredRequirementSet["conditional_branch_set_registry"][number]>
) {
  const common = {
    modality: condition.modality,
    resolution_state: condition.resolution_state,
    representation_kind: condition.representation_kind,
    credential_applicability: credentialApplicabilities.get(
      condition.candidate_credential_applicability_id
    ),
    state_applicability: stateApplicabilities.get(
      condition.candidate_state_applicability_id
    ),
    context_bindings: uniqueCanonical(condition.context_binding_ids.map((id) => {
      return contextBindings.get(id);
    }))
  };
  if (condition.representation_kind === "LOGIC_TREE") {
    return {
      ...common,
      expression: requirementTreeSemantic(
        condition.requirement_logic_tree_id,
        facts,
        contextBindings,
        requirementTrees
      )
    };
  }
  if (condition.representation_kind === "CONDITIONAL_BRANCH_SET") {
    const branch = branchSets.get(condition.conditional_branch_set_id);
    return {
      ...common,
      expression: branch ? {
         branch_semantics_state: branch.branch_semantics_state,
         context_bindings: uniqueCanonical(branch.context_binding_ids.map((id) => {
           return contextBindings.get(id);
         })),
         when: selectorTreeSemantic(
          branch.when_selector_logic_tree_id,
          selectorPredicates,
          contextBindings,
          selectorTrees
        ),
        then: requirementTreeSemantic(
          branch.then_requirement_logic_tree_id,
          facts,
          contextBindings,
          requirementTrees
        ),
        else: branch.else_requirement_logic_tree_id
          ? requirementTreeSemantic(
              branch.else_requirement_logic_tree_id,
              facts,
              contextBindings,
              requirementTrees
            )
          : null
      } : null
    };
  }
  return {
    ...common,
    blocking_observations: uniqueCanonical(
      condition.blocking_observation_ids.map((id) => observations.get(id))
    )
  };
}

function selectorPredicateSemantic(
  predicate: Cr12StructuredRequirementSet["selector_predicate_registry"][number],
  credentialApplicabilities: ReadonlyMap<string, unknown>,
  contextBindings: ReadonlyMap<string, unknown>
) {
  return {
    dimension: predicate.dimension,
    operator: predicate.operator,
    value: semanticObject(predicate.value),
    direct_candidate_cohorts:
      semanticObject(predicate.direct_candidate_cohorts ?? null),
    credential_applicability: credentialApplicabilities.get(
      predicate.candidate_credential_applicability_id
    ),
    context_bindings: uniqueCanonical(predicate.context_binding_ids.map((id) => {
      return contextBindings.get(id);
    })),
    resolution_state: predicate.resolution_state
  };
}

function requirementTreeSemantic(
  treeId: string,
  facts: ReadonlyMap<string, unknown>,
  contextBindings: ReadonlyMap<string, unknown>,
  trees: ReadonlyMap<string, Cr12StructuredRequirementSet["requirement_logic_tree_registry"][number]>
) {
  const tree = trees.get(treeId);
  if (!tree) return null;
  const nodes = new Map<string, Cr12RequirementLogicNode>(tree.nodes.map((node) => {
    return [node.requirement_logic_node_id, node] as const;
  }));
  const visit = (nodeId: string): unknown => {
    const node = nodes.get(nodeId);
    if (!node) return null;
    const common = {
      context_bindings: uniqueCanonical(node.context_binding_ids.map((id) => {
        return contextBindings.get(id);
      }))
    };
    if (node.kind === "PREDICATE") {
      return { ...common, kind: node.kind, fact: facts.get(node.requirement_fact_id) };
    }
    if (node.kind === "NOT") {
      return { ...common, kind: node.kind, child: visit(node.child_node_id) };
    }
    return {
      ...common,
      kind: node.kind,
      operator: node.operator,
      children: uniqueCanonical(node.child_node_ids.map(visit))
    };
  };
  return visit(tree.root_node_id);
}

function selectorTreeSemantic(
  treeId: string,
  predicates: ReadonlyMap<string, unknown>,
  contextBindings: ReadonlyMap<string, unknown>,
  trees: ReadonlyMap<string, Cr12StructuredRequirementSet["selector_logic_tree_registry"][number]>
) {
  const tree = trees.get(treeId);
  if (!tree) return null;
  const nodes = new Map<string, SelectorLogicNode>(tree.nodes.map((node) => {
    return [node.selector_logic_node_id, node] as const;
  }));
  const visit = (nodeId: string): unknown => {
    const node = nodes.get(nodeId);
    if (!node) return null;
    const common = {
      context_bindings: uniqueCanonical(node.context_binding_ids.map((id) => {
        return contextBindings.get(id);
      }))
    };
    if (node.kind === "SELECTOR_PREDICATE") {
      return {
        ...common,
        kind: node.kind,
        predicate: predicates.get(node.requirement_selector_predicate_id)
      };
    }
    if (node.kind === "NOT") {
      return { ...common, kind: node.kind, child: visit(node.child_node_id) };
    }
    return {
      ...common,
      kind: node.kind,
      operator: node.operator,
      children: uniqueCanonical(node.child_node_ids.map(visit))
    };
  };
  return visit(tree.root_node_id);
}

function mandatoryRootSemantic(
  requirementSet: Cr12StructuredRequirementSet,
  conditions: ReadonlyMap<string, unknown>,
  fragments: ReadonlyMap<string, unknown>
) {
  const root = requirementSet.mandatory_root;
  if (root.kind === "EMPTY_CONFIRMED") {
    return {
      kind: root.kind,
      evidence: uniqueCanonical(root.evidence_fragment_ids.map((id) => fragments.get(id)))
    };
  }
  if (root.kind === "SINGLE") {
    return { kind: root.kind, condition: conditions.get(root.requirement_condition_id) };
  }
  return {
    kind: root.kind,
    conditions: uniqueCanonical(root.requirement_condition_ids.map((id) => {
      return conditions.get(id);
    }))
  };
}

function bindingSemantic(binding: RequirementContextBinding) {
  return semanticObject({
    source_context_target: binding.source_context_target,
    effective_targets: binding.effective_targets,
    scope: binding.scope,
    state: binding.state,
    certainty: binding.certainty,
    recruitment_revision_relation_id:
      binding.recruitment_revision_relation_id ?? null
  });
}

function semanticObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(semanticObject);
    return items.every((item) => typeof item === "string")
      ? [...new Set(items as string[])].sort()
      : items;
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const omitted = new Set([
    "parser_version",
    "resolver_version",
    "schema_version",
    "serialization_version",
    "source_locator",
    "locator",
    "source_order"
  ]);
  return Object.fromEntries(Object.keys(record).sort().filter((key) => {
    return !omitted.has(key) && !key.endsWith("_id") && !key.endsWith("_ids");
  }).map((key) => [key, semanticObject(record[key])]));
}

function uniqueCanonical(values: readonly unknown[]) {
  const byCanonical = new Map<string, unknown>();
  for (const value of values) {
    if (value === undefined) continue;
    byCanonical.set(stableSerialize(value), value);
  }
  return [...byCanonical.entries()].sort(([left], [right]) => {
    return left.localeCompare(right);
  }).map(([, value]) => value);
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
