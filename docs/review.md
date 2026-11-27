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

## Phase 2 — Analysis (code review 2026-11-13)

Scope: the uncommitted working tree against `658616f` (`git diff HEAD` plus untracked files), and the Phase 2 modules committed earlier as inert WIP (`src/lib/analysis/**`, `src/lib/security/path-policy.ts`, `secret-scanner.ts`, `src/features/analysis/**`, `src/schemas/analysis.ts`, `recommendation.ts`).

### Command results
- `npx vitest run` (from `C:\Users\amon\Desktop\flowmotion`): 40 files passed, 1 skipped (the RLS suite, no local Supabase). 801 tests passed, 80 skipped. Typecheck, lint, and build passed (coordinator run, not repeated).

### Verified OK (no finding)
- **Migration `20261114000000_phase2_analysis.sql` is safe to run now**, once, in the SQL Editor after `20261113120000`. No earlier migration changed (`git diff HEAD -- supabase/migrations` is empty). It has no meta-commands, no `create extension`, and no `cron.schedule`. Every statement is guarded: `add column if not exists`, `do $$ ... duplicate_object`, `create ... if not exists`, `create or replace`. Columns are added nullable, backfilled, then given a default and `not null`. The unique indexes `analyses_one_active_per_project` and `jobs_kind_ref_id_key` cannot hit existing duplicates, because no analyze route existed before. `claim_job`, `purge_rate_limits`, `kick_worker`, and `link_github_installations` are `security definer` with `search_path = ''`, execute revoked from `public, anon, authenticated` and granted to `service_role`. `kick_worker` returns false when `pg_net`, Vault, or a secret is missing. `link_github_installations` is byte-identical to the 1.1 version except the added advisory lock (checked with diff). No secret values appear in SQL. Table-level select grants cover the new columns. The `jobs` column grant still excludes `state`.
- **Claim:** `claim_job` re-queues `running` jobs whose lock is older than 2 minutes, then runs `FOR UPDATE SKIP LOCKED` ordered by `created_at` and increments `attempts`. Each step's job write is guarded by `locked_by = workerId and status = 'running'` (lost lock gives `lock_lost`).
- **Retry:** backoff is 30/60/120/240 s, and the job fails at `max_attempts`. Non-retryable codes end the job at once. `BRANCH_NOT_FOUND` comes from a branch 404 when the repo is still readable; when the repo is unreadable the code is `GITHUB_ACCESS_LOST`. `state` is set to `{}` on every `done` and `failed` path, and tests assert it.
- **Fetch and secrets:** batches of 25; the scanner runs before extraction and before any state write. Manifests are parsed in memory only. The token budget is `ceil(chars/3)`, 120k total, 16k for signals, 20k chars per file; `FILE_BUDGET_CHARS` makes the fetch-time budget match the prompt build.
- **Kill switch:** with AI off, the job goes `detect` → `persist`, ends `done` with `AI_DISABLED`, and keeps findings and signals. The `ai` step catch path enforces the 2-try limit. One `usage_events` row is written per model response, also before `MODEL_OUTPUT_INVALID`. Recommendations get `estimated_tokens` from the backend.
- **Routes:** analyze check order is exact: session → Origin → 10/min → id → owned → reconnect → `requireRepoAccess` (stores `repo_id` when null) → active → daily cap → insert → trigger → audit. The response is 202 `{ analysisId }`. A unique-index race maps to "An analysis is already running". The daily cap uses the key `daily:analyze:<user>:<UTC day>`, message as in the contract, and fails closed. The DTOs, findings and recommendations sorting, `?analysisId` ownership (`NOT_FOUND`), `analyses` summary with `errorCode`, and the poll kick rule (15 s queued, 2 min lock) all match. `GET /api/analyses/:id` never reads `jobs.state`.
- **Frontend:** reads only the shared schemas (re-exported through `features/analysis/schemas.ts`). It polls every 2 s and stops at `done`, `failed`, and `rejected`. Copy matches design.md exactly. Generate is disabled with the Phase 3 hint. Findings render as plain text. No `dangerouslySetInnerHTML`, no provider name, no plan or credit wording. TanStack Query is used for server data; selection is component state.
- **Local worker:** runs only when `NODE_ENV !== "production"`. There is no OpenRouter or `ANALYSIS_PROVIDER` code, nothing from subscription.md, and no user-facing n8n. The global fetch stub blocks network in tests.
- **Tests:** path policy (traversal, segment matching, case, `.env.example` exception) and secret scanner (positive and negative per pattern, raw value absent from findings and redacted text, masking, lines, anon JWT skip) assert real failures. Breaking a rule turns them red.

### Findings
- **R2-1** · `src/lib/jobs/worker.ts` (`runOnce`) / `src/lib/jobs/analyze.ts` (`stepAi`) · **medium** · backend · **resolved** (backend 2026-11-13, pending re-review)
  Problem: the "at most 2 tries of `ai`" rule is checked only in the error `catch` path (`aiExhausted`). A crash after the model call can bill more than 2 calls. Example: the Edge Function is killed, or the job write fails after a successful, billed call. The stale-lock path in `claim_job` re-queues the job, and the next claim increments `attempts`. `stepAi` then calls the model again on attempt 3, 4, and 5. The only other stop is `attempts > max_attempts`. Up to 5 billed calls per analysis are possible, against the contract's limit of 2 (section 4, D-16(d)).
  Fix: in `runOnce`, before running the `ai` step, end the job when `job.step === "ai" && job.attempts > AI_MAX_ATTEMPTS`: analysis `failed`, code `INTERNAL`, state cleared. Add a worker test: claim `ai`, do not finish, advance the clock 2 min, repeat; assert `model.calls.length <= 2` and the analysis ends `failed`.
- **R2-2** · `src/server/jobs/local-runner.ts` / D-26 · **medium** · architect (decision), backend (guard) · **resolved** (backend 2026-11-13, pending re-review)
  Problem: the in-process dev runner calls `claim_job()`, which claims any due job in the connected database, for any user. Today that is harmless (AI is off, same GitHub App). But if `next dev` points at the hosted Supabase project, a developer laptop processes real users' analyses. Phase 2b (next) enables OpenRouter exactly when `NODE_ENV` is not production and `APP_URL` is localhost. That is the same condition under which this runner runs. So real users' redacted snippets could go to OpenRouter, breaking D-24 ("owner test repos only") and `/privacy`. D-26 notes only the `NODE_ENV` caveat.
  Fix: before Phase 2b starts, the architect decides one guard and records it in D-26. Options: (a) run the local runner only when `NEXT_PUBLIC_SUPABASE_URL` is a local host or a dedicated dev project; or (b) add an optional `p_user_id` filter to `claim_job` and have the local runner claim only jobs of the user who triggered the kick. Backend implements it with a test.
- **R2-3** · `tests/lib/jobs/worker.test.ts`, `tests/rls/rls.test.ts` · **low** · backend · **resolved** (backend 2026-11-13, pending re-review)
  Problem: the fake `claimJob` models the stale-lock re-queue, but no worker test exercises it: the crash, re-claim, and resume, or the crash-loop end at `attempts > max_attempts`. The real SQL `claim_job` (SKIP LOCKED, stale re-queue, `attempts` increment, due ordering) is never executed, even in the skippable RLS suite. A SQL-only mistake would pass CI.
  Fix: add worker tests for stale-lock resume and the crash-loop end. Add RLS-suite cases that call `claim_job` via the admin client: a due job is claimed once; a second concurrent claim gets 0 rows; a lock older than 2 min is re-claimed with `attempts + 1`; a future `run_after` is not claimed.
- **R2-4** · `src/features/analysis/components/analysis-view.tsx` (`showResults`) · **low** · frontend · **resolved** (frontend 2026-11-13: `failed` renders results when `progress >= 70`; tests added)
  Problem: on a `failed` analysis, findings are shown only when `errorCode === "MODEL_OUTPUT_INVALID"` or `signals.length > 0`. Suppose the `ai` step exhausts its 2 tries (`INTERNAL`) on a repo with findings but zero signals. `detect` saved those findings, but the page hides them. The contract says findings exist from `detect` onward, also on a `failed` analysis whose `ai` step failed.
  Fix: for `failed`, render the results block when `analysis.progress >= 70` (`detect` finished), or always fetch findings and render them when the list is non-empty.
- **R2-5** · `src/lib/jobs/worker.ts` (`withTimeout`) / `src/lib/jobs/analyze.ts` · **low** · backend · **resolved** (backend 2026-11-13, pending re-review)
  Problem: on a step timeout, `controller.abort()` cancels only fetch calls that receive the signal. The abandoned step promise keeps running and can still call `updateAnalysis`, `updateProject`, or `replaceFindings` after the job has been re-queued and possibly re-claimed. The steps are idempotent, so the damage is limited to out-of-order progress and status writes.
  Fix: check `ctx.signal.aborted` (throw) at the start of `progress()` and before each `deps.db` write in the steps.
- **R2-6** · `src/lib/jobs/analyze.ts` (`stepDetect`, `stepPersist`) · **low** · backend · **resolved** (backend 2026-11-13, pending re-review)
  Problem: `files_skipped_budget` is `state.aiEnabled ? skippedBudget : 0`. Suppose AI was on at `validate` but `deps.model` is null by `detect` (kill switch flipped mid-job). The analysis then ends `AI_DISABLED` with a non-zero `filesSkippedBudget`, and the UI shows "Not sent to AI (size budget)". The contract says 0 when AI is disabled.
  Fix: use `state.aiEnabled && !aiSkipped` (`runAi` in `detect`) for both writes.
- **R2-7** · `supabase/functions/worker/index.ts`, `supabase/functions/import_map.json` · **low** · backend (tracked, OQ-16) · script added (`npm run check:worker-deno`, skips without Deno); deploy test stays on the launch checklist
  Problem: the Edge Function has never been type-checked or run under Deno. The `src/lib` imports have no file extensions, which Deno may not resolve through the import map. The self-call's 5 s abort may also end the callee early on some runtimes. This is already a launch-checklist item in status.md.
  Fix: add a `scripts/` check (`deno check supabase/functions/worker/index.ts` when Deno is available) and run one analysis through the deployed function before launch, as the checklist says.
- **R2-8** · `docs/requests.md`, `docs/contract.md` section 11 "What remains — frontend" · **low** · frontend / architect · frontend part **resolved** (request marked done 2026-11-13); contract sentence open for architect
  Problem: the backend → frontend request ("Analyze API ... ready, flip `isAnalyzeApiReady()`") is still `Status: open`, although the frontend removed the gate. The contract still says to flip `isAnalyzeApiReady()` to `true`, but the file was deleted instead. The result is the same, but the docs no longer match the code.
  Fix: frontend marks the request done. Architect updates the sentence to "remove the readiness gate".

### Counts (Phase 2)
Open: high 0 · medium 2 (R2-1 backend, R2-2 architect + backend) · low 6 (R2-3, R2-5, R2-6, R2-7 backend; R2-4 frontend; R2-8 frontend + architect). Migration `20261114000000_phase2_analysis.sql`: safe to apply now.

## Phase 2b — OpenRouter dev provider (code review 2026-11-22)

Scope: uncommitted tree vs `ec68f41` (`config.ts`, `http.ts`, `openrouter.ts`, `anthropic.ts`, `runtime.ts`, `env.ts`, `local-runner.ts`, worker `index.ts`, `secret-scanner.ts`, `.env.example`, tests). Checks: `npm run typecheck` clean, `npm run lint` clean, `npx vitest run` 46 files / 992 passed / 83 skipped (the RLS suite needs a database).

### Verified (no finding)
- **Provider rule (section 10):** `resolveModelConfig(env, runner)` has a required positional `runner: ModelRunner` and no default. `"edge"` refuses OpenRouter before any OpenRouter value is read. The `NODE_ENV` and localhost `APP_URL` guards are exact (`localhost`, `127.0.0.1`, `[::1]`; tested with `localhost.flowmotion.app`, unparsable, and missing). Every failure fails closed. The log is the code only (`[model] AI_PROVIDER_REFUSED`).
- **Call sites:** exactly two. `local-runner.ts:59` passes `"local"` and `worker/index.ts:60` passes `"edge"`. `createModelFromEnv(env, runner, fetch?)` requires `runner` and holds the only provider switch (exhaustive `switch`). Source tests pin both call sites.
- **Anthropic refactor:** `isRetryableStatus` and `combineSignals` moved into `http.ts` byte for byte. `FetchLike` is re-exported, and the request, headers, parsing, and errors did not change.
- **OpenRouter adapter:** matches item 2: URL, the two headers only, body shape, 55 s combined abort, loose Zod parse, usage fallback `ceil(chars/3)`, a 2xx `error` body / non-JSON / shape mismatch → retryable, and status mapping. Error messages carry the status only.
- **Provider name never exposed:** no DTO, route, UI, or log line contains a provider name (grep of `src/`, `supabase/`). The only mention outside the model files is a code comment in the worker.
- **No new dependency:** `package.json` and the lockfile are unchanged.
- **Tests assert real failures:** edge refusal with a complete env (exactly one log, no key or model in it), `fetch` never called on the edge path, Anthropic enabled on edge, adapter error paths with the key embedded in bodies, the whole S2R-1 positive/negative list with the 5-character no-survival check and an exact whole-value redaction assertion. Spot probes: a 200 KB unterminated quoted value and 3000 repeated assignments scan in under 50 ms (no backtracking regression from removing the 512 cap).
- **Deviation (4), env schema keys only when both switches are on:** consistent with section 10 ("required only for the selected provider") and with the D-16 rule that a key may be empty while `ANALYSIS_MODEL=disabled`. Accepted, no finding.
- **Deviation (1), five D-28 test inputs changed:** each old input (`glpat-EXAMPLE…`, `sb_secret_xxx…`, `xchangemex`, `anEXAMPLE`, `aXXXb`, the two 27-character bare names) is exactly what D-33 (b) now says must not count as a placeholder. Leaving them would contradict the spec. The replacements keep the placeholder intent (whole-word variants), and the old embedded forms are now asserted `false`. Accepted on the code side. The contract wording is R2b-3.

