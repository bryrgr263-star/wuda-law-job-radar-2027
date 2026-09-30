import { execFile, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import { shaSchema, type PublicSnapshotEnvelope } from "./schema";
import { validatePublicSnapshot } from "./snapshot";
import { retainVerifiedReleaseAssets } from "./pages-retention";
import { assertNoSymlinks, createBuildReceipt, createReleaseManifest, type PublicReleaseManifest } from "./publication";

export const STATIC_CLIENT_FILES = [
  "components/job-board.tsx", "components/public-presentation-board.tsx", "lib/presentation-web/model.ts",
  "lib/presentation-web/public-loader.ts", "lib/public-presentation/schema.ts", "app/globals.css",
  "lib/ingestion/domain/presentation.ts", "lib/ingestion/domain/primitives.ts"
] as const;
const execute = promisify(execFile);
export async function prepareStaticDelivery(input: {
  readonly snapshot: PublicSnapshotEnvelope; readonly implementation_repository: string; readonly implementation_sha: string;
  readonly base_path: string; readonly staging_path: string; readonly test_only?: boolean;
  readonly previous_release_path?: string;
  readonly additional_previous_release_paths?: readonly string[];
}): Promise<PublicReleaseManifest> {
  shaSchema.parse(input.implementation_sha);
  const payload = JSON.parse(input.snapshot.payload_canonical_bytes) as { authoritative_sha: string };
  validatePublicSnapshot(input.snapshot, payload.authoritative_sha, input.snapshot.payload_sha256);
  if (!input.test_only && input.implementation_sha !== payload.authoritative_sha) throw new Error("PUBLIC_IMPLEMENTATION_SHA_MISMATCH");
  if (!/^(?:\/[A-Za-z0-9_-]+)*$/u.test(input.base_path)) throw new Error("PUBLIC_BASE_PATH_INVALID");
  assertNoSymlinks(input.staging_path);
  if (existsSync(input.staging_path)) throw new Error("PUBLIC_STAGE_ALREADY_EXISTS");
  const repository = realpathSync(input.implementation_repository);
  const relative = path.relative(repository, path.resolve(input.staging_path));
  if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error("PUBLIC_STAGE_INSIDE_AUTHORITY");
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pub-next-"));
  try {
    for (const filename of STATIC_CLIENT_FILES) {
      const bytes = execFileSync("git", ["show", `${input.implementation_sha}:${filename}`], {
        cwd: repository, windowsHide: true, maxBuffer: 16 * 1024 * 1024
      });
      const destination = path.join(temporary, filename);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, bytes);
    }
    const require = createRequire(import.meta.url);
    const nextBinary = require.resolve("next/dist/bin/next");
    const nodeModules = fileURLToPath(new URL("../../node_modules", import.meta.url));
    const pinnedLock = execFileSync("git", ["show", `${input.implementation_sha}:pnpm-lock.yaml`], { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
    if (!pinnedLock.equals(readFileSync(fileURLToPath(new URL("../../pnpm-lock.yaml", import.meta.url))))) throw new Error("PUBLIC_DEPENDENCY_LOCK_MISMATCH");
    symlinkSync(nodeModules, path.join(temporary, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    writeFileSync(path.join(temporary, "package.json"), JSON.stringify({ private: true,
      dependencies: { next: "*", react: "*", "react-dom": "*", "lucide-react": "*", zod: "*" } }));
    writeFileSync(path.join(temporary, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      target: "ES2022", lib: ["dom", "dom.iterable", "esnext"], strict: true, skipLibCheck: true,
      noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler",
      jsx: "preserve", isolatedModules: true, resolveJsonModule: true, paths: { "@/*": ["./*"] }
    }, include: ["**/*.ts", "**/*.tsx", ".next/types/**/*.ts"], exclude: ["node_modules"] }));
    writeFileSync(path.join(temporary, "next.config.mjs"), `export default ${JSON.stringify({
      output: "export", poweredByHeader: false, basePath: input.base_path, trailingSlash: true
    })};`);
    const snapshotUrl = `${input.base_path}/presentation/snapshots/${input.snapshot.payload_sha256}.json`;
    writeFileSync(path.join(temporary, "app", "page.tsx"),
      `import React from "react";import {PublicPresentationBoard} from "../components/public-presentation-board";export default function Page(){return <PublicPresentationBoard snapshotUrl=${JSON.stringify(snapshotUrl)} authoritativeSha=${JSON.stringify(payload.authoritative_sha)} snapshotHash=${JSON.stringify(input.snapshot.payload_sha256)}/>;}`);
    writeFileSync(path.join(temporary, "app", "layout.tsx"),
      'import React from "react";import "./globals.css";export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}');
    try {
      await execute(process.execPath, [nextBinary, "build"], { cwd: temporary, windowsHide: true,
        timeout: 600_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
    } catch (error) { throw new Error("PUBLIC_STATIC_BUILD_FAILED", { cause: error }); }
    cpSync(path.join(temporary, "out"), input.staging_path, { recursive: true, errorOnExist: true, force: false });
    mkdirSync(path.join(input.staging_path, "presentation", "snapshots"), { recursive: true });
    writeFileSync(path.join(input.staging_path, "presentation", "snapshots", `${input.snapshot.payload_sha256}.json`), canonicalSerialize(input.snapshot));
    writeFileSync(path.join(input.staging_path, ".nojekyll"), "");
    retainVerifiedReleaseAssets(input.staging_path, [
      ...(input.previous_release_path ? [input.previous_release_path] : []),
      ...(input.additional_previous_release_paths ?? [])
    ]);
    const manifest = createReleaseManifest(input.staging_path, { authoritative_sha: payload.authoritative_sha,
      implementation_sha: input.implementation_sha, snapshot_hash: input.snapshot.payload_sha256, base_path: input.base_path });
    writeFileSync(path.join(input.staging_path, "presentation", "release.json"), canonicalSerialize(manifest));
    writeFileSync(`${input.staging_path}.build-receipt.json`, canonicalSerialize(createBuildReceipt(manifest,
      input.test_only ? "TEST_ONLY" : "PRODUCTION")), { flag: "wx", mode: 0o600 });
    return manifest;
  } finally {
    if (path.dirname(temporary) !== path.resolve(os.tmpdir())) throw new Error("PUBLIC_TEMP_BOUNDARY_INVALID");
    rmSync(temporary, { recursive: true, force: true });
  }
}
