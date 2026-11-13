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

## Phase 2 (2026-11-13) — analysis pipeline, worker, analyze/analyses/findings/recommendations routes

Scope: working tree at `658616f` plus the uncommitted Phase 2 files: `src/lib/security/**`, `src/lib/analysis/**`, `src/lib/jobs/**`, `src/server/jobs/**`, `src/server/analyses.ts`, `src/server/daily-cap.ts`, the analyze, analyses, findings, recommendations and project routes, `src/features/analysis/**`, `supabase/functions/worker` + `import_map.json`, `supabase/migrations/20261114000000_phase2_analysis.sql`, `supabase/manual/phase2_cron.sql`, and the diffs in `src/lib/env.ts`, `src/server/github/user-auth.ts`, `src/schemas/github.ts`, `.env.example` (names only).

Counts: high 0 · medium 2 (S2-1, S2-2) · low 5 (S2-3..S2-7). S11-2 (RLS suite never run) is still open. **Release blocked** by S2-1, S2-2 and S11-2. The owner can safely apply `20261114000000` and run an analysis of their own repository now with `ANALYSIS_MODEL=disabled`. Do not enable AI (Phase 2b) until S2-2 and S2-5 are fixed.

### S2-1 · medium · resolved (backend 2026-11-13, pending re-review)
- **file:** `src/app/api/projects/[id]/analyze/route.ts` (calls `requireRepoAccess` with `repoId`), `src/server/github/repo-access.ts` (`requireRepoAccess` / `evaluateRepoAccess` match on `repo_id` only), `src/lib/jobs/analyze.ts` (`stepValidate`, `stepSelect`, `stepFetch` fetch by `project.repo_full_name`), `src/lib/jobs/supabase-db.ts` (`ProjectRef` has no `repo_id`).
- **risk:** Authorization and data access use different repo identifiers. The analyze gate proves that the user can access repo **id** `projects.repo_id`. The worker then reads the tree and blobs of repo **name** `projects.repo_full_name` with an installation token, and it never checks that this name still resolves to that id. Example: the user added `org/api` (id 1) earlier. The org renames it to `org/api-legacy` and creates a new private `org/api` (id 2) that this user cannot see, in the same "All repositories" installation (a common pattern). On the next refresh, id 1 is still in the user's set under its new name, so analyze passes. The worker then fetches `org/api`, which is now repo 2, and the user receives repo 2's file paths, signals, masked findings, commit SHA and, once AI is on, recommendations. This is the cross-repo IDOR that D-22 was meant to close.
- **owner:** backend.
- **fix:** (1) Add `repo_id` to `ProjectRef` / `getProject`. In `stepValidate`, call `GET /repos/{o}/{r}` (already wrapped as `getInstallationRepo`) and require `id === projects.repo_id`. Otherwise end with `GITHUB_ACCESS_LOST` (non-retryable) before any tree or blob read. (2) As defence in depth, the analyze route also requires `access.repo_full_name.toLowerCase() === project.repo_full_name.toLowerCase()`, else `GITHUB_REFRESH_REQUIRED` (contract section 6 note via architect). (3) Add a worker test where the name resolves to a different id and no tree or blob is fetched.

### S2-2 · medium · resolved (backend 2026-11-13, pending re-review)
- **file:** `src/lib/security/secret-scanner.ts` (the `high-entropy assignment` detector at ~line 271 requires a quoted value; provider detectors at lines 159-292).
- **risk:** `security.md` section 2 requires detecting "generic high-entropy strings next to words like key, token, secret, password". The generic detector only fires on **quoted** values. Unquoted assignments are the normal form in exactly the files most likely to hold real secrets: `.env.example` (the one env file the policy deliberately reads, `API_KEY=...`), docker-compose `environment:` lists, YAML configs (`password: ...`) and shell exports. Common key formats with no specific detector also pass: OpenAI `sk-...`/`sk-proj-...`, Anthropic `sk-ant-...`, SendGrid `SG.`, npm `npm_`, GitLab `glpat-`, Supabase `sb_secret_`. Today (AI off) the result is a missed finding in a security product. Once AI is on (Phase 2b, OpenRouter free endpoints that may log or train), these values are **not redacted** and go to the provider, which violates "`[REDACTED]` replaces it in anything sent to the model".
- **owner:** architect (widen contract section 11 Phase 2 item 4 from "quoted" to quoted or unquoted) then backend.
- **fix:** Add an unquoted variant: `NAME\s*[:=]\s*VALUE` at line start or after `export ` / `- `, where VALUE is 20+ non-space, non-quote, non-`#` characters, with the same name, placeholder and entropy rules. Also add prefix detectors for `sk-ant-`, `sk-proj-` / long `sk-` keys, SendGrid `SG.x.y`, `npm_`, `glpat-` and `sb_secret_`. Add positive and negative tests for `.env.example`, compose and YAML lines. This is a gate before any AI provider is enabled.

