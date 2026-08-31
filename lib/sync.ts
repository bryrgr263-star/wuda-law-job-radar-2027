import { crawlSource } from "@/lib/crawler";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CrawlSource } from "@/lib/types";

export type SyncResult = {
  ok: boolean;
  sources: number;
  discovered: number;
  upserted: number;
  closed: number;
  failures: Array<{ source: string; error: string }>;
};

function todayInChina() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function crawlWithRetry(source: CrawlSource) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await crawlSource(source);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw lastError;
}

export async function runJobSync(): Promise<SyncResult> {
  const admin = createAdminClient();
  if (!admin) throw new Error("Supabase admin client is not configured");

  const startedAt = new Date().toISOString();
  const { data: sourceRows, error: sourceError } = await admin
    .from("sources")
    .select("*")
    .eq("enabled", true)
    .limit(100);
  if (sourceError) throw new Error(sourceError.message);

  let discovered = 0;
  let upserted = 0;
  let closed = 0;
  const failures: Array<{ source: string; error: string }> = [];

  const { data: expiredJobs, error: closeError } = await admin
    .from("jobs")
    .update({ recruitment_status: "已截止" })
    .eq("recruitment_year", 2027)
    .lt("deadline", todayInChina())
    .not("recruitment_status", "in", "(已截止,已关闭)")
    .select("job_id");
  if (closeError) throw new Error(`Failed to close expired jobs: ${closeError.message}`);
  closed = expiredJobs?.length ?? 0;

  for (const source of (sourceRows ?? []) as CrawlSource[]) {
    try {
      const jobs = await crawlWithRetry(source);
      discovered += jobs.length;
      if (jobs.length) {
        const payload = jobs.map((job) => ({
          job_id: job.job_id,
          announcement_url: job.announcement_url,
          application_url: job.application_url,
          unit_name: job.unit_name,
          unit_type: job.unit_type,
          system_name: job.system_name,
          industry: job.industry,
          location: job.location,
          title: job.title,
          direction: job.direction,
          recruitment_year: job.recruitment_year,
          batch: job.batch,
          education: job.education,
          non_law_rule: job.non_law_rule,
          match_score: job.match_score,
          salary: job.salary,
          development: job.development,
          start_date: job.start_date,
          deadline: job.deadline,
          recruitment_status: job.recruitment_status,
          source_status: job.source_status,
          source_name: job.source_name,
          source_updated_at: job.source_updated_at,
          is_published: true,
          content_hash: `${job.title}|${job.deadline}|${job.non_law_rule}|${job.recruitment_status}`
        }));
        const { error } = await admin.from("jobs").upsert(payload, { onConflict: "job_id" });
        if (error) throw new Error(error.message);
        upserted += jobs.length;
      }
      await admin
        .from("sources")
        .update({ last_checked_at: new Date().toISOString(), last_error: null })
        .eq("id", source.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ source: source.name, error: message });
      await admin
        .from("sources")
        .update({ last_checked_at: new Date().toISOString(), last_error: message })
        .eq("id", source.id);
    }
  }

  const result: SyncResult = {
    ok: failures.length < (sourceRows?.length ?? 0) || (sourceRows?.length ?? 0) === 0,
    sources: sourceRows?.length ?? 0,
    discovered,
    upserted,
    closed,
    failures
  };

  await admin.from("sync_runs").insert({
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    source_count: result.sources,
    discovered_count: result.discovered,
    upserted_count: result.upserted,
    failure_count: result.failures.length,
    details: result.failures
  });

  return result;
}
