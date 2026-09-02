import { ReadOnlyIngestionProjection } from "./projection";
import {
  READ_ONLY_INGESTION_API_BASE_PATH,
  type ObservationState,
  ReadOnlyApiRequestError,
  ReadOnlyProjectionIntegrityError
} from "./types";

export class ReadOnlyIngestionApi {
  readonly #projection: ReadOnlyIngestionProjection;

  constructor(projection: ReadOnlyIngestionProjection) {
    this.#projection = projection;
  }

  async handle(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
    }
    try {
      const url = new URL(request.url);
      if (url.pathname === `${READ_ONLY_INGESTION_API_BASE_PATH}/opportunities`) {
        return json(this.#projection.listOpportunities({
          keyword: optionalText(url.searchParams.get("keyword")),
          organization: optionalText(url.searchParams.get("organization")),
          source: optionalText(url.searchParams.get("source")),
          observation_state: optionalObservationState(url.searchParams.get("observation_state")),
          offset: optionalInteger(url.searchParams.get("offset"), "offset"),
          limit: optionalInteger(url.searchParams.get("limit"), "limit")
        }));
      }
      if (url.pathname.startsWith(`${READ_ONLY_INGESTION_API_BASE_PATH}/opportunities/`)) {
        const opportunityId = decodeURIComponent(url.pathname.slice(`${READ_ONLY_INGESTION_API_BASE_PATH}/opportunities/`.length));
        if (!opportunityId || opportunityId.includes("/")) {
          throw new ReadOnlyApiRequestError("Opportunity identifier is required");
        }
        const detail = this.#projection.opportunityDetail(opportunityId);
        return detail ? json(detail) : json({ error: "not_found" }, 404);
      }
      if (url.pathname === `${READ_ONLY_INGESTION_API_BASE_PATH}/sources`) {
        return json({ sources: this.#projection.listSources() });
      }
      if (url.pathname === `${READ_ONLY_INGESTION_API_BASE_PATH}/source-health`) {
        return json({ source_health: this.#projection.listSourceHealth() });
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
      if (error instanceof ReadOnlyApiRequestError) {
        return json({ error: "invalid_request", message: error.message }, 400);
      }
      if (error instanceof ReadOnlyProjectionIntegrityError) {
        return json({ error: "projection_integrity_error", message: error.message }, 500);
      }
      throw error;
    }
  }
}

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers }
  });
}

function optionalText(value: string | null) {
  if (value === null || value.trim() === "") return undefined;
  return value;
}

function optionalInteger(value: string | null, name: string) {
  if (value === null) return undefined;
  if (!/^\d+$/u.test(value)) {
    throw new ReadOnlyApiRequestError(`${name} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ReadOnlyApiRequestError(`${name} must be a safe integer`);
  }
  if (name === "limit" && (parsed < 1 || parsed > 100)) {
    throw new ReadOnlyApiRequestError("limit must be between 1 and 100");
  }
  return parsed;
}

function optionalObservationState(value: string | null): ObservationState | undefined {
  if (value === null || value === "") return undefined;
  if (value === "OBSERVED" || value === "PARTIAL" || value === "SUSPICIOUS_EMPTY" || value === "UNAVAILABLE") {
    return value;
  }
  throw new ReadOnlyApiRequestError("observation_state is not supported");
}
