import { execFileSync } from "node:child_process";

import {
  parsePublicReleaseManifest,
  type PublicReleaseManifest
} from "./publication";
import { shaSchema } from "./schema";

export interface PagesPublicationPreconditionInput {
  readonly repository_path: string;
  readonly candidate_manifest: PublicReleaseManifest;
  readonly live_manifest: unknown | null;
  readonly allow_initial_cutover: boolean;
}

export type PagesPublicationPreconditionResult = Readonly<{
  status: "INITIAL_CUTOVER" | "ADVANCE" | "IDEMPOTENT";
  live_authoritative_sha: string | null;
  candidate_authoritative_sha: string;
}>;

export function verifyPagesRecoveryAncestry(repositoryPath: string, recoveryValue: unknown,
  liveValue: unknown): string {
  const recovery = parsePublicReleaseManifest(recoveryValue);
  const live = parsePublicReleaseManifest(liveValue);
  if (recovery.base_path !== live.base_path
    || recovery.implementation_sha !== recovery.authoritative_sha
    || live.implementation_sha !== live.authoritative_sha) throw new Error("PAGES_RECOVERY_BINDING_INVALID");
  if (recovery.authoritative_sha === live.authoritative_sha) throw new Error("PAGES_RECOVERY_NOT_OLDER");
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", recovery.authoritative_sha,
      live.authoritative_sha], { cwd: repositoryPath, stdio: "pipe", windowsHide: true });
  } catch { throw new Error("PAGES_RECOVERY_NOT_ANCESTOR"); }
  return recovery.authoritative_sha;
}

export function verifyPagesRollbackPrecondition(repositoryPath: string, targetValue: unknown,
  liveValue: unknown, expectedLiveSha: string): string {
  const live = parsePublicReleaseManifest(liveValue);
  if (live.authoritative_sha !== shaSchema.parse(expectedLiveSha)) {
    throw new Error("PAGES_ROLLBACK_LIVE_SHA_MISMATCH");
  }
  const target = parsePublicReleaseManifest(targetValue);
  const ancestorSha = verifyPagesRecoveryAncestry(repositoryPath, target, live);
  const targetSnapshot = target.files.find(file => file.path === target.snapshot_path);
  if (!targetSnapshot || !live.files.some(file => file.path === target.snapshot_path
    && file.sha256 === targetSnapshot.sha256 && file.size === targetSnapshot.size)) {
    throw new Error("PAGES_ROLLBACK_SNAPSHOT_NOT_RETAINED");
  }
  return ancestorSha;
}

export function verifyPagesPublicationPrecondition(
  input: PagesPublicationPreconditionInput
): PagesPublicationPreconditionResult {
  const candidate = parsePublicReleaseManifest(input.candidate_manifest);
  if (input.live_manifest === null) {
    if (!input.allow_initial_cutover) throw new Error("PAGES_LIVE_MANIFEST_REQUIRED");
    return Object.freeze({
      status: "INITIAL_CUTOVER" as const,
      live_authoritative_sha: null,
      candidate_authoritative_sha: candidate.authoritative_sha
    });
  }

  let live: PublicReleaseManifest;
  try {
    live = parsePublicReleaseManifest(input.live_manifest);
  } catch {
    throw new Error("PAGES_LIVE_MANIFEST_INVALID");
  }
  if (live.authoritative_sha === candidate.authoritative_sha) {
    if (live.snapshot_hash !== candidate.snapshot_hash
      || live.implementation_sha !== candidate.implementation_sha
      || live.base_path !== candidate.base_path) {
      throw new Error("PAGES_SAME_SHA_RELEASE_MISMATCH");
    }
    return Object.freeze({
      status: "IDEMPOTENT" as const,
      live_authoritative_sha: live.authoritative_sha,
      candidate_authoritative_sha: candidate.authoritative_sha
    });
  }

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", live.authoritative_sha,
      candidate.authoritative_sha], {
      cwd: input.repository_path,
      stdio: "pipe",
      windowsHide: true
    });
  } catch {
    throw new Error("PAGES_STALE_OR_UNRELATED_PUBLICATION");
  }
  return Object.freeze({
    status: "ADVANCE" as const,
    live_authoritative_sha: live.authoritative_sha,
    candidate_authoritative_sha: candidate.authoritative_sha
  });
}
