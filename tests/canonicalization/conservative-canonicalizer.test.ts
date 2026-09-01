import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  ConservativeCanonicalizer,
  UTF8_TEXT_ENCODING,
  type CanonicalizationCandidate,
  type IdentityHash,
  type IsoDate,
  type IsoDateTime,
  type Organization,
  type OrganizationId,
  type SemanticHash,
  type SourceDefinition,
  type SourceDefinitionId,
  type SourceOccurrenceId,
  type SourceOccurrenceVersionId
} from "../../lib/ingestion";

function branded<Value extends string>(value: string) {
  return value as Value;
}

function traceable(original: string, normalized = original) {
  return {
    original: { text: original, encoding: UTF8_TEXT_ENCODING },
    normalized: {
      text: normalized,
      unicode_form: "NFKC" as const,
      normalizer_version: "test-normalizer/1.0.0",
      operations: []
    }
  };
}

const employerId = branded<OrganizationId>("organization-employer");
const otherEmployerId = branded<OrganizationId>("organization-other-employer");
const platformId = branded<OrganizationId>("organization-platform");

const organizations: readonly Organization[] = [
  {
    organization_id: employerId,
    name: traceable("中国示例能源集团有限公司"),
    aliases: [traceable("示例能源集团")],
    country_code: "CN"
  },
  {
    organization_id: otherEmployerId,
    name: traceable("中国另一能源集团有限公司"),
    aliases: [],
    country_code: "CN"
  },
  {
    organization_id: platformId,
    name: traceable("示例招聘平台"),
    aliases: [],
    country_code: "CN"
  }
];

const officialSource: SourceDefinition = {
  source_definition_id: branded<SourceDefinitionId>("source-official"),
  publisher_organization_id: employerId,
  name: traceable("示例能源集团官方招聘"),
  publisher_kind: "EMPLOYER_OFFICIAL",
  authority_level: "OFFICIAL",
  scope: "SINGLE_ORGANIZATION",
  enabled: true
};

const platformSource: SourceDefinition = {
  source_definition_id: branded<SourceDefinitionId>("source-platform"),
  publisher_organization_id: platformId,
  name: traceable("示例招聘平台校园招聘"),
  publisher_kind: "THIRD_PARTY_PLATFORM",
  authority_level: "THIRD_PARTY",
  scope: "NATIONAL",
  enabled: true
};

let candidateSequence = 0;

function candidate(
  sourceDefinition: SourceDefinition,
  overrides: {
    organizationName?: string;
    title?: string;
    year?: number;
    batch?: string;
    locations?: readonly string[];
    publishedOn?: string;
    closesOn?: string;
    description?: string;
  } = {}
): CanonicalizationCandidate {
  candidateSequence += 1;
  const sequence = candidateSequence;
  const occurrenceId = branded<SourceOccurrenceId>(`source-occurrence-${sequence}`);
  const versionId = branded<SourceOccurrenceVersionId>(`source-occurrence-version-${sequence}`);
  const locations = overrides.locations ?? ["北京"];
  return {
    source_definition: sourceDefinition,
    occurrence: {
      source_occurrence_id: occurrenceId,
      source_definition_id: sourceDefinition.source_definition_id,
      recruitment_endpoint_id: branded(`endpoint-${sequence}`),
      identity_basis: {
        kind: "COMPOSITE_FIELDS",
        normalized_organization: overrides.organizationName ?? "示例能源集团",
        normalized_title: overrides.title ?? "法律事务岗",
        normalized_locations: locations,
        recruitment_batch: overrides.batch ?? "秋季校园招聘"
      },
      identity_hash: branded<IdentityHash>(`identity-${sequence}`),
      first_observed_at: branded<IsoDateTime>(`2026-09-${String(sequence).padStart(2, "0")}T08:00:00+08:00`)
    },
    version: {
      source_occurrence_version_id: versionId,
      source_occurrence_id: occurrenceId,
      extracted_record_id: branded(`extracted-record-${sequence}`),
      revision: 1,
      semantic_hash: branded<SemanticHash>(`semantic-${sequence}`),
      content: {
        organization: {
          name: traceable(overrides.organizationName ?? "示例能源集团")
        },
        title: traceable(overrides.title ?? "法律事务岗"),
        description: traceable(overrides.description ?? "来源岗位描述"),
        requirement_text: traceable("法律相关专业"),
        locations: locations.map((location) => ({
          city: location,
          raw_text: { text: location, encoding: UTF8_TEXT_ENCODING },
          is_nationwide: location === "全国",
          normalization_confidence: 1
        })),
        recruitment_year: overrides.year ?? 2027,
        recruitment_batch: traceable(overrides.batch ?? "秋季校园招聘"),
        published_on: branded<IsoDate>(overrides.publishedOn ?? "2026-09-01"),
        application_window: {
          closes_on: branded<IsoDate>(overrides.closesOn ?? "2026-10-01")
        },
        announcement_locator: `https://example.test/jobs/${sequence}`
      },
      first_observed_at: branded<IsoDateTime>(`2026-09-${String(sequence).padStart(2, "0")}T08:00:00+08:00`)
    }
  };
}

