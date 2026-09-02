import { randomUUID } from "node:crypto";

import {
  evaluateLiveCanaryAuthorization,
  evaluateSourceAutomationPermission,
  type LiveCanaryManualAuthorization,
  type SourceAdmission
} from "../application/source-admission";
import type { CollectionRunRuntimeResult } from "../collection-runtime";
import type { IsoDateTime, RecruitmentEndpoint } from "../ingestion";
import { summarizeCollectionRun } from "./collection-run-audit";
import {
  initialSourceHealth,
  requiresSchedulerReview,
  updateSourceHealth
} from "./source-health";
import type {
  CollectionRunAuditView,
  CollectionSchedulePolicy,
  ScheduledCollectionDispatch,
  SourceHealth,
  SourceSchedule,
  SourceSchedulingEligibility
} from "./types";

const FREQUENCY_INTERVAL_MS = {
  SIX_HOURS: 6 * 60 * 60 * 1_000,
  TWELVE_HOURS: 12 * 60 * 60 * 1_000,
  DAILY: 24 * 60 * 60 * 1_000,
  THREE_DAYS: 3 * 24 * 60 * 60 * 1_000,
  WEEKLY: 7 * 24 * 60 * 60 * 1_000
} as const;

export class SourceSchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceSchedulerError";
  }
}

export interface RegisterScheduleInput {
  readonly schedule_id: string;
  readonly admission: SourceAdmission;
  readonly endpoint: RecruitmentEndpoint;
  readonly policy: CollectionSchedulePolicy;
  readonly first_run_at: IsoDateTime;
}

export interface ClaimScheduledRunInput {
  readonly schedule_id: string;
  readonly admission: SourceAdmission;
  readonly endpoint: RecruitmentEndpoint;
  readonly now: IsoDateTime;
  readonly collection_run_id?: string;
  readonly authorization?: LiveCanaryManualAuthorization | null;
}

export interface CompleteScheduledRunInput {
  readonly schedule_id: string;
  readonly admission: SourceAdmission;
  readonly run: CollectionRunRuntimeResult;
  readonly structure_change_detected?: boolean;
}

export interface CompleteScheduledRunResult {
  readonly schedule: SourceSchedule;
  readonly health: SourceHealth;
  readonly audit: CollectionRunAuditView;
}

export class InMemorySourceScheduler {
  readonly #schedules = new Map<string, SourceSchedule>();
  readonly #health = new Map<string, SourceHealth>();
  readonly #dispatchedRuns = new Map<string, ScheduledCollectionDispatch>();
  readonly #runIds = new Set<string>();

  register(input: RegisterScheduleInput): SourceSchedule {
    if (this.#schedules.has(input.schedule_id)) {
      throw new SourceSchedulerError(`Schedule already exists: ${input.schedule_id}`);
    }
    assertText(input.schedule_id, "Schedule ID");
    assertSchedulingEligibility(input.admission);
    assertEndpointBinding(input.admission, input.endpoint);
    assertPolicy(input.policy);
    assertDate(input.first_run_at, "First run time");
    const schedule: SourceSchedule = {
      schedule_id: input.schedule_id,
      source_admission_id: input.admission.source_admission_id,
      recruitment_endpoint_id: input.endpoint.recruitment_endpoint_id,
      enabled: true,
      frequency: input.policy.frequency,
      minimum_interval_ms: input.policy.minimum_interval_ms,
      next_run_at: input.first_run_at,
      last_run_at: null,
      failure_count: 0,
      status: "ACTIVE"
    };
    this.#schedules.set(schedule.schedule_id, clone(schedule));
    this.#health.set(schedule.schedule_id, initialSourceHealth(input.admission));
    return clone(schedule);
  }

  get(scheduleId: string): SourceSchedule | null {
    const schedule = this.#schedules.get(scheduleId);
    return schedule ? clone(schedule) : null;
  }

  getHealth(scheduleId: string): SourceHealth | null {
    const health = this.#health.get(scheduleId);
    return health ? clone(health) : null;
  }

