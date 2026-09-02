const SHA256_HEX = /^[a-f0-9]{64}$/u;

export interface PreviewRecoveryManifestInput {
  readonly migration_ids: readonly string[];
  readonly raw_blob_sha256: readonly string[];
  readonly created_at: string;
}

export interface PreviewRecoveryManifest {
  readonly format: "PREVIEW_INGESTION_RECOVERY_V1";
  readonly migration_ids: readonly string[];
  readonly raw_blob_sha256: readonly string[];
  readonly created_at: string;
}

export interface PreviewRecoveryPlan {
  readonly environment: "LOCAL_OR_PREVIEW_ONLY";
  readonly steps: readonly [
    "RESTORE_EMPTY_PREVIEW_DATABASE",
    "REPLAY_MIGRATIONS",
    "VERIFY_FOREIGN_KEYS_AND_CONSTRAINTS",
    "VERIFY_PRIVATE_RAW_OBJECT_HASHES",
    "RECONCILE_SNAPSHOT_RAW_REFERENCES"
  ];
  readonly manifest: PreviewRecoveryManifest;
}

function sortedDistinct(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function createPreviewRecoveryManifest(
  input: PreviewRecoveryManifestInput
): PreviewRecoveryManifest {
  const migration_ids = sortedDistinct(input.migration_ids);
  const raw_blob_sha256 = sortedDistinct(input.raw_blob_sha256.map((value) => value.toLowerCase()));
  if (migration_ids.length === 0 || migration_ids.some((migrationId) => !/^\d{3}_/u.test(migrationId))) {
    throw new Error("Preview recovery requires versioned preview migration identifiers");
  }
  if (raw_blob_sha256.some((sha256) => !SHA256_HEX.test(sha256))) {
    throw new Error("Preview recovery requires SHA-256 raw object hashes");
  }
  return { format: "PREVIEW_INGESTION_RECOVERY_V1", migration_ids, raw_blob_sha256, created_at: input.created_at };
}

export function planPreviewRecovery(manifest: PreviewRecoveryManifest): PreviewRecoveryPlan {
  return {
    environment: "LOCAL_OR_PREVIEW_ONLY",
    steps: ["RESTORE_EMPTY_PREVIEW_DATABASE", "REPLAY_MIGRATIONS", "VERIFY_FOREIGN_KEYS_AND_CONSTRAINTS", "VERIFY_PRIVATE_RAW_OBJECT_HASHES", "RECONCILE_SNAPSHOT_RAW_REFERENCES"],
    manifest
  };
}
