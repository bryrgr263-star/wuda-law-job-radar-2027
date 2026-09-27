import "../helpers/network-guard";

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("production binding appends Composition and Relevance to real Run 1, safely stops, and restores in fresh Process B", () => {
  const repositoryPath = mkdtempSync(path.join(os.tmpdir(), "bc-"));
  try {
    execFileSync("git", ["clone", "--local", process.cwd(), repositoryPath], { stdio: "pipe" });
    for (const mode of ["execute", "restore"]) {
      const result = spawnSync(process.execPath, ["--import",
        pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href,
        path.resolve("tests/production-persistence/production-business-chain-worker.ts"), repositoryPath, mode
      ], { encoding: "utf8", windowsHide: true, timeout: 900_000 });
      assert.equal(result.error, undefined, String(result.error));
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /"compositions":4,"relevance":4,"eligibility":0,"outcome":"EVIDENCE_BLOCKED"/);
    }
    assert.deepEqual(execFileSync("git", ["diff", "--name-only", "HEAD~28", "HEAD", "--",
      "trusted-objects", "production-source-state"], { cwd: repositoryPath, encoding: "utf8" }).trim(), "");
  } finally {
    assert.equal(path.dirname(repositoryPath), path.resolve(os.tmpdir()));
    rmSync(repositoryPath, { recursive: true, force: true });
  }
});
