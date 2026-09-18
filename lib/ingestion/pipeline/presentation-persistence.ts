import type {
  PresentationDecision,
  PresentationDecisionId,
  PresentationReadModel
} from "../domain";
import type { PresentationPersistenceRepository, PresentationReadRepository, PresentationCurrentSnapshot, PresentationRetainedReference, PresentationMigrationBlockedReference } from "../persistence";
import { PRESENTATION_DECISION_V2_SCHEMA_VERSION, PRESENTATION_READ_MODEL_V2_SCHEMA_VERSION,
  type PresentationMigrationAudit,
  type PositionPresentationDecisionV2, type PresentationScope } from "../domain";
import { canonicalHash, canonicalSerialize } from "../normalization/canonical-artifact-registry";
import {
  assertPresentationDecisionIntegrity,
  assertPresentationMigrationIntegrity,
  assertTrustedPresentationDecisionResolver,
  type TrustedPresentationDecisionResolver
} from "./presentation-decision";
import {
  assertPresentationReadModelIntegrity,
  assertTrustedPresentationReadModelMaterializer,
  type PresentationReadModelMaterializer
} from "./presentation-read-model";

export interface PresentationPersistenceBoundary {
  readonly read_repository: PresentationReadRepository;
  persist(presentationDecisionId: PresentationDecisionId): {
    readonly decision: PresentationDecision;
    readonly read_model: PresentationReadModel;
  };
}

export function createPresentationPersistenceBoundary(options: {
  readonly decisions: TrustedPresentationDecisionResolver;
  readonly materializer: PresentationReadModelMaterializer;
  readonly persistence: PresentationPersistenceRepository;
}): PresentationPersistenceBoundary {
  const decisions = assertTrustedPresentationDecisionResolver(options.decisions);
  const materializer = assertTrustedPresentationReadModelMaterializer(
    options.materializer
  );
  const persistence = options.persistence;

  return Object.freeze({
    read_repository: Object.freeze({
      readCurrentSnapshot() {
        if (!persistence.readPresentationHistory) return persistence.readCurrentSnapshot?.() ?? null;
        const history = persistence.readPresentationHistory();
        for (const decision of history.decisions) {
          const trusted = decisions.resolve(decision.presentation_decision_id);
          if (!trusted || canonicalSerialize(trusted) !== canonicalSerialize(decision)) {
            throw new Error("Derived PresentationDecision differs from the authoritative resolver");
          }
        }
        for (const model of history.read_models) {
          const trusted = materializer.resolve(model.presentation_read_model_id);
          if (!trusted || canonicalSerialize(trusted) !== canonicalSerialize(model)) {
            throw new Error("Derived PresentationReadModel differs from the authoritative resolver");
          }
        }
        for (const audit of history.migration_audits ?? []) {
          const trusted = decisions.resolveMigration(audit.migration_id);
          if (!trusted || canonicalSerialize(trusted) !== canonicalSerialize(audit)) {
            throw new Error("Derived Presentation migration differs from the authoritative resolver");
          }
        }
        const scopes = new Set([...history.decisions.flatMap((decision) => decision.schema_version === PRESENTATION_DECISION_V2_SCHEMA_VERSION ? [decision.scope] : []),
          ...(history.migration_audits ?? []).map((audit) => audit.scope)]);
        if (scopes.size === 0) return null;
        if (scopes.size !== 1) throw new Error("Derived Presentation index scope mixing");
        return buildAuthoritativePresentationCurrentSnapshot({ scope: [...scopes][0],
          authoritative_head: `derived-index:${canonicalHash({ decisions: history.decisions.map((item) => item.integrity_hash).sort(),
            models: history.read_models.map((item) => item.integrity_hash).sort(),
            migrations: (history.migration_audits ?? []).map((audit) => audit.integrity_hash).sort() })}`,
          ...history, candidate_associations: [] });
      },
      async listCurrentReadModels() {
        const snapshot = await this.readCurrentSnapshot();
        return snapshot ? snapshot.current_position_read_models : persistence.listCurrentReadModels();
      }
    }),
    persist(presentationDecisionId: PresentationDecisionId) {
      const decision = decisions.resolve(presentationDecisionId);
      if (!decision) throw new Error("Trusted PresentationDecision is unavailable");
      const sealedDecision = assertPresentationDecisionIntegrity(decision);
      if (sealedDecision.schema_version === PRESENTATION_DECISION_V2_SCHEMA_VERSION
          && sealedDecision.record_kind === "POSITION_PRESENTATION" && sealedDecision.origin === "V1_MIGRATION") {
        const audit = sealedDecision.migration_id ? decisions.resolveMigration(sealedDecision.migration_id) : null;
        if (!audit || !persistence.appendMigrationAudit) throw new Error("Presentation migration audit persistence is unavailable");
        const persisted = persistence.appendMigrationAudit(audit);
        if (canonicalSerialize(persisted) !== canonicalSerialize(audit)) throw new Error("Presentation migration audit persistence mismatch");
      }
      const materialized = materializer.materialize(presentationDecisionId);
      const sealedModel = assertPresentationReadModelIntegrity(materialized.read_model);
      if (sealedModel.presentation_decision_id !== sealedDecision.presentation_decision_id
          || sealedModel.upstream.decision_integrity_hash !== sealedDecision.integrity_hash
          || sealedModel.decision_revision !== sealedDecision.revision
          || sealedModel.position_id !== sealedDecision.position_id
          || sealedModel.presentation_status !== sealedDecision.status) {
        throw new Error("PresentationReadModel does not match sealed PresentationDecision");
      }
      const persistedDecision = assertPresentationDecisionIntegrity(
        persistence.appendDecision(sealedDecision)
      );
      const persistedModel = assertPresentationReadModelIntegrity(
        persistence.appendReadModel(sealedModel)
      );
      if (persistedDecision.integrity_hash !== sealedDecision.integrity_hash
          || persistedModel.integrity_hash !== sealedModel.integrity_hash) {
        throw new Error("Presentation persistence returned a different sealed artifact");
      }
      return {
        decision: persistedDecision,
        read_model: persistedModel
      };
    }
  });
}

