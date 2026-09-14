import { createHash } from "node:crypto";

export type CanonicalArtifactSealStatus = "SEALED" | "IDEMPOTENT_REUSE";

export interface CanonicalArtifactSealResult<Artifact> {
  readonly status: CanonicalArtifactSealStatus;
  readonly artifact: Artifact;
  readonly canonical_hash: string;
}

export interface CanonicalArtifactResolver<Identity extends string, Artifact> {
  resolve(identity: Identity): Artifact | null;
}

export class CanonicalArtifactRegistryError extends Error {
  readonly code:
    | "IDENTITY_COLLISION"
    | "NON_CANONICAL_VALUE"
    | "IDENTITY_MISMATCH";

  constructor(
    code: CanonicalArtifactRegistryError["code"],
    message: string
  ) {
    super(message);
    this.name = "CanonicalArtifactRegistryError";
    this.code = code;
  }
}

interface CanonicalEntry {
  readonly canonical_bytes: string;
  readonly canonical_hash: string;
}

export interface CanonicalArtifactWriter<Identity extends string, Artifact> {
  seal(identity: Identity, artifact: Artifact): CanonicalArtifactSealResult<Artifact>;
}

export interface CanonicalArtifactRegistryAuthority<
  Identity extends string,
  Artifact
> {
  readonly writer: CanonicalArtifactWriter<Identity, Artifact>;
  readonly resolver: CanonicalArtifactResolver<Identity, Artifact>;
  readonly size: () => number;
}

export function createCanonicalArtifactRegistryAuthority<
  Identity extends string,
  Artifact
>(identityOf: (artifact: Artifact) => Identity): CanonicalArtifactRegistryAuthority<
  Identity,
  Artifact
> {
  const entries = new Map<Identity, CanonicalEntry>();

  const resolver: CanonicalArtifactResolver<Identity, Artifact> = Object.freeze({
    resolve(identity: Identity): Artifact | null {
      const entry = entries.get(identity);
      return entry ? canonicalDeserialize<Artifact>(entry.canonical_bytes) : null;
    }
  });

  const writer: CanonicalArtifactWriter<Identity, Artifact> = Object.freeze({
    seal(identity: Identity, artifact: Artifact): CanonicalArtifactSealResult<Artifact> {
      if (identityOf(artifact) !== identity) {
        throw new CanonicalArtifactRegistryError(
          "IDENTITY_MISMATCH",
          "Artifact identity does not match the registry identity key"
        );
      }
      const canonicalBytes = canonicalSerialize(artifact);
      const canonicalHash = sha256(canonicalBytes);
      const existing = entries.get(identity);
      if (existing) {
        if (existing.canonical_bytes !== canonicalBytes) {
          throw new CanonicalArtifactRegistryError(
            "IDENTITY_COLLISION",
            `Artifact identity collision: ${identity}`
          );
        }
        return {
          status: "IDEMPOTENT_REUSE",
          artifact: canonicalDeserialize<Artifact>(existing.canonical_bytes),
          canonical_hash: existing.canonical_hash
        };
      }
      entries.set(identity, {
        canonical_bytes: canonicalBytes,
        canonical_hash: canonicalHash
      });
      return {
        status: "SEALED",
        artifact: canonicalDeserialize<Artifact>(canonicalBytes),
        canonical_hash: canonicalHash
      };
    }
  });

  return Object.freeze({
    writer,
    resolver,
    size: () => entries.size
  });
}

export function canonicalSerialize(value: unknown): string {
  const active = new Set<object>();
  return serialize(value, active, "$", false);
}

export function canonicalHash(value: unknown): string {
  return sha256(canonicalSerialize(value));
}

function serialize(
  value: unknown,
  active: Set<object>,
  path: string,
  arrayElement: boolean
): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw nonCanonical(path, "non-finite number");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value === "undefined") {
    return '{"$canonical_value":"undefined"}';
  }
  if (
    typeof value === "bigint"
    || typeof value === "function"
    || typeof value === "symbol"
  ) {
    throw nonCanonical(path, typeof value);
  }
  if (typeof value !== "object") throw nonCanonical(path, typeof value);
  if (value instanceof Date || value instanceof Map || value instanceof Set) {
    throw nonCanonical(path, value.constructor.name);
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    throw nonCanonical(path, "binary view");
  }
  if (active.has(value)) throw nonCanonical(path, "cyclic reference");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item, index) => {
        return serialize(item, active, `${path}[${index}]`, true);
      }).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw nonCanonical(path, "non-plain object");
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => {
      return `${JSON.stringify(key)}:${serialize(
        record[key],
        active,
        `${path}.${key}`,
        false
      )}`;
    }).join(",")}}`;
  } finally {
    active.delete(value);
  }
}

export function canonicalDeserialize<Artifact>(canonicalBytes: string): Artifact {
  return decodeCanonical(JSON.parse(canonicalBytes)) as Artifact;
}

function decodeCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeCanonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 1
        && record.$canonical_value === "undefined") {
      return undefined;
    }
    return Object.fromEntries(Object.entries(record).map(([key, nested]) => {
      return [key, decodeCanonical(nested)];
    }));
  }
  return value;
}

function nonCanonical(path: string, kind: string) {
  return new CanonicalArtifactRegistryError(
    "NON_CANONICAL_VALUE",
    `Canonical artifacts cannot contain ${kind} at ${path}`
  );
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
