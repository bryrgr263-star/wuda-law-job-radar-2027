import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { bootstrapZeroCostProductionCompositionRoot } from "../lib/production-persistence/zero-cost-production-composition-root";
import { GitSourceRegistryPersistence } from "../lib/production-persistence/git-source-registry-persistence";
import { enumerateScheduledSources } from "../lib/production-persistence/scheduler-source-enumeration";
import { createInitialProductionActivationVersions, INITIAL_PRODUCTION_ACTIVATION_AT,
  INITIAL_PRODUCTION_CADENCE_SECONDS } from "../lib/production-sources/initial-production-activation";

const approvedBase = "7b329dfd7580634873a9be374e64f3a4910fb6f8";
const identity = { name: "Approved Production Source Activation", email: "source-activation@invalid.local" };
const approvedTargets = [
  "allowlist-cn-zhenghan-2027-announcement",
  "allowlist-cn-zhenghan-2027-detail",
  "allowlist-cn-haier-2027-legal-rid-61"
];

async function main() {
  if (process.argv[2] !== "--offline-stage") throw new Error("OFFLINE_ACTIVATION_FLAG_REQUIRED");
  const workspace = process.cwd();
  if (git(workspace, "rev-parse", "HEAD") !== approvedBase
    || existsSync(path.join(workspace, "production-source-state"))) {
    throw new Error("ACTIVATION_BASE_OR_STATE_MISMATCH");
  }
  const temporary = mkdtempSync(path.join(os.tmpdir(), "initial-production-activation-"));
  try {
    const remote = path.join(temporary, "authoritative.git");
    const seed = path.join(temporary, "seed");
    git(temporary, "init", "--bare", "--quiet", remote);
    git(temporary, "init", "--quiet", "-b", "main", seed);
    writeFileSync(path.join(seed, "README.md"), "Offline production source activation staging\n");
    git(seed, "add", "README.md");
    git(seed, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`,
      "commit", "-qm", "Offline seed");
    git(seed, "remote", "add", "origin", remote);
    const sourceStore = new GitSourceRegistryPersistence({ repository_path: seed });
    for (const version of createInitialProductionActivationVersions()) await sourceStore.appendVersion(version);
    git(seed, "add", "production-source-state");
    git(seed, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`,
      "commit", "-qm", "Approved versioned source identities and admission");
    git(seed, "push", "origin", "HEAD:main");
    const options = { remote_url: remote, branch: "main", stream_id: "initial-production-source-activation",
      continuous_scope: "PRODUCTION" as const, execution_mode: "TEST_ONLY" as const,
      now: () => INITIAL_PRODUCTION_ACTIVATION_AT, commit_identity: identity };
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    const authorizationIds: string[] = [];
    for (const targetId of approvedTargets) {
      const issued = await root.issueContinuousAuthorization({ allowlist_entry_id: targetId,
        effective_from: INITIAL_PRODUCTION_ACTIVATION_AT,
        min_interval_seconds: INITIAL_PRODUCTION_CADENCE_SECONDS,
        actor: "approved-initial-source-activation" });
      authorizationIds.push(issued.record.payload.grant!.authorization_id);
    }
    const restored = await bootstrapZeroCostProductionCompositionRoot(options).restore();
    if (restored.continuous_authorizations.length !== approvedTargets.length
      || restored.continuous_authorizations.some(item => item.state !== "ACTIVE")) {
      throw new Error("ACTIVATION_PROCESS_B_RESTORATION_FAILED");
    }
    const checkout = path.join(temporary, "verification");
    git(temporary, "clone", "--quiet", "-b", "main", remote, checkout);
    const verifiedStore = new GitSourceRegistryPersistence({ repository_path: checkout });
    const selected = enumerateScheduledSources(await verifiedStore.listVersions(),
      verifiedStore.listContinuousRecords(), INITIAL_PRODUCTION_ACTIVATION_AT, "PRODUCTION");
    if (selected.eligible.length !== approvedTargets.length || selected.deferred.length
      || new Set(selected.eligible.map(item => item.source_definition_id)).size !== 2) {
      throw new Error("ACTIVATION_SCHEDULER_ENUMERATION_FAILED");
    }
    cpSync(path.join(checkout, "production-source-state"), path.join(workspace, "production-source-state"),
      { recursive: true, errorOnExist: true, force: false });
    console.log(JSON.stringify({ source_count: 2, exact_target_count: 3,
      cadence_seconds: INITIAL_PRODUCTION_CADENCE_SECONDS, authorization_ids: authorizationIds,
      source_version_count: restored.source_version_count,
      local_process_b: "PASS", scheduler_enumeration: "PASS", external_network_access: 0 }));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

void main();
