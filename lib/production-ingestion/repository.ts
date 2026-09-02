import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import {
  ConservativeCanonicalizer,
  SourceNormalizationError,
  SourceOccurrenceIdentityError,
  buildIdentityBasis,
  identityHashFor,
  normalizeExtractedRecord,
  semanticHashFor,
  type CanonicalOpportunity,
  type EligibilityAssessment,
  type OpportunityVersion,
  type RequirementEvidence,
  type RequirementFact,
  type SourceOccurrence,
  type SourceOccurrenceVersion
} from "../ingestion";
import {
  type ProductionCaptureWriteInput,
  type ProductionEligibilityWriteInput,
  type ProductionIngestionWriteResult,
  type ProductionIngestionWriteStage,
  type ProductionIngestionWriteStatus,
  type ProductionRequirementWriteInput,
  ProductionIngestionWriteError
} from "./types";

export interface ProductionWriteOptions {
  readonly fail_after?: ProductionIngestionWriteStage;
}

export interface ProductionCanonicalProvenance {
  readonly canonical_opportunity_id: string;
  readonly opportunity_version_id: string;
  readonly source_occurrence_id: string;
  readonly source_occurrence_version_id: string;
  readonly extracted_record_id: string;
  readonly snapshot_id: string;
  readonly raw_blob_id: string;
  readonly collection_run_id: string;
  readonly recruitment_endpoint_id: string;
  readonly source_definition_id: string;
  readonly original_url: string;
}

