import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type {
  CandidateProfile,
  CandidateProfileId,
  CanonicalOpportunity,
  CanonicalOpportunityId,
  EligibilityAssessment,
  EligibilityAssessmentId,
  OpportunityVersion,
  OpportunityVersionId,
  Organization,
  OrganizationId,
  RecruitmentEndpoint,
  RecruitmentEndpointId,
  RequirementEvidence,
  RequirementEvidenceId,
  RequirementFact,
  RequirementFactId,
  SourceDefinition,
  SourceDefinitionId,
  SourceOccurrence,
  SourceOccurrenceId,
  SourceOccurrenceVersion,
  SourceOccurrenceVersionId
} from "../domain";
import type {
  AppendOnlyRepository,
  ShadowPersistenceRepositories
} from "./repositories";

interface StoredColumn {
  readonly name: string;
  readonly value: SQLInputValue;
}

interface LinkRow {
  readonly table: string;
  readonly columns: readonly StoredColumn[];
}

interface RepositoryMapping<Entity, Id> {
  readonly table: string;
  readonly id_column: string;
  columns(entity: Entity): readonly StoredColumn[];
  links?(entity: Entity): readonly LinkRow[];
}

class SqliteAppendOnlyRepository<Entity, Id>
implements AppendOnlyRepository<Entity, Id> {
  readonly #database: DatabaseSync;
  readonly #mapping: RepositoryMapping<Entity, Id>;

  constructor(
    database: DatabaseSync,
    mapping: RepositoryMapping<Entity, Id>
  ) {
    this.#database = database;
    this.#mapping = mapping;
  }

  append(entity: Entity): Entity {
    const columns = [
      ...this.#mapping.columns(entity),
      { name: "payload_json", value: JSON.stringify(entity) }
    ];
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      insert(this.#database, this.#mapping.table, columns);
      for (const link of this.#mapping.links?.(entity) ?? []) {
        insert(this.#database, link.table, link.columns);
      }
      this.#database.exec("COMMIT");
      return clone(entity);
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  get(id: Id): Entity | null {
    const statement = this.#database.prepare(
      `SELECT payload_json FROM ${this.#mapping.table} WHERE ${this.#mapping.id_column} = ?`
    );
    const row = statement.get(String(id)) as { payload_json: string } | undefined;
    return row ? JSON.parse(row.payload_json) as Entity : null;
  }

  count(): number {
    const row = this.#database.prepare(
      `SELECT COUNT(*) AS count FROM ${this.#mapping.table}`
    ).get() as { count: number };
    return Number(row.count);
  }
}

export class SqliteShadowPersistence implements ShadowPersistenceRepositories {
  readonly organizations: AppendOnlyRepository<Organization, OrganizationId>;
  readonly source_definitions: AppendOnlyRepository<
    SourceDefinition,
    SourceDefinitionId
  >;
  readonly recruitment_endpoints: AppendOnlyRepository<
    RecruitmentEndpoint,
    RecruitmentEndpointId
  >;
  readonly source_occurrences: AppendOnlyRepository<
    SourceOccurrence,
    SourceOccurrenceId
  >;
  readonly source_occurrence_versions: AppendOnlyRepository<
    SourceOccurrenceVersion,
    SourceOccurrenceVersionId
  >;
  readonly canonical_opportunities: AppendOnlyRepository<
    CanonicalOpportunity,
    CanonicalOpportunityId
  >;
  readonly opportunity_versions: AppendOnlyRepository<
    OpportunityVersion,
    OpportunityVersionId
  >;
  readonly requirement_facts: AppendOnlyRepository<
    RequirementFact,
    RequirementFactId
  >;
  readonly requirement_evidence: AppendOnlyRepository<
    RequirementEvidence,
    RequirementEvidenceId
  >;
  readonly candidate_profiles: AppendOnlyRepository<
    CandidateProfile,
    CandidateProfileId
  >;
  readonly eligibility_assessments: AppendOnlyRepository<
    EligibilityAssessment,
    EligibilityAssessmentId
  >;

  constructor(database: DatabaseSync) {
    this.organizations = repository(database, {
      table: "shadow_organizations",
      id_column: "organization_id",
      columns: (entity) => [column("organization_id", entity.organization_id)]
    });
    this.source_definitions = repository(database, {
      table: "shadow_source_definitions",
      id_column: "source_definition_id",
      columns: (entity) => [
        column("source_definition_id", entity.source_definition_id),
        column("publisher_organization_id", entity.publisher_organization_id)
      ]
    });
    this.recruitment_endpoints = repository(database, {
      table: "shadow_recruitment_endpoints",
      id_column: "recruitment_endpoint_id",
      columns: (entity) => [
        column("recruitment_endpoint_id", entity.recruitment_endpoint_id),
        column("source_definition_id", entity.source_definition_id)
      ]
    });
    this.source_occurrences = repository(database, {
      table: "shadow_source_occurrences",
      id_column: "source_occurrence_id",
      columns: (entity) => [
        column("source_occurrence_id", entity.source_occurrence_id),
        column("source_definition_id", entity.source_definition_id),
        column("recruitment_endpoint_id", entity.recruitment_endpoint_id),
        column("identity_hash", entity.identity_hash)
      ]
    });
    this.source_occurrence_versions = repository(database, {
      table: "shadow_source_occurrence_versions",
      id_column: "source_occurrence_version_id",
      columns: (entity) => [
        column("source_occurrence_version_id", entity.source_occurrence_version_id),
        column("source_occurrence_id", entity.source_occurrence_id),
        column("extracted_record_id", entity.extracted_record_id),
        column("revision", entity.revision),
        column("semantic_hash", entity.semantic_hash)
      ]
    });
    this.canonical_opportunities = repository(database, {
      table: "shadow_canonical_opportunities",
      id_column: "canonical_opportunity_id",
      columns: (entity) => [
        column("canonical_opportunity_id", entity.canonical_opportunity_id),
        column("identity_hash", entity.identity_hash)
      ]
    });
    this.opportunity_versions = repository(database, {
      table: "shadow_opportunity_versions",
      id_column: "opportunity_version_id",
      columns: (entity) => [
        column("opportunity_version_id", entity.opportunity_version_id),
        column("canonical_opportunity_id", entity.canonical_opportunity_id),
        column("revision", entity.revision),
        column("semantic_hash", entity.semantic_hash)
      ],
      links: (entity) => entity.source_occurrence_version_ids.map((id, index) => ({
        table: "shadow_opportunity_version_sources",
        columns: [
          column("opportunity_version_id", entity.opportunity_version_id),
          column("source_occurrence_version_id", id),
          column("source_ordinal", index)
        ]
      }))
    });
    this.requirement_facts = repository(database, {
      table: "shadow_requirement_facts",
      id_column: "requirement_fact_id",
      columns: (entity) => [
        column("requirement_fact_id", entity.requirement_fact_id),
        column("opportunity_version_id", entity.opportunity_version_id),
        column("logic_group_id", entity.logic_group.logic_group_id)
      ]
    });
    this.requirement_evidence = repository(database, {
      table: "shadow_requirement_evidence",
      id_column: "requirement_evidence_id",
      columns: (entity) => [
        column("requirement_evidence_id", entity.requirement_evidence_id),
        column("requirement_fact_id", entity.requirement_fact_id),
        column("external_snapshot_id", entity.snapshot_id)
      ]
    });
    this.candidate_profiles = repository(database, {
      table: "shadow_candidate_profiles",
      id_column: "candidate_profile_id",
      columns: (entity) => [
        column("candidate_profile_id", entity.candidate_profile_id)
      ]
    });
    this.eligibility_assessments = repository(database, {
      table: "shadow_eligibility_assessments",
      id_column: "eligibility_assessment_id",
      columns: (entity) => [
        column("eligibility_assessment_id", entity.eligibility_assessment_id),
        column("candidate_profile_id", entity.candidate_profile_id),
        column("opportunity_version_id", entity.opportunity_version_id),
        column("result", entity.result)
      ],
      links: (entity) => [
        ...entity.requirement_fact_ids.map((id, index) => ({
          table: "shadow_eligibility_assessment_facts",
          columns: [
            column("eligibility_assessment_id", entity.eligibility_assessment_id),
            column("requirement_fact_id", id),
            column("fact_ordinal", index)
          ]
        })),
        ...entity.evidence_ids.map((id, index) => ({
          table: "shadow_eligibility_assessment_evidence",
          columns: [
            column("eligibility_assessment_id", entity.eligibility_assessment_id),
            column("requirement_evidence_id", id),
            column("evidence_ordinal", index)
          ]
        }))
      ]
    });
  }
}

function repository<Entity, Id>(
  database: DatabaseSync,
  mapping: RepositoryMapping<Entity, Id>
) {
  return new SqliteAppendOnlyRepository(database, mapping);
}

function column(name: string, value: SQLInputValue): StoredColumn {
  return { name, value };
}

function insert(
  database: DatabaseSync,
  table: string,
  columns: readonly StoredColumn[]
) {
  const names = columns.map((item) => item.name).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  database.prepare(
    `INSERT INTO ${table} (${names}) VALUES (${placeholders})`
  ).run(...columns.map((item) => item.value));
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
