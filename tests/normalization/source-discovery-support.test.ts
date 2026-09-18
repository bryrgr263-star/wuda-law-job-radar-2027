import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  bootstrapTrustedChainCompositionRoot,
  createExtractedRecordV2,
  semanticHashFor,
  prepareSourceOccurrenceMaterialization,
  type TrustedChainCommand,
  type TrustedRestorationExecution
} from "../../lib/ingestion";
import { assertSOVDiscoverySupportIntegrity, SOVDiscoverySupportError, type SOVDiscoverySupport } from
  "../../lib/ingestion/normalization/source-discovery-support";
import { canonicalHash } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { AS_OF, OBSERVED_AT, trustedFixture } from "../pipeline/position-bound-phase-fixture";

const metadata = { actor: "support-test", recorded_at: AS_OF };

function context(suffix = "restoration-v2-rediscovery-blocker") {
  const fixture = trustedFixture(suffix);
  const bytes = new TextEncoder().encode(`trusted-chain-raw-${suffix}`);
  assert.equal(fixture.source.snapshot.transport_status, "SUCCESS");
  const snapshot = { ...fixture.source.snapshot, content_length: bytes.length,
    response_metadata: { ...fixture.source.snapshot.response_metadata, content_length: bytes.length } };
  const record = createExtractedRecordV2(snapshot, fixture.source.extracted_record);
  const secondSnapshot = { ...structuredClone(snapshot),
    snapshot_id: `${snapshot.snapshot_id}-rediscovery` as typeof snapshot.snapshot_id,
    observed_at: AS_OF,
    request_metadata: { ...snapshot.request_metadata, requested_at: AS_OF } };
  const secondRecord = createExtractedRecordV2(secondSnapshot, record);
  const reference = { artifact_id: "fixture:source-reference", integrity_hash: canonicalHash("fixture:source-reference") };
  const evidence = (eventSnapshot: typeof snapshot, eventRecord: typeof record) => ({
    scope: "SYNTHETIC_TEST" as const,
    endpoint: fixture.source.endpoint,
    snapshot: eventSnapshot,
    extracted_record: eventRecord,
    raw_blob: { raw_blob_id: eventSnapshot.raw_blob_id!, bytes: new Uint8Array(bytes),
      sha256: eventSnapshot.content_hash!, byte_length: bytes.length,
      content_type: eventSnapshot.response_metadata.mime_type! },
    acquisition: { acquisition_run_id: `fixture:${eventSnapshot.snapshot_id}`, status: "SUCCESS" as const,
      integrity_hash: canonicalHash(eventSnapshot), complete: true },
    source_reference: { source_definition: reference, endpoint: reference, admission: reference,
      allowlist: reference, authority_level: "OFFICIAL" as const }
  });
  const firstEvidence = evidence(snapshot, record);
  const secondEvidence = evidence(secondSnapshot, secondRecord);
  const executions: TrustedRestorationExecution<TrustedChainCommand>[] = [];
  const journal = {
    async list() { return structuredClone(executions.map((execution) => execution.record)); },
    async appendExecution(execution: TrustedRestorationExecution<TrustedChainCommand>) {
      executions.push(structuredClone(execution)); return "APPENDED" as const;
    },
    async readArtifactEnvelope(kind: string, id: string, scope: string) {
      return structuredClone(executions.flatMap((execution) => execution.artifact_envelopes)
        .find((envelope) => envelope.artifact_kind === kind && envelope.artifact_id === id && envelope.scope === scope) ?? null);
    },
    async readVerifiedDiscovery(snapshotId: string, recordId: string) {
      const found = [firstEvidence, secondEvidence].find((item) => item.snapshot.snapshot_id === snapshotId
        && item.extracted_record.extracted_record_id === recordId);
      if (!found) throw new Error("EVIDENCE_BLOCKED: missing discovery");
      return structuredClone(found);
    }
  };
  const supportCommand = {
    kind: "SOURCE_DISCOVERY_SUPPORT_VERIFY" as const,
    input: { schema_version: "trusted-sov-discovery-support/1.0.0" as const,
      sov_id: fixture.source.version.source_occurrence_version_id,
      snapshot_id: secondSnapshot.snapshot_id, extracted_record_id: secondRecord.extracted_record_id,
      source_role: "POSITION_BEARING" as const }
  };
  const registration = {
    kind: "OPPORTUNITY_REGISTER" as const,
    source_binding: { kind: "VERIFIED_DISCOVERY_SUPPORT" as const, support_id: "" },
    input: { source_definition_id: fixture.source.endpoint.source_definition_id,
      recruitment_endpoint_id: fixture.source.endpoint.recruitment_endpoint_id,
      discovery_locator: fixture.source.endpoint.locator,
      snapshot_id: secondSnapshot.snapshot_id, extracted_record_id: secondRecord.extracted_record_id,
      source_occurrence_version_id: fixture.source.version.source_occurrence_version_id,
      publisher_subject: null, discovery_evidence_ids: ["fixture:synthetic-support"], first_observed_at: AS_OF,
      initial_disposition: { status: "RETAINED" as const, reason_codes: ["OFFICIAL_RECRUITMENT_DISCOVERED"],
        evidence_ids: ["fixture:synthetic-support"], decided_at: AS_OF } }
  };
  return { fixture, snapshot, record, secondSnapshot, secondRecord, firstEvidence, secondEvidence,
    journal, executions, supportCommand, registration };
}

