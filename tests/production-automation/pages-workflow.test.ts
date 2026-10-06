import "../helpers/network-guard";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

test("handoff validator accepts committed partial results but rejects unverified failure reports", () => {
  const workflow = readFileSync(path.join(process.cwd(), ".github/workflows/production-scheduler.yml"), "utf8");
  const script = workflow.split("node <<'NODE'")[1]!.split("          NODE")[0]!;
  const valid = { status: "FAILED", effective_batch_status: "PARTIAL", cas_result: "COMMITTED",
    post_push_process_b: "PASS", ending_sha: "a".repeat(40), publication_handoff: "READY",
    presentation_read_model_ids: ["committed-model"] };
  const evaluate = (report: object) => {
    const outputs: string[] = [];
    runInNewContext(script, { process: { env: { REPORT_PATH: "report", GITHUB_OUTPUT: "output" } },
      require: (name: string) => {
        assert.equal(name, "node:fs");
        return { readFileSync: () => JSON.stringify(report), appendFileSync: (_path: string, value: string) => outputs.push(value) };
      } });
    return outputs;
  };
  assert.match(evaluate(valid)[0]!, /publication_handoff=READY/u);
  for (const patch of [{ cas_result: "FAILED" }, { post_push_process_b: "FAIL" },
    { ending_sha: "invalid" }, { presentation_read_model_ids: [] }, { effective_batch_status: "UNKNOWN" }]) {
    assert.throws(() => evaluate({ ...valid, ...patch }), /PUBLICATION_HANDOFF_/u);
  }
  assert.throws(() => evaluate({ status: "FAILED", error_code: "AUTOMATION_EXECUTION_FAILED" }), /PUBLICATION_HANDOFF_/u);
});

test("committed partial-source results can hand off publication without hiding scheduler failure", () => {
  const workflow = readFileSync(path.join(process.cwd(), ".github/workflows/production-scheduler.yml"), "utf8");
  assert.match(workflow, /name: Validate publication handoff\s+if: \$\{\{ !cancelled\(\) && \(steps\.scheduler\.outcome == 'success' \|\| steps\.scheduler\.outcome == 'failure'\) \}\}/u);
  assert.match(workflow, /\["SUCCESS", "PARTIAL", "FAILED", "DEFERRED"\]\.includes\(report\.effective_batch_status\)/u);
  assert.match(workflow, /if: \$\{\{ !cancelled\(\) && needs\.run-production-scheduler\.result != 'cancelled' && needs\.run-production-scheduler\.outputs\.publication_handoff == 'READY' \}\}/u);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/u);
  assert.match(workflow, /report\.post_push_process_b !== "PASS"/u);
  assert.match(workflow, /report\.cas_result !== "COMMITTED"/u);
});

test("one reusable Pages workflow performs exact-SHA publication-only deployment", () => {
  const workflow = readFileSync(path.join(process.cwd(),
    ".github/workflows/public-presentation-pages.yml"), "utf8");
  assert.match(workflow, /^\s{2}workflow_call:/mu);
  assert.match(workflow, /^\s{2}workflow_dispatch:/mu);
  assert.match(workflow, /authoritative_sha:/u);
  assert.match(workflow, /allow_initial_cutover:/u);
  assert.match(workflow, /group:\s*pages/u);
  assert.match(workflow, /cancel-in-progress:\s*false/u);
  assert.match(workflow, /contents:\s*read/u);
  assert.match(workflow, /pages:\s*write/u);
  assert.match(workflow, /id-token:\s*write/u);
  assert.match(workflow, /ref:\s*\$\{\{ inputs\.rollback_run_id != '' && github\.sha \|\| inputs\.authoritative_sha \}\}/u);
  assert.match(workflow, /rollback_run_id:/u);
  assert.match(workflow, /expected_live_sha:/u);
  assert.match(workflow, /Verify explicit prior-release rollback/u);
  assert.match(workflow, /scripts\/verify-github-pages-rollback\.ts/u);
  assert.match(workflow, /include-hidden-files:\s*true/u);
  assert.match(workflow, /run\.path !== '\.github\/workflows\/public-presentation-pages\.yml'/u);
  assert.match(workflow, /Refuse stale normal publication/u);
  assert.match(workflow, /git ls-remote origin refs\/heads\/main/u);
  assert.match(workflow, /fetch-depth:\s*0/u);
  assert.match(workflow, /https:\/\/bryrgr263-star\.github\.io\/wuda-law-job-radar-2027\/presentation\/release\.json/u);
  assert.match(workflow, /Cache-Control:\s*no-cache/u);
  assert.match(workflow, /Pragma:\s*no-cache/u);
  assert.match(workflow, /publication_run=\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/u);
  assert.match(workflow, /--max-redirs\s+0/u);
  assert.match(workflow, /pnpm presentation:prepare-pages/u);
  assert.match(workflow, /actions\/configure-pages@v6/u);
  assert.match(workflow, /actions\/upload-pages-artifact@v5/u);
  assert.match(workflow, /actions\/deploy-pages@v5/u);
  assert.match(workflow, /path:\s*\$\{\{ inputs\.rollback_run_id != '' && steps\.recovery\.outputs\.path \|\| steps\.prepare\.outputs\.release_path \}\}/u);
  assert.doesNotMatch(workflow,
    /production:scheduler:actions|sync:jobs|export:mirror|Supabase|vercel|crawler|scoring/iu);
});

test("historical sync workflow is manual read-only and cannot write Legacy Pages", () => {
  const workflow = readFileSync(path.join(process.cwd(), ".github/workflows/sync-jobs.yml"), "utf8");
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /contents:\s*read/u);
  assert.match(workflow, /LEGACY_PAGES_WRITER_RETIRED/u);
  assert.doesNotMatch(workflow, /^\s*schedule:/mu);
  assert.doesNotMatch(workflow, /pages:\s*write|id-token:\s*write|sync:jobs|export:mirror|upload-pages-artifact|deploy-pages|SUPABASE_/iu);
});

test("the repository contains exactly one Pages deploy action", () => {
  const pages = readFileSync(path.join(process.cwd(),
    ".github/workflows/public-presentation-pages.yml"), "utf8");
  const legacy = readFileSync(path.join(process.cwd(), ".github/workflows/sync-jobs.yml"), "utf8");
  const scheduler = readFileSync(path.join(process.cwd(),
    ".github/workflows/production-scheduler.yml"), "utf8");
  assert.equal([...`${pages}\n${legacy}\n${scheduler}`.matchAll(/actions\/deploy-pages@/gu)].length, 1);
});
