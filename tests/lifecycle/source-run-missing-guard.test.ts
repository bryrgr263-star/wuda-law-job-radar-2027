import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  SourceRunMissingGuard,
  type EmptyResultValidation,
  type IsoDateTime,
  type RawBlobId,
  type RawContentSha256,
  type RecruitmentEndpointId,
  type Snapshot,
  type SnapshotId,
  type SourceDefinitionId,
  type SourceOccurrence,
  type SourceOccurrenceId,
  type SourceRunId,
  type SourceRunObservation
} from "../../lib/ingestion";

function branded<Value extends string>(value: string) {
  return value as Value;
}

const sourceDefinitionId = branded<SourceDefinitionId>("source-lifecycle-fixture");
const endpointId = branded<RecruitmentEndpointId>("endpoint-lifecycle-fixture");
const startedAt = branded<IsoDateTime>("2026-09-01T08:00:00+08:00");
const completedAt = branded<IsoDateTime>("2026-09-01T08:05:00+08:00");

function successSnapshot(
  id = "snapshot-lifecycle-success",
  recruitmentEndpointId = endpointId
): Snapshot {
  return {
    snapshot_id: branded<SnapshotId>(id),
    recruitment_endpoint_id: recruitmentEndpointId,
    request_metadata: {
      locator: "fixture://lifecycle/source",
      method: "GET",
      requested_at: startedAt,
      headers: {},
      parameters: {}
    },
    response_metadata: {
      http_status: 200,
      headers: {},
      mime_type: "application/json; charset=utf-8",
      content_length: 2,
      transport_error: null
    },
    observed_at: completedAt,
    transport_status: "SUCCESS",
    raw_blob_id: branded<RawBlobId>(`blob-${id}`),
    content_hash: branded<RawContentSha256>(`hash-${id}`),
    content_length: 2
  };
}

function failedSnapshot(): Snapshot {
  return {
    snapshot_id: branded<SnapshotId>("snapshot-lifecycle-failed"),
    recruitment_endpoint_id: endpointId,
    request_metadata: {
      locator: "fixture://lifecycle/source",
      method: "GET",
      requested_at: startedAt,
      headers: {},
      parameters: {}
    },
    response_metadata: {
      http_status: null,
      headers: {},
      mime_type: null,
      content_length: null,
      transport_error: {
        code: "FIXTURE_FAILURE",
        message: "Fixture transport failed",
        retryable: true
      }
    },
    observed_at: completedAt,
    transport_status: "FAILED",
    raw_blob_id: null,
    content_hash: null,
    content_length: null
  };
}

function occurrence(id: string): SourceOccurrence {
  return {
    source_occurrence_id: branded<SourceOccurrenceId>(id),
    source_definition_id: sourceDefinitionId,
    recruitment_endpoint_id: endpointId,
    identity_basis: {
      kind: "SOURCE_RECORD_ID",
      source_record_id: id,
      recruitment_cycle: "2027-campus"
    },
    identity_hash: branded(`identity-${id}`),
    first_observed_at: startedAt
  };
}

const knownA = occurrence("occurrence-known-a");
const knownB = occurrence("occurrence-known-b");

const confirmedEmptyValidation: EmptyResultValidation = {
  response_structure_valid: true,
  pagination_complete: true,
  explicit_empty_signal: true,
  official_result_count: null,
  authentication_wall_detected: false,
  captcha_detected: false,
  error_page_detected: false,
  structure_drift_detected: false,
  historical_comparison: "CONSISTENT"
};

function observation(
  overrides: Partial<SourceRunObservation> = {}
): SourceRunObservation {
  return {
    source_run_id: branded<SourceRunId>("source-run-lifecycle"),
    source_definition_id: sourceDefinitionId,
    recruitment_endpoint_id: endpointId,
    started_at: startedAt,
    completed_at: completedAt,
    snapshots: [successSnapshot()],
    collection_completeness: {
      status: "COMPLETE",
      reason_codes: ["ALL_PAGES_COLLECTED"]
    },
    observed_source_occurrence_ids: [knownA.source_occurrence_id],
    not_modified: false,
    ...overrides
  };
}

