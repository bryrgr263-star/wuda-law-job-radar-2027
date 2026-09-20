import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalHash, canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { sealSourceExecutionOutcome, writeSourceExecutionOutcome } from "../../lib/production-persistence/source-execution-outcome";

test("source outcome writer is sealed, idempotent for identical bytes, and collision rejecting", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "source-execution-outcome-"));
  try {
    const content = {
      source_execution_id: "controlled-outcome",
      status: "FAILED" as const,
      trusted_chain_status: "NOT_RUN" as const,
      source_definition_id: "source",
      recruitment_endpoint_id: "endpoint",
      source_version_ids: ["source-version"],
      source_admission_artifact_id: "admission",
      continuous_authorization_ids: [],
      request_attempt_ids: [],
      expected_parent: "parent",
      started_at: "2026-09-19T00:00:00.000Z",
      completed_at: "2026-09-19T00:00:01.000Z",
      reason_codes: ["TRANSPORT_FAILED"],
      acquisition_evidence: { status: "FAILED" as const, assessment: null,
        empty_validation: null, prior_source_execution_id: null, raw_content_hashes: [] },
      acquisition_run_ids: [], acquisition_bundle_hashes: [], raw_blob_ids: [],
      snapshot_ids: [], extracted_record_ids: []
    };
    const outcome = sealSourceExecutionOutcome(content);
    writeSourceExecutionOutcome(directory, outcome);
    writeSourceExecutionOutcome(directory, outcome);
    const target = path.join(directory, "production-runs", "source-executions",
      `${canonicalHash({ source_execution_id: outcome.source_execution_id })}.json`);
    assert.equal(readFileSync(target, "utf8"), canonicalSerialize(outcome));
    assert.throws(() => writeSourceExecutionOutcome(directory, sealSourceExecutionOutcome({
      ...content, reason_codes: ["DIFFERENT"]
    })), /identity collision/u);
    assert.throws(() => writeSourceExecutionOutcome(directory, {
      ...outcome, integrity_hash: "0".repeat(64)
    }), /seal mismatch/u);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
