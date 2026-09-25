import "../helpers/network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
import type { TrustedSourceOccurrenceArtifact } from "../../lib/ingestion";
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

test("failed HTTP acquisition commits only its sealed source outcome and restores in Process B", async () => {
  const repository = createRemote();
  try {
    const fixture = runFixture("failed-acquisition-outcome");
    const before = git(repository.remote, "rev-parse", "main").trim();
    const root = rootFor(repository.remote);
    const failed = await root.run({ ...fixture.input, transport: {
      async execute() {
        return { status: "FAILED", responded_at: OBSERVED_AT, http_status: 503,
          headers: {}, mime_type: null,
          error: { code: "OFFICIAL_NETWORK_POLICY_STOP", message: "controlled policy stop", retryable: false,
            policy_reason_codes: ["RESPONSE_SET_COOKIE_PRESENT"] } };
      }
    } });
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.expected_parent, before);
    assert.ok(failed.committed_head);
    assert.notEqual(failed.committed_head, before);
    const fresh = await rootFor(repository.remote).restore();
    assert.equal(fresh.committed_head, failed.committed_head);
    assert.equal(fresh.acquisition_count, 1);
    assert.equal(fresh.source_execution_outcomes.length, 1);
    assert.equal(fresh.source_execution_outcomes[0]?.status, "FAILED");
    assert.deepEqual(fresh.source_execution_outcomes[0]?.snapshot_ids, failed.snapshot_ids);
    assert.deepEqual(fresh.source_execution_outcomes[0]?.raw_blob_ids, []);
    assert.deepEqual(fresh.read_models, []);
    Object.assign(fresh.source_execution_outcomes[0]!, { status: "SUCCESS" });
    assert.equal((await rootFor(repository.remote).restore()).source_execution_outcomes[0]?.status, "FAILED");
    const processBPath = path.join(repository.local, "policy-stop-process-b.ts");
    const resultPath = path.join(repository.local, "policy-stop-process-b.json");
    writeFileSync(processBPath, `
      import ${JSON.stringify(pathToFileURL(path.resolve("tests/helpers/network-guard.ts")).href)};
      import { execFileSync } from "node:child_process";
      import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
      import os from "node:os";
      import path from "node:path";
      import { GitRawObjectPersistence, bootstrapZeroCostProductionCompositionRoot } from ${JSON.stringify(pathToFileURL(path.resolve("lib/production-persistence/index.ts")).href)};
      void (async () => {
        const directory = mkdtempSync(path.join(os.tmpdir(), "policy-stop-process-b-"));
        try {
          const checkout = path.join(directory, "checkout");
          execFileSync("git", ["clone", "--quiet", "-b", "main", ${JSON.stringify(repository.remote)}, checkout]);
          const acquisitions = await new GitRawObjectPersistence({ repository_path: checkout }).listVerifiedAcquisitions();
          const state = await bootstrapZeroCostProductionCompositionRoot({ remote_url: ${JSON.stringify(repository.remote)},
            branch: "main", stream_id: "zero-cost-production-test" }).restore();
          writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ head: state.committed_head,
            acquisition_count: state.acquisition_count,
            snapshot: acquisitions[0]?.snapshot }));
        } finally { rmSync(directory, { recursive: true, force: true }); }
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `, "utf8");
    const child = spawnSync(process.execPath, ["--import",
      pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href, processBPath], { encoding: "utf8" });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
    const restored = JSON.parse(readFileSync(resultPath, "utf8"));
    assert.equal(restored.head, failed.committed_head);
    assert.equal(restored.acquisition_count, 1);
    assert.equal(restored.snapshot.transport_status, "FAILED");
    assert.deepEqual(restored.snapshot.response_metadata.transport_error.policy_reason_codes,
      ["RESPONSE_SET_COOKIE_PRESENT"]);
  } finally { repository.remove(); }
});

test("identical Raw is committed as NOT_MODIFIED without new business artifacts", async () => {
  const repository = createRemote();
  try {
    const fixture = runFixture("unchanged-acquisition");
    const root = rootFor(repository.remote);
    const first = await root.run(fixture.input);
    assert.equal(first.status, "COMMITTED", JSON.stringify(first));
    const before = await root.restore();
    const second = await root.run({ ...fixture.input, run_id: `${fixture.input.run_id}-again`,
      execute_trusted_chain: async () => { throw new Error("Trusted Chain must not rerun on identical Raw"); } });
    assert.equal(second.status, "NOT_MODIFIED", JSON.stringify(second));
    assert.equal(second.error, null);
    assert.ok(second.committed_head);
    const fresh = await rootFor(repository.remote).restore();
    assert.equal(fresh.source_execution_outcomes.at(-1)?.status, "NOT_MODIFIED");
    assert.deepEqual(fresh.read_models, before.read_models);
    assert.equal(fresh.restored_record_count, before.restored_record_count);
  } finally { repository.remove(); }
});

