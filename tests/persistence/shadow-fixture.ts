import {
  UTF8_TEXT_ENCODING,
  type CandidateProfile,
  type CanonicalOpportunity,
  type EligibilityAssessment,
  type IsoDateTime,
  type OpportunityVersion,
  type Organization,
  type RecruitmentEndpoint,
  type RequirementEvidence,
  type RequirementFact,
  type SourceDefinition,
  type SourceOccurrence,
  type SourceOccurrenceVersion
} from "../../lib/ingestion";

export function branded<Value extends string>(value: string) {
  return value as Value;
}

export const observedAt = branded<IsoDateTime>("2026-09-02T08:00:00+08:00");

export const organization: Organization = {
  organization_id: branded("organization-shadow-cas"),
  name: {
    original: { text: "中国科学院示例研究所", encoding: UTF8_TEXT_ENCODING },
    normalized: {
      text: "中国科学院示例研究所",
      unicode_form: "NFKC",
      normalizer_version: "source-normalizer/1.0.0",
      operations: []
    }
  },
  aliases: [],
  country_code: "CN"
};

export const sourceDefinition: SourceDefinition = {
  source_definition_id: branded("source-shadow-official"),
  publisher_organization_id: organization.organization_id,
  name: {
    original: { text: "官方人才招聘来源", encoding: UTF8_TEXT_ENCODING }
  },
  publisher_kind: "RESEARCH_INSTITUTE",
  authority_level: "OFFICIAL",
  scope: "SINGLE_ORGANIZATION",
  enabled: true
};

export const recruitmentEndpoint: RecruitmentEndpoint = {
  recruitment_endpoint_id: branded("endpoint-shadow-html"),
  source_definition_id: sourceDefinition.source_definition_id,
  name: {
    original: { text: "人才招聘列表", encoding: UTF8_TEXT_ENCODING }
  },
  coverage_regions: [{
    raw_text: { text: "全国", encoding: UTF8_TEXT_ENCODING }
  }],
  locator: "fixture://shadow/official-html",
  request_method: "GET",
  content_kind: "HTML",
  adapter_key: "fixture",
  decoded_text_encoding: UTF8_TEXT_ENCODING,
  collection_config: { max_pages: 2 },
  enabled: true
};

const content = {
  organization: {
    organization_id: organization.organization_id,
    name: organization.name
  },
  title: {
    original: { text: "法律事务岗", encoding: UTF8_TEXT_ENCODING },
    normalized: {
      text: "法律事务岗",
      unicode_form: "NFKC" as const,
      normalizer_version: "source-normalizer/1.0.0",
      operations: []
    }
  },
  requirement_text: {
    original: {
      text: "硕士专业：法律硕士（非法学）",
      encoding: UTF8_TEXT_ENCODING
    },
    normalized: {
      text: "硕士专业:法律硕士(非法学)",
      unicode_form: "NFKC" as const,
      normalizer_version: "source-normalizer/1.0.0",
      operations: [
        "UNICODE_NORMALIZATION" as const,
        "WIDTH_FOLDING" as const,
        "PUNCTUATION_FOLDING" as const
      ]
    }
  },
  locations: [{
    country: "中国",
    province: "湖北省",
    city: "武汉市",
    raw_text: { text: "湖北省武汉市", encoding: UTF8_TEXT_ENCODING },
    is_nationwide: false,
    normalization_confidence: 1
  }],
  recruitment_year: 2027,
  recruitment_batch: {
    original: { text: "秋季校园招聘", encoding: UTF8_TEXT_ENCODING }
  },
  announcement_locator: "fixture://shadow/announcement"
};

export const sourceOccurrence: SourceOccurrence = {
  source_occurrence_id: branded("occurrence-shadow-legal"),
  source_definition_id: sourceDefinition.source_definition_id,
  recruitment_endpoint_id: recruitmentEndpoint.recruitment_endpoint_id,
  source_record_key: "official-legal-001",
  identity_basis: {
    kind: "SOURCE_RECORD_ID",
    source_record_id: "official-legal-001",
    recruitment_cycle: "2027-autumn"
  },
  identity_hash: branded("identity-shadow-source"),
  first_observed_at: observedAt
};

