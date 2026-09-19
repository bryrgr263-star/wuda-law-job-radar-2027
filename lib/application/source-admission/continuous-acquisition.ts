import { canonicalHash, canonicalSerialize } from "../../ingestion/normalization/canonical-artifact-registry";
import type { SourceDefinition, RecruitmentEndpoint } from "../../ingestion/domain/source";
import type { SourceAdmission } from "./types";

export const CONTINUOUS_MODE = "REVOCABLE_CONTINUOUS_UNATTENDED_ACQUISITION" as const;
export type ContinuousScope = "PRODUCTION" | "CONTROLLED_TEST";
export interface ContinuousArtifactReference {
  readonly id: string;
  readonly artifact_id: string;
  readonly revision: number;
  readonly semantic_hash: string;
}
export interface ContinuousBindings {
  readonly source: ContinuousArtifactReference;
  readonly admission: ContinuousArtifactReference;
  readonly endpoint: ContinuousArtifactReference;
  readonly target: ContinuousArtifactReference;
}
export interface ContinuousSourceContext {
  readonly bindings: ContinuousBindings;
  readonly source: SourceDefinition;
  readonly admission: SourceAdmission;
  readonly endpoint: RecruitmentEndpoint;
  readonly target: Readonly<Record<string, unknown>>;
}
export interface ContinuousGrantPayload {
  readonly authorization_mode: typeof CONTINUOUS_MODE;
  readonly authorization_basis: "HUMAN_APPROVED_CONTINUOUS_SCOPE";
  readonly scope: ContinuousScope;
  readonly bindings: ContinuousBindings;
  readonly exact_endpoint: string;
  readonly effective_from: string;
  readonly cadence_ceiling: { readonly min_interval_seconds: number };
  readonly network_scope: {
    readonly method: "GET";
    readonly redirect: "DENY";
    readonly cookies: "DENY";
    readonly login: "DENY";
    readonly captcha: "DENY";
    readonly interaction: "DENY";
    readonly discovery: "DENY";
  };
}
export interface ContinuousAcquisitionAuthorization {
  readonly authorization_id: string;
  readonly authorization_version: number;
  readonly canonical_payload: ContinuousGrantPayload;
  readonly canonical_payload_hash: string;
  readonly integrity_seal: string;
  readonly issuance_envelope: {
    readonly actor: string;
    readonly issued_at: string;
    readonly approval_review_id: string;
    readonly approval_evidence: readonly { readonly id: string; readonly hash: string }[];
  };
}
export interface ContinuousRecord {
  readonly schema_version: "continuous-admission-record/1.0.0";
  readonly record_id: string;
  readonly sequence: number;
  readonly previous_hash: string | null;
  readonly kind: "GRANT" | "REVOKE" | "RESERVE" | "COMPLETE" | "RECOVER";
  readonly payload: {
    readonly grant?: ContinuousAcquisitionAuthorization;
    readonly authorization_id?: string;
    readonly authorization_version?: number;
    readonly attempt_id?: string;
    readonly holder?: string;
    readonly target_key?: string;
    readonly at?: string;
    readonly actor?: string;
    readonly reference?: string;
    readonly outcome?: "SUCCESS" | "FAILED" | "FENCED_UNKNOWN";
    readonly min_interval_seconds?: number;
    readonly fencing_evidence?: Readonly<Record<string, unknown>>;
  };
  readonly integrity_hash: string;
}
export type ContinuousContextResolver = (bindings: ContinuousBindings) => ContinuousSourceContext;
export type ContinuousFencingVerifier = (attempt: ContinuousRecord, evidence: Readonly<Record<string, unknown>>) => boolean;
export interface ContinuousIssueCommand {
  readonly effective_from: string;
  readonly min_interval_seconds: number;
  readonly actor: string;
  readonly issued_at: string;
}

