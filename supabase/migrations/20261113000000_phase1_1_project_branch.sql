-- Phase 1.1: branch selection (docs/contract.md sections 5 and 11, D-18).
-- Append-only (D-19): the baseline and Phase 1 migrations are never edited.
-- Data-safe on a database that already holds Phase 1 rows: nullable add,
-- backfill, then not null. Re-runnable.

-- projects.branch -------------------------------------------------------------
alter table public.projects add column if not exists branch text;

update public.projects
   set branch = default_branch
 where branch is null;

alter table public.projects alter column branch set not null;

do $$ begin
  alter table public.projects
    add constraint projects_branch_length check (char_length(branch) between 1 and 255);
exception when duplicate_object then null; end $$;

comment on column public.projects.branch is
  'Branch chosen by the user; the only branch the pipeline and push webhook use. Fixed after creation.';
comment on column public.projects.default_branch is
  'Repository default branch at creation time. Display only.';

-- Uniqueness moves from (user, repo) to (user, repo, branch).
-- Phase 1 created the unique inline, so Postgres named it
-- projects_user_id_repo_full_name_key.
alter table public.projects drop constraint if exists projects_user_id_repo_full_name_key;

do $$ begin
  alter table public.projects
    add constraint projects_user_repo_branch_key unique (user_id, repo_full_name, branch);
exception when duplicate_object or duplicate_table then null; end $$;

-- analyses.branch -------------------------------------------------------------
alter table public.analyses add column if not exists branch text;

update public.analyses a
   set branch = p.branch
  from public.projects p
 where a.project_id = p.id
   and a.branch is null;

alter table public.analyses alter column branch set not null;

do $$ begin
  alter table public.analyses
    add constraint analyses_branch_length check (char_length(branch) between 1 and 255);
exception when duplicate_object then null; end $$;

comment on column public.analyses.branch is
  'Branch analyzed, copied from projects.branch when the analysis starts.';

-- No RLS or grant change: the new columns inherit each table's owner-only
-- select policy and table-level select grant.
