import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { IsoDateTime } from "../../ingestion";
import {
  BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_REVIEWER,
  OneEndpointOneRunDetailLiveCanaryTransport,
  createBeijingDetailLiveCanaryApproval,
  runBeijingDetailLiveCanary
} from "./beijing-public-institution-detail-live-canary";

void main();

async function main() {
  const issuedAt = new Date().toISOString() as IsoDateTime;
  const approval = createBeijingDetailLiveCanaryApproval(
    issuedAt,
    BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_REVIEWER
  );
  const outputDirectory = path.resolve(
    "outputs",
    "p2-04d",
    approval.authorization.collection_run_id.replace(/[^a-zA-Z0-9._-]/gu, "-")
  );

  await mkdir(outputDirectory, { recursive: true });
  await writeJson(path.join(outputDirectory, "authorization.json"), {
    authorization: approval.authorization,
    evidence: approval.evidence,
    admission: admissionSummary(approval.approved_admission),
    execution: approval.execution,
    authorization_decision: approval.authorization_decision
  });

  const transport = new OneEndpointOneRunDetailLiveCanaryTransport(globalThis.fetch.bind(globalThis));
  const result = await runBeijingDetailLiveCanary(
    approval,
    transport,
    new Date().toISOString() as IsoDateTime
  );
  if (result.raw_blob) {
    await writeFile(path.join(outputDirectory, "raw.html"), result.raw_blob.bytes);
  }
  await writeJson(path.join(outputDirectory, "snapshot.json"), result.snapshot);
  const report = {
    output_directory: outputDirectory,
    authorization: approval.authorization,
    evidence: approval.evidence,
    admission: admissionSummary(approval.approved_admission),
    network: {
      requested_at: result.request.requested_at,
      endpoint: result.request.locator,
      method: result.request.method,
      timeout_ms: result.request.timeout_ms,
      request_count: result.transport.request_count,
      transport_status: result.transport.response.status,
      http_status: result.transport.response.http_status,
      final_url: result.transport.final_url,
      redirect_chain: result.transport.redirect_chain,
      content_type: result.transport.response_content_type,
      encoding: result.transport.encoding,
      response_size: result.transport.response_size,
      elapsed_ms: result.transport.elapsed_ms,
      response_headers: result.transport.response.headers,
      access_signals: result.transport.access_signals,
      error: result.transport.response.status === "FAILED" ? result.transport.response.error : null
    },
    raw: result.raw_blob ? {
      raw_blob_id: result.raw_blob.raw_blob_id,
      sha256: result.raw_blob.raw_content_sha256,
      mime_type: result.raw_blob.mime_type,
      byte_length: result.raw_blob.byte_length,
      created_at: result.raw_blob.created_at,
      local_artifact: path.join(outputDirectory, "raw.html")
    } : null,
    snapshot: result.snapshot,
    html_diagnostic: result.html_diagnostic,
    authorization_replay_decision: result.authorization_replay_decision
  };
  await writeJson(path.join(outputDirectory, "canary-report.json"), report);
  process.stdout.write(`${JSON.stringify(report, jsonReplacer, 2)}\n`);
}

function admissionSummary(admission: Parameters<typeof createBeijingDetailLiveCanaryApproval>[0] extends never ? never : ReturnType<typeof createBeijingDetailLiveCanaryApproval>["approved_admission"]) {
  return {
    source_admission_id: admission.source_admission_id,
    admission_level: admission.admission_level,
    admission_decision: admission.admission_decision,
    automation_basis: admission.automation_basis,
    robots: admission.robots.status,
    terms: admission.terms.status
  };
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, jsonReplacer, 2)}\n`, "utf8");
}

function jsonReplacer(_key: string, value: unknown) {
  if (value instanceof Uint8Array) return `[${value.byteLength} raw bytes omitted]`;
  if (value instanceof Map || value instanceof Set) return undefined;
  return value;
}
