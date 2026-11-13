> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Code review

Written by `code-reviewer`. Each finding: `file` · `problem` · `severity` (high/medium/low) · `owner` (backend/frontend/architect) · `suggested fix` · `status` (open/resolved).

## Phase 0 — Foundation (reviewed 2026-11-10)

Scope reviewed: the whole uncommitted working tree (`git status`), since nothing is committed yet. Contract sections 9, 10, 11 and security.md section 5 used as the reference. Note: the architect edited `docs/contract.md` while this review ran (section 10 gained `GITHUB_APP_SLUG`, section 3 now names `src/proxy.ts`); findings below are against the contract as it stands now.

### Command results
| Command | Result |
|---|---|
| `npm run typecheck` | pass (exit 0) |
| `npm run lint` | pass (exit 0, no warnings) |
| `npm test` | pass (2 files, 9 tests) |
| `npm run build` | pass (Next 16.4.6, Turbopack, `/` and `/_not-found` static) |
| `npm audit` | 3 low (deepmerge via `@shadcn/registry` → `shadcn` CLI code path; only `shadcn/tailwind.css` is consumed at runtime). Already recorded in `docs/requests.md`. |

### Verified OK (no finding)
- Env: `serverEnvSchema` and `.env.example` both contain exactly the 11 names of the contract as it was at the start of Phase 0 (see R0-1 for the name added since). No `NEXT_PUBLIC_` on any secret. `env.server.ts` and `supabase/admin.ts` import `server-only`; `getClientEnv()` references `process.env.NEXT_PUBLIC_*` literally so Next inlines them. `src/lib/env.ts` exports only schemas and pure parsers (names, never values), so a client bundle that pulls it in leaks nothing. Error messages list names only, verified by test.
- `.gitignore`: `.env`, `.env.*` ignored with `!.env.example` exception; `*.pem`, `*.key` ignored; `git check-ignore` confirms `.env.local`, `.env.production`, `.env.test` are ignored and `.env.example` is not. No `.env.local` exists in the tree and no test references one (`vitest.config.mts` sets `test.env: {}` and tests use explicit sources).
- TypeScript strict on, no `any` in `src/` or `tests/`, lint clean. All dependencies pinned exactly; `package-lock.json` present and not ignored.
- Migration: RLS enabled on `profiles`; `select`/`update` policies are owner-only (`(select auth.uid()) = id`, `to authenticated`); no insert/delete policies; column grant limits client updates to `display_name`; `anon` has no grants. Trigger function is `security definer` with `set search_path = ''`, fully-qualified table, `execute` revoked from `public`, `anon`, `authenticated`. Only `profiles` is created (Phase 1 scope respected). PK on `id` is the only index needed.
- Security headers present: HSTS (2 y, includeSubDomains, preload), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `poweredByHeader: false`. CSP gap recorded as R0-3.
- Nothing from `docs/subscription.md` or `docs/n8n.md` was built. No UI beyond `src/app/page.tsx` placeholder, root layout, and the shadcn `button`.
- Tests exercise real failures: empty env lists all 11 missing names; whitespace value counted as missing, bad URL counted as invalid; non-numeric `GITHUB_APP_ID` rejected; values never appear in messages.

### Findings

**R0-1** · `src/lib/env.ts`, `.env.example`, `tests/env.test.ts` · **medium** · owner: backend · status: resolved
Problem: contract section 10 now lists `GITHUB_APP_SLUG` (added by the architect on 2026-11-10 after the backend finished). The server schema, `.env.example`, and the test's `CONTRACT_NAMES` list all lack it, so the test "covers exactly the names in contract section 10" is now false while still passing.
Fix: add `GITHUB_APP_SLUG: nonEmpty("GITHUB_APP_SLUG").regex(/^[a-z0-9-]+$/, "GITHUB_APP_SLUG must be a GitHub app slug")` to `serverEnvSchema`; add `GITHUB_APP_SLUG=your-app-slug` with a comment to `.env.example`; add the name to `CONTRACT_NAMES` and `validServer` in the test. See R0-9 for a test that would catch this drift automatically.

**R0-2** · `src/lib/env.server.ts` · **medium** · owner: backend (architect if the contract is amended instead) · status: resolved
Problem: contract section 10 says env is "validated at startup; the app fails fast if any are missing". The implementation validates lazily on first `getServerEnv()` call, so a missing `GITHUB_WEBHOOK_SECRET` or `ANTHROPIC_API_KEY` only surfaces when that route or worker step first runs, possibly days after deploy.
Fix: add `src/instrumentation.ts` exporting `register()` that calls `getServerEnv()` when `process.env.NEXT_RUNTIME === "nodejs"` and `process.env.NEXT_PHASE !== "phase-production-build"` (keeps `next build` and tests value-free, fails `next start`/`next dev` immediately). Keep the lazy cache for callers. Alternatively the architect records a decision changing section 10 to "validated at first server use"; one of the two must happen so the contract and code agree.

**R0-3** · `next.config.ts` · **medium** · owner: backend · status: resolved
Problem: security.md section 5 requires a CSP; the scaffold sends only `Content-Security-Policy-Report-Only`, with no `report-to`/`report-uri`, so nothing is enforced and violations are visible only in a browser console. The report-only policy also allows `script-src 'unsafe-inline' 'unsafe-eval'`, which production bundles do not need. `X-Frame-Options: DENY` does cover `frame-ancestors` for now.
Fix: in addition to the report-only full policy, send an enforced `Content-Security-Policy` with the directives that cannot break a Next/shadcn UI: `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`. Drop `'unsafe-eval'` from the report-only policy when `process.env.NODE_ENV === "production"` (it is only needed for dev HMR). Keep the Phase 5 TODO for nonces and full enforcement.

**R0-4** · `supabase/config.toml` · **low** · owner: backend · status: resolved
Problem: (a) `[auth] site_url = "http://127.0.0.1:3000"` and `additional_redirect_urls = ["https://127.0.0.1:3000"]` while `.env.example` sets `APP_URL=http://localhost:3000`; local Supabase Auth will refuse the Phase 1 `GET /api/auth/callback` redirect to `localhost`. (b) `[db.seed] sql_paths = ["./seed.sql"]` but no `supabase/seed.sql` exists. (c) `[studio] openai_api_key = "env(OPENAI_API_KEY)"` references an env name outside contract section 10. (d) `[auth.mfa.totp]` is disabled; contract Phase 5 adds MFA enrolment, so this must be flipped then.
Fix: set `site_url = "http://localhost:3000"` and `additional_redirect_urls = ["http://localhost:3000/**"]` (or change `APP_URL` in `.env.example` to `127.0.0.1` and keep both in sync); set `[db.seed] enabled = false` until a seed exists; set `openai_api_key = ""`; leave a comment on `[auth.mfa.totp]` pointing at Phase 5.