async function issuedContext() {
  const state = context();
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: state.journal });
  const original = await root.execute({ kind: "SOURCE_OCCURRENCE_MATERIALIZE", input: {
    source_role: "POSITION_BEARING", endpoint: state.fixture.source.endpoint,
    snapshot: state.snapshot, extracted_record: state.record
  } }, { actor: "original-issuer", recorded_at: OBSERVED_AT });
  return { ...state, root, original };
}

test("Case A: exact rediscovery issues support, retains original SOV, and reuses original envelope", async () => {
  const state = await issuedContext();
  const issued = await state.root.execute(state.supportCommand, metadata) as {
    support_created: boolean; support: { support_id: string; integrity_hash: string }
  };
  assert.equal(issued.support_created, true);
  assert.ok(issued.support.support_id);
  const reused = await state.root.execute(state.supportCommand, { actor: "another-actor", recorded_at: "2026-09-10T12:00:00+08:00" }) as typeof issued;
  assert.equal(reused.support_created, false);
  assert.deepEqual(reused.support, issued.support);
  assert.deepEqual(state.executions[2]!.artifact_envelopes, state.executions[1]!.artifact_envelopes);
  assert.notEqual(state.executions[2]!.record.provenance.actor, state.executions[1]!.record.provenance.actor);
  assert.deepEqual(state.root.resolvers.source_occurrences.resolve(state.supportCommand.input.sov_id), state.original);
  await assert.rejects(state.root.execute({ kind: "OPPORTUNITY_REGISTER", input: state.registration.input }, metadata), /provenance does not match/);
  const registered = await state.root.execute({ ...state.registration,
    source_binding: { kind: "VERIFIED_DISCOVERY_SUPPORT", support_id: issued.support.support_id } }, metadata) as {
      candidate: { snapshot_id: string; extracted_record_id: string }; disposition: { status: string }
    };
  assert.equal(registered.candidate.snapshot_id, state.secondSnapshot.snapshot_id);
  assert.equal(registered.candidate.extracted_record_id, state.secondRecord.extracted_record_id);
  assert.equal(registered.disposition.status, "RETAINED");
  assert.ok(state.executions.at(-1)!.artifact_envelopes.every((envelope) => envelope.upstream_references.some((reference) =>
    reference.upstream_artifact_kind === "SOV_DISCOVERY_SUPPORT" && reference.upstream_artifact_id === issued.support.support_id
    && reference.expected_seal === issued.support.integrity_hash)));
  const processB = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: state.journal });
  assert.deepEqual(processB.root.resolvers.source_occurrences.resolve(state.supportCommand.input.sov_id), state.original);
});

