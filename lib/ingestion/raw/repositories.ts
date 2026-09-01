import { createHash } from "node:crypto";

import type {
  RawBlob,
  RawBlobId,
  RawContentSha256,
  Snapshot,
  SnapshotId
} from "../domain";

export interface RawBlobRepository {
  append(blob: RawBlob): RawBlob;
  get(rawBlobId: RawBlobId): RawBlob | null;
  findByHash(hash: RawContentSha256): RawBlob | null;
  count(): number;
}

export interface SnapshotRepository {
  append(snapshot: Snapshot): Snapshot;
  get(snapshotId: SnapshotId): Snapshot | null;
  count(): number;
}

export class InMemoryRawBlobRepository implements RawBlobRepository {
  readonly #blobs = new Map<RawBlobId, RawBlob>();
  readonly #blobIdsByHash = new Map<RawContentSha256, RawBlobId>();

  append(blob: RawBlob) {
    validateRawBlob(blob);
    const existingId = this.#blobIdsByHash.get(blob.raw_content_sha256);
    if (existingId) return cloneRawBlob(this.#blobs.get(existingId)!);
    if (this.#blobs.has(blob.raw_blob_id)) {
      throw new Error(`RawBlob is append-only and already exists: ${blob.raw_blob_id}`);
    }
    const stored = cloneRawBlob(blob);
    this.#blobs.set(stored.raw_blob_id, stored);
    this.#blobIdsByHash.set(stored.raw_content_sha256, stored.raw_blob_id);
    return cloneRawBlob(stored);
  }

  get(rawBlobId: RawBlobId) {
    const blob = this.#blobs.get(rawBlobId);
    return blob ? cloneRawBlob(blob) : null;
  }

  findByHash(hash: RawContentSha256) {
    const rawBlobId = this.#blobIdsByHash.get(hash);
    return rawBlobId ? this.get(rawBlobId) : null;
  }

  count() {
    return this.#blobs.size;
  }
}

export class InMemorySnapshotRepository implements SnapshotRepository {
  readonly #snapshots = new Map<SnapshotId, Snapshot>();

  append(snapshot: Snapshot) {
    if (this.#snapshots.has(snapshot.snapshot_id)) {
      throw new Error(`Snapshot is append-only and already exists: ${snapshot.snapshot_id}`);
    }
    const stored = cloneSnapshot(snapshot);
    this.#snapshots.set(stored.snapshot_id, stored);
    return cloneSnapshot(stored);
  }

  get(snapshotId: SnapshotId) {
    const snapshot = this.#snapshots.get(snapshotId);
    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  count() {
    return this.#snapshots.size;
  }
}

function cloneRawBlob(blob: RawBlob): RawBlob {
  return {
    ...blob,
    bytes: new Uint8Array(blob.bytes)
  };
}

function cloneSnapshot(snapshot: Snapshot): Snapshot {
  return structuredClone(snapshot);
}

function validateRawBlob(blob: RawBlob) {
  if (blob.byte_length !== blob.bytes.byteLength) {
    throw new Error("RawBlob byte_length does not match its raw bytes");
  }
  const actualHash = createHash("sha256").update(blob.bytes).digest("hex");
  if (actualHash !== blob.raw_content_sha256) {
    throw new Error("RawBlob SHA-256 does not match its raw bytes");
  }
}