export function continuousTime(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) throw new Error("CLOCK_OR_TIMESTAMP_INVALID");
  return result;
}
function text(value: string | undefined): string {
  if (!value?.trim()) throw new Error("CONTINUOUS_REQUIRED_FIELD_MISSING");
  return value;
}
function interval(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("CADENCE_INVALID");
  return value;
}
export function validateContinuousContext(context: ContinuousSourceContext) {
  const { bindings, source, admission, endpoint, target } = context;
  if (bindings.source.id !== source.source_definition_id || bindings.source.semantic_hash !== canonicalHash(source)
    || bindings.admission.id !== admission.source_admission_id || bindings.admission.semantic_hash !== canonicalHash(admission)
    || bindings.endpoint.id !== endpoint.recruitment_endpoint_id || bindings.endpoint.semantic_hash !== canonicalHash(endpoint)
    || bindings.target.id !== target.allowlist_entry_id || bindings.target.semantic_hash !== canonicalHash(target)
    || Object.values(bindings).some(ref => !ref.artifact_id || !Number.isSafeInteger(ref.revision) || ref.revision < 1)
    || endpoint.source_definition_id !== source.source_definition_id
    || admission.recruitment_endpoint_id !== endpoint.recruitment_endpoint_id
    || target.recruitment_endpoint_artifact_id !== bindings.endpoint.artifact_id
    || target.source_admission_artifact_id !== bindings.admission.artifact_id) throw new Error("SOURCE_BINDING_INVALID");
  if (!source.enabled || !endpoint.enabled || !target.active || source.authority_level !== "OFFICIAL"
    || admission.admission_decision !== "APPROVED" || admission.automation_basis !== "HUMAN_APPROVED_CONTINUOUS_SCOPE"
    || admission.login_requirement !== "NONE" || admission.captcha !== "NONE_OBSERVED"
    || [admission.robots.status, admission.terms.status].some(status => status === "DISALLOWED" || status === "PROHIBITED")) {
    throw new Error("ADMISSION_CONTINUOUS_DENIED");
  }
  const scope = admission.continuous_acquisition_scope;
  const entry = scope?.exact_targets.find(item => item.allowlist_entry_id === target.allowlist_entry_id);
  if (!scope || !entry || !["PRODUCTION", "CONTROLLED_TEST"].includes(scope.scope)) throw new Error("EXACT_TARGET_NOT_APPROVED");
  const url = new URL(entry.exact_url);
  if (url.href !== entry.exact_url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || target.scheme !== "https" || target.host !== url.hostname || target.port !== (url.port ? Number(url.port) : null)
    || target.exact_path !== true || target.path_prefix !== url.pathname || target.allowed_method !== "GET"
    || canonicalSerialize(target.query_policy) !== canonicalSerialize({ mode: "DENY_ALL", allowed_parameters: [] })
    || endpoint.request_method !== "GET" || endpoint.collection_config.follow_redirects !== false) throw new Error("EXACT_NETWORK_SCOPE_INVALID");
  const review = admission.review_records.find(item => item.source_admission_review_id === scope.approval_review_id);
  if (!review || review.decision !== "APPROVED" || !review.reviewer.trim()) throw new Error("APPROVAL_EVIDENCE_MISSING");
  const approvalIds = target.approval_evidence_ids;
  if (target.authority_level !== "OFFICIAL" || target.endpoint_purpose !== admission.endpoint_purpose
    || !Array.isArray(approvalIds)
    || review.evidence_ids.some(id => !approvalIds.includes(id))) throw new Error("APPROVAL_BINDING_INVALID");
  const evidence = review.evidence_ids.map(id => admission.evidence.find(item => item.source_admission_evidence_id === id));
  if (evidence.some(item => !item) || !evidence.some(item => item?.kind === "MANUAL_REVIEW" && item.decision === "ALLOWED")) {
    throw new Error("APPROVAL_EVIDENCE_MISSING");
  }
  interval(scope.min_interval_seconds);
  continuousTime(scope.effective_from);
  return { scope, review, exact_url: entry.exact_url };
}

function grantFor(context: ContinuousSourceContext, command: ContinuousIssueCommand, version: number): ContinuousAcquisitionAuthorization {
  const approved = validateContinuousContext(context);
  if (interval(command.min_interval_seconds) < approved.scope.min_interval_seconds
    || continuousTime(command.effective_from) < continuousTime(approved.scope.effective_from)) throw new Error("APPROVAL_SCOPE_EXCEEDED");
  continuousTime(command.issued_at);
  const payload: ContinuousGrantPayload = {
    authorization_mode: CONTINUOUS_MODE, authorization_basis: "HUMAN_APPROVED_CONTINUOUS_SCOPE",
    scope: approved.scope.scope, bindings: structuredClone(context.bindings), exact_endpoint: approved.exact_url,
    effective_from: command.effective_from, cadence_ceiling: { min_interval_seconds: command.min_interval_seconds },
    network_scope: { method: "GET", redirect: "DENY", cookies: "DENY", login: "DENY", captcha: "DENY", interaction: "DENY", discovery: "DENY" }
  };
  const authorizationId = "continuous-authorization:" + canonicalHash({ source: context.bindings.source.id,
    endpoint: context.bindings.endpoint.id, target: context.bindings.target.id, exact_url: approved.exact_url, mode: CONTINUOUS_MODE, scope: payload.scope });
  const payloadHash = canonicalHash(payload);
  const envelope = {
    actor: text(command.actor), issued_at: command.issued_at, approval_review_id: approved.review.source_admission_review_id,
    approval_evidence: approved.review.evidence_ids.map(id => ({ id, hash: canonicalHash(context.admission.evidence.find(item => item.source_admission_evidence_id === id)) }))
  };
  return { authorization_id: authorizationId, authorization_version: version, canonical_payload: payload,
    canonical_payload_hash: payloadHash, integrity_seal: canonicalHash({ authorization_id: authorizationId, version, payload_hash: payloadHash }), issuance_envelope: envelope };
}

