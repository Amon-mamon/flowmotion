> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Security review

Written by `security-reviewer`. Each finding: `file` · `risk` · `severity` (high/medium/low) · `owner` · `fix` · `status` (open/resolved).

Checklist per run: path policy tests, secret scanner tests, no secret content in logs or storage, RLS tests, service role key only on the server, input validation, webhook signature check, prompt-injection handling, export safety, dependency audit.

## Phase 1.1 (2026-11-13) — branch selection, D-20 GitHub link fallback, Phase 1 auth/GitHub surface

Scope: `GET /api/github/authorize`, `GET /api/github/installations/callback`, `src/server/github/{state,user-auth,repo-access,app,push}.ts`, `src/server/installations.ts`, `GET /api/github/installations/:id/branches`, `POST /api/projects`, `src/lib/github/client.ts`, `src/schemas/github.ts`, webhook `push`, migration `20261113000000_phase1_1_project_branch.sql`, `src/features/auth/error-messages.ts`. Uncommitted Phase 2 code was only scanned for high-severity issues (none found; it has no worker steps yet).

Initial counts: high 1 · medium 1 · low 4. **After re-review (2026-11-13): open high 0 · medium 1 (S11-2) · low 2 (S11-6 accepted until D-21, S11-7). Release blocked by S11-2 until the RLS suite runs green.**

### S11-1 · high · resolved (verified by security-reviewer 2026-11-13; effective once migration 20261113120000 is applied)
- **file:** `src/server/github/user-auth.ts` (`listUserInstallations`), `src/app/api/github/installations/callback/route.ts`, `src/server/github/repo-access.ts` (`resolveCoveredRepo`), `src/app/api/github/installations/[id]/repos/route.ts`, `src/app/api/projects/route.ts`; contract section 6 / `security.md` section 3.
- **risk:** Ownership is proven at the installation level only, not per repository. Per GitHub's docs, `GET /user/installations` lists every installation in which the user can access **at least one** repository (owner, collaborator, or org member). After linking, everything uses the installation token or App JWT: the repos list shows every repo in the installation, and `POST /api/projects` plus the branches route only check that the installation covers the repo (`GET /repos/{o}/{r}/installation`). They never check that the GitHub user can read that repo. Example: an org installs the App on "All repositories". A member with read access to one repo links the installation and can then list the private repo names, add any private repo in the org, and (from Phase 2) receive its file paths, signals, masked findings, and recommendations. D-20 makes this worse because it binds **every** listed installation automatically, with no installation id chosen. Access is also never re-checked, so a user removed from the org or repo keeps the binding.
- **owner:** architect (contract and `security.md` change), then backend.
- **fix:** While the user token is still in memory in the callback, call `GET /user/installations/{id}/repositories` (paged, Zod-parsed) for each installation and store the accessible repo ids per `github_installations` row (new table with owner-only RLS, or a `bigint[]` column, in an append-only migration). Filter the repos list to that set. Require the repo id in `POST /api/projects`, the branches route, and (Phase 2) `analyze`. Refresh the set on every relink, and treat a missing set as "relink required". Simpler alternative: bind only installations whose `account` is the user's own GitHub account or an org where the user is an admin. Add tests for an org member whose access is limited to some repos.

### S11-2 · medium · open (fixed in code and verified by reading; stays open until the RLS suite runs green against local Supabase with all migrations)
- **file:** `tests/rls/rls.test.ts` (seed rows at lines ~71-77, FK test at ~283-290)
- **risk:** The required cross-user RLS suite (`security.md` section 5) is skipped in this environment ("no local Supabase", 67 skipped). Its `projects` and `analyses` seed rows also omit `branch`, which is `not null` after the Phase 1.1 migration. On a migrated database the seeds would fail with 23502, and the composite-FK test would get 23502 instead of the expected 23503. So the suite cannot currently verify owner-only access on the changed tables.
- **owner:** backend.
- **fix:** Add `branch: "main"` to the `projects` and `analyses` seeds and to the FK test insert. Run the suite against a local Supabase with all three migrations applied (`SUPABASE_TEST_*`) and record the result in `status.md` before the phase is marked done. Add a test that user A cannot read user B's `projects.branch` / `analyses.branch`.

### S11-3 · low · resolved (verified 2026-11-13)
- **file:** `src/app/api/github/installations/callback/route.ts` (no-state branch), `src/app/api/github/authorize/route.ts`
- **risk:** A cross-site top-level GET to the callback (or to `/api/github/authorize`) with no state starts the authorize hop. GitHub returns at once for a user who already authorized the App, and every installation reachable by the **GitHub identity in that browser** is bound to the **Flow Motion user in that browser**, with no user action or confirmation. Login CSRF into Flow Motion is not currently possible (Supabase PKCE, browser-side password sign-in), so this chain has no exploit today. On shared browsers, or if login CSRF appears later, it becomes account cross-linking, which S11-1 then turns into repo access.
- **owner:** backend (with architect for the contract wording).
- **fix:** For a no-state callback, redirect to `/dashboard?link=github` and let the user click "Link existing installation" instead of redirecting automatically. Alternatively, have `/api/github/authorize` refuse requests with `Sec-Fetch-Site: cross-site`. Show the linked GitHub account logins in the `connected=1` notice.

