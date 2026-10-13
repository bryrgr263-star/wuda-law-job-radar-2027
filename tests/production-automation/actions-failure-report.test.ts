import assert from "node:assert/strict";
import test from "node:test";
import { createActionsFailureReport } from "../../lib/production-automation/actions-failure-report";
import { ProductionPersistenceError } from "../../lib/production-persistence/contracts";

test("Actions failures retain bounded stage and exact fencing diagnostic", () => {
  assert.deepEqual(createActionsFailureReport(new Error("GIT_INCIDENT_FENCING_CONTEXT_DENIED"), "PREFLIGHT_RESTORE"), {
    status: "FAILED", failure_stage: "PREFLIGHT_RESTORE", error_code: "GIT_INCIDENT_FENCING_CONTEXT_DENIED"
  });
});

test("persistence and Git subprocess failure categories survive without private detail", () => {
  assert.equal(createActionsFailureReport(new ProductionPersistenceError("INTEGRITY_MISMATCH", "private artifact"),
    "PREFLIGHT_RESTORE").error_code, "ACTIONS_PERSISTENCE_INTEGRITY_MISMATCH");
  assert.equal(createActionsFailureReport(Object.assign(new Error("Command failed: git clone private-url"),
    { status: 128 }), "PREFLIGHT_RESTORE").error_code, "ACTIONS_GIT_PROCESS_FAILED");
});

test("Actions diagnostics do not publish arbitrary messages or process stderr", () => {
  const error = Object.assign(new Error("Bearer private-token https://user:password@example.com"), {
    stderr: "secret response", code: "ENOBUFS"
  });
  const report = createActionsFailureReport(error, "PREFLIGHT_RESTORE");
  assert.equal(report.error_code, "ACTIONS_CHILD_PROCESS_BUFFER_LIMIT");
  assert.equal(JSON.stringify(report).includes("private-token"), false);
  assert.equal(JSON.stringify(report).includes("secret"), false);
  assert.equal(createActionsFailureReport(new Error("unknown sensitive failure"), "SCHEDULER_EXECUTION").error_code,
    "AUTOMATION_EXECUTION_FAILED");
});
