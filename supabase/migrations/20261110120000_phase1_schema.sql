-- Phase 1 schema (docs/contract.md section 5). Additive and idempotent:
-- no drop table / drop column / data rewrite. Re-runnable on a clean or
-- partially applied database.
--
-- Access model:
--   * every table has RLS enabled;
--   * authenticated users may only `select` rows where user_id = auth.uid();
--   * all writes go through server code using the service role (bypasses RLS);
--   * jobs.state is never selectable by the owner (column grant excludes it);
--   * rate_limits has no policies at all (service role only).

-- Enums --------------------------------------------------------------------
do $$ begin
  create type public.project_status as enum ('pending', 'valid', 'invalid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.detected_kind as enum ('website', 'app');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.analysis_status as enum
    ('queued', 'validating', 'scanning', 'analyzing', 'done', 'failed', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_kind as enum ('analyze', 'generate');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_status as enum ('queued', 'running', 'done', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.trigger_kind as enum ('webhook', 'schedule', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.risk_level as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.recommendation_status as enum ('new', 'selected', 'generated');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.flow_status as enum ('generating', 'ready', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.test_level as enum ('valid', 'simulated');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.usage_kind as enum ('analysis', 'generation');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.finding_severity as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

-- github_installations --------------------------------------------------------
create table if not exists public.github_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  installation_id bigint not null check (installation_id > 0),
  account_login text not null check (char_length(account_login) between 1 and 255),
  created_at timestamptz not null default now(),
  unique (user_id, installation_id),
  -- Target of the composite FK from projects (same-user installation only).
  unique (id, user_id)
);
comment on table public.github_installations is
  'GitHub App installations linked by a user. Only the numeric installation id is stored, never a token.';

create index if not exists github_installations_user_id_idx
  on public.github_installations (user_id);
create index if not exists github_installations_installation_id_idx
  on public.github_installations (installation_id);

alter table public.github_installations enable row level security;

drop policy if exists "github_installations_select_own" on public.github_installations;
create policy "github_installations_select_own"
  on public.github_installations for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.github_installations from anon, authenticated;
grant select on table public.github_installations to authenticated;

-- projects --------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The one FK that does not cascade: a removed installation leaves the
  -- project in place with installation_id = null (reconnect prompt in the UI).
  -- Composite FK (below) also forces the installation to belong to the same user.
  installation_id uuid,
  repo_full_name text not null check (repo_full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  default_branch text not null check (char_length(default_branch) between 1 and 255),
  status public.project_status not null default 'pending',
  invalid_reason text,
  detected_kind public.detected_kind,
  last_commit_sha text check (last_commit_sha is null or last_commit_sha ~ '^[0-9a-f]{40}$'),
  stale boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, repo_full_name),
  constraint projects_installation_same_user_fkey
    foreign key (installation_id, user_id)
    references public.github_installations (id, user_id)
    on delete set null (installation_id)
);
comment on table public.projects is 'A connected repository. Holds derived state only, never source code.';

create index if not exists projects_user_id_idx on public.projects (user_id);
create index if not exists projects_installation_id_idx on public.projects (installation_id);

alter table public.projects enable row level security;

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own"
  on public.projects for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.projects from anon, authenticated;
grant select on table public.projects to authenticated;

-- analyses --------------------------------------------------------------------
create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status public.analysis_status not null default 'queued',
  progress integer not null default 0 check (progress between 0 and 100),
  commit_sha text check (commit_sha is null or commit_sha ~ '^[0-9a-f]{40}$'),
  files_considered integer not null default 0 check (files_considered >= 0),
  files_read integer not null default 0 check (files_read >= 0),
  files_blocked integer not null default 0 check (files_blocked >= 0),
  files_blocked_by_reason jsonb not null default '{"denied":0,"extension":0,"size":0}'::jsonb,
  files_skipped_budget integer not null default 0 check (files_skipped_budget >= 0),
  error_code text,
  started_at timestamptz,
  finished_at timestamptz
);
comment on table public.analyses is 'One analysis run of a project. Counts and status only; no file text.';

create index if not exists analyses_project_id_idx on public.analyses (project_id);
create index if not exists analyses_user_id_idx on public.analyses (user_id);

alter table public.analyses enable row level security;

drop policy if exists "analyses_select_own" on public.analyses;
create policy "analyses_select_own"
  on public.analyses for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.analyses from anon, authenticated;
grant select on table public.analyses to authenticated;

-- jobs ------------------------------------------------------------------------
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind public.job_kind not null,
  ref_id uuid not null,
  status public.job_status not null default 'queued',
  step text not null,
  state jsonb not null default '{}'::jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.jobs is
  'Chunked background job rows (contract section 4). state is worker-only and cleared on done/failed.';
comment on column public.jobs.state is
  'Worker-only temporary state (selected paths, batch cursor, redacted snippets). Never granted to clients.';

create index if not exists jobs_user_id_idx on public.jobs (user_id);
create index if not exists jobs_ref_id_idx on public.jobs (ref_id);
-- Claim query (Phase 2): status = 'queued' and run_after <= now() order by created_at.
create index if not exists jobs_claim_idx on public.jobs (status, run_after, created_at);

alter table public.jobs enable row level security;

drop policy if exists "jobs_select_own" on public.jobs;
create policy "jobs_select_own"
  on public.jobs for select to authenticated
  using ((select auth.uid()) = user_id);

-- Column grant: everything except state.
revoke all on table public.jobs from anon, authenticated;
grant select (
  id, user_id, kind, ref_id, status, step, attempts, max_attempts, run_after,
  locked_at, locked_by, last_error_code, created_at, updated_at
) on table public.jobs to authenticated;

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row
  execute function public.set_updated_at();

-- security_findings -----------------------------------------------------------
create table if not exists public.security_findings (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (char_length(category) between 1 and 64),
  severity public.finding_severity not null,
  file_path text not null check (char_length(file_path) between 1 and 1024),
  line integer check (line is null or line >= 1),
  masked_evidence text not null check (char_length(masked_evidence) <= 200),
  remediation text not null check (char_length(remediation) <= 1000)
);
comment on table public.security_findings is 'Masked findings only. Raw secret values are never stored.';

create index if not exists security_findings_analysis_id_idx on public.security_findings (analysis_id);
create index if not exists security_findings_user_id_idx on public.security_findings (user_id);

alter table public.security_findings enable row level security;

drop policy if exists "security_findings_select_own" on public.security_findings;
create policy "security_findings_select_own"
  on public.security_findings for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.security_findings from anon, authenticated;
grant select on table public.security_findings to authenticated;

-- recommendations -------------------------------------------------------------
create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  description text not null check (char_length(description) between 1 and 600),
  trigger_kind public.trigger_kind not null,
  confidence real not null check (confidence between 0 and 1),
  source_files text[] not null default '{}',
  required_credentials text[] not null default '{}',
  risk_level public.risk_level not null,
  estimated_tokens integer not null default 0 check (estimated_tokens >= 0),
  status public.recommendation_status not null default 'new'
);

create index if not exists recommendations_analysis_id_idx on public.recommendations (analysis_id);
create index if not exists recommendations_user_id_idx on public.recommendations (user_id);

alter table public.recommendations enable row level security;

drop policy if exists "recommendations_select_own" on public.recommendations;
create policy "recommendations_select_own"
  on public.recommendations for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.recommendations from anon, authenticated;
grant select on table public.recommendations to authenticated;

-- flows -----------------------------------------------------------------------
create table if not exists public.flows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recommendation_id uuid not null references public.recommendations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  flow_spec jsonb,
  n8n_json jsonb,
  setup_checklist jsonb,
  catalog_version text,
  n8n_version text,
  status public.flow_status not null default 'generating',
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists flows_user_id_idx on public.flows (user_id);
create index if not exists flows_recommendation_id_idx on public.flows (recommendation_id);

alter table public.flows enable row level security;

drop policy if exists "flows_select_own" on public.flows;
create policy "flows_select_own"
  on public.flows for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.flows from anon, authenticated;
grant select on table public.flows to authenticated;

-- flow_test_runs --------------------------------------------------------------
create table if not exists public.flow_test_runs (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  level public.test_level not null,
  passed boolean not null,
  results jsonb not null default '{}'::jsonb,
  simulator_version text not null,
  created_at timestamptz not null default now(),
  -- Simulated is only earned by a passing run (docs/testing.md).
  check (level <> 'simulated' or passed)
);

create index if not exists flow_test_runs_flow_id_idx on public.flow_test_runs (flow_id);
create index if not exists flow_test_runs_user_id_idx on public.flow_test_runs (user_id);

alter table public.flow_test_runs enable row level security;

drop policy if exists "flow_test_runs_select_own" on public.flow_test_runs;
create policy "flow_test_runs_select_own"
  on public.flow_test_runs for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.flow_test_runs from anon, authenticated;
grant select on table public.flow_test_runs to authenticated;

-- usage_events (log only, no limits) -----------------------------------------
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind public.usage_kind not null,
  tokens_in integer not null default 0 check (tokens_in >= 0),
  tokens_out integer not null default 0 check (tokens_out >= 0),
  ref_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_id_idx on public.usage_events (user_id);

alter table public.usage_events enable row level security;

drop policy if exists "usage_events_select_own" on public.usage_events;
create policy "usage_events_select_own"
  on public.usage_events for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.usage_events from anon, authenticated;
grant select on table public.usage_events to authenticated;

-- audit_log -------------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (char_length(action) between 1 and 64),
  ref text check (ref is null or char_length(ref) <= 255),
  created_at timestamptz not null default now()
);