export const sourceOccurrenceVersion: SourceOccurrenceVersion = {
  source_occurrence_version_id: branded("occurrence-version-shadow-1"),
  source_occurrence_id: sourceOccurrence.source_occurrence_id,
  extracted_record_id: branded("external-extracted-record-shadow"),
  revision: 1,
  semantic_hash: branded("semantic-shadow-content"),
  content,
  first_observed_at: observedAt
};

export const canonicalOpportunity: CanonicalOpportunity = {
  canonical_opportunity_id: branded("canonical-shadow-legal"),
  identity_hash: branded("identity-shadow-canonical"),
  created_at: observedAt
};

export const opportunityVersion: OpportunityVersion = {
  opportunity_version_id: branded("opportunity-version-shadow-1"),
  canonical_opportunity_id: canonicalOpportunity.canonical_opportunity_id,
  revision: 1,
  semantic_hash: sourceOccurrenceVersion.semantic_hash,
  content,
  source_occurrence_version_ids: [
    sourceOccurrenceVersion.source_occurrence_version_id
  ],
  effective_from: observedAt
};

export const requirementFact: RequirementFact = {
  requirement_fact_id: branded("requirement-fact-shadow-major"),
  opportunity_version_id: opportunityVersion.opportunity_version_id,
  dimension: "MAJOR",
  operator: "EQUALS",
  value: { kind: "CODE", code: "JURIS_MASTER_NON_LAW" },
  subject_scope: "MASTER",
  logic_group: {
    logic_group_id: branded("logic-group-shadow-major"),
    operator: "AND"
  },
  polarity: "POSITIVE",
  certainty: "EXPLICIT",
  parser_version: "deterministic-requirement-parser/1.0.0"
};

export const requirementEvidence: RequirementEvidence = {
  requirement_evidence_id: branded("requirement-evidence-shadow-major"),
  requirement_fact_id: requirementFact.requirement_fact_id,
  snapshot_id: branded("external-snapshot-shadow"),
  locator: {
    field_path: "raw_requirement_text",
    start_offset: 0,
    end_offset: 18
  },
  evidence_text: {
    text: "硕士专业：法律硕士（非法学）",
    encoding: UTF8_TEXT_ENCODING
  },
  normalized_text: {
    text: "硕士专业:法律硕士(非法学)",
    unicode_form: "NFKC",
    normalizer_version: "source-normalizer/1.0.0",
    operations: ["WIDTH_FOLDING", "PUNCTUATION_FOLDING"]
  },
  extractor_name: "fixture-extractor",
  extractor_version: "1.0.0",
  parser_version: requirementFact.parser_version
};

export const candidateProfile: CandidateProfile = {
  candidate_profile_id: branded("candidate-shadow-wuhan-jm-non-law"),
  education: [{
    level: "MASTER",
    institution: {
      original: { text: "武汉大学", encoding: UTF8_TEXT_ENCODING }
    },
    program_name: {
      original: { text: "法律硕士（非法学）", encoding: UTF8_TEXT_ENCODING }
    },
    normalized_program_codes: ["JURIS_MASTER", "JURIS_MASTER_NON_LAW"],
    academic_background: "NON_LAW",
    graduation_year: 2027
  }],
  target_graduation_year: 2027,
  professional_qualifications: [],
  languages: []
};

export const eligibilityAssessment: EligibilityAssessment = {
  eligibility_assessment_id: branded("eligibility-shadow-eligible"),
  candidate_profile_id: candidateProfile.candidate_profile_id,
  opportunity_version_id: opportunityVersion.opportunity_version_id,
  result: "ELIGIBLE",
  reason_codes: ["REQUIREMENT_SATISFIED"],
  requirement_fact_ids: [requirementFact.requirement_fact_id],
  evidence_ids: [requirementEvidence.requirement_evidence_id],
  engine_version: "deterministic-eligibility-engine/1.0.0",
  parser_versions: [requirementFact.parser_version],
  unresolved_conflicts: [],
  assessed_at: observedAt
};
