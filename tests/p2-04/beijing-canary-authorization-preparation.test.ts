import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BEIJING_CANARY_AUTHORIZATION_PREPARATION,
  BEIJING_CANARY_PREPARATION_BLOCKERS,
  BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT,
  BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID,
  BEIJING_PUBLIC_INSTITUTION_SOURCE_ADMISSION_ID,
  inspectBeijingCanaryAuthorizationPreparation,
  PENDING_HUMAN_APPROVAL
} from "../../lib/live-canary/p2-04/beijing-canary-authorization-preparation";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Beijing candidate remains Level B and REVIEW", () => {
  const source = BEIJING_CANARY_AUTHORIZATION_PREPARATION.source;
  assert.equal(source.admission_level, "B");
  assert.equal(source.admission_decision, "REVIEW");
  assert.equal(source.robots, "ALLOWED");
  assert.equal(source.terms, "UNKNOWN");
  assert.equal(source.login_requirement, "NONE_OBSERVED");
  assert.equal(source.captcha, "NONE_OBSERVED");
});

test("authorization and execution preparations share the exact one-endpoint binding", () => {
  const { authorization, execution } = BEIJING_CANARY_AUTHORIZATION_PREPARATION;
  assert.equal(authorization.source_admission_id, BEIJING_PUBLIC_INSTITUTION_SOURCE_ADMISSION_ID);
  assert.equal(execution.source_admission_id, BEIJING_PUBLIC_INSTITUTION_SOURCE_ADMISSION_ID);
  assert.equal(authorization.endpoint, BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT);
  assert.equal(execution.endpoint, BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT);
  assert.equal(
    authorization.recruitment_endpoint_id,
    BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID
  );
  assert.equal(execution.recruitment_endpoint_id, authorization.recruitment_endpoint_id);
  assert.equal(authorization.endpoint_purpose, "JOB_LIST");
  assert.equal(execution.endpoint_purpose, "JOB_LIST");
  assert.equal(authorization.allowed_http_method, "GET");
  assert.equal(execution.allowed_http_method, "GET");
  assert.equal(authorization.scope, "ONE_ENDPOINT_ONE_RUN");
});

test("human-controlled authorization fields remain pending rather than fabricated", () => {
  const { authorization, execution } = BEIJING_CANARY_AUTHORIZATION_PREPARATION;
  assert.equal(authorization.authorization_id, null);
  assert.equal(authorization.collection_run_id, null);
  assert.equal(authorization.reviewer, null);
  assert.equal(authorization.issued_at, null);
  assert.equal(authorization.evidence_id, null);
  assert.equal(authorization.manual_confirmation, false);
  assert.equal(authorization.approval_status, PENDING_HUMAN_APPROVAL);
  assert.equal(execution.collection_run_id, null);
  assert.equal(execution.recruitment_endpoint, null);
  assert.equal(execution.execution_status, PENDING_HUMAN_APPROVAL);
});

test("static inspection confirms contract shape but refuses executable readiness", () => {
  assert.deepEqual(inspectBeijingCanaryAuthorizationPreparation(), {
    authorization_contract_representable: true,
    executable: false,
    approval_status: PENDING_HUMAN_APPROVAL,
    blockers: BEIJING_CANARY_PREPARATION_BLOCKERS
  });
  assert.ok(BEIJING_CANARY_PREPARATION_BLOCKERS.includes("ADMISSION_REMAINS_REVIEW"));
  assert.ok(BEIJING_CANARY_PREPARATION_BLOCKERS.includes("HUMAN_APPROVAL_PENDING"));
  assert.ok(BEIJING_CANARY_PREPARATION_BLOCKERS.includes("COLLECTION_RUN_ID_PENDING"));
});

test("the NTSC Adapter is not reassigned to the Beijing endpoint", () => {
  const adapter = BEIJING_CANARY_AUTHORIZATION_PREPARATION.adapter;
  assert.equal(adapter.existing_adapter_key, "cn-cas-ntsc-official-html");
  assert.equal(adapter.usable_for_beijing, false);
  assert.equal(
    adapter.required_action,
    "北京来源需要单独的官方 HTML Adapter / selector confirmation，待真实 Canary 后处理。"
  );
});

test("authorization preparation has no network or collection execution capability", () => {
  const sourcePath = path.join(
    repositoryRoot,
    "lib",
    "live-canary",
    "p2-04",
    "beijing-canary-authorization-preparation.ts"
  );
  const source = readFileSync(sourcePath, "utf8");
  assert.doesNotMatch(source, /from\s+["']node:(?:http|https|net|tls|dns)["']/u);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /LocalHttpTransport|CollectionRunner|createCollectionRun/u);
});
