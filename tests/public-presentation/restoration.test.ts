import "../helpers/network-guard";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { restorePinnedCurrent } from "../../lib/public-presentation/restore";
import { createPublicSnapshot } from "../../lib/public-presentation/snapshot";
import { BASELINE_SHA, STREAM_ID } from "./helpers";

test("fresh Process B pins committed Run1 and produces same bytes across timezones", async () => {
  const before = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const first = await restorePinnedCurrent({ repository_path: process.cwd(), authoritative_sha: BASELINE_SHA, stream_id: STREAM_ID });
  assert.equal(first.authoritative_sha, BASELINE_SHA);
  assert.equal(first.current_snapshot?.authoritative_head, BASELINE_SHA);
  assert.equal(first.current_snapshot?.current_position_read_models.length, 4);
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const second = await restorePinnedCurrent({ repository_path: process.cwd(), authoritative_sha: BASELINE_SHA, stream_id: STREAM_ID });
    assert.deepEqual(createPublicSnapshot(first), createPublicSnapshot(second));
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), before);
});

test("restoration rejects implicit HEAD, missing commit and wrong stream without acquisition", async () => {
  for (const authoritative_sha of ["HEAD", "0".repeat(40)]) {
    await assert.rejects(restorePinnedCurrent({ repository_path: process.cwd(), authoritative_sha, stream_id: STREAM_ID }));
  }
  await assert.rejects(restorePinnedCurrent({ repository_path: process.cwd(), authoritative_sha: BASELINE_SHA, stream_id: "missing" }));
});

test("moving source HEAD after pin never changes the replay or generated commit time", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pub-head-"));
  try {
    execFileSync("git", ["clone", "--local", "--no-checkout", process.cwd(), temporary], { stdio: "pipe" });
    const restoration = restorePinnedCurrent({ repository_path: temporary, authoritative_sha: BASELINE_SHA, stream_id: STREAM_ID });
    const tree = execFileSync("git", ["rev-parse", `${BASELINE_SHA}^{tree}`], { cwd: temporary, encoding: "utf8" }).trim();
    const moved = execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit-tree", tree,
      "-p", BASELINE_SHA, "-m", "test-only HEAD drift"], { cwd: temporary, encoding: "utf8" }).trim();
    execFileSync("git", ["update-ref", "HEAD", moved], { cwd: temporary });
    const result = await restoration;
    assert.equal(result.authoritative_sha, BASELINE_SHA);
    const epoch = Number(execFileSync("git", ["show", "-s", "--format=%ct", BASELINE_SHA], { cwd: temporary, encoding: "utf8" }).trim());
    assert.equal(result.generated_at, new Date(epoch * 1000).toISOString());
    assert.notEqual(execFileSync("git", ["rev-parse", "HEAD"], { cwd: temporary, encoding: "utf8" }).trim(), BASELINE_SHA);
    assert.ok(result.current_snapshot);
    assert.equal(result.current_snapshot.current_position_read_models.length, 4);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("existing processor appends safe revision in temporary fork; existing current selector replaces Run1", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pub-revision-"));
  try {
    execFileSync("git", ["clone", "--local", process.cwd(), temporary], { stdio: "pipe" });
    execFileSync("git", ["checkout", "--detach", BASELINE_SHA], { cwd: temporary, stdio: "pipe" });
    const worker = spawnSync(process.execPath, ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
      path.resolve("tests/production-persistence/production-business-chain-worker.ts"), temporary, "execute"],
    { encoding: "utf8", windowsHide: true, timeout: 900_000 });
    assert.equal(worker.status, 0, worker.stderr);
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: temporary, encoding: "utf8" }).trim();
    const result = await restorePinnedCurrent({ repository_path: temporary, authoritative_sha: sha, stream_id: STREAM_ID });
    const snapshot = createPublicSnapshot(result);
    const payload = JSON.parse(snapshot.payload_canonical_bytes);
    assert.equal(payload.position_count, 4);
    assert.ok(payload.positions.every((item: { decision_revision: number }) => item.decision_revision === 2));
    assert.equal(new Set(payload.positions.map((item: { position_id: string }) => item.position_id)).size, 4);
    assert.equal(execFileSync("git", ["diff", "--name-only", BASELINE_SHA, sha, "--", "trusted-objects", "production-source-state"],
      { cwd: temporary, encoding: "utf8" }).trim(), "");
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    rmSync(temporary, { recursive: true, force: true });
  }
});
