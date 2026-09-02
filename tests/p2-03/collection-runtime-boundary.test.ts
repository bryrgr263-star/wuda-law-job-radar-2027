import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeRoot = path.join(repositoryRoot, "lib", "collection-runtime");
const frozenRoots = [
  path.join(repositoryRoot, "lib", "ingestion"),
  path.join(repositoryRoot, "lib", "application", "source-admission"),
  path.join(repositoryRoot, "lib", "application", "preview-persistence")
];

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectTypeScriptFiles(entryPath) : /\.tsx?$/u.test(entry.name) ? [entryPath] : [];
  }))).flat();
}

test("P2-03 runtime is the only local HTTP layer and depends only on P1 plus itself", async () => {
  const violations: string[] = [];
  for (const filePath of await collectTypeScriptFiles(runtimeRoot)) {
    const source = await readFile(filePath, "utf8");
    const relative = path.relative(repositoryRoot, filePath);
    if (/\bfetch\s*\(/u.test(source)) violations.push(`${relative} uses fetch`);
    if (/node:(?:net|tls)/u.test(source)) violations.push(`${relative} uses unrestricted socket access`);
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/gu)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(filePath), specifier);
      if (!resolved.startsWith(runtimeRoot) && !resolved.startsWith(path.join(repositoryRoot, "lib", "ingestion"))) {
        violations.push(`${relative} imports ${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("frozen P1, P2-01, and P2-02 modules do not depend on P2-03 runtime", async () => {
  const violations: string[] = [];
  for (const root of frozenRoots) {
    for (const filePath of await collectTypeScriptFiles(root)) {
      const source = await readFile(filePath, "utf8");
      if (/collection-runtime/u.test(source)) violations.push(path.relative(repositoryRoot, filePath));
    }
  }
  assert.deepEqual(violations, []);
});

test("P2-03 boundary tests retain the shared external Network Guard", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});