### Findings
- **R2b-1** · `src/lib/security/secret-scanner.ts:455` (quoted generic rule) / `docs/security.md` section 2 "Value extent" · **medium** · architect (decision), then backend if the code changes
  Problem: deviation (3). security.md and contract item 5(c) say "a quoted value runs to its closing quote". The value class `[^"'`\s]+` still excludes whitespace, so a quoted secret that contains a space never matches and is sent to the AI provider unredacted. Probe: `const password = "correct horse battery staple 99";` gives `findings: []` and unchanged text. This was already true under D-28, so it is not a regression. But the D-33 text now states the opposite, and Phase 2b is the step that sends redacted text to a provider that may log it. Allowing whitespace is not free either: quoted UI strings under secret-like names (`authError: "Authentication failed, please retry"`) would then match by entropy.
  Fix: the architect decides and records it in D-33 / security.md. Either (a) the spec says quoted values exclude whitespace (accepted residual: passphrases with spaces), or (b) backend allows spaces within the quotes (still not newlines or the opening quote character) for names matching `password|passwd|pwd|secret|passphrase` only, with a positive test for the passphrase line and a negative test for an `auth…` UI message. The code and the doc must say the same thing before the owner adds a key.
  Status: **resolved** (re-review 2026-11-22). D-34 (a) chose option (b). New `high-entropy passphrase assignment` detector (`PASSWORD_TYPE_NAME`, `requireWhitespace`); `const password = "correct horse battery staple 99";` gives one finding with `redacted === text.replace(value, "[REDACTED]")` and no 5-character run surviving; `authError`/`title`/`apiKey` UI strings stay clean; line breaks and quotes end the value; 200 KB unterminated cases under 1 s (value scan is bounded by the next quote or line end, branches are disjoint).
- **R2b-2** · `src/lib/analysis/model/config.ts:70-72` / `docs/contract.md` section 10 · **low** · architect
  Problem: deviation (2). The contract says "an `openrouter` refusal (any reason, including `runner === "edge"`) is logged once per resolve". The code logs only the guard refusals (runner, `NODE_ENV`, `APP_URL`). `openrouter` with a missing key or `ANALYSIS_MODEL=disabled` returns `{ enabled: false }` silently, the same as `anthropic`. That reading is sensible: those are the ordinary off states, not refusals. But "any reason" is ambiguous, and no test pins either behavior.
  Fix: the architect clarifies the section 10 wording: "refusal = a runner, `NODE_ENV`, or `APP_URL` guard failure; a missing key or a disabled model is the ordinary off state and is not logged". Backend then adds an assertion to the existing matrix cases "openrouter, missing key" and "openrouter, ANALYSIS_MODEL=disabled" that `refusalLogs()` has length 0.
  Status: **resolved** (re-review 2026-11-22). D-34 (b) and contract wording agree with the code; matrix cases "openrouter, missing key" and "ANALYSIS_MODEL=disabled" assert zero refusal logs.
- **R2b-3** · `docs/contract.md` section 11 Phase 2b item 5 (last sentence) · **low** · architect
  Problem: "All existing D-28 tests stay green" cannot hold together with D-33 (b). Backend correctly changed five D-28 inputs (see Verified), so the code now contradicts the literal contract text.
  Fix: reword it to "All existing D-28 tests stay green, except inputs that D-33 redefines (embedded placeholder words, bare names of 20+ characters with entropy ≥ 3.5), which are updated to whole-word or short forms".
  Status: **resolved** (re-review 2026-11-22). Contract section 11 item 5 now names the five redefined D-28 inputs (D-34 (d)).
- **R2b-4** · `src/lib/security/secret-scanner.ts:196-204` (bare-name rule) · **low** · architect (accept or tune)
  Problem: the "under 20 characters or entropy < 3.5" exemption almost never applies to real long names. Uppercase-with-underscore names of 20+ characters score 3.5 to 3.8. Probe results: `DEPLOY_TOKEN_REFERENCE_NAME` 3.53, `STRIPE_SECRET_KEY_PRODUCTION` 3.66, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 3.81. So `const tokenEnv = "STRIPE_SECRET_KEY_PRODUCTION"` is now a `hardcoded_secret` finding and gets redacted. This fails safe (over-redaction), but users see false "hardcoded secret" findings on env-name strings, which are common in config helpers. No test covers a long bare name being reported, so this behavior is unpinned either way.
  Fix: the architect either accepts it (then backend adds one test pinning that a 27-character bare name is reported, so the behavior is deliberate), or tunes the rule. For example, exempt a value of 2+ `_`-separated segments, each `[A-Z][A-Z0-9]{1,}` and without digits in `2-7` runs (a base32 seed has no `_`, so S2R-1 positives stay positive).
  Status: **resolved** (re-review 2026-11-22). Accepted by D-34 (c); `const tokenEnv = "STRIPE_SECRET_KEY_PRODUCTION"` is pinned as one `hardcoded_secret` finding, whole value redacted.
- **R2b-5** · `tests/lib/analysis/provider-phase2b.test.ts` (edge refusal block) · **low** · backend
  Problem: the "runner checked first" rule is tested only with a complete OpenRouter env. Nothing proves that `"edge"` still refuses and logs when the key is missing or `ANALYSIS_MODEL=disabled`. If someone later moves the runner check below the key or model checks, the result would still be `{ enabled: false }` but the edge refusal log would disappear without any test failing.
  Fix: add `resolveModelConfig({ ANALYSIS_PROVIDER: "openrouter" }, "edge")` → `{ enabled: false }` with exactly one `AI_PROVIDER_REFUSED` log. Optionally add a `// @ts-expect-error` call `resolveModelConfig(env)` to pin that `runner` is required.
  Status: **resolved** (re-review 2026-11-22). Edge refusal with an incomplete env (no key; key with `ANALYSIS_MODEL=disabled`) asserts `{ enabled: false }` and exactly one log; `// @ts-expect-error resolveModelConfig(env)` pins the required runner and typecheck passes.
- **R2b-6** · `src/lib/security/secret-scanner.ts:427` (OpenRouter prefix) · **low** · backend
  Problem: the placeholder prefix for OpenRouter is `sk-or-`, but real keys start with `sk-or-v1-`. So `OPENROUTER_API_KEY=sk-or-v1-` + 64 zeros is reported as an `OpenRouter key` (probe confirmed). This is harmless (fail safe) but a noisy finding on a common docs placeholder. The `xxx` form is already handled by the whole-word rule.
  Fix: in `isPlaceholderValue`, after stripping `options.prefix`, also strip an optional `v\d+-` segment before the repeated-character check (or pass prefix `sk-or-v1-` with fallback `sk-or-`). Add a negative test for the zero-filled `sk-or-v1-` value.
  Status: **resolved** (re-review 2026-11-22). Provider check strips an optional `v<digits>-` after the literal prefix; `sk-or-v1-` + 64 zeros gives no finding in `.env.example` and `.ts`; `sk-or-v1-` + 63 zeros + `1` is not a placeholder; the `aXxXb` OpenRouter positive (D-33 test) still reports.

### Counts (Phase 2b)
Open: high 0 · medium 1 (R2b-1 architect, then backend) · low 5 (R2b-2, R2b-3, R2b-4 architect; R2b-5, R2b-6 backend). Ownership respected: backend changed only its paths and tests. Docs changes are in architect-owned `docs/`. An untracked root `README-OPENROUTER.md` (owner setup guide) appeared during the review. It is not in any role's ownership table, so the coordinator should confirm who wrote it. Nothing NOT READY was built.

### Re-review 2026-11-22 (Phase 2b fixes, narrow)
Scope: R2b-1..R2b-6 only, against D-34 and contract section 11 "Phase 2b review fixes" (`secret-scanner.ts`, `env.ts`, `env.server.ts`, `tests/env.test.ts`, `provider-phase2b.test.ts`, `secret-scanner-d34.test.ts`). Checks: `npm run typecheck` clean, `npm run lint` clean, `npx vitest run` 47 files / 1008 passed / 83 skipped.
- **Backend deviation accepted (generic rule skips a provider-prefixed placeholder):** `isProviderPlaceholder` adds only one new skip over what the generic rule already applied: the part after a known prefix (`sk-ant-`, `sk-or-`, `sk-`, `SG.`, `npm_`, `glpat-`, `sb_secret_`, `re_`), optionally after `v<digits>-`, is non-empty and one repeated character. Every other rule it evaluates was already applied by the preceding `isPlaceholderValue(value, { bareName: true })` call. A body of one repeated character has entropy 0 and cannot be a real key, so this cannot hide a real secret. It was needed because the `sk-or-` value pattern in `isSecretLikeValue` matched the zero-filled `.env.example` value.
- **S2b-1 (item 6) spot check:** `src/lib/env.ts` holds only the client schema; all server importers (`instrumentation.ts`, API routes, `src/server/**`) use `@/lib/env.server`, which starts with `import "server-only"`; no `"use client"` file imports it; the source test pins the banned names. The `next build` + `.next/static` grep was not re-run here (writes build output); the security reviewer or backend should report it.
- Note (no finding): `secret` is a password-type name per D-34, so a long English sentence under a name such as `secretMessage` can be redacted by entropy. This is fail-safe over-redaction and matches the spec.
Open after re-review (Phase 2b): high 0 · medium 0 · low 0.

## Phase 2c — AI failure handling (code review 2026-11-25)
Scope: uncommitted tree vs HEAD (`777cfcd`..working tree) against D-35, contract section 11 "Phase 2c scope" (backend 1-6, frontend 1-2), contract sections 4/5/6, design.md `AI_UNAVAILABLE` copy, security.md section 3. Checks: `npm run typecheck` clean, `npm run lint` clean, `npx vitest run` 49 files passed / 1 skipped, 1057 passed / 83 skipped.

Verified (no finding):
- **Budget:** `aiStepBudgetMs` = `aiStepTimeoutMs ?? min((model?.timeoutMs ?? 55 000) + 5 000, 110 000)`, no provider branch; `STALE_LOCK_MS = 120 000` mirrors the SQL with migration names; OpenRouter 105 s and Anthropic 60 s steps; invariant `100 000 + 5 000 <= 110 000 <= 110 000` is pinned by a test. Every path keeps the step inside the lock window: the adapter timer (also covering `response.json()`) fires 5 s before the step timer, and the step timer caps the whole `ai` step at 110 s, which leaves about 10 s for the pre-step reads and the post-step job write.
- **R2-1 still holds:** a retry keeps `attempts`; try 2 has `ctx.attempts < 2` false and `aiExhausted` true; a crash after a billed call re-claims at `attempts = 3` and hits the `attempts > AI_MAX_ATTEMPTS` guard (`INTERNAL`, no third call). The existing R2-1 crash test stays green.
- **Retry mapping** (`model/http.ts` `postModelJson`, adapters, `analyze.ts:351-362`): timeout/network/408/429/5xx/not_json/error_body/bad_shape are retryable and go to `AI_UNAVAILABLE` after 2 tries. 400/401/403/404 (and any other non-retryable status) end `AI_UNAVAILABLE` at once. Null, missing, or blank content goes to `MODEL_OUTPUT_INVALID`, not retried, after the `usage_events` row. A non-provider error from `analyze` gives `INTERNAL`.
- **Log line:** exactly one `ai.failed` per failed model call or output, with the five keys only, and no message, body, provider, or model id. Fixed per-reason `ModelProviderError` messages; tests check that the key, model id, and body markers are absent from `message` and `String(error)`.
- **Refactor:** `postModelJson` keeps Anthropic's request, combined signal, status-only errors, and retry flags unchanged. The only changes are the fixed messages and the new `reason`, as the contract requires. No `any`, and all envelopes are still Zod-parsed.
- **Frontend:** `copy.ts` has the exact design.md string and does not name the provider. Retry is shown (only `BRANCH_NOT_FOUND` hides it). Findings and signals render below. `INTERNAL`, `null`, and unknown codes fall back to the generic copy. Tests cover each case. Ownership was respected, and nothing NOT READY was built.
- **Backend deviations judged acceptable:** (1) an `ai.failed` line with reason `internal` when `parseDrafts` throws something other than `ModelOutputInvalidError`. This matches "one line per failed `ai` step" and logs no extra data (see R2c-4 for the docs). (2) The fake model's `timeoutMs` defaults to 55 000. It is test-only, keeps the pre-2c 60 s budget for the existing worker tests, and every budget test sets its own value.

Findings:
- **R2c-1** · `src/server/jobs/local-runner.ts:47-51,63` · **low** · backend
  Problem: the local runner's `log` passes every field through `stripNulls`. So the `ai.failed` line drops the `status` key whenever it is `null` (reasons `timeout`, `network`, `empty_content`, `invalid_output`, `internal`). The line then has 4 keys instead of the 5 required by contract section 11 item 5 and security.md section 3. The local runner is the only place OpenRouter runs, so this is the exact diagnostic the owner reads (for example a 115 s model shows up as `{jobId, attempt, reason: "timeout", elapsedMs}` with no `status`). The Edge path logs `null` correctly.
  Fix: keep `null` values in the local log, for example by widening `logServerInfo`'s field type to `string | number | boolean | null` and dropping `stripNulls` (or exempting `ai.failed` from it). Add a test that calls `localDeps(...).log("ai.failed", {..., status: null, ...})` and checks that the logged object has all five keys.
  Status (2026-11-25, Phase 2d): **fixed.** `stripNulls` removed; `logServerInfo` takes `null`; `tests/server/local-runner.test.ts` asserts five keys with `status === null`.
- **R2c-2** · `src/lib/jobs/worker.ts:153-158`, `src/lib/jobs/analyze.ts:329,364-366` · **low** · backend
  Problem: some `ai` step failures bypass the D-35 mapping and the logging rules.
  (a) If the worker's step timer wins the race (a model whose `timeoutMs` is above 105 000 and so is clamped to 110 s, or an `aiStepTimeoutMs` override below the model timeout), `Promise.race` settles with `StepTimeoutError`, which maps to `INTERNAL`, not `AI_UNAVAILABLE`. The orphaned `stepAi` then writes its `ai.failed` (`reason: "timeout"`) after `job.retry` / `job.failed`.
  (b) A failure of `progress(...,75)`, `assertActive`, or `insertUsageEvent` inside the `ai` step writes no `ai.failed` line, although item 5 says "on every `ai` step failure". Adapters built from env (100 s / 55 s) cannot hit (a), so this is not reachable in production today, but nothing prevents it.
  Fix: choose one option and pin it with a test. Option 1: clamp the effective adapter timeout to `budget - AI_STEP_MARGIN_MS`, for example by passing `AbortSignal.timeout(budget - margin)` combined with `ctx.signal` as `input.signal`, so the adapter always times out first with `timeout` / `AI_UNAVAILABLE`. Option 2: have the architect state in the contract that a step-budget timeout or a database error in the `ai` step is `INTERNAL` with no `ai.failed` line. Add a worker test with `createFakeModel({ timeoutMs: 200_000 })` and a hanging analyze that asserts the resulting code and the number of log lines.
  Status (2026-11-25, Phase 2d): **fixed.** Option 1 + option 2: `StepContext.aiCallTimeoutMs` = `max(budget - 5 000, floor(budget / 2))` arms a per-call `AbortController` before `progress(…, 75)`; step abort / DB error → `INTERNAL` with no `ai.failed`; contract item 5 updated. Tests in `tests/lib/jobs/ai-failure.test.ts` (D-36 (d) block).
- **R2c-3** · `tests/lib/jobs/ai-failure.test.ts:77` (`expectSafeLog`) · **low** · backend
  Problem: contract item 6(e) requires that the logged fields contain no prompt marker. The worker log test checks the key, model id, body marker, `<repo_file`, `openrouter`, and `anthropic`, but not a marker taken from repository content. The adapter test has `PROMPT_MARKER`, but only for `error.message`, not for the `ai.failed` fields.
  Fix: put a unique marker string into one `REPO` file that reaches the prompt (for example a comment in `route.ts`). First check that it appears in `model.calls[0].prompt`, then add it to the `forbidden` list in `expectSafeLog`.
  Status (2026-11-25, Phase 2d): **fixed.** `PROMPT_MARKER` in the `REPO` route file, asserted in `model.calls[0].prompt` and in the `expectSafeLog` forbidden list.
