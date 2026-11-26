-- Phase 1.2: GitHub account isolation (docs/contract.md sections 5 and 11
-- "Phase 1.2 scope"; D-43, D-44, D-45). Append-only (D-19): earlier
-- migrations are never edited. Runs ONCE as one script in the Supabase SQL
-- Editor; every statement is guarded so an accidental re-run is harmless.
-- Creates no extensions and no cron jobs. Holds no secret values.
--
-- Order:
--   a. account_type / account_id columns (nullable; null = linked before 1.2)
--   b. one Flow Motion holder per GitHub account (D-44; expected no rows)
--   c. clear every unclassified row's repo access set (D-45)
--   d. check constraints and the github_user_id index
--   e. link_github_installations() replacement (same signature and grants)

-- a. Columns ------------------------------------------------------------------
alter table public.github_installations
  add column if not exists account_type text,
  add column if not exists account_id bigint;

comment on column public.github_installations.account_type is
  'GitHub account type the installation is on: User or Organization (D-43). Null only on rows linked before Phase 1.2.';
comment on column public.github_installations.account_id is
  'GitHub id of the account the installation is on (D-43). Null only on rows linked before Phase 1.2.';

-- b. Duplicate holders (D-44) -------------------------------------------------
-- For each GitHub account held by more than one Flow Motion user, the user
-- whose oldest row with that id is earliest (ties: lowest user_id) keeps it;
-- the other users' rows with that id are deleted (repo sets cascade, their
-- projects get installation_id = null).
with holders as (
  select g.github_user_id, g.user_id, min(g.created_at) as first_at
    from public.github_installations g
   where g.github_user_id is not null
   group by g.github_user_id, g.user_id
), ranked as (
  select h.github_user_id, h.user_id,
         row_number() over (partition by h.github_user_id order by h.first_at, h.user_id) as rn
    from holders h
)
delete from public.github_installations g
 using ranked r
 where r.rn > 1
   and g.github_user_id = r.github_user_id
   and g.user_id = r.user_id;

-- c. Clear unclassified rows (D-45) -------------------------------------------
-- No row linked before Phase 1.2 grants repo access from here on; the user's
-- next "Refresh repository access" classifies the row or deletes it.
delete from public.github_installation_repos r
 using public.github_installations g
 where r.installation_id = g.id
   and g.account_type is null;
update public.github_installations g
   set repos_synced_at = null
 where g.account_type is null
   and g.repos_synced_at is not null;

-- d. Constraints and index ----------------------------------------------------
alter table public.github_installations
  drop constraint if exists github_installations_account_type_check;
alter table public.github_installations
  add constraint github_installations_account_type_check
  check (account_type is null or account_type in ('User', 'Organization'));

-- No row can hold another person's personal installation (D-43).
alter table public.github_installations
  drop constraint if exists github_installations_linkable_account;
alter table public.github_installations
  add constraint github_installations_linkable_account
  check (
    account_type is null
    or (
      account_id is not null
      and github_user_id is not null
      and (account_type = 'Organization' or (account_type = 'User' and account_id = github_user_id))
    )
  );

-- Only classified rows may count as synced (D-45).
alter table public.github_installations
  drop constraint if exists github_installations_synced_has_account;
alter table public.github_installations
  add constraint github_installations_synced_has_account
  check (repos_synced_at is null or account_type is not null);

create index if not exists github_installations_github_user_id_idx
  on public.github_installations (github_user_id);

-- e. link_github_installations(): Phase 1.2 replacement ------------------------
-- Same signature, return type and grants as 20261114000000. In one
-- transaction: per-user then per-GitHub-account advisory locks (fixed order),
-- argument checks, lock the user's rows, github_account_mismatch,
-- github_in_use (another user holds this GitHub account), linking rule
-- (installation_not_allowed), upsert + replace each repo set, then for the
-- user's unlisted rows: unclassified ones are deleted, classified ones cleared.
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
  -- (1) Serialise callbacks of the same user, then of the same GitHub account.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('github_user:' || p_github_user_id::text, 0));

  -- (2) Arguments.
  if p_user_id is null or p_github_user_id is null or p_github_user_id <= 0
     or p_github_user_login is null or char_length(p_github_user_login) = 0
     or p_installations is null or jsonb_typeof(p_installations) <> 'array' then
    raise exception 'invalid_arguments';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_installations) as item(value)
     where case
             when jsonb_typeof(item.value) <> 'object' then true
             when jsonb_typeof(item.value -> 'accountType') is distinct from 'string' then true
             when char_length(item.value ->> 'accountType') = 0 then true
             when jsonb_typeof(item.value -> 'accountId') is distinct from 'number' then true
             else not (
               (item.value ->> 'accountId')::numeric > 0
               and (item.value ->> 'accountId')::numeric <= 9223372036854775807
               and (item.value ->> 'accountId')::numeric = trunc((item.value ->> 'accountId')::numeric)
             )
           end
  ) then
    raise exception 'invalid_arguments';
  end if;

  -- (3) Lock this user's rows.
  perform 1 from public.github_installations g where g.user_id = p_user_id for update;

  -- (4) One Flow Motion account never switches GitHub accounts (D-22).
  if exists (
    select 1 from public.github_installations g
     where g.user_id = p_user_id
       and g.github_user_id is not null
       and g.github_user_id <> p_github_user_id
  ) then
    raise exception 'github_account_mismatch';
  end if;

  -- (5) One GitHub account per Flow Motion account (D-44). Checked even when
  -- p_installations is empty.
  if exists (
    select 1 from public.github_installations g
     where g.user_id <> p_user_id
       and g.github_user_id = p_github_user_id
  ) then
    raise exception 'github_in_use';
  end if;

  -- (6) Linking rule (D-43): the user's own account or an organization.
  if exists (
    select 1
      from jsonb_array_elements(p_installations) as item(value)
     where not (
       item.value ->> 'accountType' = 'Organization'
       or (item.value ->> 'accountType' = 'User'
           and (item.value ->> 'accountId')::bigint = p_github_user_id)
     )
  ) then
    raise exception 'installation_not_allowed';
  end if;

  -- (7) Upsert each item and replace its repo set.
  for v_item in select value from jsonb_array_elements(p_installations) loop
    v_github_id := (v_item ->> 'installationId')::bigint;

    insert into public.github_installations as g
      (user_id, installation_id, account_login, github_user_id, github_user_login,
       account_type, account_id, repos_synced_at)
    values
      (p_user_id, v_github_id, v_item ->> 'accountLogin', p_github_user_id, p_github_user_login,
       v_item ->> 'accountType', (v_item ->> 'accountId')::bigint, now())
    on conflict on constraint github_installations_user_id_installation_id_key do update
      set account_login = excluded.account_login,
          github_user_id = excluded.github_user_id,
          github_user_login = excluded.github_user_login,
          account_type = excluded.account_type,
          account_id = excluded.account_id,
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

  -- (8) The user's rows not listed. Unclassified (linked before Phase 1.2,
  -- may be another person's personal installation): deleted, repo sets
  -- cascade, projects get installation_id = null (D-45).
  delete from public.github_installations g
   where g.user_id = p_user_id
     and g.account_type is null
     and not (g.installation_id = any (v_listed));
  -- Classified but not listed now: clear the set, keep the row.
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