### S11-4 · low · resolved (verified 2026-11-13)
- **file:** `src/schemas/github.ts` (`repoFullNameSchema`), `src/lib/github/client.ts` (`encodeRepoPath`), `src/lib/github/app-client.ts`
- **risk:** `[A-Za-z0-9_.-]+` accepts `.` and `..` as the owner or name, and `encodeURIComponent` leaves them unchanged. So `repo=../meta` becomes `https://api.github.com/meta` after URL dot-segment normalisation, and `../x` with the `/branches` suffix becomes `/x/branches`. Calls stay on `api.github.com`, and every response is Zod-parsed (repo shape, then the GitHub-returned `full_name` is used for the coverage check), so there is no SSRF or bypass today. It is still path traversal within the GitHub API using our installation token or App JWT.
- **owner:** backend.
- **fix:** Reject segments equal to `.` or `..` in `repoFullNameSchema`, and in `encodeRepoPath` as defence in depth. Add a test.

### S11-5 · low · resolved (verified 2026-11-13)
- **file:** `src/app/api/github/authorize/route.ts`
- **risk:** When rate limited, `enforceIpLimit` throws and `withApi` returns a JSON 429 to a browser navigation. This is inconsistent with the callback's redirect-on-every-failure rule, and the user sees raw JSON. The message itself is generic, so nothing leaks.
- **owner:** backend.
- **fix:** Catch `RATE_LIMITED` and redirect to `/dashboard?error=github`, as the callback does.

### S11-6 · low · open (accepted until the D-21 launch gate, D-23)
- **file:** `src/features/auth/components/signup-form.tsx`, `src/features/auth/error-messages.ts`
- **risk:** The UI mapping is correct. Only `over_email_send_rate_limit` (project-wide, not tied to an address) and `over_request_rate_limit` get their own copy, and everything else is generic. But the browser calls Supabase directly, so while "Confirm email" is off, signing up with an existing address returns `user_already_exists`, which is visible in the network response. A new address returns a session. Either way, account existence can be enumerated outside the UI.
- **owner:** owner / architect (D-21 launch checklist).
- **fix:** Keep D-21 as a hard launch gate. With "Confirm email" on, Supabase returns an obfuscated user for existing addresses. Confirm that behaviour on the hosted project before real users.

### Verified, no finding
- State: 32-byte random value, cookie `<userId>.<state>`, httpOnly, `secure` on https APP_URL, `sameSite=lax`, path `/`, 10-minute max-age. User and state are compared in constant time. The cookie is cleared on every callback outcome (including rate limit, bad query, and internal errors). `code` is never used without a verified state. A query `installation_id` is only a filter and is rejected if it is not in the user's list. Nothing is bound on any failure path. The user token stays inside `resolveUserInstallations` and is never stored, logged, or returned. Errors log the operation and status only.
- Redirects use fixed paths on `APP_URL`. `redirect_uri` is built from `APP_URL`, so there is no open redirect.
- Branches route and `POST /api/projects`: session check, rate limit, uuid param, installation row looked up with the RLS session client plus `user_id` (IDOR returns `NOT_FOUND` / `VALIDATION_ERROR`), coverage via the App JWT. Every GitHub response is Zod-parsed (branch list items, single branch with a 40-hex sha, repo). The stored branch is GitHub's `name`. Branch names are encoded per segment, and the schema blocks `..`, `.`-prefixed segments, `//`, `\`, control characters, `?`, and `@{`. `%` is double-encoded. The composite FK keeps projects on the same user's installation.
- Webhook: HMAC-SHA256 over the raw bytes before decoding, constant-time compare, empty secret rejected. Push matching uses the exact `refs/heads/<branch>`, scoped to projects whose installation row has the event's GitHub id. Updates write only `last_commit_sha` and `stale`.
- Migration: append-only, the Phase 0/1 files are unchanged, there are no grant or policy changes, and `projects`/`analyses` keep owner-only select with no client writes.
- Secrets: `.env`, `.env.*` are git-ignored; only `.env.example` is tracked (not opened). No service role or secret env in client code. `NEXT_PUBLIC_*` hits are scanner patterns and fixtures only.
- `npm audit`: 3 low (deepmerge via the `shadcn` CLI devtool, GHSA-gcqx-w48m-w2h4), no high or critical.
- Tests: `vitest run` reports 354 passed and 67 skipped (the RLS suite, see S11-2). D-20 callback paths, the authorize cookie and URL, the branch schema, and route ownership and coverage are covered.
- Note (not security): `installationCallbackQuerySchema` requires `code`. If the GitHub App setting "Request user authorization (OAuth) during installation" is off, the `/api/github/install` round trip returns no `code` and always ends in `?error=github`. Confirm that setting is on, or send the no-code-with-state case to `/api/github/authorize`.