export function buildAuthoritativePresentationCurrentSnapshot(input: {
  readonly scope: PresentationScope;
  readonly authoritative_head: string;
  readonly decisions: readonly PresentationDecision[];
  readonly read_models: readonly PresentationReadModel[];
  readonly candidate_associations: readonly { readonly opportunity_candidate_id: string; readonly presentation_decision_id: string }[];
  readonly migration_audits?: readonly PresentationMigrationAudit[];
}): PresentationCurrentSnapshot {
  if (!input.authoritative_head) throw new Error("Presentation current requires an anchored HEAD");
  const decisions = uniqueArtifacts(input.decisions.map(assertPresentationDecisionIntegrity), (item) => item.presentation_decision_id);
  const models = uniqueArtifacts(input.read_models.map(assertPresentationReadModelIntegrity), (item) => item.presentation_read_model_id);
  const migrationAudits = uniqueArtifacts((input.migration_audits ?? []).map(assertPresentationMigrationIntegrity), (audit) => audit.migration_id);
  const blocked: PresentationCurrentSnapshot["migration"]["items"][number][] = [];
  const blockedDetails: PresentationMigrationBlockedReference[] = [];
  const boundV1 = new Map<string, PresentationDecision[]>();
  for (const decision of decisions) {
    if ((decision.schema_version === PRESENTATION_DECISION_V2_SCHEMA_VERSION && decision.scope !== input.scope)
        || (decision.schema_version !== PRESENTATION_DECISION_V2_SCHEMA_VERSION && decision.eligibility_assessment_scope
          && decision.eligibility_assessment_scope !== input.scope)) throw new Error("Presentation current scope mixing");
    if (decision.schema_version !== PRESENTATION_DECISION_V2_SCHEMA_VERSION
      && decision.position_id && decision.decision_basis.candidate_source_binding === "BOUND") {
    boundV1.set(decision.position_id, [...(boundV1.get(decision.position_id) ?? []), decision]);
    }
  }
  for (const audit of migrationAudits) {
    if (audit.scope !== input.scope || !boundV1.has(audit.position_id)) throw new Error("Presentation migration audit has foreign scope or orphan inventory");
  }
  const migrationAssociations: { opportunity_candidate_id: string; presentation_decision_id: string }[] = [];
  for (const [positionId, history] of boundV1) {
    const audits = migrationAudits.filter((audit) => audit.position_id === positionId && audit.scope === input.scope);
    if (audits.length !== 1) throw new Error("Presentation V1 bound inventory requires exactly one verified migration before current activation");
    const audit = audits[0]!;
    if (audit.inventory.length !== history.length || history.some((decision) => !audit.inventory.some((reference) =>
      reference.presentation_decision_id === decision.presentation_decision_id && reference.integrity_hash === decision.integrity_hash))) {
      throw new Error("Presentation migration inventory coverage is incomplete");
    }
    if (audit.classification === "BLOCKED") {
      blocked.push({ position_id: positionId, reason_code: audit.reason_code, migration_id: audit.migration_id,
        anchored_input_head: audit.anchored_input_head, historical_presentation_decision_ids: audit.inventory.map((reference) => reference.presentation_decision_id) });
      for (const candidateId of new Set(history.map((decision) => decision.opportunity_candidate_id))) {
        blockedDetails.push({ record_kind: "MIGRATION_BLOCKED", public_series_member: false,
          migration_id: audit.migration_id, position_id: positionId, opportunity_candidate_id: candidateId,
          historical_presentation_decision_ids: audit.inventory.filter((reference) => history.some((decision) =>
            decision.presentation_decision_id === reference.presentation_decision_id && decision.opportunity_candidate_id === candidateId))
            .map((reference) => reference.presentation_decision_id),
          public_collection_state: "MIGRATION_BLOCKED", reason_code: audit.reason_code });
      }
      if (decisions.some((decision) => decision.schema_version === PRESENTATION_DECISION_V2_SCHEMA_VERSION
          && decision.record_kind === "POSITION_PRESENTATION" && decision.position_id === positionId)) throw new Error("Migration-blocked Position has an unauthorized public head");
    } else {
      const initial = decisions.find((decision) => decision.presentation_decision_id === audit.output_decision_id);
      if (!initial || initial.schema_version !== PRESENTATION_DECISION_V2_SCHEMA_VERSION
          || initial.record_kind !== "POSITION_PRESENTATION" || initial.origin !== "V1_MIGRATION"
          || initial.migration_id !== audit.migration_id || initial.revision !== 1
          || initial.integrity_hash !== audit.output_decision_integrity_hash || initial.semantic_hash !== audit.semantic_hash) {
        throw new Error("Presentation migration output proof mismatch");
      }
      for (const decision of history) migrationAssociations.push({ opportunity_candidate_id: decision.opportunity_candidate_id,
        presentation_decision_id: initial.presentation_decision_id });
    }
  }
  const groups = new Map<string, PositionPresentationDecisionV2[]>();
  const audits: PresentationRetainedReference[] = [];
  for (const decision of decisions) {
    if (decision.schema_version !== PRESENTATION_DECISION_V2_SCHEMA_VERSION) {
      if (decision.position_id && decision.decision_basis.candidate_source_binding === "BOUND") {
        continue;
      }
      audits.push(retainedReference(decision));
      continue;
    }
    if (decision.scope !== input.scope) throw new Error("Presentation current scope mixing");
    if (decision.record_kind === "UNBOUND_RETAINED_OUTCOME") { audits.push(retainedReference(decision)); continue; }
    const group = groups.get(decision.position_id) ?? [];
    group.push(decision);
    groups.set(decision.position_id, group);
  }
  const current: PresentationReadModel[] = [];
  const heads = new Map<string, PresentationReadModel>();
  for (const [positionId, group] of groups) {
    group.sort((left, right) => left.revision - right.revision);
    const migration = migrationAudits.find((audit) => audit.position_id === positionId);
    if (group[0]!.origin === "V1_MIGRATION" ? !migration || migration.classification !== "EQUIVALENT"
      : boundV1.has(positionId) || migration !== undefined) throw new Error("Presentation revision-one origin lacks verified migration proof");
    let predecessor: PositionPresentationDecisionV2 | null = null;
    let matching: PresentationReadModel | null = null;
    for (const decision of group) {
      if (decision.revision !== (predecessor?.revision ?? 0) + 1
          || decision.supersedes_presentation_decision_id !== (predecessor?.presentation_decision_id ?? null)) {
        throw new Error("Presentation current revision gap, branch, or missing predecessor");
      }
      if (predecessor && (decision.origin !== predecessor.origin || decision.migration_id !== predecessor.migration_id)) {
        throw new Error("Presentation revision series changed migration origin");
      }
      if (predecessor && canonicalSerialize(predecessor.semantic_projection) === canonicalSerialize(decision.semantic_projection)) {
        throw new Error("Presentation semantic no-op was improperly reissued as a revision");
      }
      const candidates = models.filter((model) => model.presentation_decision_id === decision.presentation_decision_id);
      if (candidates.length !== 1) throw new Error("Presentation current requires exactly one matching ReadModel per revision");
      matching = candidates[0];
      assertMatchingPresentationReadModel(decision, matching);
      predecessor = decision;
    }
    if (!matching) throw new Error("Presentation current head is unavailable");
    current.push(matching);
    heads.set(positionId, matching);
  }
  for (const model of models) {
    if ((model.schema_version === PRESENTATION_READ_MODEL_V2_SCHEMA_VERSION && model.scope !== input.scope)
        || (model.upstream.eligibility_assessment_scope && model.upstream.eligibility_assessment_scope !== input.scope)) {
      throw new Error("Presentation ReadModel scope mixing");
    }
    const decision = decisions.find((decision) => decision.presentation_decision_id === model.presentation_decision_id);
    if (!decision) {
      throw new Error("Presentation current has an orphan ReadModel");
    }
    if (model.upstream.decision_integrity_hash !== decision.integrity_hash
        || model.position_id !== decision.position_id || model.decision_revision !== decision.revision
        || model.presentation_status !== decision.status || model.opportunity_candidate_id !== decision.opportunity_candidate_id) {
      throw new Error("Presentation audit/history Decision/ReadModel alignment failure");
    }
  }
  const details: Record<string, PresentationReadModel | PresentationRetainedReference | PresentationMigrationBlockedReference> = Object.create(null);
  audits.sort((left, right) => left.audit_outcome_id.localeCompare(right.audit_outcome_id));
  for (const audit of audits) details[audit.opportunity_candidate_id] = audit;
  for (const blockedDetail of blockedDetails) details[blockedDetail.opportunity_candidate_id] = blockedDetail;
  const associations = [...decisions.map((decision) => ({
    opportunity_candidate_id: decision.opportunity_candidate_id,
    presentation_decision_id: decision.presentation_decision_id
  })), ...input.candidate_associations, ...migrationAssociations];
  for (const association of associations) {
    const decision = decisions.find((item) => item.presentation_decision_id === association.presentation_decision_id);
    if (!decision) throw new Error("Presentation association points to a missing artifact");
    if (decision.schema_version !== PRESENTATION_DECISION_V2_SCHEMA_VERSION || decision.record_kind !== "POSITION_PRESENTATION") continue;
    const model = heads.get(decision.position_id);
    if (!model) throw new Error("Presentation association has no validated Position head");
    const previous = details[association.opportunity_candidate_id];
    if (previous && "position_id" in previous && previous.position_id && previous.position_id !== model.position_id) {
      throw new Error("Presentation Candidate association conflicts across Positions");
    }
    details[association.opportunity_candidate_id] = model;
  }
  current.sort((left, right) => right.updated_at.localeCompare(left.updated_at)
    || left.presentation_read_model_id.localeCompare(right.presentation_read_model_id));
  const pending = new Set(audits.filter((audit) => {
    const detail = details[audit.opportunity_candidate_id];
    return detail && "record_kind" in detail && detail.record_kind === "UNBOUND_RETAINED_OUTCOME";
  })
    .map((audit) => audit.opportunity_candidate_id));
  return structuredClone({
    contract_version: "presentation-current-snapshot/2.0.0", authoritative_head: input.authoritative_head, scope: input.scope,
    current_position_read_models: current, candidate_details: details,
    retention: { unbound_outcome_count: audits.length, pending_candidate_count: pending.size, items: audits },
    migration: { blocked_position_count: blocked.length, items: blocked.sort((left, right) => left.position_id.localeCompare(right.position_id)) }
  });
}

