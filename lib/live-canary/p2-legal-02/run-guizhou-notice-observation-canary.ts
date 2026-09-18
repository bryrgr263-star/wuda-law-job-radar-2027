import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { IsoDateTime } from "../../ingestion";
import {
  OneEndpointOneRunGuizhouNoticeTransport,
  createGuizhouNoticeObservationApproval,
  runGuizhouNoticeObservationCanary
} from "./guizhou-notice-observation-canary";

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const outputRoot = path.resolve("outputs", "p2-legal-02");
  const executionRecord = path.join(outputRoot, "notice-observation-canary-execution.json");
  await mkdir(outputRoot, { recursive: true });
  if (await exists(executionRecord)) {
    throw new Error("P2-LEGAL-02 execution record already exists; refusing another request");
  }

  const issuedAt = new Date().toISOString() as IsoDateTime;
  const approval = createGuizhouNoticeObservationApproval(issuedAt);
  const outputDirectory = path.join(
    outputRoot,
    approval.authorization.collection_run_id.replace(/[^a-zA-Z0-9._-]/gu, "-")
  );
  await mkdir(outputDirectory, { recursive: true });
  await writeJson(path.join(outputDirectory, "authorization.json"), {
    authorization: approval.authorization,
    authorization_evidence: approval.evidence,
    admission: {
      source_admission_id: approval.admission.source_admission_id,
      admission_level: approval.admission.admission_level,
      admission_decision: approval.admission.admission_decision,
      automation_basis: approval.admission.automation_basis,
      endpoint_purpose: approval.admission.endpoint_purpose,
      login_requirement: approval.admission.login_requirement,
      captcha: approval.admission.captcha,
      robots: approval.admission.robots.status,
      terms: approval.admission.terms.status
    },
    endpoint: approval.recruitment_endpoint,
    execution: approval.execution,
    authorization_decision: approval.authorization_decision
  });
  await writeJson(executionRecord, {
    status: "STARTED",
    started_at: issuedAt,
    maximum_total_requests: 1,
    network_request_count: 0,
    approved_exact_endpoint: approval.authorization.endpoint,
    authorization: approval.authorization
  });

  const result = await runGuizhouNoticeObservationCanary(
    approval,
    new OneEndpointOneRunGuizhouNoticeTransport(globalThis.fetch.bind(globalThis)),
    new Date().toISOString() as IsoDateTime
  );
  if (result.raw_blob) {
    await writeFile(path.join(outputDirectory, "raw.html"), result.raw_blob.bytes);
  }
  await writeJson(path.join(outputDirectory, "snapshot.json"), result.snapshot);
  await writeJson(
    path.join(outputDirectory, "observation-evidence.json"),
    result.observation_evidence
  );
  await writeJson(
    path.join(outputDirectory, "attachment-locators.json"),
    result.attachment_locators
  );

  const report = {
    status: result.access_classification,
    output_directory: outputDirectory,
    authorization_id: approval.authorization.authorization_id,
    collection_run_id: approval.authorization.collection_run_id,
    authorization_evidence_id: approval.evidence.evidence_id,
    evidence_id: result.observation_evidence.evidence_id,
    request_url: result.request.locator,
    final_url: result.transport.final_url,
    redirect_observed: result.transport.redirect_chain.length > 0,
    redirect_chain: result.transport.redirect_chain,
    http_status: result.transport.response.http_status,
    content_type: result.transport.response_content_type,
    content_length: result.transport.declared_content_length,
    response_bytes: result.transport.response_size,
    network_request_count: result.transport.request_count,
    request_headers: result.request.headers,
    request_cookie_sent: result.transport.access_signals.request_cookie_sent,
    request_authorization_sent:
      result.transport.access_signals.request_authorization_sent,
    response_headers: result.transport.response.headers,
    access_signals: result.transport.access_signals,
    robots: approval.admission.robots.status,
    terms: approval.admission.terms.status,
    admission: {
      admission_level: approval.admission.admission_level,
      admission_decision: approval.admission.admission_decision,
      automation_basis: approval.admission.automation_basis,
      observation_does_not_upgrade_admission: true
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
    content_safety: result.content_safety,
    attachment_locators: result.attachment_locators,
    attachment_endpoint_created: false,
    attachment_requested: false,
    authorization_replay_decision: result.authorization_replay_decision,
    error: result.transport.response.status === "FAILED"
      ? result.transport.response.error
      : null
  };
  await writeJson(path.join(outputDirectory, "canary-report.json"), report);
  await writeJson(executionRecord, {
    status: result.access_classification,
    started_at: issuedAt,
    completed_at: new Date().toISOString(),
    maximum_total_requests: 1,
    network_request_count: result.transport.request_count,
    accessed_urls: [result.request.locator],
    report
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, jsonReplacer, 2)}\n`, "utf8");
}

function jsonReplacer(_key: string, value: unknown) {
  if (value instanceof Uint8Array) return `[${value.byteLength} raw bytes omitted]`;
  if (value instanceof Map || value instanceof Set) return undefined;
  return value;
}
