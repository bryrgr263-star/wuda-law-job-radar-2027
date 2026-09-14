import { createHash } from "node:crypto";

import {
  assertCandidateStateAssertionIntegrity,
  CR12_ENGINE_CAPABILITIES,
  CR12_LOGIC_MODEL_VERSION,
  SOURCE_COMPOSITION_GATE_VERSION
} from "../domain";
import type {
  AcademicProgramDirectoryReference,
  CandidateBoundMajorMatchRelation,
  CandidateCredentialApplicability,
  CandidateCredentialId,
  CandidateStateApplicability,
  CandidateWorkExperience,
  CandidateProfile,
  Cr11MajorPredicateProjection,
  Cr12EngineCapability,
  Cr12RequirementSetManifest,
  Cr12RequirementCondition,
  Cr12RequirementLogicTree,
  Cr12StructuredRequirementSet,
  EducationCredential,
  EligibilityAssessment,
  EligibilityAssessmentId,
  EligibilityConflict,
  EligibilityReasonCode,
  EligibilityResult,
  LogicGroupId,
  MajorEquivalenceEvidence,
  MajorScopeRelationshipMode,
  NonEmptyReadonlyArray,
  ProfessionalQualification,
  RequirementContextBinding,
  RequirementContextTarget,
  RequirementEvidence,
  RequirementFact,
  RequirementFactId,
  RequirementSelectorPredicate,
  SelectorLogicTree,
  StructuredCandidateProfile,
  StructuredEligibilityAssessment,
  StructuredEligibilityReasonCode,
  RequirementValue
} from "../domain";
import {
  EligibilityInputError,
  type EligibilityEngine,
  type EligibilityEvaluationInput,
  type StructuredEligibilityDispatchResult,
  type StructuredEligibilityEngine,
  type StructuredEligibilityEvaluationInput,
  type StructuredEligibilityGateReason,
  type StructuredEligibilityGateResult,
  type TrustedSourceCompositionGate
} from "./types";

export const DETERMINISTIC_ELIGIBILITY_ENGINE_VERSION =
  "deterministic-eligibility-engine/3.0.0";

export const STRUCTURED_DETERMINISTIC_ELIGIBILITY_ENGINE_VERSION =
  "structured-deterministic-eligibility-engine/1.0.0";

export const STRUCTURED_ELIGIBILITY_ENGINE_CAPABILITIES: readonly Cr12EngineCapability[] = [
  "LOGIC_TREE_V1",
  "NOT_V1",
  "MODALITY_V1",
  "CREDENTIAL_APPLICABILITY_V1",
  "CANDIDATE_STATE_APPLICABILITY_V1",
  "CONTEXT_BINDING_V1",
  "SOURCE_REFERENCE_MANIFEST_V1",
  "CONTENT_HASH_MANIFEST_V1",
  "CONDITIONAL_SELECTOR_V1",
  "CR10_MAJOR_MATCH_RELATION_V1",
  "SOURCE_COMPOSITION_GATE_V1"
];

export function trustedStructuredEngineCapabilities(
  declared?: readonly Cr12EngineCapability[]
): readonly Cr12EngineCapability[] {
  const requested = declared ?? STRUCTURED_ELIGIBILITY_ENGINE_CAPABILITIES;
  return uniqueSorted(requested.filter((capability) => {
    return STRUCTURED_ELIGIBILITY_ENGINE_CAPABILITIES.includes(capability);
  }));
}

type PredicateOutcome = "SATISFIED" | "NOT_SATISFIED" | "UNKNOWN";
type ApplicabilityOutcome = "APPLIES" | "DOES_NOT_APPLY" | "UNKNOWN";

interface EvaluatedFact {
  readonly fact: RequirementFact;
  readonly outcome: PredicateOutcome;
  readonly applicability: ApplicabilityOutcome;
}

interface EvaluatedGroup {
  readonly outcome: PredicateOutcome;
  readonly is_certain: boolean;
}

const educationRank = {
  OTHER: 0,
  BACHELOR: 1,
  MASTER: 2,
  DOCTOR: 3
} as const;

export class DeterministicEligibilityEngine
implements EligibilityEngine, StructuredEligibilityEngine {
  constructor(
    private readonly sourceCompositionGate?: TrustedSourceCompositionGate
  ) {}

  evaluate(input: EligibilityEvaluationInput): EligibilityAssessment {
    validateInput(input);

    const requirementSet = input.complete_requirement_set;
    const evaluatedFacts = requirementSet.facts.map((fact): EvaluatedFact => {
      const applicability = evaluateApplicability(fact, input.candidate_profile);
      return {
        fact,
        applicability,
        outcome: applicability === "DOES_NOT_APPLY"
          ? "SATISFIED"
          : applicability === "UNKNOWN"
            ? "UNKNOWN"
            : evaluateFact(
              fact,
              input.candidate_profile,
              input.major_equivalence_evidence ?? []
            )
      };
    });
    const resolvedFacts = resolveMajorScopeRelationships(
      evaluatedFacts,
      input.candidate_profile
    );
    const conflicts = findConflicts(requirementSet.facts);
    const groups = evaluateGroups(resolvedFacts);
    const result = selectResult(resolvedFacts, groups, conflicts);
    const reasonCodes = selectReasonCodes(resolvedFacts, groups, conflicts, result);
    const evidenceIds = requirementSet.evidence
      .map((item) => item.requirement_evidence_id)
      .sort();
    const assessmentBase = {
      eligibility_assessment_id: assessmentId(input),
      candidate_profile_id: input.candidate_profile.candidate_profile_id,
      opportunity_version_id: input.opportunity_version.opportunity_version_id,
      reason_codes: asNonEmpty(reasonCodes),
      requirement_fact_ids: requirementSet.facts
        .map((fact) => fact.requirement_fact_id)
        .sort(),
      engine_version: DETERMINISTIC_ELIGIBILITY_ENGINE_VERSION,
      parser_versions: [...new Set(requirementSet.facts
        .map((fact) => fact.parser_version))].sort(),
      unresolved_conflicts: conflicts,
      major_equivalence_evidence_ids: uniqueSorted(
        (input.major_equivalence_evidence ?? []).map((item) => item.evidence_id)
      ),
      assessed_at: input.assessed_at
    };

    if (result === "ELIGIBLE") {
      return {
        ...assessmentBase,
        result,
        evidence_ids: asNonEmpty(evidenceIds)
      };
    }
    return {
      ...assessmentBase,
      result,
      evidence_ids: evidenceIds
    };
  }

  evaluateStructured(
    input: StructuredEligibilityEvaluationInput
  ): StructuredEligibilityDispatchResult {
    const gate = structuredExecutionGate(input, this.sourceCompositionGate);
    if (gate) return gate;

    const state: StructuredEvaluationState = {
      requirement_set: input.structured_requirement_set,
      candidate_profile: input.candidate_profile,
      candidate_bound_major_relations: []
    };
    const mandatory = evaluateStructuredMandatoryRoot(state);
    const result = mandatory.outcome === "TRUE" && !mandatory.has_unknown
      ? "MATCH"
      : mandatory.outcome === "FALSE" && !mandatory.has_unknown
        ? "NOT_MATCH"
        : "INSUFFICIENT";
    const reasonCodes = structuredReasonCodes(mandatory, result);
    const requirementSet = input.structured_requirement_set;
    const assessment: StructuredEligibilityAssessment = {
      structured_eligibility_assessment_id: structuredAssessmentId(input, state),
      result,
      candidate_profile_id: input.candidate_profile.candidate_profile_id,
      opportunity_version_id: input.opportunity_version.opportunity_version_id,
      requirement_set_id: requirementSet.requirement_set_id,
      requirement_set_content_hash:
        requirementSet.completeness.requirement_set_content_hash,
      candidate_credential_ids: uniqueSorted(input.candidate_profile.education.map((item) => {
        return item.candidate_credential_id;
      })),
      candidate_bound_major_match_relation_ids: uniqueSorted(
        state.candidate_bound_major_relations.map((item) => {
          return item.candidate_bound_major_match_relation_id;
        })
      ),
      reason_codes: uniqueSorted(reasonCodes),
      requirement_fact_ids: uniqueSorted(
        requirementSet.fact_registry.map((fact) => fact.requirement_fact_id)
      ),
      evidence_ids: uniqueSorted(
        requirementSet.requirement_evidence_registry.map((item) => {
          return item.requirement_evidence_id;
        })
      ),
      engine_version: STRUCTURED_DETERMINISTIC_ELIGIBILITY_ENGINE_VERSION,
      parser_versions: uniqueSorted([
        requirementSet.parser_version,
        ...requirementSet.condition_registry.map((item) => item.parser_version),
        ...requirementSet.fact_registry.map((item) => item.parser_version)
      ]),
      resolver_versions: uniqueSorted([
        requirementSet.resolver_version,
        ...requirementSet.condition_registry.map((item) => item.resolver_version),
        ...state.candidate_bound_major_relations.map((item) => item.resolver_version)
      ]),
      assessed_at: input.assessed_at
    };
    return { status: "ASSESSMENT", assessment };
  }
}

type StructuredTruth = "TRUE" | "FALSE" | "UNKNOWN";

interface StructuredEvaluationState {
  readonly requirement_set: Cr12StructuredRequirementSet;
  readonly candidate_profile: StructuredCandidateProfile;
  readonly candidate_bound_major_relations: CandidateBoundMajorMatchRelation[];
}

interface StructuredConditionEvaluation {
  readonly outcome: StructuredTruth;
  readonly has_unknown: boolean;
}

class StructuredRequirementSetIntegrityError extends Error {
  readonly code: "CONTENT_HASH_MISMATCH";

  constructor(message: string) {
    super(message);
    this.name = "StructuredRequirementSetIntegrityError";
    this.code = "CONTENT_HASH_MISMATCH";
  }
}

