import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import { assertSourcePersistenceVersion, type SourcePersistenceVersion } from "./contracts";
import { GitSourceRegistryPersistence } from "./git-source-registry-persistence";
import { supportingInspectionReplay } from "./source-inspection-replay";

export interface SupportingInspectionPublicationOptions {
  readonly repository_path: string;
  readonly branch: string;
  readonly expected_parent: string;
  readonly claim: SourcePersistenceVersion;
  readonly commit_identity: { readonly name: string; readonly email: string };
}

export async function publishSupportingInspectionClaim(options: SupportingInspectionPublicationOptions): Promise<{
  readonly committed_head: string;
  readonly claim: SourcePersistenceVersion;
}> {
  const repositoryPath = path.resolve(options.repository_path);
  const branch = options.branch;
  const parent = options.expected_parent;
  const identity = structuredClone(options.commit_identity);
  const claim = structuredClone(options.claim);
  const root = "production-source-state";
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: repositoryPath, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(parent) || !identity.name.trim() || !identity.email.trim()) {
    throw new Error("SUPPORTING_INSPECTION_PUBLICATION_INPUT_DENIED");
  }
  git("check-ref-format", "--branch", branch);
  assertSourcePersistenceVersion(claim);
  if (claim.artifact.kind !== "SUPPORTING_INSPECTION_EXECUTION" || claim.artifact.payload.state !== "CLAIMED"
    || claim.revision !== 1 || claim.supersedes_artifact_id !== null) throw new Error("SUPPORTING_INSPECTION_NEW_CLAIM_REQUIRED");
  const repository = new GitSourceRegistryPersistence({ repository_path: repositoryPath });
  repository.assertAuthoritativeHead(branch, parent);
  const before = await repository.listVersions();
  const continuousBefore = repository.listContinuousRecords();
  const inspections = supportingInspectionReplay(before).current;
  const authorization = claim.artifact.payload.authorization;
  const exactUrl = claim.artifact.payload.exact_url;
  if (inspections.some(record => record.authorization.authorization_id === authorization.authorization_id
    || record.authorization.collection_run_id === authorization.collection_run_id
    || record.exact_url === exactUrl)) throw new Error("SUPPORTING_INSPECTION_SPENT_DENIED");
  if (inspections.some(record => record.state === "CLAIMED" || record.state === "UNKNOWN")) {
    throw new Error("SUPPORTING_INSPECTION_UNRESOLVED_DENIED");
  }
  if (git("status", "--porcelain=v1")) throw new Error("SUPPORTING_INSPECTION_DIRTY_STATE_DENIED");
  repository.assertAuthoritativeHead(branch, parent);
  const appended = await repository.appendVersion(claim);
  if (appended !== "APPENDED") throw new Error("SUPPORTING_INSPECTION_SPENT_DENIED");
  if (git("rev-parse", "HEAD") !== parent) throw new Error("SUPPORTING_INSPECTION_LOCAL_HEAD_CHANGED");
  git("add", "--", root);
  const staged = git("diff", "--cached", "--name-only").split(/\r?\n/u);
  if (!staged.length || staged.some(file => !file.startsWith(`${root}/`))) {
    throw new Error("SUPPORTING_INSPECTION_UNRELATED_STAGED_FILES_DENIED");
  }
  git("-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-m",
    `Supporting inspection CLAIMED ${claim.artifact_id} publication ${randomUUID()}`);
  const head = git("rev-parse", "HEAD");
  if (git("rev-parse", "HEAD^") !== parent) throw new Error("SUPPORTING_INSPECTION_PARENT_CHANGED");
  const remote = git("ls-remote", "--heads", "origin", `refs/heads/${branch}`).split(/\s+/u)[0];
  if (remote !== parent) throw new Error("SUPPORTING_INSPECTION_CAS_DENIED");
  git("push", "origin", `${head}:refs/heads/${branch}`);
  const readback = new GitSourceRegistryPersistence({ repository_path: repositoryPath });
  readback.assertAuthoritativeHead(branch, head);
  const versions = await readback.listVersions();
  if (versions.length !== before.length + 1 || canonicalSerialize(versions.slice(0, -1)) !== canonicalSerialize(before)
    || canonicalSerialize(versions.at(-1)) !== canonicalSerialize(claim)
    || canonicalSerialize(readback.listContinuousRecords()) !== canonicalSerialize(continuousBefore)
    || git("status", "--porcelain=v1")) throw new Error("SUPPORTING_INSPECTION_READBACK_DENIED");
  readback.assertAuthoritativeHead(branch, head);
  return { committed_head: head, claim: structuredClone(versions.at(-1)!) };
}
