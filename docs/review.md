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

**R0-11** · `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `src/components/ui/button.tsx` · **low** · owner: frontend (going forward) · status: open
Problem: these are frontend-owned paths that the backend created during scaffolding. This is sanctioned by contract section 11 (Phase 0 is "scaffold Next.js, shadcn init", backend only), so it is not an ownership violation, but two things carry over: `globals.css` maps `--font-mono` to `--font-geist-mono`, which `layout.tsx` never defines (only Geist sans is loaded; design.md asks for a mono family for code and JSON), and `next/font/google` fetches fonts at build time so an offline CI build fails.
Fix: from Phase 1 the backend must not touch these files; frontend loads `Geist_Mono` with `variable: "--font-geist-mono"` in `layout.tsx` (or requests the `geist` npm package through `docs/requests.md` if offline builds matter).

**R0-12** · `tsconfig.json` · **low** · owner: backend · status: resolved
Problem: `strict` is on but `noUncheckedIndexedAccess` is off. Phase 2 code (path policy, secret scanner, batch cursors) is index-heavy; turning this on later means touching finished code.
Fix: add `"noUncheckedIndexedAccess": true` now while the codebase is about ten files (current tree has no unguarded index access that would fail).

### Counts
high 0 · medium 3 (R0-1, R0-2, R0-3) · low 9 (R0-4 to R0-12)
