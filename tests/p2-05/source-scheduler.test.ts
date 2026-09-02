import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemorySourceScheduler,
  SourceSchedulerError,
  schedulingEligibility
} from "../../lib/source-scheduler";
import {
  admission,
  authorization,
  endpoint,
  runResult
} from "./test-support";

const firstRunAt = "2026-09-02T00:00:00.000Z" as never;
const completedRunAt = "2026-09-03T00:00:00.000Z" as never;

function register(
  scheduler: InMemorySourceScheduler,
  source = admission(),
  scheduleId = "schedule-p2-05"
) {
  const recruitmentEndpoint = endpoint(source);
  const schedule = scheduler.register({
    schedule_id: scheduleId,
    admission: source,
    endpoint: recruitmentEndpoint,
    policy: { frequency: "DAILY", minimum_interval_ms: 24 * 60 * 60 * 1_000 },
    first_run_at: firstRunAt
  });
  return { source, recruitmentEndpoint, schedule };
}

test("approved A sources register and issue independently identified Collection Run dispatches", () => {
  const scheduler = new InMemorySourceScheduler();
  const { source, recruitmentEndpoint } = register(scheduler);
  const first = scheduler.claim({
    schedule_id: "schedule-p2-05",
    admission: source,
    endpoint: recruitmentEndpoint,
    now: firstRunAt,
    collection_run_id: "scheduled-run-a-1"
  });
  assert.equal(first.requires_manual_authorization, false);
  assert.equal(first.collection_run_id, "scheduled-run-a-1");
  const completed = scheduler.complete({
    schedule_id: "schedule-p2-05",
    admission: source,
    run: runResult({
      collection_run_id: first.collection_run_id,
      recruitment_endpoint_id: recruitmentEndpoint.recruitment_endpoint_id,
      status: "SUCCESS"
    })
  });
  assert.equal(completed.schedule.last_run_at, "2026-09-02T00:01:00.000Z");
  const second = scheduler.claim({
    schedule_id: "schedule-p2-05",
    admission: source,
    endpoint: recruitmentEndpoint,
    now: completed.schedule.next_run_at,
    collection_run_id: "scheduled-run-a-2"
  });
  assert.notEqual(first.collection_run_id, second.collection_run_id);
});

test("approved B sources schedule only with a fresh exactly bound manual authorization", () => {
  const source = admission({
    level: "B",
    decision: "APPROVED",
    automation_basis: "HUMAN_REVIEWED_CANARY",
    terms: "UNKNOWN"
  });
  const scheduler = new InMemorySourceScheduler();
  const { recruitmentEndpoint } = register(scheduler, source, "schedule-b");
  assert.deepEqual(schedulingEligibility(source), {
    allowed: true,
    requires_manual_authorization: true,
    reason_code: null
  });
  assert.throws(() => scheduler.claim({
    schedule_id: "schedule-b",
    admission: source,
    endpoint: recruitmentEndpoint,
    now: firstRunAt
  }), SourceSchedulerError);

  const firstAuthorization = authorization(source, "scheduled-run-b-1");
  const dispatch = scheduler.claim({
    schedule_id: "schedule-b",
    admission: source,
    endpoint: recruitmentEndpoint,
    now: firstRunAt,
    authorization: firstAuthorization
  });
  assert.equal(dispatch.collection_run_id, "scheduled-run-b-1");
  assert.equal(dispatch.authorization_id, firstAuthorization.authorization_id);
  assert.deepEqual(dispatch.manual_authorization, firstAuthorization);
  const completed = scheduler.complete({
    schedule_id: "schedule-b",
    admission: source,
    run: runResult({
      collection_run_id: dispatch.collection_run_id,
      recruitment_endpoint_id: recruitmentEndpoint.recruitment_endpoint_id,
      status: "SUCCESS"
    })
  });
  assert.throws(() => scheduler.claim({
    schedule_id: "schedule-b",
    admission: source,
    endpoint: recruitmentEndpoint,
    now: completed.schedule.next_run_at
  }), /fresh valid manual authorization/u);
});

test("B REVIEW, C, D, and unknown access evidence never enter automatic scheduling", () => {
  const cases = [
    admission({ level: "B", decision: "REVIEW", automation_basis: "ROBOTS_ALLOW", terms: "UNKNOWN" }),
    admission({ level: "C", decision: "REVIEW", automation_basis: "INSUFFICIENT_EVIDENCE", robots: "UNKNOWN", terms: "UNKNOWN" }),
    admission({ level: "D", decision: "REJECTED", automation_basis: "NO_AUTOMATION_ALLOWED", terms: "PROHIBITED" })
  ];
  for (const [index, source] of cases.entries()) {
    const scheduler = new InMemorySourceScheduler();
    assert.equal(schedulingEligibility(source).allowed, false);
    assert.throws(() => register(scheduler, source, `blocked-${index}`), SourceSchedulerError);
  }
});