function structuredExecutionGate(
  input: StructuredEligibilityEvaluationInput,
  sourceCompositionGate: TrustedSourceCompositionGate | undefined
): StructuredEligibilityGateResult | null {
  const requirementSet = input.structured_requirement_set;
  const requiredCapabilities = requirementSet.execution_manifest
    .required_engine_capabilities;
  const supportedCapabilities = trustedStructuredEngineCapabilities(
    input.supported_engine_capabilities
  );
  try {
    assertStructuredRequirementSetIntegrity(requirementSet);
  } catch (error) {
    const reason: StructuredEligibilityGateReason = error instanceof
      StructuredRequirementSetIntegrityError
      ? "CONTENT_HASH_MANIFEST_MISMATCH"
      : "STRUCTURAL_INTEGRITY_FAILURE";
    return structuredGateResult(
      reason,
      requiredCapabilities,
      supportedCapabilities
    );
  }
  if (requirementSet.opportunity_version_id
      !== input.opportunity_version.opportunity_version_id
      || input.recruitment_context_snapshot.opportunity_version_id
        !== input.opportunity_version.opportunity_version_id
      || !contextContainsOpportunityVersion(
        input.recruitment_context_snapshot.effective_targets,
        input.opportunity_version.opportunity_version_id
      )
      || !contextBindingsApply(
        requirementSet.context_binding_registry,
        input.recruitment_context_snapshot.effective_targets,
        input.opportunity_version.opportunity_version_id
      )) {
    return structuredGateResult(
      "CONTEXT_BINDING_MISMATCH",
      requiredCapabilities,
      supportedCapabilities
    );
  }
  if (requirementSet.completeness.status !== "COMPLETE"
      || requirementSet.completeness.blockers.length !== 0) {
    return structuredGateResult(
      "REQUIREMENT_SET_NOT_COMPLETE",
      requiredCapabilities,
      supportedCapabilities
    );
  }
  const compositionGateResult = verifySourceCompositionGate(
    requirementSet,
    sourceCompositionGate,
    requiredCapabilities,
    supportedCapabilities
  );
  if (compositionGateResult) return compositionGateResult;
  if (requirementSet.fact_registry.some((fact) => {
    return fact.value.kind === "GENERAL_ELIGIBILITY_PREDICATE";
  })) {
    try {
      for (const assertion of input.offline_candidate_state_assertions ?? []) {
        assertCandidateStateAssertionIntegrity(assertion);
      }
    } catch {
      return structuredGateResult(
        "CANDIDATE_STATE_ASSERTION_INTEGRITY_FAILURE",
        requiredCapabilities,
        supportedCapabilities
      );
    }
  }
  const missingCapabilities = requiredCapabilities.filter((capability) => {
    return !supportedCapabilities.includes(capability);
  });
  if (missingCapabilities.length > 0) {
    return structuredGateResult(
      "BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY",
      requiredCapabilities,
      supportedCapabilities
    );
  }
  if (!candidateCredentialBindingsAreValid(input.candidate_profile)) {
    return structuredGateResult(
      "CANDIDATE_CREDENTIAL_BINDING_INVALID",
      requiredCapabilities,
      supportedCapabilities
    );
  }
  return null;
}

function verifySourceCompositionGate(
  requirementSet: Cr12StructuredRequirementSet,
  sourceCompositionGate: TrustedSourceCompositionGate | undefined,
  requiredCapabilities: readonly Cr12EngineCapability[],
  supportedCapabilities: readonly Cr12EngineCapability[]
): StructuredEligibilityGateResult | null {
  if (requirementSet.source_composition_state !== "COMPOSITION_BACKED"
      || !requirementSet.source_composition_reference) {
    return structuredGateResult(
      "SOURCE_COMPOSITION_LEGACY_UNCOMPOSED",
      requiredCapabilities,
      supportedCapabilities
    );
  }
  if (!sourceCompositionGate) {
    return structuredGateResult(
      "SOURCE_COMPOSITION_GATE_UNAVAILABLE",
      requiredCapabilities,
      supportedCapabilities
    );
  }
  const reference = requirementSet.source_composition_reference;
  const resolved = sourceCompositionGate.resolve(reference);
  if (!resolved) {
    return structuredGateResult(
      "SOURCE_COMPOSITION_NOT_FOUND",
      requiredCapabilities,
      supportedCapabilities
    );
  }
  try {
    const result = sourceCompositionGate.verify(resolved);
    if (result.status !== "COMPLETE") {
      return structuredGateResult(
        "SOURCE_COMPOSITION_VERIFICATION_FAILED",
        requiredCapabilities,
        supportedCapabilities
      );
    }
    if (result.source_composition_id !== reference.source_composition_id
        || result.opportunity_version_id !== reference.opportunity_version_id
        || result.composition_hash !== reference.composition_hash
        || result.composition_manifest_hash !== reference.composition_manifest_hash
        || result.composition_as_of !== reference.composition_as_of
        || result.schema_version !== reference.composition_schema_version
        || reference.composition_gate_version !== SOURCE_COMPOSITION_GATE_VERSION) {
      return structuredGateResult(
        "SOURCE_COMPOSITION_REFERENCE_MISMATCH",
        requiredCapabilities,
        supportedCapabilities
      );
    }
  } catch {
    return structuredGateResult(
      "SOURCE_COMPOSITION_VERIFICATION_FAILED",
      requiredCapabilities,
      supportedCapabilities
    );
  }
  return null;
}

function structuredGateResult(
  reason: StructuredEligibilityGateReason,
  requiredCapabilities: readonly Cr12EngineCapability[],
  supportedCapabilities: readonly Cr12EngineCapability[]
): StructuredEligibilityGateResult {
  const required = uniqueSorted(requiredCapabilities);
  const supported = uniqueSorted(supportedCapabilities);
  return {
    status: "NOT_ALLOWED",
    reason,
    required_capabilities: required,
    supported_capabilities: supported,
    missing_capabilities: required.filter((capability) => {
      return !supported.includes(capability);
    })
  };
}

function assertStructuredRequirementSetIntegrity(
  requirementSet: Cr12StructuredRequirementSet
) {
  const requiredCapabilities = requiredStructuredCapabilities(requirementSet);
  const manifest = structuredRequirementManifest(
    requirementSet,
    requiredCapabilities
  );
  if (stableSerialize(manifest)
      !== stableSerialize(requirementSet.completeness.manifest)) {
    throw new StructuredRequirementSetIntegrityError(
      "Structured Requirement Set manifest does not match its registries"
    );
  }
  const expectedHash = sha256(stableSerialize({
    logic_model_version: CR12_LOGIC_MODEL_VERSION,
    opportunity_version_id: requirementSet.opportunity_version_id,
    source_composition_state: requirementSet.source_composition_state,
    source_composition_reference: requirementSet.source_composition_reference,
    mandatory_root: requirementSet.mandatory_root,
    condition_registry: requirementSet.condition_registry,
    requirement_logic_tree_registry:
      requirementSet.requirement_logic_tree_registry,
    fact_registry: requirementSet.fact_registry,
    candidate_credential_applicability_registry:
      requirementSet.candidate_credential_applicability_registry,
    candidate_state_applicability_registry:
      requirementSet.candidate_state_applicability_registry,
    context_binding_registry: requirementSet.context_binding_registry,
    source_reference_registry: requirementSet.source_reference_registry,
    selector_predicate_registry: requirementSet.selector_predicate_registry,
    selector_logic_tree_registry: requirementSet.selector_logic_tree_registry,
    conditional_branch_set_registry:
      requirementSet.conditional_branch_set_registry,
    evidence_fragment_registry: requirementSet.evidence_fragment_registry,
    requirement_evidence_registry:
      requirementSet.requirement_evidence_registry,
    observation_registry: requirementSet.observation_registry,
    completeness_status: requirementSet.completeness.status,
    completeness_blockers: requirementSet.completeness.blockers,
    gate_version: requirementSet.completeness.gate_version,
    manifest,
    parser_version: requirementSet.parser_version,
    resolver_version: requirementSet.resolver_version
  }));
  if (expectedHash !== requirementSet.completeness.requirement_set_content_hash
      || requirementSet.requirement_set_id !== `requirement-set:${expectedHash}`) {
    throw new StructuredRequirementSetIntegrityError(
      "Structured Requirement Set content changed after hashing"
    );
  }
  const expectedExecutionGate = structuredManifestExecutionGate(
    requirementSet.completeness.status,
    requiredCapabilities,
    requirementSet.execution_manifest.execution_gate.supported_capabilities
  );
  if (requirementSet.logic_model_version !== CR12_LOGIC_MODEL_VERSION
      || requirementSet.execution_manifest.logic_model_version
        !== CR12_LOGIC_MODEL_VERSION
      || stableSerialize(uniqueSorted(
        requirementSet.execution_manifest.required_engine_capabilities
      )) !== stableSerialize(uniqueSorted(requiredCapabilities))
      || stableSerialize(expectedExecutionGate)
        !== stableSerialize(requirementSet.execution_manifest.execution_gate)) {
    throw new StructuredRequirementSetIntegrityError(
      "Structured Requirement Set execution capability manifest is inconsistent"
    );
  }
}

function requiredStructuredCapabilities(
  requirementSet: Cr12StructuredRequirementSet
): readonly Cr12EngineCapability[] {
  const usesNot = requirementSet.requirement_logic_tree_registry.some((tree) => {
    return tree.nodes.some((node) => node.kind === "NOT");
  }) || requirementSet.selector_logic_tree_registry.some((tree) => {
    return tree.nodes.some((node) => node.kind === "NOT");
  });
  const usesConditionalSelector = requirementSet.conditional_branch_set_registry.length > 0
    || requirementSet.selector_predicate_registry.length > 0
    || requirementSet.selector_logic_tree_registry.length > 0;
  const usesCr11MajorMatchRelation = requirementSet.fact_registry.some((fact) => {
    return fact.value.kind === "CR11_MAJOR_SEMANTIC";
  });
  const usesGeneralEligibilityPredicate = requirementSet.fact_registry.some((fact) => {
    return fact.value.kind === "GENERAL_ELIGIBILITY_PREDICATE";
  });
  return CR12_ENGINE_CAPABILITIES.filter((capability) => {
    if (capability === "NOT_V1") return usesNot;
    if (capability === "CONDITIONAL_SELECTOR_V1") {
      return usesConditionalSelector;
    }
    if (capability === "CR10_MAJOR_MATCH_RELATION_V1") {
      return usesCr11MajorMatchRelation;
    }
    if (capability === "SOURCE_COMPOSITION_GATE_V1") {
      return requirementSet.source_composition_state === "COMPOSITION_BACKED";
    }
    if (capability === "GENERAL_ELIGIBILITY_PREDICATE_V1") {
      return usesGeneralEligibilityPredicate;
    }
    return true;
  });
}