export function sealContinuousRecord(records: readonly ContinuousRecord[], kind: ContinuousRecord["kind"], identity: string, payload: ContinuousRecord["payload"]): ContinuousRecord {
  const content = { schema_version: "continuous-admission-record/1.0.0" as const,
    record_id: `continuous-record:${kind}:${canonicalHash(identity)}`, sequence: records.length + 1,
    previous_hash: records.at(-1)?.integrity_hash ?? null, kind, payload: structuredClone(payload) };
  return { ...content, integrity_hash: canonicalHash(content) };
}
export function assertContinuousRecord(record: ContinuousRecord) {
  const { integrity_hash: hash, ...content } = record;
  if (record.schema_version !== "continuous-admission-record/1.0.0" || hash !== canonicalHash(content)) throw new Error("CONTINUOUS_RECORD_INTEGRITY_INVALID");
}
export function currentContinuousGrant(records: readonly ContinuousRecord[], id: string) {
  const grant = records.filter(record => record.kind === "GRANT" && record.payload.grant?.authorization_id === id).at(-1)?.payload.grant;
  if (!grant) throw new Error("AUTHORIZATION_MISSING");
  return structuredClone(grant);
}
export function pendingContinuousAttempt(records: readonly ContinuousRecord[]) {
  const closed = new Set(records.filter(record => record.kind === "COMPLETE" || record.kind === "RECOVER").map(record => record.payload.attempt_id));
  return structuredClone(records.find(record => record.kind === "RESERVE" && !closed.has(record.payload.attempt_id)) ?? null);
}
export function issueContinuousRecord(records: readonly ContinuousRecord[], context: ContinuousSourceContext, command: ContinuousIssueCommand) {
  const proposed = grantFor(context, command, 1);
  if (records.some(record => record.kind === "REVOKE" && record.payload.authorization_id === proposed.authorization_id)) throw new Error("AUTHORIZATION_REVOKED");
  const prior = records.filter(record => record.kind === "GRANT" && record.payload.grant?.authorization_id === proposed.authorization_id).at(-1);
  if (prior?.payload.grant?.canonical_payload_hash === proposed.canonical_payload_hash) return structuredClone(prior);
  if (pendingContinuousAttempt(records)) throw new Error("PENDING_GATE_DENIED");
  const grant = grantFor(context, command, (prior?.payload.grant?.authorization_version ?? 0) + 1);
  return sealContinuousRecord(records, "GRANT", `${grant.authorization_id}:${grant.authorization_version}`, { grant });
}
export function revokeContinuousRecord(records: readonly ContinuousRecord[], id: string, actor: string, at: string, reference: string) {
  const prior = records.find(record => record.kind === "REVOKE" && record.payload.authorization_id === id);
  if (prior) return structuredClone(prior);
  const grant = currentContinuousGrant(records, id);
  if (pendingContinuousAttempt(records)) throw new Error("PENDING_GATE_DENIED");
  continuousTime(at);
  return sealContinuousRecord(records, "REVOKE", id, { authorization_id: id, authorization_version: grant.authorization_version, actor: text(actor), at, reference: text(reference) });
}
export function reserveContinuousRecord(records: readonly ContinuousRecord[], id: string, context: ContinuousSourceContext,
  request: { locator: string; method: string | null; headers: Readonly<Record<string, string>>; parameters: Readonly<Record<string, unknown>>; body?: Uint8Array },
  attemptId: string, holder: string, at: string, scope: ContinuousScope) {
  const grant = currentContinuousGrant(records, id);
  const approved = validateContinuousContext(context);
  if (canonicalSerialize(grant.canonical_payload.bindings) !== canonicalSerialize(context.bindings)) throw new Error("REAUTHORIZE_REQUIRED");
  if (grant.canonical_payload.scope !== scope) throw new Error("AUTHORIZATION_SCOPE_MISMATCH");
  if (records.some(record => record.kind === "REVOKE" && record.payload.authorization_id === id)) throw new Error("AUTHORIZATION_REVOKED");
  const now = continuousTime(at);
  const previousAt = records.filter(record => record.payload.at).at(-1)?.payload.at;
  if (previousAt && now < continuousTime(previousAt)) throw new Error("CLOCK_OR_TIMESTAMP_INVALID");
  if (now < continuousTime(grant.canonical_payload.effective_from)) throw new Error("AUTHORIZATION_NOT_EFFECTIVE");
  if (request.locator !== approved.exact_url || request.method !== "GET" || request.body !== undefined
    || Object.keys(request.headers).length || Object.keys(request.parameters).length) throw new Error("EXACT_REQUEST_DENIED");
  if (pendingContinuousAttempt(records)) throw new Error("PENDING_GATE_DENIED");
  if (records.some(record => record.payload.attempt_id === attemptId)) throw new Error("ATTEMPT_ALREADY_USED");
  const targetKey = canonicalHash({ exact_url: approved.exact_url, method: "GET" });
  const last = records.filter(record => (record.kind === "COMPLETE" || record.kind === "RECOVER") && record.payload.target_key === targetKey).at(-1);
  const minimum = grant.canonical_payload.cadence_ceiling.min_interval_seconds;
  if (last && now < continuousTime(text(last.payload.at)) + Math.max(minimum, last.payload.min_interval_seconds!) * 1000) throw new Error("CADENCE_EXCEEDED_OR_CLOCK_INVALID");
  return sealContinuousRecord(records, "RESERVE", text(attemptId), { authorization_id: id, authorization_version: grant.authorization_version,
    attempt_id: attemptId, holder: text(holder), target_key: targetKey, at, min_interval_seconds: minimum });
}
export function closeContinuousRecord(records: readonly ContinuousRecord[], attemptId: string, holder: string, at: string,
  outcome: "SUCCESS" | "FAILED" | "FENCED_UNKNOWN", evidence?: Readonly<Record<string, unknown>>, verifier?: ContinuousFencingVerifier) {
  const pending = pendingContinuousAttempt(records);
  if (!pending || pending.payload.attempt_id !== attemptId || pending.payload.holder !== holder) throw new Error("GATE_HOLDER_MISMATCH");
  if (continuousTime(at) < continuousTime(text(pending.payload.at))) throw new Error("CLOCK_OR_TIMESTAMP_INVALID");
  if (outcome === "FENCED_UNKNOWN" && (!evidence || !verifier?.(pending, evidence))) throw new Error("FENCING_NOT_VERIFIED");
  return sealContinuousRecord(records, outcome === "FENCED_UNKNOWN" ? "RECOVER" : "COMPLETE", attemptId,
    { attempt_id: attemptId, holder, target_key: pending.payload.target_key, at, outcome,
      min_interval_seconds: pending.payload.min_interval_seconds, ...(outcome === "FENCED_UNKNOWN" ? { fencing_evidence: evidence } : {}) });
}

