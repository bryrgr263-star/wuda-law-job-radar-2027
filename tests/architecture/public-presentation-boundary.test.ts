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
