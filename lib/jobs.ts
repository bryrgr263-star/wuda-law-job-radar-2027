import { demoJobs } from "@/lib/demo-data";
import { createPublicClient } from "@/lib/supabase/public";
import type { Job } from "@/lib/types";

export async function getJobs(): Promise<Job[]> {
  const supabase = createPublicClient();
  if (!supabase) return demoJobs;

  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("recruitment_year", 2027)
    .eq("is_published", true)
    .order("match_score", { ascending: false })
    .order("deadline", { ascending: true, nullsFirst: false });

  if (error) {
    console.error("Failed to load jobs", error.message);
    return demoJobs;
  }
  return (data ?? []) as Job[];
}
