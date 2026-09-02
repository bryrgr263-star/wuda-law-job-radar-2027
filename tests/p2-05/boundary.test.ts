import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const schedulerRoot = path.join(repositoryRoot, "lib", "source-scheduler");
const frozenRoots = [
  path.join(repositoryRoot, "lib", "ingestion"),
  path.join(repositoryRoot, "lib", "application"),
  path.join(repositoryRoot, "lib", "collection-runtime"),
  path.join(repositoryRoot, "lib", "live-canary", "p2-04")
];

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectTypeScriptFiles(entryPath) : /\.tsx?$/u.test(entry.name) ? [entryPath] : [];
  }))).flat();
}

function resolveLocalImport(sourceFile: string, specifier: string) {
  return specifier.startsWith(".") ? path.resolve(path.dirname(sourceFile), specifier) : null;
}

test("P2-05 is offline and depends only downstream on frozen P1/P2 contracts", async () => {
  const violations: string[] = [];
  for (const filePath of await collectTypeScriptFiles(schedulerRoot)) {
    const source = await readFile(filePath, "utf8");
    if (/node:(?:http|https|net|tls|dns)|\bfetch\s*\(/u.test(source)) {
      violations.push(`${path.relative(repositoryRoot, filePath)} contains network access`);
    }
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/gu)) {
      const resolved = resolveLocalImport(filePath, match[1]);
      if (!resolved) continue;
      const allowed = resolved.startsWith(schedulerRoot)
        || resolved.startsWith(path.join(repositoryRoot, "lib", "ingestion"))
        || resolved.startsWith(path.join(repositoryRoot, "lib", "application", "source-admission"))
        || resolved.startsWith(path.join(repositoryRoot, "lib", "collection-runtime"));
      if (!allowed) violations.push(`${path.relative(repositoryRoot, filePath)} imports ${match[1]}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("frozen P1 through P2-04 modules do not depend on P2-05", async () => {
  const violations: string[] = [];
  for (const root of frozenRoots) {
    for (const filePath of await collectTypeScriptFiles(root)) {
      const source = await readFile(filePath, "utf8");
      if (/source-scheduler/u.test(source)) violations.push(path.relative(repositoryRoot, filePath));
    }
  }
  assert.deepEqual(violations, []);
});

test("P2-05 boundary tests retain the shared external Network Guard", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});
