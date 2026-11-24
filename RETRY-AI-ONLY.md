# RETRY-AI-ONLY — idea for owner decision (draft, 2026-11-25)

Owner idea: when only the final AI step fails, let the user continue from the AI step instead of running the full analysis again. Not in the contract yet. If approved, the architect turns it into a small phase (2d, or with the dashboard and retention features).

## Where the cost actually is
| Part of the analysis | AI tokens? | What it costs |
|---|---|---|
| Validate, select, fetch, scan, detect | None | GitHub API calls and about 1 minute |
| AI step | Yes, all of it | The full prompt (about 83k tokens for `booklod`) is sent on every try |

Caching does **not** save AI tokens: every retry sends the full prompt again. Provider refusals such as 429 cost nothing, because the model never ran.

## Pros
- **Faster recovery:** retry takes seconds instead of re-reading the whole repo.
- **Fair to users:** a busy AI provider does not use up one of their 10 daily analyses.
- **Fewer GitHub API calls** as the user base grows.
- **Professional feel:** AI providers fail sometimes, even paid ones; graceful recovery reduces complaints.

## Cons
1. **Code kept longer:** secret-redacted snippets stay for up to 1 hour after a failure (today they are deleted at once). Bigger breach window; `/privacy` may need a line.
2. **More complexity:** new resume path, route, button and expiry logic; more tests, more support questions.
3. **Abuse risk:** if retries do not count toward the daily limit, they need their own limit or someone can loop AI calls at our cost.
4. **Stale results:** after a new push, a retry would analyse old code. A commit check prevents this but makes the button sometimes disappear.
5. **Helps only one failure type:** busy or slow provider. Bad output or an oversized repo usually fails the same way again.
6. **Smaller benefit in production:** with a reliable paid model (Anthropic), AI failures are rare.
7. **Delays the core product:** every small phase pushes back Phase 3 (flow generation).

## Proposed design (if approved)
- Shown only when an analysis ends with `AI_UNAVAILABLE` (provider busy, rate-limited or timed out): two buttons, **Retry AI step** and **Run full analysis**.
- "Retry AI step" allowed only if:
  1. within **1 hour** of the failure, and
  2. the branch still points to the **same commit**.
- Retries do **not** count toward the daily cap, but are limited to **3 per analysis**.
- The redacted job state is kept only for `AI_UNAVAILABLE`, never sent to the browser, and deleted after 1 hour or on success (architect records the retention rule; `security.md` section 3 changes).
- Size: small to medium (backend resume step and route, one frontend button, tests, reviews).

## Recommendation
Worth building. Biggest real costs are the 1-hour code retention and delaying Phase 3. Fair middle ground: build it later with the dashboard and retention features, and test with a paid model now. Building it now (as Phase 2d) is also a sound choice.

## Owner decision
- [ ] Build now as Phase 2d
- [ ] Build later with the dashboard and retention features
- [ ] Do not build
