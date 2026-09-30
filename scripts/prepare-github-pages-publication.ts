import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyPagesPublicationPrecondition } from "../lib/public-presentation/pages-publication";
import {
  assertNoSymlinks,
  parsePublicReleaseManifest,
  readPublicationPointer
} from "../lib/public-presentation/publication";
import { shaSchema } from "../lib/public-presentation/schema";
import {
  publishFromAuthoritativeCommit,
  type PublicationOptions
} from "./publish-public-presentation";

export interface GitHubPagesPublicationInput extends PublicationOptions {
  readonly live_manifest_path: string | null;
  readonly allow_initial_cutover: boolean;
}

export interface GitHubPagesPublicationResult {
  readonly authoritative_sha: string;
  readonly snapshot_hash: string;
  readonly release_id: string;
  readonly release_path: string;
  readonly precondition: "INITIAL_CUTOVER" | "ADVANCE" | "IDEMPOTENT";
}

export function parseGitHubPagesPublicationArgs(args: readonly string[]): GitHubPagesPublicationInput {
  const keys = ["--repository", "--authoritative-sha", "--stream", "--base-path", "--output",
    "--live-manifest", "--allow-initial-cutover"];
  const values = new Map<string, string>();
  if (args.length % 2) throw new Error("PAGES_ARGUMENT_INVALID");
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!keys.includes(key) || values.has(key)) throw new Error("PAGES_ARGUMENT_INVALID");
    values.set(key, args[index + 1]);
  }
  if (keys.some(key => !values.has(key))) throw new Error("PAGES_ARGUMENT_MISSING");
  const authoritativeSha = shaSchema.parse(values.get("--authoritative-sha"));
  const stream = values.get("--stream")!;
  const basePath = values.get("--base-path")!;
  const initial = values.get("--allow-initial-cutover");
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(stream)
    || !/^(?:\/[A-Za-z0-9_-]+)*$/u.test(basePath)
    || (initial !== "true" && initial !== "false")
    || !values.get("--repository") || !values.get("--output")) {
    throw new Error("PAGES_ARGUMENT_INVALID");
  }
  const liveManifest = values.get("--live-manifest")!;
  return {
    repository_path: path.resolve(values.get("--repository")!),
    authoritative_sha: authoritativeSha,
    stream_id: stream,
    base_path: basePath,
    delivery_root: path.resolve(values.get("--output")!),
    live_manifest_path: liveManifest === "ABSENT" ? null : path.resolve(liveManifest),
    allow_initial_cutover: initial === "true"
  };
}

export async function prepareGitHubPagesPublication(
  input: GitHubPagesPublicationInput
): Promise<GitHubPagesPublicationResult> {
  const repository = realpathSync(input.repository_path);
  let liveManifest: unknown | null = null;
  if (input.live_manifest_path === null) {
    if (!input.allow_initial_cutover) throw new Error("PAGES_LIVE_MANIFEST_REQUIRED");
  } else {
    assertNoSymlinks(input.live_manifest_path);
    try {
      liveManifest = parsePublicReleaseManifest(JSON.parse(readFileSync(input.live_manifest_path, "utf8")));
    } catch {
      throw new Error("PAGES_LIVE_MANIFEST_INVALID");
    }
  }

  await publishFromAuthoritativeCommit({ repository_path: repository,
    authoritative_sha: input.authoritative_sha, stream_id: input.stream_id,
    base_path: input.base_path, delivery_root: input.delivery_root });
  const pointer = readPublicationPointer(input.delivery_root);
  if (!pointer || pointer.authoritative_sha !== input.authoritative_sha) {
    throw new Error("PAGES_LOCAL_RELEASE_BINDING_INVALID");
  }
  const releasePath = path.join(input.delivery_root, "releases", pointer.release_id);
  const candidateManifest = parsePublicReleaseManifest(JSON.parse(readFileSync(path.join(releasePath,
    "presentation", "release.json"), "utf8")));
  const precondition = verifyPagesPublicationPrecondition({ repository_path: repository,
    candidate_manifest: candidateManifest, live_manifest: liveManifest,
    allow_initial_cutover: input.allow_initial_cutover });
  return Object.freeze({
    authoritative_sha: pointer.authoritative_sha,
    snapshot_hash: pointer.snapshot_hash,
    release_id: pointer.release_id,
    release_path: releasePath,
    precondition: precondition.status
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareGitHubPagesPublication(parseGitHubPagesPublicationArgs(process.argv.slice(2)))
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => {
      const code = error instanceof Error && /^PAGES_[A-Z0-9_]+$/u.test(error.message)
        ? error.message : "PAGES_PUBLICATION_PREPARATION_FAILED";
      process.stderr.write(`${code}\n`);
      process.exitCode = 1;
    });
}
