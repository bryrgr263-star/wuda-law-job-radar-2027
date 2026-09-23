import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const scheduler = source("lib/production-persistence/production-scheduler-batch.ts");
const enumeration = source("lib/production-persistence/scheduler-source-enumeration.ts");
const manifest = source("lib/production-persistence/scheduler-batch-manifest.ts");
const index = source("lib/production-persistence/index.ts");

test("production scheduler delegates source business execution only to the existing Production Root", () => {
  assert.match(scheduler, /bootstrapZeroCostProductionCompositionRoot/u);
  assert.match(scheduler, /runProduction\(/u);
  assert.match(scheduler, /enumerateScheduledSources/u);
  assert.doesNotMatch(scheduler, /bootstrapTrustedChainCompositionRoot|OPPORTUNITY_REGISTER|PRESENTATION_DECIDE/u);
  assert.doesNotMatch(scheduler, /RecallDisposition|LegalEmploymentRelevance|RequirementSetVersion|PredicateResolution|EligibilityAssessment/u);
  assert.doesNotMatch(scheduler, /CandidateProfile|Wuhan|LAW_MASTER_NON_LAW/u);
});

test("scheduler production modules have no legacy, canary, preview, test, Web, or paid authority dependency", () => {
  for (const module of [scheduler, enumeration, manifest]) {
    assert.doesNotMatch(module, /from\s+["'][^"']*(?:tests|live-canary|production-ingestion|crawler|scoring|sync|jobs)/u);
    assert.doesNotMatch(module, /match_score|non_law_rule|is_published|sync_runs|JobBoard|app\/api/iu);
    assert.doesNotMatch(module, /preview|shadow|supabase|postgres/iu);
  }
  assert.doesNotMatch(scheduler, /fetch\(|confirmed_empty\s*=/u);
});

test("production persistence exports the single scheduler batch boundary", () => {
  assert.match(index, /export \* from "\.\/production-scheduler-batch"/u);
  assert.match(index, /export \* from "\.\/scheduler-batch-manifest"/u);
  assert.match(index, /export \* from "\.\/scheduler-source-enumeration"/u);
  assert.equal((scheduler.match(/export function bootstrapProductionSchedulerBatch/gu) ?? []).length, 1);
});

function source(relative: string) {
  return readFileSync(path.resolve(process.cwd(), relative), "utf8");
}