test("the scheduler rejects pagination and redirect expansion before a dispatch exists", () => {
  const scheduler = new InMemorySourceScheduler();
  const source = admission();
  assert.throws(() => scheduler.register({
    schedule_id: "schedule-page-expansion",
    admission: source,
    endpoint: endpoint(source, { max_pages: 2, follow_redirects: true }),
    policy: { frequency: "DAILY", minimum_interval_ms: 86_400_000 },
    first_run_at: firstRunAt
  }), /pagination or redirect expansion/u);
});

test("403 and 429 move the schedule to review without further automatic dispatch", () => {
  for (const status of [403, 429]) {
    const scheduler = new InMemorySourceScheduler();
    const { source, recruitmentEndpoint } = register(scheduler, admission({ source_admission_id: `admission-risk-${status}` }), `risk-${status}`);
    const dispatch = scheduler.claim({
      schedule_id: `risk-${status}`,
      admission: source,
      endpoint: recruitmentEndpoint,
      now: firstRunAt,
      collection_run_id: `run-risk-${status}`
    });
    const completion = scheduler.complete({
      schedule_id: `risk-${status}`,
      admission: source,
      run: runResult({
        collection_run_id: dispatch.collection_run_id,
        recruitment_endpoint_id: recruitmentEndpoint.recruitment_endpoint_id,
        status: "FAILED",
        http_status: status
      })
    });
    assert.equal(completion.health.status, "REVIEW_REQUIRED");
    assert.equal(completion.schedule.status, "REVIEW_REQUIRED");
    assert.throws(() => scheduler.claim({
      schedule_id: `risk-${status}`,
      admission: source,
      endpoint: recruitmentEndpoint,
      now: completedRunAt
    }), /not active/u);
  }
});

test("repeated failures, structural changes, and prohibited robots or terms require review", () => {
  const scheduler = new InMemorySourceScheduler();
  const { source, recruitmentEndpoint } = register(scheduler, admission({ source_admission_id: "admission-health" }), "health");
  const first = scheduler.claim({ schedule_id: "health", admission: source, endpoint: recruitmentEndpoint, now: firstRunAt, collection_run_id: "health-1" });
  const oneFailure = scheduler.complete({
    schedule_id: "health",
    admission: source,
    run: runResult({ collection_run_id: first.collection_run_id, recruitment_endpoint_id: recruitmentEndpoint.recruitment_endpoint_id, status: "FAILED" })
  });
  assert.equal(oneFailure.health.status, "DEGRADED");
  const second = scheduler.claim({ schedule_id: "health", admission: source, endpoint: recruitmentEndpoint, now: oneFailure.schedule.next_run_at, collection_run_id: "health-2" });
  const twoFailures = scheduler.complete({
    schedule_id: "health",
    admission: source,
    run: runResult({ collection_run_id: second.collection_run_id, recruitment_endpoint_id: recruitmentEndpoint.recruitment_endpoint_id, status: "FAILED" })
  });
  assert.equal(twoFailures.health.status, "FAILED");
  assert.equal(twoFailures.schedule.status, "REVIEW_REQUIRED");

  const otherScheduler = new InMemorySourceScheduler();
  const other = register(otherScheduler, admission({ source_admission_id: "admission-robots" }), "robots");
  const prohibited = { ...other.source, robots: { ...other.source.robots, status: "PROHIBITED" as const } };
  assert.equal(otherScheduler.reconcileAdmission("robots", prohibited).status, "REVIEW_REQUIRED");
});

test("Collection Run audit is a view of the P2-03 result, not a new runtime", () => {
  const scheduler = new InMemorySourceScheduler();
  const { source, recruitmentEndpoint } = register(scheduler, admission({ source_admission_id: "admission-audit" }), "audit");
  const dispatch = scheduler.claim({ schedule_id: "audit", admission: source, endpoint: recruitmentEndpoint, now: firstRunAt, collection_run_id: "audit-run" });
  const completion = scheduler.complete({
    schedule_id: "audit",
    admission: source,
    run: runResult({ collection_run_id: dispatch.collection_run_id, recruitment_endpoint_id: recruitmentEndpoint.recruitment_endpoint_id, status: "SUCCESS" })
  });
  assert.equal(completion.audit.collection_run_id, dispatch.collection_run_id);
  assert.equal(completion.audit.request_count, 1);
  assert.equal(completion.audit.page_count, 1);
  assert.deepEqual(completion.audit.error_classifications, ["COMPLETE_NON_EMPTY"]);
});

test("P2-05 scheduler tests retain the shared external Network Guard", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});
