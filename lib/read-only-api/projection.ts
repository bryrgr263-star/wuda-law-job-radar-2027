import type { DatabaseSync } from "node:sqlite";

import type { SourceHealth } from "../source-scheduler/types";
import {
  type EligibilityAssessmentProjection,
  type EligibilityProjection,
  type ObservationState,
  type OpportunityDetailProjection,
  type OpportunityProjection,
  type OpportunityQuery,
  type OpportunitySourceProjection,
  type ReadOnlyIngestionProjectionOptions,
  ReadOnlyProjectionIntegrityError,
  type RequirementEvidenceProjection,
  type RequirementProjection,
  type SourceHealthProjection,
  type SourceProjection
} from "./types";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface OpportunityRow {
  readonly canonical_opportunity_id: string;
  readonly opportunity_version_id: string;
  readonly opportunity_json: string;
  readonly source_occurrence_id: string;
  readonly occurrence_json: string;
  readonly source_occurrence_version_id: string;
  readonly source_version_json: string;
  readonly extracted_record_id: string;
  readonly snapshot_id: string;
  readonly raw_blob_id: string;
  readonly collection_run_id: string;
  readonly recruitment_endpoint_id: string;
  readonly source_definition_id: string;
  readonly original_url: string;
  readonly observed_at: string;
  readonly semantic_hash: string;
  readonly collection_status: string;
  readonly endpoint_purpose: string | null;
  readonly source_json: string;
  readonly endpoint_json: string;
}

interface RequirementRow {
  readonly requirement_fact_id: string;
  readonly fact_json: string;
  readonly requirement_evidence_id: string;
  readonly evidence_json: string;
  readonly snapshot_id: string;
  readonly raw_blob_id: string;
  readonly original_url: string;
}

interface EligibilityRow {
  readonly eligibility_assessment_id: string;
  readonly candidate_profile_id: string;
  readonly result: string;
  readonly assessment_json: string;
}

export class ReadOnlyIngestionProjection {
  readonly #database: DatabaseSync;
  readonly #sourceHealth: readonly SourceHealth[];

  constructor(database: DatabaseSync, options: ReadOnlyIngestionProjectionOptions = {}) {
    this.#database = database;
    this.#sourceHealth = options.source_health ?? [];
  }

  listOpportunities(query: OpportunityQuery = {}) {
    const normalized = normalizeQuery(query);
    const filtered = this.#opportunities().filter((opportunity) => matchesQuery(opportunity, normalized));
    return {
      pagination: {
        offset: normalized.offset,
        limit: normalized.limit,
        total: filtered.length
      },
      opportunities: filtered.slice(normalized.offset, normalized.offset + normalized.limit)
    };
  }

  opportunityDetail(opportunityId: string): OpportunityDetailProjection | null {
    const opportunity = this.#opportunities().find((item) => item.opportunity_id === opportunityId);
    if (!opportunity) return null;
    return {
      opportunity,
      requirements: this.#requirements(opportunity.opportunity_version_id),
      eligibility: this.#eligibility(opportunity.opportunity_version_id)
    };
  }