function guard(
  runObservation: SourceRunObservation,
  previousMissingStreaks: Readonly<Partial<Record<SourceOccurrenceId, number>>> = {
    [knownA.source_occurrence_id]: 2,
    [knownB.source_occurrence_id]: 3
  }
) {
  const engine = new SourceRunMissingGuard();
  const sourceRun = engine.assessRun(runObservation);
  return {
    sourceRun,
    missing: engine.guardMissing({
      source_run: sourceRun,
      known_source_occurrences: [knownA, knownB],
      previous_missing_streaks: previousMissingStreaks
    })
  };
}

test("complete non-empty run resets observed and records only safe missing", () => {
  const result = guard(observation());

  assert.equal(result.sourceRun.status, "SUCCESS");
  assert.equal(result.sourceRun.missing_updates_allowed, true);
  assert.deepEqual(result.missing.decisions.map((decision) => ({
    id: decision.source_occurrence_id,
    decision: decision.decision,
    next: decision.next_missing_streak
  })), [
    { id: knownA.source_occurrence_id, decision: "OBSERVED_RESET", next: 0 },
    { id: knownB.source_occurrence_id, decision: "MISSING_RECORDED", next: 4 }
  ]);
  assert.equal(result.missing.lifecycle_events.length, 1);
  assert.equal(result.missing.lifecycle_events[0].event_kind, "MISSING_OBSERVED");
  assert.equal(result.missing.lifecycle_events[0].target.kind, "SOURCE_OCCURRENCE");
});

test("zero results become CONFIRMED_EMPTY only with complete evidence", () => {
  const result = guard(observation({
    observed_source_occurrence_ids: [],
    collection_completeness: {
      status: "SUSPICIOUS_EMPTY",
      reason_codes: ["ZERO_EXTRACTED_RECORDS"]
    },
    empty_result_validation: confirmedEmptyValidation
  }));

  assert.equal(result.sourceRun.status, "CONFIRMED_EMPTY");
  assert.equal(result.sourceRun.missing_updates_allowed, true);
  assert.equal(result.missing.lifecycle_events.length, 2);
  assert.ok(result.missing.decisions.every((decision) => {
    return decision.decision === "MISSING_RECORDED";
  }));
});

test("official result count zero can provide the explicit empty signal", () => {
  const assessment = new SourceRunMissingGuard().assessRun(observation({
    observed_source_occurrence_ids: [],
    empty_result_validation: {
      ...confirmedEmptyValidation,
      explicit_empty_signal: false,
      official_result_count: 0
    }
  }));

  assert.equal(assessment.status, "CONFIRMED_EMPTY");
});

test("zero results without validation remain SUSPICIOUS_EMPTY and preserve streaks", () => {
  const result = guard(observation({
    observed_source_occurrence_ids: [],
    collection_completeness: {
      status: "SUSPICIOUS_EMPTY",
      reason_codes: ["ZERO_EXTRACTED_RECORDS"]
    },
    empty_result_validation: undefined
  }));

  assert.equal(result.sourceRun.status, "SUSPICIOUS_EMPTY");
  assert.equal(result.missing.lifecycle_events.length, 0);
  assert.ok(result.missing.decisions.every((decision) => {
    return decision.decision === "PROTECTED_BY_RUN_STATUS"
      && decision.next_missing_streak === decision.previous_missing_streak;
  }));
});

test("authentication, captcha, error, drift, or invalid structure blocks confirmed empty", () => {
  const blocked: readonly Partial<EmptyResultValidation>[] = [
    { response_structure_valid: false },
    { pagination_complete: false },
    { authentication_wall_detected: true },
    { captcha_detected: true },
    { error_page_detected: true },
    { structure_drift_detected: true }
  ];

  for (const candidate of blocked) {
    const assessment = new SourceRunMissingGuard().assessRun(observation({
      observed_source_occurrence_ids: [],
      empty_result_validation: {
        ...confirmedEmptyValidation,
        ...candidate
      }
    }));
    assert.equal(assessment.status, "SUSPICIOUS_EMPTY");
    assert.equal(assessment.missing_updates_allowed, false);
  }
});

test("anomalous or unavailable history blocks confirmed empty", () => {
  for (const historicalComparison of ["ANOMALOUS", "UNAVAILABLE"] as const) {
    const assessment = new SourceRunMissingGuard().assessRun(observation({
      observed_source_occurrence_ids: [],
      empty_result_validation: {
        ...confirmedEmptyValidation,
        historical_comparison: historicalComparison
      }
    }));
    assert.equal(assessment.status, "SUSPICIOUS_EMPTY");
  }
});

