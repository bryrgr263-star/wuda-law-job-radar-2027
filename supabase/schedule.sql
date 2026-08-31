-- 在 Supabase SQL Editor 执行。先替换 URL 和 CRON_SECRET。
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'wuda-law-job-radar-every-6-hours',
  '0 */6 * * *',
  $$
  select net.http_get(
    url := 'https://YOUR-SITE.vercel.app/api/cron/sync',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET')
  );
  $$
);
