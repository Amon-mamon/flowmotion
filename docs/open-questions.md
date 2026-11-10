> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Open questions

Each has a recommended default so work can continue. The architect resolves them with the owner and records answers in `decisions.md`.

- **OQ-1** "Motion" 3D scrolling: use Motion scroll with CSS 3D transforms, or Three.js? Default: Motion plus CSS 3D, no Three.js.
- **OQ-2** Text on light-red buttons: black (readable) or white (as requested)? Default: black on red, white everywhere else.
- **OQ-3** AI provider and model for analysis and generation. Default: Anthropic API, model name in `ANALYSIS_MODEL`.
- **OQ-4** ~~Background jobs: Supabase Edge Function worker with a DB queue, or another Supabase-only approach?~~ **Resolved 2026-11-10 → D-10** (chunked `jobs` state machine, `contract.md` sections 4 and 5).
- **OQ-5** License impact of depending on n8n packages to generate the catalog and of running a pinned n8n for the dev/CI import test (D-9). Default: dev-time extraction only, commit the generated JSON, no runtime n8n dependency, dev/CI import test is internal only. **Owner must confirm with n8n before public launch.**
- **OQ-6** Credential placeholder format and top-level fields in exported n8n JSON. Default: omit credential ids, list credentials in the checklist, mark exports "unverified import" until tested (`n8n.md`).
- **OQ-7** Which n8n version to pin. Default: latest stable at the start of Phase 3.
- **OQ-8** Private repositories: allowed through the GitHub App for selected repos only? Default: yes, with a clear privacy notice.
- **OQ-9** Monorepos. Default: analyze the whole repo within file caps, one project per repo.
- **OQ-10** Payment provider and countries (NOT READY, see `subscription.md`).
- **OQ-11** Analytics and error-monitoring provider for Phase 5. Default: none in v1; log errors (ids, counts, error codes only, no repo text) to Supabase. Revisit before launch. Any new dependency needs a `docs/requests.md` entry first.
- **OQ-12** AI provider data retention. Default: Anthropic API with zero-retention terms; the owner must confirm the retention terms in writing before launch, and the `/privacy` page must match what is confirmed.
