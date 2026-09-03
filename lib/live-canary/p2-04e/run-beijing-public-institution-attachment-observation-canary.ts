import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { IsoDateTime } from "../../ingestion";
import {
  BEIJING_ATTACHMENT_OBSERVATION_REVIEWER,
  OneEndpointOneRunAttachmentObservationTransport,
  createBeijingAttachmentObservationApproval,
  runBeijingAttachmentObservationCanary
} from "./beijing-public-institution-attachment-observation-canary";

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const issuedAt = new Date().toISOString() as IsoDateTime;
  const approval = createBeijingAttachmentObservationApproval(
    issuedAt,
    BEIJING_ATTACHMENT_OBSERVATION_REVIEWER
  );
  const outputDirectory = path.resolve(
    "outputs",
    "p2-04e",
    approval.authorization.collection_run_id.replace(/[^a-zA-Z0-9._-]/gu, "-")
  );

  await mkdir(outputDirectory, { recursive: true });
  await writeJson(path.join(outputDirectory, "authorization.json"), {
    authorization: approval.authorization,
    authorization_evidence: approval.evidence,
    admission: admissionSummary(approval.admission),
    endpoint: approval.recruitment_endpoint,
    execution: approval.execution,
    authorization_decision: approval.authorization_decision
  });

  const transport = new OneEndpointOneRunAttachmentObservationTransport(
    globalThis.fetch.bind(globalThis)
  );
  const result = await runBeijingAttachmentObservationCanary(
    approval,
    transport,
    new Date().toISOString() as IsoDateTime
  );

  if (result.raw_blob) {
    await writeFile(path.join(outputDirectory, "raw.xlsx"), result.raw_blob.bytes);
  }
  await writeJson(path.join(outputDirectory, "snapshot.json"), result.snapshot);

  const report = {
    status: result.access_classification,
    output_directory: outputDirectory,
    authorization: approval.authorization,
    authorization_evidence: approval.evidence,
    admission: admissionSummary(approval.admission),
    endpoint: {
      recruitment_endpoint_id: approval.recruitment_endpoint.recruitment_endpoint_id,
      source_definition_id: approval.recruitment_endpoint.source_definition_id,
      locator: approval.recruitment_endpoint.locator,
      request_method: approval.recruitment_endpoint.request_method,
      content_kind: approval.recruitment_endpoint.content_kind,
      purpose: approval.admission.endpoint_purpose
    },
    network: {
      requested_at: result.request.requested_at,
      request_url: result.request.locator,
      method: result.request.method,
      request_count: result.transport.request_count,
      request_cookie_sent: result.transport.access_signals.request_cookie_sent,
      request_authorization_sent:
        result.transport.access_signals.request_authorization_sent,
      transport_status: result.transport.response.status,
      http_status: result.transport.response.http_status,
      final_url: result.transport.final_url,
      redirect_chain: result.transport.redirect_chain,
      content_type: result.transport.response_content_type,
      content_length: result.transport.declared_content_length,
      actual_bytes: result.transport.response_size,
      elapsed_ms: result.transport.elapsed_ms,
      response_headers: result.transport.response.headers,
      access_signals: result.transport.access_signals,
      error:
        result.transport.response.status === "FAILED"
          ? result.transport.response.error
          : null
    },
    governance: {
      robots: approval.admission.robots.status,
      terms: approval.admission.terms.status,
      observation_does_not_upgrade_admission: true
    },
    raw: result.raw_blob
      ? {
          raw_blob_id: result.raw_blob.raw_blob_id,
          sha256: result.raw_blob.raw_content_sha256,
          mime_type: result.raw_blob.mime_type,
          byte_length: result.raw_blob.byte_length,
          created_at: result.raw_blob.created_at,
          local_artifact: path.join(outputDirectory, "raw.xlsx")
        }
      : null,
    snapshot: result.snapshot,
    file_safety: result.file_safety,
    authorization_replay_decision: result.authorization_replay_decision
  };
  await writeJson(path.join(outputDirectory, "canary-report.json"), report);
  process.stdout.write(`${JSON.stringify(report, jsonReplacer, 2)}\n`);
}

function admissionSummary(
  admission: ReturnType<typeof createBeijingAttachmentObservationApproval>["admission"]
) {
  return {
    source_admission_id: admission.source_admission_id,
    admission_level: admission.admission_level,
    admission_decision: admission.admission_decision,
    automation_basis: admission.automation_basis,
    endpoint_purpose: admission.endpoint_purpose,
    login_requirement: admission.login_requirement,
    captcha: admission.captcha,
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
