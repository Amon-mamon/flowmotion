-- Phase 2: analysis pipeline (docs/contract.md sections 4, 5 and 11 B3; D-17, D-25).
-- Append-only (D-19): earlier migrations are never edited.
-- Runs ONCE as one script in the Supabase SQL Editor: no meta-commands, no
-- CLI-only syntax, every statement guarded so an accidental re-run is
-- harmless. Creates NO extensions and NO cron jobs (D-25): pg_cron, pg_net,
-- the Vault secrets and supabase/manual/phase2_cron.sql are optional owner
-- steps. Holds no secret values.

-- analyses: per-analysis validation, signals, cap reason ----------------------
alter table public.analyses add column if not exists validation jsonb;
alter table public.analyses add column if not exists signals jsonb;

update public.analyses set signals = '[]'::jsonb where signals is null;

alter table public.analyses alter column signals set default '[]'::jsonb;
alter table public.analyses alter column signals set not null;

do $$ begin
  alter table public.analyses
    add constraint analyses_signals_array
    check (jsonb_typeof(signals) = 'array' and jsonb_array_length(signals) <= 500);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.analyses
    add constraint analyses_validation_object
    check (validation is null or jsonb_typeof(validation) = 'object');
exception when duplicate_object then null; end $$;

alter table public.analyses
  alter column files_blocked_by_reason
  set default '{"denied":0,"extension":0,"size":0,"cap":0}'::jsonb;

comment on column public.analyses.validation is
  'Validity result { kind, reason } written by the validate step.';
comment on column public.analyses.signals is
  'Signal[] (derived data: paths, names, cron expressions; never source text), written by detect. Max 500.';

-- At most one active analysis per project.
create unique index if not exists analyses_one_active_per_project
  on public.analyses (project_id)
  where status in ('queued', 'validating', 'scanning', 'analyzing');

-- recommendations: node types and rationale from the draft ---------------------
alter table public.recommendations add column if not exists node_types text[];
update public.recommendations set node_types = '{}' where node_types is null;
alter table public.recommendations alter column node_types set default '{}';
alter table public.recommendations alter column node_types set not null;

alter table public.recommendations add column if not exists rationale text;
update public.recommendations set rationale = '' where rationale is null;
alter table public.recommendations alter column rationale set default '';
alter table public.recommendations alter column rationale set not null;

do $$ begin
  alter table public.recommendations
    add constraint recommendations_rationale_length check (char_length(rationale) <= 400);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.recommendations
    add constraint recommendations_node_types_count check (coalesce(array_length(node_types, 1), 0) <= 40);
exception when duplicate_object then null; end $$;

-- jobs: one job row per analysis or flow (worker idempotence) ------------------
create unique index if not exists jobs_kind_ref_id_key on public.jobs (kind, ref_id);
-- Stale-lock scan of claim_job().
create index if not exists jobs_running_locked_at_idx on public.jobs (locked_at) where status = 'running';

-- claim_job(): claim one due job (contract section 5) ---------------------------
-- In one transaction: re-queue running jobs whose lock is older than 2 minutes
-- (crashed worker), then take the oldest due queued job with
-- FOR UPDATE SKIP LOCKED and mark it running under this worker id.
create or replace function public.claim_job(p_worker_id text)
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

  update public.jobs j
     set status = 'queued',
         locked_at = null,
         locked_by = null
   where j.id in (
     select s.id
       from public.jobs s
      where s.status = 'running'
        and s.locked_at < now() - interval '2 minutes'
      for update skip locked
   );

  select j.id into v_id
    from public.jobs j
   where j.status = 'queued'
     and j.run_after <= now()
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

revoke all on function public.claim_job(text) from public, anon, authenticated;
grant execute on function public.claim_job(text) to service_role;

-- purge_rate_limits(): delete limiter rows older than 48 hours -----------------
create or replace function public.purge_rate_limits()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.rate_limits r
   where r.window_start < now() - interval '48 hours';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_rate_limits() from public, anon, authenticated;
grant execute on function public.purge_rate_limits() to service_role;