test("production entry uses its own trusted binding, not the caller's canary executor", async () => {
  const repository = createRemote();
  try {
    const fixture = runFixture("owned-binding");
    const { execute_trusted_chain: unusedCanaryExecutor, ...productionInput } = fixture.input;
    assert.ok(unusedCanaryExecutor);
    const root = rootFor(repository.remote);
    const result = await root.runProduction(productionInput);
    assert.equal(result.status, "COMMITTED", JSON.stringify(result));
    const processB = await rootFor(repository.remote).restore();
    assert.equal(processB.source_execution_outcomes[0]?.trusted_chain_status, "COMMITTED");
    assert.equal(processB.presentation_decisions.length, 1, JSON.stringify({
      seals: processB.artifact_seals, read_models: processB.read_models,
      runs: processB.runs
    }));
    assert.equal(processB.presentation_decisions[0]?.status, "EVIDENCE_BLOCKED");
    assert.equal(processB.read_models.length, 1);
    const deniedRoot = bootstrapZeroCostProductionCompositionRoot({ remote_url: repository.remote,
      branch: "main", stream_id: "zero-cost-production-test", now: () => OBSERVED_AT });
    await assert.rejects(() => deniedRoot.run(fixture.input), /CALLER_TRUSTED_CHAIN_EXECUTOR_DENIED/u);
    await assert.rejects(() => deniedRoot.runProduction(Object.assign({}, productionInput, {
      execute_trusted_chain: async () => undefined
    })), /CALLER_TRUSTED_CHAIN_EXECUTOR_DENIED/u);
    await assert.rejects(() => deniedRoot.runProduction(Object.assign({}, productionInput, {
      source_role_for_record: () => "PACKAGE" as const
    })), /CALLER_TRUSTED_CHAIN_EXECUTOR_DENIED/u);
  } finally { repository.remove(); }
});

test("production binding preserves package records without treating them as positions", async () => {
  const repository = createRemote();
  try {
    const fixture = runFixture("owned-package-binding");
    const adapter: RecruitmentAdapter = {
      ...fixture.input.adapter,
      extract(input) {
        const position = fixture.input.adapter.extract(input)[0]!;
        const { recruitment_context: ignoredContext, ...packageFields } = position;
        return [{ ...packageFields,
          extracted_record_id: `${position.extracted_record_id}:package` as never,
          raw_source_record_id: "official-announcement-package",
          identity_candidates: [{ kind: "SOURCE_RECORD_ID", value: "official-announcement-package", confidence: "HIGH" }],
          source_record_locator: { kind: "OTHER", locator: "official-announcement-package" }
        }, position];
      },
      assessCompleteness(input) {
        return input.records.length === 2 && input.extraction_errors.length === 0
          ? { status: "COMPLETE", reason_codes: ["TEST_COMPLETE"] }
          : { status: "FAILED", reason_codes: ["TEST_INCOMPLETE"] };
      }
    };
    const { execute_trusted_chain: unusedCanaryExecutor, ...productionInput } = fixture.input;
    assert.ok(unusedCanaryExecutor);
    const result = await rootFor(repository.remote).runProduction({ ...productionInput, adapter });
    assert.equal(result.status, "COMMITTED", JSON.stringify(result));
    const restored = await rootFor(repository.remote).restore();
    assert.equal(restored.artifact_seals.filter(seal => seal.artifact_kind === "SOURCE_OCCURRENCE_VERSION").length, 2);
    assert.equal(restored.presentation_decisions.length, 1);
    assert.equal(restored.read_models[0]?.presentation_status, "EVIDENCE_BLOCKED");
  } finally { repository.remove(); }
});

