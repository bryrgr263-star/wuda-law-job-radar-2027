import { assertSupportingInspectionExecution, replaySupportingInspections,
  type SupportingInspectionContext, type SupportingInspectionExecution } from "../application/source-admission/supporting-inspection";
import { validateSourceAdmission } from "../application/source-admission/source-admission-register";
import { assertOfficialRequestAllowed, assertSourcePersistenceVersion, type SourcePersistenceVersion } from "./contracts";

export function supportingInspectionReplay(versions: readonly SourcePersistenceVersion[]) {
  const records: SupportingInspectionExecution[] = [];
  const contexts: (SupportingInspectionContext | undefined)[] = [];
  const previous: SourcePersistenceVersion[] = [];
  const streams = new Map<string, SourcePersistenceVersion>();
  for (const version of versions) {
    if (version.artifact.kind === "SUPPORTING_INSPECTION_EXECUTION") {
      assertSourcePersistenceVersion(version);
      const record = version.artifact.payload;
      assertSupportingInspectionExecution(record);
      const prior = streams.get(version.stream_id);
      if (version.revision !== (prior?.revision ?? 0) + 1
        || version.supersedes_artifact_id !== (prior?.artifact_id ?? null)) throw new Error("SUPPORTING_INSPECTION_REVISION_DENIED");
      const eventAt = record.state === "CLAIMED" ? record.claimed_at
        : record.state === "RECEIPT" ? record.receipt.response_received_at : record.unknown.recorded_at;
      if (!Number.isFinite(Date.parse(version.created_at)) || !Number.isFinite(Date.parse(version.effective_at))
        || Date.parse(version.effective_at) < Date.parse(eventAt)
        || Date.parse(version.created_at) < Date.parse(version.effective_at)) throw new Error("SUPPORTING_INSPECTION_TIME_DENIED");
      records.push(record);
      contexts.push(record.state === "CLAIMED" ? resolveContext(record, previous) : undefined);
      streams.set(version.stream_id, version);
    }
    previous.push(version);
  }
  const resolve = (_record: SupportingInspectionExecution, index: number) => {
    const context = contexts[index];
    if (!context) throw new Error("SUPPORTING_INSPECTION_CONTEXT_DENIED");
    return context;
  };
  const current = replaySupportingInspections(records, resolve);
  return { records, resolve, current };
}

function resolveContext(record: SupportingInspectionExecution, versions: readonly SourcePersistenceVersion[]): SupportingInspectionContext {
  const exact = (id: string) => {
    const matches = versions.filter(version => version.artifact_id === id);
    if (matches.length !== 1) throw new Error("SUPPORTING_INSPECTION_SOURCE_REFERENCE_DENIED");
    const found = matches[0]!;
    assertSourcePersistenceVersion(found);
    const latest = versions.filter(version => version.artifact.kind === found.artifact.kind && version.stream_id === found.stream_id).at(-1);
    if (latest?.artifact_id !== found.artifact_id || !Number.isFinite(Date.parse(found.effective_at))
      || !Number.isFinite(Date.parse(found.created_at)) || Date.parse(found.effective_at) > Date.parse(record.claimed_at)
      || Date.parse(found.created_at) > Date.parse(record.claimed_at)) throw new Error("SUPPORTING_INSPECTION_STALE_SOURCE_DENIED");
    return found;
  };
  const bindings = record.bindings;
  const sourceVersion = exact(bindings.source_artifact_id);
  const endpointVersion = exact(bindings.endpoint_artifact_id);
  const admissionVersion = exact(bindings.admission_artifact_id);
  const allowlistVersion = exact(bindings.allowlist_artifact_id);
  const adapterVersion = exact(bindings.adapter_artifact_id);
  if (sourceVersion.artifact.kind !== "SOURCE_DEFINITION" || endpointVersion.artifact.kind !== "RECRUITMENT_ENDPOINT"
    || admissionVersion.artifact.kind !== "SOURCE_ADMISSION" || allowlistVersion.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST"
    || adapterVersion.artifact.kind !== "ADAPTER_REGISTRATION") throw new Error("SUPPORTING_INSPECTION_SOURCE_KIND_DENIED");
  const source = sourceVersion.artifact.payload;
  const endpoint = endpointVersion.artifact.payload;
  const admission = admissionVersion.artifact.payload;
  const allowlist = allowlistVersion.artifact.payload;
  const adapter = adapterVersion.artifact.payload;
  validateSourceAdmission(admission);
  if (allowlist.query_policy.mode !== "FINITE_VALUES" || !allowlist.exact_path
    || allowlist.recruitment_endpoint_artifact_id !== endpointVersion.artifact_id
    || allowlist.source_admission_artifact_id !== admissionVersion.artifact_id
    || allowlist.authority_level !== source.authority_level || allowlist.endpoint_purpose !== admission.endpoint_purpose
    || !allowlist.approval_evidence_ids.includes(record.authorization.evidence_id)
    || endpoint.adapter_key !== adapter.adapter_key || !adapter.supported_content_kinds.includes(endpoint.content_kind)
    || endpoint.locator !== record.exact_url) throw new Error("SUPPORTING_INSPECTION_ALLOWLIST_DENIED");
  assertOfficialRequestAllowed(allowlist, record.exact_url, record.method);
  return { source, endpoint, admission, bindings: structuredClone(bindings), query_contract: allowlist.query_policy.contract };
}
