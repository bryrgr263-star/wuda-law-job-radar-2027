import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseGitHubPagesPublicationArgs,
  prepareGitHubPagesPublication
} from "../../scripts/prepare-github-pages-publication";
import { readPublicationPointer } from "../../lib/public-presentation/publication";
import { STREAM_ID } from "./helpers";

function args(sha: string, output: string) {
  return ["--repository", process.cwd(), "--authoritative-sha", sha,
    "--stream", STREAM_ID, "--base-path", "/wuda-law-job-radar-2027",
    "--output", output, "--live-manifest", "ABSENT", "--allow-initial-cutover", "true"];
}

test("Pages CLI requires exact SHA and explicit publication-only cutover inputs", () => {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const parsed = parseGitHubPagesPublicationArgs(args(sha, "C:/temp/pages-delivery"));
  assert.equal(parsed.authoritative_sha, sha);
  assert.equal(parsed.allow_initial_cutover, true);
  assert.equal(parsed.live_manifest_path, null);
  assert.throws(() => parseGitHubPagesPublicationArgs(args("HEAD", "C:/temp/pages-delivery")));
  assert.throws(() => parseGitHubPagesPublicationArgs([...args(sha, "C:/temp/pages-delivery"), "--acquire", "true"]));
  assert.throws(() => parseGitHubPagesPublicationArgs(args(sha, "C:/temp/pages-delivery").slice(0, -2)));
});

test("scheduled publication rejects absent live manifest before static generation", async () => {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  await assert.rejects(prepareGitHubPagesPublication({ repository_path: process.cwd(),
    authoritative_sha: sha, stream_id: STREAM_ID, base_path: "/wuda-law-job-radar-2027",
    delivery_root: path.join(os.tmpdir(), "must-not-be-created"), live_manifest_path: null,
    allow_initial_cutover: false }), /PAGES_LIVE_MANIFEST_REQUIRED/);
});

test("initial Pages preparation and same-SHA retry use one sealed release without acquisition", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pages-cli-"));
  const delivery = path.join(temporary, "delivery");
  const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  try {
    const first = await prepareGitHubPagesPublication({ repository_path: process.cwd(),
      authoritative_sha: headBefore, stream_id: STREAM_ID, base_path: "/wuda-law-job-radar-2027",
      delivery_root: delivery, live_manifest_path: null, allow_initial_cutover: true });
    assert.equal(first.precondition, "INITIAL_CUTOVER");
    const pointer = readPublicationPointer(delivery)!;
    assert.equal(first.release_id, pointer.release_id);
    const manifestPath = path.join(delivery, "releases", pointer.release_id, "presentation", "release.json");
    const second = await prepareGitHubPagesPublication({ repository_path: process.cwd(),
      authoritative_sha: headBefore, stream_id: STREAM_ID, base_path: "/wuda-law-job-radar-2027",
      delivery_root: delivery, live_manifest_path: manifestPath, allow_initial_cutover: false });
    assert.equal(second.precondition, "IDEMPOTENT");
    assert.equal(second.release_id, first.release_id);
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), headBefore);
    const payload = JSON.parse(JSON.parse(readFileSync(path.join(delivery, "releases", pointer.release_id,
      "presentation", "snapshots", `${pointer.snapshot_hash}.json`), "utf8")).payload_canonical_bytes);
    assert.equal(payload.position_count, 4);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
