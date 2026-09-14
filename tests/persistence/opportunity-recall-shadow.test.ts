import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  SqliteShadowPersistence,
  createInMemoryOpportunityRecallBoundary,
  type ExtractedRecordId,
  type IsoDateTime,
  type OpportunityDiscoveryRegistrationInput,
  type RecruitmentEndpointId,
  type SnapshotId,
  type SourceDefinitionId
} from "../../lib/ingestion";
import {
  organization,
  recruitmentEndpoint,
  sourceDefinition
} from "./shadow-fixture";
import { createMigratedShadowDatabase } from "./shadow-test-database";

test("Recall registration persists Candidate and initial disposition atomically", () => {
  const database = createMigratedShadowDatabase();
  const persistence = new SqliteShadowPersistence(database);
  persistSourceBoundary(persistence);
  const boundary = createInMemoryOpportunityRecallBoundary();
  const results = [
    acquisitionUnsupportedInput(1),
    parsingUnsupportedInput(2),
    identityUncertainInput(3)
  ].map((input) => boundary.register(input));

  for (const result of results) {
    persistence.opportunity_recall.appendRegistration(
      result.candidate,
      result.disposition
    );
  }
  assert.equal(persistence.opportunity_recall.candidateCount(), results.length);
  assert.equal(persistence.opportunity_recall.dispositionCount(), results.length);
  for (const result of results) {
    assert.deepEqual(
      persistence.opportunity_recall.getCandidate(
        result.candidate.opportunity_candidate_id
      ),
      result.candidate
    );
    assert.deepEqual(
      persistence.opportunity_recall.getDisposition(
        result.disposition.recall_disposition_id
      ),
      result.disposition
    );
  }
  database.close();
});

test("failed registration transaction leaves no silent Candidate without disposition", () => {
  const database = createMigratedShadowDatabase();
  const persistence = new SqliteShadowPersistence(database);
  persistSourceBoundary(persistence);
  const boundary = createInMemoryOpportunityRecallBoundary();
  const first = boundary.register(acquisitionUnsupportedInput(1));
  persistence.opportunity_recall.appendRegistration(first.candidate, first.disposition);

  const second = boundary.register(acquisitionUnsupportedInput(2));
  assert.throws(() => persistence.opportunity_recall.appendRegistration(
    second.candidate,
    first.disposition
  ), /Initial RecallDisposition/);
  assert.equal(persistence.opportunity_recall.candidateCount(), 1);
  assert.equal(persistence.opportunity_recall.dispositionCount(), 1);
  database.close();
});

test("persisted disposition revisions remain append-only and defensively cloned", () => {
  const database = createMigratedShadowDatabase();
  const persistence = new SqliteShadowPersistence(database);
  persistSourceBoundary(persistence);
  const boundary = createInMemoryOpportunityRecallBoundary();
  const registered = boundary.register(acquisitionUnsupportedInput(1));
  persistence.opportunity_recall.appendRegistration(
    registered.candidate,
    registered.disposition
  );
  const revised = boundary.recordDisposition({
    opportunity_candidate_id: registered.candidate.opportunity_candidate_id,
    status: "REVIEW_REQUIRED",
    reason_codes: ["ACQUISITION_SUPPORT_ADDED_REVIEW_PENDING"],
    evidence_ids: ["recall-evidence:review"],
    decided_at: "2026-09-14T10:00:00.000Z" as IsoDateTime
  }).disposition;
  persistence.opportunity_recall.appendDisposition(revised);

  const resolved = persistence.opportunity_recall.getCandidate(
    registered.candidate.opportunity_candidate_id
  )!;
  (resolved.discovery_evidence_ids as string[]).push("caller-mutation");
  assert.deepEqual(
    persistence.opportunity_recall.getCandidate(
      registered.candidate.opportunity_candidate_id
    ),
    registered.candidate
  );
  assert.deepEqual(
    persistence.opportunity_recall.listDispositions(
      registered.candidate.opportunity_candidate_id
    ),
    [registered.disposition, revised]
  );
  assert.throws(() => database.prepare(
    "UPDATE shadow_recall_dispositions SET status = 'EXCLUDED' WHERE recall_disposition_id = ?"
  ).run(revised.recall_disposition_id), /append-only/);
  assert.throws(() => database.prepare(
    "DELETE FROM shadow_opportunity_candidates WHERE opportunity_candidate_id = ?"
  ).run(registered.candidate.opportunity_candidate_id), /append-only/);
  database.close();
});

function persistSourceBoundary(persistence: SqliteShadowPersistence) {
  persistence.organizations.append(organization);
  persistence.source_definitions.append(sourceDefinition);
  persistence.recruitment_endpoints.append(recruitmentEndpoint);
}

function acquisitionUnsupportedInput(
  index: number
): OpportunityDiscoveryRegistrationInput {
  return {
    source_definition_id: sourceDefinition.source_definition_id as SourceDefinitionId,
    recruitment_endpoint_id:
      recruitmentEndpoint.recruitment_endpoint_id as RecruitmentEndpointId,
    discovery_locator: `fixture://recall/persisted/${index}`,
    snapshot_id: null,
    extracted_record_id: null,
    source_occurrence_version_id: null,
    publisher_subject: null,
    discovery_evidence_ids: [`recall-evidence:persisted-${index}`],
    first_observed_at: "2026-09-14T08:00:00.000Z" as IsoDateTime,
    initial_disposition: {
      status: "ACQUISITION_UNSUPPORTED",
      reason_codes: ["HTTP_TRANSPORT_UNSUPPORTED"],
      evidence_ids: [`recall-evidence:persisted-${index}`],
      decided_at: "2026-09-14T08:00:00.000Z" as IsoDateTime
    }
  };
}

function parsingUnsupportedInput(index: number): OpportunityDiscoveryRegistrationInput {
  return {
    ...acquisitionUnsupportedInput(index),
    snapshot_id: `snapshot:recall-${index}` as SnapshotId,
    initial_disposition: {
      status: "PARSING_UNSUPPORTED",
      reason_codes: ["ATTACHMENT_FORMAT_UNSUPPORTED"],
      evidence_ids: [`recall-evidence:persisted-${index}`],
      decided_at: "2026-09-14T08:00:00.000Z" as IsoDateTime
    }
  };
}

function identityUncertainInput(index: number): OpportunityDiscoveryRegistrationInput {
  return {
    ...parsingUnsupportedInput(index),
    extracted_record_id: `extracted-record:recall-${index}` as ExtractedRecordId,
    initial_disposition: {
      status: "IDENTITY_UNCERTAIN",
      reason_codes: ["POSITION_IDENTITY_UNRESOLVED"],
      evidence_ids: [`recall-evidence:persisted-${index}`],
      decided_at: "2026-09-14T08:00:00.000Z" as IsoDateTime
    }
  };
}
