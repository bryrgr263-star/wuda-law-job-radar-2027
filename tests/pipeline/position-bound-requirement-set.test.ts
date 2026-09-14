import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import { materializeTrustedChain, trustedFixture } from "./position-bound-phase-fixture";
import {
  CanonicalArtifactRegistryError,
  createCanonicalArtifactRegistryAuthority
} from "../../lib/ingestion/normalization/canonical-artifact-registry";
import {
  assertPositionBoundRequirementSetVersionIntegrity,
  type PositionBoundRequirementSetVersion
} from "../../lib/ingestion/pipeline/position-bound-requirement-set";
import {
  RequirementProjectionError,
  assertDeterministicRequirementProjectionReplay
} from "../../lib/ingestion/pipeline/trusted-requirement-projection";

test("Phase G uses the approved deterministic projection rather than caller typed facts", () => {
  const { fixture, sourceComposition } = materializeTrustedChain(
    trustedFixture("projection-authority")
  );
  const forgedTypedRequirement = {
    facts: [{ dimension: "EDUCATION_LEVEL", value: { code: "DOCTOR" } }]
  };
  const version = (fixture.chain.requirement_sets.materialize as unknown as (
    id: typeof sourceComposition.source_composition_id,
    forged: unknown
  ) => ReturnType<typeof fixture.chain.requirement_sets.materialize>)(
    sourceComposition.source_composition_id,
    forgedTypedRequirement
  );
  assert.equal(version.requirement_set.fact_registry[0]?.value.kind, "CODE");
  assert.equal(
    version.requirement_set.fact_registry[0]?.value.kind === "CODE"
      ? version.requirement_set.fact_registry[0].value.code
      : null,
    "BACHELOR"
  );
});

test("RequirementProjection and RequirementSetVersion replay idempotently", () => {
  const fixture = trustedFixture("projection-idempotent");
  const sourceComposition = fixture.chain.source_compositions.materialize({
    opportunity_version_id: fixture.opportunity_version_id,
    composition_input: fixture.composition_input
  });
  const firstProjection = fixture.chain.requirement_projections.materialize(
    sourceComposition.source_composition_id
  );
  const secondProjection = fixture.chain.requirement_projections.materialize(
    sourceComposition.source_composition_id
  );
  assert.deepEqual(secondProjection, firstProjection);
  const firstVersion = fixture.chain.requirement_sets.materialize(
    sourceComposition.source_composition_id
  );
  const secondVersion = fixture.chain.requirement_sets.materialize(
    sourceComposition.source_composition_id
  );
  assert.equal(secondVersion.requirement_set_version_id,
    firstVersion.requirement_set_version_id);
  assert.equal(firstVersion.version_created, true);
  assert.equal(secondVersion.version_created, false);
  assert.equal(secondVersion.semantic_hash, firstVersion.semantic_hash);
});

test("RequirementSetVersion requires a trusted COMPLETE SourceComposition", () => {
  const fixture = trustedFixture("g-complete-gate");
  const unresolvedInput = structuredClone(fixture.composition_input);
  (unresolvedInput.inventory as {
    inventory_completeness_status: string;
  }).inventory_completeness_status = "OPEN_UNRESOLVED";
  const unresolved = fixture.chain.source_compositions.materialize({
    opportunity_version_id: fixture.opportunity_version_id,
    composition_input: unresolvedInput
  });

  assert.equal(unresolved.status, "UNRESOLVED");
  assert.throws(
    () => fixture.chain.requirement_sets.materialize(
      unresolved.source_composition_id
    ),
    /trusted COMPLETE SourceComposition/u
  );
  assert.equal(fixture.chain.requirement_sets.resolve("22828700101"), null);
});

test("RequirementSetVersion closes Projection, Composition, surface, and SOV provenance", () => {
  const { fixture, sourceComposition, projection, requirementSet } =
    materializeTrustedChain(trustedFixture("g-provenance-closure"));
  const trusted = fixture.chain.requirement_sets.resolve(
    requirementSet.requirement_set_version_id
  );
  assert.ok(trusted);
  assert.equal(trusted.source_composition_id,
    sourceComposition.source_composition_id);
  assert.equal(trusted.source_composition_hash, sourceComposition.composition_hash);
  assert.equal(trusted.requirement_projection_id,
    projection.requirement_projection_id);
  assert.equal(trusted.requirement_projection_integrity_hash,
    projection.integrity_hash);
  assert.deepEqual(
    [...trusted.source_composition_source_occurrence_version_ids].sort(),
    [...new Set(sourceComposition.source_surfaces.map((surface) => {
      return surface.source_occurrence_version_id;
    }))].sort()
  );
  const surfaces = new Map(sourceComposition.source_surfaces.map((surface) => {
    return [surface.source_surface_id, surface] as const;
  }));
  assert.ok(trusted.requirement_set.source_reference_registry.every((reference) => {
    const surface = reference.source_surface_id
      ? surfaces.get(reference.source_surface_id)
      : undefined;
    return surface
      && reference.snapshot_id === surface.snapshot_id
      && reference.extracted_record_id === surface.extracted_record_id;
  }));
});

