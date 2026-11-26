# BACKLOG — everything deferred, left out, or not built yet

Single list for "what is still not built?". Update it whenever something is deferred or finished. Phase plans live in `docs/contract.md` section 11; progress in `docs/status.md`; open owner questions in `docs/open-questions.md`.

Last updated: 2026-11-27 (after Phase 1.2).

## Planned and approved (build order)
1. ~~Phase 1.2: GitHub account isolation~~ done 2026-11-27 (D-43..D-45). Owner and teammate must each click "Refresh repository access" once.
2. **Phase 3a review fixes:** planned 2026-11-27 (D-46..D-53, contract section 11 "Phase 3a review fixes": backend items 1-11, frontend items 1-3). Not built yet. Gate: R3a-1, R3a-2, S3a-1, S3a-2 verified fixed before 3b starts.
3. **Phase 3b: flow generation** (Generate button, generate/flows/export API, migration `20261126000000_phase3_flows.sql`).
4. **Phase 2e: own AI key** — UI preview being built 2026-11-27 (D-54); the working backend waits for the owner's go-ahead. (Integrations page, OpenRouter + Anthropic, any model, free and paid). Approved 2026-11-27; moved after 3b by D-46 (generation reuses the same provider switch, so per-user keys change one place for both). Details in `FEATURE-PROPOSAL.md`.
5. **Phase 4: simulation** (mock-data test runs).
6. **Phase 5: hardening** (full security review, rate limits, audit log, MFA, accessibility).

## Deferred by the owner (ask before building)
- **Landing page redesign** (owner 2026-11-27: current page "too basic for a modern and solid app that scales"). **Direction chosen 2026-11-27: vercel.com's look (minimal, sharp type, generous space, thin grid lines and borders, crisp product previews, restrained precise motion) with Flow Motion's own colours (existing dark theme and coral-red accent from docs/design.md).** Plan: write this direction as a design system (design-system skill) → rebuild with scroll-driven 3D storytelling, animated product previews, social proof, strong CTA, mobile and reduced-motion friendly → review. Real 3D with Three.js needs owner approval of a new dependency (OQ-1). Suggested timing: before launch, after 3b so it can show real generated flows. Estimate 8-15% weekly usage.
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
- Phase 2e-ui lows carried to the full Phase 2e (owner's go needed): R2eu-3 three model validation messages not yet in design.md; R2eu-4 "Tested ..." dates in the preview drift (sample data); R2eu-5 pin the `keyHint` format in the contract.
- Phase 3a carried lows (D-53): R3a-4 catalog generator ignores per-version display rules (documented in node-catalog.md); a test near the R3a-6 size limit; pinned integrity hash for the n8n package and a pinned Docker image for the import test (rest of S3a-9); informational: forbid `toString`/`valueOf` names, cap node input/output counts at 16, every-minute schedules.
- Owner may override two Phase 3a defaults: D-52 generated flows cannot send computed data back to the webhook caller (literal replies only); D-51 custom HTTP header names cannot contain hyphens (so no `Content-Type`).
- **Releasing a GitHub account (found in live testing 2026-11-27):** uninstalling the App on GitHub only reaches Flow Motion through a webhook, which never arrives on `localhost`, and Settings "Disconnect" removes one installation at a time. A Flow Motion account that once linked another person's GitHub (two GitHub sessions in one browser) kept holding it, so the real owner got `github_in_use` and the other account got `github_account_mismatch`. Fixed by hand with SQL. Needed: a "Disconnect GitHub completely" action that deletes all of the user's installation rows, and a clearer error that says which action releases the account.
- Phase 1.2 lows (next backend round): R12-1 / S12-3 run the RLS suite against a real database so the new link-function SQL actually executes, plus a concurrent two-account link test; R12-2 align the test fake with the SQL function; R12-3 / S12-2 the analysis worker does not re-check repo access or account type at run time; S12-1 push events still update projects on not-yet-refreshed old installation rows; R12-4 status.md typo.
- Next.js warning about `scroll-behavior: smooth` on `<html>` (add `data-scroll-behavior="smooth"`).
- Billed model calls cut off mid-generation may skip a `usage_events` row (S2d-2); revisit with billing.
- The `.env.local.bak-2026-11-22` backup can be deleted.
