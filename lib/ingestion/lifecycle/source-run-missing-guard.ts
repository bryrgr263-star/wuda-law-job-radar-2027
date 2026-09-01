import { createHash } from "node:crypto";

import type {
  LifecycleEvent,
  LifecycleEventId,
  SourceOccurrence,
  SourceOccurrenceId
} from "../domain";
import type {
  EmptyResultValidation,
  MissingGuardDecision,
  MissingGuardInput,
  MissingGuardResult,
  SourceRunAssessment,
  SourceRunObservation,
  SourceRunReasonCode,
  SourceRunStatus
} from "./types";

export class SourceRunMissingGuard {
  assessRun(observation: SourceRunObservation): SourceRunAssessment {
    validateObservation(observation);
    const classification = classifyRun(observation);
    return {
      source_run_id: observation.source_run_id,
      source_definition_id: observation.source_definition_id,
      recruitment_endpoint_id: observation.recruitment_endpoint_id,
      status: classification.status,
      reason_codes: classification.reason_codes,
      collection_reason_codes: [...observation.collection_completeness.reason_codes],
      snapshot_ids: observation.snapshots.map((snapshot) => snapshot.snapshot_id),
      observed_source_occurrence_ids: [
        ...new Set(observation.observed_source_occurrence_ids)
      ].sort(),
      missing_updates_allowed: classification.status === "SUCCESS"
        || classification.status === "CONFIRMED_EMPTY",
      completed_at: observation.completed_at
    };
  }

  guardMissing(input: MissingGuardInput): MissingGuardResult {
    validateOccurrences(input);
    const observed = new Set(input.source_run.observed_source_occurrence_ids);
    const decisions = [...input.known_source_occurrences]
      .sort((left, right) => {
        return left.source_occurrence_id.localeCompare(right.source_occurrence_id);
      })
      .map((occurrence): MissingGuardDecision => {
        const previous = input.previous_missing_streaks[
          occurrence.source_occurrence_id
        ] ?? 0;
        if (!input.source_run.missing_updates_allowed) {
          return {
            source_occurrence_id: occurrence.source_occurrence_id,
            decision: "PROTECTED_BY_RUN_STATUS",
            previous_missing_streak: previous,
            next_missing_streak: previous,
            lifecycle_event: null
          };
        }
        if (observed.has(occurrence.source_occurrence_id)) {
          return {
            source_occurrence_id: occurrence.source_occurrence_id,
            decision: "OBSERVED_RESET",
            previous_missing_streak: previous,
            next_missing_streak: 0,
            lifecycle_event: null
          };
        }
        return {
          source_occurrence_id: occurrence.source_occurrence_id,
          decision: "MISSING_RECORDED",
          previous_missing_streak: previous,
          next_missing_streak: previous + 1,
          lifecycle_event: missingEvent(input.source_run, occurrence)
        };
      });
    return {
      source_run_id: input.source_run.source_run_id,
      decisions,
      lifecycle_events: decisions.flatMap((decision) => {
        return decision.lifecycle_event ? [decision.lifecycle_event] : [];
      })
    };
  }
}

interface RunClassification {
  readonly status: SourceRunStatus;
  readonly reason_codes: readonly SourceRunReasonCode[];
}

function classifyRun(observation: SourceRunObservation): RunClassification {
  if (observation.snapshots.length === 0) {
    return classification("FAILED", ["NO_SNAPSHOTS"]);
  }
  if (observation.snapshots.some((snapshot) => {
    return snapshot.transport_status === "FAILED";
  })) {
    return classification("FAILED", ["TRANSPORT_FAILED"]);
  }
  if (observation.collection_completeness.status === "FAILED") {
    return classification("FAILED", ["COLLECTION_FAILED"]);
  }
  if (observation.collection_completeness.status === "PARTIAL") {
    return classification("PARTIAL", ["COLLECTION_PARTIAL"]);
  }
  if (observation.not_modified) {
    return classification("NOT_MODIFIED", ["NOT_MODIFIED_CONFIRMED"]);
  }

  const observedCount = new Set(
    observation.observed_source_occurrence_ids
  ).size;
  if (observedCount > 0) {
    if (observation.collection_completeness.status !== "COMPLETE") {
      return classification("PARTIAL", [
        "COLLECTION_STATUS_CONTRADICTS_RECORDS"
      ]);
    }
    return classification("SUCCESS", ["COMPLETE_NON_EMPTY"]);
  }

  const emptyReasons = validateEmptyResult(
    observation.empty_result_validation
  );
  if (emptyReasons.length === 0) {
    return classification("CONFIRMED_EMPTY", ["CONFIRMED_EMPTY_EVIDENCE"]);
  }
  return classification("SUSPICIOUS_EMPTY", emptyReasons);
}

