import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const rootPath = path.resolve(
  process.cwd(),
  "lib/production-persistence/zero-cost-production-composition-root.ts"
);
const source = readFileSync(rootPath, "utf8");
const binding = readFileSync(path.resolve(process.cwd(),
  "lib/production-persistence/production-trusted-chain-execution-binding.ts"), "utf8");

test("zero-cost production root composes existing authoritative owners only", () => {
  assert.match(source, /bootstrapTrustedChainCompositionRoot/u);
  assert.match(source, /GitAppendOnlyExecutionStore/u);
  assert.match(source, /GitRawObjectPersistence/u);
  assert.match(source, /InMemorySourceRegistry/u);
  assert.match(source, /InMemorySourceAdmissionRegister/u);
  assert.doesNotMatch(source, /class\s+.*(?:Eligibility|PresentationDecision|RawBlob|TrustedChain)/u);
  assert.equal((source.match(/export function bootstrapZeroCostProductionCompositionRoot/gu)
    ?? []).length, 1);
});

test("zero-cost production root has no legacy, preview, shadow, or paid dependency", () => {
  assert.doesNotMatch(source, /(?:crawler|scoring|lib\/sync|\/jobs|sync_runs)/iu);
  assert.doesNotMatch(source, /(?:match_score|non_law_rule|is_published)/iu);
  assert.doesNotMatch(source, /(?:CandidateProfile|Wuhan|LAW_MASTER_NON_LAW)/u);
  assert.doesNotMatch(source, /(?:preview|shadow|supabase|postgres)/iu);
  assert.doesNotMatch(source, /(?:bootstrapProductionSchedulerBatch|JobBoard|app\/api)/iu);
  assert.match(source, /readSchedulerBatchManifests/u);
});

test("production source imports do not point at test or live-canary modules", () => {
  for (const module of [source, binding]) {
    assert.doesNotMatch(module, /from\s+["'][^"']*(?:tests|live-canary|production-ingestion|crawler|scoring|sync|jobs)/u);
  }
});

test("production execution owns its binding and rejects arbitrary caller chain executors", () => {
  assert.match(source, /runProduction\(/u);
  assert.match(source, /executeProductionTrustedChainBinding/u);
  assert.match(source, /CALLER_TRUSTED_CHAIN_EXECUTOR_DENIED/u);
  assert.match(binding, /OPPORTUNITY_REGISTER/u);
  assert.match(binding, /PRESENTATION_DECIDE/u);
  assert.doesNotMatch(binding, /(?:match_score|non_law_rule|is_published|LAW_MASTER_NON_LAW)/u);
});

test("multi-target scheduling never substitutes adapter planning for per-request authorization", () => {
  const scheduler = readFileSync(path.resolve(process.cwd(),
    "lib/production-persistence/production-scheduler-batch.ts"), "utf8");
  const plan = readFileSync(path.resolve(process.cwd(),
    "lib/production-persistence/source-execution-request-plan.ts"), "utf8");
  const intent = readFileSync(path.resolve(process.cwd(),
    "lib/production-persistence/source-execution-request-intent.ts"), "utf8");
  const gate = readFileSync(path.resolve(process.cwd(),
    "lib/production-persistence/continuous-request-gate.ts"), "utf8");
  for (const module of [scheduler, plan, intent, gate]) {
    assert.doesNotMatch(module, /from\s+["'][^"']*(?:tests|live-canary|production-ingestion|crawler|scoring|sync|jobs)/u);
    assert.doesNotMatch(module, /(?:match_score|non_law_rule|is_published|CandidateProfile)/u);
  }
  assert.match(source, /executeContinuousRequest/u);
  assert.match(source, /SOURCE_REQUEST_PLAN_COVERAGE_MISMATCH/u);
  assert.match(source, /writeSourceExecutionRequestIntent/u);
  assert.match(gate, /reserveContinuousAttempt/u);
  assert.match(gate, /EXACT_AUTHORIZATION_REFERENCE_REQUIRED/u);
  assert.doesNotMatch(scheduler, /issueContinuousAuthorization|revokeContinuousAuthorization/u);
  assert.doesNotMatch(plan, /issueContinuousAuthorization|executeContinuousOfficialRequest/u);
});