  listSources(): readonly SourceProjection[] {
    const healthByEndpoint = new Map(this.listSourceHealth().map((health) => {
      return [health.recruitment_endpoint_id, health] as const;
    }));
    const rows = this.#database.prepare(`
      SELECT source.source_definition_id, source.payload_json AS source_json,
        organization.organization_id, organization.payload_json AS organization_json
      FROM ingestion_source_definitions source
      JOIN ingestion_organizations organization
        ON organization.organization_id = source.publisher_organization_id
      ORDER BY source.source_definition_id ASC
    `).all() as unknown as readonly {
      source_definition_id: string;
      source_json: string;
      organization_id: string;
      organization_json: string;
    }[];
    return rows.map((row) => {
      const source = parseObject(row.source_json, "SourceDefinition");
      const organization = parseObject(row.organization_json, "Organization");
      const endpoints = this.#database.prepare(`
        SELECT recruitment_endpoint_id, payload_json
        FROM ingestion_recruitment_endpoints
        WHERE source_definition_id = ?
        ORDER BY recruitment_endpoint_id ASC
      `).all(row.source_definition_id) as unknown as readonly {
        recruitment_endpoint_id: string;
        payload_json: string;
      }[];
      return {
        source_definition_id: row.source_definition_id,
        name: traceableText(requiredObject(source.name, "SourceDefinition.name"), "SourceDefinition.name"),
        publisher_organization: {
          organization_id: row.organization_id,
          name: traceableText(requiredObject(organization.name, "Organization.name"), "Organization.name")
        },
        endpoints: endpoints.map((endpointRow) => {
          const endpoint = parseObject(endpointRow.payload_json, "RecruitmentEndpoint");
          return {
            recruitment_endpoint_id: endpointRow.recruitment_endpoint_id,
            name: traceableText(requiredObject(endpoint.name, "RecruitmentEndpoint.name"), "RecruitmentEndpoint.name"),
            locator: requiredString(endpoint.locator, "RecruitmentEndpoint.locator"),
            health: healthByEndpoint.get(endpointRow.recruitment_endpoint_id) ?? null
          };
        })
      };
    });
  }

  listSourceHealth(): readonly SourceHealthProjection[] {
    const seen = new Set<string>();
    return this.#sourceHealth.map((health) => {
      const key = `${health.source_admission_id}:${health.recruitment_endpoint_id}`;
      if (seen.has(key)) {
        throw new ReadOnlyProjectionIntegrityError(`Duplicate SourceHealth snapshot: ${key}`);
      }
      seen.add(key);
      const binding = this.#database.prepare(`
        SELECT endpoint.source_definition_id
        FROM ingestion_recruitment_endpoints endpoint
        JOIN ingestion_authorization_audits authorization
          ON authorization.recruitment_endpoint_id = endpoint.recruitment_endpoint_id
        WHERE endpoint.recruitment_endpoint_id = ?
          AND authorization.source_admission_id = ?
        LIMIT 1
      `).get(health.recruitment_endpoint_id, health.source_admission_id) as {
        source_definition_id: string;
      } | undefined;
      if (!binding) {
        throw new ReadOnlyProjectionIntegrityError(
          `SourceHealth has no persisted Source Admission and Endpoint binding: ${key}`
        );
      }
      return {
        source_definition_id: binding.source_definition_id,
        source_admission_id: health.source_admission_id,
        recruitment_endpoint_id: health.recruitment_endpoint_id,
        status: health.status,
        consecutive_success: health.consecutive_success,
        consecutive_failure: health.consecutive_failure,
        last_success: health.last_success,
        last_failure: health.last_failure,
        last_http_status: health.last_http_status,
        last_content_hash: health.last_content_hash,
        structure_change_detected: health.structure_change_detected,
        robots_status: health.robots_status,
        terms_status: health.terms_status
      };
    });
  }

  #opportunities(): readonly OpportunityProjection[] {
    const rows = this.#database.prepare(`
      SELECT canonical.canonical_opportunity_id, opportunity.opportunity_version_id,
        opportunity.payload_json AS opportunity_json,
        occurrence.source_occurrence_id, occurrence.payload_json AS occurrence_json,
        source_version.source_occurrence_version_id, source_version.payload_json AS source_version_json,
        extracted.extracted_record_id, snapshot.snapshot_id, raw.raw_blob_id,
        run.collection_run_id, endpoint.recruitment_endpoint_id, source.source_definition_id,
        raw.original_url, snapshot.observed_at, source_version.semantic_hash,
        run.status AS collection_status, authorization.endpoint_purpose,
        source.payload_json AS source_json, endpoint.payload_json AS endpoint_json
      FROM ingestion_canonical_opportunities canonical
      JOIN ingestion_opportunity_versions opportunity
        ON opportunity.canonical_opportunity_id = canonical.canonical_opportunity_id
      JOIN ingestion_opportunity_version_sources opportunity_source
        ON opportunity_source.opportunity_version_id = opportunity.opportunity_version_id
      JOIN ingestion_source_occurrence_versions source_version
        ON source_version.source_occurrence_version_id = opportunity_source.source_occurrence_version_id
      JOIN ingestion_source_occurrences occurrence
        ON occurrence.source_occurrence_id = source_version.source_occurrence_id
      JOIN ingestion_extracted_records extracted
        ON extracted.extracted_record_id = source_version.extracted_record_id
      JOIN ingestion_snapshots snapshot ON snapshot.snapshot_id = extracted.snapshot_id
      JOIN ingestion_raw_blobs raw ON raw.raw_blob_id = snapshot.raw_blob_id
      JOIN ingestion_collection_runs run ON run.collection_run_id = snapshot.collection_run_id
      JOIN ingestion_authorization_audits authorization ON authorization.authorization_id = run.authorization_id
      JOIN ingestion_recruitment_endpoints endpoint
        ON endpoint.recruitment_endpoint_id = run.recruitment_endpoint_id
      JOIN ingestion_source_definitions source
        ON source.source_definition_id = endpoint.source_definition_id
      WHERE opportunity.revision = (
        SELECT MAX(latest.revision)
        FROM ingestion_opportunity_versions latest
        WHERE latest.canonical_opportunity_id = canonical.canonical_opportunity_id
      )
      ORDER BY canonical.canonical_opportunity_id ASC, opportunity_source.source_ordinal ASC
    `).all() as unknown as readonly OpportunityRow[];
    const grouped = new Map<string, OpportunityRow[]>();
    for (const row of rows) {
      const group = grouped.get(row.canonical_opportunity_id) ?? [];
      group.push(row);
      grouped.set(row.canonical_opportunity_id, group);
    }
    return [...grouped.values()].map((group) => projectOpportunity(group));
  }

  #requirements(opportunityVersionId: string): readonly RequirementProjection[] {
    const rows = this.#database.prepare(`
      SELECT fact.requirement_fact_id, fact.payload_json AS fact_json,
        evidence.requirement_evidence_id, evidence.payload_json AS evidence_json,
        snapshot.snapshot_id, raw.raw_blob_id, raw.original_url
      FROM ingestion_requirement_facts fact
      JOIN ingestion_requirement_evidence evidence
        ON evidence.requirement_fact_id = fact.requirement_fact_id
      JOIN ingestion_snapshots snapshot ON snapshot.snapshot_id = evidence.snapshot_id
      JOIN ingestion_raw_blobs raw ON raw.raw_blob_id = snapshot.raw_blob_id
      WHERE fact.opportunity_version_id = ?
      ORDER BY fact.requirement_fact_id ASC, evidence.requirement_evidence_id ASC
    `).all(opportunityVersionId) as unknown as readonly RequirementRow[];
    const grouped = new Map<string, RequirementRow[]>();
    for (const row of rows) {
      const group = grouped.get(row.requirement_fact_id) ?? [];
      group.push(row);
      grouped.set(row.requirement_fact_id, group);
    }
    return [...grouped.values()].map((group) => projectRequirement(group));
  }

  #eligibility(opportunityVersionId: string): EligibilityProjection {
    const assessments = this.#database.prepare(`
      SELECT assessment.eligibility_assessment_id, assessment.candidate_profile_id,
        assessment.result, assessment.payload_json AS assessment_json
      FROM ingestion_eligibility_assessments assessment
      WHERE assessment.opportunity_version_id = ?
      ORDER BY assessment.eligibility_assessment_id ASC
    `).all(opportunityVersionId) as unknown as readonly EligibilityRow[];
    if (assessments.length === 0) {
      const deferral = this.#database.prepare(`
        SELECT reason
        FROM ingestion_assessment_deferrals
        WHERE opportunity_version_id = ?
      `).get(opportunityVersionId) as { reason: string } | undefined;
      return {
        status: "NOT_ASSESSED",
        reason: deferral?.reason ?? "No persisted EligibilityAssessment exists for this OpportunityVersion."
      };
    }
    return {
      status: "ASSESSED",
      assessments: assessments.map((assessment) => this.#projectEligibilityAssessment(assessment))
    };
  }

  #projectEligibilityAssessment(row: EligibilityRow): EligibilityAssessmentProjection {
    const assessment = parseObject(row.assessment_json, "EligibilityAssessment");
    const candidate = this.#database.prepare(`
      SELECT 1 AS present
      FROM ingestion_candidate_profiles
      WHERE candidate_profile_id = ?
    `).get(row.candidate_profile_id);
    if (!candidate) {
      throw new ReadOnlyProjectionIntegrityError(
        `EligibilityAssessment is missing its CandidateProfile: ${row.eligibility_assessment_id}`
      );
    }
    const factIds = this.#linkedIds(
      "ingestion_eligibility_assessment_facts",
      "requirement_fact_id",
      row.eligibility_assessment_id
    );
    const evidenceIds = this.#linkedIds(
      "ingestion_eligibility_assessment_evidence",
      "requirement_evidence_id",
      row.eligibility_assessment_id
    );
    const expectedFactIds = stringArray(assessment.requirement_fact_ids, "EligibilityAssessment.requirement_fact_ids");
    const expectedEvidenceIds = stringArray(assessment.evidence_ids, "EligibilityAssessment.evidence_ids");
    if (!sameValues(factIds, expectedFactIds) || !sameValues(evidenceIds, expectedEvidenceIds)) {
      throw new ReadOnlyProjectionIntegrityError(
        `EligibilityAssessment links do not match its persisted Fact/Evidence references: ${row.eligibility_assessment_id}`
      );
    }
    return {
      eligibility_assessment_id: row.eligibility_assessment_id,
      candidate_profile_id: row.candidate_profile_id,
      result: row.result,
      reason_codes: stringArray(assessment.reason_codes, "EligibilityAssessment.reason_codes"),
      requirement_fact_ids: factIds,
      evidence_ids: evidenceIds,
      assessed_at: requiredString(assessment.assessed_at, "EligibilityAssessment.assessed_at")
    };
  }

  #linkedIds(table: string, column: string, assessmentId: string) {
    const rows = this.#database.prepare(`
      SELECT ${column}
      FROM ${table}
      WHERE eligibility_assessment_id = ?
      ORDER BY ${column} ASC
    `).all(assessmentId) as readonly Record<string, string>[];
    return rows.map((row) => requiredString(row[column], `${table}.${column}`));
  }
}

function normalizeQuery(query: OpportunityQuery) {
  const offset = query.offset ?? 0;
  const limit = query.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ReadOnlyProjectionIntegrityError("Opportunity query offset must be a non-negative integer");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ReadOnlyProjectionIntegrityError(`Opportunity query limit must be between 1 and ${MAX_LIMIT}`);
  }
  return { ...query, offset, limit };
}

function matchesQuery(opportunity: OpportunityProjection, query: ReturnType<typeof normalizeQuery>) {
  const keyword = query.keyword?.trim().toLocaleLowerCase();
  if (keyword) {
    const values = [opportunity.title, opportunity.organization?.name ?? "", opportunity.source.name];
    if (!values.some((value) => value.toLocaleLowerCase().includes(keyword))) return false;
  }
  if (query.organization) {
    const organization = opportunity.organization;
    if (!organization || (organization.organization_id !== query.organization && organization.name !== query.organization)) {
      return false;
    }
  }
  if (query.source && opportunity.source.source_definition_id !== query.source) return false;
  if (query.observation_state && opportunity.observation_state !== query.observation_state) return false;
  return true;
}

function projectOpportunity(rows: readonly OpportunityRow[]): OpportunityProjection {
  const primary = rows[0];
  if (!primary) throw new ReadOnlyProjectionIntegrityError("Opportunity Projection requires at least one provenance row");
  const opportunity = parseObject(primary.opportunity_json, "OpportunityVersion");
  const content = requiredObject(opportunity.content, "OpportunityVersion.content");
  const title = traceableText(requiredObject(content.title, "OpportunityVersion.content.title"), "OpportunityVersion.content.title");
  const organizationValue = content.organization === undefined
    ? null
    : requiredObject(content.organization, "OpportunityVersion.content.organization");
  const organization = organizationValue === null ? null : {
    organization_id: requiredString(organizationValue.organization_id, "OpportunityVersion.content.organization.organization_id"),
    name: traceableText(requiredObject(organizationValue.name, "OpportunityVersion.content.organization.name"), "OpportunityVersion.content.organization.name")
  };
  const source = parseObject(primary.source_json, "SourceDefinition");
  const endpoint = parseObject(primary.endpoint_json, "RecruitmentEndpoint");
  const occurrence = parseObject(primary.occurrence_json, "SourceOccurrence");
  const sourceVersion = parseObject(primary.source_version_json, "SourceOccurrenceVersion");
  const provenance = rows.map((row) => projectProvenance(row));
  return {
    opportunity_id: primary.canonical_opportunity_id,
    opportunity_version_id: primary.opportunity_version_id,
    title,
    organization,
    source: {
      source_definition_id: primary.source_definition_id,
      name: traceableText(requiredObject(source.name, "SourceDefinition.name"), "SourceDefinition.name")
    },
    endpoint: {
      recruitment_endpoint_id: primary.recruitment_endpoint_id,
      name: traceableText(requiredObject(endpoint.name, "RecruitmentEndpoint.name"), "RecruitmentEndpoint.name"),
      locator: requiredString(endpoint.locator, "RecruitmentEndpoint.locator"),
      purpose: primary.endpoint_purpose
    },
    original_url: primary.original_url,
    observed_at: primary.observed_at,
    first_seen_at: requiredString(occurrence.first_observed_at, "SourceOccurrence.first_observed_at"),
    last_seen_at: requiredString(sourceVersion.first_observed_at, "SourceOccurrenceVersion.first_observed_at"),
    content_hash: primary.semantic_hash,
    observation_state: observationState(primary.collection_status),
    provenance
  };
}

function projectProvenance(row: OpportunityRow): OpportunitySourceProjection {
  return {
    source_occurrence_id: row.source_occurrence_id,
    source_occurrence_version_id: row.source_occurrence_version_id,
    extracted_record_id: row.extracted_record_id,
    snapshot_id: row.snapshot_id,
    raw_blob_id: row.raw_blob_id,
    collection_run_id: row.collection_run_id,
    recruitment_endpoint_id: row.recruitment_endpoint_id,
    source_definition_id: row.source_definition_id,
    original_url: row.original_url
  };
}

function projectRequirement(rows: readonly RequirementRow[]): RequirementProjection {
  const primary = rows[0];
  if (!primary) throw new ReadOnlyProjectionIntegrityError("Requirement Projection requires Evidence");
  const fact = parseObject(primary.fact_json, "RequirementFact");
  return {
    requirement_fact_id: primary.requirement_fact_id,
    dimension: requiredString(fact.dimension, "RequirementFact.dimension"),
    operator: requiredString(fact.operator, "RequirementFact.operator"),
    value: fact.value,
    subject_scope: requiredString(fact.subject_scope, "RequirementFact.subject_scope"),
    polarity: requiredString(fact.polarity, "RequirementFact.polarity"),
    certainty: requiredString(fact.certainty, "RequirementFact.certainty"),
    parser_version: requiredString(fact.parser_version, "RequirementFact.parser_version"),
    evidence: rows.map((row) => {
      const evidence = parseObject(row.evidence_json, "RequirementEvidence");
      return {
        requirement_evidence_id: row.requirement_evidence_id,
        snapshot_id: row.snapshot_id,
        raw_blob_id: row.raw_blob_id,
        original_url: row.original_url,
        locator: requiredObject(evidence.locator, "RequirementEvidence.locator"),
        evidence_text: originalText(requiredObject(evidence.evidence_text, "RequirementEvidence.evidence_text"), "RequirementEvidence.evidence_text"),
        extractor_name: requiredString(evidence.extractor_name, "RequirementEvidence.extractor_name"),
        extractor_version: requiredString(evidence.extractor_version, "RequirementEvidence.extractor_version"),
        parser_version: requiredString(evidence.parser_version, "RequirementEvidence.parser_version")
      } satisfies RequirementEvidenceProjection;
    })
  };
}

function observationState(collectionStatus: string): ObservationState {
  switch (collectionStatus) {
    case "SUCCESS": return "OBSERVED";
    case "PARTIAL": return "PARTIAL";
    case "SUSPICIOUS_EMPTY": return "SUSPICIOUS_EMPTY";
    case "FAILED": return "UNAVAILABLE";
    default: throw new ReadOnlyProjectionIntegrityError(`Unknown persisted Collection Run status: ${collectionStatus}`);
  }
}

function parseObject(value: string, context: string): Record<string, unknown> {
  try {
    return requiredObject(JSON.parse(value), context);
  } catch (error) {
    if (error instanceof ReadOnlyProjectionIntegrityError) throw error;
    throw new ReadOnlyProjectionIntegrityError(`${context} payload is not valid JSON`);
  }
}

function requiredObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReadOnlyProjectionIntegrityError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, context: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ReadOnlyProjectionIntegrityError(`${context} must be a non-empty string`);
  }
  return value;
}

function originalText(value: Record<string, unknown>, context: string) {
  return requiredString(value.text, `${context}.text`);
}

function traceableText(value: Record<string, unknown>, context: string) {
  return originalText(requiredObject(value.original, `${context}.original`), `${context}.original`);
}

function stringArray(value: unknown, context: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ReadOnlyProjectionIntegrityError(`${context} must be a string array`);
  }
  return [...value] as string[];
}

function sameValues(left: readonly string[], right: readonly string[]) {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}
