import "../helpers/network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { SourceAdmission } from "../../lib/application";
import {
  ELIGIBILITY_ASSESSMENT_RULE_VERSION,
  PREDICATE_RESOLUTION_RULE_VERSION,
  UTF8_TEXT_ENCODING,
  createCandidateEvidenceSourceManifest,
  type ExtractedRecord,
  type RecruitmentAdapter,
  type RecruitmentEndpoint,
  type SourceCompositionInput,
  type SourceDefinition,
  type TransportRequest,
  type TransportResponse
} from "../../lib/ingestion";
import type { TrustedSourceOccurrenceArtifact, SOVDiscoverySupport } from "../../lib/ingestion";
import { canonicalDeserialize, canonicalHash, canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import {
  bootstrapZeroCostProductionCompositionRoot,
  createSourcePersistenceVersion,
  type ProductionPersistenceProvenance,
  type SourcePersistenceVersion,
  type ZeroCostProductionRunInput
} from "../../lib/production-persistence";
import { admission } from "../p2-05/test-support";
import {
  AS_OF,
  CANDIDATE_ID,
  OBSERVED_AT,
  syntheticCandidateProfile,
  trustedFixture
} from "../pipeline/position-bound-phase-fixture";

const provenance: ProductionPersistenceProvenance = {
  scope: "PRODUCTION",
  actor_id: "zero-cost-composition-root-test",
  actor_role: "TEST_ONLY_PRODUCTION_RUNNER",
  evidence_references: ["fixture:zero-cost-composition-root"]
};

test("one production run forms one atomic commit and fresh Process B restores it", async () => {
  const repository = createRemote();
  try {
    const fixture = runFixture("atomic");
    const root = rootFor(repository.remote);
    const result = await root.run(fixture.input);
    assert.equal(result.status, "COMMITTED", JSON.stringify(result));
    assert.deepEqual(result.lifecycle.map((item) => item.status), [
      "CREATED", "RUNNING", "VALIDATING", "COMMITTING", "COMMITTED"
    ]);
    assert.equal(result.presentation_read_model_ids.length, 1);
    assert.equal(git(repository.remote, "rev-list", "--count", "main").trim(), "2");
    const changed = git(repository.remote, "diff-tree", "--no-commit-id", "--name-only",
      "-r", "main").trim().split(/\r?\n/u);
    assert.ok(changed.some((item) => item.startsWith("trusted-objects/")));
    assert.ok(changed.some((item) => item.startsWith("trusted-state/")));
    assert.ok(changed.some((item) => item.startsWith("production-source-state/")));
    assert.ok(changed.some((item) => item.startsWith("production-runs/")));

    const processB = await root.restore();
    assert.equal(processB.committed_head, result.committed_head);
    assert.equal(processB.source_version_count, fixture.sourceVersions.length);
    assert.equal(processB.acquisition_count, 1);
    assert.equal(processB.restored_record_count, result.restoration_record_ids.length);
    assert.deepEqual(processB.restoration_record_ids, result.restoration_record_ids);
    assert.equal(processB.read_models.length, 1);
    assert.equal(
      processB.read_models[0]?.presentation_read_model_id,
      result.presentation_read_model_ids[0]
    );
    assert.ok(processB.artifact_seals.every((seal) => seal.content_hash.length > 0));
  } finally {
    repository.remove();
  }
});

test("an audit-only unbound run commits retention without publishing a fake Position or requiring a public Model", async () => {
  const repository = createRemote();
  try {
    const fixture = runFixture("unbound-audit-only");
    let candidateId = "";
    const root = rootFor(repository.remote);
    const committed = await root.run({ ...fixture.input, execute_trusted_chain: async (context) => {
      const source = context.source_occurrences[0] as TrustedSourceOccurrenceArtifact;
      const registration = await context.execute({ kind: "OPPORTUNITY_REGISTER", input: {
        source_definition_id: source.endpoint.source_definition_id,
        recruitment_endpoint_id: source.endpoint.recruitment_endpoint_id, discovery_locator: source.endpoint.locator,
        snapshot_id: source.snapshot.snapshot_id, extracted_record_id: source.extracted_record.extracted_record_id,
        source_occurrence_version_id: source.version.source_occurrence_version_id, publisher_subject: null,
        discovery_evidence_ids: ["fixture:unbound-audit-only"], first_observed_at: OBSERVED_AT,
        initial_disposition: { status: "RETAINED", reason_codes: ["OFFICIAL_RECRUITMENT_DISCOVERED"],
          evidence_ids: ["fixture:unbound-audit-only"], decided_at: OBSERVED_AT }
      } }) as RecallRegistration;
      candidateId = registration.candidate.opportunity_candidate_id;
      const retained = await context.execute({ kind: "PRESENTATION_DECIDE", input: {
        contract_version: "presentation-decision/2.0.0", expected_current_presentation_decision_id: null,
        opportunity_candidate_id: registration.candidate.opportunity_candidate_id,
        recall_disposition_id: registration.disposition.recall_disposition_id,
        relevance_assessment_id: null, eligibility_assessment_id: null, decided_at: AS_OF
      } }) as { decision: import("../../lib/ingestion").PresentationDecision };
      assert.equal(retained.decision.position_id, null);
      assert.equal(retained.decision.revision, null);
    }, publish_presentation: async (models) => { assert.equal(models.length, 0); } });
    assert.equal(committed.status, "COMMITTED", JSON.stringify(committed));
    assert.equal(committed.presentation_publish_status, "PUBLISHED");
    assert.equal(committed.presentation_read_model_ids.length, 0);
    const restored = await root.restore();
    assert.equal(restored.read_models.length, 0);
    assert.equal(restored.presentation_decisions.length, 1);
    assert.equal(restored.current_snapshot?.retention.unbound_outcome_count, 1);
    const detail = restored.current_snapshot?.candidate_details[candidateId];
    assert.ok(detail && "record_kind" in detail);
    assert.equal(detail.record_kind, "UNBOUND_RETAINED_OUTCOME");
    assert.equal(restored.runs[0]?.retained_outcome_references?.length, 1);
  } finally { repository.remove(); }
});

test("committed production boundary reuses original SOV through support and an independent Process B restores exact bindings", async () => {
  const repository = createRemote();
  try {
    const fixture = runFixture("discovery-support");
    const productionRoot = rootFor(repository.remote);
    const first = await productionRoot.run(fixture.input);
    assert.equal(first.status, "COMMITTED", JSON.stringify(first));
    const originalState = await productionRoot.restore();
    const originalModel = originalState.read_models[0]!;
    const originalHead = git(repository.remote, "rev-parse", "main").trim();
    for (const failure of ["FAILED", "PARTIAL", "SUPPORT_INVALID"] as const) {
      const failedInput: ZeroCostProductionRunInput = { ...fixture.input,
        run_id: `${fixture.input.run_id}-${failure.toLowerCase()}`, started_at: AS_OF };
      const failed = await productionRoot.run(failure === "FAILED" ? { ...failedInput, transport: {
        async execute() { return { status: "FAILED", responded_at: AS_OF, http_status: 503,
          headers: {}, mime_type: null, error: { code: "OFFLINE", message: "failed rediscovery", retryable: true } }; }
      } } : failure === "PARTIAL" ? { ...failedInput, adapter: { ...fixture.input.adapter,
        assessCompleteness: () => ({ status: "PARTIAL", reason_codes: ["TEST_PARTIAL"] })
      } } : { ...failedInput, execute_trusted_chain: async (context) => {
        const source = context.source_occurrences[0] as TrustedSourceOccurrenceArtifact;
        await context.execute({ kind: "SOURCE_DISCOVERY_SUPPORT_VERIFY", input: {
          schema_version: "trusted-sov-discovery-support/1.0.0", sov_id: source.version.source_occurrence_version_id,
          snapshot_id: "unverified-snapshot" as never, extracted_record_id: context.extracted_records[0]!.extracted_record_id,
          source_role: "POSITION_BEARING" } });
      } });
      assert.notEqual(failed.status, "COMMITTED", failure);
      assert.equal(git(repository.remote, "rev-parse", "main").trim(), originalHead, failure);
    }
    assert.deepEqual((await productionRoot.restore()).read_models, [originalModel]);
    const originalPositionVersionId = originalState.artifact_seals.find((seal) => seal.artifact_kind === "POSITION_VERSION")!.artifact_id;
    let expected: Record<string, unknown> | undefined;
    const secondRoot = bootstrapZeroCostProductionCompositionRoot({ remote_url: repository.remote,
      branch: "main", stream_id: "zero-cost-production-test", now: () => AS_OF });
    const second = await secondRoot.run({ ...fixture.input, run_id: `${fixture.input.run_id}-rediscovery`, started_at: AS_OF,
      transport: { async execute(request) { return { ...await fixture.input.transport.execute(request), responded_at: AS_OF }; } },
      actor: "different-discovery-actor",
      execute_trusted_chain: async (context) => {
        const { discovery_support_id: supportId, ...source } = context.source_occurrences[0] as TrustedSourceOccurrenceArtifact & { discovery_support_id: string };
        assert.ok(supportId);
        const support = context.resolvers.source_occurrences.resolveSupport(supportId)!;
        assert.equal(support.scope, "PRODUCTION");
        assert.notEqual(context.snapshots[0]!.snapshot_id, source.snapshot.snapshot_id);
        const registered = await context.execute({ kind: "OPPORTUNITY_REGISTER",
          source_binding: { kind: "VERIFIED_DISCOVERY_SUPPORT", support_id: supportId },
          input: { source_definition_id: source.endpoint.source_definition_id,
            recruitment_endpoint_id: source.endpoint.recruitment_endpoint_id,
            discovery_locator: context.snapshots[0]!.request_metadata.locator,
            snapshot_id: context.snapshots[0]!.snapshot_id,
            extracted_record_id: context.extracted_records[0]!.extracted_record_id,
            source_occurrence_version_id: source.version.source_occurrence_version_id,
            publisher_subject: null, discovery_evidence_ids: ["fixture:discovery-support-production-boundary"],
            first_observed_at: AS_OF, initial_disposition: { status: "RETAINED",
              reason_codes: ["OFFICIAL_RECRUITMENT_DISCOVERED"], evidence_ids: ["fixture:discovery-support-production-boundary"], decided_at: AS_OF } }
        }) as RecallRegistration;
        const position = await context.execute({ kind: "POSITION_VERSION_MATERIALIZE",
          source_references: [{ source_occurrence_version_id: source.version.source_occurrence_version_id }] }) as PositionResult;
        assert.equal(position.position_version.position_version_id, originalPositionVersionId);
        const repeated = await context.execute({ kind: "SOURCE_DISCOVERY_SUPPORT_VERIFY", input: {
          schema_version: "trusted-sov-discovery-support/1.0.0", sov_id: source.version.source_occurrence_version_id,
          snapshot_id: context.snapshots[0]!.snapshot_id, extracted_record_id: context.extracted_records[0]!.extracted_record_id,
          source_role: "POSITION_BEARING" } }) as { support: SOVDiscoverySupport; support_created: boolean };
        assert.equal(repeated.support_created, false);
        assert.deepEqual(repeated.support, support);
        expected = { source, source_seal: canonicalHash(source), support, support_seal: support.integrity_hash,
          candidate: registered.candidate, position_version: position.position_version,
          position_id: position.position_version.position_id };
        const originalDecision = context.resolvers.presentation_decisions.resolve(originalModel.presentation_decision_id)!;
        const reused = await context.execute({ kind: "PRESENTATION_DECIDE", input: {
          contract_version: "presentation-decision/2.0.0",
          expected_current_presentation_decision_id: originalDecision.presentation_decision_id,
          opportunity_candidate_id: registered.candidate.opportunity_candidate_id,
          recall_disposition_id: registered.disposition.recall_disposition_id,
          relevance_assessment_id: originalDecision.relevance_assessment_id,
          eligibility_assessment_id: originalDecision.eligibility_assessment_id,
          decided_at: AS_OF
        } }) as DecisionResult;
        assert.equal(reused.decision.presentation_decision_id, originalModel.presentation_decision_id);
        assert.deepEqual(reused.decision, originalDecision);
        expected = { ...expected, decision: originalDecision, read_model: originalModel };
        await context.execute({ kind: "PRESENTATION_READ_MODEL_MATERIALIZE", presentation_decision_id: originalModel.presentation_decision_id });
      }
    });
    assert.equal(second.status, "COMMITTED", JSON.stringify(second));
    const currentState = await secondRoot.restore();
    assert.equal(currentState.read_models.length, 1);
    assert.deepEqual(currentState.read_models[0], originalModel);
    assert.ok(expected);
    const checkout = path.join(repository.local, "process-b-checkout");
    git(repository.local, "clone", "--branch", "main", repository.remote, checkout);
    git(checkout, "config", "core.longpaths", "true");
    const scriptPath = path.join(repository.local, "support-process-b.ts");
    const markerPath = path.join(repository.local, "support-process-b.json");
    writeFileSync(scriptPath, `
      import { writeFileSync } from "node:fs";
      import { bootstrapTrustedChainCompositionRoot } from ${JSON.stringify(pathToFileURL(path.resolve("lib/ingestion/index.ts")).href)};
      import { canonicalHash, canonicalSerialize } from ${JSON.stringify(pathToFileURL(path.resolve("lib/ingestion/normalization/canonical-artifact-registry.ts")).href)};
      import { GitAppendOnlyExecutionStore, GitRawObjectPersistence, GitSourceRegistryPersistence, createRawValidatedRestorationJournal } from ${JSON.stringify(pathToFileURL(path.resolve("lib/production-persistence/index.ts")).href)};
      void (async () => {
        const repositoryPath = process.argv[2];
        const store = new GitAppendOnlyExecutionStore({repository_path:repositoryPath,stream_id:"zero-cost-production-test",scope:"PRODUCTION"});
        const raw = new GitRawObjectPersistence({repository_path:repositoryPath});
        const sources = new GitSourceRegistryPersistence({repository_path:repositoryPath});
        const restored = await bootstrapTrustedChainCompositionRoot({scope:"PRODUCTION",restoration_journal:createRawValidatedRestorationJournal(raw,store,sources)});
        const executions = store.listVerifiedExecutions();
        const supports = executions.filter(item=>item.record.command.kind==="SOURCE_DISCOVERY_SUPPORT_VERIFY");
        const supportId = supports[0].artifact_envelopes[0].artifact_id;
        const support = restored.root.resolvers.source_occurrences.resolveSupport(supportId);
        const source = restored.root.resolvers.source_occurrences.resolve(support.target.sov_id);
        const registration = executions.find(item=>item.record.command.source_binding?.kind==="VERIFIED_DISCOVERY_SUPPORT");
        const candidateId = registration.record.expected_artifacts.find(item=>item.artifact_kind==="OPPORTUNITY_CANDIDATE").artifact_id;
        const candidate = restored.root.resolvers.opportunity_candidates.resolve(candidateId);
        const positionRef = executions.find(item=>item.record.command.kind==="POSITION_VERSION_MATERIALIZE").record.expected_artifacts[0].artifact_id;
        const position_version = restored.root.resolvers.position_versions.resolve(positionRef).position_version;
        if(canonicalSerialize(supports[0].artifact_envelopes)!==canonicalSerialize(supports[1].artifact_envelopes)) throw new Error("issuance envelope changed");
        if(executions.filter(item=>item.record.command.kind==="SOURCE_OCCURRENCE_MATERIALIZE").length!==1) throw new Error("SOV reissued");
        const presentations = executions.filter(item=>item.record.command.kind==="PRESENTATION_DECIDE");
        if(presentations.length!==2 || canonicalSerialize(presentations[0].artifact_envelopes)!==canonicalSerialize(presentations[1].artifact_envelopes)) throw new Error("Presentation issuance envelope changed");
        const current = store.readCurrentSnapshot();
        if(current.current_position_read_models.length!==1) throw new Error("duplicate Position current");
        const read_model = current.current_position_read_models[0];
        if(canonicalSerialize(current.candidate_details[candidateId])!==canonicalSerialize(read_model)) throw new Error("Candidate B current support missing");
        const decision = restored.root.resolvers.presentation_decisions.resolve(read_model.presentation_decision_id);
        if(decision.revision!==1 || decision.supersedes_presentation_decision_id!==null) throw new Error("rediscovery advanced revision");
        writeFileSync(process.argv[3],canonicalSerialize({source,source_seal:canonicalHash(source),support,support_seal:support.integrity_hash,candidate,position_version,position_id:position_version.position_id,decision,read_model}));
      })().catch(error=>{ console.error(error);process.exitCode=1; });
    `, "utf8");
    const child = spawnSync(process.execPath, [createRequire(import.meta.url).resolve("tsx/cli"), scriptPath, checkout, markerPath], { encoding: "utf8" });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
    assert.equal(readFileSync(markerPath, "utf8"), canonicalSerialize(expected));
    assert.equal(git(repository.remote, "rev-list", "--count", "main").trim(), "3");
    const artifactPaths = git(checkout, "ls-files", "trusted-state/artifacts/objects").trim().split(/\r?\n/u);
    const supportPath = artifactPaths.find((relativePath) => {
      const envelope = canonicalDeserialize<{ artifact_kind: string }>(readFileSync(path.join(checkout, relativePath), "utf8"));
      return envelope.artifact_kind === "SOV_DISCOVERY_SUPPORT";
    })!;
    assert.ok(supportPath);
    const supportObjectPath = path.join(checkout, supportPath);
    const originalBytes = readFileSync(supportObjectPath, "utf8");
    writeFileSync(supportObjectPath, originalBytes.replace("VERIFIED_IDENTICAL", "FORGED_EQUIVALENCE"), "utf8");
    git(checkout, "add", supportPath);
    git(checkout, "-c", "user.name=Support Corruption Test", "-c", "user.email=invalid@fixture.test", "commit", "-m", "controlled invalid support HEAD");
    const rejectedChild = spawnSync(process.execPath, [createRequire(import.meta.url).resolve("tsx/cli"), scriptPath, checkout, markerPath], { encoding: "utf8" });
    assert.notEqual(rejectedChild.status, 0, "Corrupt committed support must prevent Process B activation");
    assert.match(`${rejectedChild.stdout}\n${rejectedChild.stderr}`, /integrity|canonical|tamper|hash|mismatch/iu);
  } finally {
    repository.remove();
  }
});

test("pre-commit and post-local-commit crashes leave remote HEAD unchanged", async () => {
  for (const point of ["AFTER_ACQUISITION", "AFTER_LOCAL_COMMIT"] as const) {
    const repository = createRemote();
    try {
      const fixture = runFixture(`crash-${point.toLowerCase()}`);
      const before = git(repository.remote, "rev-parse", "main").trim();
      const root = rootFor(repository.remote, async (candidate) => {
        if (candidate === point) throw new Error(`simulated ${point}`);
      });
      const result = await root.run(fixture.input);
      assert.equal(result.status, "FAILED");
      assert.equal(result.committed_head, null);
      assert.equal(git(repository.remote, "rev-parse", "main").trim(), before);
      assert.equal((await rootFor(repository.remote).restore()).restored_record_count, 0);
    } finally {
      repository.remove();
    }
  }
});

test("publish failure preserves trusted commit and retries persisted ReadModel only", async () => {
  const repository = createRemote();
  try {
    const fixture = runFixture("publish-retry");
    let publishCalls = 0;
    const root = rootFor(repository.remote);
    const result = await root.run({
      ...fixture.input,
      async publish_presentation() {
        publishCalls += 1;
        throw new Error("presentation sink unavailable");
      }
    });
    assert.equal(result.status, "COMMITTED", JSON.stringify(result));
    assert.equal(result.presentation_publish_status, "RETRY_REQUIRED");
    assert.equal(publishCalls, 1);
    const committed = git(repository.remote, "rev-parse", "main").trim();
    let retriedBytes = "";
    const retry = await root.retryPresentationPublish(result.run_id, async (models) => {
      publishCalls += 1;
      retriedBytes = JSON.stringify(models);
    });
    assert.equal(retry.status, "PUBLISHED");
    assert.equal(publishCalls, 2);
    assert.match(retriedBytes, /presentation_read_model_id/u);
    assert.equal(git(repository.remote, "rev-parse", "main").trim(), committed);
  } finally {
    repository.remove();
  }
});

test("acquisition, validation, journal, and incomplete-chain failures commit no state", async () => {
  const scenarios = [
    {
      name: "acquisition",
      mutate(input: ZeroCostProductionRunInput): ZeroCostProductionRunInput {
        return {
          ...input,
          transport: {
            async execute(request) {
              return {
                status: "FAILED",
                responded_at: OBSERVED_AT,
                http_status: 503,
                headers: {},
                mime_type: null,
                error: { code: "OFFLINE", message: request.locator, retryable: true }
              };
            }
          }
        };
      }
    },
    {
      name: "raw-persistence",
      mutate(input: ZeroCostProductionRunInput): ZeroCostProductionRunInput {
        return {
          ...input,
          transport: {
            async execute() {
              return {
                status: "SUCCESS",
                responded_at: OBSERVED_AT,
                bytes: new TextEncoder().encode("corrupt Raw response"),
                content_sha256: "0".repeat(64) as never,
                mime_type: "text/html",
                http_status: 200,
                headers: {}
              };
            }
          }
        };
      }
    },
    {
      name: "validation",
      mutate(input: ZeroCostProductionRunInput): ZeroCostProductionRunInput {
        return {
          ...input,
          adapter: {
            ...input.adapter,
            validateEndpoint: () => ({ valid: false, issues: ["invalid fixture"] })
          }
        };
      }
    },
    {
      name: "journal",
      mutate(input: ZeroCostProductionRunInput): ZeroCostProductionRunInput {
        return {
          ...input,
          async execute_trusted_chain(context) {
            await context.execute({
              kind: "CANDIDATE_EVIDENCE_MATERIALIZE_SYNTHETIC",
              input: {
                candidate_profile: syntheticCandidateProfile("forbidden"),
                observed_at: OBSERVED_AT,
                effective_from: OBSERVED_AT
              }
            });
          }
        };
      }
    },
    {
      name: "incomplete",
      mutate(input: ZeroCostProductionRunInput): ZeroCostProductionRunInput {
        return { ...input, execute_trusted_chain: async () => undefined };
      }
    }
  ];
  for (const scenario of scenarios) {
    const repository = createRemote();
    try {
      const fixture = runFixture(`failure-${scenario.name}`);
      const before = git(repository.remote, "rev-parse", "main").trim();
      const result = await rootFor(repository.remote).run(
        scenario.mutate(fixture.input)
      );
      assert.notEqual(result.status, "COMMITTED", scenario.name);
      assert.equal(git(repository.remote, "rev-parse", "main").trim(), before,
        scenario.name);
    } finally {
      repository.remove();
    }
  }
});

test("one root-owned writer rejects a concurrent root before acquisition", async () => {
  const repository = createRemote();
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const transportEntered = new Promise<void>((resolve) => { entered = resolve; });
  const transportRelease = new Promise<void>((resolve) => { release = resolve; });
  try {
    const fixture = runFixture("single-writer");
    const firstRoot = rootFor(repository.remote);
    const firstRun = firstRoot.run({
      ...fixture.input,
      transport: {
        async execute() {
          entered?.();
          await transportRelease;
          return {
            status: "FAILED",
            responded_at: OBSERVED_AT,
            http_status: 503,
            headers: {},
            mime_type: null,
            error: { code: "TEST_STOP", message: "stop", retryable: false }
          };
        }
      }
    });
    await transportEntered;
    const second = await rootFor(repository.remote).run({
      ...fixture.input,
      run_id: "run-zero-cost-concurrent"
    });
    assert.equal(second.status, "FAILED");
    assert.match(second.error ?? "", /Single-writer/u);
    release?.();
    assert.equal((await firstRun).status, "FAILED");
  } finally {
    release?.();
    repository.remove();
  }
});

test("expected-parent CAS rejects a stale writer without merge, rebase, or force", async () => {
  const repository = createRemote();
  try {
    const fixture = runFixture("stale-writer");
    let advanced = false;
    const root = rootFor(repository.remote, async (point) => {
      if (point !== "BEFORE_ATOMIC_COMMIT" || advanced) return;
      advanced = true;
      advanceRemote(repository.remote, "competing writer");
    });
    const result = await root.run(fixture.input);
    assert.equal(result.status, "FAILED");
    assert.match(result.error ?? "", /CAS_MISMATCH/u);
    assert.equal(git(repository.remote, "log", "-1", "--format=%s", "main").trim(),
      "competing writer");
  } finally {
    repository.remove();
  }
});

function rootFor(
  remote: string,
  faultInjector?: Parameters<
    typeof bootstrapZeroCostProductionCompositionRoot
  >[0]["fault_injector"]
) {
  return bootstrapZeroCostProductionCompositionRoot({
    remote_url: remote,
    branch: "main",
    stream_id: "zero-cost-production-test",
    now: () => OBSERVED_AT,
    fault_injector: faultInjector
  });
}

function runFixture(suffix: string) {
  const endpointUrl = "https://official.example.invalid/recruitment/2027";
  const admitted = admission({
    source_admission_id: `admission-zero-cost-${suffix}`,
    endpoint: endpointUrl
  });
  const endpoint: RecruitmentEndpoint = {
    recruitment_endpoint_id: admitted.recruitment_endpoint_id,
    source_definition_id: "source-zero-cost-production" as never,
    name: traceable("Zero-cost official recruitment"),
    coverage_regions: [{ raw_text: original("贵州省") }],
    locator: endpointUrl,
    request_method: "GET",
    content_kind: "HTML",
    adapter_key: "zero-cost-test-official",
    decoded_text_encoding: UTF8_TEXT_ENCODING,
    collection_config: {
      timeout_ms: 1_000,
      max_items: 1,
      max_pages: 1,
      follow_redirects: false,
      retry_limit: 0
    },
    enabled: true
  };
  const organization = {
    organization_id: "org-zero-cost-production" as never,
    name: traceable("Zero-cost official publisher"),
    aliases: [],
    country_code: "CN"
  } as const;
  const source: SourceDefinition = {
    source_definition_id: endpoint.source_definition_id,
    publisher_organization_id: organization.organization_id,
    name: traceable("Zero-cost source"),
    publisher_kind: "GOVERNMENT_PORTAL",
    authority_level: "OFFICIAL",
    scope: "REGIONAL",
    enabled: true
  };
  const template = trustedFixture(`zero-cost-${suffix}`, "学历要求：本科及以上", {
    raw_title: "法务岗"
  });
  const adapter = testAdapter(endpoint, template.source.extracted_record);
  const sourceVersions = sourceVersionFixture(
    organization,
    source,
    endpoint,
    admitted,
    adapter
  );
  const bytes = new TextEncoder().encode(`official recruitment ${suffix}`);
  const transport = {
    async execute(request: TransportRequest): Promise<TransportResponse> {
      const hash = createHash("sha256").update(bytes).digest("hex");
      return {
        status: "SUCCESS",
        responded_at: OBSERVED_AT,
        bytes: new Uint8Array(bytes),
        content_sha256: hash as never,
        mime_type: "text/html",
        http_status: 200,
        headers: {}
      };
    }
  };
  const input: ZeroCostProductionRunInput = {
    run_id: `run-zero-cost-${suffix}`,
    source_versions: sourceVersions,
    source_admission_id: admitted.source_admission_id,
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
    adapter,
    transport,
    provenance,
    actor: "zero-cost-production-root-test",
    started_at: OBSERVED_AT,
    execute_trusted_chain: fullTrustedChain(template)
  };
  return { input, sourceVersions };
}

function fullTrustedChain(template: ReturnType<typeof trustedFixture>) {
  return async (context: Parameters<ZeroCostProductionRunInput["execute_trusted_chain"]>[0]) => {
    const source = context.source_occurrences[0] as {
      readonly occurrence: { readonly source_occurrence_id: string };
      readonly version: {
        readonly source_occurrence_version_id: string;
        readonly semantic_hash: string;
        readonly first_observed_at: string;
      };
    };
    const snapshot = context.snapshots[0]!;
    const record = context.extracted_records[0]!;
    const registration = await context.execute({
      kind: "OPPORTUNITY_REGISTER",
      input: {
        source_definition_id: record.source_definition_id,
        recruitment_endpoint_id: snapshot.recruitment_endpoint_id,
        discovery_locator: snapshot.request_metadata.locator,
        snapshot_id: snapshot.snapshot_id,
        extracted_record_id: record.extracted_record_id,
        source_occurrence_version_id: source.version.source_occurrence_version_id as never,
        publisher_subject: null,
        discovery_evidence_ids: ["official:zero-cost-production-test"],
        first_observed_at: OBSERVED_AT,
        initial_disposition: {
          status: "RETAINED",
          reason_codes: ["OFFICIAL_RECRUITMENT_DISCOVERED"],
          evidence_ids: ["official:zero-cost-production-test"],
          decided_at: OBSERVED_AT
        }
      }
    }) as RecallRegistration;
    const position = await context.execute({
      kind: "POSITION_VERSION_MATERIALIZE",
      source_references: [{
        source_occurrence_version_id: source.version.source_occurrence_version_id as never
      }]
    }) as PositionResult;
    const opportunity = await context.execute({
      kind: "PBOV_MATERIALIZE",
      position_version_id: position.position_version.position_version_id,
      source_references: [{
        source_occurrence_version_id: source.version.source_occurrence_version_id as never
      }]
    }) as PbovResult;
    const compositionInput = replaceComposition(template, {
      opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
      source_occurrence_version_id: source.version.source_occurrence_version_id,
      source_occurrence_id: source.occurrence.source_occurrence_id,
      snapshot_id: snapshot.snapshot_id,
      extracted_record_id: record.extracted_record_id,
      recruitment_endpoint_id: snapshot.recruitment_endpoint_id,
      semantic_hash: source.version.semantic_hash,
      observed_at: source.version.first_observed_at
    });
    const composition = await context.execute({
      kind: "SOURCE_COMPOSITION_MATERIALIZE",
      input: {
        opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
        composition_input: compositionInput
      }
    }) as CompositionResult;
    const relevance = await context.execute({
      kind: "LEGAL_RELEVANCE_ASSESS",
      input: {
        opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
        source_composition_id: composition.source_composition_id,
        created_at: AS_OF
      }
    }) as RelevanceResult;
    await context.execute({
      kind: "REQUIREMENT_PROJECTION_MATERIALIZE",
      source_composition_id: composition.source_composition_id
    });
    const requirement = await context.execute({
      kind: "REQUIREMENT_SET_MATERIALIZE",
      source_composition_id: composition.source_composition_id
    }) as RequirementResult;
    const profile = syntheticCandidateProfile(`asserted-${template.source.version.source_occurrence_version_id}`);
    const manifest = createCandidateEvidenceSourceManifest({
      manifest_stream_id: `asserted-${template.source.version.source_occurrence_version_id}`,
      candidate_profile_id: profile.candidate_profile_id,
      evidence_class: "CANDIDATE_ASSERTED",
      scope: "PRODUCTION",
      revision: 1,
      supersedes_manifest_id: null,
      locator: { kind: "CANDIDATE_CLAIM", value: "candidate-claim://zero-cost-test" },
      evidence_object: null,
      verifier: null,
      actor: "zero-cost-production-root-test",
      issued_at: OBSERVED_AT,
      provenance_references: ["candidate-assertion:zero-cost-test"]
    });
    const evidence = await context.execute({
      kind: "CANDIDATE_EVIDENCE_ISSUE",
      input: {
        source_manifest: manifest,
        evidence: profile.education.slice(0, 1).map((item) => {
          const credential = { ...item, provenance: "CANDIDATE_ASSERTED" as const };
          return {
            candidate_credential_id: credential.candidate_credential_id,
            value: { kind: "EDUCATION_CREDENTIAL" as const, credential },
            original_value: credential.program_name.original,
            normalized_value: {
              text: credential.program_name.original.text.normalize("NFKC"),
              unicode_form: "NFKC" as const,
              normalizer_version: "zero-cost-test/1.0.0",
              operations: ["UNICODE_NORMALIZATION" as const]
            },
            observation_status: "INSUFFICIENT" as const,
            observed_at: OBSERVED_AT
          };
        })
      }
    }) as EvidenceResult;
    const predicates = await context.execute({
      kind: "PREDICATE_RESOLUTION_MATERIALIZE",
      input: {
        opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
        source_composition_id: composition.source_composition_id,
        requirement_set_version_id: requirement.requirement_set_version_id,
        candidate_profile_id: CANDIDATE_ID,
        candidate_evidence_ids: evidence.evidence_ids,
        as_of: AS_OF,
        predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION
      }
    }) as PredicateResult;
    const eligibility = await context.execute({
      kind: "ELIGIBILITY_MATERIALIZE",
      input: {
        opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
        source_composition_id: composition.source_composition_id,
        requirement_set_version_id: requirement.requirement_set_version_id,
        predicate_resolution_ids: predicates.resolutions.map((item) => {
          return item.predicate_resolution_id;
        }),
        candidate_profile_id: CANDIDATE_ID,
        candidate_evidence_ids: evidence.evidence_ids,
        as_of: AS_OF,
        predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION,
        assessment_rule_version: ELIGIBILITY_ASSESSMENT_RULE_VERSION
      }
    }) as EligibilityResult;
    const decision = await context.execute({
      kind: "PRESENTATION_DECIDE",
      input: {
        contract_version: "presentation-decision/2.0.0",
        expected_current_presentation_decision_id: context.resolvers.presentation_decisions.resolvePositionCurrent(
          "PRODUCTION", context.resolvers.position_bound_opportunities.resolve(
            opportunity.opportunity_version.opportunity_version_id)!.position.position_id)?.presentation_decision_id ?? null,
        opportunity_candidate_id: registration.candidate.opportunity_candidate_id,
        recall_disposition_id: registration.disposition.recall_disposition_id,
        relevance_assessment_id: relevance.assessment.assessment_id,
        eligibility_assessment_id: eligibility.assessment.eligibility_assessment_id,
        decided_at: AS_OF
      }
    }) as DecisionResult;
    await context.execute({
      kind: "PRESENTATION_READ_MODEL_MATERIALIZE",
      presentation_decision_id: decision.decision.presentation_decision_id
    });
  };
}

function sourceVersionFixture(
  organization: { readonly organization_id: never; readonly name: ReturnType<typeof traceable>;
    readonly aliases: readonly never[]; readonly country_code: string },
  source: SourceDefinition,
  endpoint: RecruitmentEndpoint,
  sourceAdmission: SourceAdmission,
  adapter: RecruitmentAdapter
) {
  const versions: SourcePersistenceVersion[] = [];
  const append = (artifact: SourcePersistenceVersion["artifact"]) => {
    const streamId = artifact.kind === "ORGANIZATION"
      ? artifact.payload.organization_id
      : artifact.kind === "SOURCE_DEFINITION"
        ? artifact.payload.source_definition_id
        : artifact.kind === "RECRUITMENT_ENDPOINT"
          ? artifact.payload.recruitment_endpoint_id
          : artifact.kind === "ADAPTER_REGISTRATION"
            ? artifact.payload.adapter_key
            : artifact.kind === "SOURCE_ADMISSION"
              ? artifact.payload.source_admission_id
              : artifact.payload.allowlist_entry_id;
    const version = createSourcePersistenceVersion({
      stream_id: streamId,
      revision: 1,
      supersedes_artifact_id: null,
      artifact,
      provenance,
      effective_at: OBSERVED_AT,
      created_at: OBSERVED_AT
    });
    versions.push(version);
    return version;
  };
  append({ kind: "ORGANIZATION", payload: organization as never });
  append({
    kind: "ADAPTER_REGISTRATION",
    payload: {
      adapter_key: adapter.descriptor.adapter_key,
      name: traceable(adapter.descriptor.name),
      supported_content_kinds: adapter.descriptor.supported_content_kinds
    }
  });
  append({ kind: "SOURCE_DEFINITION", payload: source });
  const endpointVersion = append({ kind: "RECRUITMENT_ENDPOINT", payload: endpoint });
  const admissionVersion = append({ kind: "SOURCE_ADMISSION", payload: sourceAdmission });
  append({
    kind: "OFFICIAL_ENDPOINT_ALLOWLIST",
    payload: {
      allowlist_entry_id: `allowlist-${sourceAdmission.source_admission_id}`,
      recruitment_endpoint_artifact_id: endpointVersion.artifact_id,
      source_admission_artifact_id: admissionVersion.artifact_id,
      active: true,
      scheme: "https",
      host: "official.example.invalid",
      port: null,
      path_prefix: "/recruitment/2027",
      exact_path: true,
      allowed_method: "GET",
      query_policy: { mode: "DENY_ALL", allowed_parameters: [] },
      endpoint_purpose: "JOB_LIST",
      authority_level: "OFFICIAL",
      approval_evidence_ids: sourceAdmission.evidence.map((item) => {
        return item.source_admission_evidence_id;
      })
    }
  });
  return versions;
}

function testAdapter(
  endpoint: RecruitmentEndpoint,
  templateRecord: ExtractedRecord
): RecruitmentAdapter {
  return {
    descriptor: {
      adapter_key: endpoint.adapter_key,
      name: "ZeroCostTestOfficialAdapter",
      version: "1.0.0",
      supported_content_kinds: ["HTML"],
      capabilities: ["SINGLE_PAGE", "HTML_EXTRACTION"]
    },
    validateEndpoint(candidate) {
      return candidate.recruitment_endpoint_id === endpoint.recruitment_endpoint_id
        ? { valid: true, issues: [] }
        : { valid: false, issues: ["endpoint mismatch"] };
    },
    plan(candidate) {
      return [{
        recruitment_endpoint_id: candidate.recruitment_endpoint_id,
        locator: candidate.locator,
        method: "GET",
        parameters: {},
        pagination_state: {
          page_index: 1,
          cursor: null,
          visited_locators: [candidate.locator]
        }
      }];
    },
    extract(input) {
      return [{
        ...structuredClone(templateRecord),
        extracted_record_id: `adapter-record-${input.snapshot.snapshot_id}` as never,
        snapshot_id: input.snapshot.snapshot_id,
        source_definition_id: input.endpoint.source_definition_id,
        extraction: {
          extractor_name: "ZeroCostTestOfficialAdapter",
          extractor_version: "1.0.0",
          extracted_at: input.snapshot.observed_at
        }
      }];
    },
    nextPage() { return null; },
    assessCompleteness(input) {
      return input.records.length === 1 && input.extraction_errors.length === 0
        ? { status: "COMPLETE", reason_codes: ["TEST_COMPLETE"] }
        : { status: "FAILED", reason_codes: ["TEST_INCOMPLETE"] };
    }
  };
}

function replaceComposition(
  template: ReturnType<typeof trustedFixture>,
  actual: {
    readonly opportunity_version_id: string;
    readonly source_occurrence_version_id: string;
    readonly source_occurrence_id: string;
    readonly snapshot_id: string;
    readonly extracted_record_id: string;
    readonly recruitment_endpoint_id: string;
    readonly semantic_hash: string;
    readonly observed_at: string;
  }
) {
  const replacements = new Map<string, string>([
    [template.opportunity_version_id, actual.opportunity_version_id],
    [template.source.version.source_occurrence_version_id,
      actual.source_occurrence_version_id],
    [template.source.occurrence.source_occurrence_id, actual.source_occurrence_id],
    [template.source.snapshot.snapshot_id, actual.snapshot_id],
    [template.source.extracted_record.extracted_record_id, actual.extracted_record_id],
    [template.source.endpoint.recruitment_endpoint_id,
      actual.recruitment_endpoint_id],
    [template.source.version.semantic_hash, actual.semantic_hash],
    [template.source.version.first_observed_at, actual.observed_at]
  ]);
  return replaceStrings(template.composition_input, replacements) as SourceCompositionInput;
}

function replaceStrings(value: unknown, replacements: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return replacements.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => replaceStrings(item, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      return [key, replaceStrings(item, replacements)];
    }));
  }
  return value;
}

