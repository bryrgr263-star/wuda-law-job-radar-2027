import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { IsoDateTime } from "../../ingestion";
import {
  OneEndpointOneRunShenzhenObservationTransport,
  createShenzhenLegalObservationApproval,
  runShenzhenLegalObservationCanary,
  type ShenzhenLegalObservationApprovalBundle,
  type ShenzhenLegalObservationCanaryResult
} from "./shenzhen-bankruptcy-observation-canary";

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const outputRoot = path.resolve("outputs", "real-legal-canary");
  const executionRecord = path.join(outputRoot, "observation-canary-execution.json");
  await mkdir(outputRoot, { recursive: true });
  if (await exists(executionRecord)) {
    throw new Error(
      "Observation Canary execution record already exists; refusing any additional network request"
    );
  }

  const issuedAt = new Date().toISOString() as IsoDateTime;
  const noticeApproval = createShenzhenLegalObservationApproval("NOTICE", issuedAt);
  const pdfApproval = createShenzhenLegalObservationApproval("POSITION_TABLE_PDF", issuedAt);
  await writeJson(executionRecord, {
    status: "STARTED",
    started_at: issuedAt,
    maximum_total_requests: 2,
    network_request_count: 0,
    approved_exact_endpoints: [
      noticeApproval.authorization.endpoint,
      pdfApproval.authorization.endpoint
    ],
    authorizations: [
      noticeApproval.authorization,
      pdfApproval.authorization
    ]
  });
  await persistAuthorization(outputRoot, noticeApproval);
  await persistAuthorization(outputRoot, pdfApproval);

  const notice = await runShenzhenLegalObservationCanary(
    noticeApproval,
    new OneEndpointOneRunShenzhenObservationTransport(
      "NOTICE",
      globalThis.fetch.bind(globalThis)
    ),
    new Date().toISOString() as IsoDateTime
  );
  await persistResult(outputRoot, notice);
  await writeExecutionRecord(executionRecord, issuedAt, [notice]);
  if (notice.access_classification !== "EVIDENCE_CAPTURED") {
    process.stdout.write(`${JSON.stringify(summary([notice]), null, 2)}\n`);
    return;
  }

  const pdf = await runShenzhenLegalObservationCanary(
    pdfApproval,
    new OneEndpointOneRunShenzhenObservationTransport(
      "POSITION_TABLE_PDF",
      globalThis.fetch.bind(globalThis)
    ),
    new Date().toISOString() as IsoDateTime
  );
  await persistResult(outputRoot, pdf);
  await writeExecutionRecord(executionRecord, issuedAt, [notice, pdf]);
  process.stdout.write(`${JSON.stringify(summary([notice, pdf]), null, 2)}\n`);
}

async function persistAuthorization(
  outputRoot: string,
  approval: ShenzhenLegalObservationApprovalBundle
) {
  const outputDirectory = endpointDirectory(outputRoot, approval);
  await mkdir(outputDirectory, { recursive: true });
  await writeJson(path.join(outputDirectory, "authorization.json"), {
    authorization: approval.authorization,
    authorization_evidence: approval.evidence,
    admission: admissionSummary(approval),
    endpoint: approval.recruitment_endpoint,
    execution: approval.execution,
    authorization_decision: approval.authorization_decision
  });
}

async function persistResult(
  outputRoot: string,
  result: ShenzhenLegalObservationCanaryResult
) {
  const outputDirectory = endpointDirectory(outputRoot, result.approval);
  if (result.raw_blob) {
    const extension = result.approval.kind === "NOTICE" ? "html" : "pdf";
    await writeFile(path.join(outputDirectory, `raw.${extension}`), result.raw_blob.bytes);
  }
  await writeJson(path.join(outputDirectory, "snapshot.json"), result.snapshot);
  await writeJson(
    path.join(outputDirectory, "observation-evidence.json"),
    result.observation_evidence
  );
  await writeJson(path.join(outputDirectory, "canary-report.json"), resultReport(result));
}

async function writeExecutionRecord(
  executionRecord: string,
  startedAt: IsoDateTime,
  results: readonly ShenzhenLegalObservationCanaryResult[]
) {
  await writeJson(executionRecord, {
    status: results.every((item) => item.access_classification === "EVIDENCE_CAPTURED")
      && results.length === 2
      ? "EVIDENCE_CAPTURED"
      : "PAUSED_REVIEW_REQUIRED",
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    maximum_total_requests: 2,
    network_request_count: results.reduce(
      (count, item) => count + item.transport.request_count,
      0
    ),
    accessed_urls: results.map((item) => item.request.locator),
    results: results.map(resultReport)
  });
}

function resultReport(result: ShenzhenLegalObservationCanaryResult) {
  return {
    kind: result.approval.kind,
    authorization_id: result.approval.authorization.authorization_id,
    collection_run_id: result.approval.authorization.collection_run_id,
    authorization_evidence_id: result.approval.evidence.evidence_id,
    observation_evidence: result.observation_evidence,
    admission: admissionSummary(result.approval),
    network: {
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
          created_at: result.raw_blob.created_at
        }
      : null,
    snapshot: result.snapshot,
    content_safety: result.content_safety,
    access_classification: result.access_classification,
    authorization_replay_decision: result.authorization_replay_decision
  };
}

function summary(results: readonly ShenzhenLegalObservationCanaryResult[]) {
  return {
    status: results.length === 2
      && results.every((item) => item.access_classification === "EVIDENCE_CAPTURED")
      ? "TWO_ENDPOINT_EVIDENCE_CAPTURED"
      : "PAUSED_REVIEW_REQUIRED",
    network_request_count: results.reduce(
      (count, item) => count + item.transport.request_count,
      0
    ),
    accessed_urls: results.map((item) => item.request.locator),
    results: results.map(resultReport)
  };
}

function endpointDirectory(
  outputRoot: string,
  approval: ShenzhenLegalObservationApprovalBundle
) {
  return path.join(
    outputRoot,
    approval.authorization.collection_run_id.replace(/[^a-zA-Z0-9._-]/gu, "-")
  );
}

function admissionSummary(approval: ShenzhenLegalObservationApprovalBundle) {
  return {
    source_admission_id: approval.admission.source_admission_id,
    admission_level: approval.admission.admission_level,
    admission_decision: approval.admission.admission_decision,
    automation_basis: approval.admission.automation_basis,
    endpoint_purpose: approval.admission.endpoint_purpose,
    login_requirement: approval.admission.login_requirement,
    captcha: approval.admission.captcha,
    robots: approval.admission.robots.status,
    terms: approval.admission.terms.status
  };
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
