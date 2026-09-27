import { createHash } from "node:crypto";
import type { PresentationCurrentSnapshot, PresentationField } from "../ingestion";
import { canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import {
  MAX_PUBLIC_BYTES, PUBLIC_ENVELOPE_VERSION, PUBLIC_PROJECTION_VERSION, PUBLIC_REASONS,
  PUBLIC_SNAPSHOT_VERSION, parsePublicPayload, publicEnvelopeSchema, publicPayloadSchema,
  type PublicField, type PublicSnapshotEnvelope, type PublicSnapshotPayload
} from "./schema";

export interface PinnedCurrentInput {
  readonly authoritative_sha: string;
  readonly generated_at: string;
  readonly current_snapshot: PresentationCurrentSnapshot | null;
}

function projectField<Value>(input: PresentationField<Value>): PublicField<Value> {
  return input.state === "AVAILABLE" ? { state: "AVAILABLE", value: structuredClone(input.value) }
    : { state: "NOT_YET_AVAILABLE" };
}
export function publicByteHash(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function createPublicSnapshot(input: PinnedCurrentInput): PublicSnapshotEnvelope {
  const current = input.current_snapshot;
  if (!current || current.scope !== "PRODUCTION" || current.authoritative_head !== input.authoritative_sha) {
    throw new Error("PUBLIC_CURRENT_BINDING_INVALID");
  }
  const positions = current.current_position_read_models.flatMap(model => {
    if (("scope" in model && model.scope !== "PRODUCTION") || model.upstream.eligibility_assessment_scope === "SYNTHETIC_TEST") {
      throw new Error("PUBLIC_SCOPE_INVALID");
    }
    if (model.presentation_status === "NOT_DISPLAY") return [];
    const reasonCodes = model.reason_codes.filter(reason => (PUBLIC_REASONS as readonly string[]).includes(reason));
    return [{ position_id: model.position_id, presentation_decision_id: model.presentation_decision_id,
      presentation_read_model_id: model.presentation_read_model_id, decision_revision: model.decision_revision,
      presentation_status: model.presentation_status, reason_codes: [...reasonCodes].sort(),
      reason_visibility: reasonCodes.length === model.reason_codes.length ? "COMPLETE" : "REDACTED",
      employer: projectField(model.employer), position_title: projectField(model.position_title),
      locations: projectField(model.locations), recruitment_year: projectField(model.recruitment_year),
      recruitment_batch: projectField(model.recruitment_batch), announcement_link: projectField(model.announcement_link),
      application_link: projectField(model.application_link), requirement_summary: model.requirement_summary.state === "AVAILABLE"
        ? { state: "AVAILABLE", value: model.requirement_summary.value.map(item => ({ dimension: item.dimension,
          subject_scope: item.subject_scope, polarity: item.polarity, certainty: item.certainty })) }
        : { state: "NOT_YET_AVAILABLE" }, updated_at: model.updated_at }];
  });
  positions.sort((left, right) => String(left.position_id) < String(right.position_id) ? -1
    : String(left.position_id) > String(right.position_id) ? 1 : 0);
  const payload = publicPayloadSchema.parse({ schema_version: PUBLIC_SNAPSHOT_VERSION,
    projection_version: PUBLIC_PROJECTION_VERSION, authoritative_sha: input.authoritative_sha,
    generated_at: input.generated_at, position_count: positions.length, positions });
  const bytes = canonicalSerialize(payload);
  const envelope: PublicSnapshotEnvelope = { schema_version: PUBLIC_ENVELOPE_VERSION,
    payload_canonical_bytes: bytes, payload_sha256: publicByteHash(bytes) };
  if (Buffer.byteLength(canonicalSerialize(envelope), "utf8") > MAX_PUBLIC_BYTES) throw new Error("PUBLIC_SIZE_LIMIT");
  return envelope;
}
export function validatePublicSnapshot(value: unknown, expectedSha: string, expectedHash: string): PublicSnapshotPayload {
  const envelope = publicEnvelopeSchema.parse(value);
  if (Buffer.byteLength(canonicalSerialize(envelope), "utf8") > MAX_PUBLIC_BYTES) throw new Error("PUBLIC_SIZE_LIMIT");
  if (envelope.payload_sha256 !== expectedHash || publicByteHash(envelope.payload_canonical_bytes) !== expectedHash) {
    throw new Error("PUBLIC_HASH_MISMATCH");
  }
  const payload = parsePublicPayload(envelope.payload_canonical_bytes);
  if (canonicalSerialize(payload) !== envelope.payload_canonical_bytes) throw new Error("PUBLIC_NON_CANONICAL");
  if (payload.authoritative_sha !== expectedSha) throw new Error("PUBLIC_SHA_MISMATCH");
  return payload;
}
