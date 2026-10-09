import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import * as factory from "../../lib/production-sources/chnenergy-support-source-versions";
import { createChnenergy2027SourceVersions, CHNENERGY_CAMPAIGN_URL, CHNENERGY_JOBS } from "../../lib/production-sources/chnenergy-2027-source";
import { canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { assertSourcePersistenceVersion, assertOfficialRequestAllowed, createSourcePersistenceVersion } from "../../lib/production-persistence/contracts";
import { supportingInspectionReplay } from "../../lib/production-persistence/source-inspection-replay";
import { validateSourceAdmission } from "../../lib/application/source-admission/source-admission-register";

const provenance = { scope: "PRODUCTION" as const, actor_id: "TEST_ONLY", actor_role: "TEST_ONLY", evidence_references: ["TEST_ONLY:explicit-support-review"] };
const prior = createChnenergy2027SourceVersions({ observed_at: "2026-10-06T07:00:00.000Z", provenance });
const input = { existing_versions: prior, approved_at: "2026-10-09T07:00:00.000Z", reviewer: "TEST_ONLY",
  approval_reference: "TEST_ONLY:explicit-three-target-approval", provenance };

test("support versions reuse source identity and allow only three one-use exact targets", () => {
  const before = canonicalSerialize(prior);
  const added = factory.createChnenergySupportingSourceVersions(input);
  assert.equal(canonicalSerialize(prior), before);
  added.forEach(assertSourcePersistenceVersion);
  assert.equal(added.some(version => ["SOURCE_DEFINITION", "ORGANIZATION", "SUPPORTING_INSPECTION_EXECUTION"].includes(version.artifact.kind)), false);
  const endpoints = added.filter(version => version.artifact.kind === "RECRUITMENT_ENDPOINT");
  assert.deepEqual(endpoints.map(version => version.artifact.kind === "RECRUITMENT_ENDPOINT" ? version.artifact.payload.locator : null),
    [CHNENERGY_CAMPAIGN_URL, ...CHNENERGY_JOBS.map(job => job.membership_url)]);
  for (const version of added) {
    if (version.artifact.kind === "SOURCE_ADMISSION") {
      validateSourceAdmission(version.artifact.payload);
      assert.equal(version.artifact.payload.automation_basis, "HUMAN_REVIEWED_CANARY");
      assert.equal(version.artifact.payload.continuous_acquisition_scope, undefined);
      assert.ok(!canonicalSerialize(version).includes("e929662a"));
    }
    if (version.artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST") {
      const allowlist = version.artifact.payload;
      const target = endpoints.find(endpoint => endpoint.artifact_id === allowlist.recruitment_endpoint_artifact_id);
      assert.ok(target?.artifact.kind === "RECRUITMENT_ENDPOINT");
      const locator = target.artifact.payload.locator;
      assertOfficialRequestAllowed(allowlist, locator, "GET");
      assert.throws(() => assertOfficialRequestAllowed(allowlist, locator + "&page=2", "GET"));
    }
  }
  assert.equal(added.length, 10);
  assert.equal(canonicalSerialize(added), canonicalSerialize(factory.createChnenergySupportingSourceVersions(input)));
});

test("missing source, duplicate installation and empty approval fail closed", () => {
  assert.throws(() => factory.createChnenergySupportingSourceVersions({ ...input, existing_versions: [] }));
  const added = factory.createChnenergySupportingSourceVersions(input);
  assert.throws(() => factory.createChnenergySupportingSourceVersions({ ...input, existing_versions: [...prior, ...added] }));
  assert.throws(() => factory.createChnenergySupportingSourceVersions({ ...input, approval_reference: "" }));
});

test("constructed source context resolves through existing one-use admission replay without continuous grant", () => {
  const added = factory.createChnenergySupportingSourceVersions(input);
  const source = prior.find(version => version.artifact.kind === "SOURCE_DEFINITION")!;
  const adapter = added.find(version => version.artifact.kind === "ADAPTER_REGISTRATION")!;
  const claims = added.filter(version => version.artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST").map(version => {
    if (version.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST" || version.artifact.payload.query_policy.mode !== "FINITE_VALUES") assert.fail();
    const allowlist = version.artifact.payload;
    const endpoint = added.find(item => item.artifact_id === allowlist.recruitment_endpoint_artifact_id)!;
    const admission = added.find(item => item.artifact_id === allowlist.source_admission_artifact_id)!;
    if (endpoint.artifact.kind !== "RECRUITMENT_ENDPOINT" || admission.artifact.kind !== "SOURCE_ADMISSION") assert.fail();
    const runId = `TEST_ONLY:${endpoint.stream_id}`;
    return createSourcePersistenceVersion({ stream_id: runId, revision: 1, supersedes_artifact_id: null,
      effective_at: input.approved_at, created_at: input.approved_at, provenance,
      artifact: { kind: "SUPPORTING_INSPECTION_EXECUTION", payload: JSON.parse(JSON.stringify({
        schema_version: "supporting-inspection-execution/1.0.0", state: "CLAIMED", method: "GET",
        exact_url: endpoint.artifact.payload.locator, claimed_at: input.approved_at,
        query_contract_hash: allowlist.query_policy.mode === "FINITE_VALUES" ? allowlist.query_policy.contract.contract_hash : "",
        bindings: { source_artifact_id: source.artifact_id, endpoint_artifact_id: endpoint.artifact_id,
          admission_artifact_id: admission.artifact_id, allowlist_artifact_id: version.artifact_id, adapter_artifact_id: adapter.artifact_id },
        authorization: { authorization_mode: "AUTOMATION_CANARY", authorization_id: runId,
          source_admission_id: admission.artifact.payload.source_admission_id, endpoint: endpoint.artifact.payload.locator,
          recruitment_endpoint_id: endpoint.artifact.payload.recruitment_endpoint_id, endpoint_purpose: admission.artifact.payload.endpoint_purpose,
          allowed_http_method: "GET", collection_run_id: runId, reviewer: input.reviewer, issued_at: input.approved_at,
          evidence_id: admission.artifact.payload.evidence[2]!.source_admission_evidence_id, scope: "ONE_ENDPOINT_ONE_RUN", manual_confirmation: true }
      })) } });
  });
  const replay = supportingInspectionReplay([...prior, ...added, ...claims]);
  assert.equal(replay.current.length, 3);
  assert.ok(replay.current.every(record => record.state === "CLAIMED"));
});
