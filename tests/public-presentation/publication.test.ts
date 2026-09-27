import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { assertPublicAssetPath, createBuildReceipt, createReleaseManifest, publishPublicRelease, readPublicationPointer, rollbackPublicRelease, validatePublicRelease } from "../../lib/public-presentation/publication";
import { canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { createPublicSnapshot } from "../../lib/public-presentation/snapshot";
import { fixtureInput } from "./helpers";

test("atomic LKG, fault injection, idempotency, CAS, stale retry and explicit rollback", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pub-test-"));
  const delivery = path.join(temporary, "delivery");
  const repository = path.join(temporary, "repo");
  execFileSync("git", ["init", repository], { stdio: "pipe" });
  const commit = (value: string) => {
    writeFileSync(path.join(repository, "marker"), value);
    execFileSync("git", ["add", "marker"], { cwd: repository });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", value], { cwd: repository, stdio: "pipe" });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
  };
  const prepare = (sha: string, name: string) => {
    const stage = path.join(temporary, name);
    mkdirSync(path.join(stage, "presentation", "snapshots"), { recursive: true });
    const input = fixtureInput();
    input.authoritative_sha = sha;
    input.current_snapshot = { ...input.current_snapshot, authoritative_head: sha };
    const envelope = createPublicSnapshot(input);
    writeFileSync(path.join(stage, "index.html"), "<html>same reused UI build</html>");
    writeFileSync(path.join(stage, "presentation", "snapshots", `${envelope.payload_sha256}.json`), canonicalSerialize(envelope));
    const manifest = createReleaseManifest(stage, { authoritative_sha: sha, implementation_sha: sha,
      snapshot_hash: envelope.payload_sha256, base_path: "" });
    writeFileSync(`${stage}.build-receipt.json`, canonicalSerialize(createBuildReceipt(manifest, "PRODUCTION")));
    return { stage, manifest };
  };
  try {
    const firstSha = commit("first");
    const first = prepare(firstSha, "first-stage");
    const publish = (item: typeof first, expected: string | null, fault?: (point: string) => void) =>
      publishPublicRelease({ delivery_root: delivery, staged_release_path: item.stage, manifest: item.manifest,
        repository_path: repository, expected_pointer_hash: expected, fault_injector: fault });
    const receipt = publish(first, null);
    const pointer = readPublicationPointer(delivery)!;
    assert.equal(publish(first, pointer.pointer_hash).action, "IDEMPOTENT");
    const retryStage = prepare(firstSha, "retry-stage");
    writeFileSync(path.join(retryStage.stage, "index.html"), "<html>different build output, identical data and pinned implementation</html>");
    retryStage.manifest = createReleaseManifest(retryStage.stage, retryStage.manifest);
    writeFileSync(`${retryStage.stage}.build-receipt.json`, canonicalSerialize(createBuildReceipt(retryStage.manifest, "PRODUCTION")));
    assert.equal(publish(retryStage, pointer.pointer_hash).release_id, receipt.release_id);
    assert.throws(() => publish({ ...first, manifest: createReleaseManifest(first.stage,
      { ...first.manifest, implementation_sha: "0".repeat(40) }) }, pointer.pointer_hash), /TEST_ONLY/);
    const oldBytes = readFileSync(path.join(delivery, "current.json"), "utf8");
    const secondSha = commit("second");
    const second = prepare(secondSha, "second-stage");
    for (const point of ["BEFORE_RELEASE", "AFTER_RELEASE", "BEFORE_POINTER"]) {
      assert.throws(() => publish(second, pointer.pointer_hash, current => { if (current === point) throw new Error("injected"); }));
      assert.equal(readFileSync(path.join(delivery, "current.json"), "utf8"), oldBytes);
    }
    if (process.platform === "win32") {
      let blockedAttempts = 0;
      assert.throws(() => publish(second, pointer.pointer_hash, point => {
        if (point === "POINTER_REPLACE") { blockedAttempts++; throw Object.assign(new Error("sharing violation"), { code: "EPERM" }); }
      }), /sharing violation/);
      assert.equal(blockedAttempts, 8);
      assert.equal(readFileSync(path.join(delivery, "current.json"), "utf8"), oldBytes);
    }
    let transientAttempts = 0;
    if (process.platform === "win32") {
      const recovered = publish(second, pointer.pointer_hash, point => {
        if (point === "POINTER_REPLACE") { transientAttempts++; if (transientAttempts < 3) throw Object.assign(new Error("sharing violation"), { code: "EPERM" }); }
      });
      assert.equal(recovered.action, "PUBLISH");
      assert.equal(transientAttempts, 3);
    }
    const next = publish(second, readPublicationPointer(delivery)!.pointer_hash);
    assert.equal(readPublicationPointer(delivery)?.authoritative_sha, secondSha);
    assert.throws(() => publish(first, readPublicationPointer(delivery)!.pointer_hash), /STALE/);
    assert.throws(() => publish(second, pointer.pointer_hash), /CAS/);
    const rolled = rollbackPublicRelease({ delivery_root: delivery, release_id: receipt.release_id,
      expected_pointer_hash: readPublicationPointer(delivery)!.pointer_hash, actor: "offline-test" });
    assert.equal(rolled.action, "ROLLBACK");
    assert.equal(readPublicationPointer(delivery)?.authoritative_sha, firstSha);
    writeFileSync(path.join(delivery, ".publication.lock"), "existing writer");
    assert.throws(() => publish(second, readPublicationPointer(delivery)!.pointer_hash), /LOCK/);
    assert.equal(next.authoritative_sha, secondSha);
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("fresh concurrent reader sees only complete old/new pointer and matching sealed payload on native filesystem", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pub-race-"));
  const delivery = path.join(temporary, "delivery");
  const repository = path.join(temporary, "repo");
  let reader: ReturnType<typeof spawn> | undefined;
  try {
    execFileSync("git", ["init", repository], { stdio: "pipe" });
    const stages: Array<{ stage: string; manifest: ReturnType<typeof createReleaseManifest> }> = [];
    for (const name of ["first", "second"]) {
      writeFileSync(path.join(repository, "marker"), name);
      execFileSync("git", ["add", "marker"], { cwd: repository });
      execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", name], { cwd: repository, stdio: "pipe" });
      const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
      const input = fixtureInput();
      const envelope = createPublicSnapshot({ ...input, authoritative_sha: sha,
        current_snapshot: { ...input.current_snapshot, authoritative_head: sha } });
      const stage = path.join(temporary, name);
      mkdirSync(path.join(stage, "presentation", "snapshots"), { recursive: true });
      writeFileSync(path.join(stage, "index.html"), "<html>reused client artifact</html>");
      writeFileSync(path.join(stage, "presentation", "snapshots", `${envelope.payload_sha256}.json`), canonicalSerialize(envelope));
      const manifest = createReleaseManifest(stage, { authoritative_sha: sha,
        implementation_sha: sha, snapshot_hash: envelope.payload_sha256, base_path: "" });
      writeFileSync(`${stage}.build-receipt.json`, canonicalSerialize(createBuildReceipt(manifest, "PRODUCTION")));
      stages.push({ stage, manifest });
    }
    const first = publishPublicRelease({ delivery_root: delivery, staged_release_path: stages[0].stage,
      manifest: stages[0].manifest, repository_path: repository, expected_pointer_hash: null });
    const stop = path.join(temporary, "stop");
    const source = `const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');let samples=0;const failures=[];const timer=setInterval(()=>{try{const pointer=JSON.parse(fs.readFileSync(path.join(process.argv[1],'current.json'),'utf8'));const envelope=JSON.parse(fs.readFileSync(path.join(process.argv[1],'releases',pointer.release_id,'presentation','snapshots',pointer.snapshot_hash+'.json'),'utf8'));const payload=JSON.parse(envelope.payload_canonical_bytes);if(payload.authoritative_sha!==pointer.authoritative_sha||crypto.createHash('sha256').update(envelope.payload_canonical_bytes).digest('hex')!==pointer.snapshot_hash)throw Error('mixed');samples++;}catch(error){failures.push(error.message);}if(fs.existsSync(process.argv[2])){clearInterval(timer);process.stdout.write(JSON.stringify({samples,failures}));}},1);process.stdout.write('READY\\n');`;
    reader = spawn(process.execPath, ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
      "--import", pathToFileURL(path.resolve("tests/helpers/network-guard.ts")).href,
      "-e", source, delivery, stop], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const ready = new Promise<void>((resolve, reject) => {
      reader!.stdout!.on("data", chunk => { output += chunk.toString(); if (output.includes("READY\n")) resolve(); });
      reader!.on("error", reject);
    });
    const exited = new Promise<number | null>(resolve => reader!.on("exit", resolve));
    await ready;
    for (let index = 0; index < 30; index++) {
      publishPublicRelease({ delivery_root: delivery, staged_release_path: stages[1].stage, manifest: stages[1].manifest,
        repository_path: repository, expected_pointer_hash: readPublicationPointer(delivery)!.pointer_hash });
      rollbackPublicRelease({ delivery_root: delivery, release_id: first.release_id,
        expected_pointer_hash: readPublicationPointer(delivery)!.pointer_hash, actor: "race-test" });
    }
    writeFileSync(stop, "stop");
    assert.equal(await exited, 0);
    const result = JSON.parse(output.slice(output.indexOf("\n") + 1));
    assert.ok(result.samples > 0);
    assert.deepEqual(result.failures, []);
  } finally {
    reader?.kill();
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("TEST_ONLY implementation mismatch cannot become a production current release", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pub-scope-"));
  try {
    const stage = path.join(temporary, "stage");
    mkdirSync(path.join(stage, "presentation", "snapshots"), { recursive: true });
    const input = fixtureInput();
    const envelope = createPublicSnapshot(input);
    writeFileSync(path.join(stage, "index.html"), "<html>test-only</html>");
    writeFileSync(path.join(stage, "presentation", "snapshots", `${envelope.payload_sha256}.json`), canonicalSerialize(envelope));
    const manifest = createReleaseManifest(stage, { authoritative_sha: input.authoritative_sha,
      implementation_sha: "0".repeat(40), snapshot_hash: envelope.payload_sha256, base_path: "" });
    assert.throws(() => publishPublicRelease({ delivery_root: path.join(temporary, "delivery"),
      staged_release_path: stage, manifest, repository_path: process.cwd(), expected_pointer_hash: null }), /TEST_ONLY/);
    const equalShaManifest = createReleaseManifest(stage, { ...manifest, implementation_sha: input.authoritative_sha });
    assert.throws(() => publishPublicRelease({ delivery_root: path.join(temporary, "delivery"),
      staged_release_path: stage, manifest: equalShaManifest, repository_path: process.cwd(), expected_pointer_hash: null }), /RECEIPT_REQUIRED/);
    writeFileSync(`${stage}.build-receipt.json`, canonicalSerialize(createBuildReceipt(equalShaManifest, "TEST_ONLY")));
    assert.throws(() => publishPublicRelease({ delivery_root: path.join(temporary, "delivery"),
      staged_release_path: stage, manifest: equalShaManifest, repository_path: process.cwd(), expected_pointer_hash: null }), /TEST_ONLY/);
    writeFileSync(`${stage}.build-receipt.json`, canonicalSerialize(createBuildReceipt(equalShaManifest, "PRODUCTION")));
    const delivery = path.join(temporary, "delivery");
    const published = publishPublicRelease({ delivery_root: delivery, staged_release_path: stage,
      manifest: equalShaManifest, repository_path: process.cwd(), expected_pointer_hash: null });
    const pointerHash = readPublicationPointer(delivery)!.pointer_hash;
    const provenancePath = path.join(delivery, "release-provenance", `${published.release_id}.json`);
    writeFileSync(provenancePath, canonicalSerialize(createBuildReceipt(equalShaManifest, "TEST_ONLY")));
    assert.throws(() => rollbackPublicRelease({ delivery_root: delivery, release_id: published.release_id,
      expected_pointer_hash: pointerHash, actor: "scope-test" }), /TEST_ONLY/);
    unlinkSync(provenancePath);
    assert.throws(() => rollbackPublicRelease({ delivery_root: delivery, release_id: published.release_id,
      expected_pointer_hash: pointerHash, actor: "scope-test" }), /RECEIPT_REQUIRED/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("release corruption, traversal, unapproved assets and symlinks fail before changing current", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pub-assets-"));
  try {
    const stage = path.join(temporary, "stage");
    mkdirSync(path.join(stage, "presentation", "snapshots"), { recursive: true });
    const input = fixtureInput();
    const envelope = createPublicSnapshot(input);
    const html = path.join(stage, "index.html");
    writeFileSync(html, "<html>safe</html>");
    writeFileSync(path.join(stage, "presentation", "snapshots", `${envelope.payload_sha256}.json`), canonicalSerialize(envelope));
    const manifest = createReleaseManifest(stage, { authoritative_sha: input.authoritative_sha,
      implementation_sha: input.authoritative_sha, snapshot_hash: envelope.payload_sha256, base_path: "" });
    writeFileSync(`${stage}.build-receipt.json`, canonicalSerialize(createBuildReceipt(manifest, "PRODUCTION")));
    const delivery = path.join(temporary, "delivery");
    publishPublicRelease({ delivery_root: delivery, staged_release_path: stage, manifest,
      repository_path: process.cwd(), expected_pointer_hash: null });
    const before = readFileSync(path.join(delivery, "current.json"), "utf8");
    writeFileSync(html, "<html>tampered</html>");
    assert.throws(() => validatePublicRelease(stage, manifest), /INTEGRITY/);
    assert.throws(() => publishPublicRelease({ delivery_root: delivery, staged_release_path: stage, manifest,
      repository_path: process.cwd(), expected_pointer_hash: readPublicationPointer(delivery)!.pointer_hash }), /INTEGRITY/);
    assert.equal(readFileSync(path.join(delivery, "current.json"), "utf8"), before);
    for (const filename of ["../secret", "_next/static/../secret.js", "RawBlob.json", ".git/config", "index.html.map", "candidate.json"]) {
      assert.throws(() => assertPublicAssetPath(filename));
    }
    const target = path.join(temporary, "private");
    mkdirSync(target);
    symlinkSync(target, path.join(stage, "linked"), process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => createReleaseManifest(stage, manifest), /SYMLINK/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