  claim(input: ClaimScheduledRunInput): ScheduledCollectionDispatch {
    const schedule = this.requireSchedule(input.schedule_id);
    assertScheduleBinding(schedule, input.admission, input.endpoint);
    assertSchedulingEligibility(input.admission);
    assertEndpointBinding(input.admission, input.endpoint);
    if (!schedule.enabled || schedule.status !== "ACTIVE") {
      throw new SourceSchedulerError(`Schedule is not active: ${schedule.schedule_id}`);
    }
    if (this.#dispatchedRuns.has(schedule.schedule_id)) {
      throw new SourceSchedulerError(`Schedule already has an incomplete Collection Run: ${schedule.schedule_id}`);
    }
    assertDate(input.now, "Scheduled run time");
    if (Date.parse(input.now) < Date.parse(schedule.next_run_at)) {
      throw new SourceSchedulerError("Schedule is not due");
    }
    const eligibility = schedulingEligibility(input.admission);
    const collectionRunId = input.collection_run_id
      ?? input.authorization?.collection_run_id
      ?? createCollectionRunId();
    assertText(collectionRunId, "Collection Run ID");
    if (this.#runIds.has(collectionRunId)) {
      throw new SourceSchedulerError(`Collection Run ID already issued: ${collectionRunId}`);
    }
    if (eligibility.requires_manual_authorization) {
      const decision = evaluateLiveCanaryAuthorization(input.admission, {
        source_admission_id: input.admission.source_admission_id,
        endpoint: input.endpoint.locator,
        recruitment_endpoint_id: input.endpoint.recruitment_endpoint_id,
        recruitment_endpoint: input.endpoint,
        endpoint_purpose: input.admission.endpoint_purpose,
        allowed_http_method: "GET",
        collection_run_id: collectionRunId as never
      }, input.authorization ?? null);
      if (!decision.allowed) {
        throw new SourceSchedulerError(
          `Level B requires a fresh valid manual authorization: ${decision.reason_codes.join(", ")}`
        );
      }
    }
    const dispatch: ScheduledCollectionDispatch = {
      schedule_id: schedule.schedule_id,
      collection_run_id: collectionRunId,
      source_admission_id: input.admission.source_admission_id,
      recruitment_endpoint_id: input.endpoint.recruitment_endpoint_id,
      endpoint: input.endpoint.locator,
      scheduled_at: input.now,
      requires_manual_authorization: eligibility.requires_manual_authorization,
      manual_authorization: input.authorization ?? null,
      authorization_id: input.authorization?.authorization_id ?? null
    };
    this.#runIds.add(collectionRunId);
    this.#dispatchedRuns.set(schedule.schedule_id, clone(dispatch));
    return clone(dispatch);
  }

  complete(input: CompleteScheduledRunInput): CompleteScheduledRunResult {
    const schedule = this.requireSchedule(input.schedule_id);
    const dispatch = this.#dispatchedRuns.get(schedule.schedule_id);
    if (!dispatch || dispatch.collection_run_id !== input.run.collection_run_id) {
      throw new SourceSchedulerError("Collection Run was not issued by this Schedule");
    }
    if (input.run.recruitment_endpoint_id !== schedule.recruitment_endpoint_id) {
      throw new SourceSchedulerError("Collection Run Endpoint does not match Schedule");
    }
    const health = updateSourceHealth({
      admission: input.admission,
      previous: this.#health.get(schedule.schedule_id) ?? null,
      run: input.run,
      structure_change_detected: input.structure_change_detected ?? false
    });
    const completedSchedule: SourceSchedule = {
      ...schedule,
      last_run_at: input.run.completed_at,
      next_run_at: nextRunAt(input.run.completed_at, schedule),
      failure_count: input.run.status === "SUCCESS" ? 0 : schedule.failure_count + 1,
      status: requiresSchedulerReview(health) ? "REVIEW_REQUIRED" : "ACTIVE"
    };
    const audit = summarizeCollectionRun(completedSchedule, input.run);
    this.#schedules.set(schedule.schedule_id, clone(completedSchedule));
    this.#health.set(schedule.schedule_id, clone(health));
    this.#dispatchedRuns.delete(schedule.schedule_id);
    return { schedule: clone(completedSchedule), health: clone(health), audit };
  }

