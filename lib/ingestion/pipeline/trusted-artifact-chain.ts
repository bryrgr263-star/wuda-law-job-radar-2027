import type {
  CandidateProfileId,
  IsoDateTime,
  OpportunityVersionId,
  SourceCompositionInput,
  SourceCompositionResultId
} from "../domain";
import {
  assertTrustedPositionBoundOpportunityResolver,
  assertTrustedSourceOccurrenceVersionResolver,
  type TrustedSourceOccurrenceVersionResolver,
  type TrustedPositionBoundOpportunityResolver
} from "../normalization";
import {
  canonicalSerialize,
  createCanonicalArtifactRegistryAuthority
} from "../normalization/canonical-artifact-registry";
import { assertSourceCompositionResultIntegrity } from "../requirements";
import {
  InMemoryPositionBoundEligibilityAssessmentTracker,
  assertPositionBoundEligibilityAssessmentIntegrity,
  type PositionBoundEligibilityAssessment,
  type PositionBoundEligibilityAssessmentResult
} from "./position-bound-eligibility-assessment";
import {
  InMemoryPositionBoundPredicateResolutionTracker,
  assertPositionBoundPredicateResolutionIntegrity,
  type PositionBoundPredicateResolution,
  type PositionBoundPredicateResolutionResult,
  type PredicateCandidateEvidence
} from "./position-bound-predicate-resolution";
import {
  InMemoryPositionBoundRequirementSetTracker,
  type PositionBoundRequirementSetMaterializationResult,
  type PositionBoundRequirementSetVersion
} from "./position-bound-requirement-set";
import {
  InMemoryTrustedCandidateEvidenceTracker,
  type CandidateProfileEvidenceMaterializationCommand,
  type CandidateEvidenceIssuanceResult,
  type IssueCandidateEvidenceCommand,
  type TrustedCandidateEvidenceBatch
} from "./trusted-candidate-evidence";
import {
  InMemoryPositionBoundSourceCompositionTracker
} from "./position-bound-source-composition";
import {
  InMemoryApprovedRequirementProjectionTracker,
  type RequirementProjectionArtifact
} from "./trusted-requirement-projection";

export interface TrustedPredicateResolutionResolver {
  resolve(predicateResolutionId: string): PositionBoundPredicateResolution | null;
}

export interface TrustedEligibilityAssessmentResolver {
  resolve(eligibilityAssessmentId: string): PositionBoundEligibilityAssessment | null;
}

const trustedEligibilityAssessmentResolvers = new WeakSet<object>();

export function assertTrustedEligibilityAssessmentResolver(
  resolver: TrustedEligibilityAssessmentResolver
) {
  if (!trustedEligibilityAssessmentResolvers.has(resolver as object)) {
    throw new Error(
      "Eligibility assessment resolver must be composition-root controlled"
    );
  }
  return resolver;
}

export interface TrustedSourceCompositionCommand {
  readonly opportunity_version_id: OpportunityVersionId;
  readonly composition_input: SourceCompositionInput;
}

export interface TrustedPredicateResolutionCommand {
  readonly opportunity_version_id: OpportunityVersionId;
  readonly source_composition_id: SourceCompositionResultId;
  readonly requirement_set_version_id: string;
  readonly candidate_profile_id: CandidateProfileId;
  readonly candidate_evidence_ids: readonly string[];
  readonly as_of: IsoDateTime;
  readonly predicate_rule_version: string;
}

export interface TrustedEligibilityAssessmentCommand
  extends TrustedPredicateResolutionCommand {
  readonly predicate_resolution_ids: readonly string[];
  readonly assessment_rule_version: string;
}