-- kick_worker(): optional pg_cron tick target (D-25) ---------------------------
-- Does nothing (returns false) unless pg_net is installed, Vault holds both
-- worker_url and worker_token, and a job is due. Secret values are read from
-- Vault at call time and never stored here.
create or replace function public.kick_worker()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_net') then
    return false;
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    return false;
  end if;

  if not exists (
    select 1 from public.jobs j
     where (j.status = 'queued' and j.run_after <= now())
        or (j.status = 'running' and j.locked_at < now() - interval '2 minutes')
  ) then
    return false;
  end if;

  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
     into v_url using 'worker_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
     into v_token using 'worker_token';
  if v_url is null or v_url = '' or v_token is null or v_token = '' then
    return false;
  end if;

  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
    using v_url,
          '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token);
  return true;
end;
$$;

revoke all on function public.kick_worker() from public, anon, authenticated;
grant execute on function public.kick_worker() to service_role;

-- link_github_installations(): S11-7 / R11-11 advisory lock --------------------
-- Identical to 20261113120000_phase1_1_repo_access.sql except the first
-- statement: a per-user transaction advisory lock, so two concurrent
-- callbacks of a user with no installation rows yet (nothing to lock FOR
-- UPDATE) are serialised too.
create or replace function public.link_github_installations(
  p_user_id uuid,
  p_github_user_id bigint,
  p_github_user_login text,
  p_installations jsonb
)
returns table (installation_id bigint, inserted boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_item jsonb;
  v_github_id bigint;
  v_row_id uuid;
  v_inserted boolean;
  v_listed bigint[] := '{}';
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if p_user_id is null or p_github_user_id is null or p_github_user_id <= 0
     or p_github_user_login is null or char_length(p_github_user_login) = 0
     or p_installations is null or jsonb_typeof(p_installations) <> 'array' then
    raise exception 'invalid_arguments';
  end if;

  -- Serialise concurrent callbacks of the same user.
  perform 1 from public.github_installations g where g.user_id = p_user_id for update;

  if exists (
    select 1 from public.github_installations g
     where g.user_id = p_user_id
       and g.github_user_id is not null
       and g.github_user_id <> p_github_user_id
  ) then
    raise exception 'github_account_mismatch';
  end if;

  for v_item in select value from jsonb_array_elements(p_installations) loop
    v_github_id := (v_item ->> 'installationId')::bigint;

    insert into public.github_installations as g
      (user_id, installation_id, account_login, github_user_id, github_user_login, repos_synced_at)
    values
      (p_user_id, v_github_id, v_item ->> 'accountLogin', p_github_user_id, p_github_user_login, now())
    on conflict on constraint github_installations_user_id_installation_id_key do update
      set account_login = excluded.account_login,
          github_user_id = excluded.github_user_id,
          github_user_login = excluded.github_user_login,
          repos_synced_at = excluded.repos_synced_at
    returning g.id, (g.xmax = 0) into v_row_id, v_inserted;

    -- Replace, never merge.
    delete from public.github_installation_repos r where r.installation_id = v_row_id;
    insert into public.github_installation_repos
      (user_id, installation_id, repo_id, repo_full_name, private, default_branch)
    select p_user_id, v_row_id, (repo ->> 'id')::bigint, repo ->> 'fullName',
           (repo ->> 'private')::boolean, repo ->> 'defaultBranch'
      from jsonb_array_elements(coalesce(v_item -> 'repos', '[]'::jsonb)) as repo
    on conflict do nothing;

    v_listed := v_listed || v_github_id;
    installation_id := v_github_id;
    inserted := v_inserted;
    return next;
  end loop;

  -- Installations this GitHub user no longer sees: clear their sets.
  delete from public.github_installation_repos r
   using public.github_installations g
   where r.installation_id = g.id
     and g.user_id = p_user_id
     and not (g.installation_id = any (v_listed));
  update public.github_installations g
     set repos_synced_at = null
   where g.user_id = p_user_id
     and not (g.installation_id = any (v_listed));
end;
$$;

revoke all on function public.link_github_installations(uuid, bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.link_github_installations(uuid, bigint, text, jsonb) to service_role;
