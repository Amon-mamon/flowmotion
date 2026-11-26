# BACKLOG — everything deferred, left out, or not built yet

Single list for "what is still not built?". Update it whenever something is deferred or finished. Phase plans live in `docs/contract.md` section 11; progress in `docs/status.md`; open owner questions in `docs/open-questions.md`.

Last updated: 2026-11-27 (after Phase 1.2).

## Planned and approved (build order)
1. ~~Phase 1.2: GitHub account isolation~~ done 2026-11-27 (D-43..D-45). Owner and teammate must each click "Refresh repository access" once.
2. **Phase 3a review fixes:** R3a-1 (canvas clicks), R3a-2 and S3a-1 (scanner gaps), plus lows. See `README-RESUME.md`.
3. **Phase 2e: own AI key** (Integrations page, OpenRouter + Anthropic, any model, free and paid). Approved 2026-11-27; details in `FEATURE-PROPOSAL.md`.
4. **Phase 3b: flow generation** (Generate button, generate/flows/export API, migration `20261126000000_phase3_flows.sql`).
5. **Phase 4: simulation** (mock-data test runs).
6. **Phase 5: hardening** (full security review, rate limits, audit log, MFA, accessibility).

## Deferred by the owner (ask before building)
- **Direct OpenAI connector** for own AI key (OpenRouter already reaches OpenAI models). Owner: "OpenRouter + Anthropic first", 2026-11-27.
- **Other AI providers** (Google Gemini direct, Mistral direct, and so on).
- **Retry AI only** (`RETRY-AI-ONLY.md`): build now, later, or not.
- **Pre-launch features** in `FEATURE-PROPOSAL.md` not yet picked: real dashboard, auto re-analysis on push and notifications, security center, flow library, setup checklist per flow, shareable report, recommendation-list fixes (top 5 first, filters, confidence as words).
- **Infrastructure** (decide after all phases are built and tested): deployment steps, staging vs production Supabase, CI, monitoring and alerts, backups and recovery, custom domain, email sending.
- **Teammate / remote testing:** the dev server only works on `localhost` (Origin check, OpenRouter guard, GitHub and Supabase redirects). A staging deployment is the proper way; part of infrastructure.

## NOT READY (do not build until the owner says so)
- Subscription, plans, billing, credits (`docs/subscription.md`). Includes pricing for built-in AI vs own key.
- User-facing live testing in n8n and pushing flows into a user's n8n (`docs/n8n.md`).
- Team workspaces and seats (tied to billing).

## Before launch (checklist in `docs/status.md`)
- Supabase "Confirm email" on with custom SMTP.
- Deploy the worker Edge Function once and run one analysis through it (OQ-16); confirm Vault `worker_token` equals `WORKER_TOKEN`.
- Run the RLS test suite against a real database (S11-2, R1-8).
- Run `npm run test:n8n-import` once so exports stop saying "not yet verified" (after Phase 3b).
- Look at a real flow in the browser (canvas only tested by code so far).
- Owner questions: OQ-5 (n8n licence), OQ-12 (AI data retention), OQ-20, OQ-22, OQ-27..OQ-30.
- Before real users: no `ANALYSIS_PROVIDER=openrouter` or `OPENROUTER_API_KEY` on Vercel or worker secrets (system key).

## Small known items
- Phase 1.2 lows (next backend round): R12-1 / S12-3 run the RLS suite against a real database so the new link-function SQL actually executes, plus a concurrent two-account link test; R12-2 align the test fake with the SQL function; R12-3 / S12-2 the analysis worker does not re-check repo access or account type at run time; S12-1 push events still update projects on not-yet-refreshed old installation rows; R12-4 status.md typo.
- Next.js warning about `scroll-behavior: smooth` on `<html>` (add `data-scroll-behavior="smooth"`).
- Billed model calls cut off mid-generation may skip a `usage_events` row (S2d-2); revisit with billing.
- The `.env.local.bak-2026-11-22` backup can be deleted.
