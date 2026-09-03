import { notFound } from "next/navigation";
import React from "react";

import { OpportunityDetailView } from "@/lib/p2-08-preview/presentation";
import { loadPreviewOpportunity } from "@/lib/p2-08-preview/read-only-data";

interface PreviewOpportunityPageProps {
  readonly params: Promise<{ readonly opportunityId: string }>;
}

export default async function PreviewOpportunityPage({ params }: PreviewOpportunityPageProps) {
  const route = await params;
  const detail = await loadPreviewOpportunity(decodeRouteSegment(route.opportunityId));
  if (!detail) notFound();
  return <OpportunityDetailView detail={detail} />;
}

function decodeRouteSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
