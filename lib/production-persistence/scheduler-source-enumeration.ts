import { canonicalHash, canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import {
  continuousTime,
  replayContinuousRecords,
  reserveContinuousRecord,
  type ContinuousRecord,
  type ContinuousScope
} from "../application/source-admission/continuous-acquisition";
import type { SourcePersistenceVersion } from "./contracts";
import { resolveContinuousSourceContext } from "./continuous-source-context";
import type { SchedulerDeferredSource, SchedulerDeferredReason } from "./scheduler-batch-manifest";

export interface ScheduledSource {
  readonly source_definition_id: string;
  readonly recruitment_endpoint_id: string;
  readonly source_admission_id: string;
  readonly authorization_id: string;
  readonly adapter_key: string;
  readonly exact_url: string;
}

export function enumerateScheduledSources(
  versions: readonly SourcePersistenceVersion[],
  records: readonly ContinuousRecord[],
  at: string,
  scope: ContinuousScope
): { readonly eligible: readonly ScheduledSource[]; readonly deferred: readonly SchedulerDeferredSource[] } {
  continuousTime(at);
  replayContinuousRecords(records, bindings => resolveContinuousSourceContext(versions, bindings));
  const latestGrants = new Map(records.filter(record => record.kind === "GRANT")
    .map(record => [record.payload.grant!.authorization_id, record.payload.grant!] as const));
  const revoked = new Set(records.filter(record => record.kind === "REVOKE")
    .map(record => record.payload.authorization_id));
  const eligible: ScheduledSource[] = [];
  const deferred: SchedulerDeferredSource[] = [];
  for (const grant of [...latestGrants.values()].sort((left, right) =>
    left.authorization_id.localeCompare(right.authorization_id))) {
    if (revoked.has(grant.authorization_id) || grant.canonical_payload.scope !== scope) continue;
    const context = resolveContinuousSourceContext(versions, grant.canonical_payload.bindings.target.id);
    if (canonicalSerialize(context.bindings) !== canonicalSerialize(grant.canonical_payload.bindings)) continue;
    const target = {
      source_definition_id: context.source.source_definition_id,
      recruitment_endpoint_id: context.endpoint.recruitment_endpoint_id,
      source_admission_id: context.admission.source_admission_id,
      authorization_id: grant.authorization_id,
      adapter_key: context.endpoint.adapter_key,
      exact_url: grant.canonical_payload.exact_endpoint
    };
    try {
      reserveContinuousRecord(records, grant.authorization_id, context,
        { locator: target.exact_url, method: "GET", headers: {}, parameters: {} },
        `scheduler-enumeration:${canonicalHash({ authorization_id: grant.authorization_id, at })}`,
        "scheduler-enumeration", at, scope);
      eligible.push(target);
    } catch (error) {
      const reason = deferredReason(error);
      if (!reason) throw error;
      deferred.push({ source_definition_id: target.source_definition_id,
        recruitment_endpoint_id: target.recruitment_endpoint_id,
        authorization_id: target.authorization_id, reason });
    }
  }
  return { eligible: structuredClone(eligible), deferred: structuredClone(deferred) };
}

function deferredReason(error: unknown): SchedulerDeferredReason | null {
  if (!(error instanceof Error)) return null;
  if (error.message === "CADENCE_EXCEEDED_OR_CLOCK_INVALID") return "CADENCE_DENIED";
  if (error.message === "PENDING_GATE_DENIED") return "PENDING_GATE_DENIED";
  if (error.message === "AUTHORIZATION_NOT_EFFECTIVE") return "AUTHORIZATION_NOT_EFFECTIVE";
  if (error.message === "AUTHORIZATION_REVOKED") return "AUTHORIZATION_REVOKED";
  return null;
}