for (const scenario of ["changed-raw", "wrong-bytes", "partial", "failed", "scope", "different-occurrence", "contract", "source-authority", "locator", "semantic-payload", "unknown-field"]) {
  test(`support rejects ${scenario} without altering original SOV or journal`, async () => {
    const state = await issuedContext();
    const evidence = state.secondEvidence;
    if (scenario === "changed-raw") {
      evidence.raw_blob.bytes[0] = 0;
      const hash = createHash("sha256").update(evidence.raw_blob.bytes).digest("hex");
      evidence.raw_blob.sha256 = hash as typeof evidence.raw_blob.sha256;
      evidence.raw_blob.raw_blob_id = `sha256:${hash}` as typeof evidence.raw_blob.raw_blob_id;
      evidence.snapshot = { ...evidence.snapshot, raw_blob_id: evidence.raw_blob.raw_blob_id, content_hash: evidence.raw_blob.sha256 };
      evidence.extracted_record = createExtractedRecordV2(evidence.snapshot, evidence.extracted_record);
    }
    if (scenario === "wrong-bytes") evidence.raw_blob.bytes[0] = 0;
    if (scenario === "partial") evidence.acquisition.complete = false;
    if (scenario === "failed") Object.assign(evidence.acquisition, { status: "FAILED" });
    if (scenario === "scope") Object.assign(evidence, { scope: "PRODUCTION" });
    if (scenario === "different-occurrence") evidence.extracted_record = createExtractedRecordV2(evidence.snapshot,
      { ...evidence.extracted_record, raw_source_record_id: "another-row" });
    if (scenario === "contract") evidence.extracted_record = createExtractedRecordV2(evidence.snapshot,
      { ...evidence.extracted_record, extraction: { ...evidence.extracted_record.extraction, extractor_version: "2.0.0" } });
    if (scenario === "source-authority") Object.assign(evidence.source_reference, { authority_level: "UNKNOWN" });
    if (scenario === "locator") evidence.extracted_record = createExtractedRecordV2(evidence.snapshot,
      { ...evidence.extracted_record, source_record_locator: { kind: "DOCUMENT", section: "another-row" } });
    if (scenario === "semantic-payload") evidence.extracted_record = createExtractedRecordV2(evidence.snapshot,
      { ...evidence.extracted_record, raw_requirement_text: { text: "学历要求：硕士及以上", encoding: "UTF-8" } });
    if (scenario === "unknown-field") Object.assign(evidence.extracted_record = structuredClone(evidence.extracted_record), { unrecognized_business_field: "must not omit" });
    state.supportCommand.input.extracted_record_id = evidence.extracted_record.extracted_record_id;
    if (scenario === "different-occurrence") {
      const prepared = prepareSourceOccurrenceMaterialization(evidence.endpoint, evidence.extracted_record, evidence.snapshot);
      assert.notEqual(prepared.identity_hash, state.fixture.source.occurrence.identity_hash);
      assert.equal(semanticHashFor(prepared.normalized.content), semanticHashFor(state.fixture.source.version.content));
    }
    const expectedCode = ["changed-raw", "different-occurrence", "contract", "locator", "semantic-payload", "unknown-field"].includes(scenario)
      ? "REVIEW_REQUIRED" : "EVIDENCE_BLOCKED";
    await assert.rejects(state.root.execute(state.supportCommand, metadata), (error: unknown) => error instanceof SOVDiscoverySupportError && error.code === expectedCode);
    assert.equal(state.executions.length, 1);
    assert.deepEqual(state.root.resolvers.source_occurrences.resolve(state.supportCommand.input.sov_id), state.original);
  });
}

test("support seal, collision rejection, exact consumption, and defensive clones", async () => {
  const state = await issuedContext();
  const issued = await state.root.execute(state.supportCommand, metadata) as { support: SOVDiscoverySupport };
  const resolved = state.root.resolvers.source_occurrences.resolveSupport(issued.support.support_id)!;
  assert.deepEqual(resolved, issued.support);
  Object.assign(resolved.discovery, { exact_locator: "forged" });
  assert.deepEqual(state.root.resolvers.source_occurrences.resolveSupport(issued.support.support_id), issued.support);
  assert.throws(() => assertSOVDiscoverySupportIntegrity(resolved), /integrity mismatch/);
  for (const supportId of ["missing-support", issued.support.support_id]) {
    const input = { ...state.registration.input, snapshot_id: state.snapshot.snapshot_id };
    await assert.rejects(state.root.execute({ ...state.registration, input,
      source_binding: { kind: "VERIFIED_DISCOVERY_SUPPORT", support_id: supportId } }, metadata), /exact discovery support binding mismatch/);
  }
  state.secondEvidence.acquisition.acquisition_run_id = "different-acquisition-for-same-event";
  await assert.rejects(state.root.execute(state.supportCommand, metadata), /identity collision/);
  assert.equal(state.executions.length, 2);
  assert.deepEqual(state.root.resolvers.source_occurrences.resolveSupport(issued.support.support_id), issued.support);
});