export function replayContinuousRecords(records: readonly ContinuousRecord[], resolve: ContinuousContextResolver, verifier?: ContinuousFencingVerifier) {
  const replayed: ContinuousRecord[] = [];
  for (const record of records) {
    assertContinuousRecord(record);
    const payload = record.payload;
    let expected: ContinuousRecord;
    if (record.kind === "GRANT" && payload.grant) {
      const grant = payload.grant;
      expected = issueContinuousRecord(replayed, resolve(grant.canonical_payload.bindings), {
        effective_from: grant.canonical_payload.effective_from, min_interval_seconds: grant.canonical_payload.cadence_ceiling.min_interval_seconds,
        actor: grant.issuance_envelope.actor, issued_at: grant.issuance_envelope.issued_at });
    } else if (record.kind === "REVOKE") {
      expected = revokeContinuousRecord(replayed, text(payload.authorization_id), text(payload.actor), text(payload.at), text(payload.reference));
    } else if (record.kind === "RESERVE") {
      const grant = currentContinuousGrant(replayed, text(payload.authorization_id));
      expected = reserveContinuousRecord(replayed, grant.authorization_id, resolve(grant.canonical_payload.bindings),
        { locator: grant.canonical_payload.exact_endpoint, method: "GET", headers: {}, parameters: {} },
        text(payload.attempt_id), text(payload.holder), text(payload.at), grant.canonical_payload.scope);
    } else if (record.kind === "COMPLETE" || record.kind === "RECOVER") {
      if (record.kind === "COMPLETE" && payload.outcome !== "SUCCESS" && payload.outcome !== "FAILED") throw new Error("ATTEMPT_OUTCOME_INVALID");
      expected = closeContinuousRecord(replayed, text(payload.attempt_id), text(payload.holder), text(payload.at),
        record.kind === "RECOVER" ? "FENCED_UNKNOWN" : payload.outcome!, payload.fencing_evidence, verifier);
    } else throw new Error("CONTINUOUS_RECORD_KIND_INVALID");
    if (canonicalSerialize(expected) !== canonicalSerialize(record) || replayed.some(item => item.record_id === record.record_id)) throw new Error("CONTINUOUS_REPLAY_OR_COLLISION_INVALID");
    replayed.push(structuredClone(record));
  }
  return replayed;
}
