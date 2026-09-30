import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import { assertNoSymlinks, assertPublicAssetPath, parsePublicReleaseManifest,
  validatePublicRelease, type PublicReleaseManifest } from "./publication";
import { publicByteHash } from "./snapshot";

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_RELEASE_BYTES = 64 * 1024 * 1024;

export async function downloadVerifiedPagesRelease(input: {
  readonly manifest: PublicReleaseManifest;
  readonly base_url: string;
  readonly destination: string;
  readonly fetcher?: (url: string, options: RequestInit) => Promise<Response>;
}): Promise<PublicReleaseManifest> {
  const manifest = parsePublicReleaseManifest(input.manifest);
  const base = new URL(input.base_url);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash
    || base.pathname !== `${manifest.base_path}/`) throw new Error("PAGES_RELEASE_ORIGIN_INVALID");
  const destination = path.resolve(input.destination);
  if (!destination.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)
    || existsSync(destination)) throw new Error("PAGES_RELEASE_DESTINATION_INVALID");
  assertNoSymlinks(destination);
  if (manifest.files.length > 2048 || new Set(manifest.files.map(file => file.path)).size !== manifest.files.length
    || manifest.files.some(file => file.size > MAX_FILE_BYTES)
    || manifest.files.reduce((total, file) => total + file.size, 0) > MAX_RELEASE_BYTES) {
    throw new Error("PAGES_RELEASE_SIZE_INVALID");
  }
  for (const file of manifest.files) assertPublicAssetPath(file.path);
  mkdirSync(destination);
  try {
    for (const file of manifest.files) {
      const url = new URL(file.path, base).href;
      const response = await (input.fetcher ?? fetch)(url, {
        method: "GET", credentials: "omit", redirect: "error", cache: "no-store"
      });
      const recoverEmptyMarker = file.path === ".nojekyll" && response.status === 404
        && file.size === 0 && file.sha256 === publicByteHash(Buffer.alloc(0));
      if ((!recoverEmptyMarker && response.status !== 200)
        || response.redirected || (response.url && response.url !== url)) {
        throw new Error("PAGES_RELEASE_FETCH_FAILED");
      }
      const chunks: Buffer[] = [];
      let length = 0;
      if (!recoverEmptyMarker) {
        if (!response.body) throw new Error("PAGES_RELEASE_FETCH_FAILED");
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const bytes = Buffer.from(value);
            length += bytes.length;
            if (length > file.size || length > MAX_FILE_BYTES) throw new Error("PAGES_RELEASE_BYTES_INVALID");
            chunks.push(bytes);
          }
        } finally { reader.releaseLock(); }
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.length !== file.size || publicByteHash(bytes) !== file.sha256) {
        throw new Error("PAGES_RELEASE_BYTES_INVALID");
      }
      const target = path.join(destination, ...file.path.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: "wx" });
    }
    const releasePath = path.join(destination, "presentation", "release.json");
    writeFileSync(releasePath, canonicalSerialize(manifest), { flag: "wx" });
    return validatePublicRelease(destination, manifest);
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

export function retainVerifiedReleaseAssets(destination: string, releasePaths: readonly string[]) {
  assertNoSymlinks(destination);
  for (const releasePath of releasePaths) {
    assertNoSymlinks(releasePath);
    const manifest = validatePublicRelease(releasePath,
      JSON.parse(readFileSync(path.join(releasePath, "presentation", "release.json"), "utf8")));
    for (const file of manifest.files.filter(item =>
      item.path.startsWith("_next/static/") || item.path.startsWith("presentation/snapshots/"))) {
      const source = path.join(releasePath, ...file.path.split("/"));
      const target = path.join(destination, ...file.path.split("/"));
      if (existsSync(target)) {
        if (!readFileSync(target).equals(readFileSync(source))) throw new Error("PUBLIC_RETAINED_ASSET_COLLISION");
      } else {
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(source, target, constants.COPYFILE_EXCL);
      }
    }
  }
}