### S2-3 · low · resolved (backend 2026-11-13, pending re-review)
- **file:** `src/lib/analysis/extractors/util.ts` (`lineOf`, called from `signal()` for every regex match before dedupe), `src/lib/jobs/worker.ts` (`withTimeout`).
- **risk:** `lineOf` rescans the file from offset 0 for every match. Measured: one 200 KB file with 10,000 `process.env.X` lines takes **6.1 s** for a single extractor. A batch of 25 such files keeps the CPU busy for minutes. `withTimeout` cannot interrupt synchronous work, so the 20 s step budget is not enforced. Under the D-26 local runner this blocks the whole `next dev` event loop. On the Edge Function it exhausts the CPU limit and the job crash-loops until `max_attempts`. The repo content controls this (a user's own repo, bounded by daily caps), so impact is availability only.
- **owner:** backend.
- **fix:** Compute line starts once per file and binary-search them, as `secret-scanner.ts` already does. Cap the matches per extractor per file (for example 500) before building signals.

### S2-4 · low · resolved (backend 2026-11-13, pending re-review)
- **file:** `src/lib/analysis/validity.ts` (`pickManifestPaths`), `src/lib/jobs/analyze.ts` (`stepValidate`).
- **risk:** `pickManifestPaths` accepts `reason === "extension"` so that `requirements.txt`, `go.mod`, `pom.xml`, `Pipfile` and `build.gradle` pass. `classifyPath` returns `extension` before it checks size, so these manifests are never size-checked. The comment says "Size is checked by the caller", but `stepValidate` does not check it. Up to 15 manifests of any size (GitHub's blob API serves up to 100 MB) are downloaded, base64-decoded and parsed in memory. That is a memory and CPU exhaustion vector in the worker.
- **owner:** backend.
- **fix:** In `pickManifestPaths`, also drop entries with `size > MAX_FILE_BYTES`. Add a test.

### S2-5 · low · resolved (backend 2026-11-13, pending re-review; was: becomes medium when AI is enabled)
- **file:** `src/lib/jobs/worker.ts` (state cleared only in `endJob` and on `done`), `supabase/migrations/20261114000000_phase2_analysis.sql` (no job retention), D-25 (cron optional).
- **risk:** `jobs.state` is cleared only when a job reaches `done` or `failed` while the worker still holds the lock. A chain that breaks (failed self-call, no `pg_cron`, user closes the tab) leaves the job `queued` forever, with no TTL. Its state holds selected paths, blob SHAs, masked findings and signals. With AI on it also holds up to about 300k characters of **redacted source snippets**. That contradicts `security.md` section 3 "Delete temporary text when the analysis ends" and section 7 "source retained in jobs". It also blocks re-analysis of the project until someone polls.
- **owner:** backend (with architect for the retention rule).
- **fix:** Add a service-role function that fails any active job not updated for 24 h: set `status = 'failed'`, `state = '{}'`, mark the analysis `failed`/`INTERNAL`, and schedule it with the existing purge cron. Also run it opportunistically from `claim_job()` or the poll kick so it works without `pg_cron`. Required before Phase 2b.

### S2-6 · low · resolved (backend 2026-11-13, pending re-review)
- **file:** `supabase/config.toml` (`[functions.worker] verify_jwt = false`), `supabase/functions/worker/index.ts`, `src/server/jobs/trigger.ts`, Vault `worker_token`.
- **risk:** The worker bearer **is** the service-role key, and it is copied into Vault, the Next env and the Edge self-call. Anyone who can read `vault.decrypted_secrets` or the `pg_net` request queue gets full database bypass, not just "run one worker step". The function is also publicly invocable (`verify_jwt = false`), so unauthenticated callers each cost an invocation even though they are rejected with 401. The compare itself is correct: constant time, empty key rejected, length-independent loop.
- **owner:** architect (contract section 10), then backend.
- **fix:** Use a dedicated random `WORKER_TOKEN` (function secret + Vault + server env) instead of the service-role key for the worker endpoint, and keep the constant-time compare. Note (functional): if the project uses the new `sb_secret_...` API keys, the `SUPABASE_SERVICE_ROLE_KEY` injected in the Edge runtime may differ from the Next env key, and every trigger will 401. Verify on deploy.

### S2-7 · low · resolved (backend 2026-11-13, pending re-review)
- **file:** `src/lib/security/path-policy.ts` (`DENY_SEGMENT_GLOBS`, `ALLOWED_EXTENSIONS`); `security.md` section 1 deny list.
- **risk:** Several well-known credential files pass the deny list through allowlisted extensions, are fetched, and rely only on content scanning (see S2-2). Examples: `.yarnrc.yml` (`npmAuthToken`), Composer `auth.json` (GitHub/GitLab tokens), `*-firebase-adminsdk-*.json` (service-account JSON not matching `service-account*.json`), `appsettings.Production.json` (connection strings) and `wp-config.php` (DB password, salts).
- **owner:** architect (deny list), then backend.
- **fix:** Add `.yarnrc.yml`, `auth.json`, `*adminsdk*.json`, `appsettings.*.json` and `wp-config.php` to the deny list with path-only findings. Add tests.

### Verified, no finding
- **Path policy before fetch:** `selectFiles` classifies every tree blob, and only `selection.selected` is fetched. Denied, extension, size and cap files are counted and never fetched (worker test "no file fetched beyond manifests"). Validate-step manifests pass the deny list first (size gap S2-4).
  - Normalisation handles `\`, `./`, `.`, `..` and root escape (denied). Deny globs are case-insensitive per segment. The `.env.example` exception is exact and case-sensitive, and the file is still scanned.
  - Required tests exist: `./.env`, `a/../.env`, `sub\.env`, `.ENV`, `.ENV.EXAMPLE`, `.env.example.bak`, `.env.sample`, subdirectory `.env.example`, and scanner on `.env.example`.
  - Blobs are fetched by tree SHA (validated `^[0-9a-f]{40,64}$`), never by path, so path tricks cannot redirect a fetch.
  - Symlinks (mode 120000) return their target string, not the target file. Submodules (`type: commit`) are filtered out. Git paths are literal, so there is no URL-decoding surface.
- **Scanner placement and redaction:** `stepFetch` scans every fetched file before extraction or storage. Only the redacted text reaches the extractors and snippets, and snippets are kept only when AI is enabled. Masking is at most 2+2 characters, or the type only under 12 characters. Findings are masked before `jobs.state`. The worker test "never writes raw secrets or file text into job state, and never logs them" covers this. Manifest text is parsed in memory only.
- **Job state and logs:** state is cleared on `done` and on every `endJob`, and the findings array is emptied after `detect`. `jobs.state` has no client column grant, and routes never select it (test). Worker and Edge logs carry ids, steps, counts, codes and error names. Supabase and GitHub errors carry codes and statuses only. The Anthropic adapter errors carry the status only.
- **Prompt injection:** the system prompt declares the delimited content to be data. `</repo_file` and `</signals` inside text are escaped, path attributes are escaped, and signals JSON escapes `<`. The model call has no tools. Output goes through the per-item Zod `recommendationDraftSchema` (plain text, no control characters, length limits). `source_files` is limited to sent paths, and credentials and node types are allowlisted. The UI renders every field as JSX text. There is no `dangerouslySetInnerHTML` in `src/`, and the only links are fixed app routes.
- **No SSRF, no execution:** outbound calls go only to `GITHUB_API_URL`, `api.anthropic.com` (constant), and the Supabase URL from env. Repo names, branches and SHAs are validated and encoded. No `child_process`, `eval` or `new Function` exists, and nothing from the repo is installed or run.
- **Analyze route:** order is session → Origin → 10/min → uuid → project owned (RLS client + `user_id`) → installation present → `requireRepoAccess` (fresh set, before any GitHub call or insert) → active check → daily cap (consumed last) → insert → trigger → audit. Tests cover each branch. Gap: S2-1.
- **Read routes:** analyses, findings and recommendations use the session client plus `user_id`. `?analysisId` must belong to this project and user, otherwise `NOT_FOUND` (tests). The poll kick reads only non-state job columns of the owner's job.
- **Daily cap and rate limits:** `daily:analyze:<uid>:<UTC day>` through `rate_limit_hit` (service role), which fails closed on DB error. Every Phase 2 route applies the per-user limit, and analyze applies the 10/min `heavy` limit.
- **Local worker (D-26):** `runsWorkerLocally()` is `NODE_ENV !== "production"`. `next start` and Vercel are `production`, so deployed apps POST to the Edge Function. The residual (non-standard `NODE_ENV`) is accepted in D-26.
- **Worker endpoint:** POST only. The bearer is compared with `timingSafeEqualString` (length-independent loop), and an empty key is rejected. The self-call reuses the same bearer (see S2-6).
- **Migration `20261114000000`:**
  - Additive and guarded (`if not exists`, `duplicate_object`, `create or replace`). It creates no extensions or cron jobs, and the cron script lives outside `migrations/`.
  - `claim_job`, `purge_rate_limits`, `kick_worker` and `link_github_installations` are all `security definer` with `search_path = ''`, use schema-qualified names, have `execute` revoked from `public`, `anon` and `authenticated`, and are granted to `service_role` only. The RLS suite asserts this, but the suite is skipped (S11-2).
  - `kick_worker` reads Vault at call time and no-ops without `pg_net` or the secrets.
  - No grant or policy is widened: the new columns inherit the existing owner-only table `select`, and the `jobs` column grant still excludes `state`.
  - The S11-7 advisory lock is present, so S11-7 is resolved once the migration is applied.
- **Secrets in repo/bundle:** `.env` and `.env.*` are git-ignored, and only `.env.example` is tracked. No secret env name is referenced in client code; the `NEXT_PUBLIC_SERVICE_ROLE_KEY` strings are finding-evidence fixtures. `admin.ts` and `env.server.ts` import `server-only`.
- **`npm audit`:** 3 low (deepmerge via the `shadcn` CLI devtool, GHSA-gcqx-w48m-w2h4), no high or critical.
- **Tests:** `vitest run` from `C:\Users\amon\Desktop\flowmotion`: 801 passed and 80 skipped (the RLS suite, including the new Phase 2 RLS cases, so S11-2 stays open). The global fetch guard blocks the network in all tests.