function structuredRequirementManifest(
  requirementSet: Cr12StructuredRequirementSet,
  requiredCapabilities: readonly Cr12EngineCapability[]
): Cr12RequirementSetManifest {
  return {
    logic_model_version: CR12_LOGIC_MODEL_VERSION,
    opportunity_version_id: requirementSet.opportunity_version_id,
    source_composition_state: requirementSet.source_composition_state,
    source_composition_reference: requirementSet.source_composition_reference,
    requirement_mandatory_root_id:
      requirementSet.mandatory_root.requirement_mandatory_root_id,
    requirement_condition_ids: uniqueSorted(requirementSet.condition_registry.map((item) => {
      return item.requirement_condition_id;
    })),
    requirement_logic_tree_ids: uniqueSorted(
      requirementSet.requirement_logic_tree_registry.map((item) => {
        return item.requirement_logic_tree_id;
      })
    ),
    requirement_logic_node_ids: uniqueSorted(
      requirementSet.requirement_logic_tree_registry.flatMap((tree) => {
        return tree.nodes.map((node) => node.requirement_logic_node_id);
      })
    ),
    requirement_fact_ids: uniqueSorted(requirementSet.fact_registry.map((item) => {
      return item.requirement_fact_id;
    })),
    candidate_credential_applicability_ids: uniqueSorted(
      requirementSet.candidate_credential_applicability_registry.map((item) => {
        return item.candidate_credential_applicability_id;
      })
    ),
    candidate_state_applicability_ids: uniqueSorted(
      requirementSet.candidate_state_applicability_registry.map((item) => {
        return item.candidate_state_applicability_id;
      })
    ),
    requirement_context_binding_ids: uniqueSorted(
      requirementSet.context_binding_registry.map((item) => {
        return item.requirement_context_binding_id;
      })
    ),
    requirement_source_reference_ids: uniqueSorted(
      requirementSet.source_reference_registry.map((item) => {
        return item.requirement_source_reference_id;
      })
    ),
    requirement_selector_predicate_ids: uniqueSorted(
      requirementSet.selector_predicate_registry.map((item) => {
        return item.requirement_selector_predicate_id;
      })
    ),
    selector_logic_tree_ids: uniqueSorted(
      requirementSet.selector_logic_tree_registry.map((item) => {
        return item.selector_logic_tree_id;
      })
    ),
    selector_logic_node_ids: uniqueSorted(
      requirementSet.selector_logic_tree_registry.flatMap((tree) => {
        return tree.nodes.map((node) => node.selector_logic_node_id);
      })
    ),
    conditional_branch_set_ids: uniqueSorted(
      requirementSet.conditional_branch_set_registry.map((item) => {
        return item.conditional_branch_set_id;
      })
    ),
    evidence_fragment_ids: uniqueSorted(
      requirementSet.evidence_fragment_registry.map((item) => {
        return item.requirement_evidence_fragment_id;
      })
    ),
    requirement_evidence_ids: uniqueSorted(
      requirementSet.requirement_evidence_registry.map((item) => {
        return item.requirement_evidence_id;
      })
    ),
    observation_ids: uniqueSorted(requirementSet.observation_registry.map((item) => {
      return item.requirement_observation_id;
    })),
    completeness_blocker_fingerprints: uniqueSorted(
      requirementSet.completeness.blockers.map((blocker) => {
        return sha256(stableSerialize(blocker));
      })
    ),
    snapshot_ids: uniqueSorted([
      ...requirementSet.evidence_fragment_registry.map((item) => item.snapshot_id),
      ...requirementSet.source_reference_registry.map((item) => item.snapshot_id)
    ]),
    extracted_record_ids: uniqueSorted([
      ...requirementSet.evidence_fragment_registry.map((item) => {
        return item.extracted_record_id;
      }),
      ...requirementSet.source_reference_registry.map((item) => {
        return item.extracted_record_id;
      })
    ]),
    parser_versions: uniqueSorted([
      requirementSet.parser_version,
      ...requirementSet.condition_registry.map((item) => item.parser_version),
      ...requirementSet.requirement_logic_tree_registry.map((item) => {
        return item.parser_version;
      }),
      ...requirementSet.fact_registry.map((item) => item.parser_version),
      ...requirementSet.candidate_credential_applicability_registry.map((item) => {
        return item.parser_version;
      }),
      ...requirementSet.candidate_state_applicability_registry.map((item) => {
        return item.parser_version;
      }),
      ...requirementSet.source_reference_registry.map((item) => {
        return item.parser_version;
      }),
      ...requirementSet.selector_predicate_registry.map((item) => {
        return item.parser_version;
      }),
      ...requirementSet.selector_logic_tree_registry.map((item) => {
        return item.parser_version;
      }),
      ...requirementSet.conditional_branch_set_registry.map((item) => {
        return item.parser_version;
      }),
      ...requirementSet.evidence_fragment_registry.map((item) => {
        return item.parser_version;
      }),
      ...requirementSet.requirement_evidence_registry.map((item) => {
        return item.parser_version;
      }),
      ...requirementSet.observation_registry.map((item) => item.parser_version)
    ]),
    extractor_versions: uniqueSorted([
      ...requirementSet.source_reference_registry.map((item) => {
        return item.extractor_version;
      }),
      ...requirementSet.evidence_fragment_registry.map((item) => {
        return item.extractor_version;
      }),
      ...requirementSet.requirement_evidence_registry.map((item) => {
        return item.extractor_version;
      })
    ]),
    resolver_versions: uniqueSorted([
      requirementSet.resolver_version,
      ...requirementSet.condition_registry.map((item) => item.resolver_version),
      ...requirementSet.context_binding_registry.map((item) => {
        return item.resolver_version;
      }),
      ...requirementSet.source_reference_registry.map((item) => {
        return item.resolver_version;
      }),
      ...requirementSet.source_reference_registry.map((item) => {
        return item.relationship.resolver_version;
      }),
      ...requirementSet.conditional_branch_set_registry.map((item) => {
        return item.resolver_version;
      })
    ]),
    required_engine_capabilities: uniqueSorted(requiredCapabilities),
    gate_version: requirementSet.completeness.gate_version,
    serialization_version: requirementSet.completeness.manifest.serialization_version
  };
}

function structuredManifestExecutionGate(
  completenessStatus: Cr12StructuredRequirementSet["completeness"]["status"],
  requiredCapabilities: readonly Cr12EngineCapability[],
  supportedCapabilities: readonly Cr12EngineCapability[]
) {
  const required = uniqueSorted(requiredCapabilities);
  const supported = uniqueSorted(supportedCapabilities);
  const missing = required.filter((capability) => {
    return !supported.includes(capability);
  });
  if (completenessStatus !== "COMPLETE") {
    return {
      status: "NOT_ALLOWED" as const,
      reason: "REQUIREMENT_SET_NOT_COMPLETE" as const,
      required_capabilities: required,
      supported_capabilities: supported,
      missing_capabilities: missing
    };
  }
  if (missing.length > 0) {
    return {
      status: "NOT_ALLOWED" as const,
      reason: "BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY" as const,
      required_capabilities: required,
      supported_capabilities: supported,
      missing_capabilities: missing
    };
  }
  return {
    status: "ALLOWED" as const,
    reason: "ENGINE_CAPABILITIES_SATISFIED" as const,
    required_capabilities: required,
    supported_capabilities: supported
  };
}

function candidateCredentialBindingsAreValid(
  candidate: StructuredCandidateProfile
): boolean {
  const ids = candidate.education.map((credential) => {
    return credential.candidate_credential_id;
  });
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return false;
  return candidate.education.every((credential) => {
    if (!credential.major_identity_assertion
        || !credential.major_identity_assertion.identity_label?.text) return false;
    if (credential.completeness !== "COMPLETE") return true;
    return credential.major_identity_assertion.provenance_state === "COMPLETE"
      && credential.major_identity_assertion.semantic_code !== "UNRESOLVED";
  });
}

function contextContainsOpportunityVersion(
  targets: readonly RequirementContextTarget[],
  opportunityVersionId: string
): boolean {
  return targets.some((target) => {
    return target.kind === "OPPORTUNITY_VERSION"
      && target.opportunity_version_id === opportunityVersionId;
  });
}

function contextBindingsApply(
  bindings: readonly RequirementContextBinding[],
  targets: readonly RequirementContextTarget[],
  opportunityVersionId: string
): boolean {
  return bindings.every((binding) => {
    return binding.state === "RESOLVED"
      && binding.scope !== "UNRESOLVED"
      && binding.opportunity_version_id === opportunityVersionId
      && binding.source_context_target.kind !== "UNRESOLVED"
      && binding.effective_targets.every((target) => {
        return target.kind !== "UNRESOLVED"
          && targets.some((available) => stableSerialize(available)
            === stableSerialize(target));
      });
  });
}

function evaluateStructuredMandatoryRoot(
  state: StructuredEvaluationState
): StructuredConditionEvaluation {
  const root = state.requirement_set.mandatory_root;
  if (root.kind === "EMPTY_CONFIRMED") {
    return { outcome: "TRUE", has_unknown: false };
  }
  const conditionIds = root.kind === "SINGLE"
    ? [root.requirement_condition_id]
    : root.requirement_condition_ids;
  const evaluations = conditionIds.map((conditionId) => {
    return evaluateStructuredCondition(state, conditionId);
  });
  return {
    outcome: evaluateStructuredAnd(evaluations.map((item) => item.outcome)),
    has_unknown: evaluations.some((item) => item.has_unknown)
  };
}

function evaluateStructuredCondition(
  state: StructuredEvaluationState,
  conditionId: string
): StructuredConditionEvaluation {
  const condition = state.requirement_set.condition_registry.find((item) => {
    return item.requirement_condition_id === conditionId;
  });
  if (!condition || condition.resolution_state !== "RESOLVED") {
    return { outcome: "UNKNOWN", has_unknown: true };
  }
  if (condition.modality !== "MANDATORY") {
    return { outcome: "TRUE", has_unknown: false };
  }
  const candidateState = state.requirement_set
    .candidate_state_applicability_registry.find((item) => {
      return item.candidate_state_applicability_id
        === condition.candidate_state_applicability_id;
    });
  const stateApplicability = candidateState
    ? evaluateCandidateStateApplicability(state, candidateState)
    : "UNKNOWN";
  if (stateApplicability === "FALSE") {
    return { outcome: "TRUE", has_unknown: false };
  }
  if (stateApplicability === "UNKNOWN") {
    return { outcome: "UNKNOWN", has_unknown: true };
  }
  const outcome = condition.representation_kind === "LOGIC_TREE"
    ? evaluateRequirementLogicTree(state, condition, condition.requirement_logic_tree_id)
    : evaluateConditionalRequirement(state, condition);
  return { outcome, has_unknown: outcome === "UNKNOWN" };
}

function evaluateConditionalRequirement(
  state: StructuredEvaluationState,
  condition: Cr12RequirementCondition
): StructuredTruth {
  if (condition.representation_kind !== "CONDITIONAL_BRANCH_SET") {
    return "UNKNOWN";
  }
  const branchSet = state.requirement_set.conditional_branch_set_registry.find((item) => {
    return item.conditional_branch_set_id === condition.conditional_branch_set_id;
  });
  if (!branchSet || branchSet.branch_semantics_state !== "RESOLVED") {
    return "UNKNOWN";
  }
  const selector = evaluateSelectorLogicTree(
    state,
    branchSet.when_selector_logic_tree_id
  );
  if (selector === "TRUE") {
    return evaluateRequirementLogicTree(
      state,
      condition,
      branchSet.then_requirement_logic_tree_id
    );
  }
  if (selector === "FALSE") {
    return branchSet.else_requirement_logic_tree_id
      ? evaluateRequirementLogicTree(
        state,
        condition,
        branchSet.else_requirement_logic_tree_id
      )
      : "TRUE";
  }
  return "UNKNOWN";
}

