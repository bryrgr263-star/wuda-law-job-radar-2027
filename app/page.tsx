import { JobBoard } from "@/components/job-board";
import { getJobs, getProgress } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [jobs, auth] = await Promise.all([getJobs(), getProgress()]);
  return <JobBoard initialJobs={jobs} authenticated={auth.authenticated} initialProgress={auth.progress} />;
}
