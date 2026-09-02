import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const previewApplicationRoot = path.join(repositoryRoot, "lib", "application", "preview-persistence");
const previewMigrationRoot = path.join(repositoryRoot, "preview", "migrations");

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
  }))).flat();
}

test("P2-02 Preview implementation contains no network or collection capability", async () => {
  const sources = await Promise.all((await collectFiles(previewApplicationRoot)).map(async (filePath) => ({ filePath, source: await readFile(filePath, "utf8") })));
  const violations = sources.flatMap(({ filePath, source }) => /node:(?:http|https|net|tls)|\bfetch\s*\(|(?:CollectionRunner|Adapter)/u.test(source) ? [path.relative(repositoryRoot, filePath)] : []);
  assert.deepEqual(violations, []);
});

test("P2-02 Preview migration remains isolated from production and lifecycle tables", async () => {
  const source = (await Promise.all((await collectFiles(previewMigrationRoot)).map((filePath) => readFile(filePath, "utf8")))).join("\n");
  assert.doesNotMatch(source, /\b(?:supabase|sources|jobs|applications|sync_runs|source_runs|missing_streak|lifecycle)\b/iu);
  assert.match(source, /preview_ingestion/);
});

test("P2-02 Preview boundary tests remain offline", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});
