import { createHash } from "node:crypto";

import type { CandidateEvidenceSourceManifest } from "../ingestion";
import {
  PRODUCTION_CANDIDATE_EVIDENCE_BUCKET,
  ProductionPersistenceError,
  rawBlobObjectKey,
  type PrivateCandidateEvidenceObjectStorage
} from "./contracts";

export class ProductionCandidateEvidenceObjectBoundary {
  readonly #storage: PrivateCandidateEvidenceObjectStorage;

  constructor(storage: PrivateCandidateEvidenceObjectStorage) {
    this.#storage = storage;
  }

  async persistVerifiedObject(input: {
    readonly bytes: Uint8Array;
    readonly content_type: string;
  }): Promise<NonNullable<CandidateEvidenceSourceManifest["evidence_object"]>> {
    const bytes = new Uint8Array(input.bytes);
    if (bytes.byteLength === 0 || !input.content_type.trim()) {
      throw new ProductionPersistenceError(
        "HASH_MISMATCH",
        "Candidate evidence object bytes and content type are required"
      );
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const objectKey = rawBlobObjectKey(sha256);
    await this.#storage.putIfAbsent({
      bucket: PRODUCTION_CANDIDATE_EVIDENCE_BUCKET,
      object_key: objectKey,
      bytes,
      content_type: input.content_type
    });
    const persisted = await this.#storage.read({
      bucket: PRODUCTION_CANDIDATE_EVIDENCE_BUCKET,
      object_key: objectKey
    });
    if (!persisted
        || persisted.byteLength !== bytes.byteLength
        || createHash("sha256").update(persisted).digest("hex") !== sha256) {
      throw new ProductionPersistenceError(
        "EVIDENCE_BLOCKED",
        "Candidate evidence object is missing or does not match its SHA-256"
      );
    }
    return {
      bucket_id: PRODUCTION_CANDIDATE_EVIDENCE_BUCKET,
      object_key: objectKey,
      sha256,
      byte_length: bytes.byteLength,
      content_type: input.content_type
    };
  }

  async verify(manifest: CandidateEvidenceSourceManifest) {
    if (manifest.evidence_class !== "DOCUMENT_VERIFIED"
        || !manifest.evidence_object
        || manifest.evidence_object.bucket_id !== PRODUCTION_CANDIDATE_EVIDENCE_BUCKET) {
      throw new ProductionPersistenceError(
        "EVIDENCE_BLOCKED",
        "DOCUMENT_VERIFIED manifest is not bound to the private evidence bucket"
      );
    }
    const bytes = await this.#storage.read({
      bucket: PRODUCTION_CANDIDATE_EVIDENCE_BUCKET,
      object_key: manifest.evidence_object.object_key
    });
    if (!bytes
        || bytes.byteLength !== manifest.evidence_object.byte_length
        || createHash("sha256").update(bytes).digest("hex")
          !== manifest.evidence_object.sha256) {
      throw new ProductionPersistenceError(
        "EVIDENCE_BLOCKED",
        "DOCUMENT_VERIFIED source object is missing or fails integrity verification"
      );
    }
  }
}
