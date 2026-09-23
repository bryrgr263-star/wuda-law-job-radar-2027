import "../helpers/network-guard";

import { appendFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

import type { RecruitmentAdapter, TransportResponse } from "../../lib/ingestion";
import { bootstrapProductionSchedulerBatch } from "../../lib/production-persistence/production-scheduler-batch";
import { trustedFixture } from "../pipeline/position-bound-phase-fixture";
import { AT, identity } from "./continuous-acquisition-fixture";

const [remote, batchId, markerPath, resultPath] = process.argv.slice(2);
if (!remote || !batchId || !markerPath || !resultPath) throw new Error("SCHEDULER_CAS_WORKER_ARGUMENTS_MISSING");

const bytes = new TextEncoder().encode(`Controlled CAS worker ${batchId}`);
const transport = { async execute(): Promise<TransportResponse> {
  appendFileSync(markerPath, `${process.pid}\n`, "utf8");
  await new Promise(resolve => setTimeout(resolve, 750));
  return { status: "SUCCESS", bytes,
    content_sha256: createHash("sha256").update(bytes).digest("hex") as never,
    responded_at: AT as never, mime_type: "text/html", http_status: 200, headers: {} };
} };

void main();

async function main() {
try {
  const scheduler = bootstrapProductionSchedulerBatch({
    remote_url: remote,
    branch: "main",
    stream_id: "scheduler-cas-controlled",
    execution_mode: "TEST_ONLY",
    continuous_scope: "CONTROLLED_TEST",
    controlled_continuous_transport: transport,
    now: () => AT,
    commit_identity: identity,
    resolve_adapter: adapterKey => controlledAdapter(adapterKey)
  });
  const result = await scheduler.runBatch({ batch_id: batchId, actor: "controlled-cas-runner", started_at: AT });
  writeFileSync(resultPath, JSON.stringify({ ok: true, result }), "utf8");
} catch (error) {
  writeFileSync(resultPath, JSON.stringify({ ok: false,
    error: error instanceof Error ? error.message : String(error) }), "utf8");
  process.exitCode = 1;
}
}

function controlledAdapter(adapterKey: string): RecruitmentAdapter | null {
  if (adapterKey !== "p2-05-test-only") return null;
  const template = trustedFixture(`scheduler-cas-${adapterKey}`, "学历要求：本科及以上", { raw_title: "法务岗" });
  return { descriptor: { adapter_key: adapterKey, name: "Controlled scheduler CAS adapter", version: "1.0.0",
    supported_content_kinds: ["HTML"], capabilities: ["SINGLE_PAGE", "HTML_EXTRACTION"] },
    validateEndpoint: () => ({ valid: true, issues: [] }),
    plan: endpoint => [{ recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
      locator: endpoint.locator, method: "GET", parameters: {}, pagination_state: {
        page_index: 1, cursor: null, visited_locators: [endpoint.locator] } }],
    extract: ({ snapshot, endpoint }) => [{ ...template.source.extracted_record,
      extracted_record_id: `controlled-cas:${snapshot.snapshot_id}` as never,
      snapshot_id: snapshot.snapshot_id, source_definition_id: endpoint.source_definition_id,
      announcement_url: endpoint.locator,
      extraction: { extractor_name: "ControlledSchedulerCasAdapter", extractor_version: "1.0.0",
        extracted_at: snapshot.observed_at } }],
    nextPage: () => null,
    assessCompleteness: input => input.records.length
      ? { status: "COMPLETE", reason_codes: [] }
      : { status: "COMPLETE", reason_codes: ["ZERO_EXTRACTED_RECORDS"] } };
}
