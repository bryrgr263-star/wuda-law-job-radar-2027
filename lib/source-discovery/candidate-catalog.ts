import { canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import { verifyDiscoveryRecord, type DiscoveryKind, type DiscoveryRecord } from "./contracts";

export class DiscoveryCatalog {
  private readonly records = new Map<string, DiscoveryRecord>();

  append(record: DiscoveryRecord): "APPENDED" | "IDEMPOTENT" {
    verifyDiscoveryRecord(record);
    const existing = this.records.get(record.record_id);
    if (existing) {
      if (canonicalSerialize(existing) !== canonicalSerialize(record)) throw new Error("DISCOVERY_COLLISION");
      return "IDEMPOTENT";
    }
    if (record.revision > 1 && !this.records.has(`${record.logical_id}:${record.revision - 1}`)) {
      throw new Error("DISCOVERY_REVISION_GAP");
    }
    for (const reference of record.upstream) {
      if (this.records.get(reference.record_id)?.integrity_hash !== reference.integrity_hash) {
        throw new Error("DISCOVERY_UPSTREAM_INVALID");
      }
    }
    this.records.set(record.record_id, structuredClone(record));
    return "APPENDED";
  }

  list(kind?: DiscoveryKind): DiscoveryRecord[] {
    return [...this.records.values()].filter(record => !kind || record.kind === kind).map(record => structuredClone(record));
  }
}
