import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { createReleaseManifest, validatePublicRelease } from "../../lib/public-presentation/publication";
import { downloadVerifiedPagesRelease, retainVerifiedReleaseAssets } from "../../lib/public-presentation/pages-retention";
import { createPublicSnapshot } from "../../lib/public-presentation/snapshot";
import { fixtureInput } from "./helpers";

function fixtureRelease(root: string, generatedAt?: string) {
  const input = fixtureInput();
  const snapshot = createPublicSnapshot(generatedAt ? { ...input, generated_at: generatedAt } : input);
  const snapshotPath = `presentation/snapshots/${snapshot.payload_sha256}.json`;
  for (const [filename, content] of [
    [".nojekyll", ""],
    ["index.html", "<html>previous verified page</html>"],
    ["_next/static/previous.js", "previous verified asset"],
    [snapshotPath, canonicalSerialize(snapshot)]
  ]) {
    const destination = path.join(root, filename);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  const manifest = createReleaseManifest(root, { authoritative_sha: fixtureInput().authoritative_sha,
    implementation_sha: fixtureInput().authoritative_sha, snapshot_hash: snapshot.payload_sha256,
    base_path: "/wuda-law-job-radar-2027" });
  writeFileSync(path.join(root, "presentation", "release.json"), canonicalSerialize(manifest));
  return manifest;
}

test("Pages retains only a complete hash-verified previous release without redirects or credentials", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pages-retention-"));
  try {
    const previous = path.join(temporary, "previous");
    const destination = path.join(temporary, "restored");
    mkdirSync(previous);
    const manifest = fixtureRelease(previous);
    const requested: string[] = [];
    const fetcher = async (url: string, options: RequestInit) => {
      requested.push(url);
      assert.equal(options.redirect, "error");
      assert.equal(options.credentials, "omit");
      if (url.endsWith("/.nojekyll")) return new Response(null, { status: 404 });
      const filename = url.replace("https://pages.invalid/wuda-law-job-radar-2027/", "");
      return new Response(readFileSync(path.join(previous, filename)));
    };
    const result = await downloadVerifiedPagesRelease({ manifest, destination,
      base_url: "https://pages.invalid/wuda-law-job-radar-2027/", fetcher });
    assert.equal(result.bundle_manifest_hash, manifest.bundle_manifest_hash);
    assert.deepEqual(requested.sort(), manifest.files.map(file =>
      `https://pages.invalid/wuda-law-job-radar-2027/${file.path}`).sort());
    assert.equal(validatePublicRelease(destination, manifest).snapshot_hash, manifest.snapshot_hash);
    assert.equal(readFileSync(path.join(destination, ".nojekyll")).length, 0);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("replacement bundle retains current and older verified snapshots and immutable assets", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pages-history-"));
  try {
    const active = path.join(temporary, "active");
    const older = path.join(temporary, "older");
    const stage = path.join(temporary, "stage");
    for (const directory of [active, older, stage]) mkdirSync(directory);
    const activeManifest = fixtureRelease(active);
    const olderManifest = fixtureRelease(older, "2026-09-27T01:00:00.000Z");
    assert.notEqual(activeManifest.snapshot_hash, olderManifest.snapshot_hash);
    retainVerifiedReleaseAssets(stage, [active, older]);
    for (const manifest of [activeManifest, olderManifest]) {
      assert.ok(existsSync(path.join(stage, manifest.snapshot_path)));
    }
    assert.ok(existsSync(path.join(stage, "_next", "static", "previous.js")));
    writeFileSync(path.join(stage, activeManifest.snapshot_path), "tampered");
    assert.throws(() => retainVerifiedReleaseAssets(stage, [active]), /PUBLIC_RETAINED_ASSET_COLLISION/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("Pages rejects altered or redirected previous assets before publication", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pages-retention-refusal-"));
  try {
    const previous = path.join(temporary, "previous");
    mkdirSync(previous);
    const manifest = fixtureRelease(previous);
    for (const response of [new Response("altered"), new Response(null, { status: 302 })]) {
      await assert.rejects(downloadVerifiedPagesRelease({ manifest,
        destination: path.join(temporary, `refusal-${response.status}`),
        base_url: "https://pages.invalid/wuda-law-job-radar-2027/",
        fetcher: async () => response }), /PAGES_.*INVALID|PAGES_.*FAILED/);
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
