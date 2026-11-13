-- Phase 1.1 security fixes: per-user, per-repo access set (D-22, S11-1).
-- docs/contract.md sections 5 and 6. Append-only (D-19): earlier migrations
-- are never edited. Safe on a database holding data: every new column is
-- nullable with no backfill (rows linked before D-22 need a refresh).
-- Re-runnable.

-- github_installations: linking GitHub account and last repo sync -------------
alter table public.github_installations
  add column if not exists github_user_id bigint,
  add column if not exists github_user_login text,
  add column if not exists repos_synced_at timestamptz;

do $$ begin
  alter table public.github_installations
    add constraint github_installations_github_user_id_positive
    check (github_user_id is null or github_user_id > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.github_installations
    add constraint github_installations_github_user_login_length
    check (github_user_login is null or char_length(github_user_login) between 1 and 255);
exception when duplicate_object then null; end $$;

comment on column public.github_installations.github_user_id is
  'GitHub account that linked this row (D-22). Null only on rows linked before D-22.';
comment on column public.github_installations.repos_synced_at is
  'Last successful repo access sync. Null = never synced or cleared; older than 24 h = refresh required.';

-- projects.repo_id ----------------------------------------------------------
alter table public.projects add column if not exists repo_id bigint;

do $$ begin
  alter table public.projects
    add constraint projects_repo_id_positive check (repo_id is null or repo_id > 0);
exception when duplicate_object then null; end $$;

comment on column public.projects.repo_id is
  'GitHub repository id, set by POST /api/projects (D-22). Null on rows created before D-22.';

-- github_installation_repos -------------------------------------------------
create table if not exists public.github_installation_repos (
  user_id uuid not null references auth.users (id) on delete cascade,
  installation_id uuid not null,
  repo_id bigint not null check (repo_id > 0),
  repo_full_name text not null check (
    char_length(repo_full_name) <= 140
    and repo_full_name ~ '^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$'
    and split_part(repo_full_name, '/', 2) not in ('.', '..')
  ),
  private boolean not null,
  default_branch text not null check (char_length(default_branch) between 1 and 255),
  primary key (installation_id, repo_id),
  constraint github_installation_repos_installation_same_user_fkey
    foreign key (installation_id, user_id)
    references public.github_installations (id, user_id)
    on delete cascade
);
comment on table public.github_installation_repos is
  'Repos of an installation the linking GitHub user can access (GET /user/installations/{id}/repositories at the last sync). Service-role writes only.';

create index if not exists github_installation_repos_user_id_idx
  on public.github_installation_repos (user_id);
create index if not exists github_installation_repos_name_idx
  on public.github_installation_repos (installation_id, lower(repo_full_name));

alter table public.github_installation_repos enable row level security;

drop policy if exists "github_installation_repos_select_own" on public.github_installation_repos;
create policy "github_installation_repos_select_own"
  on public.github_installation_repos for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.github_installation_repos from anon, authenticated;
grant select on table public.github_installation_repos to authenticated;

-- link_github_installations ---------------------------------------------------
-- Called once by the installations callback while the one-time user token is
-- in memory (the token itself never reaches the database). In one
-- transaction: refuse a different GitHub account than the one already
-- recorded (nothing written), upsert each listed installation, REPLACE its
-- repo set, and clear the sets of the user's other rows. An empty list only
-- clears.
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
