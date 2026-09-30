import "../helpers/network-guard";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

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