- **R2c-4** · `docs/contract.md` section 11 "Phase 2c scope" items 1 and 5 · **low** · architect
  Problem: two accepted backend behaviors are not in the contract. (1) Item 5 defines `internal` only as "a non-`ModelProviderError` from `analyze`", but the code also logs `internal` (with `elapsedMs` from the returned call) when `parseDrafts` throws an unexpected error, and then rethrows, which the worker maps to `INTERNAL`. (2) The fake model's default `timeoutMs` is 55 000 (`ANTHROPIC_TIMEOUT_MS`).
  Fix: add one sentence to item 5 ("also `internal` when output parsing throws an unexpected error") and to item 1 ("the fake defaults to 55 000"), so a later review does not flag them as drift.
  Status (2026-11-25, Phase 2d): **fixed** in `docs/contract.md` section 11 Phase 2c items 1 and 5.
- **R2c-5** · `src/lib/jobs/analyze.ts:364-371` · **low** · backend (pre-existing since Phase 2, noted because D-35 (c) relies on it)
  Problem: `assertActive(ctx)` runs before `insertUsageEvent`. If the step signal aborts after `analyze` has returned a billed response, the step throws `StepAbortedError` without writing the `usage_events` row. Contract section 4 says a row is written "for every model response received". D-35 made this window small (the adapter times out 5 s before the step timer), but it still exists.
  Fix: write the usage row before `assertActive` (it depends only on `output` and `analysis`), and keep `assertActive` before any analysis or job state writes. Add a test where the step signal aborts inside a fake `analyze` that still resolves, and assert `db.usage.length === 1`.
  Status (2026-11-25, Phase 2d): **fixed.** `insertUsageEvent` now runs before `assertActive`; R2c-5 test asserts `db.usage.length === 1` and no analysis / job / recommendation write after it.

### Counts (Phase 2c)
Open: high 0 · medium 0 · low 5 (R2c-1, R2c-2, R2c-3, R2c-5 backend; R2c-4 architect). Ownership respected: backend changed only `src/lib/**`, `src/schemas/**`, and its tests; frontend changed only `src/features/analysis/**`; docs changes are in architect-owned `docs/`. No new dependency, no migration, and nothing NOT READY was built.

## Phase 2d — Phase 2 close-out (code review 2026-11-25)

Scope: uncommitted working tree vs `HEAD` (contract section 11 "Phase 2d scope", backend items 1-7, frontend items 1-4; D-36; design.md count copy and risk tokens). Checks: `npm run typecheck` clean, `npm run lint` clean, `npx vitest run` 50 files passed / 1 skipped, 1093 tests passed / 83 skipped.

