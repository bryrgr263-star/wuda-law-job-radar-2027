import { JobBoard } from "@/components/job-board";
import { getJobs } from "@/lib/jobs";

export const revalidate = 300;

export default async function HomePage() {
  return <JobBoard initialJobs={await getJobs()} />;
}