function validateEmptyResult(
  validation: EmptyResultValidation | undefined
): SourceRunReasonCode[] {
  if (!validation) return ["ZERO_RESULT_REQUIRES_VALIDATION"];
  const reasons: SourceRunReasonCode[] = [];
  if (!validation.response_structure_valid) {
    reasons.push("EMPTY_RESPONSE_STRUCTURE_INVALID");
  }
  if (!validation.pagination_complete) {
    reasons.push("EMPTY_PAGINATION_INCOMPLETE");
  }
  if (!validation.explicit_empty_signal
      && validation.official_result_count !== 0) {
    reasons.push("EMPTY_SIGNAL_MISSING");
  }
  if (validation.authentication_wall_detected) {
    reasons.push("EMPTY_AUTHENTICATION_WALL_DETECTED");
  }
  if (validation.captcha_detected) {
    reasons.push("EMPTY_CAPTCHA_DETECTED");
  }
  if (validation.error_page_detected) {
    reasons.push("EMPTY_ERROR_PAGE_DETECTED");
  }
  if (validation.structure_drift_detected) {
    reasons.push("EMPTY_STRUCTURE_DRIFT_DETECTED");
  }
  if (validation.historical_comparison === "ANOMALOUS") {
    reasons.push("EMPTY_HISTORY_ANOMALOUS");
  }
  if (validation.historical_comparison === "UNAVAILABLE") {
    reasons.push("EMPTY_HISTORY_UNAVAILABLE");
  }
  return reasons;
}

function classification(
  status: SourceRunStatus,
  reasonCodes: readonly SourceRunReasonCode[]
): RunClassification {
  return { status, reason_codes: reasonCodes };
}

function validateObservation(observation: SourceRunObservation) {
  for (const snapshot of observation.snapshots) {
    if (snapshot.recruitment_endpoint_id
        !== observation.recruitment_endpoint_id) {
      throw new Error(
        `Snapshot ${snapshot.snapshot_id} belongs to another RecruitmentEndpoint`
      );
    }
  }
  if (observation.not_modified
      && observation.observed_source_occurrence_ids.length > 0) {
    throw new Error("NOT_MODIFIED run cannot contain newly observed occurrences");
  }
}

function validateOccurrences(input: MissingGuardInput) {
  for (const occurrence of input.known_source_occurrences) {
    if (occurrence.source_definition_id
        !== input.source_run.source_definition_id
        || occurrence.recruitment_endpoint_id
          !== input.source_run.recruitment_endpoint_id) {
      throw new Error(
        `SourceOccurrence ${occurrence.source_occurrence_id} is outside the assessed Source Run`
      );
    }
  }
}

function missingEvent(
  run: SourceRunAssessment,
  occurrence: SourceOccurrence
): LifecycleEvent {
  const eventId = `lifecycle-event:${sha256(stableSerialize({
    source_run_id: run.source_run_id,
    source_occurrence_id: occurrence.source_occurrence_id,
    event_kind: "MISSING_OBSERVED"
  }))}` as LifecycleEventId;
  return {
    lifecycle_event_id: eventId,
    target: {
      kind: "SOURCE_OCCURRENCE",
      source_occurrence_id: occurrence.source_occurrence_id
    },
    event_kind: "MISSING_OBSERVED",
    observed_at: run.completed_at,
    snapshot_ids: run.snapshot_ids,
    reason_code: `SOURCE_RUN_${run.status}`
  };
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
