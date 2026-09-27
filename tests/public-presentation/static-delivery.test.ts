import "../helpers/network-guard";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { prepareStaticDelivery, STATIC_CLIENT_FILES } from "../../lib/public-presentation/static-delivery";
import { createPublicSnapshot } from "../../lib/public-presentation/snapshot";
import { fixtureInput } from "./helpers";
import { publishFromAuthoritativeCommit } from "../../scripts/publish-public-presentation";
import { publishPublicRelease, readPublicationPointer } from "../../lib/public-presentation/publication";

test("isolated Next export reuses one UI, excludes private state, pins snapshot and supports project paths", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pub-build-test-"));
  const repository = path.join(temporary, "implementation");
  const previousOptions = process.env.NODE_OPTIONS;
  try {
    execFileSync("git", ["clone", "--local", "--no-checkout", process.cwd(), repository], { stdio: "pipe" });
    execFileSync("git", ["read-tree", "HEAD"], { cwd: repository });
    for (const filename of STATIC_CLIENT_FILES) {
      mkdirSync(path.dirname(path.join(repository, filename)), { recursive: true });
      copyFileSync(path.resolve(filename), path.join(repository, filename));
    }
    execFileSync("git", ["add", "--", ...STATIC_CLIENT_FILES], { cwd: repository });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "test-only candidate UI"], { cwd: repository, stdio: "pipe" });
    const implementationSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
    const snapshot = createPublicSnapshot(fixtureInput());
    const loader = pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href;
    const guard = pathToFileURL(path.resolve("tests/helpers/network-guard.ts")).href;
    process.env.NODE_OPTIONS = `--import=${loader} --import=${guard}`;
    let previousStage: string | undefined;
    let previousSnapshot: string | undefined;
    for (const basePath of ["", "/wuda-law-job-radar-2027"]) {
      const staging = path.join(temporary, basePath ? "project" : "root");
      const selected = basePath ? createPublicSnapshot({ ...fixtureInput(), generated_at: "2026-09-27T01:00:00.000Z" }) : snapshot;
      const manifest = await prepareStaticDelivery({ snapshot: selected, implementation_repository: repository,
        implementation_sha: implementationSha, base_path: basePath, staging_path: staging, test_only: true,
        previous_release_path: previousStage });
      assert.equal(manifest.authoritative_sha, fixtureInput().authoritative_sha);
      assert.equal(manifest.implementation_sha, implementationSha);
      assert.ok(manifest.files.every(item => !/\.git|RawBlob|journal|candidate-evidence|\.map$/u.test(item.path)));
      const html = readFileSync(path.join(staging, "index.html"), "utf8");
      assert.ok(html.includes(manifest.snapshot_hash));
      assert.ok(html.includes(manifest.authoritative_sha));
      assert.ok(html.includes(`${basePath}/_next/static/`));
      assert.ok(html.includes(`${basePath}/presentation/snapshots/`));
      assert.ok(!html.includes("PRIVATE_SENTINEL"));
      assert.ok(!manifest.files.some(item => item.path.startsWith("api/")));
      if (previousSnapshot) assert.ok(manifest.files.some(item => item.path === previousSnapshot));
      assert.equal(JSON.parse(readFileSync(`${staging}.build-receipt.json`, "utf8")).scope, "TEST_ONLY");
      assert.throws(() => publishPublicRelease({ delivery_root: path.join(temporary, "forbidden-test-delivery"),
        staged_release_path: staging, manifest, repository_path: repository, expected_pointer_hash: null }), /TEST_ONLY/);
      assert.ok(!manifest.files.some(item => item.path.endsWith(".map")));
      const js = manifest.files.filter(item => item.path.endsWith(".js"))
        .map(item => readFileSync(path.join(staging, item.path), "utf8")).join("\n");
      assert.doesNotMatch(js, /PRIVATE_SENTINEL|\/api\/jobs|match_score|non_law_rule|is_published|GitAppendOnlyExecutionStore|CandidateProfile/);
      previousStage = staging;
      previousSnapshot = manifest.snapshot_path;
    }
    await assert.rejects(prepareStaticDelivery({ snapshot, implementation_repository: repository,
      implementation_sha: implementationSha, base_path: "", staging_path: path.join(temporary, "mismatch") }), /SHA_MISMATCH/);
    const options = { repository_path: repository, authoritative_sha: implementationSha,
      stream_id: "initial-production-source-activation", base_path: "/radar", delivery_root: path.join(temporary, "cli-delivery") };
    const firstPublication = await publishFromAuthoritativeCommit(options);
    const current = readPublicationPointer(options.delivery_root)!;
    assert.equal(current.authoritative_sha, implementationSha);
    assert.equal(firstPublication.deployment, "NOT_EXECUTED");
    const published = JSON.parse(JSON.parse(readFileSync(path.join(options.delivery_root, "releases", current.release_id,
      "presentation", "snapshots", `${current.snapshot_hash}.json`), "utf8")).payload_canonical_bytes);
    assert.equal(published.position_count, 4);
    assert.ok(published.positions.every((item: { presentation_status: string }) => item.presentation_status === "EVIDENCE_BLOCKED"));
    const retried = await publishFromAuthoritativeCommit(options);
    assert.equal(retried.action, "IDEMPOTENT");
    assert.equal(retried.release_id, current.release_id);
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(), implementationSha);
  } finally {
    if (previousOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previousOptions;
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    rmSync(temporary, { recursive: true, force: true });
  }
});
