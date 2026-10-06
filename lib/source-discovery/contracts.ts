import { canonicalHash } from "../ingestion/normalization/canonical-artifact-registry";

export const DISCOVERY_KINDS = ["SEED", "OBSERVATION", "CANDIDATE", "VERIFICATION", "RUN"] as const;
export type DiscoveryKind = (typeof DISCOVERY_KINDS)[number];
export interface DiscoveryRecord {
  schema: "discovery-v1";
  kind: DiscoveryKind;
  logical_id: string;
  revision: number;
  record_id: string;
  upstream: { record_id: string; integrity_hash: string }[];
  payload: Record<string, unknown>;
  integrity_hash: string;
}

export function createDiscoveryRecord(
  kind: DiscoveryKind, logicalId: string, payload: Record<string, unknown>,
  upstream: DiscoveryRecord[] = [], revision = 1
): DiscoveryRecord {
  const content = {
    schema: "discovery-v1" as const, kind, logical_id: logicalId, revision,
    record_id: `${logicalId}:${revision}`,
    upstream: upstream.map(record => ({ record_id: record.record_id, integrity_hash: record.integrity_hash })),
    payload: structuredClone(payload)
  };
  return { ...content, integrity_hash: canonicalHash(content) };
}

export function verifyDiscoveryRecord(record: DiscoveryRecord): void {
  const { integrity_hash: integrityHash, ...content } = record;
  if (record.schema !== "discovery-v1" || !DISCOVERY_KINDS.includes(record.kind)
    || !record.logical_id.startsWith("discovery:") || !Number.isSafeInteger(record.revision)
    || record.revision < 1 || record.record_id !== `${record.logical_id}:${record.revision}`
    || canonicalHash(content) !== integrityHash) throw new Error("DISCOVERY_INTEGRITY_INVALID");
}
