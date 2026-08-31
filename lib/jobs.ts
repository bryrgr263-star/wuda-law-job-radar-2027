import { demoJobs } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import type { ApplicationProgress, Job } from "@/lib/types";

export async function getJobs(): Promise<Job[]> {
  const supabase = await createClient();
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

export async function getProgress(): Promise<{ authenticated: boolean; progress: ApplicationProgress[] }> {
  const supabase = await createClient();
  if (!supabase) return { authenticated: false, progress: [] };

  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return { authenticated: false, progress: [] };

  const { data } = await supabase
    .from("applications")
    .select("job_id,status,favorite,notes,applied_at,updated_at")
    .eq("user_id", authData.user.id);

  return { authenticated: true, progress: (data ?? []) as ApplicationProgress[] };
}