**R0-5** · `supabase/migrations/20261110000000_baseline.sql` · **low** · owner: architect, then backend · status: resolved
Problem: `profiles` has no `updated_at`. This matches contract section 5 exactly, so the migration is correct, but `/settings` (contract section 3) will edit `display_name` in Phase 1 and an audit timestamp is the usual pattern. Adding it later means an extra migration on a live table.
Fix: architect decides whether `profiles` gets `updated_at`; if yes, add it to contract section 5 and backend adds `updated_at timestamptz not null default now()` plus a `before update` trigger (`moddatetime` extension or a small plpgsql function with `set search_path = ''`) in the Phase 1 migration.

**R0-6** · `supabase/migrations/20261110000000_baseline.sql` · **low** · owner: backend · status: resolved
Problem: the `display_name` check allows whitespace-only values (`'   '` has `char_length` 3) and the trigger's `nullif(left(...), '')` does not trim, so a signup with `name: "  "` stores a blank display name.
Fix: use `btrim()` in the trigger (`nullif(btrim(left(coalesce(...), 80)), '')`) and tighten the check to `char_length(btrim(display_name)) between 1 and 80`.

**R0-7** · `supabase/migrations/20261110000000_baseline.sql` · **low** · owner: backend · status: open
Problem: `pg_cron` and `pg_net` are created in Phase 0 although nothing schedules or calls anything until Phase 2, and the reviewer could not apply the migration (no local Supabase running; `supabase db reset` is not read-only). `create extension pg_cron with schema pg_catalog` is the Supabase-documented form but it needs the `cron.database_name` setting, which the local stack provides; on a self-hosted/CI Postgres it would fail.
Fix: no code change required; backend should confirm `supabase db reset` applies cleanly in Phase 1 and record it in `docs/status.md`. When the Phase 2 migration adds the cron schedule, the service-role token must come from Vault (`worker_token`), never a migration file (contract section 10).

**R0-8** · `AGENTS.md` line 19 · **low** · owner: architect (owner-maintained root file) · status: open
Problem: doc consistency only (OQ-18, formerly OQ-13). Next 16 renamed `middleware.ts` to `proxy.ts`; contract sections 3 and 9 already say `src/proxy.ts`, but the AGENTS.md backend ownership row still lists `src/middleware.ts`. Not a code bug (neither file exists yet).
Fix: change `src/middleware.ts` to `src/proxy.ts` in the AGENTS.md ownership table and close OQ-18 with a `docs/decisions.md` entry (also covering the `cacheComponents` off and shadcn "base-nova" preset defaults recorded in OQ-18).

**R0-9** · `tests/env.test.ts` · **low** · owner: backend · status: resolved
Problem: the suite is good on failures but has no guard against `.env.example` drifting from the schema (R0-1 is exactly that drift), no test that the client schema rejects a non-http URL (`parseClientEnv({ ...validClient, NEXT_PUBLIC_SUPABASE_URL: "ftp://x" })`), and no test for the `getClientEnv()` path that reads `process.env`.
Fix: add a test that reads `.env.example` (`node:fs`), extracts `^([A-Z0-9_]+)=` keys, and expects them to equal `SERVER_ENV_NAMES` sorted; add the client-URL rejection case; add one `getClientEnv()` test with `vi.stubEnv`.

**R0-10** · `docs/requests.md`, `package.json`, `next.config.ts` · **low** · owner: backend (entry), architect (approval) · status: resolved
Problem: `@tailwindcss/turbopack` 4.3.5 and `tailwindcss` 4.3.5 are outside the AGENTS.md stack list and are not in the Phase 0 dependency request entry (Tailwind is implied by shadcn, but `@tailwindcss/turbopack` wired through `turbopack.rules["*.css"]` is a non-default integration with no PostCSS config, so `next build --webpack` would not process Tailwind). The request entry is still `Status: open`.
Fix: backend appends `tailwindcss`, `@tailwindcss/turbopack` (and the reason there is no `postcss.config`) to the existing request entry; architect reviews and marks it done or asks for changes.

