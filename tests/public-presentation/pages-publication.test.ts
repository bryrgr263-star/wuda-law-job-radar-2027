import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  verifyPagesPublicationPrecondition
} from "../../lib/public-presentation/pages-publication";
import type { PublicReleaseManifest } from "../../lib/public-presentation/publication";

function commit(repository: string, name: string) {
  writeFileSync(path.join(repository, "marker.txt"), name);
  execFileSync("git", ["add", "marker.txt"], { cwd: repository });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid",
    "commit", "-m", name], { cwd: repository, stdio: "pipe" });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
}

function manifest(sha: string, snapshot = "1".repeat(64)): PublicReleaseManifest {
  return {
    schema_version: "public-presentation-release/1.0.0",
    authoritative_sha: sha,
    implementation_sha: sha,
    snapshot_path: `presentation/snapshots/${snapshot}.json`,
    snapshot_hash: snapshot,
    base_path: "/wuda-law-job-radar-2027",
    files: [],
    bundle_manifest_hash: "2".repeat(64)
  };
}

function repositoryFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pages-precondition-"));
  execFileSync("git", ["init", root], { stdio: "pipe" });
  const first = commit(root, "first");
  const second = commit(root, "second");
  execFileSync("git", ["checkout", "--orphan", "unrelated"], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["rm", "-rf", "."], { cwd: root, stdio: "pipe" });
  const unrelated = commit(root, "unrelated");
  return { root, first, second, unrelated };
}

test("manual initial cutover alone accepts an absent live trusted manifest", () => {
  const fixture = repositoryFixture();
  try {
    assert.deepEqual(verifyPagesPublicationPrecondition({ repository_path: fixture.root,
      candidate_manifest: manifest(fixture.second), live_manifest: null,
      allow_initial_cutover: true }), {
      status: "INITIAL_CUTOVER",
      live_authoritative_sha: null,
      candidate_authoritative_sha: fixture.second
    });
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("scheduled publication rejects an absent or invalid live manifest", () => {
  const fixture = repositoryFixture();
  try {
    assert.throws(() => verifyPagesPublicationPrecondition({ repository_path: fixture.root,
      candidate_manifest: manifest(fixture.second), live_manifest: null,
      allow_initial_cutover: false }), /PAGES_LIVE_MANIFEST_REQUIRED/);
    assert.throws(() => verifyPagesPublicationPrecondition({ repository_path: fixture.root,
      candidate_manifest: manifest(fixture.second), live_manifest: { authoritative_sha: fixture.first },
      allow_initial_cutover: false }), /PAGES_LIVE_MANIFEST_INVALID/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("descendant candidate advances and equal SHA plus equal snapshot is idempotent", () => {
  const fixture = repositoryFixture();
  try {
    assert.equal(verifyPagesPublicationPrecondition({ repository_path: fixture.root,
      candidate_manifest: manifest(fixture.second), live_manifest: manifest(fixture.first),
      allow_initial_cutover: false }).status, "ADVANCE");
    assert.equal(verifyPagesPublicationPrecondition({ repository_path: fixture.root,
      candidate_manifest: manifest(fixture.second), live_manifest: manifest(fixture.second),
      allow_initial_cutover: false }).status, "IDEMPOTENT");
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("equal SHA with different snapshot is rejected", () => {
  const fixture = repositoryFixture();
  try {
    assert.throws(() => verifyPagesPublicationPrecondition({ repository_path: fixture.root,
      candidate_manifest: manifest(fixture.second, "3".repeat(64)),
      live_manifest: manifest(fixture.second), allow_initial_cutover: false }),
    /PAGES_SAME_SHA_RELEASE_MISMATCH/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("older or unrelated candidate is rejected before publication", () => {
  const fixture = repositoryFixture();
  try {
    assert.throws(() => verifyPagesPublicationPrecondition({ repository_path: fixture.root,
      candidate_manifest: manifest(fixture.first), live_manifest: manifest(fixture.second),
      allow_initial_cutover: false }), /PAGES_STALE_OR_UNRELATED_PUBLICATION/);
    assert.throws(() => verifyPagesPublicationPrecondition({ repository_path: fixture.root,
      candidate_manifest: manifest(fixture.unrelated), live_manifest: manifest(fixture.second),
      allow_initial_cutover: false }), /PAGES_STALE_OR_UNRELATED_PUBLICATION/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});
