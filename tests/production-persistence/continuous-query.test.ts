import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { issueContinuousRecord, reserveContinuousRecord, replayContinuousRecords, closeContinuousRecord, revokeContinuousRecord } from "../../lib/application/source-admission/continuous-acquisition";
import type { QueryAuthorizationContract } from "../../lib/application/source-admission/query-authorization";
import { AT, LATER, fixture, request, queryContext } from "./continuous-acquisition-fixture";

const command = { effective_from: AT, min_interval_seconds: 60, actor: "controlled-reviewer", issued_at: AT };
test("finite query grant binds contract and replays without normalizing historical no-query payload", () => {
  const context = queryContext();
  const grant = issueContinuousRecord([], context, command);
  assert.equal(grant.payload.grant!.canonical_payload.request_contract_version, "continuous-request/2.0.0");
  const reserve = reserveContinuousRecord([grant], grant.payload.grant!.authorization_id, context,
    { ...request, locator: `${request.locator}?page=1` }, "query-attempt", "holder", AT, "CONTROLLED_TEST");
  const complete = closeContinuousRecord([grant, reserve], "query-attempt", "holder", AT, "SUCCESS");
  assert.deepEqual(replayContinuousRecords([grant, reserve, complete], () => context), [grant, reserve, complete]);
  const historical = issueContinuousRecord([], fixture().context, command);
  assert.equal(Object.hasOwn(historical.payload.grant!.canonical_payload, "request_contract_version"), false);
  assert.equal(Object.hasOwn(historical.payload.grant!.canonical_payload, "query_contract_hash"), false);
  assert.equal(canonicalSerialize(replayContinuousRecords([historical], () => fixture().context)), canonicalSerialize([historical]));
});

test("finite combinations must match the independently approved exact target inventory", () => {
  const context = queryContext();
  const admission = { ...context.admission, continuous_acquisition_scope: { ...context.admission.continuous_acquisition_scope!, exact_targets: context.admission.continuous_acquisition_scope!.exact_targets.slice(0, 1) } };
  const incomplete = { ...context, admission, bindings: { ...context.bindings, admission: { ...context.bindings.admission, semantic_hash: canonicalHash(admission) } } };
  assert.throws(() => issueContinuousRecord([], incomplete, command));
  const contract = (context.target.query_policy as { contract: QueryAuthorizationContract }).contract;
  assert.equal(contract.approved_combinations.length, 2);
});

test("query grant denies unknown page, aliases, tampering, revocation, cadence and pending reservation", () => {
  const context = queryContext(); const grant = issueContinuousRecord([], context, command); const id = grant.payload.grant!.authorization_id;
  const send = (locator: string, records = [grant], at = AT) => reserveContinuousRecord(records, id, context, { ...request, locator }, "new-attempt", "holder", at, "CONTROLLED_TEST");
  for (const suffix of ["?page=2", "?page=01", "?page=1&x=1", "?page=1&page=1"]) assert.throws(() => send(request.locator + suffix));
  const pending = send(`${request.locator}?page=1`);
  assert.throws(() => send(`${request.locator}?page=1`, [grant, pending]));
  const complete = closeContinuousRecord([grant, pending], "new-attempt", "holder", AT, "SUCCESS");
  assert.throws(() => reserveContinuousRecord([grant, pending, complete], id, context, { ...request, locator: `${request.locator}?page=1` }, "other", "holder", AT, "CONTROLLED_TEST"));
  assert.doesNotThrow(() => reserveContinuousRecord([grant, pending, complete], id, context, { ...request, locator: `${request.locator}?page=1` }, "other", "holder", LATER, "CONTROLLED_TEST"));
  const revoke = revokeContinuousRecord([grant], id, "reviewer", AT, "withdrawn");
  assert.throws(() => send(`${request.locator}?page=1`, [grant, revoke]));
  const tampered = { ...context, target: { ...context.target, query_policy: { mode: "DENY_ALL", allowed_parameters: [] } } };
  assert.throws(() => issueContinuousRecord([], tampered, command));
});