test("parser failure after Raw and partial extraction preserve acquired evidence in Process B", async () => {
  for (const scenario of ["PARSER_FAILED", "PARTIAL_EXTRACTION"] as const) {
    const repository = createRemote();
    try {
      const fixture = runFixture(`evidence-${scenario.toLowerCase()}`);
      const adapter: RecruitmentAdapter = scenario === "PARSER_FAILED"
        ? { ...fixture.input.adapter, extract() { throw new Error("controlled parser failure"); } }
        : { ...fixture.input.adapter, nextPage() { throw new Error("controlled pagination extraction failure"); } };
      const result = await rootFor(repository.remote).run({ ...fixture.input, adapter });
      assert.equal(result.status, scenario === "PARSER_FAILED" ? "FAILED" : "PARTIAL", JSON.stringify(result));
      assert.ok(result.committed_head);
      assert.equal(result.raw_blob_ids.length, 1);
      assert.equal(result.snapshot_ids.length, 1);
      assert.equal(result.extracted_record_ids.length, scenario === "PARSER_FAILED" ? 0 : 1);
      const restored = await rootFor(repository.remote).restore();
      assert.deepEqual(restored.source_execution_outcomes[0]?.raw_blob_ids, result.raw_blob_ids);
      assert.deepEqual(restored.source_execution_outcomes[0]?.extracted_record_ids, result.extracted_record_ids);
      assert.equal(restored.source_execution_outcomes[0]?.status, scenario === "PARSER_FAILED" ? "FAILED" : "PARTIAL");
      assert.equal(restored.restored_record_count, 0);
    } finally { repository.remove(); }
  }
});

