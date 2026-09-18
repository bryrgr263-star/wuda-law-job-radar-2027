import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return files(target);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [target] : [];
  }))).flat();
}

test("Trusted Chain never imports the production PostgreSQL infrastructure", async () => {
  const violations: string[] = [];
  for (const file of await files(path.join(root, "lib", "ingestion"))) {
    const source = await readFile(file, "utf8");
    if (/production-persistence/iu.test(source)) violations.push(path.relative(root, file));
  }
  assert.deepEqual(violations, []);
});

test("production persistence has no Legacy, Preview, Shadow, or Canary dependency", async () => {
  const violations: string[] = [];
  const forbidden = [
    /lib\/crawler/iu, /lib\/scoring/iu, /lib\/sync/iu, /lib\/jobs/iu,
    /production-ingestion/iu, /preview/iu, /shadow/iu, /live-canary/iu,
    /match_?score/iu, /non_?law_?rule/iu, /is_?published/iu,
    /\bjobs\b/iu, /\bsync_runs\b/iu
  ];
  for (const file of await files(path.join(root, "lib", "production-persistence"))) {
    const source = await readFile(file, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(source)) violations.push(`${path.relative(root, file)}: ${pattern}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("domain and authoritative processors contain no SQL or PostgreSQL client dependency", async () => {
  const protectedRoots = [
    path.join(root, "lib", "ingestion", "domain"),
    path.join(root, "lib", "ingestion", "eligibility"),
    path.join(root, "lib", "ingestion", "requirements"),
    path.join(root, "lib", "ingestion", "normalization")
  ];
  const violations: string[] = [];
  for (const protectedRoot of protectedRoots) {
    for (const file of await files(protectedRoot)) {
      const source = await readFile(file, "utf8");
      if (/@supabase|from ["'](?:pg|postgres)["']|trusted_chain\./iu.test(source)) {
        violations.push(path.relative(root, file));
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("Phase 1 production persistence tests remain offline", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});
