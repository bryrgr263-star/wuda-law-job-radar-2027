import type { ContinuousBindings, ContinuousSourceContext } from "../application/source-admission/continuous-acquisition";
import { assertSourcePersistenceVersion, type SourcePersistenceVersion } from "./contracts";

export function resolveContinuousSourceContext(versions: readonly SourcePersistenceVersion[],
  targetIdOrBindings: string | ContinuousBindings): ContinuousSourceContext {
  for (const version of versions) assertSourcePersistenceVersion(version);
  const byArtifact = (id: string) => {
    const found = versions.find(version => version.artifact_id === id);
    if (!found) throw new Error("CONTINUOUS_UPSTREAM_MISSING");
    return found;
  };
  const current = (kind: SourcePersistenceVersion["artifact"]["kind"], id: string) => {
    const found = versions.filter(version => version.artifact.kind === kind && version.stream_id === id).at(-1);
    if (!found) throw new Error("CONTINUOUS_UPSTREAM_MISSING");
    return found;
  };
  const targetVersion = typeof targetIdOrBindings === "string"
    ? current("OFFICIAL_ENDPOINT_ALLOWLIST", targetIdOrBindings) : byArtifact(targetIdOrBindings.target.artifact_id);
  if (targetVersion.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST") throw new Error("TARGET_KIND_MISMATCH");
  const target = targetVersion.artifact.payload;
  const endpointVersion = typeof targetIdOrBindings === "string"
    ? byArtifact(target.recruitment_endpoint_artifact_id) : byArtifact(targetIdOrBindings.endpoint.artifact_id);
  const admissionVersion = typeof targetIdOrBindings === "string"
    ? byArtifact(target.source_admission_artifact_id) : byArtifact(targetIdOrBindings.admission.artifact_id);
  if (endpointVersion.artifact.kind !== "RECRUITMENT_ENDPOINT" || admissionVersion.artifact.kind !== "SOURCE_ADMISSION") throw new Error("UPSTREAM_KIND_MISMATCH");
  const endpoint = endpointVersion.artifact.payload;
  const admission = admissionVersion.artifact.payload;
  const sourceVersion = typeof targetIdOrBindings === "string"
    ? current("SOURCE_DEFINITION", endpoint.source_definition_id) : byArtifact(targetIdOrBindings.source.artifact_id);
  if (sourceVersion.artifact.kind !== "SOURCE_DEFINITION") throw new Error("SOURCE_KIND_MISMATCH");
  if (typeof targetIdOrBindings === "string" && (
    current("RECRUITMENT_ENDPOINT", endpoint.recruitment_endpoint_id).artifact_id !== endpointVersion.artifact_id
    || current("SOURCE_ADMISSION", admission.source_admission_id).artifact_id !== admissionVersion.artifact_id)) throw new Error("REAUTHORIZE_REQUIRED");
  const ref = (version: SourcePersistenceVersion) => ({ id: version.stream_id, artifact_id: version.artifact_id,
    revision: version.revision, semantic_hash: version.content_hash });
  return { bindings: { source: ref(sourceVersion), endpoint: ref(endpointVersion), admission: ref(admissionVersion), target: ref(targetVersion) },
    source: sourceVersion.artifact.payload, endpoint, admission, target: { ...target } };
}
