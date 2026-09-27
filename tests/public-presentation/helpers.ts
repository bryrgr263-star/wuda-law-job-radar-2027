import "../helpers/network-guard";
import { GitAppendOnlyExecutionStore } from "../../lib/production-persistence/git-append-only-execution-store";
import { execFileSync } from "node:child_process";

export const BASELINE_SHA = "6efa49f2c55e49ea23c0fd4df42ec43f109d3353";
export const STREAM_ID = "initial-production-source-activation";
let cachedSnapshot: ReturnType<GitAppendOnlyExecutionStore["readCurrentSnapshot"]>;
process.env.GIT_CONFIG_COUNT = "1";
process.env.GIT_CONFIG_KEY_0 = "core.longpaths";
process.env.GIT_CONFIG_VALUE_0 = "true";

export function fixtureInput() {
  const snapshot = cachedSnapshot ??= new GitAppendOnlyExecutionStore({
    repository_path: process.cwd(), stream_id: STREAM_ID, scope: "PRODUCTION"
  }).readCurrentSnapshot();
  if (!snapshot) throw new Error("Committed Run1 fixture missing");
  const epoch = Number(execFileSync("git", ["show", "-s", "--format=%ct", snapshot.authoritative_head], { encoding: "utf8" }).trim());
  return { authoritative_sha: snapshot.authoritative_head,
    generated_at: new Date(epoch * 1000).toISOString(), current_snapshot: structuredClone(snapshot) };
}
