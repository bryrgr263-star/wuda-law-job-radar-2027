import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import { createTrustedArtifactChain } from "../../lib/ingestion";
import { trustedFixture } from "./position-bound-phase-fixture";

test("Phase F resolves PBOV only through the root-pinned trusted resolver", () => {
  assert.throws(() => createTrustedArtifactChain({
    resolve: () => null,
    resolveSources: () => null
  } as never), /approved composition root/);
});

test("trusted PBOV produces and seals a COMPLETE SourceComposition", () => {
  const fixture = trustedFixture("source-complete");
  const result = fixture.chain.source_compositions.materialize({
    opportunity_version_id: fixture.opportunity_version_id,
    composition_input: fixture.composition_input
  });
  assert.equal(result.status, "COMPLETE");
  assert.deepEqual(
    fixture.chain.source_compositions.resolve(result.source_composition_id),
    result
  );
});

test("caller mutation cannot alter the sealed SourceComposition", () => {
  const fixture = trustedFixture("source-isolation");
  const result = fixture.chain.source_compositions.materialize({
    opportunity_version_id: fixture.opportunity_version_id,
    composition_input: fixture.composition_input
  });
  const mutable = result as unknown as {
    source_surfaces: { surface_status: string }[];
  };
  mutable.source_surfaces[0]!.surface_status = "UNPARSED";
  const resolved = fixture.chain.source_compositions.resolve(
    result.source_composition_id
  );
  assert.equal(resolved?.source_surfaces[0]?.surface_status, "PARSED");
});

test("unknown target cannot bypass the trusted PBOV gate", () => {
  const fixture = trustedFixture("source-missing-pbov");
  assert.throws(() => fixture.chain.source_compositions.materialize({
    opportunity_version_id: "opportunity-version:forged:1" as never,
    composition_input: fixture.composition_input
  }), /trusted PBOV/);
});

test("Phase F remains offline", async () => {
  await assert.rejects(fetch("https://example.invalid"),
    /Network access is disabled in tests/);
});
