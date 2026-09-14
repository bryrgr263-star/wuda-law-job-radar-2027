import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  trustedFixture,
  trustedPackageFixture
} from "./position-bound-phase-fixture";

function projectionFor(
  suffix: string,
  requirementText: string,
  options: Parameters<typeof trustedFixture>[2] = {}
) {
  const fixture = trustedFixture(suffix, requirementText, options);
  const composition = fixture.chain.source_compositions.materialize({
    opportunity_version_id: fixture.opportunity_version_id,
    composition_input: fixture.composition_input
  });
  const projection = fixture.chain.requirement_projections.materialize(
    composition.source_composition_id
  );
  return { fixture, composition, projection };
}

test("approved projection covers explicit education ranges", () => {
  const cases = [
    ["本科及以上", "AT_LEAST", "BACHELOR"],
    ["本科", "EQUALS", "BACHELOR"],
    ["硕士及以上", "AT_LEAST", "MASTER"]
  ] as const;
  for (const [text, operator, code] of cases) {
    const { projection } = projectionFor(`education-${code}-${operator}`, `学历要求：${text}`);
    const fact = projection.output.facts.find((item) => {
      return item.dimension === "EDUCATION_LEVEL";
    });
    assert.equal(fact?.operator, operator);
    assert.deepEqual(fact?.value, { kind: "CODE", code });
  }
});

test("approved projection covers explicit academic degrees", () => {
  const cases = [
    ["学士及以上", "AT_LEAST", "BACHELOR_DEGREE"],
    ["硕士", "EQUALS", "MASTER_DEGREE"],
    ["博士", "EQUALS", "DOCTOR_DEGREE"]
  ] as const;
  for (const [text, operator, code] of cases) {
    const { projection } = projectionFor(`degree-${code}-${operator}`, `学位要求：${text}`);
    const fact = projection.output.facts.find((item) => {
      return item.dimension === "ACADEMIC_DEGREE";
    });
    assert.equal(fact?.operator, operator);
    assert.deepEqual(fact?.value, { kind: "CODE", code });
  }
});

test("approved projection keeps bachelor and graduate major scopes distinct", () => {
  const { projection } = projectionFor(
    "layered-law-majors",
    "本科：法学类\n研究生：法学（0301）、法律（0351）",
    {
      academic_program_directories: {
        BACHELOR: {
          directory_namespace: "普通高等学校本科专业目录",
          directory_version: "2024年"
        },
        GRADUATE: {
          directory_namespace: "研究生教育学科专业目录",
          directory_version: "2022年"
        }
      }
    }
  );
  const majors = projection.output.facts.filter((fact) => fact.dimension === "MAJOR");
  const bachelor = majors.filter((fact) => fact.subject_scope === "BACHELOR");
  const graduate = majors.filter((fact) => fact.subject_scope === "GRADUATE");

  assert.equal(bachelor.length, 1);
  assert.equal(bachelor[0]?.value.kind, "CODE");
  assert.equal(bachelor[0]?.value.kind === "CODE" ? bachelor[0].value.code : null,
    "LAW_STUDIES_FAMILY");
  assert.equal(bachelor[0]?.value.kind === "CODE"
    ? bachelor[0].value.label?.text : null, "法学类");
  assert.deepEqual(graduate.map((fact) => {
    assert.equal(fact.value.kind, "PROGRAM_REFERENCE");
    return fact.value.kind === "PROGRAM_REFERENCE"
      ? fact.value.reference.program_code
      : null;
  }), ["0301", "0351"]);
});

test("0351 remains an evidence-backed directory reference, never LAW_MASTER_NON_LAW", () => {
  const { projection } = projectionFor(
    "law-0351-conservative",
    "研究生：法律（0351）",
    {
      academic_program_directory: {
        directory_namespace: "研究生教育学科专业目录",
        directory_version: "2022年"
      }
    }
  );
  const fact = projection.output.facts.find((item) => item.dimension === "MAJOR");
  assert.equal(fact?.value.kind, "PROGRAM_REFERENCE");
  if (fact?.value.kind !== "PROGRAM_REFERENCE") {
    throw new Error("Expected an evidence-backed academic program reference");
  }
  assert.equal(fact.value.reference.program_code, "0351");
  assert.equal(fact.value.reference.program_label?.text, "法律");
  assert.equal(JSON.stringify(projection.output).includes("LAW_MASTER_NON_LAW"), false);
});

test("approved projection preserves qualification, cohort, gender, and experience semantics", () => {
  const { projection } = projectionFor(
    "explicit-cross-dimensions",
    "具有A类法律职业资格证书；2027届；限男性；2年以上法律实务经验"
  );
  const byDimension = new Map(projection.output.facts.map((fact) => {
    return [fact.dimension, fact] as const;
  }));
  assert.deepEqual(byDimension.get("PROFESSIONAL_QUALIFICATION")?.value, {
    kind: "PROFESSIONAL_QUALIFICATION",
    qualification_type: "LEGAL_PROFESSIONAL_QUALIFICATION",
    qualification_class: "A",
    strength: "REQUIRED"
  });
  const qualification = byDimension.get("PROFESSIONAL_QUALIFICATION");
  const qualificationEvidence = projection.output.requirement_evidence.find((evidence) => {
    return evidence.requirement_fact_id === qualification?.requirement_fact_id;
  });
  assert.equal(qualificationEvidence?.evidence_text.text,
    "具有A类法律职业资格证书");
  assert.deepEqual(byDimension.get("GRADUATION_YEAR")?.value, {
    kind: "GRADUATION_WINDOW",
    exact_graduation_year: 2027,
    current_cohort: undefined
  });
  assert.deepEqual(byDimension.get("GENDER")?.value, {
    kind: "CODE",
    code: "MALE"
  });
  const experience = byDimension.get("WORK_EXPERIENCE");
  assert.equal(experience?.value.kind, "WORK_EXPERIENCE");
  if (experience?.value.kind === "WORK_EXPERIENCE") {
    assert.equal(experience.value.experience_scope.text, "法律实务");
    assert.equal(experience.value.scope_definition, "EXPLICIT");
  }
});

