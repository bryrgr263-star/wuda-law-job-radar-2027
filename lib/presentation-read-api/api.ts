import type { PresentationReadModel } from "../ingestion";
import type { PresentationReadRepository } from "../ingestion";

const BASE_PATH = "/api/presentation/v1";
const DEFAULT_STATUSES = new Set([
  "DISPLAY", "DISPLAY_WITH_REVIEW", "EVIDENCE_BLOCKED"
]);

export class ReadOnlyPresentationApi {
  readonly #persistence: PresentationReadRepository;

  constructor(persistence: PresentationReadRepository) {
    this.#persistence = persistence;
  }

  async handle(request: Request): Promise<Response> {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
    const url = new URL(request.url);
    try {
      if (url.pathname === `${BASE_PATH}/opportunities`) {
        const snapshot = await this.#persistence.readCurrentSnapshot?.();
        const status = url.searchParams.get("status");
        const models = this.#visible(
          snapshot ? snapshot.current_position_read_models : await this.#persistence.listCurrentReadModels(),
          status
        );
        const { offset, limit, sort } = query(url.searchParams);
        return json({
          opportunities: models.slice(offset, offset + limit),
          pagination: { offset, limit, total: models.length },
          sorting: sort,
          ...(snapshot ? {
            contract_version: snapshot.contract_version,
            authoritative_head: snapshot.authoritative_head,
            retention: { ...snapshot.retention,
              ...auditPage(snapshot.retention.items, url.searchParams, "retention") },
            migration: { ...snapshot.migration,
              ...auditPage(snapshot.migration.items, url.searchParams, "migration") }
          } : {})
        });
      }
      const prefix = `${BASE_PATH}/opportunities/`;
      if (url.pathname.startsWith(prefix)) {
        const candidateId = decodeURIComponent(url.pathname.slice(prefix.length));
        const snapshot = await this.#persistence.readCurrentSnapshot?.();
        if (snapshot) {
          const detail = Object.hasOwn(snapshot.candidate_details, candidateId)
            ? snapshot.candidate_details[candidateId] : null;
          return detail && (("record_kind" in detail && (detail.record_kind === "UNBOUND_RETAINED_OUTCOME" || detail.record_kind === "MIGRATION_BLOCKED"))
            || ("presentation_status" in detail && DEFAULT_STATUSES.has(detail.presentation_status)))
            ? json(detail) : json({ error: "not_found" }, 404);
        }
        const model = this.#visible(
          await this.#persistence.listCurrentReadModels(),
          null
        )
          .find((item) => item.opportunity_candidate_id === candidateId) ?? null;
        return model ? json(model) : json({ error: "not_found" }, 404);
      }
    } catch (error) {
      if (error instanceof PresentationReadApiQueryError) {
        return json({ error: "invalid_query", detail: error.message }, 400);
      }
      throw error;
    }
    return json({ error: "not_found" }, 404);
  }

  #visible(models: readonly PresentationReadModel[], requestedStatus: string | null) {
    const statuses = requestedStatus ? new Set(requestedStatus.split(",")) : DEFAULT_STATUSES;
    for (const status of statuses) {
      if (!DEFAULT_STATUSES.has(status)) throw new Error("presentation status is not publicly readable");
    }
    return models.filter((model) => statuses.has(model.presentation_status));
  }
}

class PresentationReadApiQueryError extends Error {}

function auditPage<Item>(items: readonly Item[], search: URLSearchParams, prefix: string) {
  const offset = integer(search.get(`${prefix}_offset`), 0, 0, Number.MAX_SAFE_INTEGER, `${prefix}_offset`);
  const limit = integer(search.get(`${prefix}_limit`), 50, 1, 100, `${prefix}_limit`);
  return { items: items.slice(offset, offset + limit), pagination: { offset, limit, total: items.length } };
}

function query(search: URLSearchParams) {
  const sort = search.get("sort") ?? "updated_at_desc";
  if (sort !== "updated_at_desc") {
    throw new PresentationReadApiQueryError("sort must be updated_at_desc");
  }
  return {
    offset: integer(search.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER, "offset"),
    limit: integer(search.get("limit"), 50, 1, 100, "limit"),
    sort
  } as const;
}

function integer(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string
) {
  if (value === null) return fallback;
  if (!/^\d+$/u.test(value)) {
    throw new PresentationReadApiQueryError(`${name} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new PresentationReadApiQueryError(`${name} is out of range`);
  }
  return parsed;
}

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export { BASE_PATH as READ_ONLY_PRESENTATION_API_BASE_PATH };
