> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Status

Everyone appends one line per finished piece of work: `[role] [date] done / next / blockers`.

## Phases
| Phase | State |
|---|---|
| 0 Foundation | done 2026-11-10 (R0-7 migration unverified locally: no Docker) |
| 1 Auth and shell | not started |
| 2 Analysis | not started |
| 3 Flows | not started |
| 4 Simulation | not started |
| 5 Hardening | not started |
| Subscription | NOT READY |
| n8n live testing (user-facing) | NOT READY — dev/CI import test allowed from Phase 3 (D-9) |

## Readiness of pieces (backend updates, frontend reads)
| Piece | Ready for frontend? |
|---|---|
| Auth | no |
| GitHub connect | no |
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
