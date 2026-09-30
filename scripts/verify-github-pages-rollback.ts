import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSerialize } from "../lib/ingestion/normalization/canonical-artifact-registry";
import { verifyPagesRollbackPrecondition } from "../lib/public-presentation/pages-publication";
import { downloadVerifiedPagesRelease, retainVerifiedReleaseAssets } from "../lib/public-presentation/pages-retention";
import { createReleaseManifest, parsePublicReleaseManifest, validatePublicRelease } from "../lib/public-presentation/publication";

export async function verifyGitHubPagesRollback(input: {
  readonly repository_path: string;
  readonly target_release_path: string;
  readonly live_manifest_path: string;
  readonly expected_live_sha: string;
  readonly fetcher?: (url: string, options: RequestInit) => Promise<Response>;
}) {
  const target = validatePublicRelease(input.target_release_path,
    JSON.parse(readFileSync(path.join(input.target_release_path, "presentation", "release.json"), "utf8")));
  const live = parsePublicReleaseManifest(JSON.parse(readFileSync(input.live_manifest_path, "utf8")));
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pages-rollback-"));
  try {
    const livePath = path.join(temporary, "live");
    await downloadVerifiedPagesRelease({ manifest: live,
      base_url: `https://bryrgr263-star.github.io${live.base_path}/`,
      destination: livePath, fetcher: input.fetcher });
    const targetSha = verifyPagesRollbackPrecondition(input.repository_path, target, live, input.expected_live_sha);
    retainVerifiedReleaseAssets(input.target_release_path, [livePath]);
    const retained = createReleaseManifest(input.target_release_path, {
      authoritative_sha: target.authoritative_sha, implementation_sha: target.implementation_sha,
      snapshot_hash: target.snapshot_hash, base_path: target.base_path
    });
    writeFileSync(path.join(input.target_release_path, "presentation", "release.json"), canonicalSerialize(retained));
    validatePublicRelease(input.target_release_path, retained);
    return targetSha;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [repositoryPath, targetReleasePath, liveManifestPath, expectedLiveSha] = process.argv.slice(2);
  if (process.argv.length !== 6 || !repositoryPath || !targetReleasePath || !liveManifestPath || !expectedLiveSha) {
    throw new Error("PAGES_ROLLBACK_ARGUMENT_INVALID");
  }
  verifyGitHubPagesRollback({ repository_path: repositoryPath, target_release_path: targetReleasePath,
    live_manifest_path: liveManifestPath, expected_live_sha: expectedLiveSha })
    .catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "PAGES_ROLLBACK_FAILED"}\n`);
      process.exitCode = 1; });
}
