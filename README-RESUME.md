# README-RESUME — where Flow Motion stopped (2026-11-25)

Open this file first in a new Claude Code session, then paste the prompt at the bottom.

## Where we are

| Phase | State |
|---|---|
| 0, 1, 1.1 | done, committed, pushed |
| 2 Analysis, 2b OpenRouter dev provider, 2c AI failure handling, 2d close-out | done, committed, pushed (`6834f5f`) |
| 3 scope (split into 3a and 3b, D-37..D-42) | committed `172ac20` |
| 1.2 GitHub account isolation + account menu fix | done 2026-11-27 (`0c7d0b6`, `5ea5424`); migration applied; owner can analyze again |
| **3a Flow engine and flow UI** | **built and reviewed (checkpoint `64f5863`); review fixes PLANNED (D-46..D-53), not built** |
| 3b Generation job, API, wiring | not started; next after the 3a fixes |
| 2e Own AI key | approved; after 3b (D-46) |
| 4 Simulation, 5 Hardening | not started |
| Subscription, user-facing n8n testing | NOT READY, do not build |

Last check run (2026-11-25, on the checkpoint tree): typecheck, lint, build pass; tests 1514 passed, 83 skipped (RLS suite, needs a database).

First live end-to-end analysis with AI passed on 2026-11-25 (OpenRouter paid model `particle-ai/particle-1`, about $0.01 per analysis). Free OpenRouter models were unreliable (upstream 429s, models removed).

## Phase 3a review results (2026-11-25)

Both reviews are complete: `docs/review.md` section "Phase 3a — Flow engine and flow UI (code review 2026-11-25)" and `docs/security-review.md` section "Phase 3a (2026-11-25) — flow engine and flow UI". Nothing from them is fixed yet.

| Id | Severity | Owner | Problem |
|---|---|---|---|
| R3a-1 | high | frontend | Mouse clicks on canvas nodes cannot open the inspector in a real browser (React Flow sets `pointer-events: none` on read-only node wrappers; tests miss it). Fix, then check in a real browser. |
| R3a-2 | medium | backend | A FlowSpec can pass F9 and its export then fail validator rule 7 (for example a postgres column named `password` with a long literal). The two scan renderings must treat name/value pairs the same way. |
| S3a-1 | medium | backend, architect for `security.md` section 2 | Phase 2 scanner gap, not new in 3a: misses `Authorization: "Bearer ..."`, `"Basic ..."`, `https://user:pass@host`, `?api_key=...`. Must be fixed before 3b generation sends source for real users. |
| S3a-2 | low | backend | Renamed-key scan can hide a planted key when an object has both `from` and `currentKey`, or a `__proto__` key. Fix before the export route ships (3b). |
| S3a-3 | low | architect, then backend | Validator accepts raw `executeQuery` SQL, `deleteTable`, literal `toEmail`/`bccEmail`, an HTTP proxy option; `assertExportSafe` accepts a `code` node. Decide when reconfirming 3b. |
| S3a-9 | low | backend, owner | The `npx` fallback in `scripts/n8n-import-test.mjs` runs n8n install scripts on the developer machine; prefer the Docker path. |
| R3a-3..R3a-10, S3a-4..S3a-8 | low | mostly backend; R3a-7 frontend; R3a-10 architect | See the two review sections. R3a-10: record the accepted backend deviations in the docs. |

The code reviewer accepted every backend deviation listed in `docs/requests.md` (one with the R3a-2 change). OQ-27..OQ-30 do not block 3a; OQ-29 and OQ-30 should be settled before 3b ships real exports.

## Next steps, in order

**Build order (D-46, 2026-11-27):** Phase 3a review fixes → Phase 3b → Phase 2e own AI key. Everything deferred or not built is listed in `BACKLOG.md`.

**Progress 2026-11-27 night:** Integrations UI preview DONE (`89fe97c`). Landing redesign IN PROGRESS: direction approved (LANDING-DESIGN.md) plus Lenis smooth scrolling and Motion (renamed Framer Motion, already installed) scroll animations; architect writing the scope, then backend installs the pinned `lenis`, frontend builds, code review, commit `feat(landing): ...`.

**Owner's plan for 2026-11-27 night (supersedes the order below for now):** (1) finish the Integrations page **UI preview** (Phase 2e-ui, D-54; frontend build running, then a quick code review, commit `feat(phase-2e): integrations page UI preview`), then (2) **landing page redesign**: Vercel look with Flow Motion colours (BACKLOG.md); first write the design direction and show the owner before building. (3) The **working** own-AI-key backend (full Phase 2e) is built **only when the owner says so**. Phase 3a fixes and 3b stay queued after that.