### S11-7 · low · open
- **file:** `supabase/migrations/20261113120000_phase1_1_repo_access.sql` (`link_github_installations`, the `perform ... for update` line)
- **risk:** The per-user serialisation only locks rows that already exist. If a user has no `github_installations` rows, two concurrent callbacks from different GitHub accounts both pass the `github_account_mismatch` check. Each then inserts rows with a different `github_user_id`, which breaks D-22's "one GitHub account at a time" rule. Triggering this needs two valid state cookies for the same Flow Motion user (two browsers, both the user's own), so no other tenant is exposed. Each repo set is still the one GitHub evaluated for the account that linked it.
- **owner:** backend.
- **fix:** In a new, later migration (D-19), add `perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));` at the start of the function, replacing or alongside the row lock, via `create or replace function`. Not a release blocker.

## Phase 1.1 security fixes — re-review (2026-11-13)

Verified against the code, not the status fields. `vitest run`: 416 passed, 76 skipped (the RLS suite, no local Supabase).

- **S11-1, end to end:** an org member can no longer reach repo B.
  - The callback (`resolveUserAccess` in `src/server/github/user-auth.ts`) gets the user token, calls `GET /user`, `GET /user/installations`, then `GET /user/installations/{id}/repositories` for each installation (paged, Zod-parsed, names failing `isValidRepoFullName` dropped and counted). The token is a local variable inside that function. It is never returned, stored, or logged; errors carry the operation and status only.
  - The repos list now reads `github_installation_repos` only, with no installation-token call.
  - The branches route and `POST /api/projects` call `requireRepoAccess` before minting a token or making any GitHub call. That check covers ownership through the RLS session client plus `user_id`, the 24 h freshness rule (`needsRepoRefresh`), and an exact case-insensitive name match (ILIKE with escaped wildcards, then an exact lowercase compare). `resolveCoveredRepo` then requires GitHub's repo `id` to equal the access row's `repo_id`, and the App JWT coverage check still applies. The project stores `repo_id`.
  - Tests that would fail if the check were removed: `tests/server/repo-access-flow.test.ts` "repo b of the same installation is refused with no GitHub call for it". It uses the real route handlers, and its GitHub mock does serve repo B, so removing the check would yield 200/201 and GitHub calls. Also `tests/server/routes-ownership.test.ts`: inaccessible repo, stale set (25 h), never-synced set, and repo id mismatch.
  - **Phase 2 gate:** `POST /api/projects/:id/analyze` is not built yet. It must call `requireRepoAccess` by `projects.repo_id` (contract section 6). The Phase 2 security review must confirm this.
- **`link_github_installations()`:** checked the following.
  - It is `security definer` with `set search_path = ''`, and every relation is schema-qualified.
  - `execute` is revoked from `public`, `anon` and `authenticated` and granted to `service_role` only. The RLS suite asserts the client cannot call it.
  - It validates its arguments. The account-mismatch check runs before any write and raises, so the whole call rolls back and nothing is bound. The callback maps this to `?error=github_account`.
  - Each listed installation's repo set is deleted and then re-inserted (replace, not merge). Unlisted rows of the user are cleared and get `repos_synced_at = null`. An empty list only clears.
  - `p_user_id` always comes from the server session, and the installations come from GitHub's answer for this user's token, so it cannot bind another user's installation.
  - `on conflict on constraint github_installations_user_id_installation_id_key` matches the name Postgres generated for the Phase 1 inline unique. `#variable_conflict use_column` is placed correctly, and `xmax = 0` is valid.
  - Gap: S11-7.
- **Webhook `installation_repositories`:** only processed after signature verification. The payload is Zod-parsed. On `removed`, repo ids are deleted from every user's set for the installation rows with that GitHub id. On `added`, nothing happens.
- **S11-3:** a no-state callback redirects to `/dashboard?link=github` without using `code`. `/api/github/authorize` refuses `Sec-Fetch-Site: cross-site` before setting any cookie. Residual: `same-site` (a sibling subdomain) is allowed, which is acceptable while APP_URL's registrable domain hosts nothing else.
- **S11-4:** the owner segment is `[A-Za-z0-9-]+`, the name segment is `[A-Za-z0-9._-]+`, the maximum is 140 characters, and neither segment may be `.` or `..`. The same rule is enforced in `encodeRepoPath`, the DB check constraint, and on GitHub items before they are stored.
- **S11-5:** a rate-limited `/api/github/authorize` or `/api/github/install` now redirects to `/dashboard?error=github`.
- **Migration safety (hosted DB with baseline, Phase 1 and 20261113000000 applied):**
  - The script is append-only (the earlier migration files are unchanged per `git diff`) and re-runnable: `if not exists` guards, duplicate-guarded constraints, `create or replace function`, and `drop policy if exists`.
  - New columns are nullable with no backfill, so it is safe on existing rows. Pre-D-22 rows simply need a refresh.
  - The new table has RLS enabled with a single owner-only `select` policy. It runs `revoke all from anon, authenticated` and then `grant select to authenticated` only, which also overrides Supabase's default privileges.
  - The composite FK `(installation_id, user_id)` points to `github_installations(id, user_id)` with cascade. No existing grant or policy is widened.
  - It runs as a single script in the Supabase SQL Editor.
