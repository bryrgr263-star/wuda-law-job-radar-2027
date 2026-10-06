import "../helpers/network-guard";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { InMemoryRawBlobRepository, InMemorySnapshotRepository, RawCaptureService } from "../../lib/ingestion";
import { assertOfficialRequestAllowed, assertSourcePersistenceVersion } from "../../lib/production-persistence/contracts";
import { resolveContinuousSourceContext } from "../../lib/production-persistence/continuous-source-context";
import { InMemorySourceAdmissionRegister } from "../../lib/application/source-admission";
import { CHNENERGY_JOBS, Chnenergy2027HtmlAdapter, createChnenergy2027SourceVersions, chnenergyEndpoint, chnenergyAllowlistId, chnenergyAdmissionId } from "../../lib/production-sources/chnenergy-2027-source";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { bootstrapZeroCostProductionCompositionRoot } from "../../lib/production-persistence/zero-cost-production-composition-root";
import { canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";

const at = "2026-10-06T07:00:00.000Z";
const provenance = { scope: "PRODUCTION" as const, actor_id: "offline-source-test", actor_role: "TEST_ONLY", evidence_references: ["fixture:chnenergy"] };

export function chnenergyHtml(index = 0) {
  const job = CHNENERGY_JOBS[index]!;
  return `<title>岗位详情</title><h3>${job.title}</h3><h5>${job.employer}</h5>
<button onclick="apply('${job.id}','e929662a-324a-47d0-b4ca-9fe5ef47b8ba')">申请</button>
<div><h4 class="listTitle">岗位基本信息</h4></div><ul><li>招聘单位：${job.employer}</li><li>招聘岗位：${job.title}</li><li>工作地点：${job.location}</li></ul>
<div><h4 class="listTitle">岗位职责</h4></div><ol><li><div id="descDetail">负责法务、合规和合同管理工作。</div></li></ol>
<div><h4 class="listTitle">岗位要求</h4></div><ul><li>学历要求：${index ? "大学本科" : "硕士研究生"}</li><li>专业要求：法学,法律,法学类相关专业</li></ul>`;
}

async function extract(html: string, index = 0) {
  const endpoint = chnenergyEndpoint(CHNENERGY_JOBS[index]!);
  const bytes = new TextEncoder().encode(html);
  const capture = new RawCaptureService(new InMemoryRawBlobRepository(), new InMemorySnapshotRepository());
  const captured = capture.record({ recruitment_endpoint_id: endpoint.recruitment_endpoint_id, locator: endpoint.locator,
    requested_at: at as never, method: "GET", headers: {}, parameters: {} }, { status: "SUCCESS", responded_at: at as never,
    bytes, mime_type: "text/html;charset=UTF-8", http_status: 200, headers: {}, content_sha256: createHash("sha256").update(bytes).digest("hex") as never });
  return new Chnenergy2027HtmlAdapter().extract({ endpoint, snapshot: captured.snapshot, raw_blob: captured.raw_blob });
}

test("two reviewed exact query targets retain finite authorization and 86400-second cadence", () => {
  const versions = createChnenergy2027SourceVersions({ observed_at: at, provenance });
  versions.forEach(assertSourcePersistenceVersion);
  const targets = versions.filter(version => version.artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST");
  assert.equal(targets.length, 2);
  for (const version of targets) {
    if (version.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST") assert.fail();
    const target = version.artifact.payload;
    const context = resolveContinuousSourceContext(versions, target.allowlist_entry_id);
    assert.equal(context.admission.continuous_acquisition_scope!.min_interval_seconds, 86400);
    assert.equal(context.admission.continuous_acquisition_scope!.exact_targets.length, 1);
    const owner = new InMemorySourceAdmissionRegister(); owner.register(context.admission);
    const grant = owner.issueContinuousAuthorization(context, { effective_from: at, min_interval_seconds: 86400, actor: "offline-reviewer", issued_at: at });
    assert.equal(grant.payload.grant!.canonical_payload.exact_endpoint, context.endpoint.locator);
    assertOfficialRequestAllowed(target, context.endpoint.locator, "GET");
    assert.throws(() => assertOfficialRequestAllowed(target, context.endpoint.locator + "&page=2", "GET"));
    assert.throws(() => assertOfficialRequestAllowed(target, context.endpoint.locator.replace(/id=.*/, "id=unapproved"), "GET"));
  }
});

test("official project identity binds two positions to reviewed 2027 campaign without promoting duties to requirements", async () => {
  for (let index = 0; index < 2; index++) {
    const records = await extract(chnenergyHtml(index), index);
    assert.equal(records.length, 2);
    const position = records.find(record => record.recruitment_context)!;
    assert.equal(position.raw_title?.text, CHNENERGY_JOBS[index]!.title);
    assert.equal(position.raw_organization_name?.text, CHNENERGY_JOBS[index]!.employer);
    assert.equal(position.recruitment_year?.text, "2027");
    assert.match(position.raw_description!.text, /合同/);
    assert.doesNotMatch(position.raw_requirement_text!.text, /合同管理工作/);
    assert.equal(position.application_url, CHNENERGY_JOBS[index]!.url);
    assert.equal(position.announcement_url, CHNENERGY_JOBS[index]!.url);
    assert.ok(JSON.stringify(position.adapter_metadata).includes(CHNENERGY_JOBS[index]!.membership_url));
  }
});

test("batch or employer mismatch fails closed; additional true requirements are preserved", async () => {
  await assert.rejects(extract(chnenergyHtml().replaceAll("e929662a-324a-47d0-b4ca-9fe5ef47b8ba", "unknown-project")), /BINDING/);
  await assert.rejects(extract(chnenergyHtml().replaceAll(CHNENERGY_JOBS[0]!.employer, "其他单位")), /BINDING/);
  const records = await extract(chnenergyHtml().replace("<li>专业要求：", "<li>身体健康</li><li>专业要求："));
  assert.ok(records.some(record => record.raw_requirement_text?.text.includes("身体健康")));
});

test("existing production entry materializes two distinct reviewed positions and fresh Process B preserves their safe stops", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "chnenergy-entry-test-"));
  const remote = path.join(directory, "remote.git"); const seed = path.join(directory, "seed");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(directory, "init", "--quiet", "--bare", remote); git(directory, "init", "--quiet", "-b", "main", seed);
  writeFileSync(path.join(seed, "README.md"), "TEST_ONLY fixture; not production evidence\n");
  const identity = { name: "Controlled Source Test", email: "controlled@invalid.local" };
  const commit = (message: string) => git(seed, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", message);
  git(seed, "add", "README.md"); commit("Controlled seed"); git(seed, "remote", "add", "origin", remote);
  const store = new GitSourceRegistryPersistence({ repository_path: seed });
  for (const version of createChnenergy2027SourceVersions({ observed_at: at, provenance, scope: "CONTROLLED_TEST" })) await store.appendVersion(version);
  git(seed, "add", "production-source-state"); commit("Controlled source records"); git(seed, "push", "origin", "HEAD:main");
  const options = { remote_url: remote, branch: "main", stream_id: "controlled-chnenergy", execution_mode: "TEST_ONLY" as const,
    continuous_scope: "CONTROLLED_TEST" as const, now: () => at, commit_identity: identity,
    controlled_continuous_transport: { async execute(request: { locator: string }) {
      const index = CHNENERGY_JOBS.findIndex(job => job.url === request.locator); assert.ok(index >= 0);
      const bytes = new TextEncoder().encode(chnenergyHtml(index));
      return { status: "SUCCESS" as const, responded_at: at as never, bytes,
        content_sha256: createHash("sha256").update(bytes).digest("hex") as never, mime_type: "text/html;charset=UTF-8", http_status: 200, headers: {} };
    } } };
  const root = bootstrapZeroCostProductionCompositionRoot(options);
  for (const [index, job] of CHNENERGY_JOBS.entries()) {
    const issued = await root.issueContinuousAuthorization({ allowlist_entry_id: chnenergyAllowlistId(job), effective_from: at, min_interval_seconds: 86400, actor: "controlled-test" });
    const result = await root.runProduction({ run_id: `controlled-chnenergy-${index}`, source_versions: [],
      source_admission_id: chnenergyAdmissionId(job), recruitment_endpoint_id: chnenergyEndpoint(job).recruitment_endpoint_id,
      adapter: new Chnenergy2027HtmlAdapter(), continuous_authorization_ids: [issued.record.payload.grant!.authorization_id],
      provenance, actor: "controlled-test", started_at: at, transport: { async execute() { throw new Error("CALLER_TRANSPORT_DENIED"); } } });
    assert.equal(result.status, "COMMITTED", result.error ?? JSON.stringify(result));
  }
  const restored = await root.restore();
  assert.equal(restored.read_models.length, 2);
  assert.equal(new Set(restored.read_models.map(model => model.position_id)).size, 2);
  assert.ok(restored.presentation_decisions.every(decision => decision.status === "EVIDENCE_BLOCKED"));
  assert.ok(!canonicalSerialize(restored.presentation_decisions).includes("RELEVANCE_ASSESSMENT_MISSING"));
  const expected = path.join(directory, "expected.json"); writeFileSync(expected, canonicalSerialize(restored));
  const childPath = path.join(directory, "fresh.ts");
  writeFileSync(childPath, `import ${JSON.stringify(path.resolve("tests/helpers/network-guard.ts"))};
import {readFileSync} from 'node:fs'; import assert from 'node:assert/strict';
import {bootstrapZeroCostProductionCompositionRoot} from ${JSON.stringify(path.resolve("lib/production-persistence/zero-cost-production-composition-root.ts"))};
import {canonicalSerialize} from ${JSON.stringify(path.resolve("lib/ingestion/normalization/canonical-artifact-registry.ts"))};
(async()=>{const state=await bootstrapZeroCostProductionCompositionRoot({remote_url:process.argv[2]!,branch:'main',stream_id:'controlled-chnenergy',execution_mode:'TEST_ONLY',continuous_scope:'CONTROLLED_TEST'}).restore();assert.equal(canonicalSerialize(state),readFileSync(process.argv[3]!,'utf8'));})().catch(error=>{console.error(error);process.exitCode=1});`);
  const child = spawnSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), childPath, remote, expected], { cwd: process.cwd(), encoding: "utf8", timeout: 240000 });
  assert.equal(child.status, 0, child.error?.message ?? child.stderr);
});
