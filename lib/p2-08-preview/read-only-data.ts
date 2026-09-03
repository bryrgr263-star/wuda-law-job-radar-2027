import path from "node:path";

import {
  composeReadOnlyIngestionRuntime,
  READ_ONLY_INGESTION_API_BASE_PATH,
  type ObservationState,
  type OpportunityDetailProjection,
  type OpportunityProjection,
  type ReadOnlyPagination,
  type SourceProjection
} from "../read-only-api";

export interface PreviewOpportunityQuery {
  readonly keyword?: string;
  readonly organization?: string;
  readonly source?: string;
  readonly observation_state?: ObservationState;
  readonly offset?: number;
  readonly limit?: number;
}

export interface PreviewOpportunityList {
  readonly pagination: ReadOnlyPagination;
  readonly opportunities: readonly OpportunityProjection[];
}

export async function loadPreviewOpportunities(
  query: PreviewOpportunityQuery = {}
): Promise<PreviewOpportunityList> {
  const parameters = new URLSearchParams();
  addText(parameters, "keyword", query.keyword);
  addText(parameters, "organization", query.organization);
  addText(parameters, "source", query.source);
  addText(parameters, "observation_state", query.observation_state);
  if (query.offset !== undefined) parameters.set("offset", String(query.offset));
  if (query.limit !== undefined) parameters.set("limit", String(query.limit));
  return requestProjection<PreviewOpportunityList>(`/opportunities?${parameters.toString()}`);
}

export async function loadPreviewOpportunity(
  opportunityId: string
): Promise<OpportunityDetailProjection | null> {
  const response = await invokeP207(new Request(
    `https://p2-08-preview.invalid${READ_ONLY_INGESTION_API_BASE_PATH}/opportunities/${encodeURIComponent(opportunityId)}`
  ));
  if (response.status === 404) return null;
  return parseResponse<OpportunityDetailProjection>(response);
}

export async function loadPreviewSources(): Promise<readonly SourceProjection[]> {
  const response = await requestProjection<{ readonly sources: readonly SourceProjection[] }>("/sources");
  return response.sources;
}

export async function handlePreviewApiRequest(request: Request) {
  return invokeP207(request);
}

async function requestProjection<T>(relativePath: string): Promise<T> {
  const response = await invokeP207(new Request(
    `https://p2-08-preview.invalid${READ_ONLY_INGESTION_API_BASE_PATH}${relativePath}`
  ));
  return parseResponse<T>(response);
}

async function invokeP207(request: Request) {
  const runtime = composeReadOnlyIngestionRuntime({
    database_path: path.join(
      process.cwd(),
      "immutable-preview",
      "p2-07",
      "beijing-official-preview.sqlite"
    ),
    manifest_path: path.join(
      process.cwd(),
      "immutable-preview",
      "p2-07",
      "beijing-official-preview.manifest.json"
    )
  });
  try {
    return await runtime.handle(request);
  } finally {
    runtime.close();
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { readonly error?: string; readonly message?: string };
  if (!response.ok) {
    throw new Error(body.message ?? body.error ?? `P2-07 read-only API returned ${response.status}`);
  }
  return body;
}

function addText(parameters: URLSearchParams, name: string, value: string | undefined) {
  if (value && value.trim().length > 0) parameters.set(name, value.trim());
}
