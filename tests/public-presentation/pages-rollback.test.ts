import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { createReleaseManifest } from "../../lib/public-presentation/publication";
import { createPublicSnapshot } from "../../lib/public-presentation/snapshot";
import { verifyGitHubPagesRollback } from "../../scripts/verify-github-pages-rollback";
import { fixtureInput } from "./helpers";

function commit(repository: string, value: string) {
  writeFileSync(path.join(repository, "marker"), value);
  execFileSync("git", ["add", "marker"], { cwd: repository });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid",
    "commit", "-m", value], { cwd: repository, stdio: "pipe" });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
}

test("manual Pages rollback validates full current and prior releases without acquisition", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pages-rollback-test-"));
  try {
    const repository = path.join(temporary, "repository");
    const target = path.join(temporary, "target");
    const live = path.join(temporary, "live");
    for (const directory of [repository, target, live]) mkdirSync(directory);
    execFileSync("git", ["init", repository], { stdio: "pipe" });
    const targetSha = commit(repository, "target");
    const liveSha = commit(repository, "live");
    const fixture = fixtureInput();
    const olderSnapshot = createPublicSnapshot({ ...fixture, authoritative_sha: targetSha,
      current_snapshot: { ...fixture.current_snapshot!, authoritative_head: targetSha,
        current_position_read_models: [] } });
    const currentSnapshot = createPublicSnapshot({ ...fixture, authoritative_sha: liveSha,
      current_snapshot: { ...fixture.current_snapshot!, authoritative_head: liveSha,
        current_position_read_models: [] } });
    for (const [directory, snapshots] of [[target, [olderSnapshot]], [live, [olderSnapshot, currentSnapshot]]] as const) {
      writeFileSync(path.join(directory, "index.html"), "<html>verified</html>");
      writeFileSync(path.join(directory, ".nojekyll"), "");
      mkdirSync(path.join(directory, "presentation", "snapshots"), { recursive: true });
      for (const snapshot of snapshots) writeFileSync(path.join(directory, "presentation", "snapshots",
        `${snapshot.payload_sha256}.json`), canonicalSerialize(snapshot));
    }
    const targetManifest = createReleaseManifest(target, { authoritative_sha: targetSha,
      implementation_sha: targetSha, snapshot_hash: olderSnapshot.payload_sha256,
      base_path: "/wuda-law-job-radar-2027" });
    const liveManifest = createReleaseManifest(live, { authoritative_sha: liveSha,
      implementation_sha: liveSha, snapshot_hash: currentSnapshot.payload_sha256,
      base_path: "/wuda-law-job-radar-2027" });
    writeFileSync(path.join(target, "presentation", "release.json"), canonicalSerialize(targetManifest));
    const liveManifestPath = path.join(temporary, "live-manifest.json");
    writeFileSync(liveManifestPath, canonicalSerialize(liveManifest));
    const fetcher = async (url: string) => new Response(readFileSync(path.join(live,
      url.replace("https://bryrgr263-star.github.io/wuda-law-job-radar-2027/", ""))));
    const input = { repository_path: repository, target_release_path: target,
      live_manifest_path: liveManifestPath, expected_live_sha: liveSha, fetcher };
    assert.equal(await verifyGitHubPagesRollback(input), targetSha);
    assert.equal(readFileSync(path.join(target, "presentation", "snapshots",
      `${currentSnapshot.payload_sha256}.json`), "utf8"), canonicalSerialize(currentSnapshot));
    await assert.rejects(verifyGitHubPagesRollback({ ...input, expected_live_sha: targetSha }),
      /PAGES_ROLLBACK_LIVE_SHA_MISMATCH/);
    await assert.rejects(verifyGitHubPagesRollback({ ...input, fetcher: async () => new Response("tampered") }),
      /PAGES_RELEASE_BYTES_INVALID/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
