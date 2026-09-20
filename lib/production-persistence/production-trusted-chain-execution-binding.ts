import type {
  CandidateProfileId,
  OpportunityCandidate,
  PositionBoundEligibilityAssessmentResult,
  PositionBoundOpportunityTrackingResult,
  PositionBoundPredicateResolutionResult,
  PositionVersionTrackingResult,
  RecallDisposition,
  TrustedSourceOccurrenceArtifact
} from "../ingestion";
import { ELIGIBILITY_ASSESSMENT_RULE_VERSION, PREDICATE_RESOLUTION_RULE_VERSION as predicateRuleVersion } from "../ingestion";
import type { PositionBoundRequirementSetMaterializationResult } from "../ingestion/pipeline/position-bound-requirement-set";
import type { ZeroCostProductionTrustedRunContext } from "./zero-cost-production-composition-root";

export async function executeProductionTrustedChainBinding(context: ZeroCostProductionTrustedRunContext) {
  for (const candidate of context.source_occurrences) {
    const source = resolveTrustedSource(context, candidate);
    if (source.source_role !== "POSITION_BEARING") continue;
    const sourceId = source.version.source_occurrence_version_id;
    const recordId = source.extracted_record.raw_source_record_id
      ?? source.occurrence.source_occurrence_id;
    const observedAt = source.snapshot.observed_at;
    const registration = await context.execute({ kind: "OPPORTUNITY_REGISTER", input: {
      source_definition_id: source.endpoint.source_definition_id,
      recruitment_endpoint_id: source.endpoint.recruitment_endpoint_id,
      discovery_locator: `${source.snapshot.request_metadata.locator}#source-record=${encodeURIComponent(recordId)}`,
      snapshot_id: source.snapshot.snapshot_id,
      extracted_record_id: source.extracted_record.extracted_record_id,
      source_occurrence_version_id: sourceId,
      publisher_subject: null,
      discovery_evidence_ids: [sourceId],
      first_observed_at: source.version.first_observed_at,
      initial_disposition: { status: "RETAINED", reason_codes: ["OFFICIAL_RECRUITMENT_DISCOVERED"],
        evidence_ids: [sourceId], decided_at: source.version.first_observed_at }
    } }) as { readonly candidate: OpportunityCandidate; readonly disposition: RecallDisposition };
    const position = await context.execute({ kind: "POSITION_VERSION_MATERIALIZE",
      source_references: [{ source_occurrence_version_id: sourceId }] }) as PositionVersionTrackingResult;
    const opportunity = await context.execute({ kind: "PBOV_MATERIALIZE",
      position_version_id: position.position_version.position_version_id,
      source_references: [{ source_occurrence_version_id: sourceId }] }) as PositionBoundOpportunityTrackingResult;
    const composition = uniqueTrustedComposition(context, opportunity.opportunity_version.opportunity_version_id);
    const relevance = composition ? await context.execute({ kind: "LEGAL_RELEVANCE_ASSESS", input: {
      opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
      source_composition_id: composition.source_composition_id,
      created_at: observedAt
    } }) as { readonly assessment: { readonly assessment_id: string } } : null;
    let eligibilityAssessmentId: string | null = null;
    if (composition?.status === "COMPLETE") {
      await context.execute({ kind: "REQUIREMENT_PROJECTION_MATERIALIZE",
        source_composition_id: composition.source_composition_id });
      const requirement = await context.execute({ kind: "REQUIREMENT_SET_MATERIALIZE",
        source_composition_id: composition.source_composition_id }) as PositionBoundRequirementSetMaterializationResult;
      const candidateEvidence = uniqueTrustedCandidateEvidence(context);
      if (requirement.requirement_set.completeness.status === "COMPLETE" && candidateEvidence) {
        const predicates = await context.execute({ kind: "PREDICATE_RESOLUTION_MATERIALIZE", input: {
          opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
          source_composition_id: composition.source_composition_id,
          requirement_set_version_id: requirement.requirement_set_version_id,
          candidate_profile_id: candidateEvidence.candidate_profile_id,
          candidate_evidence_ids: candidateEvidence.evidence_ids,
          as_of: observedAt,
          predicate_rule_version: predicateRuleVersion
        } }) as PositionBoundPredicateResolutionResult;
        if (predicates.status === "RESOLUTION_SET") {
          const eligibility = await context.execute({ kind: "ELIGIBILITY_MATERIALIZE", input: {
            opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
            source_composition_id: composition.source_composition_id,
            requirement_set_version_id: requirement.requirement_set_version_id,
            predicate_resolution_ids: predicates.resolutions.map(item => item.predicate_resolution_id),
            candidate_profile_id: candidateEvidence.candidate_profile_id,
            candidate_evidence_ids: candidateEvidence.evidence_ids,
            as_of: observedAt,
            predicate_rule_version: predicateRuleVersion,
            assessment_rule_version: ELIGIBILITY_ASSESSMENT_RULE_VERSION
          } }) as PositionBoundEligibilityAssessmentResult;
          eligibilityAssessmentId = eligibility.status === "ASSESSMENT"
            ? eligibility.assessment.eligibility_assessment_id : null;
        }
      }
    }
    const current = context.resolvers.presentation_decisions.resolvePositionCurrent("PRODUCTION", position.position.position_id);
    const decision = await context.execute({ kind: "PRESENTATION_DECIDE", input: {
      contract_version: "presentation-decision/2.0.0",
      expected_current_presentation_decision_id: current?.presentation_decision_id ?? null,
      opportunity_candidate_id: registration.candidate.opportunity_candidate_id,
      opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
      recall_disposition_id: registration.disposition.recall_disposition_id,
      relevance_assessment_id: relevance?.assessment.assessment_id ?? null,
      eligibility_assessment_id: eligibilityAssessmentId,
      decided_at: observedAt
    } }) as { readonly decision?: { readonly presentation_decision_id: string; readonly record_kind: string } };
    if (!decision.decision) throw new Error("EVIDENCE_BLOCKED: trusted PresentationDecision was not issued");
    if (decision.decision.record_kind !== "UNBOUND_RETAINED_OUTCOME") {
      await context.execute({ kind: "PRESENTATION_READ_MODEL_MATERIALIZE",
        presentation_decision_id: decision.decision.presentation_decision_id as never });
    }
  }
}