test("approved projection preserves explicit male, female, and unrestricted gender", () => {
  const cases = [
    ["限男性", "EQUALS", "MALE"],
    ["限女性", "EQUALS", "FEMALE"],
    ["性别不限", "UNRESTRICTED", "ANY"]
  ] as const;
  for (const [text, operator, code] of cases) {
    const { projection } = projectionFor(`gender-${code}`, text);
    const fact = projection.output.facts.find((item) => item.dimension === "GENDER");
    assert.equal(fact?.operator, operator);
    assert.deepEqual(fact?.value, { kind: "CODE", code });
  }
});

test("conditional professional comparison stays conditional and review-required", () => {
  const { projection } = projectionFor(
    "conditional-professional-comparison",
    "符合专业比对条件时，专业相近率须达到70%"
  );
  assert.equal(projection.output.conditional_branch_sets.length, 1);
  assert.equal(projection.output.conditional_branch_sets[0]?.branch_semantics_state,
    "UNRESOLVED");
  assert.equal(projection.output.selector_predicates[0]?.resolution_state,
    "UNRESOLVED");
  assert.ok(projection.output.conditions.some((condition) => {
    return condition.representation_kind === "CONDITIONAL_BRANCH_SET";
  }));
  assert.ok(projection.output.observations.some((observation) => {
    return observation.status === "AMBIGUOUS";
  }));
});

test("every projected fact and logic node closes provenance to the trusted surface", () => {
  const { composition, projection } = projectionFor(
    "projection-provenance",
    "学历要求：本科及以上；学位要求：学士及以上；限女性"
  );
  const surfaceIds = new Set(composition.source_surfaces.map((surface) => {
    return surface.source_surface_id;
  }));
  const fragmentIds = new Set(projection.output.evidence_fragments.map((fragment) => {
    return fragment.requirement_evidence_fragment_id;
  }));
  const bindingIds = new Set(projection.output.context_bindings.map((binding) => {
    return binding.requirement_context_binding_id;
  }));
  const factsWithEvidence = new Set(projection.output.requirement_evidence.map((evidence) => {
    return evidence.requirement_fact_id;
  }));

  assert.ok(projection.output.source_references.every((reference) => {
    return reference.source_surface_id !== undefined
      && surfaceIds.has(reference.source_surface_id)
      && reference.binding_evidence_fragment_ids.every((id) => fragmentIds.has(id))
      && reference.applicable_binding_ids.every((id) => bindingIds.has(id));
  }));
  assert.ok(projection.output.facts.every((fact) => {
    return factsWithEvidence.has(fact.requirement_fact_id);
  }));
  assert.ok(projection.output.conditions.every((condition) => {
    return condition.evidence_fragment_ids.every((id) => fragmentIds.has(id))
      && condition.context_binding_ids.every((id) => bindingIds.has(id));
  }));
  assert.ok(projection.output.requirement_logic_trees.every((tree) => {
    return tree.nodes.every((node) => {
      return node.evidence_fragment_ids.every((id) => fragmentIds.has(id))
        && node.context_binding_ids.every((id) => bindingIds.has(id));
    });
  }));
});

test("approved projection resolves announcement requirements through the root-owned package SOV resolver", () => {
  const fixture = trustedPackageFixture("trusted-package-projection", "2027届");
  const composition = fixture.chain.source_compositions.materialize({
    opportunity_version_id: fixture.opportunity_version_id,
    composition_input: fixture.composition_input
  });
  const projection = fixture.chain.requirement_projections.materialize(
    composition.source_composition_id
  );
  const cohort = projection.output.facts.find((fact) => {
    return fact.dimension === "GRADUATION_YEAR";
  });
  const packageReference = projection.output.source_references.find((reference) => {
    return reference.source_role === "ANNOUNCEMENT_UNIFORM";
  });

  assert.equal(cohort?.value.kind, "GRADUATION_WINDOW");
  assert.equal(packageReference?.snapshot_id, fixture.package_source.snapshot.snapshot_id);
  assert.equal(
    fixture.source.version.source_occurrence_version_id
      === fixture.package_source.version.source_occurrence_version_id,
    false
  );
});

test("missing requirement semantics propagate unresolved instead of false", () => {
  const { projection } = projectionFor(
    "projection-unresolved",
    "2年以上相关工作经验；研究生：法律（0351）"
  );
  assert.ok(projection.output.conditions.every((condition) => {
    return condition.resolution_state === "UNRESOLVED";
  }));
  assert.ok(projection.output.observations.every((observation) => {
    return observation.status === "AMBIGUOUS"
      || observation.status === "DOMAIN_GAP_OBSERVED";
  }));
  assert.equal(JSON.stringify(projection.output).includes("NOT_MATCH"), false);
  assert.equal(JSON.stringify(projection.output).includes("INELIGIBLE"), false);
});

test("target 22828700101 remains blocked by non-COMPLETE SourceComposition", () => {
  const fixture = trustedFixture("target-22828700101-projector-gate");
  assert.equal(fixture.chain.requirement_projections.resolve("22828700101"), null);
  assert.equal(fixture.chain.requirement_sets.resolve("22828700101"), null);
});
