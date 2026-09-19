import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { InMemorySourceAdmissionRegister } from "../../lib/application/source-admission";
import { InMemorySourceRegistry, UTF8_TEXT_ENCODING, type SourceDefinition } from "../../lib/ingestion";
import { createSourcePersistenceVersion, type SourcePersistenceVersion } from "../../lib/production-persistence/contracts";
import { resolveContinuousSourceContext } from "../../lib/production-persistence/continuous-source-context";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { rehydrateProductionSourceOwners } from "../../lib/production-persistence/source-owner-rehydration";
import { admission, endpoint } from "../p2-05/test-support";

export const AT = "2026-09-18T00:00:00.000Z";
export const LATER = "2026-09-18T00:02:00.000Z";
export const URL = "https://example.invalid/recruitment";
export const TARGET = "controlled-continuous-target";
export const identity = { name: "Controlled Authorization Test", email: "controlled@invalid.local" };
export const provenance = { scope: "PRODUCTION" as const, actor_id: "controlled-test", actor_role: "TEST_ONLY", evidence_references: ["fixture:continuous"] };

export function fixture(collectionConfig: Partial<ReturnType<typeof endpoint>["collection_config"]> = {}) {
  const base = admission({ level: "B", automation_basis: "HUMAN_APPROVED_CONTINUOUS_SCOPE", robots: "UNKNOWN", terms: "UNKNOWN" });
  const admitted = { ...base, continuous_acquisition_scope: { scope: "CONTROLLED_TEST" as const,
    exact_targets: [{ allowlist_entry_id: TARGET, exact_url: URL }], min_interval_seconds: 60,
    effective_from: AT, approval_review_id: base.review_records[0]!.source_admission_review_id } };
  const recruitmentEndpoint = endpoint(admitted, collectionConfig);
  const organization = { organization_id: "controlled-org" as SourceDefinition["publisher_organization_id"],
    name: { original: { text: "Controlled organization", encoding: UTF8_TEXT_ENCODING } }, aliases: [] };
  const source: SourceDefinition = { source_definition_id: recruitmentEndpoint.source_definition_id,
    publisher_organization_id: organization.organization_id, name: organization.name,
    publisher_kind: "EMPLOYER_OFFICIAL", authority_level: "OFFICIAL", scope: "SINGLE_ORGANIZATION", enabled: true };
  const versions: SourcePersistenceVersion[] = [];
  const append = (streamId: string, artifact: SourcePersistenceVersion["artifact"]) => {
    const version = createSourcePersistenceVersion({ stream_id: streamId, revision: 1,
      supersedes_artifact_id: null, artifact, provenance, effective_at: AT, created_at: AT });
    versions.push(version); return version;
  };
  append(organization.organization_id, { kind: "ORGANIZATION", payload: organization });
  append(recruitmentEndpoint.adapter_key, { kind: "ADAPTER_REGISTRATION", payload: {
    adapter_key: recruitmentEndpoint.adapter_key, name: organization.name, supported_content_kinds: ["HTML"] } });
  append(source.source_definition_id, { kind: "SOURCE_DEFINITION", payload: source });
  const endpointVersion = append(recruitmentEndpoint.recruitment_endpoint_id, { kind: "RECRUITMENT_ENDPOINT", payload: recruitmentEndpoint });
  const admissionVersion = append(admitted.source_admission_id, { kind: "SOURCE_ADMISSION", payload: admitted });
  append(TARGET, { kind: "OFFICIAL_ENDPOINT_ALLOWLIST", payload: { allowlist_entry_id: TARGET,
    recruitment_endpoint_artifact_id: endpointVersion.artifact_id, source_admission_artifact_id: admissionVersion.artifact_id,
    active: true, scheme: "https", host: "example.invalid", port: null, path_prefix: "/recruitment", exact_path: true,
    allowed_method: "GET", query_policy: { mode: "DENY_ALL", allowed_parameters: [] }, endpoint_purpose: "JOB_LIST",
    authority_level: "OFFICIAL", approval_evidence_ids: admitted.evidence.map(item => item.source_admission_evidence_id) } });
  const context = resolveContinuousSourceContext(versions, TARGET);
  const owner = new InMemorySourceAdmissionRegister(); owner.register(admitted);
  return { versions, context, owner, endpoint: recruitmentEndpoint, admitted };
}
export function issue(input = fixture(), changes = {}) {
  return input.owner.issueContinuousAuthorization(input.context, { effective_from: AT, min_interval_seconds: 60,
    actor: "controlled-reviewer", issued_at: AT, ...changes });
}
export const request = { locator: URL, method: "GET" as const, headers: {}, parameters: {} };
export function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
export async function createRemote(collectionConfig: Partial<ReturnType<typeof endpoint>["collection_config"]> = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "continuous-controlled-"));
  const remote = path.join(directory, "remote.git"); const seed = path.join(directory, "seed");
  execFileSync("git", ["init", "--bare", "--quiet", remote]);
  execFileSync("git", ["init", "--quiet", "-b", "main", seed]);
  writeFileSync(path.join(seed, "README.md"), "Controlled offline persistence test\n");
  git(seed, "add", "README.md");
  git(seed, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "Controlled initial state");
  git(seed, "remote", "add", "origin", remote);
  const input = fixture(collectionConfig); const repository = new GitSourceRegistryPersistence({ repository_path: seed });
  for (const version of input.versions) await repository.appendVersion(version);
  git(seed, "add", "production-source-state");
  git(seed, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "Controlled source contract");
  git(seed, "push", "origin", "HEAD:main");
  let sequence = 0;
  return { directory, remote, input,
    clone() { sequence += 1; const checkout = path.join(directory, `writer-${sequence}`);
      execFileSync("git", ["clone", "--quiet", "-b", "main", remote, checkout]); return checkout; },
    remove() { const resolved = path.resolve(directory); if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe test directory");
      rmSync(resolved, { recursive: true, force: true }); } };
}
export async function restoreOwner(repository: GitSourceRegistryPersistence) {
  const owner = new InMemorySourceAdmissionRegister();
  await rehydrateProductionSourceOwners({ repository, source_registry: new InMemorySourceRegistry(),
    source_admission_register: owner, continuous_records: repository.listContinuousRecords() });
  return owner;
}