function uniqueTrustedComposition(
  context: ZeroCostProductionTrustedRunContext,
  opportunityVersionId: PositionBoundOpportunityTrackingResult["opportunity_version"]["opportunity_version_id"]
) {
  const compositions = [...new Set(context.available_artifact_references.filter(reference =>
    reference.artifact_kind === "SOURCE_COMPOSITION").map(reference => reference.artifact_id))]
    .flatMap(id => {
      const composition = context.resolvers.source_compositions.resolve(id as never);
      return composition?.opportunity_version_id === opportunityVersionId ? [composition] : [];
    });
  return compositions.length === 1 ? compositions[0]! : null;
}

function uniqueTrustedCandidateEvidence(context: ZeroCostProductionTrustedRunContext) {
  const evidence = [...new Set(context.available_artifact_references.filter(reference =>
    reference.artifact_kind === "CANDIDATE_EVIDENCE").map(reference => reference.artifact_id))]
    .flatMap(id => {
      const resolved = context.resolvers.candidate_evidence.resolve(id);
      return resolved ? [resolved] : [];
    });
  const profiles = [...new Set(evidence.map(item => item.candidate_profile_id))];
  if (profiles.length !== 1) return null;
  return { candidate_profile_id: profiles[0]! as CandidateProfileId,
    evidence_ids: evidence.map(item => item.predicate_candidate_evidence_id) };
}

function resolveTrustedSource(context: ZeroCostProductionTrustedRunContext, candidate: unknown): TrustedSourceOccurrenceArtifact {
  if (!candidate || typeof candidate !== "object" || !("version" in candidate)
    || !candidate.version || typeof candidate.version !== "object"
    || !("source_occurrence_version_id" in candidate.version)
    || typeof candidate.version.source_occurrence_version_id !== "string") {
    throw new Error("EVIDENCE_BLOCKED: trusted SourceOccurrence identity is unavailable");
  }
  const source = context.resolvers.source_occurrences.resolve(candidate.version.source_occurrence_version_id as never);
  if (!source) throw new Error("EVIDENCE_BLOCKED: trusted SourceOccurrence cannot be resolved");
  return source;
}