function evaluateRequirementLogicTree(
  state: StructuredEvaluationState,
  condition: Cr12RequirementCondition,
  treeId: string
): StructuredTruth {
  const tree = state.requirement_set.requirement_logic_tree_registry.find((item) => {
    return item.requirement_logic_tree_id === treeId;
  });
  if (!tree || tree.requirement_condition_id !== condition.requirement_condition_id) {
    return "UNKNOWN";
  }
  const nodes = new Map(tree.nodes.map((node) => [node.requirement_logic_node_id, node]));
  const evaluateNode = (
    nodeId: typeof tree.root_node_id
  ): StructuredTruth => {
    const node = nodes.get(nodeId);
    if (!node) return "UNKNOWN";
    if (node.kind === "PREDICATE") {
      const fact = state.requirement_set.fact_registry.find((item) => {
        return item.requirement_fact_id === node.requirement_fact_id;
      });
      return fact ? evaluateStructuredFact(state, condition, fact) : "UNKNOWN";
    }
    if (node.kind === "NOT") return invertStructuredTruth(evaluateNode(node.child_node_id));
    const children = node.child_node_ids.map(evaluateNode);
    return node.operator === "AND"
      ? evaluateStructuredAnd(children)
      : evaluateStructuredOr(children);
  };
  return evaluateNode(tree.root_node_id);
}

function evaluateSelectorLogicTree(
  state: StructuredEvaluationState,
  treeId: string
): StructuredTruth {
  const tree = state.requirement_set.selector_logic_tree_registry.find((item) => {
    return item.selector_logic_tree_id === treeId;
  });
  if (!tree) return "UNKNOWN";
  const nodes = new Map(tree.nodes.map((node) => [node.selector_logic_node_id, node]));
  const evaluateNode = (
    nodeId: typeof tree.root_node_id
  ): StructuredTruth => {
    const node = nodes.get(nodeId);
    if (!node) return "UNKNOWN";
    if (node.kind === "SELECTOR_PREDICATE") {
      const predicate = state.requirement_set.selector_predicate_registry.find((item) => {
        return item.requirement_selector_predicate_id
          === node.requirement_selector_predicate_id;
      });
      return predicate ? evaluateSelectorPredicate(state, predicate) : "UNKNOWN";
    }
    if (node.kind === "NOT") return invertStructuredTruth(evaluateNode(node.child_node_id));
    const children = node.child_node_ids.map(evaluateNode);
    return node.operator === "AND"
      ? evaluateStructuredAnd(children)
      : evaluateStructuredOr(children);
  };
  return evaluateNode(tree.root_node_id);
}

function evaluateCandidateStateApplicability(
  state: StructuredEvaluationState,
  applicability: CandidateStateApplicability
): StructuredTruth {
  if (applicability.mode === "ALL_CANDIDATES") return "TRUE";
  if (applicability.mode === "UNRESOLVED") return "UNKNOWN";
  if (applicability.mode === "STATE_SELECTOR") {
    return evaluateSelectorLogicTree(state, applicability.selector_logic_tree_id);
  }
  const cohorts = state.candidate_profile.candidate_cohorts;
  if (!cohorts) return "UNKNOWN";
  const candidateCohorts = new Set(cohorts);
  const matches = applicability.mode === "COHORT_ALL_OF"
    ? applicability.candidate_cohorts.every((cohort) => candidateCohorts.has(cohort))
    : applicability.candidate_cohorts.some((cohort) => candidateCohorts.has(cohort));
  return matches ? "TRUE" : "FALSE";
}

function evaluateSelectorPredicate(
  state: StructuredEvaluationState,
  predicate: RequirementSelectorPredicate
): StructuredTruth {
  if (predicate.resolution_state !== "RESOLVED") return "UNKNOWN";
  const applicability = state.requirement_set
    .candidate_credential_applicability_registry.find((item) => {
      return item.candidate_credential_applicability_id
        === predicate.candidate_credential_applicability_id;
    });
  if (!applicability) return "UNKNOWN";
  const selected = selectCandidateCredentials(state.candidate_profile, applicability);
  if (selected.outcome === "UNKNOWN") return "UNKNOWN";
  const fact: RequirementFact = {
    requirement_fact_id: (
      predicate.requirement_selector_predicate_id as unknown as RequirementFactId
    ),
    opportunity_version_id: predicate.opportunity_version_id,
    dimension: predicate.dimension,
    operator: predicate.operator,
    value: predicate.value,
    subject_scope: "CANDIDATE",
    logic_group: {
      logic_group_id: (
        predicate.requirement_selector_predicate_id as unknown as LogicGroupId
      ),
      operator: "AND"
    },
    polarity: "POSITIVE",
    certainty: "EXPLICIT",
    parser_version: predicate.parser_version
  };
  return evaluateGenericStructuredFact(
    fact,
    state.candidate_profile,
    selected.credentials
  );
}

function evaluateStructuredFact(
  state: StructuredEvaluationState,
  condition: Cr12RequirementCondition,
  fact: RequirementFact
): StructuredTruth {
  if (fact.polarity !== "POSITIVE") return "UNKNOWN";
  if (fact.value.kind === "CR11_MAJOR_SEMANTIC") {
    return evaluateCr11MajorPredicate(state, condition, fact.value.projection);
  }
  if (fact.dimension === "MAJOR"
      || fact.dimension === "MAJOR_MATCH_RULE"
      || fact.dimension === "MAJOR_SCOPE_RELATIONSHIP") return "UNKNOWN";
  const applicability = state.requirement_set
    .candidate_credential_applicability_registry.find((item) => {
      return item.candidate_credential_applicability_id
        === condition.candidate_credential_applicability_id;
    });
  if (!applicability) return "UNKNOWN";
  const selected = selectCandidateCredentials(state.candidate_profile, applicability);
  if (selected.outcome === "UNKNOWN") return "UNKNOWN";
  return evaluateGenericStructuredFact(fact, state.candidate_profile, selected.credentials);
}

function evaluateGenericStructuredFact(
  fact: RequirementFact,
  candidate: StructuredCandidateProfile,
  credentials: readonly StructuredCandidateProfile["education"][number][]
): StructuredTruth {
  const scopedCandidate: CandidateProfile = {
    ...candidate,
    education: credentials
  };
  const outcome = evaluateFact(fact, scopedCandidate, []);
  if (outcome === "SATISFIED") return "TRUE";
  if (outcome === "UNKNOWN") return "UNKNOWN";
  return structuredGenericFailureIsProven(fact, candidate, credentials)
    ? "FALSE"
    : "UNKNOWN";
}

function structuredGenericFailureIsProven(
  fact: RequirementFact,
  candidate: StructuredCandidateProfile,
  credentials: readonly StructuredCandidateProfile["education"][number][]
): boolean {
  if (fact.certainty !== "EXPLICIT") return false;
  if (fact.dimension === "EDUCATION_LEVEL"
      || fact.dimension === "ACADEMIC_DEGREE") {
    return credentials.length > 0 && credentials.every((credential) => {
      return credential.completeness === "COMPLETE";
    });
  }
  if (fact.dimension === "PROFESSIONAL_QUALIFICATION"
      && fact.value.kind === "PROFESSIONAL_QUALIFICATION") {
    const qualificationRequirement = fact.value;
    return candidate.professional_qualifications.some((qualification) => {
      return qualification.qualification_type
          === qualificationRequirement.qualification_type
        && (qualificationRequirement.qualification_class === undefined
          || qualification.qualification_class
            === qualificationRequirement.qualification_class)
        && qualification.status === "NOT_OBTAINED";
    });
  }
  if (fact.dimension === "AGE") return candidate.date_of_birth !== undefined;
  if (fact.dimension === "GENDER") return candidate.gender !== undefined;
  if (fact.dimension === "CANDIDATE_COHORT") {
    return candidate.candidate_cohorts !== undefined;
  }
  if (fact.dimension === "HOUSEHOLD_REGISTRATION") {
    return candidate.household_registration_codes !== undefined;
  }
  if (fact.dimension === "STUDENT_ORIGIN") {
    return candidate.student_origin_codes !== undefined;
  }
  if (fact.dimension === "GRADUATION_YEAR") {
    return candidate.target_graduation_year !== undefined;
  }
  if (fact.dimension === "WORK_EXPERIENCE") {
    return candidate.work_experience !== undefined
      || candidate.work_experience_months !== undefined;
  }
  if (fact.dimension === "LANGUAGE") return candidate.languages.length > 0;
  return fact.dimension === "POLITICAL_AFFILIATION"
    && candidate.political_affiliation !== undefined;
}

function evaluateCr11MajorPredicate(
  state: StructuredEvaluationState,
  condition: Cr12RequirementCondition,
  projection: Cr11MajorPredicateProjection
): StructuredTruth {
  if (projection.source_resolution_state !== "SOURCE_RESOLVED"
      || projection.candidate_credential_applicability_id
        !== condition.candidate_credential_applicability_id
      || projection.context_binding_ids.some((bindingId) => {
        return !condition.context_binding_ids.includes(bindingId);
      })) return "UNKNOWN";
  if (projection.major_expression.major_scope === "UNRESTRICTED") return "TRUE";
  const applicability = state.requirement_set
    .candidate_credential_applicability_registry.find((item) => {
      return item.candidate_credential_applicability_id
        === projection.candidate_credential_applicability_id;
    });
  if (!applicability) return "UNKNOWN";
  const selected = selectCandidateCredentials(state.candidate_profile, applicability);
  if (selected.outcome === "UNKNOWN" || selected.credentials.length === 0) {
    return "UNKNOWN";
  }
  const relations = selected.credentials.map((credential) => {
    const relation = resolveCandidateBoundMajorRelation(projection, credential);
    state.candidate_bound_major_relations.push(relation);
    return relation.result;
  });
  return selected.require_all
    ? evaluateStructuredAnd(relations)
    : evaluateStructuredOr(relations);
}