function createRemote() {
  const root = mkdtempSync(path.join(os.tmpdir(), "zero-cost-root-test-"));
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  git(root, "init", "--bare", remote);
  git(root, "init", "-b", "main", seed);
  writeFileSync(path.join(seed, "README.md"), "seed", "utf8");
  git(seed, "add", "README.md");
  git(seed, "-c", "user.name=Test", "-c", "user.email=test@invalid.local",
    "commit", "-m", "seed");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "origin", "main");
  git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
  return {
    remote,
    local: root,
    remove() { rmSync(root, { recursive: true, force: true }); }
  };
}

function advanceRemote(remote: string, message: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), "zero-cost-competing-"));
  try {
    git(root, "clone", "--quiet", remote, "checkout");
    const checkout = path.join(root, "checkout");
    writeFileSync(path.join(checkout, `competing-${Date.now()}.txt`), message, "utf8");
    git(checkout, "add", "-A");
    git(checkout, "-c", "user.name=Competing", "-c",
      "user.email=competing@invalid.local", "commit", "-m", message);
    git(checkout, "push", "origin", "main");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}

interface RecallRegistration {
  readonly candidate: { readonly opportunity_candidate_id: never };
  readonly disposition: { readonly recall_disposition_id: never };
}
interface PositionResult {
  readonly position_version: { readonly position_version_id: never; readonly position_id: string };
}
interface PbovResult {
  readonly opportunity_version: { readonly opportunity_version_id: never };
}
interface CompositionResult { readonly source_composition_id: never }
interface RelevanceResult { readonly assessment: { readonly assessment_id: never } }
interface RequirementResult { readonly requirement_set_version_id: never }
interface EvidenceResult { readonly evidence_ids: readonly string[] }
interface PredicateResult {
  readonly resolutions: readonly { readonly predicate_resolution_id: never }[];
}
interface EligibilityResult {
  readonly assessment: { readonly eligibility_assessment_id: never };
}
interface DecisionResult {
  readonly decision: { readonly presentation_decision_id: never };
}
