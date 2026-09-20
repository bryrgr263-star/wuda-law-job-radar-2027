import "../helpers/network-guard";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluateSourceAutomationPermission } from "../../lib/application";
import type { HttpTransportRequest } from "../../lib/collection-runtime";
import {
  InMemoryRawBlobRepository,
  InMemorySnapshotRepository,
  RawCaptureService,
  type IsoDateTime,
  type RawContentSha256,
  type TransportRequest
} from "../../lib/ingestion";
import {
  HAIER_2027_LEGAL_URL,
  HAIER_2027_PACKAGE_RECORD_ID,
  HAIER_2027_POSITION_RECORD_ID,
  HAIER_2027_RECRUITMENT_ENDPOINT_ID,
  HAIER_2027_SOURCE_ADMISSION_ID,
  HAIER_2027_TIMEOUT_MS,
  Haier2027ApprovedOfficialTransport,
  Haier2027LegalOfficialHtmlAdapter,
  assertHaier2027ApprovedRequest,
  createHaier2027RecruitmentEndpoint,
  createHaier2027SourceAdmission,
  createHaier2027SourceVersions,
  createHaier2027TrustedRun,
  haierSourceRole
} from "../../lib/live-canary/real-2027-haier";
import {
  assertOfficialRequestAllowed,
  assertSourcePersistenceVersion,
  bootstrapZeroCostProductionCompositionRoot
} from "../../lib/production-persistence";

const now = "2026-09-17T04:00:00.000Z" as IsoDateTime;
const provenance = {
  scope: "PRODUCTION" as const,
  actor_id: "real-2027-haier-source-test",
  actor_role: "TEST",
  evidence_references: ["test:real-2027-haier-source-contract"]
};

test("Haier admission and allowlist authorize only the exact approved URL", () => {
  const admission = createHaier2027SourceAdmission(now);
  const versions = createHaier2027SourceVersions({ observed_at: now, provenance });
  versions.forEach(assertSourcePersistenceVersion);
  assert.deepEqual(evaluateSourceAutomationPermission(admission), {
    allowed: true,
    admission_level: "B",
    mode: "ONE_ENDPOINT_ONE_RUN",
    requires_manual_authorization: true
  });
  const allowlist = versions.find((version) => {
    return version.artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST";
  });
  if (!allowlist || allowlist.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST") {
    assert.fail("Haier allowlist version is missing");
  }
  const allowlistPayload = allowlist.artifact.payload;
  assert.doesNotThrow(() => assertOfficialRequestAllowed(
    allowlistPayload,
    HAIER_2027_LEGAL_URL,
    "GET"
  ));
  for (const disallowed of [
    "https://maker.haier.net/client/campus/activityindex.html",
    "https://maker.haier.net/client/campus/customizedptjobdetail/sid/64/rid/62",
    `${HAIER_2027_LEGAL_URL}?from=test`
  ]) {
    assert.throws(() => assertOfficialRequestAllowed(
      allowlistPayload,
      disallowed,
      "GET"
    ));
  }
});

test("approved transport performs one credential-free exact request", async () => {
  const observed: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
  const transport = new Haier2027ApprovedOfficialTransport(async (input, init) => {
    observed.push({ url: String(input), init });
    return htmlResponse(sourceHtml(), HAIER_2027_LEGAL_URL);
  }, { now: () => now });
  const response = await transport.execute(request());
  assert.equal(response.status, "SUCCESS");
  assert.equal(observed.length, 1);
  assert.equal(observed[0]?.url, HAIER_2027_LEGAL_URL);
  assert.equal(observed[0]?.init?.redirect, "manual");
  assert.equal(observed[0]?.init?.credentials, "omit");
  assert.equal(new Headers(observed[0]?.init?.headers).has("cookie"), false);
  assert.equal(new Headers(observed[0]?.init?.headers).has("authorization"), false);
  await assert.rejects(transport.execute(request()));
  assert.throws(() => assertHaier2027ApprovedRequest({
    ...request(),
    locator: "https://maker.haier.net/client/campus/activityindex.html"
  }));
});