Verified:
- **Cap 8 (backend 1).** `MAX_DRAFTS = 8`; prompt line matches the contract text exactly ("at most 8 … most valuable first"); positional cut-off removed; every item validated first, then a stable descending-confidence sort keeps 8 and the rest go to `droppedOverCap` (not `dropped`); over-cap never throws; `analysis.drafts` log carries `droppedOverCap`. Kept drafts are returned in confidence order only when over the cap, which is harmless because `sortRecommendations` orders by confidence on read. Tests cover 19 → 8 (top confidences, 11 over cap, 0 dropped), 3 invalid + 7 valid → 7, ties keep input order, exactly 8 → 0, prompt text.
- **`recommendationCount` (backend 2).** Schema field `z.number().int().nonnegative().nullable()` matches contract section 6. `analysisHasRecommendationCount` = `status === "done" && error_code === null`; others `null`; done with no rows → `0`. `countRecommendationsByAnalysis` is one `select analysis_id` with `.eq("user_id")` + `.in("analysis_id")` on the RLS (user) client, skipped when no id qualifies; result Zod-parsed. Row volume is bounded (≤ 20 analyses × ≤ 20 legacy rows = 400, under the PostgREST 1 000-row default). `tests/server/project-detail.test.ts` covers every state, one query for four analyses, query skipped, and another user's rows ignored. `GET /api/analyses/:id` unchanged.
- **R2c-1 / R2c-2 / R2c-3 / R2c-5:** all fixed (status lines added above). Deadline formula `aiCallTimeoutMs(budget)` tested at 110 000 → 105 000, 60 000 → 55 000, 1 000 → 500. The timer is armed before `progress(…, 75)` with plain `setTimeout`, cleared in `finally`. `fail` / `invalid` / the parse catch return `StepAbortedError` without logging when `ctx.signal.aborted`. `progress` and `insertUsageEvent` errors propagate outside `fail`, so they are `INTERNAL` with no `ai.failed`. The slow-model test uses the real OpenRouter adapter with a hanging `fetch`, which is stronger than the fake the contract names because it proves the adapter maps the call abort to `timeout`.
- **Backend deviation (judged acceptable):** `stepAi` aborts the call controller from a `ctx.signal` `abort` listener (added after an `aborted` pre-check, removed in `finally`) instead of `combineSignals(ctx.signal, call.signal)`. The existing `combineSignals` in `model/http.ts` takes `(timeoutMs, outer)`, not two signals, so the contract text could not be followed literally. The listener gives the same semantics (the adapter's signal aborts when either the deadline or the step signal fires), avoids `AbortSignal.timeout` (so fake timers work), and does not leak a listener on the long-lived step signal. See R2d-1 for the doc wording.
- **Frontend 1 (analysis page).** `recommendationsFoundText` gives "N recommendations found" / "1 recommendation found" / no line at 0. It shows only when `status === "done"`, `errorCode === null`, and `recs.isSuccess`. `AI_DISABLED` renders its own section without the count, and failed / rejected / active never render `RecommendationsSection`. Tests: 8, 1, 0 (only "No automations found"), loading, AI_DISABLED, MODEL_OUTPUT_INVALID, AI_UNAVAILABLE.
- **Frontend 2 (history row).** `historyCountText` matches design.md exactly ("· 8 recommendations", "· 1 recommendation", "· No recommendations", "· AI analysis not enabled", "· AI service did not respond", nothing and no separator otherwise). Every case is tested with exact strings.
- **Frontend 3 (risk badge).** Tokens `--risk-low #4ade80`, `--risk-medium #fbbf24`, `--risk-high #ff6b6b` match the design.md palette and are mapped in `@theme`. `RiskBadge` is outlined (border + text in the token, `bg-transparent`, `rounded-lg` = 8 px, icon inherits the token colour) and reads "Low risk" / "Medium risk" / "High risk". It is used only in `recommendations-list.tsx` (finding rows still use `SeverityBadge`). Tests check the text, the token classes, that Low is not red, and that findings stay outlined red.
- **Ownership:** backend edited `src/app/api/**`, `src/server/**`, `src/lib/**`, `src/schemas/**`, `tests/**`; frontend edited `src/app/globals.css`, `src/features/**`; docs are architect-owned. No migration, no new env name, no new dependency, no new route. Nothing from Phase 3, `FEATURE-PROPOSAL.md`, `subscription.md`, or `n8n.md` was built. No `any`. Zod parses the new query result.

Findings:
- **R2d-1** · `docs/contract.md` section 11 "Phase 2d scope" backend item 4 · **low** · architect
  Problem: the item says `stepAi` passes `combineSignals(ctx.signal, callController.signal)` "from `model/http.ts`". That helper's signature is `combineSignals(timeoutMs: number, outer: AbortSignal | undefined)`, so the code cannot do this. The backend instead aborts the call controller from a `ctx.signal` listener, which has the same semantics. A later review reading the contract literally would flag this as drift.
  Fix: reword item 4 to "the call `AbortController` is also aborted when `ctx.signal` aborts (pre-check plus an `abort` listener removed in `finally`), and its signal is passed to `model.analyze`", and mark it accepted in review (R2d-1).

### Counts (Phase 2d)
Open: high 0 · medium 0 · low 1 (R2d-1 architect). Phase 2c lows R2c-1, R2c-2, R2c-3, R2c-5 (backend) and R2c-4 (architect) are fixed and closed.

## Phase 3a — Flow engine and flow UI (code review 2026-11-25)

Scope: uncommitted working tree vs `HEAD` 172ac20 (`git diff HEAD` plus untracked files); contract section 11 "Phase 3 scope" (3a backend items 1-9, frontend items 1-6), sections 6, 7, 8, `node-catalog.md`, `testing.md`, `design.md`, D-37..D-42, the backend entry in `requests.md`, OQ-27..OQ-30. Checks: `npm run typecheck` clean, `npm run lint` clean, `npx vitest run` 63 files passed / 1 skipped, 1514 tests passed / 83 skipped (RLS suite). No real n8n was run; `scripts/n8n-import-test.mjs` was read, not executed. Nothing here verifies that the emitted n8n parameters behave correctly inside n8n; only the import test and a manual open can (OQ-30).

How the tests were checked for real failures: the sources and tests were copied to a scratch folder outside the repo and one rule at a time was removed there, then the engine tests were re-run. Every one of these turned at least one test red: validator rule 2 (input index), rule 3 (cycle), rule 4 (typeVersion), rule 5 (option value), rule 6 (`=` string without `{{`, and the upstream `$node` check), rule 7 (scanner, and the `credentials` key), rule 8 (`http://`, the placeholder URL, excluded types), rule 9, rule 10 (node count); FlowSpec F3 (edge into the trigger), F4 (duplicate edge), F5, F6, F8 (upstream `$node`), F9, F10 (missing responder), F11 (trigger kind); `Text` leading `=` and `http://`; the forbidden expression properties; the compiler `=` prefix (31 tests red); warning order; the layout column width (38 red); `assertExportSafe` secret; a profile `typeVersion` that differs from the catalog; a hand-added `code` entry in `catalog.generated.json` (3 consistency tests red). One removal changed nothing (`(` in the operand boundary check of `expression.ts`), because a call is already refused by the comparator step; that is a redundant guard, not a test gap.

### Findings

- **R3a-1** · `src/features/flows/components/flow-canvas.tsx:40-45`, `src/features/flows/graph.ts:57-60`, `src/features/flows/components/flow-node-card.tsx:57` · **high** · frontend
  Problem: a mouse click on a node card cannot open the inspector in a real browser. `@xyflow/react` 12.12.1 sets the inline style `pointer-events: none` on every node wrapper unless the node is selectable or draggable or the canvas has `onNodeClick` / mouse handlers (`node_modules/@xyflow/react/dist/esm/index.js:2266` and `:2362`: `hasPointerEvents = isSelectable || isDraggable || onClick || onMouseEnter || onMouseMove || onMouseLeave`). The canvas sets `elementsSelectable={false}`, `nodesDraggable={false}`, each node `selectable: false` / `draggable: false`, and passes no node handlers, so the wrapper gets `pointer-events: none`; the card `<button>` inherits it (no `pointer-events-auto`). Keyboard still works. The tests pass because `fireEvent.click` ignores CSS, and `status.md` says the canvas was never opened in a browser. Found by reading the library source, not by running a browser.
  Fix: add `pointer-events-auto` (plus `nodrag nopan`) to the card button, or pass `onNodeClick` to `ReactFlow` and select there. Add a test asserting the button (or its wrapper) does not resolve to `pointer-events: none`, and open the page once in a real browser with a fixture before 3b relies on it.

- **R3a-2** · `src/lib/flowspec/check.ts:53` (`renderForScan`), `src/lib/n8n-catalog/profiles/mapping.ts:14`, `src/lib/validator/validate.ts:134` · **medium** · backend
  Problem: a FlowSpec can pass F9 and its compiled export fail validator rule 7, which breaks the contract statement "a FlowSpec that passes compiles to a Valid export" (section 7). Reproduced in the scratch copy: `postgres` insert with a column named `password`, `api_key`, `access_token`, `client_secret` or `stripe_api_key` and a literal value of about 30 characters → `checkFlowSpec` ok, `validateWorkflow` `{ rule: 7 }`. Cause: F9 scans `{ "name": "password", "value": "…" }`, while the resource mapper (`googleSheets`, `airtable`, `postgres`) compiles it to `"password": "…"`, which the scanner's secret-name rule matches. The same split hides the opposite case on both sides: a `set` field named `api_key` with a 30-character literal passes F9 and rule 7, because name and value are separate properties in both renderings. In 3b each such draft costs one of the 3 model calls and the feedback carries only "rule 7".
  Fix: make the two renderings agree and be the strict one. In `renderForScan` (both files) write every `{ name, value }` pair (Pair lists, SQL columns, n8n `assignments`, keypair `parameters`, `fieldsUi.fieldValues`) as `"<name>": <value>` before scanning. Add tests: the `password` column literal fails F9; a spec that passes F9 with secret-named columns and expression values still passes rule 7.

- **R3a-3** · `src/lib/n8n-catalog/profiles/mapping.ts:14`, `src/lib/compiler/compile.ts:38` · **low** · backend
  Problem: a column or field named `__proto__` (valid `FieldName` and `Ident`) is silently dropped. `value[column.name] = column.value` on a plain object assigns the prototype setter, so the export has the column in `schema` but not in `value`; FlowSpec and validator both pass. `markExpressions` copies keys the same way. No prototype pollution (the value is a primitive), only a wrong export.
  Fix: build both objects with `Object.fromEntries` (defines an own property), or refuse `__proto__` / `constructor` / `prototype` in `fieldNameSchema` and `identSchema` as the expression paths already do; add a test.

- **R3a-4** · `scripts/generate-node-catalog.mjs:50-108` (`mergeProperties`), `:180` · **low** · backend
  Problem: the generator merges every property of a node regardless of its display rules (`@version`, resource, operation), so the catalog lists parameters of older versions and other resources too (notion has both `databaseId` and `dataSourceId`). The consistency test and validator rule 5 ("exists … for that node and version", `testing.md`) therefore cannot tell whether a parameter is valid at the pinned `typeVersion`. The notion `dataSourceId` choice is not proven by any test.
  Fix: when a property's `displayOptions.show` / `hide` names `@version`, keep it only if it applies to the chosen `typeVersion` (still no descriptions or other display rules in the output); regenerate; or record the limit in `node-catalog.md` and rely on the import test plus a manual open of each golden.

- **R3a-5** · `src/lib/validator/validate.ts:406-420` · **low** · backend (security-reviewer to confirm)
  Problem: rule 8 checks only the top-level `url` of an `httpRequest` and rule 5 only top-level parameter names. A literal `https://` host nested elsewhere (for example `options.proxy`, or a raw `body`) passes the validator. The compiler cannot emit these today, so this only weakens the "independent second check".
  Fix: for `httpRequest`, require `options` to be `{}` and allow only the parameter names the profile emits; or refuse any `://` in a parameter string outside the placeholder URL.

- **R3a-6** · `src/lib/flowspec/check.ts:98`, `src/lib/validator/validate.ts:280` · **low** · backend
  Problem: F12 measures the compact FlowSpec; rule 10 measures the pretty-printed export, which is larger (indentation, resource-mapper `schema` entries, condition wrappers). A spec just under 256 KB can pass F12 and fail rule 10. Fail-closed, rare.
  Fix: note it in the contract, or lower the FlowSpec limit so the compiled form always fits; add one test near the limit.

- **R3a-7** · `src/features/flows/components/export-panel.tsx:74`, `src/lib/compiler/checklist.ts` (workflow-name tokens) · **low** · frontend
  Problem: a `YOUR_…` token that appears only in the flow name is listed with `usedBy: []`, and the panel renders "YOUR_X used by " with nothing after it.
  Fix: omit the "used by …" part when the list is empty (same for credentials), with a test.

- **R3a-8** · `src/schemas/flowspec.ts:82-83` · **low** · backend
  Problem: `name` and `description` are not under the `Text` rules: a flow named `={{ $env.X }} http://x` passes F1..F12 and the validator (rules 6 and 8 walk node parameters only). n8n does not evaluate a workflow name, so this is inert; it is listed because the export `name` is the one string that skips both checks.
  Fix: refuse a leading `=` and `{{` in `name` (and node `notes`), or record in the contract that the name is display-only.

- **R3a-9** · `src/lib/n8n-catalog/import-verified.ts:5` · **low** · backend
  Problem: a runtime module under `src/lib` (worker-shared, runtime-neutral list in contract section 9) imports `tests/conformance/verified.json`. The contract fixes that file's location, so this follows it, but the app bundle now depends on the tests folder.
  Fix: in 3b import `importVerified` only from `src/server/flows/view.ts` (not from the worker path), and confirm `npm run check:worker-deno` and `next build` still pass; or ask the architect to move the file.

- **R3a-10** · `docs/node-catalog.md` ("Per-node simulation support": outputs "else 1"), `docs/contract.md` sections 7, 8 (example `typeVersion: 2`), `docs/testing.md` rules 6 and 8 · **low** · architect
  Problem: the accepted backend deviations (below) are only in `requests.md` (status open). The docs still say every non-branching node has 1 output, show webhook `typeVersion 2`, and do not list the stricter rules or the scan rendering.
  Fix: record them: pin 2.49.5; catalog counts `number | "dynamic"`; `stopAndError` 0 outputs; notion `dataSourceId`; `Text` refuses `http://`; forbidden path properties; rule 6 and rule 8 additions; switch cases are literals; the scan rendering (after R3a-2); `ExportNotSafeError` rules; close the `requests.md` entry.

### Backend deviations (verdicts)
- **Catalog `inputs` / `outputs` as `number | "dynamic"`: accept.** It is what the static description holds; `catalog.ts` types it, the validator resolves `switch` (rules + fallback) and `merge` (`numberInputs`) from parameters and uses 1 otherwise, and the consistency test compares profile counts wherever the catalog has a number.
- **`stopAndError` 0 outputs: accept.** The generator is the authority (`node-catalog.md`); F4 and rule 2 both refuse an edge leaving it (tested, and checked in the scratch copy). The frontend draws no source handle for 0 outputs. Docs need the update (R3a-10).
- **notion emits `dataSourceId`, FlowSpec keeps `databaseId`: accept, unproven.** Only the n8n side differs, which the contract leaves to the backend. No test proves it for v3 (R3a-4); it needs the import test and one manual open.
- **`Text` containing `http://` fails F8: accept.** It keeps F-rules and validator rule 8 in agreement and is tested in both cases. The 3b prompt must tell the model, or calls are wasted.
- **Expression paths refuse `__proto__` / `constructor` / `prototype`: accept.** Fail-closed, tested for dot and bracket forms.
- **Validator rule 6 additions (a `=` string needs one `{{ … }}`; `$node` must be upstream): accept.** The compiler never emits a bare `=` string; both are tested.
- **Validator rule 8 additions (`authentication` other than `none`, `jsonHeaders`, credential-type parameters): accept.** Could go further (R3a-5).
- **Secret-scan rendering (node `key` → `node`, `currentKey` / `newKey` → `from` / `to`): accept with change.** Values are still scanned and both directions are tested, but the rendering is incomplete: R3a-2.
- **`assertExportSafe` throwing `ExportNotSafeError` with a rule, specs stored as drafts: accept.**

### Open questions
- **OQ-27** (ready flow with `n8nVersion` null): does not block 3a. The frontend default is safe. In 3b the backend should always write the version on `ready`; keep the fallback copy.
- **OQ-28** (`Pair.name` cannot hold `-`): does not block 3a. Decide before the 3b prompt is written; the JSON body sets its own content type, so the practical loss is custom headers.
- **OQ-29** (`respondToWebhook` body as JSON text): does not block 3a (confirmed: literals are escaped, expressions are kept whole, validator passes). It should be decided before 3b ships generated flows, because a runtime value containing a quote or line break makes the reply invalid JSON in the user's n8n.
- **OQ-30** (first real import): does not block the 3a commit, since every export shows "not yet verified". It should be run once before users can download real exports in 3b; the `webhookId`, workflow `id`, and resource-mapper questions can only be settled there.

### Verified OK
- **Phase boundary (D-37).** No change under `src/app/api/**`, `src/server/**`, `supabase/**`, `src/proxy.ts`, `src/lib/jobs/**` or any model code; no simulator, test panel, subscription or user-facing n8n code. `package.json` diff is exactly the two scripts `catalog:generate` and `test:n8n-import`; `package-lock.json` unchanged; no new dependency; `n8n-nodes-base` is in neither file and nothing in `src` imports it (tested).
- **Ownership.** Backend: `src/schemas`, `src/lib/**`, `scripts`, `tests/**`, `package.json`. Frontend: `src/features/**`, `src/stores`, `src/hooks`, `src/app/(app)/flows`, `src/app/globals.css`. Docs touched by them are only `status.md`, `requests.md`, `open-questions.md` (allowed by the shared rules).
- **Catalog is generated.** `catalog.generated.json` carries the pin, 32 keys, sorted keys, no timestamp (byte-stability test); the generator reads the allowlist and the pin from source, installs to a temp folder with `--ignore-scripts`, reads only `dist/types/nodes.json`, and fails on a missing type. Adding a type by hand turns the consistency tests red. `allowlist.ts` is unchanged from Phase 2.
- **32 profiles vs catalog.** Same 32 types in `node-catalog.md` tables, allowlist, catalog and profile index; every profile `typeVersion` equals the catalog's; tiers and credentials match the doc; every top-level parameter in the five goldens exists in the catalog; every excluded type is absent. Strict Zod objects in every profile; placeholders required for every destination; no raw SQL; auth headers refused in any case.
- **Goldens.** 5 specs / 5 goldens, 41 nodes, all 32 types present, plus both operations of `postgres`, `supabase`, `googleSheets`, `dateTime`, all optional `httpRequest` blocks, both `if` outputs, a `switch` with fallback, a `merge`, a `splitInBatches` loop. Top-level keys exactly `name, nodes, connections, settings`; no `credentials` anywhere; `verified.json` is `{ null, null }`.
- **FlowSpec rules.** F1..F12 implemented as written, stable ids, errors carry only rule and node key. Expression parser is a single-pass scanner (200 KB test); probes in the scratch copy confirmed 6-segment limit, no arithmetic, no chained comparison, no calls, no `$env` family, unbalanced and nested braces refused. `requiredCredentials` computed from profiles.
- **Compiler.** Deterministic ids from node keys, names = labels, `typeVersion` from the catalog, `=` added only by the compiler on strings holding `{{`, layout formula as section 8, checklist credentials / placeholders / five warnings in contract order, throws `CompileError` on an unchecked spec.
- **Validator.** Imports only the expression parser, allowlist, catalog, scanner and schemas (no profiles, no compiler, no FlowSpec rules). 10 rules as `testing.md`; size check first; iterative walks (50,000-deep nesting test). `assertExportSafe` covers shape, size, secret, `credentials`, and its message never carries export text.
- **Schemas.** `src/schemas/flow.ts` matches section 6 field for field; `flowspec.ts` strict objects match section 7 and the `TestSpec` shape. No `any` in the new code; engine modules use no Node-only API.
- **Import script.** Never part of `npm test`; isolated temp user folder, `--network none` under Docker, minimal environment, prints the exact skip line and leaves `verified.json` alone when no runner exists, writes it only when every golden imports and counts and types match.
- **Frontend.** Copy in `copy.ts` matches `design.md` string for string (flow page, failed codes, inspector rows, export panel, card action area, helper text), with exact-string tests and a test that no provider, plan or credit word appears. Canvas has no drag, connect, delete or select; nodes are real buttons in graph order, Enter and Space open the inspector, Esc and the close button close it. All flow strings are React text nodes (no `dangerouslySetInnerHTML`; HTML-literal test for name, label, param, note). `fixtures.ts` is imported only by tests. DTOs come from `src/schemas/flow.ts` and every response is Zod-parsed. Server data in TanStack Query; the Zustand store holds only `selectedNodeKey` and is cleared per flow. Polling 2 s only while `generating`. Checkbox, selected state and "N selected" bar are gone. The gate: with `isGenerateApiReady()` false the button is rendered `disabled` with no click handler and the hint "Flow generation is being set up.", so the UI cannot start a request.

### Counts (Phase 3a)
Open: high 1 (R3a-1 frontend) · medium 1 (R3a-2 backend) · low 8 (R3a-3, -4, -5, -6, -8, -9 backend; R3a-7 frontend; R3a-10 architect). 3a should not be committed until R3a-1 and R3a-2 are fixed and re-reviewed.

## Phase 1.2 — GitHub account isolation (code review 2026-11-27)

Scope: working tree against HEAD 7be0c40 (`git diff HEAD` plus untracked `supabase/migrations/20261125120000_phase1_2_github_isolation.sql`, `tests/server/installations-link.test.ts`, `src/features/shell/user-menu.test.tsx`). Phase 3a areas ignored. Commands: `npm run typecheck` clean, `npm run lint` clean, `npx vitest run` 65 files passed / 1 skipped (RLS suite, no `SUPABASE_TEST_*`), 1537 tests passed / 90 skipped. `next build` not run (read-only review).

Counts: high 0, medium 0, low 4.

### Findings

- **R12-1** · `tests/rls/rls.test.ts:143` (Phase 1.2 block, cases i to vii) · **low** · owner: backend (run) / coordinator · The SQL cases for `link_github_installations()` were never executed (suite skipped here, no Docker), yet D-44 (`github_in_use`) is enforced **only** in SQL; the JS tests exercise the fake in `tests/server/helpers/fake-supabase.ts`, not the function. The migration is already applied to the hosted database. I read the SQL line by line and found no defect (see verified list), so this is a coverage gap, not a known bug. **Fix:** run `npx vitest run tests/rls` once against a local stack or a throwaway Supabase project with `SUPABASE_TEST_*` set, and record the result in `docs/status.md` before calling Phase 1.2 closed. If anything fails, the fix goes into a new append-only migration (D-19).
- **R12-2** · `tests/server/helpers/fake-supabase.ts:149` (`fakeLink`) · **low** · owner: backend · Places where the fake differs from the SQL function: (a) no `invalid_arguments` checks (missing or empty `accountType`, a non-positive or non-integer `accountId`, a null or empty user id or login); (b) it maps any `accountType` that is not `Organization` to `"User"` when it writes the row, while SQL writes the raw value (this can't be reached, because both reject non-linkable items first); (c) no CHECK constraints (`linkable_account`, `synced_has_account`, `account_type_check`); (d) no advisory locks or concurrency. None of these makes a current JS test meaningless: the order mismatch → in_use → not_allowed → upsert → delete unclassified → clear classified is the same, and so are the FK effects (repo sets cascade, projects detach). **Fix:** optional. Add the `invalid_arguments` check to the fake, or add a one-line comment listing (a) to (d) so nobody relies on the fake for those. Either way R12-1 is what covers them.
- **R12-3** · `src/lib/jobs/analyze.ts:127-131` (`installationToken`) · **low** · owner: backend · This gap existed before Phase 1.2 and Phase 1.2 does not widen it, but it now matters for D-45. The job worker mints an installation token from the project's installation row without checking that the row is fresh (`repos_synced_at`) or that the repo is in the user's access set. An analysis that was queued or running when the migration ran, on the owner's personal repo in the teammate's account, can finish its remaining steps until the teammate refreshes and the row is deleted. New analyses are refused by `requireRepoAccess`. The window is small and the Phase 1.2 contract item 5 says "no other route changes". **Fix:** record it as a follow-up in `docs/open-questions.md` or BACKLOG (architect). A later fix could have `getInstallationGithubId` also require `repos_synced_at is not null` and the repo in `github_installation_repos`.
- **R12-4** · `docs/status.md:29` ("GitHub connect" row) · **low** · owner: backend (item 7) · The Phase 1.2 text is appended with no separator: "...when the user has none Phase 1.2 (D-43, D-44): ...". **Fix:** add ". " before "Phase 1.2".

### Decision noted (accepted, no finding)
- **Shared `ReconnectNotice` now also shows the D-45 sentence on the analysis page** (`src/features/analysis/components/analysis-view.tsx:160`). design.md only names the project page. The sentence is equally true on the analysis page of a disconnected project, the component is shared on purpose, and the copy is exact. Accept. The architect may add "(also on the analysis page)" to design.md line 79 the next time it is edited.

### Verified OK
- **Backend item 1 (migration):** it follows the order a to e as written. Every statement is guarded (`add column if not exists`, `drop constraint if exists` then `add`, `create index if not exists`, `create or replace`, and step c only touches null-type rows). It adds no extension or cron, so it is safe in the SQL Editor and safe to run twice (after linking, every row satisfies the constraints and step b finds no duplicates because the function prevents them). In step b the oldest holder wins (`min(created_at)`, then `user_id`). Step c runs before step d, so the new constraints validate on the existing rows. The function keeps `security definer`, `search_path = ''`, `#variable_conflict use_column`, the signature, the return type, and revoke/grant. Its steps 1 to 8 match contract section 5: the user lock, then the `github_user:` lock; the new argument checks are guarded by `case` so casts happen only after type checks; `github_in_use` is checked even with `[]`; it deletes unclassified unlisted rows and only clears classified ones. The FK `on delete set null (installation_id)` on projects (`20261110120000_phase1_schema.sql:110`) gives the "projects detach" behavior. The `20261114000000` function is not edited (diff shows only the intended additions).
- **Item 2 (schema):** `ghUserInstallationSchema` is `{ id, account: { id, login, type } | null }`, and `installations` is `z.array(z.unknown())` with each item parsed in `listUserInstallations`. The only caller is updated. No DTO change: `db-rows.ts` and `Installation` are untouched.
- **Item 3:** `isLinkableInstallation` compares ids only, is exact-case, and rejects null, so `organization`, `user`, `Enterprise`, `Bot` and `""` are all refused. `resolveUserAccess` reads `GET /user`, then the list, then filters, and calls `/repositories` only for linkable items. `skippedInstallations` = unparseable + not linkable. `findUserInstallation` and `verifyInstallationOwnership` were deleted with their tests, and nothing references them.
- **Removing `upsertInstallation` is safe:** grepping `src`, `tests`, `scripts` and `supabase` finds no remaining reference, and it was the only unfiltered write path apart from the RPC.
- **Item 4:** `LinkInstallationInput` gains `accountType`/`accountId`, which are sent in the RPC payload. `GitHubAccountInUseError` is mapped. `installation_not_allowed` is a plain error that carries only the code (`tests/server/installations-link.test.ts`).
- **Item 5 (callback):** the `installation_id` check uses the linkable list. `github_in_use` clears the cookie, writes no audit, and logs `result: "github_in_use"`. `github_none` is returned when no installation is linkable, and the function is still called with `[]`. The log carries `skipped` as a count and no login or token.
- **Tests turn red when the behavior is broken.** (a) Removing the D-43 filter in `resolveUserAccess` breaks `user-auth.test.ts`, which compares the exact URL list and asserts that `/user/installations/22/repositories` was not called, and also breaks the `skippedInstallations` count and the result equality. It breaks `repo-access-flow.test.ts` too (rows 55/77 only, no `owner-person/` repos). (b) Removing the `GitHubAccountInUseError` branch in the callback breaks `routes.test.ts`, which expects the redirect to `?error=github_in_use`, and the D-44 case in `repo-access-flow.test.ts`, where the fake raises `github_in_use`. Removing the mapping in `linkGithubInstallations` breaks `installations-link.test.ts`. (c) Calling `/repositories` for the other person's installation breaks three separate assertions: in `user-auth.test.ts` (exact URL list, and the second case where the stub throws on any unexpected path) and in `repo-access-flow.test.ts` (`calls` must not contain the path).
- **SQL test cases i to vii** are present and assert the real failures (`github_in_use` with B's rows empty and A's unchanged, release and re-hold, `installation_not_allowed`/`invalid_arguments`, constraint violations with `23514`, cleanup with the project detached, an org linked for two users, RLS on the new columns). They have not been run (R12-1).
- **Frontend item 1:** `DropdownMenuLabel` is wrapped in `DropdownMenuGroup`, and this is the only use of `DropdownMenuLabel` in `src`. Base UI's `useMenuGroupRootContext` throws without a group (`node_modules/@base-ui/react/menu/group/MenuGroupContext.mjs`), so `user-menu.test.tsx`, which opens the real menu, would fail without the fix. The test covers the email label, no `console.error`, Settings → `/settings`, and exactly one `POST /api/auth/sign-out`.
- **Frontend items 2 to 4:** the `github_in_use` copy matches design.md line 42 exactly (plain `role="status"` notice, no link, no other account named). The `github_none` copy matches, and the "Connect GitHub" link is still there. The card line reads "Not connected to GitHub" with `UnplugIcon` in muted text and appears only when `installationId === null`; projects are never hidden. The reconnect notice has the exact D-45 sentence. Tests check the full text with anchored regexes and include negative cases.
- **No subscription or n8n work, and ownership is respected.** Backend touched only `src/app/api`, `src/server`, `src/schemas`, `supabase`, `tests/server`, `tests/rls` and `docs/status.md` (contract item 7). Frontend touched only `src/features`. No `package.json`, dependency, env-name or route change. No `any` in the diff, and every external input is validated with Zod (GitHub items one by one, RPC result).

## Phase 2e-ui — Integrations preview (code review 2026-11-27)

Scope: working tree against HEAD 3850960 (`git diff HEAD` plus untracked `src/features/integrations/**`, `src/app/(app)/integrations/page.tsx`, `src/features/shell/sidebar.test.tsx`). Commands: `npm run typecheck` clean, `npm run lint` clean, `npx vitest run` 69 files passed / 1 skipped, 1594 passed / 90 skipped. `next build` not run (read-only review).

Verified, no finding:
- D-54 key safety. The key input (`ai-provider-form.tsx:117-126`) is a plain uncontrolled `type="password"` with `autoComplete="off"`, `spellCheck={false}`, no `name`, no `onChange`, not registered. The only access is `keyInputRef.current.value = ""` (`:73-75`). It is cleared on submit (`:101-105`), on Enter in any input (`:85-90`), on provider switch (`:77-83`), and on Cancel (`:169-172`). Nothing in the feature calls fetch, XHR, beacon, WebSocket, a server action, storage, cookies, the URL, the query cache, zustand, or console. The page is rendered without a QueryClientProvider, so any query hook would throw.
- Marker test, checked by reasoning: adding `onChange={(e) => console.log(e.target.value)}` would fail it. `fireEvent.change` fires React onChange, the console spies record the marker, and the source test also rejects `onChange` on the key input. Writing the key to `localStorage` would also fail it, through the `setItem` spy, the storage scan, and the source check. Rendering the key (for example `value={...}`) would fail on `innerHTML` and the source regex.
- Save key and Test connection are disabled, with "Coming soon" linked through `aria-describedby`. The preview notice and the "Preview state" select are inside the card.
- Every string in `copy.ts` and `fixtures.ts` matches design.md "Integrations page" exactly. Suggested models are `anthropic/claude-haiku-5.5` and `claude-haiku-5-5`. The `:free` check ignores case and covers both the form and the saved state.
- `types.ts` names and fields match contract section 6. `AiProviderFormValues` is the put body without `apiKey`. The full 2e can swap in imports from `src/schemas/ai-provider.ts` without UI changes.
- `/integrations` is in `APP_PREFIXES` and matches the exact path or the prefix plus "/". Tests cover `/integrations`, `/integrations/`, `/integrations/x`, and the lookalikes. The sidebar item sits between Dashboard and Settings with `PlugIcon`. The active-state test also covers `/integrationsx`. The mobile sheet reuses `SidebarContent`.
- Nothing extra was built: no backend AI-provider code, no route handler, no migration, no `src/schemas` file, no new dependency, nothing from subscription.md or n8n.md. File ownership was respected.
- Accepted deviations:
  - The source check skips `*.test.*` because the tests must name the APIs they spy on.
  - The custom radio group is correct: roving tabindex, arrow keys plus Home and End, Space and Enter by click, `role="radiogroup"` labelled "Provider". It matches the segmented look in design.md.
  - The native `<select>` for the preview-only control is accessible and gets removed in the full 2e.
  - `useWatch` instead of `watch` is right with React Compiler.

### R2eu-1 — password field can trigger the browser's "save password" prompt when it unmounts with a typed key
- File: `src/features/integrations/components/ai-provider-form.tsx:117-126` (plus `integrations-view.tsx:77` remount on preview-state change, sidebar client navigation)
- Severity: low
- Owner: frontend
- Problem: the key is cleared on submit, Enter, provider switch, and Cancel. It is not cleared when the form unmounts some other way: by changing "Preview state" (the `key={stateId}` remount) or by clicking a sidebar link (a same-document navigation). Chrome treats a password form that disappears after typing as a possible submission and can offer to save the value in the browser's password manager. The user has to accept the prompt, so this is not an app leak. It still goes against "nothing is stored" in spirit.
- Fix: add `useLayoutEffect(() => () => { if (ref) ref.value = ""; }, [])` (capture the ref node first) so the value is cleared before React removes the DOM node. Extend test (h): type the marker, change "Preview state", and assert that no detached input kept it, for example by holding the element reference and checking `.value === ""`. Also pass this to security-reviewer.

### R2eu-2 — source check misses some network and server-action spellings
- File: `src/features/integrations/source.test.ts:14-30`
- Severity: low
- Owner: frontend
- Problem: the forbidden list has `fetch(` but not a bare `fetch` (for example `globalThis.fetch.call(...)` or `const f = fetch`). It also lacks `"use server"` (a server action is a network send), `cookieStore`, and `navigator.` (beacon via `navigator["sendBeacon"]`, clipboard). The runtime marker test covers the paths it exercises, but the source check is the guard for paths the test does not click.
- Fix: add `"use server"`, `cookieStore`, `navigator.`, and a word-boundary regex `/\bfetch\b/` (the feature has no legitimate use of the word in code; keep comments free of it or match only outside comments).

### R2eu-3 — model validation messages are not in design.md
- File: `src/features/integrations/types.ts:18-20`
- Severity: low
- Owner: architect (copy), frontend (apply)
- Problem: "Enter a model name.", "Use at most 200 characters.", and "Use letters, numbers, and . _ : / @ - only." show inline under the Model field, but design.md "Integrations page" does not list them. The rule is that all UI copy is fixed in design.md.
- Fix: the architect adds these three strings to design.md (form, Model field, client validation), or chooses replacements. The frontend then moves them into `copy.ts`.

### R2eu-4 — "Tested <relative date>" drifts because the fixture dates are fixed
- File: `src/features/integrations/fixtures.ts:21-22`, `components/test-result-line.tsx:23`
- Severity: low
- Owner: frontend
- Problem: `testedAt` is fixed at 2026-11-27T09:05Z, so the owner check will read "Tested 3 days ago", then "Tested 2 months ago", and so on. The tests are not flaky: they only match `/^Tested /`, and `formatRelativeDate` is unit-tested with a fixed `now`. This is acceptable for a preview. It only renders after a client-side state change, so there is no hydration risk.
- Fix (optional): keep it as is and accept it, or derive the preview `testedAt` as `now - 5 min` when a state is picked in `integrations-view.tsx`. If you do, keep the static fixtures for the schema test.

### R2eu-5 — `keyHint` local schema is stricter than the contract
- File: `src/features/integrations/types.ts:41`
- Severity: low
- Owner: architect (contract), backend (full 2e schema)
- Problem: the local schema requires `^sk-(or|ant)-…\S{4}$`. Contract section 6 declares `keyHint: string` and describes the format only in a comment. If the full 2e backend schema stays a bare `z.string()`, client and server validate differently. If the backend ever uses three ASCII dots, the client parse would reject it.
- Fix: in the full 2e scope, state the exact `keyHint` regex (Unicode ellipsis U+2026, last 4 characters) in contract section 6 and use it in `src/schemas/ai-provider.ts`. No change is needed in the preview.

Open: high 0 · medium 0 · low 5 (R2eu-1, -2, -4 frontend; R2eu-3 architect/frontend; R2eu-5 architect/backend). Phase 2e-ui can be committed. R2eu-1 and R2eu-2 are cheap to fix first.

## Landing redesign (code review 2026-11-27)

Scope: uncommitted working tree vs `a03bc29` (marketing route and layout, `globals.css`, `src/features/marketing/**`, `flow-node-card-body.tsx`, `node-type.ts`, `graph.ts`, `node-icon.tsx`, `package.json` and lockfile). Checks: `npm run typecheck` pass, `npm run lint` pass, `npx vitest run` pass (1638 passed, 90 skipped), `npm run build` pass (`/` static).

**Confirmed OK:**
- Copy in `copy.ts` matches design.md for every section, and tests check each string against design.md. "Plans coming soon" is unchanged and still exported from `plans-coming-soon.tsx`. There are exactly four `ComingSoonTag`s, all behind `isFlowGenerationLive()`, and the test also checks where they appear. The page has no testimonials, logos, counts, prices, simulation, `<img>`, or `<blockquote>`. "32" matches `ALLOWED_NODE_TYPES` (20 + 12). The delete route exists.
- Lenis follows D-56:
  - It is imported only by `smooth-scroll.tsx`, mounted only by `LandingPage`, and never by a layout.
  - It is created only when reduced motion is off and `(hover: hover) and (pointer: fine)` matches. It is destroyed when either media query changes, and on unmount.
  - Options are exactly `autoRaf`, `lerp 0.1`, `smoothWheel`, `syncTouch false`, `wheelMultiplier 1`. There is no wrapper, snapping, or key/wheel/touch listener.
  - Anchors go through `scrollTo(target, { offset: -80 })`, then `pushState`, then focus on the heading with `preventScroll`.
  - The tests would fail if Lenis started under reduced motion: that test sets `finePointer: true`, so only the reduced-motion check can stop it. They would also fail if it started without a fine pointer, if the options changed, or if unmount did not call `destroy`.
- Motion animates only transform, opacity, and SVG `pathLength`. It has the three how-it-works variants. Server render is the stacked, static layout with no `opacity:0` or `rotateX` (tested). `useSyncExternalStore` server snapshots rule out hydration mismatches.
- F10: the source test walks the runtime import graph from `(marketing)/page.tsx`. `@xyflow/react`, TanStack Query, Supabase, `queries`, and `framer-motion` are not reachable from it.
- F9: the markup of `FlowNodeCard` is the same as before, the flow tests are unchanged and pass, and `graph.ts` re-exports `shortNodeType`.
- Accessibility: there is one h1, and the order is h1, then h2 per section, then h3. Previews use `aria-hidden` and `inert`, have no focusable elements, and this is tested. Focus rings show on buttons, links, and summaries. `--fm-muted-2` is used only on `--background` (4.6:1). Header links are plain anchors and work with the keyboard.
- Ownership: frontend paths plus backend's `package.json` and lockfile. The only `package.json` change is `lenis: "1.3.27"`. Nothing from `subscription.md` or `n8n.md` was built.

**The five frontend deviations:** all five are accepted.
1. `html.lenis { scroll-behavior: auto }`: needed. The `lenis.css` in 1.3.27 has no scroll-behavior rule, and CSS smooth scrolling would fight Lenis's per-frame `scrollTo`. Its specificity beats `html` inside `@layer base`.
2. `shortNodeType` moved to `node-type.ts`: needed. `graph.ts` has runtime imports from `@xyflow/react` (`MarkerType`, `Position`), so `node-icon.tsx` would have pulled React Flow into `/`. Callers do not change because `graph.ts` re-exports it.
3. Layout renders only the footer, and pages render `SiteHeader` and `<main>`: acceptable. The header stays a server component with no `usePathname`. All three marketing pages render it.
4. `/` sets its own meta description: honest, but it is copy that is not in design.md (see RL-11).
5. Hero sample "42 files read / 6 blocked for safety" and commit `4f2c9e1`: acceptable. It sits inside an `aria-hidden` example frame labelled `example/storefront · main` and mirrors the real analysis header and files summary. It is not a product or usage metric, and it is not key-shaped. It should be written down in design.md (RL-11).

### RL-1: Desktop how-it-works changes height after hydration, so a deep link to a lower section can land in the wrong place
- File: `src/features/marketing/components/how-it-works.tsx:40` (`layout = motionAllowed && desktop ? "sticky" : "stacked"`), `:157` vs `:245`
- Severity: medium
- Owner: frontend
- Problem: the server render is the stacked story, as F5 requires: four grid rows of text plus visual. On desktop with motion allowed, the client then switches to the sticky story: four `min-h-[70vh]` text blocks with a 540 px absolutely positioned visual. The two have different heights, so everything below `#how-it-works` moves once JS hydrates.
  - Loading `/#security` or `/#faq` directly (the privacy and terms header links do exactly this) first jumps to the server-rendered position. The content then shifts under the reader.
  - Chrome and Firefox scroll anchoring usually hides this. Safari does not support `overflow-anchor`, so there it breaks F11.5 ("Loading `/#faq` directly lands on the FAQ") and adds CLS whenever the section is in view at hydration.
- Fix (pick one):
  - (a) Give the server and stacked render the same block heights from 768 px, using CSS only: `md:min-h-[70vh]` per step row plus the same visual height, so the switch does not change the section height.
  - (b) After the layout first changes to `sticky`, if `location.hash` names a section below `#how-it-works`, re-align that section once with `scrollIntoView({ block: "start" })` (or `lenis.scrollTo(target, { immediate: true, offset: -80 })`). Do this only on that first change.
  - Add a test that renders with `desktop: true` and a hash, then asserts the re-align call. Also add the case to the owner check in Safari.
- Status (2026-11-28): Fixed. The layout is chosen in CSS (`md:motion-safe:`). The server HTML holds both the stacked visuals and the sticky column, and the hidden one is dropped after mount. Headless Chrome on the production build: every section offset and `scrollHeight` are identical with JS off and on at 1440×900, 1024×768, and 390×844. `/#faq` and `/#security` land with the section at 80 px. Tests: `motion-identity.test.tsx` "RL-1" and `landing-premount.test.tsx`.

### RL-2: Content that is already visible goes blank, then fades in, after hydration
- File: `src/features/marketing/components/how-it-works.tsx:164-178` (`AnimatedPanel`), `src/features/marketing/components/reveal.tsx:30-41`
- Severity: low
- Owner: frontend
- Problem: when motion is allowed, the static `<li>` and `<div>` are replaced by Motion elements with `initial={{ opacity: 0, y: … }}`. A panel or feature card that is already on screen when hydration finishes (for example on a phone scrolled into the story, or after a deep link) flips from visible to invisible, then fades back in. That reads as a flicker, not an entrance.
- Fix: use `initial={false}` for elements that are already in view at mount. For example, check `useInView` before the first animation, or measure once in a layout effect and skip the entrance animation for those elements. Elements below the fold keep the entrance animation.
- Status (2026-11-28): Fixed. `entrance.ts` `useEntrance` reads the box once and leaves elements that are already on screen as they were rendered. Only elements below the fold start hidden. Tested ("RL-2" x2).

### RL-3: The hero frame tilts away from the reader right after load
- File: `src/features/marketing/components/hero.tsx:85-93`
- Severity: low
- Owner: frontend (direction: architect)
- Problem: the server render is flat, as it must be. `intro` then animates from 0 to 1, so 600 ms after hydration the frame rotates back to 14° and shrinks to 0.94, and only flattens again on scroll. The first motion the visitor sees is the hero image leaning away, which is the reverse of the "settles into place" feel the spec describes.
- Fix: consider making the scroll-linked flatten the only motion. Start TiltingFrame already flat at scroll 0 (no intro), or apply the tilt only once the user has scrolled. If the owner prefers the current behaviour, the architect records it in design.md "Motion".
- Status (2026-11-28): Changed, but not as suggested, and still open for the architect. The frame stays flat when it is on screen at load, and the tilt is armed only when the frame starts below the fold. That makes the tilt dead on any normal desktop. See RM-3.

### RL-4: The security example frame cannot stick
- File: `src/features/marketing/components/security.tsx:17` (`overflow-hidden` on the section), `:42` (`lg:sticky lg:top-24`)
- Severity: low
- Owner: frontend
- Problem: `overflow: hidden` on the section makes it the scroll container for the sticky child, and the section never scrolls, so `lg:sticky` has no effect. The class either does nothing or is a feature that silently fails.
- Fix: use `overflow-clip` (which clips without creating a scroll container) on the section. Otherwise, remove `lg:sticky lg:top-24`.
- Status (2026-11-28): Fixed (`overflow-clip`).

### RL-5: Unlayered `.fm-*` classes override Tailwind utilities
- File: `src/app/globals.css:203-230` (`.fm-grid-bg`, `.fm-hero-glow`, `.fm-mono-label` outside any `@layer`), `src/features/marketing/previews/parts.tsx:46`
- Severity: low
- Owner: frontend
- Problem: unlayered CSS beats every rule in `@layer utilities`. As a result, `text-[10px]` on the "Example" pill is ignored and it renders at 12 px, and any future `text-*`, `leading-*`, or `tracking-*` utility next to `fm-mono-label` will also fail silently.
- Fix: declare these with Tailwind v4 `@utility fm-mono-label { … }` (or wrap them in `@layer components`), so utilities can override them. Then check the "Example" pill size.
- Status (2026-11-28): Fixed (`@utility fm-grid-bg / fm-hero-glow / fm-mono-label`).

### RL-6: Preview copy is hard-coded instead of coming from `copy.ts`
- File: `src/features/marketing/previews/parts.tsx:47` ("Example"), `:201-217` ("Analysis", "Branch … at", "Security findings", "Recommendations"); `src/features/marketing/copy.ts:131` (`SECURITY.exampleTag` is defined but never used)
- Severity: low
- Owner: frontend
- Problem: F1 says components read every landing string from `copy.ts`. The design-mandated "Example" tag is typed in again in the preview, so the exact-copy test checks the constant, not what is rendered.
- Fix: render `SECURITY.exampleTag`. Move the four preview labels into `preview-data.ts` or `copy.ts`.
- Status (2026-11-28): Fixed (`SECURITY.exampleTag`, `PREVIEW_LABELS`, `PREVIEW_COMMIT`).

### RL-7: Import cycle between `copy.ts`, `plans-coming-soon.tsx`, and `primitives.tsx`
- File: `src/features/marketing/copy.ts:7`
- Severity: low
- Owner: frontend
- Problem: `copy.ts` re-exports `PLANS_*` from `plans-coming-soon.tsx`, which imports `primitives.tsx`, which imports `COMING_SOON` from `copy.ts`. It works today only because `COMING_SOON` is read at render time. It also makes the plain data module pull in `next/link` and `lucide-react`.
- Fix: drop the re-export. The tests can import `PLANS_*` from `plans-coming-soon.tsx`, where F1 requires them to stay. If you keep it, import `COMING_SOON` in `primitives.tsx` from a leaf module.
- Status (2026-11-28): Fixed. The re-export is removed, and the tests import `PLANS_*` from `plans-coming-soon.tsx`.

### RL-8: Two type scale and button size deviations
- File: `src/features/marketing/components/features.tsx:50` (feature card titles are a fixed `text-xl leading-7`), `src/features/marketing/components/primitives.tsx:26` with `site-header.tsx:31` (header primary button is 36 px)
- Severity: low
- Owner: frontend
- Problem: design.md gives card titles the H3 step (24/32 on desktop, 20/28 on mobile). They are 20/28 at every width. The primary button spec is 44 px tall; the header button is 36 px. The header size is a reasonable choice, but it is not in the spec.
- Fix: use `h3Class` for feature card titles, or have the architect record that bento titles stay at 20 px. Ask the architect to add a "small primary (header) 36 px" variant to design.md, or make the header button 44 px.
- Status (2026-11-28): Fixed. Feature titles use `h3Class`, and the header "Get started" is the 44 px primary, so it now matches the spec and needs no new variant. For 320 px, see RM-5.

### RL-9: The sample graph shows a webhook flow that does not reply on the "true" path
- File: `src/features/marketing/preview-data.ts:116-161`
- Severity: low
- Owner: frontend
- Problem: Webhook goes to IF. On true it goes to Slack; on false it goes to Respond to Webhook. On the true path the webhook caller never gets a response, which is a broken pattern under `respond: "respondNode"`. This preview is shown as an example of Flow Motion's output, and node-catalog.md pairs `webhook` with `respondToWebhook`.
- Fix: add an edge from `slack` to `respond`, so both branches reply. Alternatively, put a `noOp` on the false branch and drop Respond to Webhook. Update both layouts.
- Status (2026-11-28): Fixed. A `slack → respond` edge is in both layouts, with a vertical same-column edge in landscape. Tested in `flow-geometry.test.ts`.

### RL-10: "32" appears three times in copy, but no test links it to the allow list
- File: `src/features/marketing/copy.ts:35,69,164`, `src/features/marketing/components/landing.test.tsx`
- Severity: low
- Owner: frontend
- Problem: if `TIER1_NODE_NAMES` or `TIER2_NODE_NAMES` ever change, the fact strip, step 04, and the FAQ would make a false claim and nothing would fail.
- Fix: add a test that imports `ALLOWED_NODE_TYPES` from `@/lib/n8n-catalog/allowlist` (import it only in the test, not in the landing bundle) and asserts that the number in the three strings equals `ALLOWED_NODE_TYPES.length`.
- Status (2026-11-28): Fixed (test in `flow-geometry.test.ts:164` against `ALLOWED_NODE_TYPES.length`).

### RL-11: Two shipped strings and the sample values are not in design.md
- File: `src/features/marketing/copy.ts:191-194` (`LANDING_META.description`), `src/features/marketing/preview-data.ts:43-46` and `parts.tsx:203` ("42 files read", "6 blocked for safety", `4f2c9e1`)
- Severity: low
- Owner: architect
- Problem: the rule is that every landing string is fixed in design.md. The meta description and the hero sample values are honest, but nobody has signed them off.
- Fix: the architect adds the meta description and the hero sample values (counts, short SHA, recommendation titles, and confidences) to design.md "Landing page".
- Status (2026-11-28): Open (architect). The meta description and sample values are still not in design.md.

### RL-12: The root metadata still says flows are simulated
- File: `src/app/layout.tsx:15-16` (existed before this change)
- Severity: low
- Owner: frontend (copy: architect)
- Problem: "…simulate them with mock data, and export the JSON." is the description for every route that does not override it, including `/login` and `/signup`, which are public. Phase 4 is not built, so this breaks the honesty rule that D-55 enforces on `/`.
- Fix: use the `LANDING_META` sentence, or a neutral sentence approved by the architect, as the root description.
- Status (2026-11-28): Fixed. The root description is now `LANDING_META.description`, which is itself still waiting for architect sign-off under RL-11.

Open: high 0 · medium 1 (RL-1 frontend) · low 11 (RL-2..RL-10, RL-12 frontend; RL-3 and RL-8 also need architect sign-off; RL-11 architect). After RL-1 is fixed, the landing redesign can be committed. The lows can follow later.

## Landing motion identity (code review 2026-11-28)

Scope: the uncommitted working tree compared with `e621949`, plus untracked files. That covers `src/features/marketing/**` (new: flow-line, flow-wrapper, flow-store, flow-geometry, dot-loop, entrance, word-reveal, section-intro, hero-nodes, magnetic, marketing-wordmark, previews/progress; rewritten: hero, how-it-works), `src/app/(marketing)/page.tsx`, `src/app/layout.tsx`, `globals.css`, and the tests.

Checks:
- `npm run typecheck` pass, `npm run lint` pass.
- `npx vitest run` pass (1672 passed, 90 skipped).
- `npm run build` pass, and `/` is still `○` static.
- Extra: I served the prerendered `/` from `.next` and drove headless Chrome over CDP at 1440×900, 1024×768, 390×844, and 320/360/375 phone sizes, with motion on, reduced motion, and JS off. `next start` cannot be used here because the server needs env values.

**Confirmed OK:**
- **RL fixes:** see the status lines added above. RL-1 is verified in a real browser: identical offsets with and without JS, and deep links land at 80 px. RL-11 is still open (architect). RL-3 is a deviation (RM-3).
- **M1 gates:** `FINE_POINTER_QUERY` and `WIDE_QUERY` are in `hooks.ts`, and `smooth-scroll.tsx` re-exports the shared constant without any change in behaviour.
- **M2 flow line:**
  - It is rendered only after mount and is `aria-hidden`, `pointer-events-none`, and `-z-10` inside the `isolate` wrapper.
  - Measurement uses one measure function, a `ResizeObserver` on the wrapper, sections, and `details`, plus `document.fonts.ready` and resize, batched into one rAF.
  - Measured at 1440: the route is `M 720 977 C 720 1041, 136 1041, 136 1105 L 136 8062`. The rail is at x 136, the middle of the 32 px gutter, and the curve starts at the frame's output handle and runs through the hero's bottom padding.
  - The drawn length follows `scrollY + 0.6·vh` via `pathLength`, so Motion writes `stroke-dasharray`/`stroke-dashoffset`. It undraws on scroll up.
  - Under reduced motion it is `static` with every node lit.
- **M3 nodes and pulse:** there are six nodes on the rail, outside the section DOM, so `#plans` is untouched. Lighting follows the drawn end. A pulse plays only when exactly one node lights, and the first pass is quiet (unit-tested in `updateLit` and in rendering). In the browser, `how-it-works` lit at scroll 1400 and `features` at 4000.
- **M4 dots:** 4 dots at r 2 and 160 px/s on desktop, 2 at r 1.5 and 120 px/s on phones. They run only on the visible drawn part, with 24 px fades and the 120 px minimum. They come from a lookup table and set only transform and opacity.
- **M4 dot loop:** it stops when nothing is visible, while the tab is hidden, and on unmount. It restarts on scroll, on geometry change, and when the tab becomes visible (`dot-loop.ts`, tested). It is the only endless loop.
- **M5 word reveal:**
  - The words are plain `inline-block` spans with real spaces and no ARIA. They are not used on the H1 or Plans.
  - The stagger is 40 ms, capped at the eighth word. The eyebrow fades in with the first word, and the lead starts 120 ms after it. Each intro reveals once, triggered by its node, with an `inView` fallback at the same 60% tip line.
  - Accessible names are tested before and after the split.
  - In the browser, the words go from opacity 0 to 1 when their node lights.
- **M6 hero assembly:**
  - The chips render only at 1280 px and up, after mount. At 1440 the scattered chips sat at (66,163), (153,460), (1248,253), (1333,488), clear of the headline. At scroll 700 they formed one row 48 px above the frame.
  - The ease, the 0→0.25 assembly window, and the 0.15→0.30 edge draw match the spec.
  - Parallax is 12 px × depth × (1 − assembly), with the specified spring, and needs `motionAllowed && finePointer`. Its listeners are attached only while the hero is in view, and the box is cached and invalidated on scroll or resize.
  - Under reduced motion the chips show the static assembled row.
- **M7 wordmark:** the line draws only in the header on `/` (`drawWordmark`). The footer, the legal pages, and the pre-mount render show it static. The shared `Wordmark` is unchanged (source test). The link's name and `textContent` are "Flow Motion".
- **M8 story:**
  - It uses `useScroll` over the list with `["start center","end center"]`, crossfading over ±0.04 around 0.25, 0.5, and 0.75.
  - The scanner bar moves over 0.25→0.40. Rows leave and cards enter over 0.44→0.56, 0.02 apart. Cards shrink and graph nodes grow over 0.69→0.81, and the edges draw over 0.78→0.90. All of it is reversible.
  - The data attributes are kept. The stacked and reduced variants are unchanged.
- **M9 magnetic button:** only the two large "Get started" buttons. Pull 0.25, cap 6 px, 24 px zone, specified spring. The transform is on a wrapper span, so the focus ring moves with the button and focus order does not change. It needs motion and a fine pointer, and only `mouse`/`pen` pointer types count. Listeners are attached only while the button is in view, and the box is cached.
- **M10 tests:** a–i are present (f is covered by the dot-loop unit test, and h by the source test).
- **Performance:**
  - Only transform, opacity, and `pathLength` are animated.
  - Layout is read only in measure functions, plus one cached box read per pointer session or scroll and one on-screen check at mount. Scroll and frame callbacks use only cached numbers.
  - Every listener and observer is removed on cleanup.
  - No `package.json` change. The import allow list is enforced by the source test.
  - `@xyflow/react`, TanStack Query, and Supabase are still unreachable from `/`.
- **Accessibility:**
  - Reduced motion was checked in the browser: `static` line, 0 dots, 0 word spans, magnets `off`, stacked story.
  - Decorative layers are `aria-hidden`, hold nothing focusable, and take no pointer events (tested).
  - The server HTML has no decorative layer, no `opacity:0`, and no `rotateX` (tested and confirmed with JS off).
- **Ownership:** only frontend paths and `docs/status.md` changed. No backend, `package.json`, or `src/components/shared/**` change. Nothing from `subscription.md` or `n8n.md` was built, and `#plans` has the same copy and no motion.

**Deviations judged:**
1. **Hero frame stays flat when on screen at load:** this removes the tilt in practice (RM-3).
2. **Intros already on screen at load stay put:** accepted. The spec says "above the tip line", and the build uses "anywhere in the viewport", which is stricter in favour of never blanking visible text and agrees with RL-2. The architect should note it in design.md item 4.
3. **Output handle on the hero frame:** accepted. It is an 8 px circle with a 1.5 px accent ring, sits on `data-flow-handle`, renders after mount, and is `aria-hidden`.
4. **Header button 44 px and phone padding:** 44 px matches the primary spec. At 320 px, "Log in" wraps (RM-5).
5. **Three happy-dom stubs:** they are confined to `motion-identity.test.tsx` and restored (`animate` in `afterAll`, globals in `afterEach`), so they do not leak into other files. Removing `Element.prototype.animate` forces Motion's JS frame loop, which hides nothing I could find: real Chrome showed the same results. The always-in-view IntersectionObserver does hide the "only while in view" rules (RM-6).
6. **Hero parallax not positively tested:** worse than untested. The touch-only chip assertion cannot fail (RM-2).

### RM-1: Phones scroll sideways because the bento grid is 430 px wide (existed before this work)
- File: `src/features/marketing/components/features.tsx:73` (`grid gap-4 md:grid-cols-2 …`, no phone column template), `src/features/marketing/previews/parts.tsx:197` (`<pre>` with `whitespace-pre` lines)
- Severity: medium
- Owner: frontend
- Problem: at 375 px the document is 446 px wide, with JS on and off. The same happens at 320 and 360. Below `md`, the grid has one implicit `auto` column, and grid items keep `min-width: auto`. The export card's JSON excerpt lines force a min-content of about 430 px, so every feature card overflows the viewport. Mobile browsers then zoom the whole landing page out or let it scroll sideways, and the flow rail (8 px from the edge), the header, and the hero all shift with it. The lines involved are unchanged since `e621949`, so this was missed in the RL review, but it breaks the phone version that this phase's owner check asks for.
- Fix: add `grid-cols-1` to the grid (in Tailwind v4 that is `minmax(0,1fr)`), or add `min-w-0` to the `Reveal` wrappers. Also give the `<pre>` `max-w-full overflow-x-auto`, or let the lines clip inside the card's `overflow-hidden`. Then check that `document.documentElement.scrollWidth === innerWidth` at 320, 375, and 390.

### RM-2: The touch-only parallax test cannot fail, and parallax has no positive test
- File: `src/features/marketing/components/motion-identity.test.tsx:157-180` (M10 b), and the comment at `:190-191`
- Severity: medium
- Owner: frontend
- Problem: in happy-dom the hero scroll progress is complete, so `assembly = 1` and the parallax term `× (1 − assembly)` is always 0. "Chips unchanged after `pointermove`" therefore passes whether parallax is gated on `finePointer` or not. Contract M10 b requires this check, and the test does not check it. The code gate in `hero.tsx:57` (`parallax={motionAllowed && finePointer}`) is correct as written, but no test protects it.
- Fix: mock `useScroll` from `motion/react` in this file (keep the rest of the module) so the hero's `scrollYProgress` is `motionValue(0)`. Then add:
  - (a) a positive control: fine pointer, wide, and motion on, and a `pointermove` over the hero changes at least one chip's transform;
  - (b) the touch-only case, which now really asserts that nothing changes;
  - optionally, a spy on `hero.addEventListener` asserting that no `pointermove` listener is added without a fine pointer.

### RM-3: The hero tilt never runs on a normal desktop, and design.md still describes it
- File: `src/features/marketing/components/hero.tsx:115-137` (the `armed` check at `:121`, `will-change-transform` at `:133`); `docs/design.md` "Landing page" → "Motion" (hero tilt 14° → flat)
- Severity: low
- Owner: architect (direction), frontend (build)
- Problem:
  - The frame's top is at about 656 px, so the tilt is armed only on windows shorter than about 656 px. At 1440×900 and 1280×720, `[data-hero-frame]` has `transform: none` throughout. This fixes the "tilts away after load" problem, but it also quietly removes the 3D effect the owner asked for, and the spec and the code now disagree.
  - The frame keeps `will-change: transform` and so stays a promoted layer even though it never moves.
- Fix:
  - Keep "flat at scroll 0" and make the tilt happen only while the user scrolls past. For example, `rotateX` 0 → 10° and `scale` 1 → 0.96 with `transformOrigin: "50% 100%"` over hero scroll progress 0.35 → 1, so the frame leans back as it leaves under the header. That is fully reversible and starts flat at load, so nothing moves without user input.
  - Alternatively, tie a small 0 → 6° lean to the same 0 → 0.25 range as the chip assembly. That also starts flat, and it makes "the frame settles back as the flow assembles" read as one motion.
  - Either way, drop the `armed` read, apply `will-change` only while the progress is between 0 and 1 (or remove it), and have the architect update design.md "Motion".

### RM-4: Two coral vertical lines run 16 px apart beside the desktop story
- File: `src/features/marketing/components/how-it-works.tsx:187-194` (the step's grid line and accent line at the left edge of each `li`), and `src/features/marketing/flow-geometry.ts:48-51` (rail)
- Severity: low
- Owner: architect (direction), frontend
- Problem: at 1440 the flow rail is at x 136, and the story's step line is at x 152, where the active step is accent too. In the screenshots this reads as a doubled line, against item 1's "one coral line". No spec was broken: the two specs conflict.
- Fix: in the sticky variant, drop the step's accent line and either keep the `--fm-grid` hairline or drop both. The flow line and the white active text already show progress. The architect records the choice in design.md item 7.

### RM-5: At 320 px "Log in" wraps to two lines in the header
- File: `src/features/marketing/components/site-header.tsx:8` (`navLinkClass`), `:34-41`
- Severity: low
- Owner: frontend
- Problem: measured at 320 px, the "Log in" link is 56 px tall (two lines), and "Get started" ends at x 304 with no room left. At 360 px it fits.
- Fix: add `whitespace-nowrap` to `navLinkClass` and to the header button. Under 360 px, tighten the gaps (`gap-0.5`, login `px-2`). Recheck at 320.

### RM-6: The IntersectionObserver stub hides the "only while in view" rules
- File: `src/features/marketing/components/motion-identity.test.tsx:40-55`
- Severity: low
- Owner: frontend
- Problem: every target is always intersecting, so the in-view gating of the hero parallax listeners and the magnet listeners (design.md "Pausing") never runs in the off-screen case. The stub itself is confined and restored correctly.
- Fix: make the stub controllable (a module-level `intersecting` flag). Add one test: with the magnet out of view, a window `pointermove` leaves `[data-magnetic]` untransformed. Then show that it does react after the observer reports it in view.

### RM-7: The wordmark line has uneven space on its two sides
- File: `src/features/marketing/components/marketing-wordmark.tsx:37,52`
- Severity: low
- Owner: frontend
- Problem: the SVG has `mx-1` (4 px each side) and a literal space follows it, so the right gap is about 8 px against 4 px on the left. design.md item 6 asks for 4 px on each side.
- Fix: use `ml-1` on the SVG and keep the space, which gives about 4 px. That keeps `textContent` as "Flow Motion".

### RM-8: The hero measure can run after unmount
- File: `src/features/marketing/components/hero-nodes.tsx:76`
- Severity: low
- Owner: frontend
- Problem: `document.fonts.ready.then(schedule)` has no cancelled guard. `flow-line.tsx:100` has one. If the hero unmounts (`wide` turns false, or the user navigates away) before fonts resolve, it schedules a frame that reads layout and calls `setGeometry` on an unmounted component.
- Fix: add `let cancelled = false` as in `flow-line.tsx`, and check it in `schedule` and `read`.

Open: high 0 · medium 2 (RM-1, RM-2 frontend) · low 6 (RM-3, RM-4 architect plus frontend; RM-5..RM-8 frontend), plus RL-11 (architect). Commit once RM-1 and RM-2 are fixed. Both are small: one CSS change and one test change. RM-1 existed before this work, so the coordinator may instead accept it and commit now with RM-1 tracked. The lows can follow, but RM-3 needs an owner or architect decision on the hero tilt before the owner browser check.

## Phase 3b UI tasks OC-4..OC-7 (code review 2026-11-28)

Scope: uncommitted frontend files for OC-4..OC-7 vs `f663eef` (`src/features/flows/copy.ts`(+test), `generate-error-notice.tsx`(+test), `stale-analysis-dialog.tsx`(+test), `recent-flows.tsx`(+test), `recommendation-action.tsx`(+test), `src/features/analysis/components/recommendations-list.tsx`, `analysis-view.tsx`, `sections.test.tsx`, `src/features/analysis/queries.ts`(+test), `src/features/projects/components/dashboard-view.tsx`, `dashboard.test.tsx`). `src/lib/**` and `tests/lib/**` were not reviewed (backend work in progress).

Checks run: `npm run typecheck` pass, `npm run lint` pass, `npx vitest run src/features` 29 files / 441 tests pass. `npm run build` was not run in this review.

Verified:
- Only files on the OC-4..OC-7 allow-lists changed. `flow-node-card-body.tsx`, `node-type.ts`, `readiness.ts`, `fixtures.ts`, `src/features/github/**` (import only), `src/features/marketing/**`, `src/schemas`, `src/app/api`, `src/server`, and `supabase` are untouched. `analysis-view.test.tsx` did not need changing.
- The gate is still `false` in app code (`readiness.ts` unchanged; `flows/queries.test.tsx:98` still asserts it). `DashboardView` renders `RecentFlowsEmpty` and never mounts `useFlows` while the gate is closed. `dashboard.test.tsx` "gate closed" asserts that no request starts with `/api/flows`.
- OC-4: each code maps to the exact design.md string with its own `data-notice` value. `VALIDATION_ERROR` with an empty message falls back to the generic text. Non-`ApiError`s and `NETWORK` get the generic text. `<b>x</b>` renders literally. The gated branch is unchanged.
- OC-5: the title, both bodies, the 7-character sha in mono, and the button labels match design.md exactly. The dialog is labelled by its title. "Generate anyway" closes the dialog, then sends `{ recommendationIds: [id], allowStale: true }` once. The test compares the full list of POST bodies, so a second POST would fail it. Esc calls only `onOpenChange(false)`, and the test asserts one POST in total. "Re-analyze" links to `/projects/<encodeURIComponent(projectId)>`. The stale code shows no inline notice. `allowStale` is only ever set by the dialog path, so the dialog cannot reopen in a loop.
- OC-6: `RECOMMENDATIONS_POLL_MS = 3000`. The helper returns `false` for no data, an empty list, and lists with only `new` or `generated`. The hook sets `refetchIntervalInBackground: false`. With fake timers, the hook test checks no refetch at 2.9 s, a refetch at 3.1 s, then no further fetch for 10 s once nothing is `selected`. Removing `refetchInterval` would fail it.
- OC-7: rows use `Link` to `/flows/<encodeURIComponent(id)>`, the name and repo (in mono) render as text, the status shows icon plus text, the date uses `formatDate`, and at most 20 rows render. Loading shows skeletons, the empty state reuses the existing copy, and errors show `ErrorState` "Could not load flows" whose retry refetches. A `<script>` name stays literal. The "Recent flows" heading is unchanged.
- No `dangerouslySetInnerHTML` under `src/features`. No `any`.

Deviations judged:
- **Retry label "Try again"** (`recent-flows.tsx:43`, from the shared `ErrorState`): accepted. Every list error state in the app uses the shared component, and design.md says "a Retry button", not an exact label. See R3bu-2 for the doc wording.
- **Screen-reader label "Loading flows"** (`FLOW_COPY.loadingFlows`, `recent-flows.tsx:35`): accepted. It is not visible copy and follows `projects-grid.tsx:26` ("Loading projects"). Nothing in design.md conflicts with it.
- **Stale early return in `GenerateErrorNotice` written during OC-4**: accepted. OC-5 explicitly lists this file "only so `PROJECT_STALE_ANALYSIS` shows no notice". The intermediate OC-4-only state (stale error with no dialog) was never committed, and the final tree matches OC-5.

### R3bu-1: "Generate anyway" can fire twice during the dialog's exit animation
- File: `src/features/flows/components/recommendation-action.tsx:91` (`generateAnyway`), `src/features/flows/components/stale-analysis-dialog.tsx:61`
- Severity: low
- Owner: frontend
- Problem: `generateAnyway` closes the dialog and calls `start(true)` with no guard. Base UI keeps the popup mounted and clickable during its exit transition, and `AlertDialogAction` is a plain `Button` that does not disable itself. A fast double-click (or Enter pressed twice) can therefore send two `allowStale` POSTs. The second POST gets "A flow already exists for this recommendation." (or races the partial unique index), so an error notice flashes while the first request navigates. The server keeps the data correct (at most one active flow), so this is cosmetic, but it breaks the "exactly once" intent.
- Fix: return early when a request is already in flight, using a ref set on the first call (`if (sentRef.current) return; sentRef.current = true;`, reset in `onSettled`), or `if (generate.isPending) return;`. Then add a test that double-clicks "Generate anyway" and asserts two POSTs in total (the stale POST plus one).

### R3bu-2: design.md says "Retry button", but the shared ErrorState label is "Try again"
- File: `docs/design.md:236` (Dashboard "Recent flows"), `docs/contract.md` OC-7 ("with Retry")
- Severity: low
- Owner: architect
- Problem: the docs name the button "Retry", while the shared `ErrorState` (used by every list, including "Could not load recommendations") renders "Try again". The code is consistent with the rest of the app, but a reader of the "exact copy" rule could flag it again.
- Fix: change the wording to "with the shared error state's \"Try again\" button" (and optionally list the "Loading flows" screen-reader label), or record that `ErrorState`'s label is the app-wide retry copy.

Open: high 0 · medium 0 · low 2 (R3bu-1 frontend, R3bu-2 architect). OC-4..OC-7 can be committed (after the coordinator's `npm run build` and full `npx vitest run`, which excludes the backend's in-progress `tests/lib/validator/review-fixes-3a.test.ts`). The lows can follow.

## Phase 3a review fixes — backend code re-review (2026-11-28)

Scope: uncommitted backend changes vs `HEAD` f663eef in `src/lib/**`, `src/schemas/flowspec.ts`, `scripts/**`, `tests/lib/**`, `tests/conformance/**`, plus the new `src/lib/security/scan-render.ts`, `src/lib/validator/allowed-params.ts`, `tests/lib/security/secret-scanner-d48.test.ts`, `tests/lib/validator/review-fixes-3a.test.ts`. Checked against contract section 11 "Phase 3a review fixes" backend items 1-11, sections 7-8, D-46..D-53, `security.md` sections 2 and 9, `testing.md` rules 5-8, `node-catalog.md`, and the backend entry of 2026-11-28 in `requests.md`. `src/features/**` was not reviewed (frontend, reviewed separately).

Commands: `npm run typecheck` pass. `npm run lint` pass. `npx vitest run` 1814 passed / 90 skipped (RLS suite, no `SUPABASE_TEST_*`). `npm run build` pass. `npm run check:worker-deno` printed "skipped: deno not installed" (exit 0).

Mutation check: a scratch copy outside the repo, with one rule removed at a time, then the engine tests re-run. Every removal turned tests red:
- validator rule 6 `respondToWebhook` body check: 1 red
- the pair line in `renderForScan`: 6 red (postgres `password`, set `api_key`, supabase column, header `apikey`, every-conformance-pair, rendering-shape)
- the URL query secret detector: 3 red
- the reserved-name refine on `identSchema`: 4 red
- the validator table check (`isAllowedByTable`): 4 red
- the destination check: 3 red
- `hasReservedKey` in `assertExportSafe`: 4 red
- validator `://` narrowed back to `http://`: 2 red
- the validator header rule: 8 red (one per refused name)
- the workflow `name` rule 6 check: 3 red
- the `Text` `://` check: 4 red

Verified:
- **Item 1 (S3a-1).** Three detectors in `secret-scanner.ts`: Authorization scheme, URL credentials, and query secret. Each redacts only the secret part. Every positive case in the contract is tested: exact `redacted` text, masked type, and no 6-character run of the raw value left in `redacted` or the findings. The two curl cases are tested with their categories (`ci_secret`, `hardcoded_secret`), redis is `db_connection_string`, and Basic is built with `btoa` at test time. All 21 negatives are tested, plus two lowercase `your_` placeholders. All 7 linear-time inputs are 200 KB each. The existing scanner tests are unchanged and pass.
- **Item 2 (R3a-2, S3a-2, S3a-4).** One `renderForScan` in `src/lib/security/scan-render.ts` is used by `F9` (`check.ts`), rule 7 (`validate.ts`), and `assertExportSafe`. Both old copies are deleted, and `grep` finds no other renderer. It is iterative, reads own keys only, writes one line per leaf, adds the pair lines for `name`/`value` and `fieldId`/`fieldValue`, and renames only at the two exact positions (a test shows `key` / `currentKey` elsewhere keep their names). Every test the contract lists is there, including the every-conformance-pair property (asserted unconditionally, which is stricter than written) and both S3a-2 probes.
- **Item 3.** `__proto__`, `constructor`, and `prototype` are refused in `fieldNameSchema`, every `fieldPathSchema` part, and `identSchema`. `markExpressions`, the compiler `parameters`, and `defineBelowColumns` `value` use `Object.fromEntries`. Rule 1 and `assertExportSafe` `shape` refuse those keys at any depth. The 20-column test is present.
- **Item 4 (S3a-3, R3a-5).** `allowed-params.ts` imports nothing from `profiles/`. Rule 5 checks names, modes, and container keys from it. Rule 8 checks destinations (the full list in `security.md` section 9; for a resource locator, its `value`). `assertExportSafe` has rule `type`, and `isExcludedNodeType` is shared with rule 8. All 9 mutated-golden cases are tested and fail. The invariant test covers operations and forbidden names and checks that the table and the profiles cover the same 32 types.
- **Items 5-8.** `Text` refuses `://`, and rule 8 refuses `://` in any parameter string. The sixth warning is in the right place, and the order test is updated. The header rule is in both layers (7 refused, 2 accepted). `respondToWebhook` uses `LiteralPair`, enforced by `F7` and by rule 6 on `responseBody`. Flow `name` and `description` use `displayText` (schema), and rule 6 checks the workflow `name`. Each is tested in both layers.
- **Item 9.** `CATALOG_VERSION = "2.49.5+fm2"`. Not regenerating `catalog.generated.json` is correct: that file holds only n8n facts for the unchanged `n8nVersion` / `nodesBaseVersion` 2.49.5, and the `+fm<n>` suffix lives only in `version.ts` (`catalog-consistency.test.ts:120` checks its form).
- **Golden.** `order-webhook` (spec plus export) is the only golden change: the `orderId` expression became the literal `status: "queued"`, and the `responseBody` lost its leading `=`. The byte-for-byte and two-run stability tests pass for all 5 goldens.
- **Existing tests.** Changed only where the new rules require it: `validate.test.ts` (3 expectations gain rule 5 or 8 from the table and destination rules, and `authentication: "oAuth2"` is now refused), `compile.test.ts` (golden reply text, sixth warning), and `profiles.test.ts` (respond sample is now literal).
- **Item 10 (S3a-9).** Read by hand: there is no test for the scripts. `n8n-import-test.mjs` runs the `npx` fallback only with `--allow-npx`, and prints the download and install-script notice before the first `npx n8n` call. Without the flag it prints the exact skip line and exits 0. In `generate-node-catalog.mjs`, `fail()` throws inside `try`, and the exit code is set after the `finally` cleanup.
- **Boundaries.** No change to `package.json` or lockfiles. No backend change under `src/features/**`, `src/app/**`, `src/server/**`, or `supabase/**`. No `any`. No migration or route. Nothing from Phase 4, `subscription.md`, or `n8n.md`. R3a-4 is untouched and R3a-9 is not started, as instructed.

Deviations judged:
- **`removeDuplicates` exemption in the table invariant: accept.** `removeDuplicateInputItems` removes duplicates from the current items in memory and touches no data. The exemption is exact (one value on one type), and every other operation is still checked. Keeping the explicit operation is safer than relying on an n8n default that the catalog cannot show (see R3aR-2). It still needs recording in `security.md` (R3aR-3).
- **Rule 8 fails on a missing destination: accept.** "Exactly one `YOUR_…` token" is not met by an absent value. Every profile emits its destinations on every path (checked in `airtable`, `email-send`, `github`, `gmail`, `google-sheets`, `notion`, `slack`, `telegram`), so no valid export is refused.
- **Validator header rule refuses hyphens: accept.** This is what D-51 (b) and OQ-28 say ("names stay `FieldName`, no `-`"), so it is not stricter than the decision. It matches the profile, which already used `pairSchema`. The old hyphenated entries (`proxy-authorization`, `x-api-key`) are covered by the pattern.

### R3aR-1: `checkFlowSpec` throws on a Zod-valid draft with deep params or test data
- File: `src/lib/flowspec/check.ts:195` (F9 call), `src/lib/security/scan-render.ts:112`
- Severity: medium
- Owner: backend
- Problem: `renderForScan` throws `ScanRenderError` once a frame reaches `JSON_MAX_DEPTH` (32), counted from the value passed in. `F9` passes the whole draft, but `jsonValueSchema` limits depth from each `params`, `payload`, `mocks`, or `outputs` value, which already sits 3 to 6 levels down. Reproduced in the scratch copy: `baseDraft()` with `params.deep` nested 31 objects, or `tests.cases[0].trigger.payload` nested 31, passes `flowSpecDraftSchema`, and then `checkFlowSpec` throws `ScanRenderError: Value too deep to render for the scanner`. It does not return `{ ok: false, errors }`. Before this change F9 used `JSON.stringify` and never threw. Model output is untrusted, and in 3b this turns a retryable rule failure into an unexpected exception in the `ai` step. `ScanRenderError` is not caught or tested anywhere. Rule 7 and `assertExportSafe` are not affected, because each checks `isJsonValue` on the whole workflow first.
- Fix: in `check.ts`, catch `ScanRenderError` around the F9 scan and push `{ rule: "F9" }` (fail closed). Alternatively, give `renderForScan` a `maxDepth` parameter and call it with `JSON_MAX_DEPTH + 6` for drafts. Add tests: deep `params` and a deep test `payload` each return `ok: false` and do not throw.
- Status: **fixed** (round-2 verification 2026-11-28). `scanFindsSecret` in `scan-render.ts` catches `ScanRenderError` and returns a finding; F9, rule 7 and `assertExportSafe` all call it. Deep `params` and deep test `payload` (31 levels, Zod-valid) give F9 without throwing; a deep `responseBody` gives rules 6 + 7 and export `secret`. Removing the catch turns 3 tests red.

### R3aR-2: Validator mode values are checked only when present; an omitted `operation` falls back to an unseen n8n default
- File: `src/lib/validator/validate.ts` (`isAllowedByTable`), `src/lib/validator/allowed-params.ts`
- Severity: low
- Owner: backend
- Problem: `modes` are enforced only when the parameter exists. An export built without the compiler can drop `operation` or `resource` on `postgres`, `supabase`, `googleSheets`, `airtable`, and similar nodes, and n8n then uses its built-in default. The generated catalog removes defaults, so the validator cannot show that default is safe. The D-50 aim ("any code path that writes `n8n_json` without the compiler still cannot ship ... deletes") then depends on n8n's defaults, not on the table. The compiler always emits these values, so there is no live exposure today.
- Fix: add a `required` list per entry (at least every `resource` and `operation` the table lists) and fail rule 5 when one is missing. Add a mutated-golden test that deletes `operation` from the `postgres` node and expects rule 5.
- Status: **fixed** (round-2 verification 2026-11-28). `requiredModes` (table modes minus `optionalModes`) must all be present in rule 5; a test deletes every required mode of every golden node (>40 cases) and expects rule 5. Removing the check turns 2 tests red.

### R3aR-3: Backend deviation entry still open; security.md does not record the exemption
- File: `docs/requests.md` (backend → architect, 2026-11-28), `docs/security.md` section 9, `docs/testing.md` rule 8
- Severity: low
- Owner: architect
- Problem: `security.md` section 9 states the table invariant without the `removeDuplicates` exemption. `testing.md` rule 8 does not say that a missing destination fails. All three items are accepted above, but the request is still `Status: open`.
- Fix: record the exact exemption (`n8n-nodes-base.removeDuplicates` / `removeDuplicateInputItems`) under the rule 5 invariant, add "a missing destination fails" to rule 8, and close the request.

### R3aR-4: Double cast hides the optional fields F9 passes to `renderForScan`
- File: `src/lib/flowspec/check.ts:195` (`draft as unknown as JsonValue`), `src/lib/security/scan-render.ts:107`
- Severity: low
- Owner: backend
- Problem: `FlowSpecDraft` has optional `sourceFiles` and `notes`, so it is not a `JsonValue`. The cast through `unknown` hides this, and `renderForScan` then needs its own `(current as unknown) === undefined` escape. This is strict-TypeScript-legal, but it is the one cast that crosses the shared rendering's typed boundary.
- Fix: type the input as `JsonValue | FlowSpecDraft`, or as an exported `ScanInput` that allows `undefined` property values, and drop both casts.
- Status: **fixed** (round-2 verification 2026-11-28). `ScanInput` allows `undefined` properties; no `as unknown` cast is left in `check.ts` or `scan-render.ts`; typecheck passes.

### Status of the Phase 3a findings (backend parts)
- R3a-2: **fixed.** One shared rendering is used, and the property test covers every conformance pair.
- R3a-3: **fixed.** Reserved names are refused in all three schemas, the compiler uses own properties, and rule 1 / `shape` check every depth.
- R3a-4: **open, backlog** (D-53). Untouched, as instructed.
- R3a-5: **fixed.** The validator table, destinations, and `://` anywhere (see R3aR-2 for one gap left).
- R3a-6: **accepted** (D-53, contract section 7 "Known exception"). The near-limit test is in the backlog.
- R3a-8: **fixed.** Both layers.
- R3a-9: **carried to 3b** (backend item 6).
- R3a-10: **fixed** in `contract.md` sections 7 and 8, and in `node-catalog.md` (architect). R3aR-3 covers the 2026-11-28 additions.
- R3a-1 and R3a-7 are frontend findings and not in this scope.

Open: high 0 · medium 1 (R3aR-1 backend) · low 3 (R3aR-2, R3aR-4 backend; R3aR-3 architect). Commit after R3aR-1 is fixed and tested. It is a small change: one `try`/`catch` and two tests. The lows can follow. For the 3b start condition, R3a-2 is verified fixed here. S3a-1 and S3a-2 also need security-reviewer confirmation.

## Phase 3a review fixes — round-2 verification (2026-11-28)

Scope: uncommitted backend round-2 changes vs `HEAD` 300d032 for R3aR-1, R3aR-2, R3aR-4 and S3aR-1..S3aR-5 (`src/lib/**`, `scripts/**`, `tests/lib/**`, `tests/conformance/**`, the newest backend entry in `requests.md`).

Commands: `npm run typecheck` pass. `npm run lint` pass. `npx vitest run` 81 files passed / 1 skipped, 1862 passed / 90 skipped (RLS suite). `npm run build` pass.

Mutation check (scratch copy outside the repo, one change at a time, `tests/lib` re-run, baseline 1169 green): R3aR-1 catch removed 3 red; F9 calling `renderForScan` directly 2 red; required modes removed 2 red; S3aR-1 token-run condition removed 12 red; Anthropic lookbehind back to `\b` 1 red; S3aR-2 lone-literal refusal removed 11 red; joined-literal separator check removed 2 red; S3aR-4 prefixes removed from the validator 10 red, from the profile 10 red; S3aR-5 body rendering removed 3 red; flat-body rule 6 removed 2 red.

Regressions: only the `order-webhook` golden (spec + export) differs from HEAD. The lone-literal expectations in `expression.test.ts` moved into comparisons, and every lone literal is now a rejection test. The four D-28 placeholder values that carried a real 20/30-character run were replaced by plain placeholders and the old values became positive tests; detection is stronger, not weaker. The seven D-48 200 KB cases still pass, but see R3aR-5.

Backend decisions (requests.md 2026-11-28, items 1-7): all acceptable as fail-closed defaults. (1) Literal only inside a comparison: no golden used one. (2) `:\`, `:/\`, `://` refused raw and after joining literal parts; `C:\` false positives are acceptable. A separator supplied at run time by a `$json` value is out of reach of a text check (caller data, same limit as bare domains). (3) Marker exemptions only without a token run: correct design, implementation defect in R3aR-5. A token split by `-`/`_` into runs under 20 characters after `YOUR_`, or a run of 19 characters after `example`, is still exempt (accepted limit of the D-48 threshold, informational). (4) `optionalModes` lists only parameters the profiles omit on some paths, none of them a data operation. (5) Underscore prefixes: both layers. (6) Flat-object body: both layers agree. (7) Deep input as F9 / rule 7 / `secret`: fail closed (a deep whole workflow is refused earlier as rule 1 / `shape`, also fine).

### R3aR-5: `isPlaceholderValue` is quadratic on `${…}` / `{{…}}` runs (new, from the S3aR-1 fix)
- File: `src/lib/security/secret-scanner.ts` (`withoutReferences`, called from `isPlaceholderValue`)
- Severity: medium
- Owner: backend
- Problem: each loop step calls both `value.indexOf("{{", pos)` and `value.indexOf("${", pos)`. When one marker never occurs, its search scans to the end of the string on every step, so the cost is O(n²). Measured in the scratch copy: `isPlaceholderValue("${}".repeat(66_666))` (200 KB) takes 20.7 s, 100 KB takes 5.1 s (4× for 2×). Through the real scanner, a repository file `src/a.ts` holding `api_key = "${a}${a}…"` at 200 KB (allowed by `MAX_FILE_BYTES` 204 800) takes 11.7 s in `scan`. Repository files are untrusted (security.md), and the D-48 rule requires linear time on 200 KB adversarial input; the existing seven 200 KB tests do not cover this shape.
- Fix: keep the next position of each marker and recompute it only once `pos` has passed it (or do one left-to-right pass looking for `{` / `$`). Add 200 KB tests through `scan` for `api_key = "${a}…"`, `api_key = "{{a}}…"` and `api_key = "{{a}${a}…"`, each under the same bound as the other D-48 linear-time tests.

Open: high 0 · medium 1 (R3aR-5 backend) · low 1 (R3aR-3 architect, docs). R3aR-1, R3aR-2, R3aR-4 fixed. Phase 3a is not ready to commit until R3aR-5 is fixed and tested (small: one loop change and three tests).

- **R3aR-5 status (coordinator, 2026-11-28):** fixed. `withoutReferences` is one linear pass; three new 200 KB adversarial tests through `scan()` finish in 3-10 ms (budget 1 s). Verified by the coordinator with the full suite (1865 passed).
