import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { IsoDateTime } from "../../ingestion";
import {
  BEIJING_FIRST_CANARY_REVIEWER,
  OneEndpointOneRunLiveCanaryTransport,
  createBeijingLiveCanaryApproval,
  runFirstBeijingLiveCanary
} from "./beijing-first-live-canary";

void main();

async function main() {
  const issuedAt = new Date().toISOString() as IsoDateTime;
  const approval = createBeijingLiveCanaryApproval(issuedAt, BEIJING_FIRST_CANARY_REVIEWER);
  const outputDirectory = path.resolve(
    "outputs",
    "p2-04",
    approval.authorization.collection_run_id.replace(/[^a-zA-Z0-9._-]/gu, "-")
  );

  await mkdir(outputDirectory, { recursive: true });
  await writeJson(path.join(outputDirectory, "authorization.json"), {
    authorization: approval.authorization,
    evidence: approval.evidence,
    admission: {
      source_admission_id: approval.approved_admission.source_admission_id,
      admission_level: approval.approved_admission.admission_level,
      admission_decision: approval.approved_admission.admission_decision,
      automation_basis: approval.approved_admission.automation_basis,
      robots: approval.approved_admission.robots.status,
      terms: approval.approved_admission.terms.status
    },
    execution: approval.execution,
    authorization_decision: approval.authorization_decision
  });

  const transport = new OneEndpointOneRunLiveCanaryTransport(globalThis.fetch.bind(globalThis));
  const result = await runFirstBeijingLiveCanary(
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
    admission: {
      source_admission_id: approval.approved_admission.source_admission_id,
      admission_level: approval.approved_admission.admission_level,
      admission_decision: approval.approved_admission.admission_decision,
      automation_basis: approval.approved_admission.automation_basis,
      robots: approval.approved_admission.robots.status,
      terms: approval.approved_admission.terms.status
    },
    network: {
      requested_at: result.request.requested_at,
      endpoint: result.request.locator,
      method: result.request.method,
      timeout_ms: result.request.timeout_ms,
      request_count: result.transport.request_count,
      transport_status: result.transport.response.status,
      http_status: result.transport.response.http_status,
      final_url: result.transport.final_url,
      redirect_location: result.transport.redirect_location,
      content_type: result.transport.response_content_type,
      response_size: result.transport.response_size,
      error: result.transport.response.status === "FAILED"
        ? result.transport.response.error
        : null
    },
    raw: result.raw_blob
      ? {
          raw_blob_id: result.raw_blob.raw_blob_id,
          sha256: result.raw_blob.raw_content_sha256,
          mime_type: result.raw_blob.mime_type,
          byte_length: result.raw_blob.byte_length,
          created_at: result.raw_blob.created_at,
          local_artifact: path.join(outputDirectory, "raw.html")
        }
      : null,
    snapshot: result.snapshot,
    html_diagnostic: result.html_diagnostic,
    authorization_replay_decision: result.authorization_replay_decision
  };
  await writeJson(path.join(outputDirectory, "canary-report.json"), report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, jsonReplacer, 2)}\n`, "utf8");
}

function jsonReplacer(_key: string, value: unknown) {
  if (value instanceof Uint8Array) return `[${value.byteLength} raw bytes omitted]`;
  if (value instanceof Map || value instanceof Set) return undefined;
  return value;
}
