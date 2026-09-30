import "../helpers/network-guard";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

test("public delivery uses existing authority, no acquisition or second business truth", () => {
  for (const filename of readdirSync("lib/public-presentation").filter(name => name.endsWith(".ts"))) {
    const source = readFileSync(`lib/public-presentation/${filename}`, "utf8");
    assert.doesNotMatch(source, /lib\/jobs|lib\/crawler|lib\/scoring|lib\/sync|production-ingestion|live-canary|read-only-api|match_score|non_law_rule|is_published|runJobSync/u);
  }
  const worker = readFileSync("lib/public-presentation/process-b-worker.ts", "utf8");
  assert.match(worker, /bootstrapTrustedChainCompositionRoot/);
  assert.match(worker, /createRawValidatedRestorationJournal/);
  assert.match(worker, /readCurrentSnapshot/);
  assert.match(worker, /PUBLIC_REPLAY_WRITE_FORBIDDEN/);
  for (const filename of ["lib/presentation-web/public-loader.ts", "components/public-presentation-board.tsx", "lib/public-presentation/schema.ts"]) {
    assert.doesNotMatch(readFileSync(filename, "utf8"), /node:|supabase|git-runtime|production-persistence|\/api\/jobs|create.*Eligibility|create.*Relevance|CandidateProfile/u);
  }
  assert.doesNotMatch(readFileSync("scripts/publish-public-presentation.ts", "utf8"), /runBatch|runJobSync|workflow_dispatch|executeProductionSchedulerAutomation/u);
});

test("automatic Pages delivery remains a publication-only adapter", () => {
  const publicationSources = [
    ...readdirSync("lib/public-presentation").filter(name => name.endsWith(".ts"))
      .map(name => `lib/public-presentation/${name}`),
    "scripts/prepare-github-pages-publication.ts",
    "scripts/publish-public-presentation.ts"
  ].map(filename => readFileSync(filename, "utf8")).join("\n");
  assert.doesNotMatch(publicationSources,
    /production-scheduler|continuous-acquisition|official-acquisition|runBatch|executeProductionSchedulerAutomation|lib\/jobs|sync:jobs|export:mirror/u);

  const scheduler = readFileSync(".github/workflows/production-scheduler.yml", "utf8");
  assert.doesNotMatch(scheduler,
    /readCurrentSnapshot|selectCurrent|PresentationReadModelMaterializer|projectPublic|canonicalPublic/u);

  const workflows = readdirSync(".github/workflows").filter(name => name.endsWith(".yml"));
  const deployOwners = workflows.filter(name =>
    readFileSync(`.github/workflows/${name}`, "utf8").includes("actions/deploy-pages@"));
  assert.deepEqual(deployOwners, ["public-presentation-pages.yml"]);

  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    git?: { deploymentEnabled?: Record<string, boolean> };
  };
  assert.equal(vercel.git?.deploymentEnabled?.main, false);
});

test("operations guide documents activated handoff, retry, stale guard, and backup entry", () => {
  const guide = readFileSync("docs/public-presentation-delivery-operations.md", "utf8");
  assert.match(guide, /Automatic Scheduler handoff — active/u);
  assert.match(guide, /manual initial cutover/u);
  assert.match(guide, /publication-only retry/iu);
  assert.match(guide, /live manifest.*stale/iu);
  assert.match(guide, /last-known-good/iu);
  assert.match(guide, /https:\/\/bryrgr263-star\.github\.io\/wuda-law-job-radar-2027\//u);
  assert.match(guide, /Legacy Pages writer.*retired/iu);
  assert.match(guide, /Vercel remains a separate backup entry/iu);
});