test("changed supported semantics yields existing materializer revision and blocks stale support", async () => {
  const state = await issuedContext();
  const changed = createExtractedRecordV2(state.secondSnapshot, { ...state.secondRecord,
    raw_requirement_text: { text: "学历要求：硕士及以上", encoding: "UTF-8" } });
  const next = await state.root.execute({ kind: "SOURCE_OCCURRENCE_MATERIALIZE", input: {
    source_role: "POSITION_BEARING", endpoint: state.fixture.source.endpoint, snapshot: state.secondSnapshot, extracted_record: changed
  } }, metadata) as { version: { revision: number; source_occurrence_version_id: string } };
  assert.equal(next.version.revision, 2);
  assert.notEqual(next.version.source_occurrence_version_id, state.supportCommand.input.sov_id);
  await assert.rejects(state.root.execute(state.supportCommand, metadata), (error: unknown) => error instanceof SOVDiscoverySupportError && error.code === "STALE_SUPPORT_WRITER");
  assert.deepEqual(state.root.resolvers.source_occurrences.resolve(state.supportCommand.input.sov_id), state.original);
});

test("missing reader, orphan target, missing event and invalid actor never issue support", async () => {
  const state = await issuedContext();
  const missingReader = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST",
    restoration_journal: { list: state.journal.list, appendExecution: state.journal.appendExecution } });
  await assert.rejects(missingReader.root.execute(state.supportCommand, metadata), /persisted discovery reader/);
  await assert.rejects(state.root.execute({ ...state.supportCommand, input: { ...state.supportCommand.input,
    sov_id: "missing-sov" as typeof state.supportCommand.input.sov_id } }, metadata), /missing\/orphaned/);
  await assert.rejects(state.root.execute({ ...state.supportCommand, input: { ...state.supportCommand.input,
    snapshot_id: "missing-snapshot" as typeof state.snapshot.snapshot_id } }, metadata), /missing discovery/);
  await assert.rejects(state.root.execute(state.supportCommand, { actor: "", recorded_at: "not-a-time" }), /actor\/time/);
  assert.equal(state.executions.length, 1);
});

test("rehydration rejects missing support, altered dependencies and changed proof without skipping records", async () => {
  const state = await issuedContext();
  const issued = await state.root.execute(state.supportCommand, metadata) as { support: SOVDiscoverySupport };
  await state.root.execute({ ...state.registration, source_binding: { kind: "VERIFIED_DISCOVERY_SUPPORT", support_id: issued.support.support_id } }, metadata);
  state.secondEvidence.raw_blob.bytes[0] = 0;
  await assert.rejects(bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: state.journal }), /RawBlob/);
  state.executions.splice(1, 1);
  await assert.rejects(bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: state.journal }), /sequence|continuity|previous/i);
});

test("reuse cannot accept a tampered original issuance envelope", async () => {
  const state = await issuedContext();
  const issued = await state.root.execute(state.supportCommand, metadata) as { support: SOVDiscoverySupport };
  const originalReader = state.journal.readArtifactEnvelope;
  state.journal.readArtifactEnvelope = async (kind, id, scope) => {
    const envelope = await originalReader(kind, id, scope);
    if (envelope) Object.assign(envelope, { integrity_hash: "0".repeat(64) });
    return envelope;
  };
  await assert.rejects(state.root.execute(state.supportCommand, metadata), /envelope integrity mismatch/);
  assert.equal(state.executions.length, 2);
  assert.deepEqual(state.root.resolvers.source_occurrences.resolveSupport(issued.support.support_id), issued.support);
});
