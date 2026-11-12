> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Status

Everyone appends one line per finished piece of work: `[role] [date] done / next / blockers`.

## Phases
| Phase | State |
|---|---|
| 0 Foundation | done 2026-11-10 (R0-7 migration unverified locally: no Docker) |
| 1 Auth and shell | scope confirmed 2026-11-10 (contract.md section 11 "Phase 1 scope"); not started |
| 2 Analysis | not started |
| 3 Flows | not started |
| 4 Simulation | not started |
| 5 Hardening | not started |
| Subscription | NOT READY |
| n8n live testing (user-facing) | NOT READY — dev/CI import test allowed from Phase 3 (D-9) |

## Readiness of pieces (backend updates, frontend reads)
| Piece | Ready for frontend? |
|---|---|
| Auth | yes (callback, sign-out, profile; Phase 1) |
| GitHub connect | yes (install, callback, installations list/delete, repos, webhook; Phase 1) |
| Projects list API | yes (GET/POST /api/projects, GET/DELETE /api/projects/:id; Phase 1) |
| Analyze API | no |
| Recommendations API | no |
| Generate API | no |
| Flow and export API | no |
| Test API | no |

Until a piece says yes, the frontend uses mock data that matches `contract.md`.

## Log
(append below)
[architect] 2026-11-10 done: pre-phase gap pass / next: Phase 0 / blockers: owner to confirm OQ-5, OQ-12
[backend] 2026-11-10 done: Phase 0 scaffold (Next 16.4.6 app router, pinned stack, shadcn v4 init + button, vitest, env schema, Supabase clients, baseline migration with profiles RLS, security headers) / next: Phase 1 schema+auth / blockers: owner fills .env.local; new deps await architect approval in requests.md
[architect] 2026-11-10 done: second gap pass (API/data-model/FlowSpec/validator/env/UI-state cross-check) / next: Phase 0 review, then Phase 1 scope confirm / blockers: owner on OQ-5, OQ-12, OQ-13, OQ-15, OQ-16
[backend] 2026-11-10 done: Phase 0 review fixes R0-1..R0-6, R0-9, R0-10, R0-12 (GITHUB_APP_SLUG, startup env check in src/instrumentation.ts, enforced minimal CSP, config.toml localhost + seed.sql, profiles.updated_at + set_updated_at(), btrim display_name, env drift-guard tests, noUncheckedIndexedAccess) / next: Phase 1 schema+auth / blockers: R0-7 migration not applied locally (Docker not installed on this machine); owner fills .env.local
[architect] 2026-11-10 done: Phase 1 scope confirmed (contract section 11 subsection, DTO shapes + camelCase rule + FORBIDDEN + profile/sign-out/disconnect routes in section 6, state-cookie and CSRF detail in security.md, landing/shell/auth copy in design.md), D-11..D-15 recorded, OQ-15..18 closed, Phase 0 deps approved / next: Phase 2 scope after Phase 1 review / blockers: owner edits AGENTS.md row (src/proxy.ts), fills .env.local, Supabase Auth redirect URL and GitHub App settings (contract "Owner setup"); OQ-5, OQ-12, OQ-13 still open
[frontend] 2026-11-12 done: Phase 1 UI (design tokens, landing with Motion 3D scroll story + reduced-motion fades + exact 'Plans coming soon' copy, /privacy, /terms, /login, /signup, (app) shell with sidebar/sheet/user menu/sign-out, /dashboard projects grid + repo picker + notices, /projects/[projectId] shell, /settings), query layer on shared src/schemas DTOs, 34 frontend tests / next: live API check in Phase 1 review once .env.local is filled, Phase 2 project/analysis UI / blockers: next build fails only in backend src/proxy.ts (non-literal matcher, requests.md 2026-11-12)
[backend] 2026-11-12 done: Phase 1 backend (migration 20261110120000_phase1_schema.sql: all section 5 tables, enums, FKs, indexes, RLS owner-select, jobs column grant without state, rate_limit_hit(); src/server http/auth/rate-limit/audit; src/proxy.ts; auth callback, sign-out, profile, GitHub install/callback/installations/repos/webhook, projects CRUD; runtime-neutral src/lib/github; DTO schemas in src/schemas/{api,profile,github,project}.ts) / next: Phase 1 review, Phase 2 / blockers: RLS suite (tests/rls) skipped, no local Supabase/Docker, so the migration is not applied locally (R0-7 still open); owner fills .env.local; run vitest from C:\ (uppercase), since lowercase c:\ cwd makes every suite fail
[backend] 2026-11-12 done: Phase 1 review fixes R1-1..R1-7 (atomic delete_project() SQL function removes jobs + cascade in one transaction; RLS write-denial tests now use complete valid rows and real column changes and assert 42501; requireUser/route ownership/Origin tests; webhook HMAC over raw bytes; install state cookie bound to user id, callback never returns JSON; single GET /repos lookup on project create; composite projects->github_installations FK) / next: Phase 2 / blockers: R1-8 (migration + RLS suite never run; needs Docker or a disposable Supabase project)
[architect] 2026-11-12 done: R1-15 contract/security docs aligned with delete_project, composite FK, state cookie, repo installation check / next: Phase 2 scope / blockers: none
[coordinator] 2026-11-12 done: Phase 1 committed; 0 high, 0 medium open / next: Phase 2 / blockers: R1-8 (migration + RLS suite never run, needs Supabase); verify repo-installation check against live GitHub with selected-repos installs
