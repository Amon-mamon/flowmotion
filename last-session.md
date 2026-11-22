# Last session summary (2026-11-10 to 2026-11-13)

Written for whoever continues Flow Motion next, on any device. Read this together with `README-RESUME.md`, which lists the exact next steps.

## What happened, in order

1. **Planning review (Nov 10).** Read every doc in the pack and analysed the business: who pays (n8n users, agencies), where costs leak (AI tokens), what drives repeat use (re-analysis on push). Two architect passes fixed gaps in the docs: jobs table, chunked worker, token budgets, `RecommendationDraft` shape, daily caps, the `.env.example` exception, and a dev-only n8n import test. Git was initialised.
2. **Phase 0 (Nov 10).** Next.js 16 scaffold with the full pinned stack, Zod env schema, Supabase clients, baseline migration, security headers, vitest. Reviewed and committed.
3. **Phase 1 (Nov 10–12).** Schema and RLS for all tables, email sign-in, GitHub App connect, projects API, proxy, landing page, login/signup, dashboard, settings, privacy and terms. Reviews found and fixed 15 issues, including a public-repo bypass when adding projects. Committed.
4. **Owner setup and bugs (Nov 12).** The owner filled `.env.local` (keys had first been put in `.env.example` by mistake; they were moved and never committed). Fixed in setup: migrations run in the wrong order, Supabase email rate limit on signup, wrong GitHub App slug and placeholder private key, GitHub App callback URL pointing at the Supabase callback. GitHub connect then worked.
5. **Phase 1.1 (Nov 12–13).** Owner asked for branch selection. Built a two-step Add repository dialog (repo, then branch), a fallback for Apps installed directly on GitHub, and dashboard and auth message fixes. The security review found a high issue: an org member could reach every private repo in the org's installation. Fixed with a per-user, per-repo access list refreshed through GitHub every 24 hours (D-22). Committed.
6. **Phase 2 (Nov 13).** Analysis pipeline: validity check, path policy, secret scanner, file selection, signal extractors, chunked worker, analyze/analyses/findings/recommendations routes, analysis UI. AI is off by default (`ANALYSIS_MODEL=disabled`), so an analysis still returns findings and signals with no AI cost. Reviews found 4 medium issues (AI retry cost cap, local worker claiming other users' jobs, renamed-repo leak, scanner missing unquoted and provider keys). All fixed and tested. **The security re-review of those fixes has not run yet.** Saved as a checkpoint commit.

## Decisions the owner made

- No paid AI budget yet. AI stays off; OpenRouter free models will be added as a **development-only** provider (Phase 2b, D-24). Production will use Anthropic (Claude Haiku 5.5 is cheapest).
- Same repo can be added once per branch; branch cannot be changed later (D-18).
- Migrations are append-only; the owner applies them by hand in the Supabase SQL Editor (D-19).
- Pause work at 60% weekly Claude usage; resume after the reset.
- No Artifacts, no Claude Docs, no cloud sessions. The work ran on the owner's work Claude account; the owner may switch to a personal account.

## State at the end

- Branch `main`, last commit `phase 2 checkpoint ...`. Typecheck, lint, build pass; 923 tests pass, 83 skipped (RLS suite, needs a database).
- Hosted Supabase has: baseline, phase1_schema, `20261113000000` (branch), `20261113120000` (repo access) applied.
- **Not yet applied by the owner:** `20261114000000_phase2_analysis.sql`, then `20261114120000_phase2_review_fixes.sql`.
- Open owner questions: OQ-5 (n8n licence), OQ-12 (AI data retention), OQ-20 (24 h refresh window), OQ-22 (renamed-repo hint). Full launch checklist is in `docs/status.md`.

## Setting up on a new device

1. Install Node 22 and Git, then `git clone https://github.com/Amon-mamon/flowmotion.git` and run `npm ci`.
2. Create `.env.local` by hand from `.env.example`. **Never commit it and never paste it into a chat.** Copy the values from the old device by a private route (password manager or USB), not by email or chat.
3. The GitHub App private key `.pem` lives outside the repo (old device: `C:\Users\amon\keys\`). Copy it the same private way and keep it outside the project folder.
4. `npm run dev`, then open http://localhost:3000.
5. On Windows, run tests from a path with an uppercase drive letter (`C:\...`); a lowercase `c:\` path makes every vitest suite fail.

## Rules for the next session (from the previous session's memory, which does not travel between devices)

- Ask the owner for the weekly `/usage` number before any large step; pause at 60%.
- Never publish Artifacts or Claude Docs; never start cloud sessions.
- Never open `.env*` files except `.env.example`.
- Follow `CLAUDE.md`: architect first, backend and frontend in parallel, then reviewers, fix, update `docs/status.md`, commit. Push only when the owner asks.
- Lead with business impact (cost, revenue risk) when advising; the goal is a product that makes money.
