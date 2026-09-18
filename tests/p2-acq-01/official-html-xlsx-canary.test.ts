import "../helpers/network-guard";
import { readHistoricalEvidenceBytes, readHistoricalEvidenceJson } from "../helpers/historical-evidence";

import assert from "node:assert/strict";
import test from "node:test";

import type { IsoDateTime, Snapshot } from "../../lib/ingestion";
import {
  P2Acq01ApprovedOfficialCanaryTransport,
  P2_ACQ_01_DOCX_ENDPOINT,
  P2_ACQ_01_SCOPE,
  runP2Acq01BeijingHtmlXlsxCanary
} from "../../lib/live-canary/p2-acq-01";
import {
  BEIJING_ATTACHMENT_ENDPOINT
} from "../../lib/live-canary/p2-04e/beijing-public-institution-attachment-contract";

const observedAt = "2026-09-14T00:00:00.000Z" as IsoDateTime;

test("archived official HTML and XLSX retain all positions and stop at missing DOCX evidence", async () => {
  const html = readHistoricalEvidenceBytes("beijing-detail-html");
  let fetchCalls = 0;
  const transport = new P2Acq01ApprovedOfficialCanaryTransport(async (_input, init) => {
    fetchCalls += 1;
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.credentials, "omit");
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }, {
    now: () => observedAt,
    monotonic_now: monotonicClock()
  });

  const result = await runP2Acq01BeijingHtmlXlsxCanary({
    transport,
    requested_at: observedAt,
    archived_xlsx: {
      bytes: new Uint8Array(readHistoricalEvidenceBytes("beijing-attachment-xlsx")),
      snapshot: readHistoricalEvidenceJson<Snapshot>("beijing-attachment-snapshot")
    }
  });

  assert.equal(fetchCalls, 1);
  assert.equal(result.network_calls, 1);
  assert.equal(result.canary_status, "CANARY_PARTIAL");
  assert.equal(result.evidence_status, "EVIDENCE_BLOCKED");
  assert.deepEqual(result.scope, P2_ACQ_01_SCOPE);
  assert.equal(result.position_chains.length, 3);
  assert.equal(new Set(result.position_chains.map((item) => item.position.position_id)).size, 3);
  assert.equal(result.position_chains.every((item) => {
    return item.position.identity_basis.kind === "SOURCE_LOCAL_RECORD"
      && item.position.identity_state === "PROVISIONAL"
      && item.source_composition.status !== "COMPLETE";
  }), true);
  assert.deepEqual(result.attachment_inventory.map((item) => item.locator), [
    BEIJING_ATTACHMENT_ENDPOINT,
    P2_ACQ_01_DOCX_ENDPOINT
  ]);
  assert.deepEqual(result.attachment_inventory.map((item) => item.evidence_state), [
    "CLOSED",
    "EVIDENCE_BLOCKED"
  ]);
  assert.deepEqual(result.downstream, {
    requirement_projection_created: false,
    requirement_set_version_created: false,
    predicate_resolution_created: false,
    eligibility_assessment_created: false
  });
});

function monotonicClock() {
  let value = 100;
  return () => value++;
}
