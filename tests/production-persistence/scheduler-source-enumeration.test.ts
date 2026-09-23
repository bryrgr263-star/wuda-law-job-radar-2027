import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import { closeContinuousRecord, reserveContinuousRecord, revokeContinuousRecord } from "../../lib/application/source-admission/continuous-acquisition";
import { enumerateScheduledSources } from "../../lib/production-persistence/scheduler-source-enumeration";
import { AT, TARGET, fixture, issue, request } from "./continuous-acquisition-fixture";

test("committed source, admission and grant determine the scheduled target", () => {
  const controlled = fixture();
  const grant = issue(controlled);
  const selected = enumerateScheduledSources(controlled.versions, [grant], AT, "CONTROLLED_TEST");
  assert.equal(selected.eligible.length, 1);
  assert.equal(selected.eligible[0]?.authorization_id, grant.payload.grant?.authorization_id);
  assert.equal(selected.eligible[0]?.recruitment_endpoint_id, controlled.endpoint.recruitment_endpoint_id);
  assert.equal(selected.eligible[0]?.adapter_key, controlled.endpoint.adapter_key);
  assert.deepEqual(selected.deferred, []);
  assert.equal(enumerateScheduledSources(controlled.versions, [], AT, "CONTROLLED_TEST").eligible.length, 0);
  assert.equal(enumerateScheduledSources(controlled.versions, [grant], AT, "PRODUCTION").eligible.length, 0);
});

test("cadence and pending gate defer without new attempt; revocation removes eligibility", () => {
  const controlled = fixture();
  const grant = issue(controlled);
  const authorizationId = grant.payload.grant!.authorization_id;
  const pending = reserveContinuousRecord([grant], authorizationId, controlled.context, request,
    "controlled-attempt", "controlled-holder", AT, "CONTROLLED_TEST");
  assert.deepEqual(enumerateScheduledSources(controlled.versions, [grant, pending], AT, "CONTROLLED_TEST").deferred.map(item => item.reason),
    ["PENDING_GATE_DENIED"]);
  const completed = closeContinuousRecord([grant, pending], "controlled-attempt", "controlled-holder", AT, "FAILED");
  assert.deepEqual(enumerateScheduledSources(controlled.versions, [grant, pending, completed], AT, "CONTROLLED_TEST").deferred.map(item => item.reason),
    ["CADENCE_DENIED"]);
  const revoked = revokeContinuousRecord([grant, pending, completed], authorizationId, "operator", AT, TARGET);
  const afterRevoke = enumerateScheduledSources(controlled.versions, [grant, pending, completed, revoked], AT, "CONTROLLED_TEST");
  assert.deepEqual(afterRevoke.eligible, []);
  assert.deepEqual(afterRevoke.deferred, []);
});