export class ProductionIngestionRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  writeCapturedRecords(
    input: ProductionCaptureWriteInput,
    options: ProductionWriteOptions = {}
  ): ProductionIngestionWriteResult {
    validateCaptureInput(input);
    const completed = new Set<ProductionIngestionWriteStage>();
    const occurrenceIds: string[] = [];
    const sourceVersionIds: string[] = [];
    const canonicalIds: string[] = [];
    const opportunityVersionIds: string[] = [];
    const statuses: ProductionIngestionWriteStatus[] = [];

    this.#transaction(() => {
      for (const organization of input.organizations) {
        insertIgnore(this.#database, "ingestion_organizations", [
          ["organization_id", organization.organization_id],
          ["payload_json", json(organization)]
        ]);
      }
      insertIgnore(this.#database, "ingestion_source_definitions", [
        ["source_definition_id", input.source_definition.source_definition_id],
        ["publisher_organization_id", input.source_definition.publisher_organization_id],
        ["payload_json", json(input.source_definition)]
      ]);
      insertIgnore(this.#database, "ingestion_recruitment_endpoints", [
        ["recruitment_endpoint_id", input.endpoint.recruitment_endpoint_id],
        ["source_definition_id", input.endpoint.source_definition_id],
        ["payload_json", json(input.endpoint)]
      ]);
    });
    completed.add("SOURCE");
    failIfRequested(options, "SOURCE");

    this.#transaction(() => {
      insertIgnore(this.#database, "ingestion_authorization_audits", [
        ["authorization_id", input.authorization.authorization_id],
        ["collection_run_id", input.authorization.collection_run_id],
        ["source_admission_id", input.authorization.source_admission_id],
        ["recruitment_endpoint_id", input.authorization.recruitment_endpoint_id],
        ["endpoint", input.authorization.endpoint],
        ["endpoint_purpose", input.authorization.endpoint_purpose],
        ["reviewer", input.authorization.reviewer],
        ["issued_at", input.authorization.issued_at],
        ["evidence_id", input.authorization.evidence_id],
        ["payload_json", json(input.authorization)]
      ]);
    });
    completed.add("AUTHORIZATION");
    failIfRequested(options, "AUTHORIZATION");

    this.#transaction(() => {
      insertIgnore(this.#database, "ingestion_collection_runs", [
        ["collection_run_id", input.collection_run.collection_run_id],
        ["source_definition_id", input.collection_run.source_definition_id],
        ["recruitment_endpoint_id", input.collection_run.recruitment_endpoint_id],
        ["authorization_id", input.collection_run.authorization_id],
        ["status", input.collection_run.status],
        ["started_at", input.collection_run.started_at],
        ["completed_at", input.collection_run.completed_at],
        ["request_json", json(input.collection_run.request_metadata)],
        ["result_json", json(input.collection_run.result_metadata)],
        ["scheduler_dispatch_reference", input.collection_run.scheduler_dispatch_reference]
      ]);
    });
    completed.add("COLLECTION_RUN");
    failIfRequested(options, "COLLECTION_RUN");

    this.#transaction(() => {
      insertIgnore(this.#database, "ingestion_raw_blobs", [
        ["raw_blob_id", input.raw_blob.raw_blob_id],
        ["sha256", input.raw_blob.raw_content_sha256],
        ["mime_type", input.raw_blob.mime_type],
        ["byte_length", input.raw_blob.byte_length],
        ["object_path", input.raw_object_path],
        ["original_url", input.original_url],
        ["created_at", input.raw_blob.created_at]
      ]);
      insertIgnore(this.#database, "ingestion_raw_blob_runs", [
        ["raw_blob_id", input.raw_blob.raw_blob_id],
        ["collection_run_id", input.collection_run.collection_run_id]
      ]);
    });
    completed.add("RAW");
    failIfRequested(options, "RAW");

    this.#transaction(() => {
      insertIgnore(this.#database, "ingestion_snapshots", [
        ["snapshot_id", input.snapshot.snapshot_id],
        ["collection_run_id", input.collection_run.collection_run_id],
        ["recruitment_endpoint_id", input.snapshot.recruitment_endpoint_id],
        ["raw_blob_id", input.snapshot.raw_blob_id],
        ["transport_status", input.snapshot.transport_status],
        ["content_hash", input.snapshot.content_hash],
        ["content_length", input.snapshot.content_length],
        ["request_json", json(input.snapshot.request_metadata)],
        ["response_json", json(input.snapshot.response_metadata)],
        ["observed_at", input.snapshot.observed_at],
        ["payload_json", json(input.snapshot)]
      ]);
    });
    completed.add("SNAPSHOT");
    failIfRequested(options, "SNAPSHOT");

    this.#transaction(() => {
      for (const record of input.extracted_records) {
        insertIgnore(this.#database, "ingestion_extracted_records", [
          ["extracted_record_id", record.extracted_record_id],
          ["snapshot_id", record.snapshot_id],
          ["source_definition_id", record.source_definition_id],
          ["payload_json", json(record)]
        ]);
      }
    });
    completed.add("EXTRACTED_RECORD");
    failIfRequested(options, "EXTRACTED_RECORD");

    for (const record of input.extracted_records) {
      const outcome = this.#processOccurrence(input, record);
      statuses.push(outcome.status);
      if (outcome.occurrence) occurrenceIds.push(outcome.occurrence.source_occurrence_id);
      if (outcome.sourceVersion) sourceVersionIds.push(outcome.sourceVersion.source_occurrence_version_id);
      if (outcome.canonical) canonicalIds.push(outcome.canonical.canonical_opportunity_id);
      if (outcome.opportunityVersion) opportunityVersionIds.push(outcome.opportunityVersion.opportunity_version_id);
    }
    completed.add("OCCURRENCE");
    failIfRequested(options, "OCCURRENCE");
    if (canonicalIds.length > 0) completed.add("CANONICAL");
    failIfRequested(options, "CANONICAL");

    for (const opportunityVersionId of opportunityVersionIds) {
      this.#transaction(() => {
        insertIgnore(this.#database, "ingestion_assessment_deferrals", [
          ["opportunity_version_id", opportunityVersionId],
          ["status", "NOT_ASSESSED_INSUFFICIENT_REQUIREMENT_EVIDENCE"],
          ["reason", "No job-level Requirement facts were observed in this captured HTML; linked attachments were not accessed."]
        ]);
      });
    }
    completed.add("REQUIREMENT");
    failIfRequested(options, "REQUIREMENT");
    completed.add("ELIGIBILITY");
    failIfRequested(options, "ELIGIBILITY");

    return {
      status: summarizeStatus(statuses),
      completed_stages: orderedStages(completed),
      source_occurrence_ids: distinct(occurrenceIds),
      source_occurrence_version_ids: distinct(sourceVersionIds),
      canonical_opportunity_ids: distinct(canonicalIds),
      opportunity_version_ids: distinct(opportunityVersionIds),
      requirement_fact_ids: [],
      eligibility_assessment_id: null,
      eligibility_status: "NOT_ASSESSED_INSUFFICIENT_REQUIREMENT_EVIDENCE"
    };
  }

  appendObservedRequirements(input: ProductionRequirementWriteInput) {
    this.#transaction(() => {
      for (const fact of input.facts) {
        requireRow(this.#database, "ingestion_opportunity_versions", "opportunity_version_id", fact.opportunity_version_id);
        insertIgnore(this.#database, "ingestion_requirement_facts", [
          ["requirement_fact_id", fact.requirement_fact_id],
          ["opportunity_version_id", fact.opportunity_version_id],
          ["logic_group_id", fact.logic_group.logic_group_id],
          ["payload_json", json(fact)]
        ]);
      }
      for (const evidence of input.evidence) {
        requireRow(this.#database, "ingestion_requirement_facts", "requirement_fact_id", evidence.requirement_fact_id);
        requireRow(this.#database, "ingestion_snapshots", "snapshot_id", evidence.snapshot_id);
        requireRequirementEvidenceSnapshot(
          this.#database,
          evidence.requirement_fact_id,
          evidence.snapshot_id
        );
        insertIgnore(this.#database, "ingestion_requirement_evidence", [
          ["requirement_evidence_id", evidence.requirement_evidence_id],
          ["requirement_fact_id", evidence.requirement_fact_id],
          ["snapshot_id", evidence.snapshot_id],
          ["payload_json", json(evidence)]
        ]);
      }
    });
  }

  appendEligibilityAssessment(input: ProductionEligibilityWriteInput) {
    this.#transaction(() => {
      const { candidate_profile: candidate, assessment } = input;
      if (candidate.candidate_profile_id !== assessment.candidate_profile_id) {
        throw new ProductionIngestionWriteError("CandidateProfile must match the EligibilityAssessment candidate reference");
      }
      requireRow(this.#database, "ingestion_opportunity_versions", "opportunity_version_id", assessment.opportunity_version_id);
      for (const factId of assessment.requirement_fact_ids) {
        requireRow(this.#database, "ingestion_requirement_facts", "requirement_fact_id", factId);
        requireRequirementFactOpportunityVersion(
          this.#database,
          factId,
          assessment.opportunity_version_id
        );
      }
      for (const evidenceId of assessment.evidence_ids) {
        requireRow(this.#database, "ingestion_requirement_evidence", "requirement_evidence_id", evidenceId);
        requireEligibilityEvidenceFact(
          this.#database,
          evidenceId,
          assessment.requirement_fact_ids
        );
      }
      insertIgnore(this.#database, "ingestion_candidate_profiles", [
        ["candidate_profile_id", candidate.candidate_profile_id],
        ["payload_json", json(candidate)]
      ]);
      insertIgnore(this.#database, "ingestion_eligibility_assessments", [
        ["eligibility_assessment_id", assessment.eligibility_assessment_id],
        ["candidate_profile_id", assessment.candidate_profile_id],
        ["opportunity_version_id", assessment.opportunity_version_id],
        ["result", assessment.result],
        ["payload_json", json(assessment)]
      ]);
      assessment.requirement_fact_ids.forEach((factId, index) => {
        insertIgnore(this.#database, "ingestion_eligibility_assessment_facts", [
          ["eligibility_assessment_id", assessment.eligibility_assessment_id],
          ["requirement_fact_id", factId],
          ["fact_ordinal", index]
        ]);
      });
      assessment.evidence_ids.forEach((evidenceId, index) => {
        insertIgnore(this.#database, "ingestion_eligibility_assessment_evidence", [
          ["eligibility_assessment_id", assessment.eligibility_assessment_id],
          ["requirement_evidence_id", evidenceId],
          ["evidence_ordinal", index]
        ]);
      });
      this.#database.prepare(
        "DELETE FROM ingestion_assessment_deferrals WHERE opportunity_version_id = ?"
      ).run(assessment.opportunity_version_id);
    });
  }

  provenanceForCanonical(canonicalOpportunityId: string): ProductionCanonicalProvenance | null {
    const row = this.#database.prepare(`
      SELECT canonical.canonical_opportunity_id, opportunity.opportunity_version_id,
        occurrence.source_occurrence_id, source_version.source_occurrence_version_id,
        extracted.extracted_record_id, snapshot.snapshot_id, raw.raw_blob_id,
        run.collection_run_id, endpoint.recruitment_endpoint_id,
        source.source_definition_id, raw.original_url
      FROM ingestion_canonical_opportunities canonical
      JOIN ingestion_opportunity_versions opportunity
        ON opportunity.canonical_opportunity_id = canonical.canonical_opportunity_id
      JOIN ingestion_opportunity_version_sources link
        ON link.opportunity_version_id = opportunity.opportunity_version_id
      JOIN ingestion_source_occurrence_versions source_version
        ON source_version.source_occurrence_version_id = link.source_occurrence_version_id
      JOIN ingestion_source_occurrences occurrence
        ON occurrence.source_occurrence_id = source_version.source_occurrence_id
      JOIN ingestion_extracted_records extracted
        ON extracted.extracted_record_id = source_version.extracted_record_id
      JOIN ingestion_snapshots snapshot ON snapshot.snapshot_id = extracted.snapshot_id
      JOIN ingestion_raw_blobs raw ON raw.raw_blob_id = snapshot.raw_blob_id
      JOIN ingestion_collection_runs run ON run.collection_run_id = snapshot.collection_run_id
      JOIN ingestion_recruitment_endpoints endpoint
        ON endpoint.recruitment_endpoint_id = run.recruitment_endpoint_id
      JOIN ingestion_source_definitions source
        ON source.source_definition_id = endpoint.source_definition_id
      WHERE canonical.canonical_opportunity_id = ?
      ORDER BY opportunity.revision DESC
      LIMIT 1
    `).get(canonicalOpportunityId) as ProductionCanonicalProvenance | undefined;
    return row ?? null;
  }

  count(table: string) {
    if (!/^ingestion_[a-z_]+$/u.test(table)) {
      throw new ProductionIngestionWriteError("Production repository accepts isolated ingestion_* tables only");
    }
    const row = this.#database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    return Number(row.count);
  }

  #processOccurrence(input: ProductionCaptureWriteInput, record: ProductionCaptureWriteInput["extracted_records"][number]) {
    let normalized;
    let identityBasis;
    try {
      normalized = normalizeExtractedRecord(record);
      identityBasis = buildIdentityBasis(normalized);
    } catch (error) {
      if (error instanceof SourceNormalizationError || error instanceof SourceOccurrenceIdentityError) {
        return { status: "IDENTITY_UNCERTAIN" as const };
      }
      throw error;
    }
    const identityHash = identityHashFor(input.endpoint.recruitment_endpoint_id, identityBasis);
    let occurrence = this.#payload<SourceOccurrence>(
      "ingestion_source_occurrences",
      "identity_hash",
      identityHash
    );
    const occurrenceCreated = !occurrence;
    if (!occurrence) {
      occurrence = {
        source_occurrence_id: `source-occurrence:${identityHash}` as SourceOccurrence["source_occurrence_id"],
        source_definition_id: input.endpoint.source_definition_id,
        recruitment_endpoint_id: input.endpoint.recruitment_endpoint_id,
        source_record_key: normalized.raw_source_record_id,
        identity_basis: identityBasis,
        identity_hash: identityHash,
        first_observed_at: record.extraction.extracted_at
      };
      this.#transaction(() => {
        insertIgnore(this.#database, "ingestion_source_occurrences", [
          ["source_occurrence_id", occurrence!.source_occurrence_id],
          ["source_definition_id", occurrence!.source_definition_id],
          ["recruitment_endpoint_id", occurrence!.recruitment_endpoint_id],
          ["identity_hash", occurrence!.identity_hash],
          ["payload_json", json(occurrence)]
        ]);
      });
    }

    const semanticHash = semanticHashFor(normalized.content);
    const existingVersion = this.#payload<SourceOccurrenceVersion>(
      "ingestion_source_occurrence_versions",
      "semantic_hash",
      semanticHash,
      "source_occurrence_id",
      occurrence.source_occurrence_id
    );
    if (existingVersion) {
      const existingCanonical = this.#canonicalForSourceVersion(existingVersion.source_occurrence_version_id);
      return {
        status: "UNCHANGED" as const,
        occurrence,
        sourceVersion: existingVersion,
        canonical: existingCanonical?.canonical,
        opportunityVersion: existingCanonical?.opportunityVersion
      };
    }
    const revision = this.#countWhere(
      "ingestion_source_occurrence_versions",
      "source_occurrence_id",
      occurrence.source_occurrence_id
    ) + 1;
    const sourceVersion: SourceOccurrenceVersion = {
      source_occurrence_version_id: `source-occurrence-version:${identityHash}:${revision}` as SourceOccurrenceVersion["source_occurrence_version_id"],
      source_occurrence_id: occurrence.source_occurrence_id,
      extracted_record_id: record.extracted_record_id,
      revision,
      semantic_hash: semanticHash,
      content: normalized.content,
      first_observed_at: record.extraction.extracted_at
    };
    this.#transaction(() => {
      insertIgnore(this.#database, "ingestion_source_occurrence_versions", [
        ["source_occurrence_version_id", sourceVersion.source_occurrence_version_id],
        ["source_occurrence_id", sourceVersion.source_occurrence_id],
        ["extracted_record_id", sourceVersion.extracted_record_id],
        ["revision", sourceVersion.revision],
        ["semantic_hash", sourceVersion.semantic_hash],
        ["payload_json", json(sourceVersion)]
      ]);
    });

    const canonicalized = new ConservativeCanonicalizer().canonicalize([{
      occurrence,
      version: sourceVersion,
      source_definition: input.source_definition
    }], { organizations: input.organizations });
    const selected = canonicalized.opportunities[0];
    if (!selected) throw new ProductionIngestionWriteError("P1 canonicalizer returned no selected opportunity");
    const canonical = selected.canonical_opportunity;
    this.#transaction(() => {
      insertIgnore(this.#database, "ingestion_canonical_opportunities", [
        ["canonical_opportunity_id", canonical.canonical_opportunity_id],
        ["identity_hash", canonical.identity_hash],
        ["payload_json", json(canonical)]
      ]);
    });
    const canonicalRevision = this.#countWhere(
      "ingestion_opportunity_versions",
      "canonical_opportunity_id",
      canonical.canonical_opportunity_id
    ) + 1;
    const opportunityVersion: OpportunityVersion = {
      ...selected.opportunity_version,
      opportunity_version_id: `opportunity-version:${canonical.identity_hash}:${canonicalRevision}` as OpportunityVersion["opportunity_version_id"],
      revision: canonicalRevision,
      source_occurrence_version_ids: [sourceVersion.source_occurrence_version_id]
    };
    this.#transaction(() => {
      insertIgnore(this.#database, "ingestion_opportunity_versions", [
        ["opportunity_version_id", opportunityVersion.opportunity_version_id],
        ["canonical_opportunity_id", opportunityVersion.canonical_opportunity_id],
        ["revision", opportunityVersion.revision],
        ["semantic_hash", opportunityVersion.semantic_hash],
        ["payload_json", json(opportunityVersion)]
      ]);
      insertIgnore(this.#database, "ingestion_opportunity_version_sources", [
        ["opportunity_version_id", opportunityVersion.opportunity_version_id],
        ["source_occurrence_version_id", sourceVersion.source_occurrence_version_id],
        ["source_ordinal", 0]
      ]);
    });
    return {
      status: occurrenceCreated ? "CREATED" as const : "UPDATED" as const,
      occurrence,
      sourceVersion,
      canonical,
      opportunityVersion
    };
  }

  #canonicalForSourceVersion(sourceOccurrenceVersionId: string) {
    const row = this.#database.prepare(`
      SELECT canonical.payload_json AS canonical_json, opportunity.payload_json AS opportunity_json
      FROM ingestion_opportunity_version_sources link
      JOIN ingestion_opportunity_versions opportunity ON opportunity.opportunity_version_id = link.opportunity_version_id
      JOIN ingestion_canonical_opportunities canonical ON canonical.canonical_opportunity_id = opportunity.canonical_opportunity_id
      WHERE link.source_occurrence_version_id = ?
      LIMIT 1
    `).get(sourceOccurrenceVersionId) as { canonical_json: string; opportunity_json: string } | undefined;
    return row ? {
      canonical: JSON.parse(row.canonical_json) as CanonicalOpportunity,
      opportunityVersion: JSON.parse(row.opportunity_json) as OpportunityVersion
    } : null;
  }

  #payload<Value>(table: string, firstColumn: string, firstValue: SQLInputValue, secondColumn?: string, secondValue?: SQLInputValue) {
    const condition = secondColumn ? ` AND ${secondColumn} = ?` : "";
    const values = secondColumn ? [firstValue, secondValue!] : [firstValue];
    const row = this.#database.prepare(
      `SELECT payload_json FROM ${table} WHERE ${firstColumn} = ?${condition} LIMIT 1`
    ).get(...values) as { payload_json: string } | undefined;
    return row ? JSON.parse(row.payload_json) as Value : null;
  }

  #countWhere(table: string, column: string, value: SQLInputValue) {
    const row = this.#database.prepare(
      `SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`
    ).get(value) as { count: number };
    return Number(row.count);
  }

  #transaction(action: () => void) {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      action();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}

function validateCaptureInput(input: ProductionCaptureWriteInput) {
  if (input.source_definition.source_definition_id !== input.endpoint.source_definition_id) {
    throw new ProductionIngestionWriteError("Endpoint must belong to the supplied SourceDefinition");
  }
  if (!input.organizations.some((organization) => {
    return organization.organization_id === input.source_definition.publisher_organization_id;
  })) {
    throw new ProductionIngestionWriteError("SourceDefinition publisher Organization must be persisted first");
  }
  const { authorization, collection_run: run, snapshot, raw_blob: raw } = input;
  if (
    authorization.admission_level !== "B"
    || authorization.admission_decision !== "APPROVED"
    || authorization.automation_basis !== "HUMAN_REVIEWED_CANARY"
    || authorization.scope !== "ONE_ENDPOINT_ONE_RUN"
    || !authorization.manual_confirmation
    || !authorization.authorization_consumed
    || authorization.replay_denial_code !== "AUTHORIZATION_ALREADY_USED"
  ) {
    throw new ProductionIngestionWriteError("Production write requires an already-consumed approved B Canary authorization");
  }
  if (
    authorization.collection_run_id !== run.collection_run_id
    || authorization.authorization_id !== run.authorization_id
    || authorization.recruitment_endpoint_id !== input.endpoint.recruitment_endpoint_id
    || authorization.endpoint !== input.endpoint.locator
    || authorization.allowed_http_method !== "GET"
    || run.recruitment_endpoint_id !== input.endpoint.recruitment_endpoint_id
    || run.source_definition_id !== input.source_definition.source_definition_id
  ) {
    throw new ProductionIngestionWriteError("Authorization, Collection Run, Source, and Endpoint must remain exactly bound");
  }
  if (
    snapshot.recruitment_endpoint_id !== input.endpoint.recruitment_endpoint_id
    || snapshot.transport_status !== "SUCCESS"
    || snapshot.raw_blob_id !== raw.raw_blob_id
    || snapshot.content_hash !== raw.raw_content_sha256
    || snapshot.content_length !== raw.byte_length
  ) {
    throw new ProductionIngestionWriteError("Snapshot must trace exactly to the successful supplied RawBlob");
  }
  if (input.extracted_records.some((record) => {
    return record.snapshot_id !== snapshot.snapshot_id
      || record.source_definition_id !== input.source_definition.source_definition_id;
  })) {
    throw new ProductionIngestionWriteError("ExtractedRecords must trace to the supplied Snapshot and SourceDefinition");
  }
}

function insertIgnore(
  database: DatabaseSync,
  table: string,
  columns: readonly [string, SQLInputValue][]
) {
  const names = columns.map(([name]) => name).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  database.prepare(`INSERT OR IGNORE INTO ${table} (${names}) VALUES (${placeholders})`)
    .run(...columns.map(([, value]) => value));
}

function requireRow(database: DatabaseSync, table: string, column: string, value: SQLInputValue) {
  const row = database.prepare(`SELECT 1 AS present FROM ${table} WHERE ${column} = ?`).get(value);
  if (!row) throw new ProductionIngestionWriteError(`Required persisted reference is missing: ${table}.${column}`);
}

function requireRequirementEvidenceSnapshot(
  database: DatabaseSync,
  requirementFactId: string,
  snapshotId: string
) {
  const row = database.prepare(`
    SELECT 1 AS present
    FROM ingestion_requirement_facts fact
    JOIN ingestion_opportunity_version_sources link
      ON link.opportunity_version_id = fact.opportunity_version_id
    JOIN ingestion_source_occurrence_versions source_version
      ON source_version.source_occurrence_version_id = link.source_occurrence_version_id
    JOIN ingestion_extracted_records extracted
      ON extracted.extracted_record_id = source_version.extracted_record_id
    WHERE fact.requirement_fact_id = ? AND extracted.snapshot_id = ?
    LIMIT 1
  `).get(requirementFactId, snapshotId);
  if (!row) {
    throw new ProductionIngestionWriteError(
      "RequirementEvidence Snapshot must be traceable to the Fact OpportunityVersion"
    );
  }
}

function requireRequirementFactOpportunityVersion(
  database: DatabaseSync,
  requirementFactId: string,
  opportunityVersionId: string
) {
  const row = database.prepare(`
    SELECT 1 AS present
    FROM ingestion_requirement_facts
    WHERE requirement_fact_id = ? AND opportunity_version_id = ?
    LIMIT 1
  `).get(requirementFactId, opportunityVersionId);
  if (!row) {
    throw new ProductionIngestionWriteError(
      "EligibilityAssessment RequirementFact must belong to the assessed OpportunityVersion"
    );
  }
}

function requireEligibilityEvidenceFact(
  database: DatabaseSync,
  requirementEvidenceId: string,
  requirementFactIds: readonly string[]
) {
  const row = database.prepare(`
    SELECT requirement_fact_id
    FROM ingestion_requirement_evidence
    WHERE requirement_evidence_id = ?
    LIMIT 1
  `).get(requirementEvidenceId) as { requirement_fact_id: string } | undefined;
  if (!row || !requirementFactIds.includes(row.requirement_fact_id)) {
    throw new ProductionIngestionWriteError(
      "EligibilityAssessment Evidence must support one of its RequirementFacts"
    );
  }
}

function failIfRequested(options: ProductionWriteOptions, stage: ProductionIngestionWriteStage) {
  if (options.fail_after === stage) {
    throw new ProductionIngestionWriteError(`Injected ${stage} stage failure for recovery verification`);
  }
}

function summarizeStatus(statuses: readonly ProductionIngestionWriteStatus[]): ProductionIngestionWriteStatus {
  if (statuses.length === 0 || statuses.every((status) => status === "IDENTITY_UNCERTAIN")) {
    return "IDENTITY_UNCERTAIN";
  }
  if (statuses.some((status) => status === "UPDATED")) return "UPDATED";
  if (statuses.every((status) => status === "UNCHANGED")) return "UNCHANGED";
  return "CREATED";
}

function orderedStages(stages: ReadonlySet<ProductionIngestionWriteStage>) {
  const order: readonly ProductionIngestionWriteStage[] = [
    "SOURCE", "AUTHORIZATION", "COLLECTION_RUN", "RAW", "SNAPSHOT",
    "EXTRACTED_RECORD", "OCCURRENCE", "CANONICAL", "REQUIREMENT", "ELIGIBILITY"
  ];
  return order.filter((stage) => stages.has(stage));
}

function distinct(values: readonly string[]) {
  return [...new Set(values)];
}

function json(value: unknown) {
  return JSON.stringify(value);
}