function resolveCandidateBoundMajorRelation(
  projection: Cr11MajorPredicateProjection,
  credential: StructuredCandidateProfile["education"][number]
): CandidateBoundMajorMatchRelation {
  const candidateIdentity = credential.major_identity_assertion;
  const templates = projection.major_match_relations.filter((template) => {
    return template.candidate_major_identity.semantic_code
      === candidateIdentity.semantic_code
      && template.candidate_credential_applicability_id
        === projection.candidate_credential_applicability_id;
  });
  const results = templates.map((template) => {
    if (credential.completeness !== "COMPLETE"
        || candidateIdentity.provenance_state !== "COMPLETE"
        || template.relation_state !== "ESTABLISHED"
        || template.certainty === "UNRESOLVED") return "UNKNOWN" as const;
    if (template.relation_kind === "EXACT_IDENTITY") return "TRUE" as const;
    if (template.relation_kind === "UNRESTRICTED") return "TRUE" as const;
    if (template.relation_kind === "EXPLICIT_INCLUDED") return "TRUE" as const;
    if (template.relation_kind === "EXPLICIT_EXCLUDED") {
      return template.certainty === "EXPLICIT" ? "FALSE" as const : "UNKNOWN" as const;
    }
    if (template.relation_kind !== "DIRECTORY_MEMBERSHIP") {
      return "UNKNOWN" as const;
    }
    const directory = template.directory_reference;
    if (!directory?.directory_version || !directory.program_code
        || !candidateIdentity.directory_namespace
        || !candidateIdentity.directory_version
        || !candidateIdentity.major_code) return "UNKNOWN" as const;
    return candidateIdentity.directory_namespace === directory.directory_namespace
      && candidateIdentity.directory_version === directory.directory_version
      && candidateIdentity.major_code === directory.program_code
      ? "TRUE" as const
      : "UNKNOWN" as const;
  });
  const result = results.length === 0
    ? "UNKNOWN"
    : results.includes("TRUE") && results.includes("FALSE")
      ? "UNKNOWN"
      : evaluateStructuredOr(results);
  const firstTemplate = templates[0];
  return {
    candidate_bound_major_match_relation_id: `candidate-bound-major-relation:${sha256(
      stableSerialize({
        source_major_expression_id: projection.major_expression.major_expression_id,
        candidate_credential_id: credential.candidate_credential_id,
        relation_template_ids: templates.map((item) => item.major_match_relation_id).sort(),
        result,
        resolver_version: projection.resolver_version
      })
    )}` as CandidateBoundMajorMatchRelation[
      "candidate_bound_major_match_relation_id"
    ],
    candidate_credential_id: credential.candidate_credential_id,
    source_major_expression_id: projection.major_expression.major_expression_id,
    target_semantic_type: projection.major_expression.semantic_type,
    target_major_scope: projection.major_expression.major_scope,
    ...(projection.major_expression.major_identity ? {
      target_major_identity_semantic_code:
        projection.major_expression.major_identity.semantic_code
    } : {}),
    candidate_major_identity: candidateIdentity,
    candidate_credential_applicability_id:
      projection.candidate_credential_applicability_id,
    ...(firstTemplate ? {
      relation_template_id: firstTemplate.major_match_relation_id
    } : {}),
    relation_type: firstTemplate?.relation_kind ?? "NOT_ESTABLISHED",
    relation_evidence_fragment_ids: uniqueSorted(templates.flatMap((template) => {
      return template.evidence_fragment_ids;
    })),
    ...(firstTemplate?.directory_reference ? {
      directory_namespace: firstTemplate.directory_reference.directory_namespace,
      ...(firstTemplate.directory_reference.directory_version ? {
        directory_version: firstTemplate.directory_reference.directory_version
      } : {})
    } : {}),
    parser_version: projection.parser_version,
    resolver_version: projection.resolver_version,
    provenance: credential.provenance,
    completeness: credential.completeness,
    result
  };
}

function selectCandidateCredentials(
  candidate: StructuredCandidateProfile,
  applicability: CandidateCredentialApplicability
): {
  readonly outcome: "RESOLVED" | "UNKNOWN";
  readonly credentials: readonly StructuredCandidateProfile["education"][number][];
  readonly require_all: boolean;
} {
  if (applicability.mode === "UNRESOLVED" || applicability.mode === "HIGHEST_DEGREE") {
    return { outcome: "UNKNOWN", credentials: [], require_all: false };
  }
  const credentials = candidate.education;
  const matchesDegree = (
    credential: StructuredCandidateProfile["education"][number],
    degree: "BACHELOR" | "MASTER" | "DOCTOR" | "GRADUATE"
  ) => degree === "GRADUATE"
    ? credential.level === "MASTER" || credential.level === "DOCTOR"
    : credential.level === degree;
  if (applicability.mode === "CANDIDATE_WIDE") {
    return { outcome: "RESOLVED", credentials, require_all: false };
  }
  if (applicability.mode === "UNDERGRADUATE") {
    return {
      outcome: "RESOLVED",
      credentials: credentials.filter((credential) => credential.level === "BACHELOR"),
      require_all: false
    };
  }
  if (applicability.mode === "GRADUATE") {
    return {
      outcome: "RESOLVED",
      credentials: credentials.filter((credential) => {
        return credential.level === "MASTER" || credential.level === "DOCTOR";
      }),
      require_all: false
    };
  }
  if (applicability.mode === "SPECIFIC_DEGREE") {
    return {
      outcome: "RESOLVED",
      credentials: credentials.filter((credential) => {
        return credential.level === applicability.degree;
      }),
      require_all: false
    };
  }
  if (applicability.mode !== "ANY_DEGREE"
      && applicability.mode !== "ALL_DEGREES"
      && applicability.mode !== "EITHER_LEVEL") {
    return { outcome: "UNKNOWN", credentials: [], require_all: false };
  }
  return {
    outcome: "RESOLVED",
    credentials: credentials.filter((credential) => {
      return applicability.applicable_degrees.some((degree) => {
        return matchesDegree(credential, degree);
      });
    }),
    require_all: applicability.mode === "ALL_DEGREES"
  };
}

function evaluateStructuredAnd(outcomes: readonly StructuredTruth[]): StructuredTruth {
  if (outcomes.includes("FALSE")) return "FALSE";
  if (outcomes.includes("UNKNOWN")) return "UNKNOWN";
  return "TRUE";
}

function evaluateStructuredOr(outcomes: readonly StructuredTruth[]): StructuredTruth {
  if (outcomes.includes("TRUE")) return "TRUE";
  if (outcomes.includes("UNKNOWN")) return "UNKNOWN";
  return "FALSE";
}

function invertStructuredTruth(outcome: StructuredTruth): StructuredTruth {
  if (outcome === "TRUE") return "FALSE";
  if (outcome === "FALSE") return "TRUE";
  return "UNKNOWN";
}

function structuredReasonCodes(
  mandatory: StructuredConditionEvaluation,
  result: StructuredEligibilityAssessment["result"]
): StructuredEligibilityReasonCode[] {
  if (result === "MATCH") return ["MANDATORY_REQUIREMENTS_SATISFIED"];
  if (result === "NOT_MATCH") {
    return ["PROVEN_MANDATORY_REQUIREMENT_NOT_SATISFIED"];
  }
  return mandatory.has_unknown
    ? ["CANDIDATE_DATA_UNKNOWN", "MAJOR_RELATION_NOT_ESTABLISHED"]
    : ["CANDIDATE_CREDENTIAL_INCOMPLETE"];
}

function structuredAssessmentId(
  input: StructuredEligibilityEvaluationInput,
  state: StructuredEvaluationState
): StructuredEligibilityAssessment["structured_eligibility_assessment_id"] {
  return `structured-eligibility-assessment:${sha256(stableSerialize({
    opportunity_version_id: input.opportunity_version.opportunity_version_id,
    candidate_profile_id: input.candidate_profile.candidate_profile_id,
    candidate_credentials: input.candidate_profile.education,
    requirement_set_id: input.structured_requirement_set.requirement_set_id,
    requirement_set_content_hash:
      input.structured_requirement_set.completeness.requirement_set_content_hash,
    candidate_bound_major_relations: state.candidate_bound_major_relations,
    engine_version: STRUCTURED_DETERMINISTIC_ELIGIBILITY_ENGINE_VERSION
  }))}` as StructuredEligibilityAssessment[
    "structured_eligibility_assessment_id"
  ];
}

function validateInput(input: EligibilityEvaluationInput) {
  const requirementSet = input.complete_requirement_set;
  if (!Array.isArray(requirementSet.facts)) {
    throw new EligibilityInputError(
      "STRUCTURED_REQUIREMENT_SET_UNSUPPORTED",
      "Legacy EligibilityEvaluationInput does not accept a structured Requirement Set"
    );
  }
  if (requirementSet.completeness.status !== "COMPLETE"
      || requirementSet.completeness.blockers.length !== 0) {
    throw new EligibilityInputError(
      "REQUIREMENT_SET_INCOMPLETE",
      "Eligibility accepts only a blocker-free COMPLETE Requirement Set"
    );
  }
  if (requirementSet.opportunity_version_id
      !== input.opportunity_version.opportunity_version_id) {
    throw new EligibilityInputError(
      "REQUIREMENT_SET_OPPORTUNITY_MISMATCH",
      "Requirement Set belongs to another OpportunityVersion"
    );
  }
  if (requirementSet.requirement_set_id
      !== requirementSet.completeness.requirement_set_id) {
    throw new EligibilityInputError(
      "REQUIREMENT_SET_CONTENT_MISMATCH",
      "Requirement Set identity differs from its completeness record"
    );
  }

  for (const fact of requirementSet.facts) {
    if (fact.opportunity_version_id
        !== input.opportunity_version.opportunity_version_id) {
      throw new EligibilityInputError(
        "FACT_OPPORTUNITY_MISMATCH",
        `RequirementFact ${fact.requirement_fact_id} belongs to another OpportunityVersion`
      );
    }
  }

  const actualFactIds = requirementSet.facts
    .map((fact) => fact.requirement_fact_id)
    .sort();
  requireExactIds(
    actualFactIds,
    requirementSet.completeness.fact_ids,
    "REQUIREMENT_SET_FACT_MISMATCH",
    "Requirement Facts do not exactly match the complete set"
  );
  const factIds = new Set(actualFactIds);
  const evidenceByFact = groupEvidenceByFact(requirementSet.evidence);
  for (const evidence of requirementSet.evidence) {
    if (!factIds.has(evidence.requirement_fact_id)) {
      throw new EligibilityInputError(
        "EVIDENCE_FACT_MISSING",
        `RequirementEvidence ${evidence.requirement_evidence_id} references an unavailable RequirementFact`
      );
    }
  }
  for (const factId of actualFactIds) {
    if ((evidenceByFact.get(factId)?.length ?? 0) === 0) {
      throw new EligibilityInputError(
        "REQUIREMENT_SET_EVIDENCE_MISMATCH",
        `RequirementFact ${factId} has no evidence in the complete set`
      );
    }
  }
  requireExactIds(
    requirementSet.evidence.map((item) => item.requirement_evidence_id).sort(),
    requirementSet.completeness.evidence_ids,
    "REQUIREMENT_SET_EVIDENCE_MISMATCH",
    "Requirement Evidence does not exactly match the complete set"
  );

  const fragmentIds = new Set(requirementSet.evidence_fragments.map((fragment) => {
    return fragment.requirement_evidence_fragment_id;
  }));
  for (const observation of requirementSet.observations) {
    if (observation.opportunity_version_id
        !== input.opportunity_version.opportunity_version_id
        || observation.status !== "CONFIRMED_REQUIREMENT") {
      throw new EligibilityInputError(
        "REQUIREMENT_SET_OBSERVATION_MISMATCH",
        "A complete set contains an unresolved or cross-opportunity Observation"
      );
    }
    if (observation.clause_role === "MANDATORY"
        && observation.requirement_fact_ids.length === 0) {
      throw new EligibilityInputError(
        "REQUIREMENT_SET_OBSERVATION_MISMATCH",
        "A mandatory Observation in a complete set must produce a Fact"
      );
    }
    if (observation.requirement_fact_ids.some((factId) => !factIds.has(factId))
        || observation.evidence_fragment_ids.some((fragmentId) => {
          return !fragmentIds.has(fragmentId);
        })) {
      throw new EligibilityInputError(
        "REQUIREMENT_SET_OBSERVATION_MISMATCH",
        "Observation references are outside the complete set"
      );
    }
  }
  requireExactIds(
    requirementSet.observations
      .map((observation) => observation.requirement_observation_id)
      .sort(),
    requirementSet.completeness.observation_ids,
    "REQUIREMENT_SET_OBSERVATION_MISMATCH",
    "Requirement Observations do not exactly match the complete set"
  );

  requireExactIds(
    uniqueSorted(requirementSet.evidence_fragments.map((fragment) => {
      return fragment.extracted_record_id;
    })),
    requirementSet.completeness.covered_extracted_record_ids,
    "REQUIREMENT_SET_CONTENT_MISMATCH",
    "Covered ExtractedRecord IDs do not match the evidence fragments"
  );
  requireExactIds(
    uniqueSorted(requirementSet.evidence_fragments.map((fragment) => {
      return fragment.snapshot_id;
    })),
    requirementSet.completeness.covered_snapshot_ids,
    "REQUIREMENT_SET_CONTENT_MISMATCH",
    "Covered Snapshot IDs do not match the evidence fragments"
  );

  const contentHash = requirementSetContentHash(requirementSet);
  if (contentHash !== requirementSet.completeness.requirement_set_content_hash
      || requirementSet.requirement_set_id !== `requirement-set:${contentHash}`) {
    throw new EligibilityInputError(
      "REQUIREMENT_SET_CONTENT_MISMATCH",
      "Requirement Set content changed after completeness evaluation"
    );
  }
}

