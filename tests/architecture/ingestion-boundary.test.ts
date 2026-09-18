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

test("Opportunity Recall is isolated from legacy filters and candidate eligibility", async () => {
  const recallFiles = [
    path.join(ingestionRoot, "domain", "recall.ts"),
    path.join(ingestionRoot, "normalization", "opportunity-recall-tracker.ts")
  ];
  const forbidden = [
    /candidate_?profile/iu,
    /candidate_?evidence/iu,
    /eligibility/iu,
    /match_?score/iu,
    /non_?law_?rule/iu
  ];
  const violations: string[] = [];
  for (const filePath of recallFiles) {
    const source = await readFile(filePath, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        violations.push(`${path.relative(repositoryRoot, filePath)}: ${pattern}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("Legal Employment Relevance is isolated from candidates and legacy scoring", async () => {
  const relevanceFiles = [
    path.join(ingestionRoot, "domain", "relevance.ts"),
    path.join(ingestionRoot, "pipeline", "legal-employment-relevance.ts")
  ];
  const forbidden = [
    /candidate_?profile/iu,
    /candidate_?evidence/iu,
    /candidate_?eligibility/iu,
    /predicate_?resolution/iu,
    /wuhan university/iu,
    /武汉大学/u,
    /law_?master_?non_?law/iu,
    /match_?score/iu,
    /non_?law_?rule/iu,
    /relevance_?score/iu,
    /keyword_?score/iu,
    /ranking_?score/iu,
    /probability/iu,
    /threshold/iu,
    /excluded_?terms/iu
  ];
  const forbiddenImportRoots = [
    path.join(repositoryRoot, "lib", "crawler"),
    path.join(repositoryRoot, "lib", "scoring"),
    path.join(repositoryRoot, "lib", "sync")
  ];
  const violations: string[] = [];
  for (const filePath of relevanceFiles) {
    const source = await readFile(filePath, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        violations.push(`${path.relative(repositoryRoot, filePath)}: ${pattern}`);
      }
    }
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveLocalImport(filePath, specifier);
      if (!resolved) continue;
      const target = withoutExtension(resolved);
      if (forbiddenImportRoots.some((root) => target === root || target.startsWith(`${root}${path.sep}`))) {
        violations.push(`${path.relative(repositoryRoot, filePath)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("PresentationDecision consumes trusted decisions without legacy or profile inputs", async () => {
  const presentationFiles = [
    path.join(ingestionRoot, "domain", "presentation.ts"),
    path.join(ingestionRoot, "pipeline", "presentation-decision.ts")
  ];
  const forbidden = [
    /candidate_?profile/iu,
    /match_?score/iu,
    /non_?law_?rule/iu,
    /is_?published/iu,
    /jobs\.is_?published/iu,
    /wuhan university/iu,
    /武汉大学/u,
    /law_?master_?non_?law/iu,
    /excluded_?terms/iu
  ];
  const violations: string[] = [];
  for (const filePath of presentationFiles) {
    const source = await readFile(filePath, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        violations.push(`${path.relative(repositoryRoot, filePath)}: ${pattern}`);
      }
    }
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveLocalImport(filePath, specifier);
      if (!resolved) continue;
      const target = withoutExtension(resolved);
      if (forbiddenLegacyModules.some((root) => {
        return target === root || target.startsWith(`${root}${path.sep}`);
      })) {
        violations.push(`${path.relative(repositoryRoot, filePath)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("Trusted Chain restoration replays authoritative owners without legacy persistence", async () => {
  const restorationFiles = [
    path.join(ingestionRoot, "pipeline", "trusted-chain-composition-root.ts"),
    path.join(ingestionRoot, "pipeline", "trusted-chain-restoration.ts")
  ];
  const forbidden = [
    /sqlite/iu,
    /shadow/iu,
    /p2-0[678]/iu,
    /preview/iu,
    /match_?score/iu,
    /non_?law_?rule/iu,
    /is_?published/iu,
    /materialize_?claimed/iu,
    /\bjobs\b/iu,
    /\bsync_runs\b/iu,
    /lib\/crawler/iu,
    /lib\/scoring/iu,
    /lib\/sync/iu
  ];
  const violations: string[] = [];
  for (const filePath of restorationFiles) {
    const source = await readFile(filePath, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        violations.push(`${path.relative(repositoryRoot, filePath)}: ${pattern}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("Read-only Presentation API has one sealed-model input boundary", async () => {
  const apiFiles = [
    path.join(repositoryRoot, "lib", "presentation-read-api", "api.ts"),
    path.join(repositoryRoot, "lib", "presentation-read-api", "runtime.ts"),
    path.join(repositoryRoot, "app", "api", "presentation", "v1", "[...segments]", "route.ts")
  ];
  const forbidden = [
    /candidate_?profile/iu, /match_?score/iu, /non_?law_?rule/iu,
    /is_?published/iu, /lib\/jobs/iu, /lib\/crawler/iu,
    /lib\/scoring/iu, /lib\/sync/iu, /lib\/read-only-api/iu,
    /p2-0[78]-preview/iu, /\bjobs\b/iu, /\bsources\b/iu,
    /\bsync_runs\b/iu
  ];
  const violations: string[] = [];
  for (const filePath of apiFiles) {
    const source = await readFile(filePath, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(source)) violations.push(`${path.relative(repositoryRoot, filePath)}: ${pattern}`);
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

test("discovery support remains inside the existing Source owner and explicit root binding", async () => {
  const helper = await readFile(path.join(ingestionRoot, "normalization", "source-discovery-support.ts"), "utf8");
  assert.doesNotMatch(helper, /new Map|new WeakSet|createCanonicalArtifactRegistryAuthority|candidate_?profile|match_?score|non_?law_?rule|production-persistence|presentation-decision/iu);
  const owner = await readFile(path.join(ingestionRoot, "normalization", "trusted-source-occurrence-registry.ts"), "utf8");
  assert.match(owner, /class InMemoryTrustedSourceOccurrenceTracker/u);
  assert.match(owner, /async processDiscoverySupport/u);
  assert.match(owner, /validatedDiscoverySupport/u);
  assert.match(owner, /#supports/u);
  const root = await readFile(path.join(ingestionRoot, "pipeline", "trusted-chain-composition-root.ts"), "utf8");
  assert.match(root, /VERIFIED_DISCOVERY_SUPPORT/u);
  assert.match(root, /ORIGINAL_ISSUANCE/u);
  assert.match(root, /validateRecallSource/u);
  assert.match(root, /readVerifiedDiscovery/u);
  assert.match(root, /readArtifactEnvelope/u);
});

test("Presentation V2 comparison and current selection remain within the existing Position-scoped owner", async () => {
  const projection = await readFile(path.join(ingestionRoot, "pipeline", "presentation-semantic-projection.ts"), "utf8");
  const owner = await readFile(path.join(ingestionRoot, "pipeline", "presentation-decision.ts"), "utf8");
  const current = await readFile(path.join(ingestionRoot, "pipeline", "presentation-persistence.ts"), "utf8");
  const api = await readFile(path.join(repositoryRoot, "lib", "presentation-read-api", "api.ts"), "utf8");
  assert.doesNotMatch(projection, /CandidateProfile|match_score|non_law_rule|is_published|createCanonicalArtifactRegistryAuthority/u);
  assert.match(projection, /predicate_semantic_hash: predicate\.predicate_resolution_semantic_hash/u);
  assert.match(projection, /SEMANTIC_PROJECTION_REVIEW_REQUIRED/u);
  assert.equal((owner.match(/createCanonicalArtifactRegistryAuthority</gu) ?? []).length, 1);
  assert.doesNotMatch(owner, /PresentationSubjectIdentityRegistry/u);
  assert.match(owner, /resolvePositionCurrent\(scope, graph\.position\.position_id\)/u);
  assert.match(current, /exactly one matching ReadModel per revision/u);
  assert.match(current, /revision gap, branch, or missing predecessor/u);
  assert.match(api, /snapshot\.current_position_read_models/u);
  assert.doesNotMatch(api, /buildPresentationSemanticProjection|createPresentationDecisionBoundary|\.decide\(/u);
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

test("Requirement V2 and Eligibility remain source and file-format neutral", async () => {
  const protectedFiles = [
    path.join(ingestionRoot, "domain", "requirements.ts"),
    path.join(ingestionRoot, "domain", "eligibility.ts"),
    ...(await collectTypeScriptFiles(path.join(ingestionRoot, "requirements"))),
    ...(await collectTypeScriptFiles(path.join(ingestionRoot, "eligibility")))
  ];
  const forbidden = [
    /beijing/iu,
    /北京急救中心/u,
    /p2-04/iu,
    /xlsx/iu,
    /adapter_metadata/u,
    /live-canary/iu
  ];
  const violations: string[] = [];
  for (const filePath of protectedFiles) {
    const source = await readFile(filePath, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        violations.push(`${path.relative(repositoryRoot, filePath)}: ${pattern}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
