import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  SqliteShadowPersistence,
  type EligibilityAssessment,
  type OpportunityVersion,
  type SourceDefinition
} from "../../lib/ingestion";
import {
  candidateProfile,
  canonicalOpportunity,
  eligibilityAssessment,
  opportunityVersion,
  organization,
  recruitmentEndpoint,
  requirementEvidence,
  requirementFact,
  sourceDefinition,
  sourceOccurrence,
  sourceOccurrenceVersion
} from "./shadow-fixture";
import { createMigratedShadowDatabase } from "./shadow-test-database";

function appendCompleteGraph(persistence: SqliteShadowPersistence) {
  persistence.organizations.append(organization);
  persistence.source_definitions.append(sourceDefinition);
  persistence.recruitment_endpoints.append(recruitmentEndpoint);
  persistence.source_occurrences.append(sourceOccurrence);
  persistence.source_occurrence_versions.append(sourceOccurrenceVersion);
  persistence.canonical_opportunities.append(canonicalOpportunity);
  persistence.opportunity_versions.append(opportunityVersion);
  persistence.requirement_facts.append(requirementFact);
  persistence.requirement_evidence.append(requirementEvidence);
  persistence.candidate_profiles.append(candidateProfile);
  persistence.eligibility_assessments.append(eligibilityAssessment);
}

test("repository contract round-trips the approved frozen domain graph", () => {
  const database = createMigratedShadowDatabase();
  const persistence = new SqliteShadowPersistence(database);
  appendCompleteGraph(persistence);

  assert.deepEqual(
    persistence.organizations.get(organization.organization_id),
    organization
  );
  assert.deepEqual(
    persistence.source_definitions.get(sourceDefinition.source_definition_id),
    sourceDefinition
  );
  assert.deepEqual(
    persistence.recruitment_endpoints.get(
      recruitmentEndpoint.recruitment_endpoint_id
    ),
    recruitmentEndpoint
  );
  assert.deepEqual(
    persistence.source_occurrences.get(sourceOccurrence.source_occurrence_id),
    sourceOccurrence
  );
  assert.deepEqual(
    persistence.source_occurrence_versions.get(
      sourceOccurrenceVersion.source_occurrence_version_id
    ),
    sourceOccurrenceVersion
  );
  assert.deepEqual(
    persistence.canonical_opportunities.get(
      canonicalOpportunity.canonical_opportunity_id
    ),
    canonicalOpportunity
  );
  assert.deepEqual(
    persistence.opportunity_versions.get(
      opportunityVersion.opportunity_version_id
    ),
    opportunityVersion
  );
  assert.deepEqual(
    persistence.requirement_facts.get(requirementFact.requirement_fact_id),
    requirementFact
  );
  assert.deepEqual(
    persistence.requirement_evidence.get(
      requirementEvidence.requirement_evidence_id
    ),
    requirementEvidence
  );
  assert.deepEqual(
    persistence.candidate_profiles.get(candidateProfile.candidate_profile_id),
    candidateProfile
  );
  assert.deepEqual(
    persistence.eligibility_assessments.get(
      eligibilityAssessment.eligibility_assessment_id
    ),
    eligibilityAssessment
  );
  database.close();
});

test("repository preserves Chinese original and normalized text separately", () => {
  const database = createMigratedShadowDatabase();
  const persistence = new SqliteShadowPersistence(database);
  appendCompleteGraph(persistence);
  const stored = persistence.requirement_evidence.get(
    requirementEvidence.requirement_evidence_id
  );

  assert.equal(stored?.evidence_text.text, "硕士专业：法律硕士（非法学）");
  assert.equal(stored?.normalized_text?.text, "硕士专业:法律硕士(非法学)");
  assert.notEqual(stored?.evidence_text.text, stored?.normalized_text?.text);
  database.close();
});

test("repository is append-only and duplicate identities are rejected", () => {
  const database = createMigratedShadowDatabase();
  const persistence = new SqliteShadowPersistence(database);
  persistence.organizations.append(organization);

  assert.throws(() => persistence.organizations.append(organization),
    /UNIQUE constraint failed/);
  assert.equal(persistence.organizations.count(), 1);
  database.close();
});

test("foreign keys reject a SourceDefinition without its Organization", () => {
  const database = createMigratedShadowDatabase();
  const persistence = new SqliteShadowPersistence(database);
  const orphan: SourceDefinition = {
    ...sourceDefinition,
    source_definition_id: sourceDefinition.source_definition_id
  };

  assert.throws(() => persistence.source_definitions.append(orphan),
    /FOREIGN KEY constraint failed/);
  assert.equal(persistence.source_definitions.count(), 0);
  database.close();
});

test("OpportunityVersion requires every linked SourceOccurrenceVersion", () => {
  const database = createMigratedShadowDatabase();
  const persistence = new SqliteShadowPersistence(database);
  persistence.canonical_opportunities.append(canonicalOpportunity);
  const orphan: OpportunityVersion = {
    ...opportunityVersion,
    opportunity_version_id: opportunityVersion.opportunity_version_id
  };

  assert.throws(() => persistence.opportunity_versions.append(orphan),
    /FOREIGN KEY constraint failed/);
  assert.equal(persistence.opportunity_versions.count(), 0);
  database.close();
});

test("Eligibility requires persisted Candidate, Opportunity, Facts, and Evidence", () => {
  const database = createMigratedShadowDatabase();
  const persistence = new SqliteShadowPersistence(database);
  persistence.organizations.append(organization);
  persistence.source_definitions.append(sourceDefinition);
  persistence.recruitment_endpoints.append(recruitmentEndpoint);
  persistence.source_occurrences.append(sourceOccurrence);
  persistence.source_occurrence_versions.append(sourceOccurrenceVersion);
  persistence.canonical_opportunities.append(canonicalOpportunity);
  persistence.opportunity_versions.append(opportunityVersion);
  persistence.candidate_profiles.append(candidateProfile);
  const orphan: EligibilityAssessment = {
    ...eligibilityAssessment,
    eligibility_assessment_id: eligibilityAssessment.eligibility_assessment_id
  };

  assert.throws(() => persistence.eligibility_assessments.append(orphan),
    /FOREIGN KEY constraint failed/);
  assert.equal(persistence.eligibility_assessments.count(), 0);
  database.close();
});

test("external Raw trace identifiers are retained without importing lifecycle", () => {
  const database = createMigratedShadowDatabase();
  const persistence = new SqliteShadowPersistence(database);
  appendCompleteGraph(persistence);

  assert.equal(
    persistence.source_occurrence_versions.get(
      sourceOccurrenceVersion.source_occurrence_version_id
    )?.extracted_record_id,
    sourceOccurrenceVersion.extracted_record_id
  );
  assert.equal(
    persistence.requirement_evidence.get(
      requirementEvidence.requirement_evidence_id
    )?.snapshot_id,
    requirementEvidence.snapshot_id
  );
  database.close();
});

test("P1-11 repositories remain offline", async () => {
  await assert.rejects(fetch("https://example.invalid"),
    /Network access is disabled in tests/);
});