function requireExactIds(
  actual: readonly string[],
  expected: readonly string[],
  code: ConstructorParameters<typeof EligibilityInputError>[0],
  message: string
) {
  if (new Set(actual).size !== actual.length
      || new Set(expected).size !== expected.length
      || actual.length !== expected.length
      || actual.some((value, index) => value !== [...expected].sort()[index])) {
    throw new EligibilityInputError(code, message);
  }
}

function requirementSetContentHash(
  requirementSet: EligibilityEvaluationInput["complete_requirement_set"]
) {
  const completeness = requirementSet.completeness;
  return sha256(stableSerialize({
    opportunity_version_id: requirementSet.opportunity_version_id,
    evidence_fragments: requirementSet.evidence_fragments,
    observations: requirementSet.observations,
    facts: requirementSet.facts,
    evidence: requirementSet.evidence,
    covered_extracted_record_ids: completeness.covered_extracted_record_ids,
    covered_snapshot_ids: completeness.covered_snapshot_ids,
    observation_ids: completeness.observation_ids,
    fact_ids: completeness.fact_ids,
    evidence_ids: completeness.evidence_ids,
    gate_version: completeness.gate_version,
    parser_version: requirementSet.parser_version
  }));
}

function groupEvidenceByFact(evidence: readonly RequirementEvidence[]) {
  const grouped = new Map<RequirementFactId, RequirementEvidence[]>();
  for (const item of evidence) {
    const current = grouped.get(item.requirement_fact_id) ?? [];
    current.push(item);
    grouped.set(item.requirement_fact_id, current);
  }
  return grouped;
}

function evaluateApplicability(
  fact: RequirementFact,
  candidate: CandidateProfile
): ApplicabilityOutcome {
  if (!fact.applicability) return "APPLIES";
  const actual = candidate.candidate_cohorts;
  if (!actual || actual.length === 0) return "UNKNOWN";
  const candidateCodes = new Set(actual);
  const required = fact.applicability.candidate_cohorts;
  const applies = fact.applicability.operator === "ALL_OF"
    ? required.every((code) => candidateCodes.has(code))
    : required.some((code) => candidateCodes.has(code));
  return applies ? "APPLIES" : "DOES_NOT_APPLY";
}

function resolveMajorScopeRelationships(
  facts: readonly EvaluatedFact[],
  candidate: CandidateProfile
): readonly EvaluatedFact[] {
  const relationships = facts.filter((item) => {
    return item.fact.dimension === "MAJOR_SCOPE_RELATIONSHIP"
      && item.fact.value.kind === "MAJOR_SCOPE_RELATIONSHIP";
  });
  if (relationships.length === 0) return facts;

  const scopedMajors = facts.filter((item) => {
    return item.fact.dimension === "MAJOR"
      && (item.fact.subject_scope === "BACHELOR"
        || item.fact.subject_scope === "MASTER"
        || item.fact.subject_scope === "GRADUATE"
        || item.fact.subject_scope === "DOCTOR");
  });
  const modes = uniqueSorted(relationships.map((item) => {
    if (item.fact.value.kind !== "MAJOR_SCOPE_RELATIONSHIP") {
      throw new Error("Expected major-scope relationship value");
    }
    return item.fact.value.relationship.mode;
  }));
  const resolvedRelationships = relationships.map((item): EvaluatedFact => {
    if (item.applicability !== "APPLIES") return item;
    if (modes.length !== 1 || item.fact.value.kind !== "MAJOR_SCOPE_RELATIONSHIP") {
      return { ...item, outcome: "UNKNOWN" };
    }
    return {
      ...item,
      outcome: evaluateMajorScopeRelationship(
        item.fact.value.relationship.mode,
        scopedMajors,
        candidate
      )
    };
  });
  const relationshipIds = new Set(relationships.map((item) => {
    return item.fact.requirement_fact_id;
  }));
  const scopedMajorIds = new Set(scopedMajors.map((item) => {
    return item.fact.requirement_fact_id;
  }));
  return [
    ...facts.filter((item) => {
      return !relationshipIds.has(item.fact.requirement_fact_id)
        && !scopedMajorIds.has(item.fact.requirement_fact_id);
    }),
    ...resolvedRelationships
  ];
}

function evaluateMajorScopeRelationship(
  mode: MajorScopeRelationshipMode,
  majorFacts: readonly EvaluatedFact[],
  candidate: CandidateProfile
): PredicateOutcome {
  const bachelor = aggregateRelatedMajorFacts(majorFacts.filter((item) => {
    return item.fact.subject_scope === "BACHELOR";
  }));
  const graduate = aggregateRelatedMajorFacts(majorFacts.filter((item) => {
    return item.fact.subject_scope === "MASTER"
      || item.fact.subject_scope === "GRADUATE"
      || item.fact.subject_scope === "DOCTOR";
  }));
  if (mode === "AND") return evaluateAnd([bachelor, graduate]);
  if (mode === "OR" || mode === "EITHER_LEVEL") {
    return evaluateOr([bachelor, graduate]);
  }
  if (mode === "UNDERGRADUATE_ONLY") return bachelor;
  if (mode === "GRADUATE_ONLY") return graduate;
  const highestLevel = candidate.education.reduce((highest, credential) => {
    return Math.max(highest, educationRank[credential.level]);
  }, -1);
  if (highestLevel <= educationRank.OTHER) return "UNKNOWN";
  return highestLevel === educationRank.BACHELOR ? bachelor : graduate;
}

function aggregateRelatedMajorFacts(
  facts: readonly EvaluatedFact[]
): PredicateOutcome {
  if (facts.length === 0) return "UNKNOWN";
  const grouped = new Map<LogicGroupId, EvaluatedFact[]>();
  for (const fact of facts) {
    const groupId = fact.fact.logic_group.logic_group_id;
    grouped.set(groupId, [...(grouped.get(groupId) ?? []), fact]);
  }
  return evaluateAnd([...grouped.values()].map((group) => {
    const outcomes = group.map((item) => item.outcome);
    return group[0].fact.logic_group.operator === "OR"
      ? evaluateOr(outcomes)
      : evaluateAnd(outcomes);
  }));
}

function evaluateGroups(facts: readonly EvaluatedFact[]) {
  const grouped = new Map<LogicGroupId, EvaluatedFact[]>();
  for (const fact of facts) {
    const groupId = fact.fact.logic_group.logic_group_id;
    const current = grouped.get(groupId) ?? [];
    current.push(fact);
    grouped.set(groupId, current);
  }

  return [...grouped.values()].map((group): EvaluatedGroup => {
    const operator = group[0].fact.logic_group.operator;
    const outcomes = group.map((item) => item.outcome);
    return {
      outcome: operator === "OR" ? evaluateOr(outcomes) : evaluateAnd(outcomes),
      is_certain: group.every((item) => {
        return item.applicability === "DOES_NOT_APPLY"
          || item.fact.certainty === "EXPLICIT";
      })
    };
  });
}

function evaluateOr(outcomes: readonly PredicateOutcome[]): PredicateOutcome {
  if (outcomes.includes("SATISFIED")) return "SATISFIED";
  if (outcomes.includes("UNKNOWN")) return "UNKNOWN";
  return "NOT_SATISFIED";
}

function evaluateAnd(outcomes: readonly PredicateOutcome[]): PredicateOutcome {
  if (outcomes.includes("NOT_SATISFIED")) return "NOT_SATISFIED";
  if (outcomes.includes("UNKNOWN")) return "UNKNOWN";
  return "SATISFIED";
}

function selectResult(
  facts: readonly EvaluatedFact[],
  groups: readonly EvaluatedGroup[],
  conflicts: readonly EligibilityConflict[]
): EligibilityResult {
  if (conflicts.length > 0 || facts.length === 0) return "NEEDS_REVIEW";
  if (groups.some((group) => group.outcome === "UNKNOWN")) return "NEEDS_REVIEW";
  if (groups.some((group) => {
    return group.outcome === "NOT_SATISFIED" && group.is_certain;
  })) return "INELIGIBLE";
  if (groups.some((group) => group.outcome === "NOT_SATISFIED")) {
    return "LIKELY_INELIGIBLE";
  }
  if (groups.some((group) => !group.is_certain)) return "LIKELY_ELIGIBLE";
  return "ELIGIBLE";
}

function selectReasonCodes(
  facts: readonly EvaluatedFact[],
  groups: readonly EvaluatedGroup[],
  conflicts: readonly EligibilityConflict[],
  result: EligibilityResult
): EligibilityReasonCode[] {
  const codes = new Set<EligibilityReasonCode>();
  if (conflicts.length > 0) codes.add("CONFLICTING_REQUIREMENTS");
  if (facts.length === 0) codes.add("INSUFFICIENT_EVIDENCE");
  if (groups.some((group) => !group.is_certain)) {
    codes.add("AMBIGUOUS_REQUIREMENT");
  }
  if (groups.some((group) => group.outcome === "UNKNOWN")) {
    codes.add("MISSING_CANDIDATE_DATA");
  }
  if (result === "ELIGIBLE" || result === "LIKELY_ELIGIBLE") {
    codes.add("REQUIREMENT_SATISFIED");
  }
  if (result === "INELIGIBLE" || result === "LIKELY_INELIGIBLE") {
    codes.add("REQUIREMENT_NOT_SATISFIED");
  }
  if (codes.size === 0) codes.add("INSUFFICIENT_EVIDENCE");
  return [...codes].sort();
}

