import { MAX_PUBLIC_BYTES, hashSchema, parsePublicPayload, publicEnvelopeSchema, shaSchema, type PublicField } from "../public-presentation/schema";
import { toPresentationDisplayInputJob } from "./model";

function displayField<Value>(value: PublicField<Value>) {
  return value.state === "AVAILABLE" ? value : { state: "NOT_YET_AVAILABLE" as const, reason: "PUBLIC_FIELD_UNAVAILABLE" };
}
export async function loadPublicPresentationBoard(input: {
  readonly snapshot_url: string; readonly expected_sha: string; readonly expected_payload_hash: string;
  readonly origin?: string; readonly fetcher?: typeof fetch;
}) {
  shaSchema.parse(input.expected_sha);
  hashSchema.parse(input.expected_payload_hash);
  const origin = input.origin ?? globalThis.location?.origin;
  if (!origin) throw new Error("PUBLIC_ORIGIN_REQUIRED");
  const url = new URL(input.snapshot_url, `${origin}/`);
  if (url.origin !== origin || url.username || url.password || url.search || url.hash
    || !url.pathname.endsWith(`/presentation/snapshots/${input.expected_payload_hash}.json`)
    || !/^\/(?:[A-Za-z0-9_-]+\/)*presentation\/snapshots\/[a-f0-9]{64}\.json$/u.test(url.pathname)) throw new Error("PUBLIC_RESOURCE_NOT_AUTHORIZED");
  const response = await (input.fetcher ?? globalThis.fetch)(url.href, { credentials: "omit", redirect: "error", cache: "no-store" });
  if (!response.ok || response.redirected || (response.url && response.url !== url.href) || !response.body) throw new Error("PUBLIC_RESOURCE_UNAVAILABLE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > MAX_PUBLIC_BYTES) throw new Error("PUBLIC_SIZE_LIMIT");
      chunks.push(item.value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const envelope = publicEnvelopeSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) throw new Error("PUBLIC_INTEGRITY_UNSUPPORTED");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(envelope.payload_canonical_bytes));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== input.expected_payload_hash || envelope.payload_sha256 !== hash) throw new Error("PUBLIC_HASH_MISMATCH");
  const payload = parsePublicPayload(envelope.payload_canonical_bytes);
  if (payload.authoritative_sha !== input.expected_sha) throw new Error("PUBLIC_SHA_MISMATCH");
  const jobs = payload.positions.map(item => ({ ...toPresentationDisplayInputJob({
    position_id: item.position_id,
    presentation_decision_id: item.presentation_decision_id,
    presentation_read_model_id: item.presentation_read_model_id,
    decision_revision: item.decision_revision, presentation_status: item.presentation_status,
    reason_codes: item.reason_codes, employer: displayField(item.employer), position_title: displayField(item.position_title),
    locations: displayField(item.locations), recruitment_year: displayField(item.recruitment_year),
    recruitment_batch: displayField(item.recruitment_batch), announcement_link: displayField(item.announcement_link),
    application_link: displayField(item.application_link), requirement_summary: displayField(item.requirement_summary),
    updated_at: item.updated_at
  }), reasonVisibility: item.reason_visibility }));
  return { jobs, authoritative_sha: payload.authoritative_sha, generated_at: payload.generated_at, snapshot_hash: hash };
}
