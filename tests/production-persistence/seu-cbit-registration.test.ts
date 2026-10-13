import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { resolveProductionAdapter, registeredProductionAdapterKeys } from "../../lib/production-automation/production-adapter-registry";
import { SEU_CBIT_ADAPTER_KEY, seuCbitEndpoint } from "../../lib/production-sources/seu-cbit-2027-source";

test("university adapter is available to existing production source enumeration without altering existing adapters", () => {
  const adapter = resolveProductionAdapter(SEU_CBIT_ADAPTER_KEY);
  assert.ok(adapter);
  assert.equal(adapter.validateEndpoint(seuCbitEndpoint()).valid, true);
  for (const key of ["cn-zhenghan-2027-official-html", "cn-chnenergy-2027-reviewed-official-html"]) {
    assert.ok(resolveProductionAdapter(key));
  }
  assert.equal(registeredProductionAdapterKeys().filter(key => key === SEU_CBIT_ADAPTER_KEY).length, 1);
  assert.equal(resolveProductionAdapter("UNREVIEWED-adapter"), null);
});
