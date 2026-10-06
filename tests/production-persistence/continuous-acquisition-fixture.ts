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
import { canonicalHash } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { sealQueryAuthorizationContract } from "../../lib/application/source-admission/query-authorization";
import type { ContinuousSourceContext } from "../../lib/application/source-admission/continuous-acquisition";

export const AT = "2026-09-18T00:00:00.000Z";
export const LATER = "2026-09-18T00:02:00.000Z";
export const URL = "https://example.invalid/recruitment";
export const TARGET = "controlled-continuous-target";
export const identity = { name: "Controlled Authorization Test", email: "controlled@invalid.local" };
export const provenance = { scope: "PRODUCTION" as const, actor_id: "controlled-test", actor_role: "TEST_ONLY", evidence_references: ["fixture:continuous"] };

export function fixture(collectionConfig: Partial<ReturnType<typeof endpoint>["collection_config"]> = {},
  contentKind: "HTML" | "JSON" = "HTML", queryPages = 0) {
  const contract = queryPages ? sealQueryAuthorizationContract({ schema_version: "query-authorization/2.0.0", base_exact_url: URL,
    parameters: [{ name: "page", required: true, allowed_values: Array.from({ length: queryPages }, (_, index) => String(index + 1)) }],
    approved_combinations: Array.from({ length: queryPages }, (_, index) => [{ name: "page", value: String(index + 1) }]),
    pagination: { parameter: "page", minimum_page: 1, maximum_page: queryPages, ordering: "ASCENDING_INTEGER", empty_stop: "STOP", repeated_content_stop: "STOP" },
    maximum_pages: queryPages, request_budget: queryPages, canonicalization: "QUERY_ASCII_RFC3986_V1" }) : null;
  const base = admission({ level: "B", automation_basis: "HUMAN_APPROVED_CONTINUOUS_SCOPE", robots: "UNKNOWN", terms: "UNKNOWN" });
  const admitted = { ...base, content_kind: contentKind, continuous_acquisition_scope: { scope: "CONTROLLED_TEST" as const,
    exact_targets: contract ? Array.from({ length: queryPages }, (_, index) => ({ allowlist_entry_id: `${TARGET}-page-${index + 1}`,
      exact_url: `${URL}?page=${index + 1}`, query_contract_hash: contract.contract_hash })) : [{ allowlist_entry_id: TARGET, exact_url: URL }], min_interval_seconds: 60,
    effective_from: AT, approval_review_id: base.review_records[0]!.source_admission_review_id } };
  const recruitmentEndpoint = { ...endpoint(admitted, collectionConfig), content_kind: contentKind,
    adapter_key: contentKind === "JSON" ? "p2-05-test-json" : "p2-05-test-only" };
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
    adapter_key: recruitmentEndpoint.adapter_key, name: organization.name, supported_content_kinds: [contentKind] } });
  append(source.source_definition_id, { kind: "SOURCE_DEFINITION", payload: source });
  const endpointVersion = append(recruitmentEndpoint.recruitment_endpoint_id, { kind: "RECRUITMENT_ENDPOINT", payload: recruitmentEndpoint });
  const admissionVersion = append(admitted.source_admission_id, { kind: "SOURCE_ADMISSION", payload: admitted });
  for (const target of admitted.continuous_acquisition_scope.exact_targets) append(target.allowlist_entry_id, { kind: "OFFICIAL_ENDPOINT_ALLOWLIST", payload: { allowlist_entry_id: target.allowlist_entry_id,
    recruitment_endpoint_artifact_id: endpointVersion.artifact_id, source_admission_artifact_id: admissionVersion.artifact_id,
    active: true, scheme: "https", host: "example.invalid", port: null, path_prefix: "/recruitment", exact_path: true,
    allowed_method: "GET", query_policy: contract ? { mode: "FINITE_VALUES", contract } : { mode: "DENY_ALL", allowed_parameters: [] }, endpoint_purpose: "JOB_LIST",
    authority_level: "OFFICIAL", approval_evidence_ids: admitted.evidence.map(item => item.source_admission_evidence_id) } });
  const context = resolveContinuousSourceContext(versions, admitted.continuous_acquisition_scope.exact_targets[0]!.allowlist_entry_id);
  const owner = new InMemorySourceAdmissionRegister(); owner.register(admitted);
  return { versions, context, owner, endpoint: recruitmentEndpoint, admitted };
}
export function issue(input = fixture(), changes = {}) {
  return input.owner.issueContinuousAuthorization(input.context, { effective_from: AT, min_interval_seconds: 60,
    actor: "controlled-reviewer", issued_at: AT, ...changes });
}
export const request = { locator: URL, method: "GET" as const, headers: {}, parameters: {} };
export function queryContext(): ContinuousSourceContext {
  const context = structuredClone(fixture().context);
  const contract = sealQueryAuthorizationContract({ schema_version: "query-authorization/2.0.0", base_exact_url: request.locator,
    parameters: [{ name: "page", required: true, allowed_values: ["1", "2"] }],
    approved_combinations: [[{ name: "page", value: "1" }], [{ name: "page", value: "2" }]],
    pagination: { parameter: "page", minimum_page: 1, maximum_page: 2, ordering: "ASCENDING_INTEGER", empty_stop: "STOP", repeated_content_stop: "STOP" },
    maximum_pages: 2, request_budget: 2, canonicalization: "QUERY_ASCII_RFC3986_V1" });
  const admission = { ...context.admission, continuous_acquisition_scope: { ...context.admission.continuous_acquisition_scope!,
    exact_targets: [1, 2].map(page => ({ allowlist_entry_id: page === 1 ? context.bindings.target.id : "controlled-query-page-2", exact_url: `${request.locator}?page=${page}`, query_contract_hash: contract.contract_hash })) } };
  const target = { ...context.target, query_policy: { mode: "FINITE_VALUES", contract } };
  return { ...context, admission, target, bindings: { ...context.bindings,
    admission: { ...context.bindings.admission, semantic_hash: canonicalHash(admission) },
    target: { ...context.bindings.target, semantic_hash: canonicalHash(target) } } };
}
export function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
export async function createRemote(collectionConfig: Partial<ReturnType<typeof endpoint>["collection_config"]> = {},
  contentKind: "HTML" | "JSON" = "HTML", queryPages = 0) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "continuous-controlled-"));
  const remote = path.join(directory, "remote.git"); const seed = path.join(directory, "seed");
  execFileSync("git", ["init", "--bare", "--quiet", remote]);
  execFileSync("git", ["init", "--quiet", "-b", "main", seed]);
  writeFileSync(path.join(seed, "README.md"), "Controlled offline persistence test\n");
  git(seed, "add", "README.md");
  git(seed, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "Controlled initial state");
  git(seed, "remote", "add", "origin", remote);
  const input = fixture(collectionConfig, contentKind, queryPages); const repository = new GitSourceRegistryPersistence({ repository_path: seed });
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
