import { createHash } from "node:crypto";

import type { RawBlob } from "../ingestion";
import {
  createRawBlobManifest,
  PRODUCTION_RAW_BUCKET,
  ProductionPersistenceError,
  type AcquisitionPersistenceBundle,
  type PrivateRawObjectStorage,
  type ProductionPersistenceProvenance,
  type ProductionSourceFactRepository,
  type RawBlobManifest
} from "./contracts";

export class ProductionRawObjectBoundary {
  readonly #storage: PrivateRawObjectStorage;
  readonly #repository: ProductionSourceFactRepository;

  constructor(
    storage: PrivateRawObjectStorage,
    repository: ProductionSourceFactRepository
  ) {
    this.#storage = storage;
    this.#repository = repository;
  }

  async persistSuccessfulAcquisition(input: {
    readonly raw_blob: RawBlob;
    readonly source_definition_id: string;
    readonly recruitment_endpoint_id: string;
    readonly acquired_at: string;
    readonly provenance: ProductionPersistenceProvenance;
    readonly bundle: Omit<AcquisitionPersistenceBundle, "raw_blob_manifest">;
  }) {
    const manifest = createRawBlobManifest(input);
    const outcome = await this.#storage.putIfAbsent({
      bucket: PRODUCTION_RAW_BUCKET,
      object_key: manifest.object_key,
      bytes: new Uint8Array(input.raw_blob.bytes),
      content_type: manifest.content_type
    });
    if (outcome === "ALREADY_EXISTS") {
      await this.#verifyObject(manifest);
    }
    const persistenceOutcome = await this.#repository.appendAcquisitionBundle({
      ...input.bundle,
      raw_blob_manifest: manifest
    });
    return { manifest: structuredClone(manifest), persistence_outcome: persistenceOutcome };
  }

  async persistFailedAcquisition(
    bundle: Omit<AcquisitionPersistenceBundle, "raw_blob_manifest">
  ) {
    return this.#repository.appendAcquisitionBundle({ ...bundle, raw_blob_manifest: null });
  }

  async readVerified(rawBlobId: string) {
    const manifest = await this.#repository.getRawBlobManifest(rawBlobId);
    if (!manifest) {
      throw new ProductionPersistenceError(
        "EVIDENCE_BLOCKED",
        `RawBlob has no trusted persistence manifest: ${rawBlobId}`
      );
    }
    const bytes = await this.#verifyObject(manifest);
    return { manifest: structuredClone(manifest), bytes: new Uint8Array(bytes) };
  }

  async #verifyObject(manifest: RawBlobManifest) {
    const bytes = await this.#storage.read({
      bucket: PRODUCTION_RAW_BUCKET,
      object_key: manifest.object_key
    });
    if (!bytes) {
      throw new ProductionPersistenceError(
        "EVIDENCE_BLOCKED",
        `RawBlob object is missing for manifest: ${manifest.raw_blob_id}`
      );
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== manifest.raw_content_sha256 || bytes.byteLength !== manifest.byte_length) {
      throw new ProductionPersistenceError(
        "EVIDENCE_BLOCKED",
        `RawBlob object does not match manifest: ${manifest.raw_blob_id}`
      );
    }
    return bytes;
  }
}
