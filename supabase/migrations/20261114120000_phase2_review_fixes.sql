-- Phase 2 review fixes (docs/contract.md sections 5 and 11 "Phase 2 review
-- fixes" item 1; D-27, D-29). Append-only (D-19): earlier migrations are
-- never edited. Runs ONCE as one script in the Supabase SQL Editor; every
-- statement is guarded so an accidental re-run is harmless. Creates no
-- extensions and no cron jobs. Holds no secret values.

-- expire_stale_jobs(): 1-hour job TTL (D-29) ----------------------------------
-- Fails every queued/running job not updated for 1 hour: state cleared,
-- JOB_EXPIRED, lock cleared; the referenced analysis (still active) or flow
-- (still generating) is failed with JOB_EXPIRED. Returns the number expired.
create or replace function public.expire_stale_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_refs uuid[];
begin
  with expired as (
    update public.jobs j
       set status = 'failed',
           state = '{}'::jsonb,
           last_error_code = 'JOB_EXPIRED',
           locked_at = null,
           locked_by = null
     where j.id in (
       select s.id
         from public.jobs s
        where s.status in ('queued', 'running')
          and s.updated_at < now() - interval '1 hour'
        for update skip locked
     )
    returning j.id, j.ref_id
  )
  select coalesce(array_agg(e.id), '{}'), coalesce(array_agg(e.ref_id), '{}')
    into v_ids, v_refs
    from expired e;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return 0;
  end if;

  update public.analyses a
     set status = 'failed',
         error_code = 'JOB_EXPIRED',
         finished_at = now()
   where a.id = any (v_refs)
     and a.status in ('queued', 'validating', 'scanning', 'analyzing');

  update public.flows f
     set status = 'failed',
         error_code = 'JOB_EXPIRED'
   where f.id = any (v_refs)
     and f.status = 'generating';

  return array_length(v_ids, 1);
end;
$$;

revoke all on function public.expire_stale_jobs() from public, anon, authenticated;
grant execute on function public.expire_stale_jobs() to service_role;

-- claim_job(p_worker_id, p_user_id): optional per-user filter (D-27) ----------
-- Drop the one-argument version first: a second parameter with a default
-- would otherwise create an ambiguous overload.
drop function if exists public.claim_job(text);

create or replace function public.claim_job(p_worker_id text, p_user_id uuid default null)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_row public.jobs;
begin
  if p_worker_id is null or char_length(p_worker_id) = 0 or char_length(p_worker_id) > 128 then
    raise exception 'invalid_arguments';
  end if;

  -- Global sweep first (D-29), so no stale state outlives a worker call.
  perform public.expire_stale_jobs();

  -- Crashed workers: re-queue running jobs whose lock is older than 2 minutes.
  update public.jobs j
     set status = 'queued',
         locked_at = null,
         locked_by = null
   where j.id in (
     select s.id
       from public.jobs s
      where s.status = 'running'
        and s.locked_at < now() - interval '2 minutes'
        and (p_user_id is null or s.user_id = p_user_id)
      for update skip locked
   );

  select j.id into v_id
    from public.jobs j
   where j.status = 'queued'
     and j.run_after <= now()
     and (p_user_id is null or j.user_id = p_user_id)
   order by j.created_at
   limit 1
   for update skip locked;

  if v_id is null then
    return;
  end if;

  update public.jobs j
     set status = 'running',
         locked_at = now(),
         locked_by = p_worker_id,
         attempts = j.attempts + 1
   where j.id = v_id
  returning j.* into v_row;

  return next v_row;
  return;
end;
$$;

revoke all on function public.claim_job(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_job(text, uuid) to service_role;
