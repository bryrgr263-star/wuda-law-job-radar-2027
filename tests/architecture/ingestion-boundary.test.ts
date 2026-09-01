import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ingestionRoot = path.join(repositoryRoot, "lib", "ingestion");

const forbiddenLegacyModules = [
  "lib/types",
  "lib/crawler",
  "lib/source-catalog",
  "lib/sync",
  "lib/scoring"
].map((modulePath) => path.join(repositoryRoot, modulePath));

const allowedLayerDependencies: Record<string, ReadonlySet<string>> = {
  domain: new Set(),
  registry: new Set(["domain"]),
  transport: new Set(["domain"]),
  raw: new Set(["domain"]),
  adapters: new Set(["domain", "registry", "transport", "raw"]),
  normalization: new Set(["domain"]),
  canonicalization: new Set(["domain"]),
  requirements: new Set(["domain"]),
  eligibility: new Set(["domain"]),
  lifecycle: new Set(["domain"]),
  persistence: new Set(["domain"]),
  pipeline: new Set([
    "domain",
    "registry",
    "transport",
    "raw",
    "adapters",
    "normalization",
    "canonicalization",
    "requirements",
    "eligibility",
    "lifecycle",
    "persistence"
  ])
};

const protectedProductionFiles = [
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
    return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
  }));
  return files.flat();
}

function importSpecifiers(source: string) {
  const specifiers = new Set<string>();
  const patterns = [
    /(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g,
    /import\s+["']([^"']+)["']/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function resolveLocalImport(sourceFile: string, specifier: string) {
  if (specifier.startsWith("@/")) return path.resolve(repositoryRoot, specifier.slice(2));
  if (specifier.startsWith(".")) return path.resolve(path.dirname(sourceFile), specifier);
  return null;
}

function withoutExtension(filePath: string) {
  return filePath.replace(/\.(?:js|jsx|ts|tsx)$/, "");
}

function ingestionLayer(filePath: string) {
  const relativePath = path.relative(ingestionRoot, filePath);
  const [firstSegment] = relativePath.split(path.sep);
  return firstSegment.includes(".") ? "$root" : firstSegment;
}

test("test network access is disabled", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});

test("ingestion modules do not import legacy production modules", async () => {
  const violations: string[] = [];
  for (const filePath of await collectTypeScriptFiles(ingestionRoot)) {
    const source = await readFile(filePath, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveLocalImport(filePath, specifier);
      if (!resolved) continue;
      const target = withoutExtension(resolved);
      if (forbiddenLegacyModules.some((forbidden) => target === forbidden || target.startsWith(`${forbidden}${path.sep}`))) {
        violations.push(`${path.relative(repositoryRoot, filePath)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("ingestion layer imports follow the frozen direction", async () => {
  const violations: string[] = [];
  for (const filePath of await collectTypeScriptFiles(ingestionRoot)) {
    const sourceLayer = ingestionLayer(filePath);
    if (sourceLayer === "$root") continue;
    assert.ok(sourceLayer in allowedLayerDependencies, `Unknown ingestion layer: ${sourceLayer}`);
    const source = await readFile(filePath, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveLocalImport(filePath, specifier);
      if (!resolved || !resolved.startsWith(`${ingestionRoot}${path.sep}`)) continue;
      const targetLayer = ingestionLayer(resolved);
      if (targetLayer === sourceLayer) continue;
      if (!allowedLayerDependencies[sourceLayer].has(targetLayer)) {
        violations.push(`${sourceLayer} -> ${targetLayer}: ${path.relative(repositoryRoot, filePath)}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("legacy production files do not import the Phase 1 core", async () => {
  const violations: string[] = [];
  for (const filePath of protectedProductionFiles) {
    const source = await readFile(filePath, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveLocalImport(filePath, specifier);
      if (resolved && withoutExtension(resolved).startsWith(ingestionRoot)) {
        violations.push(`${path.relative(repositoryRoot, filePath)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("core business layers do not depend on namespaced adapter metadata", async () => {
  const forbiddenLayers = new Set([
    "normalization",
    "canonicalization",
    "requirements",
    "eligibility",
    "lifecycle"
  ]);
  const violations: string[] = [];
  for (const filePath of await collectTypeScriptFiles(ingestionRoot)) {
    if (!forbiddenLayers.has(ingestionLayer(filePath))) continue;
    const source = await readFile(filePath, "utf8");
    if (/adapter_metadata/.test(source)) {
      violations.push(path.relative(repositoryRoot, filePath));
    }
  }
  assert.deepEqual(violations, []);
});