function evaluateFact(
  fact: RequirementFact,
  candidate: CandidateProfile,
  equivalenceEvidence: readonly MajorEquivalenceEvidence[]
): PredicateOutcome {
  const predicate = evaluatePositivePredicate(fact, candidate, equivalenceEvidence);
  return fact.polarity === "NEGATIVE" ? invert(predicate) : predicate;
}

function evaluatePositivePredicate(
  fact: RequirementFact,
  candidate: CandidateProfile,
  equivalenceEvidence: readonly MajorEquivalenceEvidence[]
): PredicateOutcome {
  if (fact.operator === "UNRESTRICTED"
      || fact.value.kind === "UNRESTRICTED") return "SATISFIED";

  if (fact.dimension === "EDUCATION_LEVEL") {
    return evaluateEducationLevel(fact, candidate.education);
  }
  if (fact.dimension === "MAJOR") {
    return evaluateMajor(fact, candidate.education, equivalenceEvidence);
  }
  if (fact.dimension === "MAJOR_SCOPE_RELATIONSHIP") {
    return "UNKNOWN";
  }
  if (fact.dimension === "MAJOR_MATCH_RULE") {
    return evaluateMajorMatchRule(fact, candidate.education);
  }
  if (fact.dimension === "ACADEMIC_DEGREE") {
    return evaluateAcademicDegree(fact, candidate.education);
  }
  if (fact.dimension === "AGE") {
    return evaluateAge(fact, candidate.date_of_birth);
  }
  if (fact.dimension === "GENDER") {
    return evaluateGender(fact, candidate.gender);
  }
  if (fact.dimension === "CANDIDATE_COHORT") {
    return compareStrings(fact, candidate.candidate_cohorts ?? []);
  }
  if (fact.dimension === "HOUSEHOLD_REGISTRATION") {
    return compareStrings(fact, candidate.household_registration_codes ?? []);
  }
  if (fact.dimension === "STUDENT_ORIGIN") {
    return compareStrings(fact, candidate.student_origin_codes ?? []);
  }
  if (fact.dimension === "PROFESSIONAL_QUALIFICATION") {
    return evaluateQualification(fact, candidate.professional_qualifications);
  }
  if (fact.dimension === "GRADUATION_YEAR") {
    return evaluateGraduationWindow(fact, candidate);
  }
  if (fact.dimension === "WORK_EXPERIENCE") {
    return evaluateWorkExperience(fact, candidate);
  }
  if (fact.dimension === "LANGUAGE") {
    return compareStrings(fact, candidate.languages);
  }
  if (fact.dimension === "POLITICAL_AFFILIATION") {
    return candidate.political_affiliation === undefined
      ? "UNKNOWN"
      : compareStrings(fact, [candidate.political_affiliation]);
  }
  return "UNKNOWN";
}

function evaluateEducationLevel(
  fact: RequirementFact,
  education: readonly EducationCredential[]
): PredicateOutcome {
  if (education.length === 0 || fact.value.kind !== "CODE") return "UNKNOWN";
  if (fact.value.code === "GRADUATE") {
    const matches = education.some((credential) => {
      return credential.level === "MASTER" || credential.level === "DOCTOR";
    });
    return applyNegativeOperator(fact.operator, matches);
  }
  const required = educationRank[fact.value.code as keyof typeof educationRank];
  if (required === undefined) return "UNKNOWN";
  const levels = education.map((credential) => educationRank[credential.level]);
  const matches = fact.operator === "AT_LEAST"
    ? levels.some((level) => level >= required)
    : fact.operator === "AT_MOST"
      ? levels.every((level) => level <= required)
      : levels.some((level) => level === required);
  return applyNegativeOperator(fact.operator, matches);
}

function evaluateMajor(
  fact: RequirementFact,
  education: readonly EducationCredential[],
  equivalenceEvidence: readonly MajorEquivalenceEvidence[]
): PredicateOutcome {
  const credentials = credentialsForScope(fact, education);
  if (credentials.length === 0) return "UNKNOWN";
  if (fact.value.kind === "PROGRAM_REFERENCE") {
    return evaluateProgramReference(
      fact,
      credentials,
      fact.value.reference,
      equivalenceEvidence
    );
  }
  const expected = codesFromValue(fact.value);
  if (expected === null) return "UNKNOWN";
  const matchesCredential = (credential: EducationCredential) => {
    const actual = new Set(credential.normalized_program_codes);
    if (fact.operator === "ALL_OF") {
      return expected.every((code) => actual.has(code as never));
    }
    return expected.some((code) => actual.has(code as never));
  };
  const matches = fact.subject_scope === "ALL_EDUCATION"
    ? credentials.every(matchesCredential)
    : credentials.some(matchesCredential);
  return applyNegativeOperator(fact.operator, matches);
}

function evaluateProgramReference(
  fact: RequirementFact,
  credentials: readonly EducationCredential[],
  expected: AcademicProgramDirectoryReference,
  equivalenceEvidence: readonly MajorEquivalenceEvidence[]
): PredicateOutcome {
  const availableReferences = credentials.flatMap((credential) => {
    return (credential.program_directory_references ?? []).map((reference) => ({
      credential,
      reference
    }));
  });
  if (availableReferences.length === 0) return "UNKNOWN";
  const references = availableReferences.filter(({ reference }) => {
    return reference.directory_namespace === expected.directory_namespace
      && reference.directory_version === expected.directory_version;
  });
  if (references.length === 0) {
    return applyNegativeOperator(fact.operator, false);
  }
  const outcomes = references.map(({ credential, reference }) => {
    const actualProgramType = credential.program_type
      ?? reference.program_type;
    if (reference.program_code === expected.program_code
        && actualProgramType === expected.program_type) {
      return "SATISFIED" as const;
    }
    if (reference.program_code === expected.program_code
        && actualProgramType === undefined
        && expected.program_type === undefined) {
      return "SATISFIED" as const;
    }
    return evaluateExplicitMajorEquivalence(
      expected,
      reference.program_code,
      actualProgramType,
      equivalenceEvidence
    );
  });
  const outcome = evaluateOr(outcomes);
  if (outcome === "UNKNOWN") return outcome;
  return applyNegativeOperator(fact.operator, outcome === "SATISFIED");
}

function evaluateExplicitMajorEquivalence(
  expected: AcademicProgramDirectoryReference,
  actualCode: string,
  actualProgramType: string | undefined,
  evidence: readonly MajorEquivalenceEvidence[]
): PredicateOutcome {
  if (!expected.directory_version) return "UNKNOWN";
  const expectedProgramType = expected.program_type ?? "UNSPECIFIED";
  const candidateProgramType = actualProgramType ?? "UNSPECIFIED";
  const relevant = evidence.filter((item) => {
    if (item.source_namespace !== expected.directory_namespace
        || item.source_version !== expected.directory_version) return false;
    const forward = item.from_code === expected.program_code
      && item.from_program_type === expectedProgramType
      && item.to_code === actualCode
      && item.to_program_type === candidateProgramType;
    const reverse = item.to_code === expected.program_code
      && item.to_program_type === expectedProgramType
      && item.from_code === actualCode
      && item.from_program_type === candidateProgramType;
    return forward || reverse;
  });
  const statuses = new Set(relevant.map((item) => item.equivalence_status));
  if (statuses.has("EXPLICIT_EQUIVALENT") && statuses.has("NOT_EQUIVALENT")) {
    return "UNKNOWN";
  }
  if (statuses.has("EXPLICIT_EQUIVALENT")) return "SATISFIED";
  if (statuses.has("NOT_EQUIVALENT")) return "NOT_SATISFIED";
  return "UNKNOWN";
}

function evaluateAcademicDegree(
  fact: RequirementFact,
  education: readonly EducationCredential[]
): PredicateOutcome {
  const credentials = credentialsForScope(fact, education);
  if (credentials.length === 0) return "UNKNOWN";
  const expected = codesFromValue(fact.value);
  if (expected === null) return "UNKNOWN";
  const known = credentials.filter((credential) => {
    return credential.academic_degree_codes !== undefined;
  });
  if (known.length === 0) return "UNKNOWN";
  const matches = known.some((credential) => {
    const actual = new Set(credential.academic_degree_codes);
    return fact.operator === "ALL_OF"
      ? expected.every((code) => actual.has(code))
      : expected.some((code) => actual.has(code));
  });
  return applyNegativeOperator(fact.operator, matches);
}

function evaluateMajorMatchRule(
  fact: RequirementFact,
  education: readonly EducationCredential[]
): PredicateOutcome {
  if (fact.value.kind !== "MAJOR_MATCH_RULE" || education.length === 0) {
    return "UNKNOWN";
  }
  const rule = fact.value.rule;
  if (rule.kind === "EXCEPTION_LIST") return "UNKNOWN";
  if (rule.kind === "EXACT_NAME") {
    return education.some((credential) => {
      return Boolean(credential.program_name.normalized?.text
        ?? credential.program_name.original.text);
    }) ? "SATISFIED" : "UNKNOWN";
  }
  const references = education.flatMap((credential) => {
    return credential.program_directory_references ?? [];
  });
  const codes = education.flatMap((credential) => [
    ...credential.normalized_program_codes,
    ...(credential.program_directory_references ?? []).map((reference) => {
      return reference.program_code;
    })
  ]);
  if (rule.kind === "EXACT_CODE") {
    return codes.length > 0 ? "SATISFIED" : "UNKNOWN";
  }
  if (rule.kind === "CATEGORY") {
    return references.some((reference) => reference.program_category)
      ? "SATISFIED"
      : "UNKNOWN";
  }
  if (rule.kind === "CODE_SET") {
    if (codes.length === 0) return "UNKNOWN";
    return rule.codes.some((code) => codes.includes(code))
      ? "SATISFIED"
      : "NOT_SATISFIED";
  }
  if (!("directory_namespace" in rule) || references.length === 0) {
    return "UNKNOWN";
  }
  return references.some((reference) => {
    return reference.directory_namespace === rule.directory_namespace
      && reference.directory_version === rule.directory_version;
  }) ? "SATISFIED" : "NOT_SATISFIED";
}

