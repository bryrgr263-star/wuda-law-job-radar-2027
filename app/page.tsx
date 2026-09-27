import React from "react";
import { unstable_noStore as noStore } from "next/cache";

export const revalidate = 300;

export default async function HomePage() {
  if (process.env.PRESENTATION_WEB_PREPARATION === "ENABLED") {
    noStore();
    const { JobBoard } = await import("@/components/job-board");
    const { loadPresentationBoard } = await import("@/lib/presentation-web/loader");
    return <JobBoard initialJobs={await loadPresentationBoard(process.cwd(), process.env.PRODUCTION_STREAM_ID)} />;
  }
  const { LegacyJobBoard } = await import("@/components/legacy-job-board");
  const { getJobs } = await import("@/lib/jobs");
  return <LegacyJobBoard initialJobs={await getJobs()} />;
}