**Start here next session (stopped 2026-11-27 at owner's request, weekly usage about 37% before planning):** the Phase 3a fix plan is written in `docs/contract.md` section 11 "Phase 3a review fixes" (backend items 1-11, frontend items 1-3; D-46..D-53). Launch backend and frontend in parallel on it, then code-reviewer and security-reviewer, fix until no high or medium, commit `fix(phase-3a): ...`, mark 3a done. Estimated cost: 3a fixes about 10-15% of weekly usage; 3b about 18-25%. Ask the owner for /usage first.


1. ~~Architect rulings~~ done 2026-11-27 (D-46..D-53).
2. **Backend and frontend in parallel:** frontend fixes R3a-1 and R3a-7; backend fixes R3a-2, S3a-1, S3a-2 and the backend lows.
3. **Re-review** (code-reviewer and security-reviewer) until no high or medium remain. Then commit `fix(phase-3a): ...` and mark Phase 3a done in `docs/status.md`.
4. **Phase 3b:** architect reconfirms scope, then backend and frontend in parallel, then both reviewers. The owner applies `20261126000000_phase3_flows.sql` in the Supabase SQL Editor when it exists. Remove the Generate gate (`isGenerateApiReady()`).
5. After 3b: the owner looks at a real flow in the browser (the canvas has only been tested by code) and runs `npm run test:n8n-import` once by hand (the script has never been executed; exports say "not yet verified" until it passes).
6. Ask the owner before Phase 4.

## Owner decisions still open

- `FEATURE-PROPOSAL.md`: which pre-launch features (dashboard, own AI key, auto re-analysis, flow library, shareable report, list fixes).
- `RETRY-AI-ONLY.md`: build now, later, or not.
- Phase 3 defaults the architect applied (OQ-23..OQ-26): per-card Generate, generation re-reads up to 12 source files, hand-run import check, conservative node operations. The owner has not objected.
- Infrastructure (staging database, CI, monitoring, backups, deployment steps) is deliberately deferred until all phases are built and tested.

## Owner actions still pending

- All migrations up to `20261114120000` are applied on the hosted Supabase project.
- `.env.local` holds the OpenRouter settings (`ANALYSIS_PROVIDER`, `ANALYSIS_MODEL`, `OPENROUTER_API_KEY`, `APP_URL`). See `README-OPENROUTER.md`. A backup `.env.local.bak-2026-11-22` exists (git-ignored) and can be deleted.
- Before launch (checklist in `docs/status.md`): Supabase "Confirm email" with custom SMTP; deploy the worker Edge Function once (OQ-16) and confirm Vault `worker_token` equals `WORKER_TOKEN`; run the RLS suite against a database (S11-2, R1-8); OQ-5 (n8n licence), OQ-12 (AI data retention), OQ-20, OQ-22.

## Rules for the next session

- **Usage:** ask the owner for the weekly `/usage` number ("Current week, all models") before each large step; pause at 60% unless the owner says to continue. Claude cannot see the number.
- **No Artifacts, no Claude Docs, no cloud sessions.**
- **Never open `.env*` files** except `.env.example`.
- **macOS now.** Ignore Windows-only notes in older docs.
- **Commit after each phase; the owner pushes.** Commit names follow Conventional Commits with the phase as scope: `feat(phase-3a): ...`, `fix(phase-3a): ...`, `docs: ...`, `test: ...`, `chore: ...`; add `checkpoint` when a phase is saved before its review findings are resolved; the body lists Added / Fixed / Open.
- **Migrations are append-only (D-19);** the owner applies them in the SQL Editor.
- Follow `CLAUDE.md`: architect first, backend and frontend in parallel, then reviewers, fix findings, update `docs/status.md`, commit.

## Where to read more

`CLAUDE.md`, `AGENTS.md` · `docs/contract.md` (section 11 has every phase) · `docs/status.md` · `docs/decisions.md` (D-1 to D-42) · `docs/open-questions.md` · `docs/requests.md` · `docs/review.md`, `docs/security-review.md` · `last-session.md` (history up to 2026-11-13).

## Prompt to paste in the next session

```
Read README-RESUME.md, CLAUDE.md, AGENTS.md, docs/status.md, and the Phase 3a sections of
docs/review.md and docs/security-review.md. Then continue from "Next steps" (the Phase 3a review fixes come first).
Ask me for my /usage weekly number before starting anything large.
```
