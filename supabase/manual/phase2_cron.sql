-- Optional owner step (docs/contract.md section 11, Phase 2 B4 and "Owner setup" 4; D-25).
-- NOT a migration: `supabase db push` never runs this folder.
-- Prerequisites (Dashboard): enable the pg_cron and pg_net extensions, and add
-- the Vault secrets `worker_url` (<SUPABASE_URL>/functions/v1/worker) and
-- `worker_token` (the WORKER_TOKEN value, D-30; never the service-role key).
-- Never paste a secret into this file.
-- Paste this whole script into the SQL Editor and run it. Re-runnable:
-- each job is unscheduled by name if present, then scheduled again.
-- Check: select jobname, schedule from cron.job;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'fm-worker-tick') then
    perform cron.unschedule('fm-worker-tick');
  end if;
  if exists (select 1 from cron.job where jobname = 'fm-rate-limit-purge') then
    perform cron.unschedule('fm-rate-limit-purge');
  end if;
end $$;

select cron.schedule('fm-worker-tick', '10 seconds', 'select public.kick_worker()');
select cron.schedule('fm-rate-limit-purge', '0 * * * *', 'select public.purge_rate_limits()');