export interface TrustedArtifactChain {
  readonly candidate_evidence: {
    issue(command: IssueCandidateEvidenceCommand): CandidateEvidenceIssuanceResult;
    materialize_claimed(command: CandidateProfileEvidenceMaterializationCommand):
      TrustedCandidateEvidenceBatch;
    materialize_synthetic_fixture(
      command: CandidateProfileEvidenceMaterializationCommand
    ): TrustedCandidateEvidenceBatch;
    resolve(id: string): PredicateCandidateEvidence | null;
  };
  readonly source_compositions: {
    materialize(command: TrustedSourceCompositionCommand):
      import("../domain").SourceCompositionResult;
    resolve(id: SourceCompositionResultId): import("../domain").SourceCompositionResult | null;
  };
  readonly source_composition_resolver: import("./position-bound-source-composition").TrustedSourceCompositionResolver;
  readonly requirement_projections: {
    materialize(sourceCompositionId: SourceCompositionResultId): RequirementProjectionArtifact;
    resolve(id: string): RequirementProjectionArtifact | null;
  };
  readonly requirement_sets: {
    materialize(sourceCompositionId: SourceCompositionResultId):
      PositionBoundRequirementSetMaterializationResult;
    resolve(id: string): PositionBoundRequirementSetVersion | null;
  };
  readonly requirement_set_resolver: import("./position-bound-requirement-set").TrustedRequirementSetVersionResolver;
  readonly predicate_resolutions: {
    materialize(command: TrustedPredicateResolutionCommand):
      PositionBoundPredicateResolutionResult;
    resolve(id: string): PositionBoundPredicateResolution | null;
  };
  readonly eligibility_assessments: {
    materialize(command: TrustedEligibilityAssessmentCommand):
      PositionBoundEligibilityAssessmentResult;
    resolve(id: string): PositionBoundEligibilityAssessment | null;
  };
}

