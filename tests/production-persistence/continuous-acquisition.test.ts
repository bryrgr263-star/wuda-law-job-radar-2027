import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { replayContinuousRecords, reserveContinuousRecord, closeContinuousRecord, revokeContinuousRecord,
  pendingContinuousAttempt, type ContinuousRecord } from "../../lib/application/source-admission/continuous-acquisition";
import { AT, LATER, fixture, issue, request } from "./continuous-acquisition-fixture";

function restore(input: ReturnType<typeof fixture>, records: ContinuousRecord[]) {
  input.owner.restoreContinuousRecords(records, () => input.context);
}
test("existing Admission owner issues immutable controlled grants; actor/time reuse preserves original bytes", () => {
  const input = fixture(); const first = issue(input); restore(input, [first]);
  assert.equal(first.payload.grant?.canonical_payload.scope, "CONTROLLED_TEST");
  assert.deepEqual(issue(input, { actor: "another", issued_at: LATER }), first);
  const version = issue(input, { min_interval_seconds: 120 });
  assert.equal(version.payload.grant?.authorization_version, 2);
  assert.equal(version.payload.grant?.authorization_id, first.payload.grant?.authorization_id);
  restore(input, [first, version]);
  const clone = input.owner.listContinuousRecords(); Reflect.set(clone[0]!.payload.grant!, "integrity_seal", "tampered");
  assert.equal(input.owner.listContinuousRecords()[0]!.payload.grant?.integrity_seal, first.payload.grant?.integrity_seal);
});
test("missing approval, mismatched bindings, expanded scope and invalid cadence fail closed", () => {
  const input = fixture();
  for (const changes of [{ min_interval_seconds: 0 }, { min_interval_seconds: 59 }, { effective_from: "2025-01-01T00:00:00.000Z" }]) assert.throws(() => issue(input, changes));
  const altered = structuredClone(input.context); Reflect.set(altered.admission, "evidence", []);
  assert.throws(() => input.owner.issueContinuousAuthorization(altered, { effective_from: AT, min_interval_seconds: 60, actor: "test", issued_at: AT }));
  const context = structuredClone(input.context); Reflect.set(context.target, "approval_evidence_ids", []);
  Reflect.set(context.bindings.target, "semantic_hash", canonicalHash(context.target));
  assert.throws(() => input.owner.issueContinuousAuthorization(context, { effective_from: AT, min_interval_seconds: 60, actor: "test", issued_at: AT }), /APPROVAL_BINDING/);
});
test("every exact URL, method, query, fragment, body, cookie/header and discovery variant is denied", () => {
  const input = fixture(); const grant = issue(input); const records = [grant]; const id = grant.payload.grant!.authorization_id;
  assert.equal(reserveContinuousRecord(records, id, input.context, request, "first", "holder", AT, "CONTROLLED_TEST").kind, "RESERVE");
  const variants: Partial<Parameters<typeof reserveContinuousRecord>[3]>[] = [{ locator: request.locator + "/sibling" }, { locator: request.locator + "?page=1" },
    { locator: request.locator + "#x" }, { locator: "https://unapproved.invalid/recruitment" }, { method: "POST" }, { method: "HEAD" }, { headers: { Cookie: "session=1" } },
    { headers: { Authorization: "x" } }, { parameters: { page: 2 } }, { body: new Uint8Array() }];
  for (const change of variants) {
    assert.throws(() => reserveContinuousRecord(records, id, input.context, { ...request, ...change }, "bad", "holder", AT, "CONTROLLED_TEST"), /EXACT_REQUEST_DENIED/);
  }
  assert.throws(() => reserveContinuousRecord(records, id, input.context, request, "bad", "holder", AT, "PRODUCTION"), /SCOPE_MISMATCH/);
});
test("allowlist and Endpoint substitution cannot reuse an exact-target grant", () => {
  const input = fixture(); const first = issue(input); const id = first.payload.grant!.authorization_id;
  for (const field of ["source", "admission", "endpoint", "target"] as const) {
    const altered = structuredClone(input.context); Reflect.set(altered.bindings[field], "id", "unapproved-substitution");
    assert.throws(() => reserveContinuousRecord([first], id, altered, request, "bad", "holder", AT, "CONTROLLED_TEST"), /SOURCE_BINDING/);
  }
});
test("future grants and clock rollback never create an eligible network attempt", () => {
  const input = fixture(); const first = issue(input, { effective_from: LATER }); const id = first.payload.grant!.authorization_id;
  assert.throws(() => reserveContinuousRecord([first], id, input.context, request, "early", "holder", AT, "CONTROLLED_TEST"), /NOT_EFFECTIVE/);
  const reserved = reserveContinuousRecord([first], id, input.context, request, "allowed", "holder", LATER, "CONTROLLED_TEST");
  assert.throws(() => closeContinuousRecord([first, reserved], "allowed", "holder", AT, "SUCCESS"), /CLOCK/);
});
test("revocation is terminal, append-only and idempotent; old grant fallback never resurrects authorization", () => {
  const input = fixture(); const first = issue(input); restore(input, [first]);
  const second = issue(input, { min_interval_seconds: 120 }); const id = first.payload.grant!.authorization_id;
  const revoked = revokeContinuousRecord([first, second], id, "operator", AT, "review:revoke");
  restore(input, [first, second, revoked]);
  assert.equal(input.owner.resolveContinuousAuthorization(id).state, "REVOKED");
  assert.deepEqual(input.owner.revokeContinuousAuthorization(id, "other", LATER, "another"), revoked);
  assert.throws(() => issue(input), /REVOKED/);
  assert.throws(() => input.owner.reserveContinuousAttempt(id, input.context, request, "bad", "holder", LATER, "CONTROLLED_TEST"), /REVOKED/);
  assert.equal(first.payload.grant!.authorization_version, 1);
});
test("failed HTTP consumes cadence, completion anchors interval, version and fresh restoration do not reset it", () => {
  const input = fixture(); const first = issue(input); const id = first.payload.grant!.authorization_id;
  const reserved = reserveContinuousRecord([first], id, input.context, request, "one", "holder", AT, "CONTROLLED_TEST");
  const completed = closeContinuousRecord([first, reserved], "one", "holder", "2026-09-18T00:00:10.000Z", "FAILED");
  const records = [first, reserved, completed]; restore(input, records);
  records.push(issue(input, { min_interval_seconds: 65 }));
  const processB = fixture(); restore(processB, records);
  assert.throws(() => processB.owner.reserveContinuousAttempt(id, processB.context, request, "two", "holder", "2026-09-18T00:01:00.000Z", "CONTROLLED_TEST"), /CADENCE/);
  assert.equal(processB.owner.reserveContinuousAttempt(id, processB.context, request, "two", "holder", LATER, "CONTROLLED_TEST").kind, "RESERVE");
  assert.throws(() => processB.owner.reserveContinuousAttempt(id, processB.context, request, "two", "holder", "invalid", "CONTROLLED_TEST"), /CLOCK/);
});
test("pending before-send and unknown-send both exclude attempts, issuance and revocation indefinitely; recovery requires verified fencing", () => {
  const input = fixture(); const first = issue(input); const id = first.payload.grant!.authorization_id;
  const reserved = reserveContinuousRecord([first], id, input.context, request, "pending", "holder", AT, "CONTROLLED_TEST");
  const records = [first, reserved]; restore(input, records);
  assert.equal(pendingContinuousAttempt(records)?.payload.attempt_id, "pending");
  assert.throws(() => issue(input, { min_interval_seconds: 120 }), /PENDING/);
  assert.throws(() => input.owner.revokeContinuousAuthorization(id, "operator", LATER, "revoke"), /PENDING/);
  assert.throws(() => input.owner.reserveContinuousAttempt(id, input.context, request, "two", "holder", "2030-01-01T00:00:00.000Z", "CONTROLLED_TEST"), /PENDING/);
  assert.throws(() => input.owner.closeContinuousAttempt("pending", "wrong-holder", LATER, "SUCCESS"), /HOLDER/);
  const evidence = { worker: "holder", terminated: true };
  assert.throws(() => input.owner.closeContinuousAttempt("pending", "holder", LATER, "FENCED_UNKNOWN", evidence), /FENCING/);
  const verifier = (attempt: ContinuousRecord, proof: Readonly<Record<string, unknown>>) => proof.terminated === true && proof.worker === attempt.payload.holder;
  const recovered = input.owner.closeContinuousAttempt("pending", "holder", LATER, "FENCED_UNKNOWN", evidence, verifier);
  assert.throws(() => replayContinuousRecords([...records, recovered], () => input.context), /FENCING/);
  assert.equal(replayContinuousRecords([...records, recovered], () => input.context, verifier).length, 3);
  assert.throws(() => reserveContinuousRecord([...records, recovered], id, input.context, request, "next", "holder", LATER, "CONTROLLED_TEST"), /CADENCE/);
});
test("replay rejects corrupted seals, missing upstream, modified envelope, conflicting records and forged revocation", () => {
  const input = fixture(); const first = issue(input); const id = first.payload.grant!.authorization_id;
  const revoked = revokeContinuousRecord([first], id, "operator", AT, "revoke");
  for (const record of [first, revoked]) {
    const corrupted = structuredClone(record); Reflect.set(corrupted, "integrity_hash", "wrong");
    assert.throws(() => replayContinuousRecords(record.kind === "GRANT" ? [corrupted] : [first, corrupted], () => input.context), /INTEGRITY/);
  }
  const altered = structuredClone(first); Reflect.set(altered.payload.grant!.issuance_envelope, "approval_review_id", "forged");
  const { integrity_hash: ignored, ...content } = altered; Reflect.set(altered, "integrity_hash", canonicalHash(content));
  assert.throws(() => replayContinuousRecords([altered], () => input.context), /REPLAY/);
  assert.throws(() => replayContinuousRecords([first], () => { throw new Error("missing upstream"); }), /missing upstream/);
  assert.throws(() => replayContinuousRecords([first, first], () => input.context), /COLLISION/);
  assert.equal(canonicalSerialize(first), canonicalSerialize(issue(input)));
});
