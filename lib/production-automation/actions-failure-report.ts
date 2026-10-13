export type ActionsFailureStage = "CONFIGURATION" | "PREFLIGHT_RESTORE" | "SCHEDULER_EXECUTION" | "REPORT_WRITE";

export function createActionsFailureReport(error: unknown, stage: ActionsFailureStage) {
  let code = "AUTOMATION_EXECUTION_FAILED";
  if (error instanceof Error) {
    const allowed = [
      /^ACTIONS_ENV_MISSING_[A-Z_]+$/u, /^ACTIONS_[A-Z_]+$/u,
      /^PRODUCTION_[A-Z_]+$/u, /^AUTHORITATIVE_REMOTE_URL_UNSAFE$/u,
      /^SCHEDULER_[A-Z_:]+$/u, /^GIT_INCIDENT_FENCING_CONTEXT_DENIED$/u,
      /^FENCING_NOT_VERIFIED$/u, /^FENCED_RECOVERY_INTENT_COVERAGE_MISMATCH$/u,
      /^RECOVERY_INTENT_COVERAGE_MISMATCH$/u, /^SOURCE_REQUEST_INTENT_MISSING$/u
    ];
    if (error instanceof ProductionPersistenceError) code = `ACTIONS_PERSISTENCE_${error.code}`;
    else if (allowed.some(pattern => pattern.test(error.message))) code = error.message;
    else if ("code" in error && error.code === "ENOBUFS") code = "ACTIONS_CHILD_PROCESS_BUFFER_LIMIT";
    else if ("code" in error && error.code === "ETIMEDOUT") code = "ACTIONS_CHILD_PROCESS_TIMEOUT";
    else if (/^Command failed: git\s/u.test(error.message) && "status" in error
      && typeof error.status === "number") code = "ACTIONS_GIT_PROCESS_FAILED";
  }
  return { status: "FAILED" as const, failure_stage: stage, error_code: code };
}
import { ProductionPersistenceError } from "../production-persistence/contracts";