**R0-11** · `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `src/components/ui/button.tsx` · **low** · owner: frontend (going forward) · status: resolved (frontend, 2026-11-12)
Problem: these are frontend-owned paths that the backend created during scaffolding. This is sanctioned by contract section 11 (Phase 0 is "scaffold Next.js, shadcn init", backend only), so it is not an ownership violation, but two things carry over: `globals.css` maps `--font-mono` to `--font-geist-mono`, which `layout.tsx` never defines (only Geist sans is loaded; design.md asks for a mono family for code and JSON), and `next/font/google` fetches fonts at build time so an offline CI build fails.
Fix: from Phase 1 the backend must not touch these files; frontend loads `Geist_Mono` with `variable: "--font-geist-mono"` in `layout.tsx` (or requests the `geist` npm package through `docs/requests.md` if offline builds matter).

**R0-12** · `tsconfig.json` · **low** · owner: backend · status: resolved
Problem: `strict` is on but `noUncheckedIndexedAccess` is off. Phase 2 code (path policy, secret scanner, batch cursors) is index-heavy; turning this on later means touching finished code.
Fix: add `"noUncheckedIndexedAccess": true` now while the codebase is about ten files (current tree has no unguarded index access that would fail).

### Counts
high 0 · medium 3 (R0-1, R0-2, R0-3) · low 9 (R0-4 to R0-12)

## Phase 1 — Auth and shell (reviewed 2026-11-12)

Scope reviewed: working tree against HEAD `31a7b8d` (all modified and untracked files from `git status`). References: contract sections 3, 5, 6, 10, 11 "Phase 1 scope"; design.md; security.md sections 1, 3, 5; D-11 to D-15. Live API integration could not be checked (no `.env.local` values; the reviewer does not read env files), so frontend-backend agreement was verified statically against `src/schemas/**`.

### Command results
| Command | Result |
|---|---|
| `npm run typecheck` | pass (exit 0) |
| `npm run lint` | pass (exit 0, no warnings) |
| `npx vitest run` (from `C:\Users\...`) | pass: 16 files passed, 1 skipped; 124 tests passed, 44 skipped (`tests/rls/rls.test.ts`, no `SUPABASE_TEST_*`) |
| `npm run build` | pass (Next 16.4.6 Turbopack; 13 API routes dynamic, pages static except `/projects/[projectId]`; Proxy registered) |

### Verified OK (no finding)
- Frontend/backend agreement: every fetch path and method in `src/features/*/queries.ts` matches a route under `src/app/api/**`; DTOs are parsed with the backend-owned shared schemas (`src/schemas/{api,project,github,profile}.ts`) through thin re-exports; camelCase keys, `{ repos, page, hasMore }` paging with `getNextPageParam = page + 1`, `{ deleted: true }`, `{ signedOut: true }`, 201 on create, and error codes (`VALIDATION_ERROR` duplicate message "This repository is already connected", `RATE_LIMITED`, `NOT_FOUND`) all line up. The lenient client envelope parser is documented in `requests.md`.
- Routes: every user route calls `requireUser()` (or `getSessionUser()` plus redirect on the two browser-navigated GitHub routes), applies a rate limit, validates params/query/body with Zod (`parseParams` maps a bad uuid to `NOT_FOUND`), and `POST`/`PATCH`/`DELETE` call `requireSameOrigin()`. `withApi` maps unknown errors to a generic `INTERNAL`. Audit rows for `github.connect`, `github.disconnect`, `project.create`, `project.delete`.
- Webhook: no session, no Origin check, signature verified before JSON parse, prefix plus 64-hex format check, constant-time compare, empty secret rejects; `installation.deleted` deletes all rows by GitHub id; other events return `{ received: true }`.
- GitHub install flow: 32-byte random state; cookie `fm_gh_state` httpOnly, `sameSite=lax`, 10 min, `secure` on https; cleared on every callback outcome (single use); constant-time compare; ownership proven through `GET /user/installations` with the user token, which is never stored or logged; upsert on `(user_id, installation_id)`. IDOR: repos and `POST /api/projects` load the installation row with `user_id = caller` (session client, RLS) before minting a token, and the repo must be in that installation's list; `defaultBranch` and the canonical `fullName` come from GitHub.
- Migration: all 11 tables; enums match section 5; RLS on all; owner-only `select` policies with `(select auth.uid())`; `revoke all` then `grant select` only (no client write grants or policies anywhere); `jobs` column grant excludes `state`; `rate_limits` has no policies and no grants; `rate_limit_hit` is `security definer`, `search_path = ''`, execute revoked from `public, anon, authenticated` and granted to `service_role` only. Indexes on every `user_id` and FK column; `unique (user_id, installation_id)` and `unique (user_id, repo_full_name)`; cascades everywhere except `projects.installation_id on delete set null`; `flow_test_runs` check `level <> 'simulated' or passed`.
- Service role: `createAdminClient` is imported only from `src/server/**`; no `"use client"` module imports `@/server/*`, `env.server`, or `supabase/admin`; `server-only` guards present.
- Runtime neutrality (D-12): `src/lib/github/**` and `src/lib/security/**` use Web Crypto and `fetch` only, no `next/*` or Node modules; every GitHub response is Zod-validated; errors carry operation and status only.
- No `any`, no `dangerouslySetInnerHTML`/`innerHTML`; all repo and user strings render as React text. `noUncheckedIndexedAccess` respected (index reads guarded).
- UI: palette tokens in `globals.css` match design.md exactly; accent buttons use `--primary-foreground = #0A0A0A` (black text); no blur or glass; the focus ring is the accent; the "Plans coming soon" heading and body are the exact design.md copy with nothing else in the section (tested); the scroll story uses `useScroll` + `useTransform` with perspective and 3D transforms, plus a fades-only reduced-motion path (tested); loading, empty, and error states on the projects grid, repo picker, installations list, settings profile, and project page; labels and `aria-describedby` on every form field; dashboard notices and "No flows yet" present; `/privacy` states that redacted snippets go to the AI provider, that no source code is stored, and that project deletion removes derived data.
- Nothing from `subscription.md` or user-facing `n8n.md` was built. Ownership: backend files are only under backend paths, frontend files only under frontend paths, and cross-role needs went through `docs/requests.md`.

### Findings

**R1-1** · `src/server/projects.ts` (`deleteProjectForUser`), `supabase/migrations/20261110120000_phase1_schema.sql` · **medium** · owner: backend · status: resolved (backend 2026-11-12); verified by code-reviewer 2026-11-12
Problem: contract section 5 says deleting a project removes its "analyses, findings, recommendations, flows, test runs, and jobs". `jobs.ref_id` has no foreign key (it is polymorphic), so the cascade from `projects` never reaches `jobs`. The handler marks `queued`/`running` jobs `failed` and clears `state`, but every job row for the project (including `done`/`failed` ones) survives the delete with its `ref_id`, `step`, and `last_error_code`. The contract's "Delete my data" promise and the `/privacy` wording are therefore not met for `jobs`. The multi-step lookup (analyses, then recommendations, then flows, then jobs, then project) is also not atomic.
Fix: after the `status = 'failed'` update (keep it, it stops a running worker), `delete from jobs where user_id = $user and ref_id in (refIds)`. Do the lookup, job update, job delete, and project delete in one Postgres function (`security definer`, `search_path = ''`, service role only) so it is atomic. Add a test (fake Supabase client or the RLS suite) asserting that no `jobs` rows remain for the project.

**R1-2** · `tests/rls/rls.test.ts` lines 167-179 · **medium** · owner: backend · status: resolved (backend 2026-11-12); verified by code-reviewer 2026-11-12
Problem: two of the write-denial assertions cannot fail. (a) `insert({ user_id: a.userId })` fails on NOT NULL / enum constraints for most tables whatever the policies are, so the test passes even if someone adds a permissive client `insert` policy and grant. (b) The update on A's own row sets `user_id` to the value it already has, so a permissive `update` policy would change nothing observable and the test would still pass. Only the delete and the cross-user update assertions are meaningful. This suite is the only proof of "no client writes on pipeline tables".
Fix: per table, insert a complete valid row (reuse the seed shapes) as user A with `user_id = A` and assert that `error` is not null and the admin-side row count is unchanged. For update, change a real column (`projects.stale`, `github_installations.account_login`, `analyses.progress`, `flows.name`, `audit_log.action`, ...) on both A's and B's rows and assert via admin that the value is unchanged. Also add one test that deleting a project through the service role cascades to analyses, findings, recommendations, flows, and test runs (and jobs after R1-1).

**R1-3** · `tests/server/routes.test.ts`, missing `tests/server/auth.test.ts` · **medium** · owner: backend · status: resolved (backend 2026-11-12); verified by code-reviewer 2026-11-12
Problem: contract Phase 1 backend item 8 requires tests for `requireUser`, and it is never tested (routes.test.ts replaces `@/server/auth` with a mock). The IDOR protections listed above are also untested at route level: no test for `POST /api/projects` with an installation id the caller does not own, a repo outside the installation, or the duplicate message; none for `GET /api/github/installations/:id/repos` with a foreign id; none for `DELETE /api/projects/:id` or `DELETE /api/github/installations/:id` returning `NOT_FOUND` for a foreign id; none showing that each state-changing route actually calls the Origin check (the mock makes `requireSameOrigin` a no-op).
Fix: add `tests/server/auth.test.ts` that mocks `@/lib/supabase/server` (`getUser` returns a user, null, or an error) and asserts that `requireUser` returns `{ id, email }` or throws `ApiError` `UNAUTHORIZED`/401, and that `requireSameOrigin` throws `FORBIDDEN` for a foreign Origin on POST. Add route tests for `projects` (POST: unknown installation → 400 and no token minted; repo not found → 400; unique violation → 400 with the contract message; success → 201 plus audit), `installations/[id]/repos` (foreign id → 404, no GitHub call), and both DELETE routes (foreign id → 404, no audit). Add one test per state-changing route with `Origin: https://evil.example` → 403.

**R1-4** · `src/app/api/github/webhook/route.ts` line 19, `src/lib/github/webhook-signature.ts` · **low** · owner: backend · status: resolved (backend 2026-11-12); verified by code-reviewer 2026-11-12
Problem: the HMAC is computed over `request.text()` re-encoded with `TextEncoder`, not over the raw bytes GitHub signed. A body with a BOM, or any byte sequence that is not valid UTF-8, is changed by decoding and then fails verification. This fails closed, so it is not a security hole, but it is a correctness gap in a raw-body check.
Fix: read `new Uint8Array(await request.arrayBuffer())`, HMAC those bytes (accept `Uint8Array | string` in `computeWebhookSignature`), then decode with `TextDecoder` for `JSON.parse`. Add a test with a non-ASCII body.

**R1-5** · `src/app/api/github/installations/callback/route.ts` lines 24-25, 80-87 · **low** · owner: backend · status: resolved (backend 2026-11-12); verified by code-reviewer 2026-11-12
Problem: (a) The hand-rolled `readCookie` calls `decodeURIComponent`, which throws `URIError` on a malformed `%` sequence in any cookie. That escapes to `withApi` and returns a JSON 500 instead of the contract's `/dashboard?error=github` redirect, and the state cookie is not cleared. (b) The state is bound to the browser, not to the Flow Motion user. If user A starts an install, signs out, and user B signs in within 10 minutes in the same browser, the callback links the installation to B. B still needs GitHub access to it, so the impact is small.
Fix: read the cookie with `cookies()` from `next/headers` (or `NextRequest.cookies`) instead of parsing the header. Store `<userId>.<state>` in the cookie (or an HMAC of user id plus state) and compare the user part with `getSessionUser().id` before the constant-time state compare. Test both cases.

**R1-6** · `src/app/api/projects/route.ts` lines 32-38, `src/lib/github/client.ts` `findInstallationRepo` · **low** · owner: backend · status: resolved (backend 2026-11-12); verified for the call count, but the single `GET /repos` check introduced R1-14
Problem: creating a project pages through `GET /installation/repositories` up to 20 pages (21 GitHub calls including the token mint) to find one repo. A repo beyond the first 2000 entries is reported "not available" even though the picker can list it (page max 1000). Also `let repo;` is untyped (implicit evolving type).
Fix: call `GET /repos/{owner}/{repo}` with the installation token (`getRepo` already exists). A 200 means the installation can access it; a 404 means it cannot (map to the same `VALIDATION_ERROR`). That is one call with no page cap. Declare `let repo: Repo | null`.

**R1-7** · `supabase/migrations/20261110120000_phase1_schema.sql` line 95 · **low** · owner: backend · status: resolved (backend 2026-11-12); verified by code-reviewer 2026-11-12
Problem: `projects.installation_id` references `github_installations(id)` without tying it to the same user, so the database would accept a project that points at another user's installation row. The route checks ownership today, but a later service-role write (Phase 2 worker, reconnect flow) could get it wrong with no backstop.
Fix: add `unique (id, user_id)` on `github_installations` and change the FK to `foreign key (installation_id, user_id) references github_installations (id, user_id) on delete set null (installation_id)` (Postgres 15+ column list, keeps `user_id`). Cover it in the RLS suite.

**R1-8** · `supabase/migrations/20261110120000_phase1_schema.sql`, `tests/rls/rls.test.ts` · **low** · owner: backend (the human owner provides a local stack) · status: open
Problem: the Phase 1 migration has never been applied anywhere, and all 44 RLS tests are skipped (R0-7 still open). The SQL reads correctly, but RLS is the core cross-user guarantee and nothing has executed it.
Fix: before Phase 2 starts (or before Phase 1 closes, at the coordinator's choice), run `supabase db reset` plus the RLS suite on a machine with Docker or against a disposable Supabase project, and record the result in `docs/status.md`. Treat this as a release gate.

**R1-9** · `src/features/auth/queries.ts`, `src/components/shared/error-state.tsx`, `src/features/api/client.ts` · **low** · owner: frontend · status: resolved (frontend, 2026-11-12); verified by code-reviewer 2026-11-12
Problem: `useSignOut` has no error path. With an expired session the proxy answers `POST /api/auth/sign-out` with 401, the mutation fails silently, and the user stays in the app. Likewise, an `UNAUTHORIZED` from any query only shows "Your session has expired. Log in again." with a Try again button and no way to log in.
Fix: in `useSignOut`, use `onSettled` (or treat `ApiError.code === "UNAUTHORIZED"` as success) to clear the cache and `router.push("/login")`, and show an error message for other failures. In `ErrorState`, when the error code is `UNAUTHORIZED`, render a "Log in" link to `/login` instead of "Try again" (or add a `QueryCache` `onError` in `providers.tsx` that redirects on 401).

**R1-10** · `src/features/github/components/installations-list.tsx`, `src/features/github/components/repo-picker.tsx` · **low** · owner: frontend · status: resolved (frontend, 2026-11-12); verified by code-reviewer 2026-11-12
Problem: "Connect GitHub" (`/api/github/install`) appears only in empty states. Once one installation exists, there is no way to connect a second account or organisation, and the repo picker's empty-repo text says "Grant access to repositories on GitHub" with no link.
Fix: add a plain-anchor "Connect another account" link (`/api/github/install`) under the installations list in `/settings` and in the repo picker footer. In the empty-repo message, link to `https://github.com/settings/installations/<installationId>` for the selected installation.

**R1-11** · `src/features/marketing/components/how-it-works.tsx` lines 81-91, `src/hooks/use-prefers-reduced-motion.ts` · **low** · owner: frontend · status: resolved (frontend, 2026-11-12); verified by code-reviewer 2026-11-12
Problem: the server snapshot assumes reduced motion, and the reduced path uses `initial={{ opacity: 0 }}`, so the server HTML renders all three story cards with `opacity: 0`. They stay invisible until hydration and an in-view event. With JavaScript disabled or slow hydration, the main "how it works" content is not visible.
Fix: render a plain, fully visible `<li>` on the server and before mount (choose neither animated path until mounted), or pass `initial={false}` when not mounted so the fade only applies after hydration.

**R1-12** · `src/components/ui/dialog.tsx` line 34, `src/components/ui/sheet.tsx` line 31, `src/components/ui/alert-dialog.tsx` line 33, destructive variants in `button.tsx`/`badge.tsx` · **low** · owner: frontend · status: resolved (frontend, 2026-11-12); verified by code-reviewer 2026-11-12
Problem: design.md says "do not hardcode colors in components". The three overlays use `bg-black/70`, and the destructive variants use translucent red tints (`bg-destructive/10`, `/20`), which produce blended reds outside the palette. This is not glassmorphism (no blur, and the scrim is not a panel), but it bypasses the tokens.
Fix: use `bg-background/80` (token-based) for scrims, and make the destructive button and badge outlined as design.md asks ("severity badges use outlined red styles"): `border-primary text-primary bg-transparent hover:bg-secondary`.

**R1-13** · `src/features/projects/components/project-view.tsx`, `src/features/auth/queries.ts` (tests) · **low** · owner: frontend · status: resolved (frontend, 2026-11-12); verified by code-reviewer 2026-11-12
Problem: the project page shell has no tests: invalid reason, "Reconnect GitHub to analyze" when `installationId === null`, stale notice, disabled Analyze, delete confirm then redirect to `/dashboard`, and the `NOT_FOUND` state. Sign-out has no tests either. Contract Phase 1 frontend item 9 lists only dashboard states, but these are the Phase 1 states that design.md maps explicitly.
Fix: add `project-view.test.tsx` with fixtures for each notice, the not-found state, and a DELETE that resolves and navigates. Add a sign-out test covering success and the 401 case from R1-9.

### Counts
high 0 · medium 3 (R1-1, R1-2, R1-3; all backend) · low 10 (R1-4 to R1-8 backend, R1-9 to R1-13 frontend). Still open from Phase 0: R0-7 (folded into R1-8) and R0-8 (AGENTS.md row, owner). R0-11 no longer applies (frontend now owns these files and loads Geist Mono) and can be closed.

### Re-review after fixes (2026-11-12)

Commands (from `C:\Users\amon\Desktop\flowmotion`): typecheck pass, lint pass, `npx vitest run` 21 files passed and 1 skipped, 172 tests passed and 67 skipped (RLS suite). The coordinator reported that the build passes.

Verification notes:
- **R1-1:** `public.delete_project(p_user_id, p_project_id)` is `security definer` with `search_path = ''`. Execute is revoked from `public, anon, authenticated` and granted to `service_role` only. It locks the project row, collects the analysis and flow ids, locks and deletes the matching `jobs`, and deletes the project in one transaction. It returns false for a project the user does not own, which the code maps to `NOT_FOUND`. The RLS suite asserts the full cascade, the removal of jobs, wrong-owner no-op, and the service-role-only grant.
- **R1-2:** inserts now use complete, constraint-valid rows. Updates change a real column to a new value. The assertions expect `42501` and confirm via admin that nothing changed, so they fail if a client grant or policy is added.
- **R1-3:** `auth.test.ts` runs the real `requireUser` and `requireSameOrigin`. `routes-ownership.test.ts` runs the real auth and http modules against every state-changing route. `data-scope.test.ts` asserts the `user_id` filters. All of these would fail if the protection were removed.
- **R1-4:** the webhook HMAC is computed over `arrayBuffer()` bytes, and decoding uses `TextDecoder` with `fatal: true` only after verification. A test covers non-ASCII and BOM bodies.
- **R1-5:** the cookie is `<userId>.<state>`. `readCookie` never decodes and never throws. Both parts are compared in constant time. The whole callback body is wrapped so every failure redirects and clears the cookie. Splitting on the last `.` is safe because the cookie is server-set and httpOnly, and neither part can contain `.`.
- **R1-7:** composite FK `(installation_id, user_id) → github_installations (id, user_id) on delete set null (installation_id)` with `unique (id, user_id)`. The RLS suite covers both the cross-user insert and the null-on-delete case.
- **R1-9 to R1-13 and R0-11:** confirmed in code and covered by tests: 401 sign-out, the "Sign in again" link, "Connect another account" links, visible static cards before mount, token scrims and outlined destructive variants, and the project-view and sign-out tests.

**R1-14** · `src/app/api/projects/route.ts` lines 33-45, `src/lib/github/client.ts` `getInstallationRepo` · **medium** · owner: backend · status: resolved (backend 2026-11-12); verified by code-reviewer 2026-11-12
Problem: the R1-6 fix replaced the installation repo-list lookup with `GET /repos/{owner}/{repo}` using the installation token. Installation tokens can read any **public** repository, so this call returns 200 for every public repo on GitHub, not only the ones the installation covers. `POST /api/projects` now accepts any public repo (for example `torvalds/linux`) under any of the caller's installations. This breaks contract section 6 ("the repo must be in that installation's repo list"). It would also let Phase 2 analyses spend AI on repos the user never installed the App on, and those projects never receive `push` webhooks, so `stale` stays wrong. A 404 still guards private repos, and the tests only model 404, so they cannot catch this.
Fix: prove that the installation covers the repo. Option 1: after `getRepo`, call `GET /repos/{owner}/{repo}/installation` with the App JWT and require `id === installation.installation_id`. Option 2: return to the authoritative `GET /installation/repositories` list (the `findInstallationRepo` paging, with the page cap raised to match the picker). Add a test where the repo exists and is public but is not covered by the installation, and expect `VALIDATION_ERROR` with no project created.

**R1-15** · `docs/contract.md` lines 62, 85-86; `docs/security.md` line 26 · **low** · owner: architect · status: resolved (architect 2026-11-12); verified by code-reviewer 2026-11-12
Problem: the docs now trail the code. (a) Contract section 5 says `DELETE /api/projects/:id` "first marks the project's queued/running jobs failed (state cleared)". The code now deletes those jobs atomically through `delete_project()`, which is stronger and matches the "removes ... jobs" sentence. (b) Contract section 6 and security.md section 3 describe the `fm_gh_state` cookie as holding the state only and binding it "to the browser session". It now holds `<userId>.<state>` and is checked against the signed-in user. (c) The contract does not mention the `delete_project()` function, and section 5 does not mention the composite FK.
Fix: update these sentences and log the change in `docs/status.md` (AGENTS.md rule 4).

### Counts after re-review
Open: high 0 · medium 1 (R1-14, backend) · low 2 (R1-8 backend, kept open by design until a Supabase stack runs the migration and RLS suite; R1-15 architect). Resolved and verified: R1-1 to R1-7 and R1-9 to R1-13 (R1-6 is resolved for the call count, but its fix caused R1-14), plus R0-11.

### Final verification (2026-11-12)

Commands from `C:\Users\amon\Desktop\flowmotion`: typecheck pass, lint pass, `npx vitest run` 22 files passed and 1 skipped, 178 tests passed and 67 skipped (RLS suite), `npm run build` pass.

- **R1-14 verified.** `POST /api/projects` creates a project only when `getInstallationRepo` returns a repo **and** `repoInstallationId(repo.fullName) === installation.installation_id`. The comparison is strict between two numbers: the GitHub id goes through Zod `z.number().int().positive()`, and the stored id comes from the row schema. There is no coercion. A missing or malformed id raises `GitHubResponseError`, a 404 returns null and is rejected, and any other status throws. Every error goes through `mapGitHubError` and is rethrown before `createProject`, so no error path reaches the insert. The route tests mock `repoInstallationId` returning `null` and a different id (`9999`), and assert 400 with `createProject` not called. Removing the check would turn both into 201, so the tests would fail. The App JWT call lives in runtime-neutral `src/lib/github/app-client.ts` (D-12).
- **Residual note (no severity; check during the live run in R1-8):** confirm on real GitHub that `GET /repos/{owner}/{repo}/installation` returns 404 for a public repo whose owner account has the App installed with "selected repositories" that exclude it. If it instead returns the account's installation id, such a repo would pass. The impact is limited to public repos of an account the user already proved access to.
- **R1-15 verified.** Contract section 5 (composite FK, `delete_project` semantics and grant), contract section 6 (`<userId>.<state>` cookie, repo installation check), and security.md section 3 match the code.

### Counts after final verification
Open: high 0 · medium 0 · low 1 (R1-8, backend, open by design until a Supabase stack runs the migration and RLS suite). Phase 1 has no open high or medium findings.

## Phase 1.1 (branch selection and Phase 1 fixes) — code review 2026-11-13

Scope: contract section 11 "Phase 1.1 scope", sections 5 and 6, D-18 to D-21, design.md branch copy. Phase 2 completeness not reviewed. Checks run: `npm run typecheck` pass, `npm run lint` pass, `vitest run` 28 files passed / 1 skipped (354 passed, 67 skipped = RLS suite without local Supabase), `npm run build` pass (route list includes `/api/github/authorize` and `/api/github/installations/[id]/branches`; it does **not** include `/api/projects/[id]/analyze` or `/api/analyses/[id]`).

**Migration `supabase/migrations/20261113000000_phase1_1_project_branch.sql`: safe to apply now.** `git diff HEAD -- supabase/migrations/` is empty, so the baseline and Phase 1 files are unchanged (D-19). `projects.branch` is added nullable, backfilled from `default_branch` (which is `not null` with a 1..255 check in Phase 1, so no row stays null and the new length check cannot fail), then set `not null`. The dropped name `projects_user_id_repo_full_name_key` is what Postgres generates for the inline `unique (user_id, repo_full_name)` at line 107 of the Phase 1 migration. The new `(user_id, repo_full_name, branch)` key is strictly looser than the old one, so existing rows cannot violate it. `analyses.branch` is backfilled through the `project_id` FK (not null, cascade), so every row gets a value. Re-runs are guarded (`if not exists`, `if exists`, `duplicate_object`/`duplicate_table` handlers). Table-level `grant select` on both tables already covers the new columns, so no grant change is needed.

Verified correct: the frontend branches URL (`/api/github/installations/:id/branches?repo=<encoded>&page=N`) and the `POST /api/projects { repoFullName, installationId, branch }` body match the contract and are asserted in `repo-picker.test.tsx`. `branchNameSchema` implements every section 6 rule, including the UTF-8 byte limit, and is tested with the full list. `encodeBranchPath` encodes per segment and is used by `getBranchHeadSha` and `getBranch`, with a `feature/x` URL test. The branches route checks run in contract order. `POST /api/projects` stores GitHub's branch name, and the test asserts this. Push matching is exact `refs/heads/<branch>` and case-sensitive, and the tests cover two branches of one repo, a non-chosen branch, and case. The callback follows the three D-20 rules. Dashboard empty state: loading shows the skeleton, zero installations shows Connect GitHub, at least one shows Add repository, and all three are tested. The login and signup mapping only singles out rate-limit codes, and `user_already_exists` stays generic (tested). Ownership: backend edited only backend paths and frontend only frontend paths. The `AGENTS.md` diff is the block that `next dev` writes, not an agent edit.

- **R11-1** · `src/features/auth/error-messages.ts` (and `auth-forms.test.tsx`) · **medium** · frontend · status: resolved
  Problem: the signup rate-limit copy is "Too many sign-up emails were sent recently. Please try again in a little while." design.md line 39 requires exactly "Too many sign-up emails were sent recently. Wait a few minutes and try again." The mapping also checks only `code === "over_email_send_rate_limit"`, but design.md also requires "or HTTP 429 from `signUp`" (for example a 429 with no code, or `over_request_rate_limit`). The test asserts the wrong string, so it passes against the wrong behavior.
  Fix: set `SIGNUP_EMAIL_RATE_LIMIT` to the design.md string. Map `error?.code === "over_email_send_rate_limit" || error?.status === 429` (widen `AuthErrorLike` with `status?: number`). Add a test for `{ status: 429, code: undefined }` and update the expected copy.

- **R11-2** · `src/features/projects/components/project-view.tsx` (`AnalyzeAction`, `useStartAnalysis`) and `src/features/analysis/**` · **medium** · frontend (coordinator decides the commit scope) · status: resolved
  Problem: Phase 1.1 replaced the disabled "Analyze" button with a live action that calls `POST /api/projects/:id/analyze` (`src/features/analysis/queries.ts:42`). The build route list shows that this handler and `GET /api/analyses/:id` do not exist yet. If Phase 1.1 is committed and deployed as is, every Analyze click on the project page gets a Next.js 404 (not the API envelope), and the history links lead to an analysis page whose data call also 404s.
  Fix: for the Phase 1.1 commit, keep the Phase 1 disabled Analyze button (or gate the action on the route existing), or commit Phase 1.1 only together with the Phase 2 backend routes. Do not ship a live button to a missing endpoint.

- **R11-3** · `src/schemas/project.ts`, `src/features/projects/components/project-view.tsx` · **low** · backend + frontend (coordinator)
  Problem: tracked Phase 1.1 files now import untracked, partly built Phase 2 files (`@/schemas/analysis`, `@/features/analysis/*`). A Phase 1.1 commit that excludes the Phase 2 folders will not build, and `git add -A` (CLAUDE.md step 5) will commit half-built Phase 2 code (`src/lib/analysis`, `src/lib/jobs`, path policy, scanner) under a "phase 1.1" message.
  Fix: decide the commit scope explicitly before committing. Either move `analysisStatusSchema` back into `project.ts` (or a small shared module) so 1.1 is self-contained, or label the commit as including Phase 2 work in progress.

- **R11-4** · `src/features/auth/error-messages.ts` (`LOGIN_RATE_LIMIT`) · **low** · architect (frontend if removed) · status: resolved
  Problem: the login form now shows "Too many attempts. Please wait a moment and try again." for `over_request_rate_limit`. design.md has no login rate-limit copy, and the Phase 1 contract says sign-in errors show the generic "Invalid email or password". This is not an enumeration leak (the limit is per IP, not per account), but the copy is undocumented.
  Fix: the architect adds this copy to design.md "Auth pages", or the frontend reverts to the generic message.

- **R11-5** · `src/features/auth/error-messages.ts` / `docs/security.md` · **low** · architect
  Problem: Supabase also returns `over_email_send_rate_limit` for the per-address resend cooldown. Signing up again within about 60 s with an address that has a pending, unconfirmed signup gets the rate-limit message, while a new address gets "Check your email". This weakly reveals that the address has a recent pending signup. The leak is small and the client cannot tell the two cases apart.
  Fix: record it as an accepted residual risk in security.md (next to D-21 confirm email), or show the same neutral copy for both. No code change is required unless the architect decides otherwise.

- **R11-6** · `src/schemas/github.ts` (`ghBranchListItemSchema`) · **low** · architect + backend · status: resolved (backend 2026-11-13)
  Problem: list items are parsed with `branchNameSchema`. A real branch that git and GitHub accept but our rules reject (for example longer than 255 bytes) fails the **whole page** with `INTERNAL`. The user then cannot add any branch of that repo, and the Load more pages after it are also unreachable. This follows the contract text ("Zod failure on a malformed GitHub item → INTERNAL"), but it confuses an unusable branch with a malformed response.
  Fix: parse `name` as `z.string().min(1)` in the GitHub list schema and drop items that fail `branchNameSchema` (log a count). Keep `INTERNAL` for structural failures (missing `name` or `protected`, non-array). The architect updates contract section 6 to match.

- **R11-7** · `src/app/api/github/installations/callback/route.ts` (signed-out branch) · **low** · backend · status: resolved (backend 2026-11-13)
  Problem: when there is no session, the handler returns `NextResponse.redirect("/login")` without clearing `fm_gh_state`. Contract section 6 rule 3 says "The cookie is cleared on every outcome". The impact is small because the cookie is user-bound and expires in 10 minutes.
  Fix: define `finish` before the session check (it only needs `env`) and wrap the `/login` redirect in it. Add the cookie assertion to the existing "signed out → /login" test.

- **R11-8** · `src/features/projects/components/projects-grid.tsx` · **low** · frontend · status: resolved
  Problem: with zero projects and an installations **error**, the grid shows `ErrorState` "Could not load GitHub connections" (a sensible choice, but design.md is silent and no test covers it). If someone later changes the branch order, a fallback to "Connect GitHub" with an installation present would go unnoticed.
  Fix: add a dashboard test for empty projects + installations 500 → error state with Retry, and no "Connect GitHub" or "Add repository" empty-state action. The architect may add one line for this state to design.md.

- **R11-9** · `src/features/github/components/branch-picker.tsx` · **low** · frontend · status: resolved
  Problem: the filter can hide the selected radio, but "Add repository" still submits the hidden `effectiveSelected`. The user can confirm a branch they cannot see, for example after filtering to `feat` the preselected default `main` is still sent.
  Fix: show the selected branch name next to the confirm button ("Selected: `main`"), or clear the selection when the filter hides it. Add a test.

### Counts (Phase 1.1)
Open: high 0 · medium 2 (R11-1 frontend, R11-2 frontend/coordinator) · low 7 (R11-3 to R11-9). Migration safe to apply to the hosted DB now.

### Phase 1.1 re-review after fixes — 2026-11-13

Checks run: `vitest run` 30 files passed / 1 skipped, 416 passed / 76 skipped (RLS suite, no local Supabase); `tsc --noEmit` clean; `eslint` clean. The coordinator reports the build passing.

**Status of earlier findings**
- R11-1 **resolved.** `signupErrorMessage` maps `over_email_send_rate_limit` or `status === 429` to the exact design.md copy.
- R11-2 **resolved.** `isAnalyzeApiReady()` returns `false`, so the project page keeps the disabled Analyze button and never calls `POST /api/projects/:id/analyze`. Re-analyze and the history list are gated the same way.
- R11-3 **open (low, coordinator).** `project-view.tsx` and `src/schemas/project.ts` still import untracked Phase 2 files (`@/features/analysis/*`, `@/schemas/analysis`). The Phase 1.1 commit has to include them (now inert behind the readiness gate) or it will not build. Name this in the commit message.
- R11-4 **resolved.** The copy is in design.md (D-23) and the code matches, including the 429 fallback.
- R11-5 **accepted** (D-23, security.md section 5).
- R11-6 **resolved.** `listRepoBranches` skips names that fail `branchNameSchema` and returns a `skipped` count, which the route logs. Structural failures still map to `INTERNAL`.
- R11-7 **resolved.** `finish` is defined before the session check, and the signed-out `/login` redirect clears `fm_gh_state`.
- R11-8 **resolved.** `dashboard.test.tsx` covers empty projects + installations error → "Could not load GitHub connections".
- R11-9 **resolved.** `branchRows` always keeps the selected row visible under any filter.

**New work (D-22 / D-23) verified**
- The DTOs match. `installationSchema` has `githubUserLogin: string | null`, `reposSyncedAt: iso | null`, and `needsRefresh: boolean`. `toInstallationDto` fills them from `github_user_login` and `toIso(repos_synced_at)`, with `needsRefresh = needsRepoRefresh(repos_synced_at)`: null, an unparsable value, or older than 24 h all give `true`. `INSTALLATION_COLUMNS` selects the three new columns. `GITHUB_REFRESH_REQUIRED` is in `ERROR_CODES` with HTTP 403, and the frontend envelope parses it.
- The frontend matches design.md and the backend codes. `isRefreshRequired` checks `ApiError.code === "GITHUB_REFRESH_REQUIRED"`. The notice appears for the repos list, the branches list, the `POST /api/projects` result, and the Analyze error. `?link=github`, `?error=github_account`, and `?connected=1` with the login use the exact design.md copy and redirect targets, which match the callback (`link=github`, `error=github_account`, `error=github_none`, `connected=1`). Settings shows the "Needs refresh" badge plus the refresh link when `needsRefresh`, and "Linked as @login" only when it is not null.
- The route order matches contract section 6. Branches and `POST /api/projects` call `requireRepoAccess` by name before minting a token, then `resolveCoveredRepo(..., access.repo_id)` raises `GITHUB_REFRESH_REQUIRED` on an id mismatch. `mapGitHubError` passes `ApiError` through. The repos list is served from the table with no GitHub call. `POST /api/projects` stores `repo_id`.
- `tests/server/repo-access-flow.test.ts` runs the real handlers for authorize, callback, installations, repos, branches, and `POST /api/projects`. GitHub is mocked at `fetch`, and it asserts the exact GitHub call sequence and that the token never appears in the DB or logs. Supabase is replaced by an in-memory fake, and the fake's `fakeLink` is a TypeScript copy of the SQL function, so the SQL itself is not exercised (R11-10).
- **Migration `20261113120000_phase1_1_repo_access.sql` is SQL Editor safe.** It uses only `do $$` blocks and a `$$` function body, no CLI-only meta-commands or `\` commands. The new columns are nullable with no backfill. The table, indexes, and policy are guarded (`if not exists` / `drop policy if exists`), the constraints sit in `duplicate_object` handlers, and the function is `create or replace`, so a re-run is safe. `on conflict on constraint github_installations_user_id_installation_id_key` matches the name Postgres generated for the Phase 1 inline `unique (user_id, installation_id)`. `#variable_conflict use_column` plus qualified column references avoid clashes with the OUT columns. `xid = integer` exists for `xmax = 0`. `search_path = ''` is used with fully qualified names. `execute` is revoked from `public`, `anon`, and `authenticated` and granted to `service_role`. Apply `20261113000000` first, then this one. Because both are re-runnable, a later `supabase db push` that re-applies them (no history row after a manual SQL Editor run) is harmless; `supabase migration repair --status applied 20261113000000 20261113120000` records them cleanly.

**Owner runtime bugs, by code reading**
1. *Asked to connect again after connecting.* The current code selects `github_user_id, github_user_login, repos_synced_at` and calls `link_github_installations()`. Without the migration, the installations list fails (unknown column) and every callback ends in `?error=github`. A direct install on GitHub, which arrives without our state, now lands on `?link=github` with one "Link existing installation" click instead of an error. **Fixed by both migrations + one refresh.**
2. *Add repository fails.* `createProject` writes `branch` (migration 1) and `repo_id` (migration 2). `requireRepoAccess` needs a fresh set, and existing rows have `repos_synced_at = null` until a refresh, so the dialog shows the refresh notice. **Fixed by both migrations + one refresh.**
3. *Branches not loading.* Same causes: missing columns or table give `INTERNAL`, and a null set gives `GITHUB_REFRESH_REQUIRED`. After the refresh, the route finds the repo by name, checks coverage and repo id, and lists branches (the flow test proves the chain). **Fixed by both migrations + one refresh.**

Remaining conditions (configuration, not code): "Request user authorization (OAuth) during installation" must stay on, or every install callback lacks `code` and ends in `?error=github` (contract owner setup). The refresh also has to be repeated every 24 h (the needs-refresh state, by design, OQ-20).

**New findings**
- **R11-10** · `supabase/migrations/20261113120000_phase1_1_repo_access.sql` (`link_github_installations`) / `tests/rls/rls.test.ts` · **low** · backend
  Problem: no test executes the real SQL function. The route chain uses a TypeScript copy (`fakeLink`), so a SQL-only mistake (constraint name, replace/clear logic, the mismatch raise, the `inserted` flag) would pass CI. The RLS suite covers table access but does not call the RPC.
  Fix: in the skippable local-Supabase suite, call `link_github_installations` via the admin client. Cover: first link `inserted = true`; a re-link replaces the set; an omitted installation is cleared with `repos_synced_at` null; a different `p_github_user_id` raises `github_account_mismatch` and writes nothing; `authenticated` and `anon` cannot execute it.
- **R11-11** · same function · **low** · backend
  Problem: `perform ... for update` only locks rows that already exist. Two concurrent first-time callbacks for one Flow Motion user from two different GitHub accounts (no rows yet) both pass the mismatch check, and the user ends up with rows from two GitHub accounts. This needs a deliberate race by the account owner, so the impact is low.
  Fix: take `pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0))` at the start of the function instead of (or before) the row lock.
- **R11-12** · `src/server/github/user-auth.ts` (`listUserInstallationRepos`) · **low** · backend
  Problem: one repository item that fails `ghUserInstallationRepoSchema` (for example a missing or over-255 `default_branch`) fails the whole page. The callback then ends in `?error=github`, and the user cannot link or refresh at all. That looks to the user like "asked to connect again".
  Fix: parse `repositories` as `z.array(z.unknown())` and validate each item, dropping and counting failures exactly like the full-name drops. Keep the failure for structural errors (missing `total_count`, non-array).

### Counts after re-review (Phase 1.1)
Open: high 0 · medium 0 · low 4 (R11-3 coordinator, R11-10, R11-11, R11-12 backend). Accepted: R11-5. Resolved: R11-1, R11-2, R11-4, R11-6, R11-7, R11-8, R11-9.
