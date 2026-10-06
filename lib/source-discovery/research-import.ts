import { createHash } from "node:crypto";
import { canonicalHash } from "../ingestion/normalization/canonical-artifact-registry";
import { createDiscoveryRecord, type DiscoveryRecord } from "./contracts";

export function importHistoricalResearch(bytes: string): DiscoveryRecord[] {
  const pool = JSON.parse(bytes);
  if (pool.schema_version !== "source-discovery-phase-1-v1" || !Array.isArray(pool.sources)
    || !pool.field_defaults || typeof pool.as_of !== "string") throw new Error("RESEARCH_SCHEMA_INVALID");
  const blobHash = createHash("sha256").update(bytes, "utf8").digest("hex");
  const records: DiscoveryRecord[] = [];
  const seen = new Set<string>();
  for (const entry of pool.sources) {
    if (typeof entry.id !== "string" || seen.has(entry.id)) throw new Error("RESEARCH_ID_INVALID");
    seen.add(entry.id);
    const identity = canonicalHash({ version: 1, research_id: entry.id, blob_hash: blobHash });
    const effective = { ...pool.field_defaults, ...entry };
    const origins = Object.fromEntries(Object.keys(effective).map(field => [field,
      Object.hasOwn(entry, field) ? "ENTRY" : "FIELD_DEFAULTS"]));
    const seed = createDiscoveryRecord("SEED", `discovery:seed:${identity}`, {
      provenance_kind: "IMPORTED_RESEARCH", research_id: entry.id, source_blob_sha256: blobHash,
      captured_at: pool.as_of, historical_entry: entry, historical_defaults: pool.field_defaults,
      effective_claims: effective, field_origins: origins
    });
    const observation = createDiscoveryRecord("OBSERVATION", `discovery:observation:${identity}`, {
      provenance_kind: "IMPORTED_RESEARCH", source_url: effective.source_url,
      captured_at: pool.as_of, historical_claims: effective, network_performed: false
    }, [seed]);
    const candidate = createDiscoveryRecord("CANDIDATE", `discovery:candidate:${identity}`, {
      provenance_kind: "IMPORTED_RESEARCH", employer_claim: effective.employer_name,
      publisher_identity: "UNRESOLVED", recruitment_owner_identity: "UNRESOLVED",
      hosting_platform_identity: "UNRESOLVED", recruitment_entry_url: effective.recruitment_entry_url,
      officiality: "UNRESOLVED", recruitment_year_signal: "NOT_OBSERVED", legal_signal: "NOT_OBSERVED",
      historical_claims: effective, disposition: "PENDING_VERIFICATION", production_admission_status: "NOT_SUBMITTED"
    }, [observation]);
    records.push(seed, observation, candidate);
  }
  return records;
}