test("adapter emits one package and one position without mixing duties into requirements", () => {
  const records = extractFixture();
  assert.deepEqual(records.map((record) => record.raw_source_record_id), [
    HAIER_2027_PACKAGE_RECORD_ID,
    HAIER_2027_POSITION_RECORD_ID
  ]);
  assert.deepEqual(records.map(haierSourceRole), ["PACKAGE", "POSITION_BEARING"]);
  const position = records[1]!;
  assert.equal(position.raw_title?.text, "法务");
  assert.deepEqual(position.raw_location_text.map((item) => item.text), [
    "上海市", "青岛市"
  ]);
  assert.equal(position.recruitment_year?.text, "2027");
  assert.equal(position.raw_requirement_text?.text.split("\n").length, 7);
  assert.match(position.raw_requirement_text?.text ?? "", /2027届应届毕业生/u);
  assert.match(position.raw_requirement_text?.text ?? "", /法律职业资格/u);
  assert.doesNotMatch(position.raw_requirement_text?.text ?? "", /拟订相应合同文本/u);
  assert.match(position.raw_description?.text ?? "", /拟订相应合同文本/u);
});

test("existing production root safely blocks unsupported Haier requirements and restores", async () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "haier-2027-e2e-test-"));
  const remotePath = path.join(temporaryRoot, "authoritative.git");
  try {
    initializeRemote(temporaryRoot, remotePath);
    const trustedRun = createHaier2027TrustedRun(now);
    const root = bootstrapZeroCostProductionCompositionRoot({
      execution_mode: "CANARY",
      remote_url: remotePath,
      branch: "main",
      stream_id: "test-real-2027-haier-trusted-chain",
      commit_identity: {
        name: "Haier 2027 Canary Test",
        email: "haier-2027-test@invalid.local"
      },
      now: () => now
    });
    const processA = await root.run({
      run_id: "test-real-2027-haier",
      source_versions: createHaier2027SourceVersions({
        observed_at: now,
        provenance
      }),
      source_admission_id: HAIER_2027_SOURCE_ADMISSION_ID,
      recruitment_endpoint_id: HAIER_2027_RECRUITMENT_ENDPOINT_ID,
      adapter: new Haier2027LegalOfficialHtmlAdapter(),
      transport: new Haier2027ApprovedOfficialTransport(async () => {
        return htmlResponse(sourceHtml(), HAIER_2027_LEGAL_URL);
      }, { now: () => now }),
      provenance,
      actor: "real-2027-haier-canary-test",
      started_at: now,
      execute_trusted_chain: async (context) => trustedRun.execute({ ...context,
        execute: async (command) => {
          if (command.kind !== "PRESENTATION_DECIDE") return context.execute(command);
          const relevance = command.input.relevance_assessment_id ? context.resolvers.relevance.resolve(command.input.relevance_assessment_id as never) : null;
          const head = relevance ? context.resolvers.presentation_decisions.resolvePositionCurrent("PRODUCTION", relevance.position_id) : null;
          const result = await context.execute({ ...command, input: { ...command.input, contract_version: "presentation-decision/2.0.0",
            expected_current_presentation_decision_id: head?.presentation_decision_id ?? null } });
          assert.ok(result && typeof result === "object" && "decision" in result, JSON.stringify(result));
          return result;
        }
      }),
      source_role_for_record: haierSourceRole
    });
    assert.equal(processA.status, "COMMITTED", JSON.stringify(processA, null, 2));
    assert.ok(processA.committed_head);
    assert.equal(processA.raw_blob_ids.length, 1);
    assert.equal(processA.snapshot_ids.length, 1);
    assert.equal(processA.extracted_record_ids.length, 2);

    const trusted = trustedRun.report();
    assert.equal(trusted.candidate_evidence_provenance, "CANDIDATE_ASSERTED");
    assert.equal(trusted.positions.length, 1);
    const position = trusted.positions[0]!;
    assert.equal(position.source_composition_status, "COMPLETE");
    assert.equal(position.relevance_state, "RELEVANT");
    assert.equal(position.raw_requirement_clause_count, 7);
    assert.equal(position.requirement_completeness, "REVIEW_REQUIRED");
    assert.equal(position.predicate_resolution_execution_status, "BLOCKED");
    assert.equal(position.eligibility_execution_status, "NOT_ALLOWED");
    assert.equal(position.eligibility_assessment_id, null);
    assert.equal(position.eligibility_result, null);
    assert.equal(position.presentation_status, "EVIDENCE_BLOCKED");

    const processB = await root.restore();
    assert.equal(processB.committed_head, processA.committed_head);
    assert.equal(processB.acquisition_count, 1);
    assert.equal(processB.runs.length, 1);
    assert.equal(processB.presentation_decisions.length, 1);
    assert.equal(processB.read_models.length, 1);
    assert.equal(
      processB.presentation_decisions[0]?.presentation_decision_id,
      position.presentation_decision_id
    );
    assert.equal(
      processB.read_models[0]?.presentation_read_model_id,
      position.presentation_read_model_id
    );
    assert.equal(processB.read_models[0]?.presentation_status, "EVIDENCE_BLOCKED");
    const restoredSealIds = new Set(processB.artifact_seals.map((seal) => {
      return seal.artifact_id;
    }));
    for (const artifactId of [
      trusted.candidate_evidence_manifest_id,
      ...trusted.candidate_evidence_ids,
      position.opportunity_candidate_id,
      position.recall_disposition_id,
      position.position_version_id,
      position.opportunity_version_id,
      position.source_composition_id,
      position.relevance_assessment_id,
      position.requirement_projection_id,
      position.requirement_set_version_id,
      position.presentation_decision_id,
      position.presentation_read_model_id
    ]) {
      assert.equal(restoredSealIds.has(artifactId), true, artifactId);
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

function extractFixture() {
  const endpoint = createHaier2027RecruitmentEndpoint();
  const raw = new InMemoryRawBlobRepository();
  const snapshots = new InMemorySnapshotRepository();
  const capture = new RawCaptureService(raw, snapshots, {
    create_snapshot_id: () => "snapshot-haier-2027-test" as never
  });
  const bytes = new TextEncoder().encode(sourceHtml());
  const requestValue: TransportRequest = {
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
    locator: HAIER_2027_LEGAL_URL,
    method: "GET",
    requested_at: now,
    headers: {},
    parameters: {}
  };
  const captured = capture.record(requestValue, {
    status: "SUCCESS",
    responded_at: now,
    bytes,
    content_sha256: createHash("sha256").update(bytes).digest("hex") as
      RawContentSha256,
    mime_type: "text/html; charset=utf-8",
    http_status: 200,
    headers: {}
  });
  return new Haier2027LegalOfficialHtmlAdapter().extract({
    endpoint,
    ...captured
  });
}

function request(): HttpTransportRequest {
  return {
    recruitment_endpoint_id: HAIER_2027_RECRUITMENT_ENDPOINT_ID,
    locator: HAIER_2027_LEGAL_URL,
    method: "GET",
    requested_at: now,
    headers: {},
    parameters: {},
    timeout_ms: HAIER_2027_TIMEOUT_MS
  };
}

function htmlResponse(body: string, url: string) {
  const bytes = new TextEncoder().encode(body);
  const response = new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-length": String(bytes.byteLength)
    }
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function sourceHtml() {
  return `<!doctype html><html><head><title>海尔招聘-海尔官方招聘网站</title></head>
  <body><div class="campus_joblist_wrap joblist_detail_wrap"><div class="detail_cnt">
  <div class="job_name">法务</div><div class="job_intro">上海市 青岛市 | 职能类</div>
  <div class="job_subtitle">职位描述</div><div>
  1、根据业务实际需要，拟订相应合同文本；<br />
  2、负责部门文档管理；<br />
  3、参与项目相关的日常沟通联络；<br />
  4、负责处理诉讼纠纷；<br />
  5、对各部门进行法律培训。
  </div><div class="job_subtitle">职位要求</div><div>
  一、基础要求：<br />
  1、2027届应届毕业生，本科及以上学历，英语六级及以上；<br />
  2、法律等相关专业；<br />
  二、技能要求：<br />
  1、有法律职业资格，精通民法、民事诉讼法、劳动法及劳动仲裁相关法规；<br />
  2、熟悉常用OFFICE办公软件；<br />
  3、对英语熟悉，看懂英语文件；<br />
  三、素质要求：<br />
  1、性格外向、善于沟通、执行力强，表达能力好；<br />
  2、身体健康，品行端正，无任何不良行为记录或诚信记录。
  </div></div></div></body></html>`;
}

function initializeRemote(temporaryRoot: string, remotePath: string) {
  const seed = path.join(temporaryRoot, "seed");
  git(temporaryRoot, "init", "--bare", remotePath);
  git(temporaryRoot, "init", "-b", "main", seed);
  git(seed, "config", "user.name", "Haier 2027 Canary Test");
  git(seed, "config", "user.email", "haier-2027-test@invalid.local");
  mkdirSync(path.join(seed, "bootstrap"), { recursive: true });
  writeFileSync(path.join(seed, "bootstrap", "initial.json"), "{}\n", "utf8");
  git(seed, "add", "bootstrap/initial.json");
  git(seed, "commit", "-m", "Initialize test repository");
  git(seed, "remote", "add", "origin", remotePath);
  git(seed, "push", "-u", "origin", "main");
}

function git(workingDirectory: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd: workingDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}
