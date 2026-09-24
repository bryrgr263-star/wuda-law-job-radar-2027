import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { canonicalDeserialize, canonicalHash, canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import type { ContinuousRecord } from "../application/source-admission/continuous-acquisition";
import type { SourcePersistenceVersion } from "./contracts";
import type { SourceExecutionPlannedTarget } from "./source-execution-request-plan";
import type { SourceExecutionOutcome } from "./source-execution-outcome";

const SCHEMA_VERSION = "source-execution-request-intent/1.0.0" as const;

export interface SourceExecutionRequestIntent {
  readonly schema_version: typeof SCHEMA_VERSION;
  readonly source_execution_id: string;
  readonly source_definition_id: string;
  readonly source_artifact_id: string;
  readonly source_revision: number;
  readonly recruitment_endpoint_id: string;
  readonly endpoint_artifact_id: string;
  readonly source_admission_artifact_id: string;
  readonly targets: readonly Omit<SourceExecutionPlannedTarget, "observations">[];
  readonly integrity_hash: string;
}

export function sealSourceExecutionRequestIntent(input: Omit<SourceExecutionRequestIntent, "schema_version" | "integrity_hash">): SourceExecutionRequestIntent {
  const content = { schema_version: SCHEMA_VERSION, ...structuredClone(input) };
  const intent = { ...content, integrity_hash: canonicalHash(content) };
  assertSourceExecutionRequestIntent(intent);
  return intent;
}

export function writeSourceExecutionRequestIntent(repositoryPath: string, intent: SourceExecutionRequestIntent) {
  assertSourceExecutionRequestIntent(intent);
  const relative = intentPath(intent.source_execution_id);
  const absolute = path.join(repositoryPath, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  const bytes = canonicalSerialize(intent);
  try {
    writeFileSync(absolute, bytes, { encoding: "utf8", flag: "wx" });
    return { relative, appended: true } as const;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (readFileSync(absolute, "utf8") !== bytes) throw new Error("SOURCE_REQUEST_INTENT_COLLISION");
    return { relative, appended: false } as const;
  }
}

export function readSourceExecutionRequestIntents(repositoryPath: string,
  versions: readonly SourcePersistenceVersion[], records: readonly ContinuousRecord[]) {
  const directory = path.join(repositoryPath, "production-runs", "source-request-intents");
  let names: string[];
  try { names = readdirSync(directory).filter(name => name.endsWith(".json")).sort(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const byVersion = new Map(versions.map(version => [version.artifact_id, version]));
  const grants = new Map(records.filter(record => record.kind === "GRANT")
    .map(record => [record.payload.grant!.authorization_id, record.payload.grant!]));
  return names.map(name => {
    const bytes = readFileSync(path.join(directory, name), "utf8");
    const intent = canonicalDeserialize(bytes) as SourceExecutionRequestIntent;
    assertSourceExecutionRequestIntent(intent);
    if (canonicalSerialize(intent) !== bytes || name !== path.basename(intentPath(intent.source_execution_id))) {
      throw new Error("SOURCE_REQUEST_INTENT_BYTES_INVALID");
    }
    const source = byVersion.get(intent.source_artifact_id);
    const endpoint = byVersion.get(intent.endpoint_artifact_id);
    const admission = byVersion.get(intent.source_admission_artifact_id);
    if (source?.artifact.kind !== "SOURCE_DEFINITION" || source.artifact.payload.source_definition_id !== intent.source_definition_id
      || source.artifact.payload.authority_level !== "OFFICIAL" || !source.artifact.payload.enabled
      || source.revision !== intent.source_revision
      || endpoint?.artifact.kind !== "RECRUITMENT_ENDPOINT" || endpoint.artifact.payload.recruitment_endpoint_id !== intent.recruitment_endpoint_id
      || endpoint.artifact.payload.source_definition_id !== intent.source_definition_id || !endpoint.artifact.payload.enabled
      || admission?.artifact.kind !== "SOURCE_ADMISSION" || admission.artifact.payload.recruitment_endpoint_id !== intent.recruitment_endpoint_id
      || canonicalSerialize(intent.targets.map(target => target.exact_url).sort())
        !== canonicalSerialize([...(admission.artifact.payload.continuous_acquisition_scope?.exact_targets.map(target => target.exact_url) ?? [])].sort())) {
      throw new Error("SOURCE_REQUEST_INTENT_UPSTREAM_INVALID");
    }
    for (const target of intent.targets) {
      const version = byVersion.get(target.allowlist_artifact_id);
      const grant = target.authorization_id ? grants.get(target.authorization_id) : null;
      if (version?.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST"
        || version.stream_id !== target.allowlist_entry_id
        || !version.artifact.payload.active || !version.artifact.payload.exact_path
        || version.artifact.payload.allowed_method !== "GET"
        || canonicalSerialize(version.artifact.payload.query_policy) !== canonicalSerialize({ mode: "DENY_ALL", allowed_parameters: [] })
        || version.artifact.payload.source_admission_artifact_id !== intent.source_admission_artifact_id
        || version.artifact.payload.recruitment_endpoint_artifact_id !== intent.endpoint_artifact_id
        || version.artifact.payload.endpoint_purpose !== target.endpoint_purpose
        || `${version.artifact.payload.scheme}://${version.artifact.payload.host}${version.artifact.payload.path_prefix}` !== target.exact_url
        || target.endpoint_purpose !== admission.artifact.payload.endpoint_purpose
        || (target.authorization_id !== null && (!grant
          || grant.canonical_payload.exact_endpoint !== target.exact_url
          || grant.canonical_payload.bindings.target.artifact_id !== target.allowlist_artifact_id
          || grant.canonical_payload.bindings.admission.artifact_id !== intent.source_admission_artifact_id
          || grant.canonical_payload.bindings.endpoint.artifact_id !== intent.endpoint_artifact_id
          || grant.canonical_payload.bindings.source.artifact_id !== intent.source_artifact_id))) {
        throw new Error("SOURCE_REQUEST_INTENT_TARGET_INVALID");
      }
    }
    return intent;
  });
}

export function assertSourceExecutionIntentOutcome(intent: SourceExecutionRequestIntent, outcome: SourceExecutionOutcome) {
  const plan = outcome.request_plan;
  if (!plan || intent.source_execution_id !== outcome.source_execution_id
    || intent.source_admission_artifact_id !== outcome.source_admission_artifact_id
    || intent.source_definition_id !== plan.source_definition_id
    || intent.recruitment_endpoint_id !== plan.recruitment_endpoint_id
    || intent.source_artifact_id !== plan.source_artifact_id
    || intent.source_revision !== plan.source_revision
    || intent.endpoint_artifact_id !== plan.endpoint_artifact_id
    || canonicalSerialize(intent.targets.flatMap(target => target.authorization_id ? [target.authorization_id] : []).sort())
      !== canonicalSerialize([...outcome.continuous_authorization_ids].sort())
    || canonicalSerialize(intent.targets) !== canonicalSerialize(plan.targets.map(({ observations, ...target }) => target))) {
    throw new Error("SOURCE_REQUEST_INTENT_OUTCOME_MISMATCH");
  }
}

function assertSourceExecutionRequestIntent(intent: SourceExecutionRequestIntent) {
  const { integrity_hash: hash, ...content } = intent;
  const keys = ["schema_version", "source_execution_id", "source_definition_id", "source_artifact_id", "source_revision",
    "recruitment_endpoint_id", "endpoint_artifact_id", "source_admission_artifact_id", "targets", "integrity_hash"];
  if (Object.keys(intent).sort().join(",") !== keys.sort().join(",") || intent.schema_version !== SCHEMA_VERSION
    || hash !== canonicalHash(content) || !intent.source_execution_id || !intent.targets.length
    || !Number.isSafeInteger(intent.source_revision) || intent.source_revision < 1
    || !intent.source_definition_id || !intent.recruitment_endpoint_id) {
    throw new Error("SOURCE_REQUEST_INTENT_INTEGRITY_INVALID");
  }
  const urls = new Set<string>();
  const authorizationIds = new Set<string>();
  for (const target of intent.targets) {
    const url = new URL(target.exact_url);
    if (Object.keys(target).sort().join(",") !== ["allowlist_entry_id", "allowlist_artifact_id", "exact_url",
      "authorization_id", "source_admission_artifact_id", "endpoint_purpose", "request_policy"].sort().join(",")
      || urls.has(target.exact_url) || url.href !== target.exact_url || url.protocol !== "https:"
      || url.username || url.password || url.search || url.hash
      || !target.allowlist_entry_id || !target.allowlist_artifact_id
      || target.source_admission_artifact_id !== intent.source_admission_artifact_id
      || canonicalSerialize(target.request_policy) !== canonicalSerialize({ method: "GET", redirect: "DENY", query: "DENY" })
      || (target.authorization_id !== null && (authorizationIds.has(target.authorization_id) || !target.authorization_id))) {
      throw new Error("SOURCE_REQUEST_INTENT_TARGET_INVALID");
    }
    urls.add(target.exact_url);
    if (target.authorization_id) authorizationIds.add(target.authorization_id);
  }
}

function intentPath(sourceExecutionId: string) {
  return `production-runs/source-request-intents/${canonicalHash({ source_execution_id: sourceExecutionId })}.json`;
}