export function createTrustedArtifactChain(
  pbovResolver: TrustedPositionBoundOpportunityResolver,
  sourceResolver: TrustedSourceOccurrenceVersionResolver | null = null
): TrustedArtifactChain {
  const trustedPbovResolver = assertTrustedPositionBoundOpportunityResolver(
    pbovResolver
  );
  const sourceCompositions = new InMemoryPositionBoundSourceCompositionTracker(
    trustedPbovResolver,
    sourceResolver
      ? assertTrustedSourceOccurrenceVersionResolver(sourceResolver)
      : null
  );
  const projections = new InMemoryApprovedRequirementProjectionTracker(
    trustedPbovResolver,
    sourceCompositions,
    sourceResolver
  );
  const requirementSets = new InMemoryPositionBoundRequirementSetTracker();
  const candidateEvidence = new InMemoryTrustedCandidateEvidenceTracker();
  const predicateTracker = new InMemoryPositionBoundPredicateResolutionTracker();
  const assessmentTracker = new InMemoryPositionBoundEligibilityAssessmentTracker();
  const predicateRegistry = createCanonicalArtifactRegistryAuthority<
    string,
    PositionBoundPredicateResolution
  >((artifact) => artifact.predicate_resolution_id);
  const assessmentRegistry = createCanonicalArtifactRegistryAuthority<
    string,
    PositionBoundEligibilityAssessment
  >((artifact) => artifact.eligibility_assessment_id);

  const sourceCompositionGate = Object.freeze({
    resolve(reference: import("../domain").SourceCompositionReference) {
      const resolved = sourceCompositions.resolve(reference.source_composition_id);
      if (!resolved
          || resolved.opportunity_version_id !== reference.opportunity_version_id
          || resolved.composition_hash !== reference.composition_hash
          || resolved.composition_manifest_hash
            !== reference.composition_manifest_hash
          || resolved.composition_as_of !== reference.composition_as_of
          || resolved.schema_version !== reference.composition_schema_version) {
        return null;
      }
      return resolved;
    },
    verify: assertSourceCompositionResultIntegrity
  });

  const predicateResolver: TrustedPredicateResolutionResolver = Object.freeze({
    resolve(id: string) {
      const resolution = predicateRegistry.resolver.resolve(id);
      return resolution
        ? assertPositionBoundPredicateResolutionIntegrity(resolution)
        : null;
    }
  });
  const assessmentResolver: TrustedEligibilityAssessmentResolver = Object.freeze({
    resolve(id: string) {
      const assessment = assessmentRegistry.resolver.resolve(id);
      return assessment
        ? assertPositionBoundEligibilityAssessmentIntegrity(assessment)
        : null;
    }
  });
  trustedEligibilityAssessmentResolvers.add(assessmentResolver as object);

  const chain: TrustedArtifactChain = {
    candidate_evidence: Object.freeze({
      issue(command: IssueCandidateEvidenceCommand) {
        return candidateEvidence.issue(command);
      },
      materialize_claimed(command: CandidateProfileEvidenceMaterializationCommand) {
        return candidateEvidence.materializeClaimedProfile(command);
      },
      materialize_synthetic_fixture(
        command: CandidateProfileEvidenceMaterializationCommand
      ) {
        return candidateEvidence.materializeSyntheticFixture(command);
      },
      resolve(id: string) {
        return candidateEvidence.resolve(id);
      }
    }),
    source_compositions: Object.freeze({
      materialize(command: TrustedSourceCompositionCommand) {
        return sourceCompositions.process(command);
      },
      resolve(id: SourceCompositionResultId) {
        return sourceCompositions.resolve(id);
      }
    }),
    source_composition_resolver: sourceCompositions,
    requirement_projections: Object.freeze({
      materialize(sourceCompositionId: SourceCompositionResultId) {
        return projections.process(sourceCompositionId);
      },
      resolve(id: string) {
        return projections.resolve(id);
      }
    }),
    requirement_sets: Object.freeze({
      materialize(sourceCompositionId: SourceCompositionResultId) {
        const sourceComposition = requireArtifact(
          sourceCompositions.resolve(sourceCompositionId),
          "Trusted SourceComposition is unavailable"
        );
        const graph = requireArtifact(
          trustedPbovResolver.resolve(sourceComposition.opportunity_version_id),
          "Trusted PBOV is unavailable"
        );
        const sources = requireArtifact(
          trustedPbovResolver.resolveSources(sourceComposition.opportunity_version_id),
          "Trusted PBOV source provenance is unavailable"
        );
        const projection = projections.process(sourceCompositionId);
        return requirementSets.process({
          position: graph.position,
          position_version: graph.position_version,
          canonical_opportunity: graph.canonical_opportunity,
          opportunity_version: graph.opportunity_version,
          sources,
          source_composition_result: sourceComposition,
          requirement_projection: projection
        });
      },
      resolve(id: string) {
        return requirementSets.resolve(id);
      }
    }),
    requirement_set_resolver: requirementSets,
    predicate_resolutions: Object.freeze({
      materialize(command: TrustedPredicateResolutionCommand) {
        const graph = trustedPbovResolver.resolve(command.opportunity_version_id);
        const sourceComposition = sourceCompositions.resolve(
          command.source_composition_id
        );
        const requirementSet = requirementSets.resolve(
          command.requirement_set_version_id
        );
        const evidence = resolveCandidateEvidence(
          candidateEvidence,
          command.candidate_evidence_ids,
          command.candidate_profile_id
        );
        if (!graph || !sourceComposition || !requirementSet || !evidence) {
          return blockedPredicate("REQUIREMENT_SET_BINDING_FAILURE",
            "Trusted E/F/G or Candidate Evidence artifact is unavailable");
        }
        const result = predicateTracker.process({
          position: graph.position,
          position_version: graph.position_version,
          opportunity_version: graph.opportunity_version,
          position_bound_opportunity_gate: trustedPbovResolver,
          source_composition_result: sourceComposition,
          requirement_set_version: requirementSet,
          candidate_profile_id: command.candidate_profile_id,
          candidate_evidence: evidence,
          as_of: command.as_of,
          predicate_rule_version: command.predicate_rule_version
        });
        if (result.status === "BLOCKED") return result;
        const resolutions = result.resolutions.map((resolution) => {
          const canonical = { ...resolution, version_created: true };
          const sealed = predicateRegistry.writer.seal(
            canonical.predicate_resolution_id,
            canonical
          );
          return {
            ...sealed.artifact,
            version_created: sealed.status === "SEALED"
          };
        });
        return { status: "RESOLUTION_SET" as const, resolutions };
      },
      resolve(id: string) {
        return predicateResolver.resolve(id);
      }
    }),
    eligibility_assessments: Object.freeze({
      materialize(command: TrustedEligibilityAssessmentCommand) {
        const graph = trustedPbovResolver.resolve(command.opportunity_version_id);
        const sourceComposition = sourceCompositions.resolve(
          command.source_composition_id
        );
        const requirementSet = requirementSets.resolve(
          command.requirement_set_version_id
        );
        const evidence = resolveCandidateEvidence(
          candidateEvidence,
          command.candidate_evidence_ids,
          command.candidate_profile_id
        );
        const resolutions = command.predicate_resolution_ids.map((id) => {
          return predicateResolver.resolve(id);
        });
        if (!graph || !sourceComposition || !requirementSet || !evidence
            || resolutions.some((resolution) => !resolution)) {
          return {
            status: "NOT_ALLOWED" as const,
            reason: "PREDICATE_RESOLUTION_INTEGRITY_FAILURE" as const,
            detail: "Trusted E/F/G/H artifact is unavailable"
          };
        }
        const predicateResult = {
          status: "RESOLUTION_SET" as const,
          resolutions: resolutions as PositionBoundPredicateResolution[]
        };
        const result = assessmentTracker.process({
          position: graph.position,
          position_version: graph.position_version,
          canonical_opportunity: graph.canonical_opportunity,
          opportunity_version: graph.opportunity_version,
          position_bound_opportunity_gate: trustedPbovResolver,
          requirement_set_version: requirementSet,
          predicate_resolution_result: predicateResult,
          candidate_profile_id: command.candidate_profile_id,
          candidate_evidence: evidence,
          as_of: command.as_of,
          predicate_rule_version: command.predicate_rule_version,
          assessment_rule_version: command.assessment_rule_version,
          source_composition_gate: sourceCompositionGate
        });
        if (result.status !== "ASSESSMENT") return result;
        const canonical = { ...result.assessment, version_created: true };
        const sealed = assessmentRegistry.writer.seal(
          canonical.eligibility_assessment_id,
          canonical
        );
        return {
          status: "ASSESSMENT" as const,
          assessment: {
            ...sealed.artifact,
            version_created: sealed.status === "SEALED"
          }
        };
      },
      resolve(id: string) {
        return assessmentResolver.resolve(id);
      }
    })
  };
  trustedEligibilityAssessmentResolvers.add(
    chain.eligibility_assessments as object
  );
  return deepFreeze(chain);
}

function resolveCandidateEvidence(
  resolver: InMemoryTrustedCandidateEvidenceTracker,
  evidenceIds: readonly string[],
  candidateProfileId: CandidateProfileId
) {
  if (new Set(evidenceIds).size !== evidenceIds.length) return null;
  const evidence = evidenceIds.map((id) => resolver.resolve(id));
  if (evidence.some((item) => !item
      || item.candidate_profile_id !== candidateProfileId)) {
    return null;
  }
  return evidence as PredicateCandidateEvidence[];
}

function blockedPredicate(
  blockerCode: "REQUIREMENT_SET_BINDING_FAILURE",
  blockerDetail: string
): PositionBoundPredicateResolutionResult {
  return {
    status: "BLOCKED",
    blocker_code: blockerCode,
    blocker_detail: blockerDetail,
    resolutions: []
  };
}

function requireArtifact<Value>(value: Value | null, message: string): Value {
  if (value === null) throw new Error(message);
  return value;
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

export function sameTrustedArtifact(left: unknown, right: unknown) {
  return canonicalSerialize(left) === canonicalSerialize(right);
}
