import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { shaSchema } from "./schema";
import type { PinnedCurrentInput } from "./snapshot";

const execute = promisify(execFile);
export async function restorePinnedCurrent(input: {
  readonly repository_path: string; readonly authoritative_sha: string; readonly stream_id: string;
}): Promise<PinnedCurrentInput> {
  shaSchema.parse(input.authoritative_sha);
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(input.stream_id)) throw new Error("PUBLIC_STREAM_INVALID");
  const repository = realpathSync(input.repository_path);
  const git = (args: string[], cwd = repository) => execFileSync("git", args, {
    cwd, encoding: "utf8", windowsHide: true, timeout: 60_000, stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  if (git(["cat-file", "-t", input.authoritative_sha]) !== "commit") throw new Error("PUBLIC_COMMIT_REQUIRED");
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pub-"));
  const checkout = path.join(temporary, "checkout");
  try {
    git(["-c", "protocol.allow=never", "-c", "protocol.file.allow=always", "clone", "--local", "--no-checkout", "--", repository, checkout]);
    git(["-c", "core.longpaths=true", "checkout", "--detach", input.authoritative_sha], checkout);
    const require = createRequire(import.meta.url);
    const result = await execute(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href,
      fileURLToPath(new URL("./process-b-worker.ts", import.meta.url)), checkout, input.authoritative_sha, input.stream_id],
    { windowsHide: true, encoding: "utf8", timeout: 900_000, maxBuffer: 32 * 1024 * 1024 });
    const restored = JSON.parse(result.stdout) as PinnedCurrentInput;
    if (restored.authoritative_sha !== input.authoritative_sha
      || restored.current_snapshot?.authoritative_head !== input.authoritative_sha
      || restored.current_snapshot.scope !== "PRODUCTION"
      || git(["rev-parse", "HEAD"], checkout) !== input.authoritative_sha) throw new Error("PUBLIC_RESTORE_BINDING_MISMATCH");
    return restored;
  } catch {
    throw new Error("PUBLIC_PROCESS_B_VALIDATION_FAILED");
  } finally {
    if (path.dirname(temporary) !== path.resolve(os.tmpdir())) throw new Error("PUBLIC_TEMP_BOUNDARY_INVALID");
    rmSync(temporary, { recursive: true, force: true });
  }
}
