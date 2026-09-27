import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { shaSchema } from "../lib/public-presentation/schema";
import { restorePinnedCurrent } from "../lib/public-presentation/restore";
import { createPublicSnapshot } from "../lib/public-presentation/snapshot";
import { prepareStaticDelivery } from "../lib/public-presentation/static-delivery";
import { assertNoSymlinks, publishPublicRelease, readPublicationPointer } from "../lib/public-presentation/publication";

export interface PublicationOptions {
  readonly repository_path: string; readonly authoritative_sha: string; readonly stream_id: string;
  readonly base_path: string; readonly delivery_root: string;
}
export function parsePublicationArgs(args: readonly string[]): PublicationOptions {
  const keys = ["--repository", "--authoritative-sha", "--stream", "--base-path", "--output"];
  const values = new Map<string, string>();
  if (args.length % 2) throw new Error("PUBLIC_ARGUMENT_INVALID");
  for (let index = 0; index < args.length; index += 2) {
    if (!keys.includes(args[index]) || values.has(args[index])) throw new Error("PUBLIC_ARGUMENT_INVALID");
    values.set(args[index], args[index + 1]);
  }
  if (keys.some(key => !values.has(key))) throw new Error("PUBLIC_ARGUMENT_MISSING");
  const sha = shaSchema.parse(values.get("--authoritative-sha"));
  const stream = values.get("--stream")!;
  const base = values.get("--base-path")!;
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(stream) || !/^(?:\/[A-Za-z0-9_-]+)*$/u.test(base)
    || !values.get("--repository") || !values.get("--output")) throw new Error("PUBLIC_ARGUMENT_INVALID");
  return { repository_path: path.resolve(values.get("--repository")!), authoritative_sha: sha,
    stream_id: stream, base_path: base, delivery_root: path.resolve(values.get("--output")!) };
}
export async function publishFromAuthoritativeCommit(input: PublicationOptions) {
  const repository = realpathSync(input.repository_path);
  assertNoSymlinks(input.delivery_root);
  const relative = path.relative(repository, path.resolve(input.delivery_root));
  if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error("PUBLIC_OUTPUT_INSIDE_AUTHORITY");
  const pointer = readPublicationPointer(input.delivery_root);
  if (pointer && pointer.authoritative_sha !== input.authoritative_sha) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", pointer.authoritative_sha, input.authoritative_sha],
        { cwd: repository, stdio: "pipe", windowsHide: true });
    } catch { throw new Error("PUBLIC_STALE_OR_UNRELATED_COMMIT"); }
  }
  const restored = await restorePinnedCurrent(input);
  const snapshot = createPublicSnapshot(restored);
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pub-cli-"));
  try {
    const stage = path.join(temporary, "release");
    const manifest = await prepareStaticDelivery({ snapshot, implementation_repository: repository,
      implementation_sha: input.authoritative_sha, base_path: input.base_path, staging_path: stage,
      previous_release_path: pointer ? path.join(input.delivery_root, "releases", pointer.release_id) : undefined });
    const receipt = publishPublicRelease({ delivery_root: input.delivery_root, staged_release_path: stage, manifest,
      repository_path: repository, expected_pointer_hash: pointer?.pointer_hash ?? null });
    const receipts = path.join(input.delivery_root, "receipts");
    assertNoSymlinks(receipts);
    mkdirSync(receipts, { recursive: true });
    writeFileSync(path.join(receipts, `${randomUUID()}.json`), JSON.stringify(receipt), { flag: "wx", mode: 0o600 });
    return { ...receipt, publication_state: "LOCAL_STAGED" as const, deployment: "NOT_EXECUTED" as const };
  } finally {
    if (path.dirname(temporary) !== path.resolve(os.tmpdir())) throw new Error("PUBLIC_TEMP_BOUNDARY_INVALID");
    rmSync(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishFromAuthoritativeCommit(parsePublicationArgs(process.argv.slice(2)))
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(() => { process.stderr.write("PUBLIC_PUBLICATION_FAILED; inspect committed local pointer before retry.\n"); process.exitCode = 1; });
}
