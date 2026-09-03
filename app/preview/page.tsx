import { OpportunityListView } from "@/lib/p2-08-preview/presentation";
import {
  loadPreviewOpportunities,
  loadPreviewSources,
  type PreviewOpportunityQuery
} from "@/lib/p2-08-preview/read-only-data";
import type { ObservationState } from "@/lib/read-only-api";
import React from "react";

interface PreviewPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PreviewPage({ searchParams }: PreviewPageProps) {
  const parameters = await searchParams;
  const query: PreviewOpportunityQuery = {
    keyword: single(parameters.keyword),
    organization: single(parameters.organization),
    source: single(parameters.source),
    observation_state: observationState(single(parameters.observation_state)),
    offset: nonNegativeInteger(single(parameters.offset), 0),
    limit: boundedLimit(single(parameters.limit), 10)
  };
  const [result, sources] = await Promise.all([
    loadPreviewOpportunities(query),
    loadPreviewSources()
  ]);
  return (
    <OpportunityListView
      opportunities={result.opportunities}
      pagination={result.pagination}
      sources={sources}
      query={query}
    />
  );
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function observationState(value: string | undefined): ObservationState | undefined {
  if (value === "OBSERVED" || value === "PARTIAL" || value === "SUSPICIOUS_EMPTY" || value === "UNAVAILABLE") {
    return value;
  }
  return undefined;
}

function nonNegativeInteger(value: string | undefined, fallback: number) {
  if (!value || !/^\d+$/u.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function boundedLimit(value: string | undefined, fallback: number) {
  const parsed = nonNegativeInteger(value, fallback);
  return parsed >= 1 && parsed <= 100 ? parsed : fallback;
}
