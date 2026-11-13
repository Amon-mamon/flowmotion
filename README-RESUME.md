# README-RESUME — where Flow Motion stopped (2026-11-13)

Open this file first in a new Claude Code session, then paste the prompt at the bottom.

## Where we are

| Phase | State |
|---|---|
| 0 Foundation | done, committed |
| 1 Auth and shell | done, committed |
| 1.1 Branch selection, GitHub link fallback, per-repo access | done, committed |
| 2 Analysis | **built, checkpoint committed, security re-review NOT done yet** |
| 2b OpenRouter (dev-only AI provider) | not started (D-24) |
| 3 Flows, 4 Simulation, 5 Hardening | not started |
| Subscription, user-facing n8n testing | NOT READY, do not build |

Last check run (2026-11-13): typecheck, lint, build pass; tests 923 passed, 83 skipped (the skipped ones are the RLS suite, which needs a database).

## Next steps, in order

1. **Security re-review of the Phase 2 review fixes.** The backend says S2-1..S2-7 and R2-1, R2-2, R2-3, R2-5, R2-6 are resolved, but no reviewer has checked them yet. Run `security-reviewer` only (code review is clear). See `docs/security-review.md` and `docs/review.md`, Phase 2 sections.
2. Fix anything the re-review reopens, then mark Phase 2 done in `docs/status.md` and commit `phase 2: ...`.
3. **Phase 2b:** OpenRouter adapter, development only. Spec is in `docs/contract.md` section 11 and `docs/decisions.md` D-24. Start only after S2-2 (scanner) and S2-5 (job expiry) pass re-review.
4. Ask the owner before starting Phase 3 (large).

## Owner actions still pending

- **Run in the Supabase SQL Editor, in this order, if not already run:**
  - `supabase/migrations/20261114000000_phase2_analysis.sql`
  - `supabase/migrations/20261114120000_phase2_review_fixes.sql` (new, not applied yet)
  - Already applied: baseline, phase1_schema, 20261113000000 (branch), 20261113120000 (repo access).
- **`.env.local`:** keep `ANALYSIS_MODEL=disabled` until Phase 2b. `WORKER_TOKEN` is only needed when deploying, not for `npm run dev`.
- **To test Analyze locally:** restart `npm run dev`, click "Refresh repository access" if asked, open `booklod`, press Analyze. It should end with findings, signals, and "AI analysis is not enabled yet".
- **Before launch** (checklist in `docs/status.md`): turn Supabase "Confirm email" back on with a custom SMTP sender; deploy the worker Edge Function once and run one analysis end to end; run the RLS test suite against a database (S11-2, R1-8); confirm OQ-5 (n8n licence) and OQ-12 (AI data retention); decide OQ-20 (24 h repo refresh window) and OQ-22 (hint for renamed repos).

## Rules for the next session

- **Usage:** pause new work when weekly usage reaches 60% (`/usage`, "Current week (all models)"). It was 41% on 2026-11-13; it resets Nov 18, 3:59am Asia/Taipei. Ask the owner for the number before each big step.
- **No Artifacts, no Claude Docs, no cloud sessions.** Keep everything in the terminal and local files.
- **Account:** this work ran on the owner's work Claude account. The owner may switch to a personal account with `/login` before continuing.
- **Never open `.env*` files** except `.env.example`. Run vitest from `C:\Users\amon\Desktop\flowmotion` (uppercase C:); lowercase `c:\` breaks every test suite.
- **Migrations are append-only (D-19).** Never edit an applied migration; the owner applies new ones by hand in the SQL Editor.
- Follow `CLAUDE.md`: architect first, backend and frontend in parallel, then reviewers, fix findings, update `docs/status.md`, commit. Never push.

## Where to read more

- `CLAUDE.md`, `AGENTS.md`: how the agents work.
- `docs/contract.md`: source of truth (section 11 has every phase's checklist).
- `docs/status.md`: progress log and launch checklist.
- `docs/decisions.md`: D-1 to D-32.
- `docs/open-questions.md`: open owner questions.
- `docs/review.md`, `docs/security-review.md`: findings and their status.

## Prompt to paste in the next session

```
Read README-RESUME.md, CLAUDE.md, docs/status.md, and the Phase 2 sections of
docs/review.md and docs/security-review.md. Then continue from "Next steps":
run the security re-review of the Phase 2 fixes, fix what it reopens, and commit
Phase 2. Ask me for my /usage weekly number before starting anything large.
```
