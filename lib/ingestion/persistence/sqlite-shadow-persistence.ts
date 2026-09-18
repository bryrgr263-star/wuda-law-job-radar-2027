import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { PRESENTATION_DECISION_V2_SCHEMA_VERSION, PRESENTATION_READ_MODEL_V2_SCHEMA_VERSION } from "../domain/presentation";

import type {
  CandidateProfile,
  CandidateProfileId,
  CanonicalOpportunity,
  CanonicalOpportunityId,
  EligibilityAssessment,
  EligibilityAssessmentId,
  OpportunityVersion,
  OpportunityVersionId,
  OpportunityCandidate,
  OpportunityCandidateId,
  PresentationDecision,
  PresentationDecisionId,
  PresentationReadModel,
  PresentationReadModelId,
  PresentationMigrationAudit,
  Organization,
  OrganizationId,
  RecruitmentEndpoint,
  RecruitmentEndpointId,
  RequirementEvidence,
  RequirementEvidenceId,
  RequirementFact,
  RequirementFactId,
  RecallDisposition,
  RecallDispositionId,
  SourceDefinition,
  SourceDefinitionId,
  SourceOccurrence,
  SourceOccurrenceId,
  SourceOccurrenceVersion,
  SourceOccurrenceVersionId
} from "../domain";
import type {
  AppendOnlyRepository,
  OpportunityRecallPersistenceRepository,
  PresentationPersistenceRepository,
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

class SqliteOpportunityRecallPersistence
implements OpportunityRecallPersistenceRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  appendRegistration(
    candidate: OpportunityCandidate,
    initialDisposition: RecallDisposition
  ) {
    if (initialDisposition.opportunity_candidate_id
        !== candidate.opportunity_candidate_id
        || initialDisposition.revision !== 1
        || initialDisposition.supersedes_recall_disposition_id !== null) {
      throw new Error("Initial RecallDisposition must belong to its OpportunityCandidate");
    }
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      insert(this.#database, "shadow_opportunity_candidates", [
        column("opportunity_candidate_id", candidate.opportunity_candidate_id),
        column("source_definition_id", candidate.source_definition_id),
        column("recruitment_endpoint_id", candidate.recruitment_endpoint_id),
        column("discovery_locator", candidate.discovery_locator),
        column("snapshot_id", candidate.snapshot_id),
        column("extracted_record_id", candidate.extracted_record_id),
        column("source_occurrence_version_id", candidate.source_occurrence_version_id),
        column("first_observed_at", candidate.first_observed_at),
        column("integrity_hash", candidate.integrity_hash),
        column("payload_json", JSON.stringify(candidate))
      ]);
      insertRecallDisposition(this.#database, initialDisposition);
      this.#database.exec("COMMIT");
      return {
        candidate: clone(candidate),
        disposition: clone(initialDisposition)
      };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  appendDisposition(disposition: RecallDisposition) {
    if (disposition.revision <= 1
        || !disposition.supersedes_recall_disposition_id) {
      throw new Error("Appended RecallDisposition must supersede a prior revision");
    }
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.#database.prepare(
        `SELECT recall_disposition_id, revision
         FROM shadow_recall_dispositions
         WHERE opportunity_candidate_id = ?
         ORDER BY revision DESC
         LIMIT 1`
      ).get(disposition.opportunity_candidate_id) as {
        recall_disposition_id: string;
        revision: number;
      } | undefined;
      if (!current
          || Number(current.revision) + 1 !== disposition.revision
          || current.recall_disposition_id
            !== disposition.supersedes_recall_disposition_id) {
        throw new Error("RecallDisposition must append to the current persisted revision");
      }
      insertRecallDisposition(this.#database, disposition);
      this.#database.exec("COMMIT");
      return clone(disposition);
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  getCandidate(id: OpportunityCandidateId) {
    return readPayload<OpportunityCandidate>(
      this.#database,
      "shadow_opportunity_candidates",
      "opportunity_candidate_id",
      id
    );
  }

  getDisposition(id: RecallDispositionId) {
    return readPayload<RecallDisposition>(
      this.#database,
      "shadow_recall_dispositions",
      "recall_disposition_id",
      id
    );
  }

  listDispositions(id: OpportunityCandidateId) {
    return this.#database.prepare(
      `SELECT payload_json
       FROM shadow_recall_dispositions
       WHERE opportunity_candidate_id = ?
       ORDER BY revision`
    ).all(id).map((row) => {
      return JSON.parse(String(row.payload_json)) as RecallDisposition;
    });
  }

  candidateCount() {
    return countRows(this.#database, "shadow_opportunity_candidates");
  }

  dispositionCount() {
    return countRows(this.#database, "shadow_recall_dispositions");
  }
}

class SqlitePresentationPersistence implements PresentationPersistenceRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) { this.#database = database; }

  appendDecision(decision: PresentationDecision) {
    const existing = this.getDecision(decision.presentation_decision_id);
    if (existing) return samePayload(existing, decision,
      "shadow_presentation_decisions", decision.presentation_decision_id);
    if (decision.schema_version === PRESENTATION_DECISION_V2_SCHEMA_VERSION) {
      this.#database.prepare(`INSERT INTO shadow_presentation_v2_decisions
        (presentation_decision_id, opportunity_candidate_id, scope, record_kind, position_id, revision,
         supersedes_presentation_decision_id, semantic_hash, projection_version, integrity_hash, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(decision.presentation_decision_id, decision.opportunity_candidate_id, decision.scope, decision.record_kind,
          decision.position_id, decision.revision, decision.supersedes_presentation_decision_id,
          decision.record_kind === "POSITION_PRESENTATION" ? decision.semantic_hash : null,
          decision.record_kind === "POSITION_PRESENTATION" ? decision.semantic_projection.projection_version : null,
          decision.integrity_hash, JSON.stringify(decision));
      return clone(decision);
    }
    this.#database.prepare(`INSERT INTO shadow_presentation_decisions
      (presentation_decision_id, opportunity_candidate_id, revision, status, integrity_hash, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(decision.presentation_decision_id, decision.opportunity_candidate_id,
        decision.revision, decision.status, decision.integrity_hash, JSON.stringify(decision));
    return clone(decision);
  }

  appendReadModel(readModel: PresentationReadModel) {
    const existing = this.getReadModel(readModel.presentation_read_model_id);
    if (existing) return samePayload(existing, readModel,
      "shadow_presentation_read_models", readModel.presentation_read_model_id);
    if (readModel.schema_version === PRESENTATION_READ_MODEL_V2_SCHEMA_VERSION) {
      this.#database.prepare(`INSERT INTO shadow_presentation_v2_read_models
        (presentation_read_model_id, presentation_decision_id, scope, position_id, decision_revision, integrity_hash, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(readModel.presentation_read_model_id, readModel.presentation_decision_id, readModel.scope,
          readModel.position_id, readModel.decision_revision, readModel.integrity_hash, JSON.stringify(readModel));
      return clone(readModel);
    }
    this.#database.prepare(`INSERT INTO shadow_presentation_read_models
      (presentation_read_model_id, presentation_decision_id, opportunity_candidate_id,
       presentation_status, updated_at, integrity_hash, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(readModel.presentation_read_model_id, readModel.presentation_decision_id,
        readModel.opportunity_candidate_id, readModel.presentation_status,
        readModel.updated_at, readModel.integrity_hash, JSON.stringify(readModel));
    return clone(readModel);
  }

  getDecision(id: PresentationDecisionId) {
    return readPayload<PresentationDecision>(this.#database,
      "shadow_presentation_decisions", "presentation_decision_id", id)
      ?? readPayload<PresentationDecision>(this.#database, "shadow_presentation_v2_decisions", "presentation_decision_id", id);
  }

  getReadModel(id: PresentationReadModelId) {
    return readPayload<PresentationReadModel>(this.#database,
      "shadow_presentation_read_models", "presentation_read_model_id", id)
      ?? readPayload<PresentationReadModel>(this.#database, "shadow_presentation_v2_read_models", "presentation_read_model_id", id);
  }

  listCurrentReadModels() {
    if (countRows(this.#database, "shadow_presentation_v2_decisions") > 0
        || countRows(this.#database, "shadow_presentation_v2_migration_audits") > 0) {
      throw new Error("Presentation V2 requires the root-composed validated read repository");
    }
    return this.#database.prepare(`
      SELECT model.payload_json
      FROM shadow_presentation_read_models model
      JOIN shadow_presentation_decisions decision
        ON decision.presentation_decision_id = model.presentation_decision_id
      WHERE decision.revision = (
        SELECT MAX(current.revision)
        FROM shadow_presentation_decisions current
        WHERE current.opportunity_candidate_id = decision.opportunity_candidate_id
      )
      ORDER BY model.updated_at DESC, model.presentation_read_model_id ASC
    `).all().map((row) => JSON.parse(String(row.payload_json)) as PresentationReadModel);
  }

  readPresentationHistory() {
    const read = <Artifact>(table: string) => this.#database.prepare(`SELECT payload_json FROM ${table}`)
      .all().map((row) => JSON.parse(String(row.payload_json)) as Artifact);
    const decisions = [...read<PresentationDecision>("shadow_presentation_decisions"), ...read<PresentationDecision>("shadow_presentation_v2_decisions")];
    const models = [...read<PresentationReadModel>("shadow_presentation_read_models"), ...read<PresentationReadModel>("shadow_presentation_v2_read_models")];
    return { decisions, read_models: models, migration_audits: read<PresentationMigrationAudit>("shadow_presentation_v2_migration_audits") };
  }

  appendMigrationAudit(audit: PresentationMigrationAudit) {
    const existing = readPayload<PresentationMigrationAudit>(this.#database,
      "shadow_presentation_v2_migration_audits", "migration_id", audit.migration_id);
    if (existing) return samePayload(existing, audit, "shadow_presentation_v2_migration_audits", audit.migration_id);
    this.#database.prepare(`INSERT INTO shadow_presentation_v2_migration_audits
      (migration_id, scope, position_id, integrity_hash, payload_json) VALUES (?, ?, ?, ?, ?)`)
      .run(audit.migration_id, audit.scope, audit.position_id, audit.integrity_hash, JSON.stringify(audit));
    return clone(audit);
  }
}

export class SqliteShadowPersistence implements ShadowPersistenceRepositories {
  readonly opportunity_recall: OpportunityRecallPersistenceRepository;
  readonly presentation: PresentationPersistenceRepository;
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
    this.opportunity_recall = new SqliteOpportunityRecallPersistence(database);
    this.presentation = new SqlitePresentationPersistence(database);
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

function samePayload<Entity>(
  existing: Entity,
  entity: Entity,
  table: string,
  id: string
): Entity {
  if (JSON.stringify(existing) !== JSON.stringify(entity)) {
    throw new Error(`${table} immutable identity collision: ${id}`);
  }
  return clone(existing);
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

function insertRecallDisposition(
  database: DatabaseSync,
  disposition: RecallDisposition
) {
  insert(database, "shadow_recall_dispositions", [
    column("recall_disposition_id", disposition.recall_disposition_id),
    column("opportunity_candidate_id", disposition.opportunity_candidate_id),
    column("revision", disposition.revision),
    column("status", disposition.status),
    column("decided_at", disposition.decided_at),
    column("integrity_hash", disposition.integrity_hash),
    column("payload_json", JSON.stringify(disposition))
  ]);
}

function readPayload<Entity>(
  database: DatabaseSync,
  table: string,
  idColumn: string,
  id: string
): Entity | null {
  const row = database.prepare(
    `SELECT payload_json FROM ${table} WHERE ${idColumn} = ?`
  ).get(id) as { payload_json: string } | undefined;
  return row ? JSON.parse(row.payload_json) as Entity : null;
}

function countRows(database: DatabaseSync, table: string) {
  const row = database.prepare(
    `SELECT COUNT(*) AS count FROM ${table}`
  ).get() as { count: number };
  return Number(row.count);
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
