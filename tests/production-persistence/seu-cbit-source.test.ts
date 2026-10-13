import "../helpers/network-guard";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { InMemoryRawBlobRepository, InMemorySnapshotRepository, RawCaptureService } from "../../lib/ingestion";
import { InMemorySourceAdmissionRegister } from "../../lib/application/source-admission";
import { resolveContinuousSourceContext } from "../../lib/production-persistence/continuous-source-context";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { bootstrapZeroCostProductionCompositionRoot } from "../../lib/production-persistence/zero-cost-production-composition-root";
import { canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { SeuCbit2027HtmlAdapter, createSeuCbit2027SourceVersions, seuCbitEndpoint, SEU_CBIT_URL } from "../../lib/production-sources/seu-cbit-2027-source";

const observedAt = "2026-10-12T06:00:00.000Z";
const provenance = { scope: "PRODUCTION" as const, actor_id: "controlled-university-test", actor_role: "TEST_ONLY", evidence_references: ["fixture:university-publication"] };
export function universityHtml() {
  return `<h1 class="arti_title">中国银行保险信息技术管理有限公司2027年度校园招聘</h1>
  <div class="wp_articlecontent"><p>中国银行保险信息技术管理有限公司2027年度校园招聘公告</p>
  <p>（四）银保信科技（北京）有限公司</p><table><tr><td>序号</td><td>专业类别</td><td>招聘岗位</td><td>专业需求</td><td>招聘人数</td><td>工作地点</td></tr>
  <tr><td>2</td><td>法学类</td><td>法务岗</td><td>法学类专业及相关专业</td><td>若干</td><td>北京</td></tr></table>
  <p>三、招聘条件</p><p>境内外高等院校硕士研究生及以上学历应届毕业生；分子公司对于条件特别优秀者，学历可适当放宽至本科。</p>
  <p>境内高校毕业生应在2027年7月前毕业且毕业证、学位证齐全。</p><p>六、注意事项</p><p>招聘咨询邮箱不接收简历。</p></div>`;
}
async function extract(html: string) {
  const endpoint = seuCbitEndpoint();
  const bytes = new TextEncoder().encode(html);
  const capture = new RawCaptureService(new InMemoryRawBlobRepository(), new InMemorySnapshotRepository());
  const result = capture.record({ recruitment_endpoint_id: endpoint.recruitment_endpoint_id, locator: endpoint.locator,
    requested_at: observedAt as never, method: "GET", headers: {}, parameters: {} },
  { status: "SUCCESS", responded_at: observedAt as never, bytes, mime_type: "text/html;charset=UTF-8", http_status: 200,
    headers: {}, content_sha256: createHash("sha256").update(bytes).digest("hex") as never });
  return new SeuCbit2027HtmlAdapter().extract({ endpoint, snapshot: result.snapshot, raw_blob: result.raw_blob });
}
test("university publisher and employing company remain separate in exact admission", () => {
  const versions = createSeuCbit2027SourceVersions({ observed_at: observedAt, provenance, scope: "CONTROLLED_TEST" });
  const definition = versions.find(value => value.artifact.kind === "SOURCE_DEFINITION")!;
  assert.ok(definition.artifact.kind === "SOURCE_DEFINITION");
  assert.equal(definition.artifact.payload.publisher_kind, "UNIVERSITY_BOARD");
  const admission = versions.find(value => value.artifact.kind === "SOURCE_ADMISSION")!;
  const registry = new InMemorySourceAdmissionRegister();
  registry.register(admission.artifact.payload as never);
  const context = resolveContinuousSourceContext(versions, "allowlist-seu-cbit-2027-publication");
  assert.equal(context.endpoint.locator, SEU_CBIT_URL);
  assert.equal(context.admission.continuous_acquisition_scope?.min_interval_seconds, 86400);
  assert.equal(context.admission.official_owner.original.text, "东南大学");
  assert.equal(versions.some(value => JSON.stringify(value).includes('"host":"campus.51job.com"')), false);
});
test("one real role is retained with university provenance and incomplete qualification evidence", async () => {
  const records = await extract(universityHtml());
  const role = records.find(value => value.adapter_metadata["cn-seu-cbit-2027-university-html"]?.source_role === "POSITION_BEARING")!;
  assert.equal(role.raw_title?.text, "法务岗");
  assert.equal(role.raw_organization_name?.text, "银保信科技（北京）有限公司");
  assert.equal(role.recruitment_year?.text, "2027");
  assert.equal(role.announcement_url, SEU_CBIT_URL);
  assert.ok(role.raw_requirement_text?.text.includes("特别优秀者"));
  assert.equal(role.adapter_metadata["cn-seu-cbit-2027-university-html"]?.publisher_kind, "UNIVERSITY_BOARD");
  assert.equal(role.adapter_metadata["cn-seu-cbit-2027-university-html"]?.employer_original_verified, false);
});
test("changed year employer ambiguous role or missing conditions cannot fabricate a job", async () => {
  for (const html of [universityHtml().replaceAll("2027", "2026"), universityHtml().replace("银保信科技（北京）有限公司", "其他公司"),
    universityHtml().replace("三、招聘条件", "其他事项"), universityHtml().replace("</table>", "<tr><td>2</td><td>法学类</td><td>法务岗</td><td>法学类</td><td>若干</td><td>北京</td></tr></table>")]) {
    await assert.rejects(extract(html));
  }
});
test("existing trusted chain and fresh process retain the university legal position without qualification invention", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "seu-TEST_ONLY-"));
  const remote = path.join(directory, "remote.git");
  const seed = path.join(directory, "seed");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
  git(directory, "init", "--quiet", "--bare", remote);
  git(directory, "init", "--quiet", "-b", "main", seed);
  writeFileSync(path.join(seed, "README.md"), "TEST_ONLY university publication fixture\n");
  const identity = { name: "Controlled University Test", email: "controlled@invalid.local" };
  const commit = () => git(seed, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "TEST_ONLY source fixture");
  git(seed, "add", "README.md"); commit(); git(seed, "remote", "add", "origin", remote);
  const store = new GitSourceRegistryPersistence({ repository_path: seed });
  for (const version of createSeuCbit2027SourceVersions({ observed_at: observedAt, provenance, scope: "CONTROLLED_TEST" })) await store.appendVersion(version);
  git(seed, "add", "production-source-state"); commit(); git(seed, "push", "origin", "HEAD:main");
  const options = { remote_url: remote, branch: "main", stream_id: "controlled-seu", execution_mode: "TEST_ONLY" as const,
    continuous_scope: "CONTROLLED_TEST" as const, now: () => observedAt, commit_identity: identity,
    controlled_continuous_transport: { async execute(request: { locator: string }) {
      assert.equal(request.locator, SEU_CBIT_URL);
      const bytes = new TextEncoder().encode(universityHtml());
      return { status: "SUCCESS" as const, responded_at: observedAt as never, bytes,
        content_sha256: createHash("sha256").update(bytes).digest("hex") as never, mime_type: "text/html;charset=UTF-8", http_status: 200, headers: {} };
    } } };
  const root = bootstrapZeroCostProductionCompositionRoot(options);
  const issued = await root.issueContinuousAuthorization({ allowlist_entry_id: "allowlist-seu-cbit-2027-publication", effective_from: observedAt,
    min_interval_seconds: 86400, actor: "controlled-university-test" });
  const result = await root.runProduction({ run_id: "controlled-seu-cbit-2027", source_versions: [], source_admission_id: "admission-seu-cbit-2027-publication",
    recruitment_endpoint_id: seuCbitEndpoint().recruitment_endpoint_id, continuous_authorization_ids: [issued.record.payload.grant!.authorization_id],
    adapter: new SeuCbit2027HtmlAdapter(), provenance, actor: "controlled-university-test", started_at: observedAt,
    transport: { async execute() { throw new Error("CALLER_TRANSPORT_DENIED"); } } });
  assert.equal(result.status, "COMMITTED", result.error ?? JSON.stringify(result));
  const restored = await root.restore();
  assert.equal(restored.read_models.length, 1);
  assert.equal(restored.read_models[0]!.employer.state, "AVAILABLE");
  assert.equal(restored.presentation_decisions[0]!.status, "EVIDENCE_BLOCKED");
  const expected = canonicalSerialize(restored);
  const child = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    require(${JSON.stringify(path.resolve("tests/helpers/network-guard.ts"))});
    const {bootstrapZeroCostProductionCompositionRoot}=require(${JSON.stringify(path.resolve("lib/production-persistence/zero-cost-production-composition-root.ts"))});
    const {canonicalSerialize}=require(${JSON.stringify(path.resolve("lib/ingestion/normalization/canonical-artifact-registry.ts"))});
    (async()=>{const state=await bootstrapZeroCostProductionCompositionRoot({remote_url:process.argv[1],branch:'main',stream_id:'controlled-seu',execution_mode:'TEST_ONLY',continuous_scope:'CONTROLLED_TEST'}).restore();process.stdout.write(canonicalSerialize(state));})().catch(error=>{console.error(error);process.exitCode=1});
  `, remote], { encoding: "utf8", windowsHide: true, timeout: 240000 });
  assert.equal(child, expected);
});
