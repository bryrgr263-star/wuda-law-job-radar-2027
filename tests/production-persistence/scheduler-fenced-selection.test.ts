import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { enumerateScheduledSources } from "../../lib/production-persistence/scheduler-source-enumeration";

test("Scheduler selection replays committed fencing with the repository-owned verifier", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "scheduler-fenced-selection-"));
  const checkout = path.join(directory, "checkout");
  execFileSync("git", ["clone", "--quiet", "--local", "--no-checkout", process.cwd(), checkout]);
  execFileSync("git", ["checkout", "--quiet", "019593739803bfee6efa033687f0263228fbae17"], { cwd: checkout });
  const repository = new GitSourceRegistryPersistence({ repository_path: checkout });
  const versions = await repository.listVersions();
  const records = repository.listContinuousRecords();
  const at = "2026-10-13T06:20:00.000Z";
  assert.throws(() => enumerateScheduledSources(versions, records, at, "PRODUCTION"), /FENCING_NOT_VERIFIED/u);
  const selected = enumerateScheduledSources(versions, records, at, "PRODUCTION", repository.continuousFencingVerifier);
  assert.ok(selected.eligible.length > 0);
  assert.equal(selected.eligible.some(source => source.exact_url.includes("chnenergy")), false);
  assert.ok(selected.deferred.some(source => source.authorization_id ===
    "continuous-authorization:cf21fe97ef558be4ad87890869230be516b445e77c40109c658adfc21fb91a1a"
    && source.reason === "CADENCE_DENIED"));
  assert.throws(() => enumerateScheduledSources(versions, records, at, "PRODUCTION", () => false), /FENCING_NOT_VERIFIED/u);
});
