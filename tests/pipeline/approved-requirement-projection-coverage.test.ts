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

test("real-world numbered composite clauses retain supported facts and residual review", () => {
  const { projection } = projectionFor(
    "zhenghan-2027-long-term",
    "1.国内外知名院校法学专业2027年应届在校本科生或研究生"
  );
  const dimensions = projection.output.facts.map((fact) => fact.dimension);

  assert.deepEqual(dimensions, [
    "MAJOR", "GRADUATION_YEAR", "CANDIDATE_COHORT",
    "EDUCATION_LEVEL", "EDUCATION_LEVEL"
  ]);
  const educationCondition = projection.output.conditions.find((condition) => {
    if (condition.representation_kind !== "LOGIC_TREE") return false;
    const tree = projection.output.requirement_logic_trees.find((item) => {
      return item.requirement_logic_tree_id === condition.requirement_logic_tree_id;
    });
    return tree?.nodes.some((node) => node.kind === "GROUP" && node.operator === "OR");
  });
  assert.ok(educationCondition);
  assert.ok(projection.output.observations.some((observation) => {
    return observation.status === "DOMAIN_GAP_OBSERVED"
      && observation.original_clause?.text.includes("知名院校");
  }));
});

test("preferred observations without facts never enter the mandatory root", () => {
  const { projection } = projectionFor(
    "zhenghan-preferred-qualification",
    "2.曾有法律相关岗位实习经历者/通过国家法律职业资格考试（本科生/非法本研究生无需遵循此条）优先"
  );

  assert.equal(projection.output.facts.length, 0);
  assert.equal(projection.output.conditions.length, 0);
  assert.equal(projection.output.candidate_credential_applicabilities.length, 0);
  assert.equal(projection.output.candidate_state_applicabilities.length, 0);
  assert.equal(projection.output.mandatory_root.kind, "EMPTY_CONFIRMED");
  assert.equal(projection.output.observations[0]?.clause_role, "PREFERRED");
});

test("unknown observations remain observations and are never upgraded to mandatory", () => {
  const { projection } = projectionFor(
    "unknown-not-mandatory",
    "无法安全判断的附加条件"
  );

  assert.equal(projection.output.observations[0]?.clause_role, "UNKNOWN");
  assert.equal(projection.output.conditions.length, 0);
  assert.equal(projection.output.mandatory_root.kind, "EMPTY_CONFIRMED");
  assert.equal(JSON.stringify(projection.output).includes('"modality":"MANDATORY"'), false);
});

test("unresolved mandatory conditions use clause-local scope and locator", () => {
  const { projection } = projectionFor(
    "clause-local-unresolved",
    "3.在校期间成绩优秀，具有极强的法律思维和运用能力；6.认同公司制律所的文化和价值观念"
  );
  const unresolved = projection.output.conditions.filter((condition) => {
    return condition.resolution_state === "UNRESOLVED";
  });

  assert.equal(unresolved.length, 2);
  const scopes = projection.output.candidate_credential_applicabilities.map((item) => {
    return item.mode === "UNRESOLVED" ? item.raw_scope?.text : null;
  });
  assert.deepEqual(scopes, [
    "3.在校期间成绩优秀，具有极强的法律思维和运用能力",
    "6.认同公司制律所的文化和价值观念"
  ]);
  assert.ok(unresolved.every((condition) => {
    return condition.source_locator.start_offset !== undefined
      && condition.source_locator.end_offset !== undefined;
  }));
  assert.equal(projection.output.facts.some((fact) => fact.dimension === "MAJOR"), false);
});

test("lawyer practice certificate is not rewritten as legal professional qualification", () => {
  const { projection } = projectionFor(
    "zhenghan-lawyer-experience",
    "2.拥有3-5年律师工作经验，并持有律师执业证"
  );
  const qualification = projection.output.facts.find((fact) => {
    return fact.dimension === "PROFESSIONAL_QUALIFICATION";
  });

  assert.equal(qualification?.value.kind, "PROFESSIONAL_QUALIFICATION");
  if (qualification?.value.kind === "PROFESSIONAL_QUALIFICATION") {
    assert.equal(qualification.value.qualification_type,
      "LAWYER_PRACTICE_CERTIFICATE");
  }
  assert.equal(JSON.stringify(projection.output).includes(
    "LEGAL_PROFESSIONAL_QUALIFICATION"), false);
});

test("target 22828700101 remains blocked by non-COMPLETE SourceComposition", () => {
  const fixture = trustedFixture("target-22828700101-projector-gate");
  assert.equal(fixture.chain.requirement_projections.resolve("22828700101"), null);
  assert.equal(fixture.chain.requirement_sets.resolve("22828700101"), null);
});
