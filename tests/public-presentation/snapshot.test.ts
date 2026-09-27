import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { createPublicSnapshot, validatePublicSnapshot } from "../../lib/public-presentation/snapshot";
import { fixtureInput } from "./helpers";
import { canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";

test("snapshot same SHA canonical bytes, explicit whitelist, four truthful positions", () => {
  const input = fixtureInput();
  const envelope = createPublicSnapshot(input);
  const payload = validatePublicSnapshot(envelope, input.authoritative_sha, envelope.payload_sha256);
  assert.equal(payload.positions.length, 4);
  assert.equal(new Set(payload.positions.map(item => item.position_id)).size, 4);
  assert.ok(payload.positions.every(item => item.presentation_status === "EVIDENCE_BLOCKED"
    && item.reason_codes.includes("RELEVANCE_ASSESSMENT_MISSING")));
  assert.equal(payload.positions.filter(item => item.application_link.state === "NOT_YET_AVAILABLE").length, 3);
  assert.equal(JSON.stringify(envelope), JSON.stringify(createPublicSnapshot(structuredClone(input))));
  assert.doesNotMatch(envelope.payload_canonical_bytes, /upstream|provenance|opportunity_candidate_id|requirement_fact_id/);
  assert.throws(() => validatePublicSnapshot(envelope, "0".repeat(40), envelope.payload_sha256));
  assert.throws(() => validatePublicSnapshot({ ...envelope, payload_sha256: "0".repeat(64) }, input.authoritative_sha, envelope.payload_sha256));
});

test("private extensions never publish; unknown reasons redact without hiding; duplicates fail", () => {
  const input = fixtureInput();
  const model = input.current_snapshot.current_position_read_models[0];
  Object.assign(model, { candidate_evidence: "PRIVATE_SENTINEL", token: "PRIVATE_SENTINEL" });
  Object.assign(model, { reason_codes: ["PRIVATE_SENTINEL"] });
  const envelope = createPublicSnapshot(input);
  assert.ok(!JSON.stringify(envelope).includes("PRIVATE_SENTINEL"));
  const payload = validatePublicSnapshot(envelope, input.authoritative_sha, envelope.payload_sha256);
  assert.equal(payload.positions.filter(item => item.reason_visibility === "REDACTED").length, 1);
  assert.equal(payload.positions.length, 4);
  input.current_snapshot = { ...input.current_snapshot,
    current_position_read_models: [...input.current_snapshot.current_position_read_models, model] };
  assert.throws(() => createPublicSnapshot(input), /DUPLICATE/);
});

test("unsafe links, oversized strings, null snapshot and mixed scope fail; valid empty stays valid", () => {
  const input = fixtureInput();
  Object.assign(input.current_snapshot.current_position_read_models[0], {
    application_link: { state: "AVAILABLE", value: "https://example.org/?token=SECRET" }
  });
  assert.throws(() => createPublicSnapshot(input), /LINK/);
  const large = fixtureInput();
  Object.assign(large.current_snapshot.current_position_read_models[0], {
    position_title: { state: "AVAILABLE", value: "a".repeat(16_385) }
  });
  assert.throws(() => createPublicSnapshot(large));
  const empty = fixtureInput();
  empty.current_snapshot = { ...empty.current_snapshot, current_position_read_models: [] };
  const envelope = createPublicSnapshot(empty);
  assert.equal(validatePublicSnapshot(envelope, empty.authoritative_sha, envelope.payload_sha256).position_count, 0);
  assert.throws(() => createPublicSnapshot({ ...empty, current_snapshot: null }));
  assert.throws(() => createPublicSnapshot({ ...empty,
    current_snapshot: { ...empty.current_snapshot, scope: "SYNTHETIC_TEST" } }));
});

test("summary nested privacy, canonical key order/Unicode, explicit statuses and future schema fail closed", () => {
  const input = fixtureInput();
  Object.assign(input.current_snapshot.current_position_read_models[0], { requirement_summary: {
    state: "AVAILABLE", value: [{ dimension: "EDUCATION", subject_scope: "CANDIDATE", polarity: "POSITIVE",
      certainty: "EXPLICIT", requirement_fact_id: "PRIVATE_SENTINEL", parser_version: "PRIVATE_SENTINEL",
      applicability: { candidate: "PRIVATE_SENTINEL" }, value: "PRIVATE_SENTINEL" }]
  }, position_title: { state: "AVAILABLE", value: "法务\n法律\u2028🚩" } });
  for (const [index, status] of ["DISPLAY", "DISPLAY_WITH_REVIEW", "EVIDENCE_BLOCKED", "NOT_DISPLAY"].entries()) {
    Object.assign(input.current_snapshot.current_position_read_models[index], { presentation_status: status });
  }
  const snapshot = createPublicSnapshot(input);
  assert.ok(!snapshot.payload_canonical_bytes.includes("PRIVATE_SENTINEL"));
  const payload = validatePublicSnapshot(snapshot, input.authoritative_sha, snapshot.payload_sha256);
  assert.equal(payload.position_count, 3);
  const reversed = Object.fromEntries(Object.entries(payload).reverse());
  assert.equal(canonicalSerialize(reversed), snapshot.payload_canonical_bytes);
  assert.throws(() => validatePublicSnapshot({ ...snapshot, schema_version: "public-presentation-envelope/2.0.0" },
    input.authoritative_sha, snapshot.payload_sha256));
});

test("public wire rejects negative zero and invalid generated calendar time", () => {
  const input = fixtureInput();
  Object.assign(input.current_snapshot.current_position_read_models[0], { recruitment_year: { state: "AVAILABLE", value: -0 } });
  assert.throws(() => createPublicSnapshot(input));
  assert.throws(() => createPublicSnapshot({ ...fixtureInput(), generated_at: "2026-99-99T99:99:99.000Z" }));
});

test("authentication or token embedded in decoded URL path rejects whole publication", () => {
  for (const value of ["https://example.org/reset-password/SECRET", "https://example.org/access_token/SECRET",
    "https://example.org/%61ccess_token/SECRET", "https://example.org/%2561ccess_token/SECRET", "https://example.org/session/SECRET"]) {
    const input = fixtureInput();
    Object.assign(input.current_snapshot.current_position_read_models[0], { application_link: { state: "AVAILABLE", value } });
    assert.throws(() => createPublicSnapshot(input), /LINK/);
  }
});
