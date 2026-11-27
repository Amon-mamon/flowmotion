-- Phase 3b: generation indexes on flows (docs/contract.md sections 5 and 11
-- "Phase 3b"; D-41, D-59). Append-only (D-19): earlier migrations are never
-- edited. Runs ONCE as one script in the Supabase SQL Editor, after
-- 20261125120000_phase1_2_github_isolation.sql; every statement is guarded so
-- an accidental re-run is harmless. Creates no extensions and no cron jobs.
-- Holds no secret values. Safe on existing data: no flow row exists before
-- Phase 3b, so the partial unique index cannot meet a duplicate.
--
-- Nothing else changes: the flows table, its RLS (owner-only select, no
-- client writes), claim_job(), expire_stale_jobs() (already fails generating
-- flows), delete_project() (already removes flow jobs) and the enums stay as
-- they are.

-- At most one generating or ready flow per recommendation (failed attempts
-- stay as rows). POST /api/recommendations/generate turns a racing insert's
-- unique violation into "A flow already exists for this recommendation."
create unique index if not exists flows_active_recommendation_key
  on public.flows (recommendation_id)
  where status in ('generating', 'ready');

-- GET /api/flows: the user's flows, newest first.
create index if not exists flows_user_id_created_at_idx
  on public.flows (user_id, created_at desc);
