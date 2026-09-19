import type { InMemorySourceAdmissionRegister } from "../application/source-admission";
import type { ContinuousRecord, ContinuousFencingVerifier } from "../application/source-admission/continuous-acquisition";
import { resolveContinuousSourceContext } from "./continuous-source-context";
import type { InMemorySourceRegistry } from "../ingestion";
import {
  assertSourcePersistenceVersion,
  type ProductionSourceRegistryRepository,
  type SourcePersistenceVersion
} from "./contracts";

export async function rehydrateProductionSourceOwners(input: {
  readonly repository: ProductionSourceRegistryRepository;
  readonly source_registry: InMemorySourceRegistry;
  readonly source_admission_register: InMemorySourceAdmissionRegister;
  readonly continuous_records?: readonly ContinuousRecord[];
  readonly fencing_verifier?: ContinuousFencingVerifier;
}) {
  const versions = await input.repository.listVersions();
  const currentRevision = new Map<string, SourcePersistenceVersion>();
  let restored = 0;

  for (const version of versions) {
    assertSourcePersistenceVersion(version);
    const key = `${version.artifact.kind}:${version.stream_id}`;
    const current = currentRevision.get(key);
    if (version.revision !== (current?.revision ?? 0) + 1) {
      throw new Error(`Source persistence revision gap: ${key} r${version.revision}`);
    }
    if (version.supersedes_artifact_id !== (current?.artifact_id ?? null)) {
      throw new Error(`Source persistence supersedes mismatch: ${version.artifact_id}`);
    }

    replayVersion(input, version, current === undefined);
    currentRevision.set(key, structuredClone(version));
    restored += 1;
  }

  input.source_admission_register.restoreContinuousRecords(input.continuous_records ?? [],
    bindings => resolveContinuousSourceContext(versions, bindings), input.fencing_verifier);
  return { restored_version_count: restored, restored_continuous_record_count: input.continuous_records?.length ?? 0 } as const;
}

function replayVersion(
  owners: {
    readonly source_registry: InMemorySourceRegistry;
    readonly source_admission_register: InMemorySourceAdmissionRegister;
  },
  version: SourcePersistenceVersion,
  initial: boolean
) {
  const artifact = version.artifact;
  if (artifact.kind === "ORGANIZATION") {
    return initial
      ? owners.source_registry.registerOrganization(artifact.payload)
      : owners.source_registry.reviseOrganization(artifact.payload);
  }
  if (artifact.kind === "ADAPTER_REGISTRATION") {
    return initial
      ? owners.source_registry.registerAdapterKey(artifact.payload)
      : owners.source_registry.reviseAdapterKey(artifact.payload);
  }
  if (artifact.kind === "SOURCE_DEFINITION") {
    return initial
      ? owners.source_registry.registerSourceDefinition(artifact.payload)
      : owners.source_registry.reviseSourceDefinition(artifact.payload);
  }
  if (artifact.kind === "RECRUITMENT_ENDPOINT") {
    return initial
      ? owners.source_registry.registerRecruitmentEndpoint(artifact.payload)
      : owners.source_registry.reviseRecruitmentEndpoint(artifact.payload);
  }
  if (artifact.kind === "SOURCE_ADMISSION") {
    return initial
      ? owners.source_admission_register.register(artifact.payload)
      : owners.source_admission_register.revise(artifact.payload);
  }
  return artifact.payload;
}
