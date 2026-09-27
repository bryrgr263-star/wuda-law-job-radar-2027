import "../helpers/network-guard";

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

for (const mode of ["native", "zh-CN", "en-US"]) {
  test(`committed Run 1 sequence 11 and full fresh Process B preserve Linux bytes under ${mode}`, () => {
    const repositoryPath = mkdtempSync(path.join(os.tmpdir(), "pb-"));
    try {
      execFileSync("git", ["clone", "--local", "--no-checkout", process.cwd(), repositoryPath], { stdio: "pipe" });
      const result = spawnSync(process.execPath, [
        "--import", pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href,
        path.resolve("tests/production-persistence/cross-environment-process-b-worker.ts"), mode, repositoryPath
      ], {
        cwd: process.cwd(),
        env: { ...process.env, TZ: mode === "en-US" ? "UTC" : "Asia/Shanghai" },
        encoding: "utf8",
        timeout: 300_000,
        windowsHide: true
      });
      assert.equal(result.error, undefined, String(result.error));
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /"replayed":26,"decisions":4,"models":4,"sequence11":"MATCH"/);
    } finally {
      assert.equal(path.dirname(repositoryPath), path.resolve(os.tmpdir()));
      rmSync(repositoryPath, { recursive: true, force: true });
    }
  });
}