test("official and third-party records merge when conservative evidence agrees", () => {
  const official = candidate(officialSource, { description: "官方完整岗位描述" });
  const thirdParty = candidate(platformSource, { description: "第三方摘要" });
  const result = new ConservativeCanonicalizer().canonicalize(
    [thirdParty, official],
    { organizations }
  );

  assert.equal(result.opportunities.length, 1);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].outcome, "MERGE");
  assert.equal(result.decisions[0].resolved_organization_id, employerId);
  assert.equal(result.decisions[0].canonical_identity_hash,
    result.opportunities[0].canonical_opportunity.identity_hash);
  assert.deepEqual(
    result.opportunities[0].opportunity_version.source_occurrence_version_ids,
    [official.version.source_occurrence_version_id, thirdParty.version.source_occurrence_version_id]
      .sort()
  );
  assert.equal(
    result.opportunities[0].opportunity_version.content.description?.original.text,
    "官方完整岗位描述"
  );
  assert.equal(
    result.opportunities[0].opportunity_version.content.organization.organization_id,
    employerId
  );
});

test("different resolved Organizations remain separate", () => {
  const official = candidate(officialSource);
  const other = candidate(platformSource, {
    organizationName: "中国另一能源集团有限公司"
  });
  const result = new ConservativeCanonicalizer().canonicalize(
    [official, other],
    { organizations }
  );

  assert.equal(result.opportunities.length, 2);
  assert.equal(result.decisions[0].outcome, "SEPARATE");
  assert.deepEqual(result.decisions[0].reason_codes, ["ORGANIZATION_CONFLICT"]);
});

test("unresolved employer evidence cannot merge", () => {
  const left = candidate(officialSource, { organizationName: "无法识别的单位" });
  const right = candidate(platformSource, { organizationName: "无法识别的单位" });
  const result = new ConservativeCanonicalizer().canonicalize(
    [left, right],
    { organizations }
  );

  assert.equal(result.opportunities.length, 2);
  assert.deepEqual(result.decisions[0].reason_codes, ["ORGANIZATION_UNRESOLVED"]);
});

test("title, year, batch, location, and time conflicts each prevent merging", () => {
  const conflictCases = [
    { override: { title: "合规管理岗" }, reason: "TITLE_CONFLICT" },
    { override: { year: 2026 }, reason: "RECRUITMENT_YEAR_CONFLICT" },
    { override: { batch: "春季校园招聘" }, reason: "RECRUITMENT_BATCH_CONFLICT" },
    { override: { locations: ["上海"] }, reason: "LOCATION_CONFLICT" },
    { override: { closesOn: "2026-10-31" }, reason: "TIME_WINDOW_CONFLICT" }
  ] as const;

  for (const conflictCase of conflictCases) {
    const result = new ConservativeCanonicalizer().canonicalize(
      [candidate(officialSource), candidate(platformSource, conflictCase.override)],
      { organizations }
    );
    assert.equal(result.opportunities.length, 2);
    assert.ok(result.decisions[0].reason_codes.includes(conflictCase.reason));
    assert.notEqual(
      result.opportunities[0].canonical_opportunity.identity_hash,
      result.opportunities[1].canonical_opportunity.identity_hash
    );
  }
});

test("missing year, batch, location, or time evidence remains separate", () => {
  const complete = candidate(officialSource);
  const missingYear = candidate(platformSource);
  const missingBatch = candidate(platformSource);
  const missingLocation = candidate(platformSource);
  const missingTime = candidate(platformSource);
  delete (missingYear.version.content as { recruitment_year?: number }).recruitment_year;
  delete (missingBatch.version.content as { recruitment_batch?: unknown }).recruitment_batch;
  (missingLocation.version.content as { locations: readonly unknown[] }).locations = [];
  delete (missingTime.version.content as { published_on?: unknown }).published_on;

  const cases = [
    { candidate: missingYear, reason: "RECRUITMENT_YEAR_MISSING" },
    { candidate: missingBatch, reason: "RECRUITMENT_BATCH_MISSING" },
    { candidate: missingLocation, reason: "LOCATION_MISSING" },
    { candidate: missingTime, reason: "TIME_WINDOW_MISSING" }
  ] as const;
  for (const missingCase of cases) {
    const result = new ConservativeCanonicalizer().canonicalize(
      [complete, missingCase.candidate],
      { organizations }
    );
    assert.equal(result.opportunities.length, 2);
    assert.ok(result.decisions[0].reason_codes.includes(missingCase.reason));
  }
});

test("canonical identity is deterministic across input order", () => {
  const official = candidate(officialSource);
  const thirdParty = candidate(platformSource);
  const canonicalizer = new ConservativeCanonicalizer();
  const forward = canonicalizer.canonicalize([official, thirdParty], { organizations });
  const reverse = canonicalizer.canonicalize([thirdParty, official], { organizations });

  assert.equal(
    forward.opportunities[0].canonical_opportunity.identity_hash,
    reverse.opportunities[0].canonical_opportunity.identity_hash
  );
  assert.deepEqual(
    forward.opportunities[0].opportunity_version.source_occurrence_version_ids,
    reverse.opportunities[0].opportunity_version.source_occurrence_version_ids
  );
});

test("invalid SourceOccurrence references are rejected", () => {
  const invalid = candidate(officialSource);
  const mismatched = {
    ...invalid,
    occurrence: {
      ...invalid.occurrence,
      source_definition_id: platformSource.source_definition_id
    }
  };
  assert.throws(
    () => new ConservativeCanonicalizer().canonicalize([mismatched], { organizations }),
    /SourceOccurrence must reference the supplied SourceDefinition/
  );
});

test("P1-07 canonicalization remains offline", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});