test("RequirementSetVersion envelope and embedded semantics are integrity sealed", () => {
  const { requirementSet } = materializeTrustedChain(
    trustedFixture("g-semantic-seal")
  );
  const mutations: Array<(version: PositionBoundRequirementSetVersion) => void> = [
    (version) => {
      (version as { position_id: string }).position_id = "position:changed";
    },
    (version) => {
      (version as { position_version_semantic_hash: string })
        .position_version_semantic_hash = "0".repeat(64);
    },
    (version) => {
      (version as { opportunity_version_integrity_hash: string })
        .opportunity_version_integrity_hash = "0".repeat(64);
    },
    (version) => {
      (version as { source_composition_hash: string }).source_composition_hash =
        `sha256:${"0".repeat(64)}`;
    },
    (version) => {
      (version as { requirement_projection_integrity_hash: string })
        .requirement_projection_integrity_hash = "0".repeat(64);
    },
    (version) => {
      const ids = (
        version.source_composition_source_occurrence_version_ids
      ) as unknown as string[];
      ids.push("source-occurrence-version:changed:1");
    },
    (version) => {
      const fact = version.requirement_set.fact_registry[0];
      assert.equal(fact?.value.kind, "CODE");
      if (fact?.value.kind === "CODE") {
        (fact.value as { code: string }).code = "DOCTOR";
      }
    }
  ];

  for (const mutate of mutations) {
    const changed = structuredClone(requirementSet);
    mutate(changed);
    assert.throws(() => assertPositionBoundRequirementSetVersionIntegrity(changed));
  }
});

test("same semantics with different trusted provenance creates a distinct RSV envelope", () => {
  const fixture = trustedFixture("g-provenance-revision");
  const firstComposition = fixture.chain.source_compositions.materialize({
    opportunity_version_id: fixture.opportunity_version_id,
    composition_input: fixture.composition_input
  });
  const first = fixture.chain.requirement_sets.materialize(
    firstComposition.source_composition_id
  );
  const revisedInput = structuredClone(fixture.composition_input);
  (revisedInput as { serialization_version: string }).serialization_version =
    "trusted-chain-composition-serialization/1.0.1";
  const revisedComposition = fixture.chain.source_compositions.materialize({
    opportunity_version_id: fixture.opportunity_version_id,
    composition_input: revisedInput
  });
  const revised = fixture.chain.requirement_sets.materialize(
    revisedComposition.source_composition_id
  );

  assert.equal(revised.semantic_hash, first.semantic_hash);
  assert.notEqual(revised.source_composition_id, first.source_composition_id);
  assert.notEqual(revised.requirement_projection_id,
    first.requirement_projection_id);
  assert.notEqual(revised.requirement_set_version_id,
    first.requirement_set_version_id);
  assert.equal(revised.revision, 2);
  assert.equal(
    fixture.chain.requirement_sets.materialize(
      firstComposition.source_composition_id
    ).requirement_set_version_id,
    first.requirement_set_version_id
  );
});

test("RequirementSetVersion registry rejects same ID with different canonical bytes", () => {
  const { requirementSet } = materializeTrustedChain(
    trustedFixture("g-rsv-collision")
  );
  const registry = createCanonicalArtifactRegistryAuthority(
    (artifact: typeof requirementSet) => artifact.requirement_set_version_id
  );
  registry.writer.seal(requirementSet.requirement_set_version_id, requirementSet);
  const forged = structuredClone(requirementSet);
  (forged.source_occurrence_version_ids as unknown as string[]).push(
    "sov:forged"
  );
  assert.throws(
    () => registry.writer.seal(forged.requirement_set_version_id, forged),
    (error: unknown) => error instanceof CanonicalArtifactRegistryError
      && error.code === "IDENTITY_COLLISION"
  );
  assert.deepEqual(
    registry.resolver.resolve(requirementSet.requirement_set_version_id),
    requirementSet
  );
});

