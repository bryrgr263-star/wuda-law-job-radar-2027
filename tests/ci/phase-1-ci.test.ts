import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = path.join(
  repositoryRoot,
  ".github",
  "workflows",
  "ingestion-foundation-ci.yml"
);

test("Phase 1 exposes independent repeatable test and CI commands", () => {
  const packageJson = JSON.parse(readFileSync(
    path.join(repositoryRoot, "package.json"),
    "utf8"
  )) as { scripts: Record<string, string> };

  assert.match(packageJson.scripts["test:p1-12"], /phase-1-pipeline\.test\.ts/);
  assert.match(packageJson.scripts["test:phase1"], /domain-types\.test\.ts/);
  assert.match(packageJson.scripts["test:phase1"], /shadow-migration\.test\.ts/);
  assert.match(packageJson.scripts["test:phase1"], /ingestion-boundary\.test\.ts/);
  assert.equal(packageJson.scripts["ci:phase1"], "pnpm typecheck && pnpm test:phase1");
});

test("Phase 1 CI is isolated from production secrets, schedules, writes, and deployment", () => {
  const workflow = readFileSync(workflowPath, "utf8");

  assert.match(workflow, /permissions:\s*\n\s*contents: read/u);
  assert.match(workflow, /pnpm install --frozen-lockfile/u);
  assert.match(workflow, /pnpm ci:phase1/u);
  assert.doesNotMatch(workflow, /schedule:|SUPABASE_|secrets\.|pages: write|id-token: write/u);
  assert.doesNotMatch(workflow, /sync:jobs|export:mirror|deploy-pages|git push/u);
});

test("P1-12 CI contract tests remain offline", async () => {
  await assert.rejects(fetch("https://example.invalid"),
    /Network access is disabled in tests/);
});
