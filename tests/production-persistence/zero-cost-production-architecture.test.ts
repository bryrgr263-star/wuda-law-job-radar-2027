import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const rootPath = path.resolve(
  process.cwd(),
  "lib/production-persistence/zero-cost-production-composition-root.ts"
);
const source = readFileSync(rootPath, "utf8");

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
  assert.doesNotMatch(source, /(?:preview|canary|shadow|supabase|postgres)/iu);
  assert.doesNotMatch(source, /(?:scheduler|JobBoard|app\/api)/iu);
});

test("production source imports do not point at test or live-canary modules", () => {
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:tests|live-canary|production-ingestion)/u);
});