test("FAILED transport never increments missing or emits lifecycle events", () => {
  const result = guard(observation({ snapshots: [failedSnapshot()] }));

  assert.equal(result.sourceRun.status, "FAILED");
  assert.equal(result.sourceRun.missing_updates_allowed, false);
  assert.equal(result.missing.lifecycle_events.length, 0);
  assert.deepEqual(result.missing.decisions.map((decision) => {
    return decision.next_missing_streak;
  }), [2, 3]);
});

test("PARTIAL collection never increments missing or emits lifecycle events", () => {
  const result = guard(observation({
    collection_completeness: {
      status: "PARTIAL",
      reason_codes: ["NEXT_PAGE_NOT_COLLECTED"]
    },
    observed_source_occurrence_ids: []
  }));

  assert.equal(result.sourceRun.status, "PARTIAL");
  assert.equal(result.missing.lifecycle_events.length, 0);
  assert.ok(result.missing.decisions.every((decision) => {
    return decision.decision === "PROTECTED_BY_RUN_STATUS";
  }));
});

test("NOT_MODIFIED preserves missing streaks and produces no missing event", () => {
  const result = guard(observation({
    not_modified: true,
    observed_source_occurrence_ids: []
  }));

  assert.equal(result.sourceRun.status, "NOT_MODIFIED");
  assert.equal(result.sourceRun.missing_updates_allowed, false);
  assert.equal(result.missing.lifecycle_events.length, 0);
  assert.deepEqual(result.missing.decisions.map((decision) => {
    return decision.next_missing_streak;
  }), [2, 3]);
});

test("contradictory suspicious status with records is PARTIAL, not authoritative", () => {
  const result = guard(observation({
    collection_completeness: {
      status: "SUSPICIOUS_EMPTY",
      reason_codes: ["ZERO_EXTRACTED_RECORDS"]
    }
  }));

  assert.equal(result.sourceRun.status, "PARTIAL");
  assert.equal(result.sourceRun.missing_updates_allowed, false);
  assert.equal(result.missing.lifecycle_events.length, 0);
});

test("P1-10 emits only MISSING_OBSERVED and never closes or expires jobs", () => {
  const statuses = [
    guard(observation()),
    guard(observation({
      observed_source_occurrence_ids: [],
      empty_result_validation: confirmedEmptyValidation
    }))
  ];
  const events = statuses.flatMap((result) => result.missing.lifecycle_events);

  assert.ok(events.length > 0);
  assert.ok(events.every((event) => event.event_kind === "MISSING_OBSERVED"));
  assert.ok(events.every((event) => event.target.kind === "SOURCE_OCCURRENCE"));
  assert.ok(events.every((event) => {
    return event.event_kind !== "CLOSED" && event.event_kind !== "EXPIRED";
  }));
});

test("missing event identity is deterministic for the same run and occurrence", () => {
  const first = guard(observation()).missing.lifecycle_events[0];
  const second = guard(observation()).missing.lifecycle_events[0];

  assert.equal(first.lifecycle_event_id, second.lifecycle_event_id);
  assert.deepEqual(first.snapshot_ids, second.snapshot_ids);
});

test("Snapshot and SourceOccurrence references must belong to the assessed endpoint", () => {
  const otherEndpointId = branded<RecruitmentEndpointId>("endpoint-other");
  const engine = new SourceRunMissingGuard();
  assert.throws(() => engine.assessRun(observation({
    snapshots: [successSnapshot("snapshot-other", otherEndpointId)]
  })), /another RecruitmentEndpoint/);

  const sourceRun = engine.assessRun(observation());
  assert.throws(() => engine.guardMissing({
    source_run: sourceRun,
    known_source_occurrences: [{
      ...knownA,
      recruitment_endpoint_id: otherEndpointId
    }],
    previous_missing_streaks: {}
  }), /outside the assessed Source Run/);
});

test("P1-10 zero-result protection remains offline", async () => {
  await assert.rejects(fetch("https://example.invalid"),
    /Network access is disabled in tests/);
});