function evaluateAge(
  fact: RequirementFact,
  dateOfBirth: string | undefined
): PredicateOutcome {
  if (!dateOfBirth
      || (fact.value.kind !== "AGE" && fact.value.kind !== "AGE_RANGE")) {
    return "UNKNOWN";
  }
  const birth = parseDate(dateOfBirth);
  const reference = parseDate(fact.value.reference_date);
  if (!birth || !reference) return "UNKNOWN";
  let years = reference.year - birth.year;
  if (reference.month < birth.month
      || (reference.month === birth.month && reference.day < birth.day)) {
    years -= 1;
  }
  const matches = fact.value.kind === "AGE_RANGE"
    ? ageWithinRange(years, fact.value)
    : fact.operator === "AT_LEAST"
      ? years >= fact.value.years
      : fact.operator === "AT_MOST"
        ? years <= fact.value.years
        : years === fact.value.years;
  return applyNegativeOperator(fact.operator, matches);
}

function ageWithinRange(
  years: number,
  range: Extract<RequirementValue, { readonly kind: "AGE_RANGE" }>
) {
  const aboveLower = range.lower_bound === undefined
    || (range.lower_bound.inclusive
      ? years >= range.lower_bound.years
      : years > range.lower_bound.years);
  const belowUpper = range.upper_bound === undefined
    || (range.upper_bound.inclusive
      ? years <= range.upper_bound.years
      : years < range.upper_bound.years);
  return aboveLower && belowUpper;
}

function evaluateGender(
  fact: RequirementFact,
  gender: CandidateProfile["gender"]
): PredicateOutcome {
  if (!gender || gender === "UNKNOWN") return "UNKNOWN";
  return compareStrings(fact, [gender]);
}

function parseDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function credentialsForScope(
  fact: RequirementFact,
  education: readonly EducationCredential[]
) {
  if (fact.subject_scope === "BACHELOR") {
    return education.filter((credential) => credential.level === "BACHELOR");
  }
  if (fact.subject_scope === "MASTER") {
    return education.filter((credential) => credential.level === "MASTER");
  }
  if (fact.subject_scope === "GRADUATE") {
    return education.filter((credential) => {
      return credential.level === "MASTER" || credential.level === "DOCTOR";
    });
  }
  if (fact.subject_scope === "DOCTOR") {
    return education.filter((credential) => credential.level === "DOCTOR");
  }
  return education;
}

function evaluateGraduationWindow(
  fact: RequirementFact,
  candidate: CandidateProfile
): PredicateOutcome {
  if (fact.value.kind === "INTEGER") {
    return compareInteger(fact, candidate.target_graduation_year);
  }
  if (fact.value.kind !== "GRADUATION_WINDOW") return "UNKNOWN";
  const outcomes: PredicateOutcome[] = [];
  if (fact.value.exact_graduation_year !== undefined) {
    outcomes.push(candidate.target_graduation_year === undefined
      ? "UNKNOWN"
      : candidate.target_graduation_year === fact.value.exact_graduation_year
        ? "SATISFIED"
        : "NOT_SATISFIED");
  }
  if (fact.value.graduation_year_range) {
    const actual = candidate.target_graduation_year;
    const range = fact.value.graduation_year_range;
    if (actual === undefined) {
      outcomes.push("UNKNOWN");
    } else {
      const afterStart = range.start_inclusive
        ? actual >= range.start_year
        : actual > range.start_year;
      const beforeEnd = range.end_inclusive
        ? actual <= range.end_year
        : actual < range.end_year;
      outcomes.push(afterStart && beforeEnd ? "SATISFIED" : "NOT_SATISFIED");
    }
  }
  if (fact.value.current_cohort) {
    const cohorts = candidate.candidate_cohorts;
    outcomes.push(!cohorts || cohorts.length === 0
      ? "UNKNOWN"
      : cohorts.includes(fact.value.current_cohort)
        ? "SATISFIED"
        : "NOT_SATISFIED");
  }
  if (outcomes.length === 0) return "UNKNOWN";
  const outcome = evaluateAnd(outcomes);
  if (outcome === "UNKNOWN") return outcome;
  return applyNegativeOperator(fact.operator, outcome === "SATISFIED");
}

function evaluateWorkExperience(
  fact: RequirementFact,
  candidate: CandidateProfile
): PredicateOutcome {
  if (fact.value.kind === "INTEGER") {
    return compareInteger(fact, candidate.work_experience_months);
  }
  if (fact.value.kind !== "WORK_EXPERIENCE"
      || fact.value.scope_definition !== "EXPLICIT") return "UNKNOWN";
  const requirement = fact.value;
  const experiences = candidate.work_experience;
  if (!experiences || experiences.length === 0) return "UNKNOWN";
  const requiredScope = requirement.experience_scope.text;
  const relevant = experiences.filter((experience) => {
    return sameNormalizedText(experience.scope, requiredScope);
  });
  if (relevant.length === 0) return "UNKNOWN";
  const matches = relevant.some((experience) => {
    return experienceWithinRange(experience, requirement);
  });
  return applyNegativeOperator(fact.operator, matches);
}

function experienceWithinRange(
  experience: CandidateWorkExperience,
  requirement: Extract<RequirementValue, { readonly kind: "WORK_EXPERIENCE" }>
) {
  return experience.years >= requirement.minimum_years
    && (requirement.maximum_years === undefined
      || experience.years <= requirement.maximum_years);
}

function sameNormalizedText(actual: string, expected: string) {
  return actual.trim() === expected.trim();
}

function evaluateQualification(
  fact: RequirementFact,
  qualifications: readonly ProfessionalQualification[]
): PredicateOutcome {
  if (fact.value.kind === "PROFESSIONAL_QUALIFICATION") {
    const requirement = fact.value;
    if (requirement.strength === "PREFERRED") return "SATISFIED";
    const relevant = qualifications.filter((qualification) => {
      return (qualification.qualification_type ?? qualification.qualification_code)
        === requirement.qualification_type;
    });
    if (relevant.length === 0) return "UNKNOWN";
    const classQualified = relevant.filter((qualification) => {
      return requirement.qualification_class === undefined
        || qualification.qualification_class === requirement.qualification_class;
    });
    if (requirement.qualification_class !== undefined
        && classQualified.length === 0) {
      return relevant.some((qualification) => {
        return qualification.qualification_class === undefined
          || qualification.status === "UNKNOWN";
      }) ? "UNKNOWN" : applyNegativeOperator(fact.operator, false);
    }
    if (classQualified.some((qualification) => {
      return qualification.status === "OBTAINED"
        || qualification.status === "PASSED_PENDING_CERTIFICATE";
    })) return applyNegativeOperator(fact.operator, true);
    if (classQualified.every((qualification) => {
      return qualification.status === "NOT_OBTAINED";
    })) return applyNegativeOperator(fact.operator, false);
    return "UNKNOWN";
  }
  const expected = codesFromValue(fact.value);
  if (expected === null) return "UNKNOWN";
  const relevant = qualifications.filter((qualification) => {
    return expected.includes(qualification.qualification_code);
  });
  if (relevant.length === 0) return "UNKNOWN";
  if (relevant.some((qualification) => {
    return qualification.status === "OBTAINED"
      || qualification.status === "PASSED_PENDING_CERTIFICATE";
  })) return applyNegativeOperator(fact.operator, true);
  if (relevant.every((qualification) => qualification.status === "NOT_OBTAINED")) {
    return applyNegativeOperator(fact.operator, false);
  }
  return "UNKNOWN";
}

function compareInteger(
  fact: RequirementFact,
  actual: number | undefined
): PredicateOutcome {
  if (actual === undefined || fact.value.kind !== "INTEGER") return "UNKNOWN";
  const matches = fact.operator === "AT_LEAST"
    ? actual >= fact.value.value
    : fact.operator === "AT_MOST"
      ? actual <= fact.value.value
      : actual === fact.value.value;
  return applyNegativeOperator(fact.operator, matches);
}

function compareStrings(
  fact: RequirementFact,
  actual: readonly string[]
): PredicateOutcome {
  if (actual.length === 0) return "UNKNOWN";
  const expected = stringsFromValue(fact.value);
  if (expected === null) return "UNKNOWN";
  const actualSet = new Set(actual);
  const matches = fact.operator === "ALL_OF"
    ? expected.every((item) => actualSet.has(item))
    : expected.some((item) => actualSet.has(item));
  return applyNegativeOperator(fact.operator, matches);
}

function codesFromValue(value: RequirementValue): readonly string[] | null {
  if (value.kind === "CODE") return [value.code];
  if (value.kind === "CODE_SET") return value.codes;
  return null;
}

function stringsFromValue(value: RequirementValue): readonly string[] | null {
  if (value.kind === "CODE") return [value.code];
  if (value.kind === "CODE_SET") return value.codes;
  if (value.kind === "TEXT") return [value.value.text];
  return null;
}

function applyNegativeOperator(
  operator: RequirementFact["operator"],
  matches: boolean
): PredicateOutcome {
  const negative = operator === "NOT_EQUALS" || operator === "NONE_OF";
  return negative === matches ? "NOT_SATISFIED" : "SATISFIED";
}

function invert(outcome: PredicateOutcome): PredicateOutcome {
  if (outcome === "SATISFIED") return "NOT_SATISFIED";
  if (outcome === "NOT_SATISFIED") return "SATISFIED";
  return "UNKNOWN";
}

function findConflicts(facts: readonly RequirementFact[]): EligibilityConflict[] {
  const byPredicate = new Map<string, RequirementFact[]>();
  for (const fact of facts) {
    const key = stableSerialize({
      dimension: fact.dimension,
      operator: fact.operator,
      value: fact.value,
      subject_scope: fact.subject_scope,
      applicability: fact.applicability
    });
    const current = byPredicate.get(key) ?? [];
    current.push(fact);
    byPredicate.set(key, current);
  }
  return [...byPredicate.entries()].flatMap(([key, group]) => {
    if (new Set(group.map((fact) => fact.polarity)).size < 2) return [];
    return [{
      code: `opposite-polarity:${sha256(key)}`,
      requirement_fact_ids: group.map((fact) => fact.requirement_fact_id).sort(),
      description: "The same structured requirement appears with opposite polarities"
    }];
  });
}

function assessmentId(input: EligibilityEvaluationInput) {
  return `eligibility-assessment:${sha256(stableSerialize({
    opportunity_version_id: input.opportunity_version.opportunity_version_id,
    candidate_profile: input.candidate_profile,
    requirement_set_id: input.complete_requirement_set.requirement_set_id,
    requirement_set_content_hash:
      input.complete_requirement_set.completeness.requirement_set_content_hash,
    major_equivalence_evidence: [...(input.major_equivalence_evidence ?? [])]
      .sort((left, right) => left.evidence_id.localeCompare(right.evidence_id)),
    engine_version: DETERMINISTIC_ELIGIBILITY_ENGINE_VERSION
  }))}` as EligibilityAssessmentId;
}

function uniqueSorted<Value extends string>(values: readonly Value[]) {
  return [...new Set(values)].sort();
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

function asNonEmpty<Value>(values: readonly Value[]): NonEmptyReadonlyArray<Value> {
  if (values.length === 0) throw new Error("Expected a non-empty array");
  return values as NonEmptyReadonlyArray<Value>;
}
