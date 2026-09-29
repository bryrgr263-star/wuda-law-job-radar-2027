import { execFileSync } from "node:child_process";
import { closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import { hashSchema, shaSchema } from "./schema";
import { publicByteHash, validatePublicSnapshot } from "./snapshot";

const basePathSchema = z.string().regex(/^(?:\/[A-Za-z0-9_-]+)*$/u);
const fileSchema = z.object({ path: z.string(), size: z.number().int().nonnegative().safe(), sha256: hashSchema }).strict();
const manifestSchema = z.object({ schema_version: z.literal("public-presentation-release/1.0.0"),
  authoritative_sha: shaSchema, implementation_sha: shaSchema, snapshot_path: z.string(), snapshot_hash: hashSchema,
  base_path: basePathSchema, files: z.array(fileSchema), bundle_manifest_hash: hashSchema }).strict();
const pointerSchema = z.object({ schema_version: z.literal("public-presentation-pointer/1.0.0"),
  release_id: hashSchema, manifest_hash: hashSchema, authoritative_sha: shaSchema, snapshot_hash: hashSchema }).strict();
export type PublicReleaseManifest = z.infer<typeof manifestSchema>;
export function parsePublicReleaseManifest(value: unknown): PublicReleaseManifest {
  return manifestSchema.parse(value);
}
const buildReceiptSchema = z.object({ schema_version: z.literal("public-build-receipt/1.0.0"),
  scope: z.enum(["PRODUCTION", "TEST_ONLY"]), authoritative_sha: shaSchema, implementation_sha: shaSchema,
  snapshot_hash: hashSchema, manifest_hash: hashSchema }).strict();
export function createBuildReceipt(manifest: PublicReleaseManifest, scope: "PRODUCTION" | "TEST_ONLY") {
  return buildReceiptSchema.parse({ schema_version: "public-build-receipt/1.0.0", scope,
    authoritative_sha: manifest.authoritative_sha, implementation_sha: manifest.implementation_sha,
    snapshot_hash: manifest.snapshot_hash, manifest_hash: manifest.bundle_manifest_hash });
}
function requireProductionReceipt(filename: string, manifest: PublicReleaseManifest) {
  assertNoSymlinks(filename);
  if (!existsSync(filename)) throw new Error("PUBLIC_BUILD_RECEIPT_REQUIRED");
  const bytes = readFileSync(filename, "utf8");
  const receipt = buildReceiptSchema.parse(JSON.parse(bytes));
  if (receipt.scope !== "PRODUCTION" || manifest.implementation_sha !== manifest.authoritative_sha) {
    throw new Error("PUBLIC_TEST_ONLY_RELEASE_FORBIDDEN");
  }
  if (bytes !== canonicalSerialize(createBuildReceipt(manifest, "PRODUCTION"))) throw new Error("PUBLIC_BUILD_RECEIPT_BINDING_INVALID");
  return bytes;
}
export interface PublicationReceipt {
  readonly release_id: string; readonly authoritative_sha: string;
  readonly snapshot_hash: string; readonly action: "PUBLISH" | "IDEMPOTENT" | "ROLLBACK";
  readonly previous_pointer_hash: string | null; readonly recorded_at: string;
}
export function assertNoSymlinks(target: string) {
  const resolved = path.resolve(target);
  let current = path.parse(resolved).root;
  for (const component of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("PUBLIC_SYMLINK_FORBIDDEN");
  }
}
export function assertPublicAssetPath(relative: string) {
  if (!/^[A-Za-z0-9_./-]+$/u.test(relative) || relative.includes("\\") || relative.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("PUBLIC_ASSET_PATH_INVALID");
  }
  if (["index.html", "index.txt", "404.html", "404/index.html", "_not-found.html", "_not-found.txt", ".nojekyll"].includes(relative)) return;
  if (/^presentation\/snapshots\/[a-f0-9]{64}\.json$/u.test(relative)) return;
  if (/^_next\/static\/[A-Za-z0-9_./-]+\.(?:js|css|woff|woff2)$/u.test(relative)) return;
  throw new Error("PUBLIC_ASSET_NOT_ALLOWED");
}
function listFiles(root: string, prefix = ""): string[] {
  assertNoSymlinks(root);
  return readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error("PUBLIC_SYMLINK_FORBIDDEN");
    if (entry.isDirectory()) return listFiles(root, relative);
    if (!entry.isFile()) throw new Error("PUBLIC_ASSET_TYPE_INVALID");
    if (relative === "presentation/release.json") return [];
    assertPublicAssetPath(relative);
    return [relative];
  }).sort();
}
export function createReleaseManifest(root: string, input: {
  readonly authoritative_sha: string; readonly implementation_sha: string; readonly snapshot_hash: string; readonly base_path: string;
}): PublicReleaseManifest {
  const files = listFiles(root).map(relative => {
    const bytes = readFileSync(path.join(root, relative));
    return { path: relative, size: bytes.length, sha256: publicByteHash(bytes) };
  });
  const payload = { schema_version: "public-presentation-release/1.0.0" as const,
    authoritative_sha: input.authoritative_sha, implementation_sha: input.implementation_sha,
    snapshot_path: `presentation/snapshots/${input.snapshot_hash}.json`, snapshot_hash: input.snapshot_hash,
    base_path: input.base_path, files };
  const manifest = manifestSchema.parse({ ...payload, bundle_manifest_hash: publicByteHash(canonicalSerialize(payload)) });
  if (!files.some(file => file.path === "index.html") || !files.some(file => file.path === manifest.snapshot_path)) throw new Error("PUBLIC_RELEASE_INCOMPLETE");
  validatePublicSnapshot(JSON.parse(readFileSync(path.join(root, manifest.snapshot_path), "utf8")), input.authoritative_sha, input.snapshot_hash);
  return manifest;
}
export function validatePublicRelease(root: string, value: unknown): PublicReleaseManifest {
  const manifest = manifestSchema.parse(value);
  const computed = createReleaseManifest(root, manifest);
  if (canonicalSerialize(computed) !== canonicalSerialize(manifest)) throw new Error("PUBLIC_RELEASE_INTEGRITY_MISMATCH");
  return computed;
}
export function readPublicationPointer(root: string) {
  assertNoSymlinks(root);
  const filename = path.join(root, "current.json");
  assertNoSymlinks(filename);
  if (!existsSync(filename)) return null;
  const bytes = readFileSync(filename, "utf8");
  const pointer = pointerSchema.parse(JSON.parse(bytes));
  if (pointer.release_id !== pointer.manifest_hash || canonicalSerialize(pointer) !== bytes) throw new Error("PUBLIC_POINTER_INVALID");
  const releasePath = path.join(root, "releases", pointer.release_id);
  const manifest = validatePublicRelease(releasePath, JSON.parse(readFileSync(path.join(releasePath, "presentation", "release.json"), "utf8")));
  if (manifest.bundle_manifest_hash !== pointer.manifest_hash || manifest.authoritative_sha !== pointer.authoritative_sha
    || manifest.snapshot_hash !== pointer.snapshot_hash) throw new Error("PUBLIC_POINTER_BINDING_INVALID");
  requireProductionReceipt(path.join(root, "release-provenance", `${pointer.release_id}.json`), manifest);
  return { ...pointer, pointer_hash: publicByteHash(bytes) };
}
function durableWrite(filename: string, bytes: string) {
  const descriptor = openSync(filename, "wx", 0o600);
  try { writeFileSync(descriptor, bytes, "utf8"); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}
function withPublicationLock<Value>(root: string, action: () => Value): Value {
  assertNoSymlinks(root);
  mkdirSync(root, { recursive: true });
  const lock = path.join(root, ".publication.lock");
  let descriptor: number;
  try { descriptor = openSync(lock, "wx", 0o600); } catch { throw new Error("PUBLIC_WRITER_LOCKED"); }
  try { return action(); }
  finally { closeSync(descriptor); unlinkSync(lock); }
}
function switchPointer(root: string, manifest: PublicReleaseManifest, expected: string | null,
  action: PublicationReceipt["action"], fault?: (point: string) => void): PublicationReceipt {
  const current = readPublicationPointer(root);
  if ((current?.pointer_hash ?? null) !== expected) throw new Error("PUBLIC_POINTER_CAS_MISMATCH");
  const pointer = { schema_version: "public-presentation-pointer/1.0.0" as const,
    release_id: manifest.bundle_manifest_hash, manifest_hash: manifest.bundle_manifest_hash,
    authoritative_sha: manifest.authoritative_sha, snapshot_hash: manifest.snapshot_hash };
  const temporary = path.join(root, `.pointer-${randomUUID()}.tmp`);
  try {
    durableWrite(temporary, canonicalSerialize(pointer));
    fault?.("BEFORE_POINTER");
    for (let attempt = 0; ; attempt++) {
      try {
        fault?.("POINTER_REPLACE");
        renameSync(temporary, path.join(root, "current.json"));
        break;
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : null;
        if (process.platform !== "win32" || attempt >= 7 || (code !== "EPERM" && code !== "EACCES")) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
    }
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  return { release_id: manifest.bundle_manifest_hash, authoritative_sha: manifest.authoritative_sha,
    snapshot_hash: manifest.snapshot_hash, action, previous_pointer_hash: expected, recorded_at: new Date().toISOString() };
}
export function publishPublicRelease(input: {
  readonly delivery_root: string; readonly staged_release_path: string; readonly manifest: PublicReleaseManifest;
  readonly repository_path: string; readonly expected_pointer_hash: string | null;
  readonly fault_injector?: (point: string) => void;
}): PublicationReceipt {
  return withPublicationLock(input.delivery_root, () => {
    const current = readPublicationPointer(input.delivery_root);
    if ((current?.pointer_hash ?? null) !== input.expected_pointer_hash) throw new Error("PUBLIC_POINTER_CAS_MISMATCH");
    const manifest = validatePublicRelease(input.staged_release_path, input.manifest);
    const buildReceiptPath = `${input.staged_release_path}.build-receipt.json`;
    if (manifest.implementation_sha !== manifest.authoritative_sha) throw new Error("PUBLIC_TEST_ONLY_RELEASE_FORBIDDEN");
    const receiptBytes = requireProductionReceipt(buildReceiptPath, manifest);
    if (current && current.authoritative_sha !== manifest.authoritative_sha) {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", current.authoritative_sha, manifest.authoritative_sha],
          { cwd: input.repository_path, stdio: "pipe", windowsHide: true });
      } catch { throw new Error("PUBLIC_STALE_OR_UNRELATED_COMMIT"); }
    }
    const currentManifest = current ? validatePublicRelease(path.join(input.delivery_root, "releases", current.release_id),
      JSON.parse(readFileSync(path.join(input.delivery_root, "releases", current.release_id, "presentation", "release.json"), "utf8"))) : null;
    if (current && currentManifest && current.authoritative_sha === manifest.authoritative_sha
      && current.snapshot_hash === manifest.snapshot_hash && currentManifest.implementation_sha === manifest.implementation_sha
      && currentManifest.base_path === manifest.base_path) return {
      release_id: current.release_id, authoritative_sha: current.authoritative_sha, snapshot_hash: current.snapshot_hash,
      action: "IDEMPOTENT", previous_pointer_hash: current.pointer_hash, recorded_at: new Date().toISOString()
    };
    input.fault_injector?.("BEFORE_RELEASE");
    const releases = path.join(input.delivery_root, "releases");
    assertNoSymlinks(releases);
    mkdirSync(releases, { recursive: true });
    const destination = path.join(releases, manifest.bundle_manifest_hash);
    assertNoSymlinks(destination);
    if (existsSync(destination)) validatePublicRelease(destination, manifest);
    else {
      const staged = path.join(releases, `.stage-${randomUUID()}`);
      cpSync(input.staged_release_path, staged, { recursive: true, errorOnExist: true, force: false });
      mkdirSync(path.join(staged, "presentation"), { recursive: true });
      const manifestPath = path.join(staged, "presentation", "release.json");
      if (existsSync(manifestPath)) unlinkSync(manifestPath);
      durableWrite(manifestPath, canonicalSerialize(manifest));
      for (const file of manifest.files) {
        const descriptor = openSync(path.join(staged, file.path), "r+");
        try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
      }
      validatePublicRelease(staged, manifest);
      renameSync(staged, destination);
    }
    const provenance = path.join(input.delivery_root, "release-provenance");
    assertNoSymlinks(provenance);
    mkdirSync(provenance, { recursive: true });
    const archivedReceipt = path.join(provenance, `${manifest.bundle_manifest_hash}.json`);
    assertNoSymlinks(archivedReceipt);
    if (existsSync(archivedReceipt)) requireProductionReceipt(archivedReceipt, manifest);
    else durableWrite(archivedReceipt, receiptBytes);
    input.fault_injector?.("AFTER_RELEASE");
    return switchPointer(input.delivery_root, manifest, input.expected_pointer_hash, "PUBLISH", input.fault_injector);
  });
}
export function rollbackPublicRelease(input: {
  readonly delivery_root: string; readonly release_id: string; readonly expected_pointer_hash: string; readonly actor: string;
}): PublicationReceipt {
  hashSchema.parse(input.release_id);
  if (!input.actor.trim()) throw new Error("PUBLIC_ROLLBACK_ACTOR_REQUIRED");
  return withPublicationLock(input.delivery_root, () => {
    const releasePath = path.join(input.delivery_root, "releases", input.release_id);
    const manifest = validatePublicRelease(releasePath, JSON.parse(readFileSync(path.join(releasePath, "presentation", "release.json"), "utf8")));
    if (manifest.bundle_manifest_hash !== input.release_id) throw new Error("PUBLIC_ROLLBACK_BINDING_MISMATCH");
    if (manifest.implementation_sha !== manifest.authoritative_sha) throw new Error("PUBLIC_TEST_ONLY_RELEASE_FORBIDDEN");
    requireProductionReceipt(path.join(input.delivery_root, "release-provenance", `${input.release_id}.json`), manifest);
    return switchPointer(input.delivery_root, manifest, input.expected_pointer_hash, "ROLLBACK");
  });
}
