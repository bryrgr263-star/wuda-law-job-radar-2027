import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const applicationRoot = path.join(repositoryRoot, "lib", "application");
const ingestionRoot = path.join(repositoryRoot, "lib", "ingestion");
const protectedLegacyFiles = [
  "app/page.tsx",
  "app/api/jobs/route.ts",
  "components/job-board.tsx",
  "lib/jobs.ts",
  "lib/crawler.ts",
  "lib/source-catalog.ts",
  "lib/scoring.ts",
  "lib/sync.ts",
  "scripts/export-static-mirror.ts",
  "scripts/sync-jobs.ts"
].map((filePath) => path.join(repositoryRoot, filePath));

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return /\.tsx?$/u.test(entry.name) ? [entryPath] : [];
  }));
  return files.flat();
}

function importSpecifiers(source: string) {
  return [...source.matchAll(/(?:from\s+|import\s*\(|require\s*\()["']([^"']+)["']/gu)]
    .map((match) => match[1]);
}

function resolveLocalImport(sourceFile: string, specifier: string) {
  if (specifier.startsWith("@/")) return path.resolve(repositoryRoot, specifier.slice(2));
  if (specifier.startsWith(".")) return path.resolve(path.dirname(sourceFile), specifier);
  return null;
}

test("P2 application depends only downstream on frozen ingestion and has no network implementation", async () => {
  const violations: string[] = [];
  for (const filePath of await collectTypeScriptFiles(applicationRoot)) {
    const source = await readFile(filePath, "utf8");
    if (/node:(?:http|https|net|tls)|\bfetch\s*\(/u.test(source)) {
      violations.push(`${path.relative(repositoryRoot, filePath)} contains network access`);
    }
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveLocalImport(filePath, specifier);
      if (!resolved) continue;
      if (resolved.startsWith(ingestionRoot) || resolved.startsWith(applicationRoot)) continue;
      violations.push(`${path.relative(repositoryRoot, filePath)} -> ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("frozen P1 core and legacy production paths do not depend on P2 application", async () => {
  const violations: string[] = [];
  for (const filePath of [
    ...(await collectTypeScriptFiles(ingestionRoot)),
    ...protectedLegacyFiles
  ]) {
    const source = await readFile(filePath, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveLocalImport(filePath, specifier);
      if (resolved?.startsWith(applicationRoot)) {
        violations.push(`${path.relative(repositoryRoot, filePath)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("P2-01 application boundary tests remain offline", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});