  reconcileAdmission(scheduleId: string, admission: SourceAdmission): SourceSchedule {
    const schedule = this.requireSchedule(scheduleId);
    if (
      schedule.source_admission_id !== admission.source_admission_id
      || schedule.recruitment_endpoint_id !== admission.recruitment_endpoint_id
    ) {
      throw new SourceSchedulerError("Admission does not match Schedule binding");
    }
    const prohibited = isProhibited(admission.robots.status) || isProhibited(admission.terms.status);
    const eligible = schedulingEligibility(admission).allowed;
    const reconciled: SourceSchedule = prohibited || !eligible
      ? { ...schedule, status: "REVIEW_REQUIRED" }
      : schedule;
    this.#schedules.set(scheduleId, clone(reconciled));
    const health = this.#health.get(scheduleId);
    if (health) {
      this.#health.set(scheduleId, {
        ...health,
        robots_status: admission.robots.status,
        terms_status: admission.terms.status,
        status: prohibited ? "REVIEW_REQUIRED" : health.status
      });
    }
    return clone(reconciled);
  }

  pause(scheduleId: string): SourceSchedule {
    return this.setStatus(scheduleId, "PAUSED", true);
  }

  disable(scheduleId: string): SourceSchedule {
    return this.setStatus(scheduleId, "DISABLED", false);
  }

  private setStatus(scheduleId: string, status: SourceSchedule["status"], enabled: boolean) {
    const schedule = this.requireSchedule(scheduleId);
    const updated = { ...schedule, status, enabled };
    this.#schedules.set(scheduleId, clone(updated));
    return clone(updated);
  }

  private requireSchedule(scheduleId: string): SourceSchedule {
    const schedule = this.#schedules.get(scheduleId);
    if (!schedule) throw new SourceSchedulerError(`Unknown schedule: ${scheduleId}`);
    return schedule;
  }
}

export function schedulingEligibility(admission: SourceAdmission): SourceSchedulingEligibility {
  const permission = evaluateSourceAutomationPermission(admission);
  if (!permission.allowed) {
    return {
      allowed: false,
      requires_manual_authorization: false,
      reason_code: admission.admission_decision !== "APPROVED"
        ? "ADMISSION_NOT_APPROVED"
        : "ADMISSION_LEVEL_DENIED"
    };
  }
  return {
    allowed: true,
    requires_manual_authorization: permission.mode === "ONE_ENDPOINT_ONE_RUN",
    reason_code: null
  };
}

function assertSchedulingEligibility(admission: SourceAdmission) {
  const eligibility = schedulingEligibility(admission);
  if (!eligibility.allowed) {
    throw new SourceSchedulerError(`Source Admission cannot be scheduled: ${eligibility.reason_code}`);
  }
}

function assertScheduleBinding(
  schedule: SourceSchedule,
  admission: SourceAdmission,
  endpoint: RecruitmentEndpoint
) {
  if (
    schedule.source_admission_id !== admission.source_admission_id
    || schedule.recruitment_endpoint_id !== endpoint.recruitment_endpoint_id
  ) {
    throw new SourceSchedulerError("Schedule, Source Admission, and Endpoint must share one binding");
  }
}

function assertEndpointBinding(admission: SourceAdmission, endpoint: RecruitmentEndpoint) {
  if (
    endpoint.recruitment_endpoint_id !== admission.recruitment_endpoint_id
    || endpoint.locator !== admission.endpoint
    || endpoint.request_method !== admission.allowed_http_method
    || endpoint.content_kind !== admission.content_kind
  ) {
    throw new SourceSchedulerError("Endpoint does not match its Source Admission binding");
  }
  if (endpoint.collection_config.max_pages !== 1 || endpoint.collection_config.follow_redirects !== false) {
    throw new SourceSchedulerError("P2-05 refuses pagination or redirect expansion without new Endpoint approval");
  }
}

function assertPolicy(policy: CollectionSchedulePolicy) {
  if (!Number.isInteger(policy.minimum_interval_ms) || policy.minimum_interval_ms <= 0) {
    throw new SourceSchedulerError("Schedule minimum interval must be a positive integer");
  }
}

function nextRunAt(completedAt: IsoDateTime, schedule: SourceSchedule): IsoDateTime {
  const duration = Math.max(FREQUENCY_INTERVAL_MS[schedule.frequency], schedule.minimum_interval_ms);
  return new Date(Date.parse(completedAt) + duration).toISOString() as IsoDateTime;
}

function assertDate(value: string, label: string) {
  if (Number.isNaN(Date.parse(value))) throw new SourceSchedulerError(`${label} must be ISO date-time`);
}

function assertText(value: string, label: string) {
  if (value.trim().length === 0) throw new SourceSchedulerError(`${label} cannot be empty`);
}

function isProhibited(status: SourceAdmission["robots"]["status"]) {
  return status === "DISALLOWED" || status === "PROHIBITED";
}

function createCollectionRunId() {
  return `scheduled-collection-run:${randomUUID()}`;
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}
