import "../helpers/network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { ReadOnlyPresentationApi } from "../../lib/presentation-read-api";
import {
  PostgresPresentationReadRepository,
  ProductionCandidateEvidenceObjectBoundary,
  PRODUCTION_CANDIDATE_EVIDENCE_BUCKET,
  type PostgresExecutor,
  type PrivateCandidateEvidenceObjectStorage
} from "../../lib/production-persistence";
import { sealedDecision, sealedModel } from "../persistence/presentation-fixture";

test("Candidate Evidence object boundary writes once and verifies SHA-256 before trust", async () => {
  const bytes = new TextEncoder().encode("test-only candidate evidence object");
  const storage = new EvidenceStorage(bytes);
  const boundary = new ProductionCandidateEvidenceObjectBoundary(storage);
  const reference = await boundary.persistVerifiedObject({
    bytes,
    content_type: "application/pdf"
  });
  assert.equal(reference.bucket_id, PRODUCTION_CANDIDATE_EVIDENCE_BUCKET);
  assert.equal(reference.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(storage.upsert, false);
});

test("missing or changed Candidate Evidence object remains EVIDENCE_BLOCKED", async () => {
  const bytes = new TextEncoder().encode("test-only candidate evidence object");
  const storage = new EvidenceStorage(new TextEncoder().encode("changed"));
  await assert.rejects(
    new ProductionCandidateEvidenceObjectBoundary(storage).persistVerifiedObject({
      bytes,
      content_type: "application/pdf"
    }),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "EVIDENCE_BLOCKED"
  );
});

test("PostgreSQL Presentation reader reads only sealed production projections", async () => {
  const decision = sealedDecision("candidate:postgres-reader" as never,
    "recall:postgres-reader" as never, "a".repeat(64));
  const model = sealedModel(decision);
  const executor = new PresentationExecutor(model);
  const repository = new PostgresPresentationReadRepository(executor);
  const models = await repository.listCurrentReadModels();
  assert.deepEqual(models, [model]);
  assert.match(executor.sql, /presentation_read_model_projections/iu);
  assert.match(executor.sql, /scope = 'PRODUCTION'/iu);
  assert.doesNotMatch(executor.sql, /candidate_evidence|raw_blobs|command_journal|eligibility/iu);

  const api = new ReadOnlyPresentationApi(repository);
  const response = await api.handle(new Request(
    "https://test.invalid/api/presentation/v1/opportunities"
  ));
  const body = await response.json() as { opportunities: unknown[] };
  assert.equal(response.status, 200);
  assert.deepEqual(body.opportunities, [model]);
});

class EvidenceStorage implements PrivateCandidateEvidenceObjectStorage {
  upsert: boolean | null = null;

  constructor(readonly persisted: Uint8Array | null) {}

  async putIfAbsent(input: { readonly bytes: Uint8Array }) {
    this.upsert = false;
    assert.ok(input.bytes.byteLength > 0);
    return "CREATED" as const;
  }

  async read() {
    return this.persisted ? new Uint8Array(this.persisted) : null;
  }
}

class PresentationExecutor implements PostgresExecutor {
  sql = "";

  constructor(readonly model: unknown) {}

  async query<Row>(sql: string) {
    this.sql = sql;
    return { rows: [{ record_json: structuredClone(this.model) }] as Row[] };
  }

  async transaction<Result>(
    work: (executor: PostgresExecutor) => Promise<Result>
  ): Promise<Result> {
    return work(this);
  }
}