export function assertMatchingPresentationReadModel(decision: PositionPresentationDecisionV2, model: PresentationReadModel) {
  if (model.schema_version !== PRESENTATION_READ_MODEL_V2_SCHEMA_VERSION || model.record_kind !== "POSITION_PRESENTATION"
      || model.scope !== decision.scope || model.position_id !== decision.position_id
      || model.decision_revision !== decision.revision || model.presentation_decision_id !== decision.presentation_decision_id
      || model.semantic_hash !== decision.semantic_hash || model.upstream.decision_integrity_hash !== decision.integrity_hash
      || model.presentation_status !== decision.status || model.updated_at !== decision.decided_at
      || canonicalSerialize(model.reason_codes) !== canonicalSerialize(decision.reason_codes)
      || model.policy_id !== decision.policy_id || model.policy_version !== decision.policy_version) {
    throw new Error("Presentation current Decision/ReadModel alignment failure");
  }
  if (model.opportunity_candidate_id !== decision.opportunity_candidate_id
      || model.opportunity_version_id !== decision.opportunity_version_id
      || model.position_version_id !== decision.position_version_id
      || model.upstream.recall_disposition_id !== decision.recall_disposition_id
      || model.upstream.recall_disposition_integrity_hash !== decision.recall_disposition_integrity_hash
      || model.upstream.relevance_assessment_id !== decision.relevance_assessment_id
      || model.upstream.relevance_integrity_hash !== decision.relevance_integrity_hash
      || model.upstream.source_composition_id !== decision.source_composition_id
      || model.upstream.source_composition_hash !== decision.source_composition_hash
      || model.upstream.requirement_set_version_id !== decision.requirement_set_version_id
      || model.upstream.eligibility_assessment_id !== decision.eligibility_assessment_id
      || model.upstream.eligibility_integrity_hash !== decision.eligibility_integrity_hash
      || model.upstream.eligibility_assessment_scope !== decision.eligibility_assessment_scope) {
    throw new Error("Presentation current upstream provenance differs from sealed Decision");
  }
  const fields = ["employer", "position_title", "locations", "recruitment_year", "recruitment_batch",
    "announcement_link", "application_link", "requirement_summary", "effective_at"] as const;
  for (const field of fields) if (canonicalSerialize(model[field]) !== canonicalSerialize(decision.semantic_projection.display[field])) {
    throw new Error("Presentation current display differs from sealed Decision basis");
  }
}
function retainedReference(decision: PresentationDecision): PresentationRetainedReference {
  return { record_kind: "UNBOUND_RETAINED_OUTCOME", public_series_member: false,
    audit_outcome_id: decision.presentation_decision_id, opportunity_candidate_id: decision.opportunity_candidate_id,
    presentation_status: decision.status, reason_codes: [...decision.reason_codes], public_collection_state: "POSITION_BINDING_REQUIRED" };
}
function uniqueArtifacts<Artifact>(artifacts: readonly Artifact[], id: (artifact: Artifact) => string): Artifact[] {
  const unique = new Map<string, Artifact>();
  for (const artifact of artifacts) {
    const existing = unique.get(id(artifact));
    if (existing && canonicalSerialize(existing) !== canonicalSerialize(artifact)) throw new Error("Presentation artifact identity collision");
    unique.set(id(artifact), artifact);
  }
  return [...unique.values()];
}
