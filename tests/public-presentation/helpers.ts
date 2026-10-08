import "../helpers/network-guard";
import { GitAppendOnlyExecutionStore } from "../../lib/production-persistence/git-append-only-execution-store";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const BASELINE_SHA = "fd2b64685cbce8faa03267a0a8fbce593bba70cc";
export const STREAM_ID = "initial-production-source-activation";
let cachedSnapshot: ReturnType<GitAppendOnlyExecutionStore["readCurrentSnapshot"]>;
process.env.GIT_CONFIG_COUNT = "1";
process.env.GIT_CONFIG_KEY_0 = "core.longpaths";
process.env.GIT_CONFIG_VALUE_0 = "true";

export function fixtureInput() {
  if (!cachedSnapshot) {
    const temporary = mkdtempSync(path.join(os.tmpdir(), "pub-history-fixture-"));
    const checkout = path.join(temporary, "checkout");
    try {
      execFileSync("git", ["clone", "--local", "--no-checkout", process.cwd(), checkout], { stdio: "pipe" });
      execFileSync("git", ["-c", "core.autocrlf=false", "checkout", "--detach", BASELINE_SHA], { cwd: checkout, stdio: "pipe" });
      cachedSnapshot = new GitAppendOnlyExecutionStore({
        repository_path: checkout, stream_id: STREAM_ID, scope: "PRODUCTION"
      }).readCurrentSnapshot();
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
  const snapshot = cachedSnapshot;
  if (!snapshot) throw new Error("Committed Run1 fixture missing");
  const epoch = Number(execFileSync("git", ["show", "-s", "--format=%ct", snapshot.authoritative_head], { encoding: "utf8" }).trim());
  return { authoritative_sha: snapshot.authoritative_head,
    generated_at: new Date(epoch * 1000).toISOString(), current_snapshot: structuredClone(snapshot) };
}