test("official closed JSON empty is committed only through P1 guard and restores without hiding prior state", async () => {
  const repository = createRemote();
  try {
    const fixture = runFixture("closed-official-zero", "JSON");
    const root = rootFor(repository.remote);
    const first = await root.run(fixture.input);
    assert.equal(first.status, "COMMITTED", JSON.stringify(first));
    const prior = await root.restore();
    const emptyAdapter = { ...fixture.input.adapter, extract: () => [],
      assessCompleteness: () => ({ status: "COMPLETE" as const, reason_codes: [] }) };
    const weakBytes = new TextEncoder().encode('{"jobs":[]}');
    const weak = await root.run({ ...fixture.input,
      run_id: `${fixture.input.run_id}-weak-zero`, adapter: emptyAdapter,
      transport: { async execute() { return { status: "SUCCESS" as const, bytes: weakBytes,
        content_sha256: createHash("sha256").update(weakBytes).digest("hex") as never,
        responded_at: OBSERVED_AT, mime_type: "application/json", http_status: 200, headers: {} }; } },
      execute_trusted_chain: async () => { throw new Error("Weak empty must not enter business chain"); }
    });
    assert.equal(weak.status, "SUSPICIOUS_EMPTY", JSON.stringify(weak));
    assert.equal((await rootFor(repository.remote).restore()).source_execution_outcomes.at(-1)?.status,
      "SUSPICIOUS_EMPTY");
    const emptyBytes = new TextEncoder().encode('{"jobs":[],"total":0,"next":null}');
    const second = await root.run({ ...fixture.input,
      run_id: `${fixture.input.run_id}-official-zero`,
      adapter: emptyAdapter,
      transport: { async execute() { return { status: "SUCCESS", bytes: emptyBytes,
        content_sha256: createHash("sha256").update(emptyBytes).digest("hex") as never,
        responded_at: OBSERVED_AT, mime_type: "application/json", http_status: 200, headers: {} }; } },
      execute_trusted_chain: async () => { throw new Error("Empty collection must not enter business chain"); }
    });
    assert.equal(second.status, "CONFIRMED_EMPTY", JSON.stringify(second));
    assert.equal(second.error, null);
    const fresh = await rootFor(repository.remote).restore();
    assert.equal(fresh.source_execution_outcomes.at(-1)?.status, "CONFIRMED_EMPTY");
    assert.equal(fresh.source_execution_outcomes.at(-1)?.acquisition_evidence.assessment?.status, "CONFIRMED_EMPTY");
    assert.deepEqual(fresh.read_models, prior.read_models);
    assert.equal(fresh.restored_record_count, prior.restored_record_count);
    const scriptPath = path.join(repository.local, "source-outcome-process-b.ts");
    const markerPath = path.join(repository.local, "source-outcome-process-b.json");
    writeFileSync(scriptPath, `
      import ${JSON.stringify(pathToFileURL(path.resolve("tests/helpers/network-guard.ts")).href)};
      import { writeFileSync } from "node:fs";
      import { bootstrapZeroCostProductionCompositionRoot } from ${JSON.stringify(pathToFileURL(path.resolve("lib/production-persistence/zero-cost-production-composition-root.ts")).href)};
      void (async () => {
        const state = await bootstrapZeroCostProductionCompositionRoot({ remote_url: ${JSON.stringify(repository.remote)},
          branch: "main", stream_id: "zero-cost-production-test" }).restore();
        writeFileSync(${JSON.stringify(markerPath)}, JSON.stringify(state.source_execution_outcomes));
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `, "utf8");
    const child = spawnSync(process.execPath, ["--import",
      pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href, scriptPath], { encoding: "utf8" });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
    assert.deepEqual(JSON.parse(readFileSync(markerPath, "utf8")), fresh.source_execution_outcomes);
  } finally { repository.remove(); }
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

test("changed Raw cannot forge SOV discovery support and Process B retains prior state", async () => {
  const repository = createRemote();
  try {
    const fixture = runFixture("discovery-support");
    const productionRoot = rootFor(repository.remote);
    const first = await productionRoot.run(fixture.input);
    assert.equal(first.status, "COMMITTED", JSON.stringify(first));
    const originalState = await productionRoot.restore();
    const originalModel = originalState.read_models[0]!;
    let previousHead = git(repository.remote, "rev-parse", "main").trim();
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
      assert.ok(failed.committed_head, failure);
      assert.notEqual(failed.committed_head, previousHead, failure);
      previousHead = failed.committed_head!;
      assert.equal(git(repository.remote, "rev-parse", "main").trim(), previousHead, failure);
    }
    assert.deepEqual((await productionRoot.restore()).read_models, [originalModel]);
    const secondRoot = bootstrapZeroCostProductionCompositionRoot({ remote_url: repository.remote,
      branch: "main", stream_id: "zero-cost-production-test", now: () => AS_OF, execution_mode: "TEST_ONLY" });
    const second = await secondRoot.run({ ...fixture.input,
      run_id: `${fixture.input.run_id}-changed-raw`, started_at: AS_OF,
      transport: { async execute(request) {
        const original = await fixture.input.transport.execute(request);
        if (original.status !== "SUCCESS") throw new Error("Expected successful controlled response");
        const bytes = new Uint8Array([...original.bytes, 10]);
        return { ...original, bytes, content_sha256: createHash("sha256").update(bytes).digest("hex") as never,
          responded_at: AS_OF };
      } }
    });
    assert.equal(second.status, "FAILED");
    assert.match(second.error ?? "", /Raw changed; identical normalized text is not sufficient/u);
    assert.ok(second.committed_head);
    const processB = await secondRoot.restore();
    assert.equal(processB.source_execution_outcomes.at(-1)?.trusted_chain_status, "FAILED");
    assert.deepEqual(processB.read_models, [originalModel]);
    assert.deepEqual(processB.artifact_seals, originalState.artifact_seals);
    assert.equal(Number(git(repository.remote, "rev-list", "--count", "main")),
      Number(git(repository.remote, "rev-list", "--count", previousHead)) + 1);
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

test("validated acquisition survives downstream failure while invalid inputs commit no state", async () => {
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
      const acquisitionWasValid = !["raw-persistence", "validation"].includes(scenario.name);
      assert.equal(Boolean(result.committed_head), acquisitionWasValid, scenario.name);
      const after = git(repository.remote, "rev-parse", "main").trim();
      assert.equal(after === before, !acquisitionWasValid, scenario.name);
      if (acquisitionWasValid) {
        const restored = await rootFor(repository.remote).restore();
        assert.equal(restored.source_execution_outcomes.length, 1);
        assert.equal(restored.source_execution_outcomes[0]?.trusted_chain_status,
          scenario.name === "acquisition" ? "NOT_RUN" : "FAILED");
      }
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
    execution_mode: "TEST_ONLY",
    remote_url: remote,
    branch: "main",
    stream_id: "zero-cost-production-test",
    now: () => OBSERVED_AT,
    fault_injector: faultInjector
  });
}

function runFixture(suffix: string, contentKind: "HTML" | "JSON" = "HTML") {
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
    content_kind: contentKind,
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
  const bytes = new TextEncoder().encode(contentKind === "JSON"
    ? '{"jobs":[{"title":"法务岗"}],"total":1,"next":null}'
    : `official recruitment ${suffix}`);
  const transport = {
    async execute(request: TransportRequest): Promise<TransportResponse> {
      const hash = createHash("sha256").update(bytes).digest("hex");
      return {
        status: "SUCCESS",
        responded_at: OBSERVED_AT,
        bytes: new Uint8Array(bytes),
        content_sha256: hash as never,
        mime_type: contentKind === "JSON" ? "application/json" : "text/html",
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
      supported_content_kinds: [endpoint.content_kind],
      capabilities: endpoint.content_kind === "JSON" ? ["SINGLE_PAGE", "JSON_EXTRACTION"] : ["SINGLE_PAGE", "HTML_EXTRACTION"]
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