create index if not exists audit_log_user_id_idx on public.audit_log (user_id);

alter table public.audit_log enable row level security;

drop policy if exists "audit_log_select_own" on public.audit_log;
create policy "audit_log_select_own"
  on public.audit_log for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.audit_log from anon, authenticated;
grant select on table public.audit_log to authenticated;

-- rate_limits (service role only) --------------------------------------------
create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0 check (count >= 0)
);
comment on table public.rate_limits is
  'Fixed-window counters keyed rl:<route>:<subject>:<window> and daily:<kind>:<user>:<day>. No client access.';

-- Purge query (Phase 2 pg_cron tick): window_start < now() - interval '48 hours'.
create index if not exists rate_limits_window_start_idx on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;
-- No policies on purpose: anon and authenticated can never touch this table.
revoke all on table public.rate_limits from anon, authenticated;

-- Atomic hit: upsert count + 1, return whether the caller is still within the
-- limit. The window is part of the key, so window_start is informational
-- (used for purging).
create or replace function public.rate_limit_hit(p_key text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = r.count + 1
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer) to service_role;

-- delete_project: atomic project delete (contract section 5, review R1-1) ----
-- jobs.ref_id is polymorphic (analysis or flow id) and has no FK, so the
-- cascade from projects never reaches jobs. This function removes the
-- project's jobs and the project in one transaction; the FK cascade removes
-- analyses, findings, recommendations, flows and test runs. Job rows are
-- locked first so a worker step holding one cannot resurrect rows mid-delete.
-- Returns false when no project with that id belongs to the user.
create or replace function public.delete_project(p_user_id uuid, p_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref_ids uuid[];
begin
  perform 1
    from public.projects
   where id = p_project_id and user_id = p_user_id
     for update;
  if not found then
    return false;
  end if;

  select coalesce(array_agg(ref_id), '{}') into v_ref_ids
    from (
      select a.id as ref_id
        from public.analyses a
       where a.project_id = p_project_id and a.user_id = p_user_id
      union all
      select f.id
        from public.flows f
        join public.recommendations r on r.id = f.recommendation_id
        join public.analyses a on a.id = r.analysis_id
       where a.project_id = p_project_id and a.user_id = p_user_id
    ) refs;

  perform 1
    from public.jobs
   where user_id = p_user_id and ref_id = any (v_ref_ids)
     for update;

  delete from public.jobs
   where user_id = p_user_id and ref_id = any (v_ref_ids);

  delete from public.projects
   where id = p_project_id and user_id = p_user_id;

  return true;
end;
$$;

revoke all on function public.delete_project(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_project(uuid, uuid) to service_role;