test("same projection key with different output is rejected as non-deterministic", () => {
  const { projection } = materializeTrustedChain(
    trustedFixture("g-projection-nondeterminism")
  );
  const forgedOutput = structuredClone(projection.output);
  const fact = forgedOutput.facts[0];
  assert.equal(fact?.value.kind, "CODE");
  if (fact?.value.kind === "CODE") {
    (fact.value as { code: string }).code = "DOCTOR";
  }
  assert.throws(
    () => assertDeterministicRequirementProjectionReplay(
      projection,
      projection.projection_key,
      forgedOutput
    ),
    (error: unknown) => error instanceof RequirementProjectionError
      && error.code === "PROJECTION_NON_DETERMINISM"
  );
});

test("resolver output mutation cannot alter Projection or RequirementSetVersion", () => {
  const { fixture, projection, requirementSet } = materializeTrustedChain(
    trustedFixture("g-isolation")
  );
  (projection.output.facts as unknown as { value: { code: string } }[])[0]!.value.code = "DOCTOR";
  (requirementSet.requirement_set.fact_registry as unknown as {
    value: { code: string };
  }[])[0]!.value.code = "DOCTOR";
  (requirementSet.source_occurrence_version_ids as unknown as string[])[0] =
    "source-occurrence-version:forged";
  const trustedProjection = fixture.chain.requirement_projections.resolve(
    projection.requirement_projection_id
  );
  const trustedVersion = fixture.chain.requirement_sets.resolve(
    requirementSet.requirement_set_version_id
  );
  assert.equal(trustedProjection?.output.facts[0]?.value.kind === "CODE"
    ? trustedProjection.output.facts[0].value.code : null, "BACHELOR");
  assert.equal(trustedVersion?.requirement_set.fact_registry[0]?.value.kind === "CODE"
    ? trustedVersion.requirement_set.fact_registry[0].value.code : null, "BACHELOR");
  assert.notEqual(
    trustedVersion?.source_occurrence_version_ids[0],
    "source-occurrence-version:forged"
  );
});

test("caller objects and legacy RequirementSet shapes cannot enter trusted RSV materialization", () => {
  const fixture = trustedFixture("g-caller-isolation");
  const sourceComposition = fixture.chain.source_compositions.materialize({
    opportunity_version_id: fixture.opportunity_version_id,
    composition_input: fixture.composition_input
  });
  const callerComposition = structuredClone(sourceComposition);
  (callerComposition as { status: string }).status = "COMPLETE";
  const materialize = fixture.chain.requirement_sets.materialize as unknown as (
    reference: unknown
  ) => unknown;

  assert.throws(
    () => materialize(callerComposition),
    /Trusted SourceComposition is unavailable/u
  );
  assert.throws(
    () => materialize({
      requirement_set_id: "legacy-requirement-set",
      opportunity_version_id: fixture.opportunity_version_id
    }),
    /Trusted SourceComposition is unavailable/u
  );
});

test("RSV preserves 0351 as a scoped directory reference, not LAW_MASTER_NON_LAW", () => {
  const { requirementSet } = materializeTrustedChain(trustedFixture(
    "g-law-0351",
    "研究生：法律（0351）",
    {
      academic_program_directory: {
        directory_namespace: "研究生教育学科专业目录",
        directory_version: "2022年"
      }
    }
  ));
  const fact = requirementSet.requirement_set.fact_registry.find((item) => {
    return item.dimension === "MAJOR";
  });
  assert.equal(fact?.value.kind, "PROGRAM_REFERENCE");
  if (fact?.value.kind !== "PROGRAM_REFERENCE") {
    throw new Error("Expected a directory-scoped major requirement");
  }
  assert.equal(fact.value.reference.program_code, "0351");
  assert.equal(JSON.stringify(requirementSet).includes("LAW_MASTER_NON_LAW"), false);
});

test("unresolved projected requirements remain review-required inside trusted RSV", () => {
  const { requirementSet } = materializeTrustedChain(trustedFixture(
    "g-unresolved-propagation",
    "2年以上相关工作经验；研究生：法律（0351）"
  ));
  assert.ok(requirementSet.requirement_set.condition_registry.every((condition) => {
    return condition.resolution_state === "UNRESOLVED";
  }));
  assert.equal(requirementSet.requirement_set.completeness.status,
    "REVIEW_REQUIRED");
  assert.equal(JSON.stringify(requirementSet).includes("NOT_MATCH"), false);
  assert.equal(JSON.stringify(requirementSet).includes("INELIGIBLE"), false);
});

test("target 22828700101 has no trusted RequirementSet in this fixture-only chain", () => {
  const fixture = trustedFixture("target-blocked");
  assert.equal(fixture.chain.requirement_sets.resolve("22828700101"), null);
});
