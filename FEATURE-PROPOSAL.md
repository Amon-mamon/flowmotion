# FEATURE-PROPOSAL — dashboard and pre-launch features (draft, 2026-11-22)

Owner draft for decision. Nothing here is in the contract yet. Once the owner picks, the architect turns the picks into phases in `docs/contract.md`. NOT READY items (`docs/subscription.md`, `docs/n8n.md`) stay out.

## APPROVED: Own AI key ("bring your own key"), owner decision 2026-11-27

Build as **Phase 2e**, after the Phase 1.2 security fix and the Phase 3a review fixes, and **before Phase 3b**, so flow generation uses the user's key from day one.

**How it works**
- Sidebar: a new **Integrations** item, with an **AI provider** section.
- Provider picker: **OpenRouter** and **Anthropic** at launch. Choosing one shows that provider's fields:
  - **API key**: shown as dots, never displayed again after saving (only something like `sk-or-…4f2a`).
  - **Model**: a suggested default per provider, but the user may enter **any model** the provider offers, **free or paid**.
- **Test connection** button: sends one tiny request, then shows "Working" or a clear reason ("Invalid key", "No credit", "Model not found").
- **Remove key** at any time.
- Analyses, and later flow generation, use that user's key only for that user's own repos.

**Owner intent**
- When a user has a working key, **their chosen provider and model are used instead of the system AI**. This cuts the owner's AI cost, and users who find the built-in model slow or weak can pick their own.
- If the user's key fails, show the error; **never silently fall back** to the owner's key.
- Free models are allowed, with a clear warning that free providers may log or train on what they receive.

**Rules the architect must record when the phase starts**
- Keys stored encrypted in Supabase Vault, never returned to the browser, never logged.
- No custom server URLs: users pick a provider, they cannot type an endpoint.
- Amend D-24 / D-33: OpenRouter is development-only for the **system** key; a **user's own** OpenRouter key may be used in production for that user's repos.
- Errors reuse Phase 2c handling (`AI_UNAVAILABLE`, `ai.failed`), plus invalid-key and no-credit messages.

**Deferred (see BACKLOG.md):** direct OpenAI connector and other providers.

## The goal behind every pick
A user pays monthly only if Flow Motion keeps finding value in their repos. So each feature should do at least one of these: **show value fast** (first session), **bring users back** (every push), **cut our AI cost**, or **help agencies sell** (they are the best payers).

## 1. Real dashboard (home after sign-in)

| Block | What it shows | Why |
|---|---|---|
| Headline numbers | Automations found · flows generated · flows exported · **estimated hours saved per month** | The hours number is the price justification. Show how it is estimated (frequency × minutes per run). |
| Top opportunities | Best recommendations across all repos, ranked by hours saved × confidence, each with **Generate** | Turns the dashboard into the main work surface, not a list. |
| Repo health | Each project: branch, last analysed, commits since, status (up to date / new commits / failed / needs GitHub refresh), findings count, **Re-analyse** | Tells users what needs attention. |
| Security panel | Open secret findings by severity across repos ("2 repos expose keys") | Real value even before any flow is built, and it is a fear-driven hook. |
| Recent activity | Analyses, generations, exports | Shows progress. |
| Getting-started checklist | Connect GitHub → add repo → analyse → generate → export (hides when done) | Gets new users to the first "wow" moment. |

Needs one backend addition: an estimated frequency and minutes saved per recommendation (a new field on `RecommendationDraft`, filled by the AI and shown as an estimate).

## 2. Features — recommended order

### Tier 1: before launch (high value, mostly cheap)
1. **Real dashboard** (above).
2. **Auto re-analysis on push + notifications.** On a push to the chosen branch, re-analyse (within the daily cap) and show "3 new automations in booklod" in-app; optional weekly email digest. The webhook already exists. *Main retention driver.*
3. **Security center.** All secret findings across repos, mark as fixed or ignored, re-check on next analysis. *Standalone value; differentiates from plain AI code tools.*
4. **Flow library** (after Phase 3). Every generated flow across projects, versions, search, re-export.
5. **Setup checklist per flow.** Which n8n credentials to create, which env values the flow expects, a link to n8n docs per node. *Cuts "it does not work" support.*

### Tier 2: before launch if time allows
6. **Integrations page** (the own-AI-key part is APPROVED above as Phase 2e):
   - **Own AI key (bring your own key):** Anthropic (and possibly OpenAI). Heavy users then cost us no tokens. Stored encrypted in Supabase Vault, shown masked, "Test key" button, deletable. Paid providers only; never free endpoints that log data for real users.
   - **Notifications:** email and a Slack incoming-webhook URL for the digest.
   - **GitHub:** current connection and access status (moved from Settings).
7. **Shareable report.** A read-only link or PDF of an analysis ("what we can automate for you"). Agencies use it to sell to their clients; each shared report advertises Flow Motion.

### Tier 3: after launch
- Team workspaces and seats (ties into billing, NOT READY).
- Push flows straight into the user's n8n (NOT READY, `docs/n8n.md`).
- Scheduled analyses, public template gallery, other export formats.

## What not to build
- **GitHub personal access tokens:** the GitHub App is safer (per-repo, revocable, short-lived tokens).
- **Collecting users' third-party credentials for their flows** (Stripe, Gmail, etc.). Those belong in the user's own n8n. Storing them would make Flow Motion a high-value breach target.

## Suggested phase order
Phase 3 flows → Phase 4 simulation → **Phase 6: dashboard + auto re-analysis + notifications + security center** → **Phase 7: flow library + setup checklist + integrations (own AI key) + shareable report** → Phase 5 hardening last (so it covers everything) → launch.

## Recommendation list fixes (from first live test, 2026-11-25)
First live run on `booklod` (OpenRouter `particle-ai/particle-1`, under $0.01 per analysis) produced specific, security-aware recommendations, but too many at once. Proposed for the dashboard round:
1. Show the top 3-5 first (ranked by hours saved x confidence), "Show all" for the rest.
2. Cards unchecked by default, so users pick deliberately.
3. Risk colours: Low neutral or green, Medium amber, High red (today Low is red too).
4. Filters or grouping by trigger, risk and credential.
5. Show confidence as Low / Medium / High words instead of raw percentages (55-58% reads as weak).

## Owner decisions needed
1. Which Tier 1 and Tier 2 items are in?
2. Is an AI-estimated "hours saved" figure acceptable if it is clearly labelled as an estimate?
3. Own AI key: Anthropic only, or Anthropic and OpenAI?
4. Notifications: in-app only, plus email, plus Slack?
