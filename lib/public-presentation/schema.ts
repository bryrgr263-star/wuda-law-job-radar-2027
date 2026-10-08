import { z } from "zod";

export const PUBLIC_ENVELOPE_VERSION = "public-presentation-envelope/1.0.0";
export const PUBLIC_SNAPSHOT_VERSION = "public-presentation-snapshot/1.0.0";
export const PUBLIC_PROJECTION_VERSION = "public-presentation-projection/1.0.0";
export const MAX_PUBLIC_BYTES = 8 * 1024 * 1024;
export const PUBLIC_REASONS = [
  "RELEVANCE_ASSESSMENT_MISSING", "OPPORTUNITY_CANDIDATE_POSITION_BINDING_UNRESOLVED",
  "RELEVANCE_EVIDENCE_BLOCKED", "ELIGIBILITY_ASSESSMENT_MISSING",
  "TRUSTED_ELIGIBILITY_CONFIRMED", "REVIEW_OR_INSUFFICIENT_ELIGIBILITY"
] as const;

const text = z.string().max(16_384).refine(value =>
  !/\b(?:Bearer\s+\S+|(?:password|access_token|session_id|api_key|credential)\s*[:=]\s*\S+)/iu.test(value),
"PUBLIC_SENSITIVE_TEXT");
const identity = z.string().min(1).max(1024);
export const shaSchema = z.string().regex(/^[a-f0-9]{40}$/u);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const code = z.string().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9_.:/-]*$/u);
function field<Value extends z.ZodTypeAny>(value: Value) {
  return z.union([z.object({ state: z.literal("AVAILABLE"), value }).strict(),
    z.object({ state: z.literal("NOT_YET_AVAILABLE") }).strict()]);
}
const approvedPublicQueryLinks = new Set([
  "https://zhaopin.chnenergy.com.cn/annc/showgw?id=5a798bfe-a4d6-0be4-e063-98b4d40a088a",
  "https://zhaopin.chnenergy.com.cn/annc/showgw?id=5a798bfe-ac8c-0be4-e063-98b4d40a088a"
]);
const url = text.refine(value => {
  try {
    const parsed = new URL(value);
    let decodedPath = parsed.pathname;
    for (let index = 0; index < 3; index++) {
      const next = decodeURIComponent(decodedPath);
      if (next === decodedPath) break;
      decodedPath = next;
    }
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      && (!parsed.search || approvedPublicQueryLinks.has(value)) && !parsed.hash
      && !decodedPath.includes("%")
      && !/(?:^|\/)(?:login|sign[-_]?in|captcha|challenge|auth(?:entication|orization)?|oauth|session(?:[-_]?id)?|(?:access[-_]?)?token|api[-_]?key|credential|reset[-_]?password|password[-_]?reset)(?:\/|$)/iu.test(decodedPath);
  } catch { return false; }
}, "PUBLIC_LINK_UNSAFE");
const summary = z.object({ dimension: code, subject_scope: code, polarity: code, certainty: code }).strict();
export const publicPositionSchema = z.object({
  position_id: identity, presentation_decision_id: identity, presentation_read_model_id: identity,
  decision_revision: z.number().int().positive().safe(),
  presentation_status: z.enum(["DISPLAY", "DISPLAY_WITH_REVIEW", "EVIDENCE_BLOCKED"]),
  reason_codes: z.array(z.enum(PUBLIC_REASONS)).max(100), reason_visibility: z.enum(["COMPLETE", "REDACTED"]),
  employer: field(text), position_title: field(text), locations: field(z.array(text).max(100)),
  recruitment_year: field(z.number().int().safe().refine(value => !Object.is(value, -0), "PUBLIC_NEGATIVE_ZERO")), recruitment_batch: field(text),
  announcement_link: field(url), application_link: field(url), requirement_summary: field(z.array(summary).max(1000)),
  updated_at: z.string().datetime()
}).strict();
export const publicPayloadSchema = z.object({
  schema_version: z.literal(PUBLIC_SNAPSHOT_VERSION), projection_version: z.literal(PUBLIC_PROJECTION_VERSION),
  authoritative_sha: shaSchema, generated_at: z.string().datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u),
  position_count: z.number().int().nonnegative().safe(), positions: z.array(publicPositionSchema).max(20_000)
}).strict().superRefine((value, context) => {
  if (value.position_count !== value.positions.length) context.addIssue({ code: "custom", message: "PUBLIC_COUNT_MISMATCH" });
  if (new Set(value.positions.map(item => item.position_id)).size !== value.positions.length) {
    context.addIssue({ code: "custom", message: "PUBLIC_DUPLICATE_POSITION" });
  }
});
export const publicEnvelopeSchema = z.object({
  schema_version: z.literal(PUBLIC_ENVELOPE_VERSION), payload_canonical_bytes: z.string().max(MAX_PUBLIC_BYTES),
  payload_sha256: hashSchema
}).strict();
export type PublicPosition = z.infer<typeof publicPositionSchema>;
export type PublicSnapshotPayload = z.infer<typeof publicPayloadSchema>;
export type PublicSnapshotEnvelope = z.infer<typeof publicEnvelopeSchema>;
export type PublicField<Value> = { readonly state: "AVAILABLE"; readonly value: Value }
  | { readonly state: "NOT_YET_AVAILABLE" };

export function parsePublicPayload(bytes: string): PublicSnapshotPayload {
  if (new TextEncoder().encode(bytes).length > MAX_PUBLIC_BYTES) throw new Error("PUBLIC_SIZE_LIMIT");
  return publicPayloadSchema.parse(JSON.parse(bytes));
}
