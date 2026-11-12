> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Contract — Flow Motion v1

Single source of truth. Owned by the architect. Status: DRAFT v1.

## 1. Scope
**In v1:** landing page, auth, dashboard; connect GitHub repo (read-only GitHub App); project validity check; safe file reading; security findings; automation recommendations; generate flows from selected recommendations; node canvas with inspector; mock-data simulation; n8n JSON export plus setup checklist.
**Out of v1:** running flows for users, user-facing live n8n testing (`n8n.md`; the dev/CI import test is in, D-9), subscription/billing/credit enforcement (`subscription.md`), team workspaces, non-GitHub sources, other export formats, Code nodes.

## 2. Core user flow
1. Land, sign up, go to `/dashboard`.
2. Install the GitHub App and pick repos.
3. Open a project, press Analyze.
4. See the validity result. Invalid projects stop here with a reason and no AI spend.
5. See security findings and the list of recommendations.
6. Select one or many recommendations, press Generate.
7. Open a flow: node canvas, click a node to inspect its parameters.
8. Run the test (mock data). See the level badge: Valid or Simulated.
9. Export n8n JSON plus the setup checklist.

## 3. Routes
- Marketing (public): `/`, `/privacy`, `/terms` — static pages. `/privacy` must state plainly that redacted snippets of the user's code are sent to the AI provider and that no source code is stored (`security.md` section 3).
- Auth: `/login`, `/signup` (pages, frontend; they call the browser Supabase client `signInWithPassword` / `signUp` directly, D-11), `GET /api/auth/callback` (Supabase code exchange, backend; configured as the Supabase redirect URL; on success redirects to `/dashboard`, on failure to `/login?error=auth`; never follows a `next` parameter), `POST /api/auth/sign-out` (backend; clears the session cookies, returns `{ signedOut: true }`; the frontend then navigates to `/login`). Sign-in method: email + password only in v1 (D-11). No password reset in Phase 1 (Phase 5).
- App (auth required): `/dashboard`, `/projects/[projectId]`, `/projects/[projectId]/analysis/[analysisId]`, `/flows/[flowId]`, `/settings` (display name, connected GitHub installations with disconnect; MFA enrolment added in Phase 5)
- Middleware (`src/proxy.ts`, Next.js 16 name for middleware, backend-owned, D-14): refreshes the Supabase session cookie on every matched request (`@supabase/ssr`); unauthenticated users visiting app pages go to `/login`; `/api/*` returns `401 UNAUTHORIZED` JSON instead of redirecting, except the browser-navigated `GET /api/github/install` and `GET /api/github/installations/callback`, which redirect to `/login`, and the sessionless `GET /api/auth/callback` and `POST /api/github/webhook`, which are not checked; authenticated users visiting `/login` or `/signup` go to `/dashboard`. Marketing pages are never redirected. Matcher excludes `_next/static`, `_next/image`, `favicon.ico`, and files with an extension.

## 4. Analysis pipeline (backend)
1. **Validate project (no AI).** Fetch the file tree (paths only) through the GitHub API. Valid if there is a strong marker of a website or app: `package.json` with a web or app framework (next, react, vue, svelte, nuxt, astro, express, fastify, nest, hono, react-native), `index.html` with assets, Python (django, flask, fastapi), Ruby (rails), PHP (laravel), Flutter `pubspec.yaml`, or a Go/Java/.NET web framework. Invalid: empty, docs-only, dotfiles-only, data-only, single script, no source. Output `{ kind: "website" | "app" | "invalid", reason }`. Stop on invalid.
2. **Select files.** Apply the path policy from `security.md` (deny first, then extension allowlist, size cap 200 KB per file, at most 400 files, prioritised: routes, API handlers, jobs, webhooks, CI files, manifests, schema files, README). Blocked files are counted by reason (`denied`, `extension`, `size`), never fetched. The ordered list of selected paths is stored on the job row (`state.selected_paths`) so later batches can resume.
3. **Fetch in batches, scan and redact.** Files are fetched in batches of **25** in priority order (one batch per worker step, see below). The secret scanner runs on every fetched file. Matches become masked findings and are redacted from text that goes onward. Redacted text lives only in the job's temporary state until the analysis ends (D-6).
4. **Static detection.** Deterministic extractors produce signals: routes, webhooks, cron or scheduled jobs, queue consumers, email/Slack/Discord/Telegram SDK usage, database writes, CI workflows, env var names used in code (names only).
5. **AI analysis.** The model receives signals and redacted snippets inside delimiters and returns `RecommendationDraft[]` (section 7), validated by Zod. The model has no tools. Drafts referencing node types outside `node-catalog.md` are dropped, not failed. **Token budget: at most 120k input tokens per analysis prompt.** Files are included in priority order until the budget is hit; the rest are not sent and are counted as `files_skipped_budget`. One model call per analysis.
6. **Persist.** Save recommendations and findings. Delete all temporary text, including the job's `state` blob. Mark the analysis done.

**Generation** (one job per selected recommendation): AI produces a `FlowSpec` (section 7), validated against the catalog; the compiler builds n8n JSON; the validator checks it; the simulator runs the `TestSpec`; save the result. The AI never writes n8n JSON. **Token budget: at most 30k input tokens per generation prompt.** A FlowSpec that fails Zod or the FlowSpec rules, an n8n JSON that fails the validator, or a simulation with failing cases or incomplete branch coverage sends the job back to `ai` (`testing.md`), at most twice, so the **total cost cap is 3 model calls per flow**. After the third call (OQ-13 default): if the validator never passed, the flow is `failed` with `error_code = GENERATION_EXHAUSTED`; if the validator passed but the simulation still fails, the flow is `ready` at level **Valid** with the last test run stored as `passed = false` so the failures are visible (`testing.md`, "never hidden").

### Background jobs (chunked state machine, Supabase only)
Supabase Edge Functions have a short wall-clock limit, so one invocation can never fetch 400 files and call the model. Every long job is a row in `jobs` (section 5) and runs as a resumable state machine. **One worker invocation does at most one step or one batch**, writes progress to the job row, and reschedules itself. No third-party queue.

- Analysis steps (`jobs.step`): `validate` → `select` → `fetch:N` (N = batch index, 25 files per batch, repeated until all selected files are fetched) → `scan` → `detect` → `ai` → `persist`. Validation failure ends the job at `validate` with analysis status `rejected` and `error_code = PROJECT_INVALID`; the project gets `status = invalid`, `invalid_reason`. On success `validate` sets the project `status = valid`, `detected_kind`, `last_commit_sha = <head sha>`, `stale = false`, and `analyses.commit_sha`.
- Generation steps: `ai` → `compile` → `validate` → `simulate` → `persist`. A failed `validate` or `simulate` goes back to `ai` and increments `state.model_calls` (max 3 in total, above; this counter is separate from `jobs.attempts`).
- **Per-step time budget: 20 seconds.** The `ai` step may take up to 60 seconds (one model call). A step that exceeds its budget aborts and the job is retried from the same step (the step must be idempotent).
- Progress: each step updates `jobs.step`, `jobs.state` (jsonb: selected paths, batch cursor, counts, redacted snippets while needed), `jobs.updated_at`, and the `analyses.progress` / `analyses.status` the user sees. Status mapping: `validate` → `validating`; `select`/`fetch`/`scan` → `scanning`; `detect`/`ai`/`persist` → `analyzing`. `progress` is an integer 0..100 that never decreases: `validate` 5, `select` 10, `fetch:N` spread evenly from 10 to 60, `scan` 65, `detect` 70, `ai` 75, `persist` 100. Generation jobs update `flows.status` only (`generating` → `ready` | `failed`).
- Scheduling: a `pg_cron` job runs every 10 seconds and invokes the worker Edge Function over HTTP (`pg_net`) with a service-role bearer token; the worker claims one job (section 5), executes one step, and if the job is not finished calls itself once more immediately (self-call) so the cron tick is only a safety net. The `POST .../analyze` and `.../generate` handlers insert the job row and trigger one worker call directly so the first step starts without waiting for the tick.
- Only the worker (service role) reads or writes `jobs.state`. The user-facing `GET /api/analyses/:id` reads only `analyses`.

## 5. Data model (Supabase, RLS on every table)
- `profiles(id → auth.users, display_name, created_at, updated_at)` — row created by the `auth.users` insert trigger (Phase 0); `display_name` 1..80 chars after trim or null
- `github_installations(id, user_id, installation_id bigint, account_login, created_at)` — `unique (user_id, installation_id)`: several Flow Motion users may link the same org installation, each proven through their own `GET /user/installations` check (section 6); `installation.deleted` removes every row with that `installation_id`
- `projects(id, user_id, installation_id nullable → github_installations, repo_full_name, default_branch, status[pending|valid|invalid], invalid_reason, detected_kind[website|app], last_commit_sha, stale, created_at)` — `unique (user_id, repo_full_name)`; the `installation_id` foreign key is the one exception to the cascade rule below: `on delete set null`, so `installation_id` becomes null when the GitHub installation is removed (webhook `installation.deleted`) or disconnected in `/settings`; the UI then asks the user to reconnect GitHub before analyzing
- `analyses(id, project_id, user_id, status[queued|validating|scanning|analyzing|done|failed|rejected], progress, commit_sha, files_considered, files_read, files_blocked, files_blocked_by_reason jsonb, files_skipped_budget, error_code, started_at, finished_at)` — `files_blocked_by_reason` is `{ denied, extension, size }` counts; `files_skipped_budget` counts files selected but not sent to the model because of the token budget (section 4)
- `jobs(id, user_id, kind[analyze|generate], ref_id, status[queued|running|done|failed], step, state jsonb, attempts, max_attempts, run_after, locked_at, locked_by, last_error_code, created_at, updated_at)` — `ref_id` is the `analyses.id` or `flows.id`; `step` and `state` are the state machine cursor (section 4). `max_attempts` defaults to 5. `state` is cleared on `done` and `failed` so no repo text outlives the job.
- `security_findings(id, analysis_id, user_id, category, severity, file_path, line, masked_evidence, remediation)` — never raw secrets
- `recommendations(id, analysis_id, user_id, title, description, trigger_kind, confidence, source_files text[], required_credentials text[], risk_level, estimated_tokens, status[new|selected|generated])`
- `flows(id, user_id, recommendation_id, name, flow_spec jsonb, n8n_json jsonb, setup_checklist jsonb, catalog_version, n8n_version, status[generating|ready|failed], error_code, created_at)` — `ready` means the validator passed (level at least Valid); the generation `persist` step also writes one `flow_test_runs` row
- `flow_test_runs(id, flow_id, user_id, level[valid|simulated], passed, results jsonb, simulator_version, created_at)` — `level = simulated` only when `passed = true` with 100% branch coverage (`testing.md`)
- `usage_events(id, user_id, kind[analysis|generation], tokens_in, tokens_out, ref_id, created_at)` — log only, no limits; `ref_id` is the analysis or flow id
- `audit_log(id, user_id, action, ref, created_at)`
- `rate_limits(key primary key, window_start, count)` — Postgres-based limiter; no RLS policies (service role only); incremented through the function `rate_limit_hit(p_key text, p_limit int) returns boolean` (atomic upsert `count + 1`, returns `count <= p_limit`; the window is part of the key, section 6 and `security.md` section 5); rows older than 48 h are purged by the `pg_cron` tick added in Phase 2

Every foreign key (except `projects.installation_id`, above) is `on delete cascade`, so deleting a project removes its analyses, findings, recommendations, flows, and test runs (`security.md` section 3). `projects.(installation_id, user_id)` is a composite FK to `github_installations(id, user_id)` (`on delete set null (installation_id)`), so a project's installation must belong to the same user. `jobs.ref_id` has no FK, so `DELETE /api/projects/:id` calls the service-role-only function `delete_project(p_user_id, p_project_id) returns boolean` (false when the project is not the user's), which in one transaction locks the project and its jobs, deletes the jobs for its analyses and flows, then deletes the project (the cascade removes the rest), so a worker step cannot resurrect rows.

**RLS:** users can `select` rows where `user_id = auth.uid()`. Pipeline tables (`analyses`, `security_findings`, `recommendations`, `flows`, `flow_test_runs`, `jobs`) are written only by server code using the service role. On `jobs` the owner's `select` policy excludes the `state` column (expose it through a view or column grant, never to the client). The service role key is never imported in client code.

**Job claiming and retry:**
- Claim: in one transaction, `SELECT ... FROM jobs WHERE status = 'queued' AND run_after <= now() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`, then set `status = 'running'`, `locked_at = now()`, `locked_by = <worker invocation id>`, `attempts = attempts + 1`. Wrap this in a Postgres function (`claim_job()`) called by the worker.
- Stale lock: a `running` job with `locked_at` older than 2 minutes is treated as crashed and is re-queued by the next claim (same function).
- Retry and backoff: on a step error the worker sets `status = 'queued'`, `last_error_code`, and `run_after = now() + 30s * 2^(attempts - 1)` (30s, 60s, 120s, 240s). When `attempts >= max_attempts` the job becomes `failed` and the referenced analysis or flow is marked `failed` with the same `error_code`. Non-retryable errors (`PROJECT_INVALID`, `MODEL_OUTPUT_INVALID` for analysis, `GENERATION_EXHAUSTED`) end the job immediately without backoff.
- `attempts` counts tries of the **current step**. After a step succeeds the worker advances `step`, sets `status = 'queued'`, `run_after = now()`, `locked_at = null`, `attempts = 0`, and the next claim picks it up.

## 6. API (Next.js route handlers)
Envelope: `{ ok: true, data } | { ok: false, error: { code, message } }`. Every handler checks the session, validates input with Zod, and applies the rate limiter. **JSON keys are camelCase in every request and response** (database columns are snake_case; the backend maps at the boundary). Timestamps are ISO 8601 strings; ids are uuids unless stated. State-changing handlers (`POST`, `PATCH`, `DELETE`) reject requests whose `Origin` header is present and differs from the `APP_URL` origin with `403 FORBIDDEN` (CSRF guard; the webhook is exempt because it is verified by signature). Response DTOs (shared Zod schemas in `src/schemas/`):
```ts
Project = { id, repoFullName, defaultBranch, status: "pending" | "valid" | "invalid", invalidReason: string | null,
            detectedKind: "website" | "app" | null, lastCommitSha: string | null, stale: boolean,
            installationId: string | null /* github_installations.id */, createdAt }
Installation = { id /* github_installations.id, uuid */, installationId: number /* GitHub's id */, accountLogin: string, createdAt }
Repo = { fullName: string /* "owner/name" */, defaultBranch: string, private: boolean }
Profile = { id, email: string, displayName: string | null }
```
- `GET /api/profile` → `Profile` · `PATCH /api/profile { displayName: string }` (trimmed, 1..80 chars) → `Profile`
- `POST /api/auth/sign-out` → `{ signedOut: true }` (section 3)
- `POST /api/github/webhook` — verify signature; events handled: `push` to the default branch sets the project `stale = true` and `last_commit_sha` (no automatic AI spend); `installation.deleted` deletes the `github_installations` row (projects keep working read-only with `installation_id = null`). Other events are acknowledged and ignored.
- `GET /api/github/install` → generates a random 32-byte `state`, stores `<userId>.<state>` in an httpOnly, secure, `sameSite=lax` cookie `fm_gh_state` (max-age 10 minutes, single use), and redirects to `https://github.com/apps/<GITHUB_APP_SLUG>/installations/new?state=<state>`; no signing secret is needed because the cookie binds the state to the signed-in user in this browser (signed-out callers are redirected to `/login`)
- `GET /api/github/installations/callback` — receives `installation_id`, `setup_action`, `state`, `code`; checks the `fm_gh_state` cookie's user id against the session user and its state against `state` (both constant-time), exchanges `code` for a short-lived user token (`POST https://github.com/login/oauth/access_token` with `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET`), confirms the installation appears in `GET /user/installations` and takes `account.login` from it, discards the token, upserts `github_installations` on `(user_id, installation_id)`, writes `audit_log` `github.connect`, redirects to `/dashboard?connected=1`; any failure (including rate limiting) redirects to `/dashboard?error=github`, never JSON. The cookie is cleared on every outcome (`security.md` section 3). `setup_action=update` (repo selection changed on GitHub) follows the same path.
- `GET /api/github/installations` → `{ installations: Installation[] }` · `DELETE /api/github/installations/:id` → `{ deleted: true }` (disconnect: deletes the row, projects get `installationId = null`; the UI links to `https://github.com/settings/installations/<installationId>` so the user can also uninstall on GitHub) · `GET /api/github/installations/:id/repos?page=1` → `{ repos: Repo[], page: number, hasMore: boolean }` (`:id` is the uuid row; backend mints an installation token from the App private key and calls `GET /installation/repositories?per_page=100&page=N`)
- `GET /api/projects` → `{ projects: Project[] }` newest first · `POST /api/projects { repoFullName, installationId }` → `Project` with HTTP 201 (`installationId` is the `github_installations.id` row owned by the user; the repo must be covered by that installation: backend reads it with the installation token (`GET /repos/{owner}/{repo}`, source of `defaultBranch`) and also requires `GET /repos/{owner}/{repo}/installation` (App JWT) to return that same GitHub installation id, because installation tokens can read any public repo; otherwise `VALIDATION_ERROR` and no project is created; a duplicate `(user, repoFullName)` is `VALIDATION_ERROR` "This repository is already connected"; writes `audit_log` `project.create`) · `GET /api/projects/:id` → `Project & { analyses: { id, status, commitSha, startedAt, finishedAt }[] }` newest first · `DELETE /api/projects/:id` → `{ deleted: true }` (writes `audit_log` `project.delete`)
- `POST /api/projects/:id/analyze` → `{ analysisId }`; refused with `DAILY_CAP_REACHED` above the daily cap (below) and with `VALIDATION_ERROR` when `installation_id` is null or an analysis for the project is already `queued`..`analyzing`. Allowed on `invalid` projects (the user may have fixed the repo).
- `GET /api/analyses/:id` → `{ status, progress, validation, counts, errorCode }` where `validation = { kind: "website" | "app" | "invalid", reason: string | null } | null` (null until the `validate` step finishes; taken from the project row) and `counts = { filesConsidered, filesRead, filesBlocked, filesBlockedByReason: { denied, extension, size }, filesSkippedBudget }`. The UI must show skipped files grouped by reason (denied, extension, size, budget), because broad deny globs also block ordinary source files (`security.md` section 1).
- `GET /api/projects/:id/recommendations` · `GET /api/projects/:id/findings` — both from the project's latest `done` analysis; optional `?analysisId=` selects another one
- `POST /api/recommendations/generate { recommendationIds: string[], allowStale?: boolean }` → `{ flowIds }`; refused with `DAILY_CAP_REACHED` if the request would exceed the daily cap (counts each recommendation), and with `PROJECT_STALE_ANALYSIS` when a recommendation's analysis `commit_sha` differs from the project's `last_commit_sha` unless `allowStale` is true (the UI offers "Generate anyway" and "Re-analyze"). Sets each recommendation `status = selected`; `generated` once its flow is `ready`.
- `GET /api/flows/:id` → flow (including `status`, `error_code`, `n8n_version`, `importVerified`, section 8), FlowSpec, checklist, latest test run
- `POST /api/flows/:id/test` → `{ testRunId }` (re-runs the stored `TestSpec` in the simulator, no model call; `GET /api/flows/:id` returns the new run)
- `GET /api/flows/:id/export` → n8n JSON download; refused with `EXPORT_NOT_VALID` unless `flows.status = ready` (which implies at least Valid)

Long jobs run in the background as chunked `jobs` rows executed by a Supabase Edge Function worker (section 4, D-10). The client polls with TanStack Query.

**Daily caps (abuse protection, not billing):** per user per UTC day, at most **10 analyses** and **30 generations** (one per recommendation). Enforced server-side in the route handler through the `rate_limits` table (keys `daily:analyze:<user_id>:<yyyy-mm-dd>` and `daily:generate:<user_id>:<yyyy-mm-dd>`), before any job is queued. Error code `DAILY_CAP_REACHED`, HTTP 429, message states when the cap resets. This is not a plan limit and must not be presented as one (`subscription.md` is NOT READY).

**Error codes (stable strings) and HTTP status:** `UNAUTHORIZED` 401 · `FORBIDDEN` 403 (CSRF origin mismatch, bad webhook signature) · `NOT_FOUND` 404 · `VALIDATION_ERROR` 400 · `RATE_LIMITED` 429 · `DAILY_CAP_REACHED` 429 · `PROJECT_STALE_ANALYSIS` 409 · `EXPORT_NOT_VALID` 409 · `INTERNAL` 500. Job-level codes stored in `analyses.error_code` / `flows.error_code` (never an HTTP response on their own): `PROJECT_INVALID` (analysis `rejected`), `MODEL_OUTPUT_INVALID` (analysis model output fails to parse; one model call per analysis, so not retried, the user may analyze again), `GENERATION_EXHAUSTED`, `INTERNAL` (step retries exhausted).

## 7. FlowSpec (internal flow format)
```ts
FlowSpec = {
  version: 1,
  name: string,
  description: string,
  nodes: { key: string, nodeType: AllowedNodeType, label: string,
           params: Record<string, JsonValue>,   // validated by the node's Zod schema from the catalog
           sourceFiles?: string[] }[],
  edges: { from: string, to: string, output?: number, input?: number }[],   // output index for IF / Switch (default 0); input index for Merge (default 0)
  requiredCredentials: { type: string, usedBy: string[] }[],   // type = credential name from node-catalog.md ("Slack", "SMTP", ...)
  tests: TestSpec                                            // see testing.md
}
```
Rules (checked by Zod plus a rule pass in the generation `ai` step; a failure counts as a failed model call): keys unique; exactly one trigger; every edge references existing keys, with `output`/`input` below the node's catalog output/input count; every node reachable from the trigger; no cycles except through `splitInBatches`; at most 40 nodes; only catalog node types; params only contain fields the catalog allows; URLs `https`; no secrets; placeholders must look like `YOUR_APP_URL` and appear in the checklist; expressions only from the supported subset (`testing.md`). These are the same rules the static validator applies to the compiled JSON (`testing.md`), so a FlowSpec that passes compiles to a Valid export.

### RecommendationDraft (analysis model output)
Zod schema in `src/schemas/recommendation.ts`. The model returns `RecommendationDraft[]` (max 20).
```ts
RecommendationDraft = {
  title: string,                       // 3..80 chars, plain text
  description: string,                 // 10..600 chars, plain text
  trigger_kind: "webhook" | "schedule" | "manual",
  confidence: number,                  // 0..1
  source_files: string[],              // must be paths that were actually sent to the model
  required_credentials: string[],      // catalog credential names (for example "Slack", "SMTP")
  risk_level: "low" | "medium" | "high",
  node_types: AllowedNodeType[],       // every entry must be in the catalog allowlist
  rationale: string                    // plain text, 10..400 chars
}
```
Rules: a draft whose `node_types` contains an unknown or excluded type is **dropped** (logged as a count, not an error); a draft that fails the schema in any other way is also dropped; the analysis fails (`MODEL_OUTPUT_INVALID`) only if the whole array fails to parse. Zero surviving drafts is a `done` analysis with no recommendations (the UI shows an honest empty state), not a failure. `source_files` entries not in the sent set are removed from the draft. All strings are rendered as plain text, never HTML (`security.md` section 4). Surviving drafts become `recommendations` rows; `estimated_tokens` is computed by the backend, not the model.

## 8. n8n export format (compiler output)
```json
{ "name": "...",
  "nodes": [ { "id": "uuid", "name": "Unique Name", "type": "n8n-nodes-base.webhook",
               "typeVersion": 2, "position": [250, 300], "parameters": {} } ],
  "connections": { "Unique Name": { "main": [ [ { "node": "Next Name", "type": "main", "index": 0 } ] ] } },
  "settings": { "executionOrder": "v1" } }
```
- `type` and `typeVersion` come only from the generated catalog (`node-catalog.md`).
- Node `name` must be unique because `connections` are keyed by name.
- IF: output 0 is true, output 1 is false. Other multi-output nodes: meaning comes from catalog metadata.
- Positions are auto-laid-out left to right (about 220 px between columns).
- Credentials: never include ids or secrets. Placeholder format is open (OQ-6) until verified by the dev import test.
- The settings block, `typeVersion` values, and any top-level fields must be verified by importing into a real n8n. From Phase 3 this is done by the **dev-only / CI-only import test** (`n8n.md` section "Allowed now", D-9): a pinned n8n runs locally or in CI, every golden export from `tests/conformance/` is imported, and the test passes only if each opens with no errors. Exports carry an internal "unverified import" flag until that test passes for the pinned `n8n_version`; the flag is cleared when it passes and set again whenever the pin changes. Mechanism: the import test writes `tests/conformance/verified.json` (`{ n8nVersion, verifiedAt }`, committed); `importVerified = (verified.json.n8nVersion === pinned n8n version)` is computed by the backend and returned by `GET /api/flows/:id`; when false the export UI shows "Import into n8n x.y not yet verified" (plain notice, export still allowed). User-facing live testing stays NOT READY.

## 9. Folder structure
```
src/app/(marketing)/ (auth)/ (app)/    pages  [frontend]
src/app/api/**                         route handlers  [backend]
src/components/ui/ ...                 shadcn + shared UI  [frontend]
src/features/<feature>/                feature UI, hooks, queries  [frontend]
src/stores/                            Zustand (canvas/editor state only)  [frontend]
src/server/                            server-only code  [backend]
src/lib/github/ security/ analysis/ flowspec/ n8n-catalog/ compiler/ validator/ simulator/   [backend]
src/schemas/                           shared Zod schemas  [backend]
src/proxy.ts                           auth redirect middleware (Next.js 16 name)  [backend]
supabase/migrations/ functions/worker/ [backend]  the job worker Edge Function (D-10)
scripts/                               catalog generator, n8n import test  [backend]
tests/conformance/                     golden exports + verified.json  [backend]
docs/                                  [architect]
```
State rules: TanStack Query for server data; Zustand only for the canvas and editor UI state; react-hook-form + Zod for forms.
**Worker code sharing (OQ-16 default):** the Edge Function (Deno) imports the pipeline modules from `src/lib/**` and `src/schemas/**` through `supabase/functions/import_map.json`. Therefore `src/lib/{github,security,analysis,flowspec,n8n-catalog,compiler,validator,simulator}` and `src/schemas` must stay runtime-neutral: no `next/*`, no Node-only APIs (`fs`, `path`, `crypto` module), only `fetch` and Web Crypto; Supabase access through `@supabase/supabase-js`. `src/server/**` is Next.js-only and never imported by the worker.

## 10. Environment variable names (values never in the repo)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `GITHUB_APP_ID`, `GITHUB_APP_SLUG` (install URL), `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` (both only for the one-time installation ownership check, section 6), `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `ANALYSIS_MODEL` (used for both analysis and generation), `APP_URL`. Validated at startup by a Zod env schema; the app fails fast if any are missing.
The worker Edge Function needs `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `ANTHROPIC_API_KEY`, `ANALYSIS_MODEL` as Supabase function secrets (same names) plus the `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` that Supabase injects. The `pg_cron` tick reads the service-role token for `pg_net` from Supabase Vault (`vault.decrypted_secrets`, name `worker_token`), never from a migration file. Next.js route handlers trigger the worker at `<NEXT_PUBLIC_SUPABASE_URL>/functions/v1/worker` with `SUPABASE_SERVICE_ROLE_KEY` as bearer; no extra env name.
`GITHUB_APP_PRIVATE_KEY` holds the PEM with newlines escaped as `\n`; the loader restores them. **Test-only names (not in `.env.example`, never required):** `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY` point the RLS tests at a local `supabase start` stack; when any is unset those tests are skipped with a visible "skipped: no local Supabase" message, so build, typecheck, and the unit suite never need real values.

## 11. Phases
- **Phase 0 — Foundation (backend only):** scaffold Next.js, install the full stack, shadcn init, Supabase config, env schema, `.env.example`, lint/typecheck/test setup, baseline migration.
- **Phase 1 — Auth and shell:** backend: full schema (all tables in section 5, including `jobs`), RLS and RLS tests, `GET /api/auth/callback`, GitHub App connect (`/api/github/install`, installations callback, installations list, repos list, webhook with signature check handling `installation.deleted`), `/api/projects` CRUD, rate limiter table and helper. frontend: landing, login/signup, dashboard shell with repo picker and projects grid, `/settings`, design tokens, `/privacy` and `/terms` (simple static pages, honest wording: redacted snippets go to the AI provider, no source code is stored, data is deleted when a project is deleted).

### Phase 1 scope (confirmed 2026-11-10, architect)
Backend and frontend work in parallel from this list. Nothing here needs real env values to build, typecheck, lint, or run the unit tests. The frontend cannot log in until the owner fills `.env.local`, so it verifies UI with fixtures in tests (below).

**Backend (owns `src/app/api/**`, `src/server/**`, `src/lib/**`, `src/schemas/**`, `src/proxy.ts`, `supabase/**`):**
1. Migration `supabase/migrations/<ts>_phase1_schema.sql`: **all section 5 tables** (`github_installations`, `projects`, `analyses`, `jobs`, `security_findings`, `recommendations`, `flows`, `flow_test_runs`, `usage_events`, `audit_log`, `rate_limits`) with the enums, uniques, FK rules, and indexes on every `user_id` and FK column; RLS enabled on all; owner-only `select` policies (`(select auth.uid()) = user_id`); no client `insert`/`update`/`delete` policies on pipeline tables; on `jobs` a column grant that excludes `state`; `rate_limit_hit()` function (section 5); `claim_job()` is Phase 2.
2. RLS tests in `tests/rls/*.test.ts` (user A cannot read or write user B's rows, on every table; `anon` sees nothing; `jobs.state` is not selectable by the owner). They run only when the `SUPABASE_TEST_*` names (section 10) are set; otherwise skipped with a message. The backend confirms `supabase db reset` applies cleanly if a local stack is available (R0-7) and records it in `status.md`.
3. `src/server/http.ts` (`ok(data, status = 200)` / `fail(code, message, status)` returning the envelope), `src/server/auth.ts` (`requireUser()` → session user or `401`; Origin check for state-changing methods → `403 FORBIDDEN`), `src/server/rate-limit.ts` (`enforceRateLimit({ route, subject, limit })` using `rate_limit_hit`, `security.md` section 5 defaults; throws `RATE_LIMITED` 429), `src/server/audit.ts` (`audit(userId, action, ref)`).
4. `src/proxy.ts` with the rules in section 3; `GET /api/auth/callback`; `POST /api/auth/sign-out`; `GET` / `PATCH /api/profile`.
5. GitHub App: `src/lib/github/{app-jwt.ts,installation-token.ts,client.ts}` runtime-neutral (Web Crypto RS256, `fetch`, Zod on every GitHub response, D-12); `src/server/github/user-auth.ts` for the one-time code exchange (Next-only); routes `GET /api/github/install`, `GET /api/github/installations/callback`, `GET`/`DELETE /api/github/installations[/:id]`, `GET /api/github/installations/:id/repos`, `POST /api/github/webhook` (HMAC-SHA256 signature check with constant-time compare → `403 FORBIDDEN` on mismatch; handles `installation.deleted`; acknowledges everything else with `{ received: true }`; the `push` handler is Phase 2).
6. `GET` / `POST /api/projects`, `GET` / `DELETE /api/projects/:id` (section 6 shapes; `analyses` is an empty array in Phase 1 since nothing writes it yet).
7. Shared Zod schemas: `src/schemas/api.ts` (envelope, error codes), `src/schemas/project.ts`, `src/schemas/github.ts`, `src/schemas/profile.ts` exporting the DTO types in section 6 for the frontend to import.
8. Tests: envelope and `requireUser`, Origin check, rate limiter (with a fake `rate_limit_hit`), webhook signature (valid, invalid, missing), App JWT shape, GitHub response Zod parsing with recorded fixtures, callback state mismatch, RLS suite (skippable).

**Frontend (owns `src/app/**` except `api/`, `src/components/**`, `src/features/**`, `src/hooks/**`, `src/stores/**`, `src/styles/**`, `public/**`):**
1. Design tokens in `src/app/globals.css` (`design.md` palette mapped to the shadcn CSS variables), Geist plus Geist Mono in `layout.tsx` (R0-11), `src/app/providers.tsx` with the TanStack `QueryClientProvider`. Add shadcn components with `npx shadcn@latest add` as needed (expected: input, label, card, dialog, badge, skeleton, separator, sheet, dropdown-menu, alert); do not change the preset.
2. `(marketing)`: `/` with every section in `design.md` (hero, how-it-works scroll story with reduced-motion fallback, feature highlights, security, "Plans coming soon" with the exact copy in `design.md`, FAQ, footer), header with "Log in" / "Sign up"; `/privacy` and `/terms` static pages with the wording required in section 3 and `security.md` section 3.
3. `(auth)`: `/login` (email, password) and `/signup` (email, password min 8, optional display name 1..80 → `options.data.display_name`) with react-hook-form + Zod, calling `src/lib/supabase/client.ts`; after sign-up, go to `/dashboard` when a session is returned, otherwise show "Check your email to confirm your account"; sign-in errors show the generic "Invalid email or password".
4. `(app)` layout: sidebar per `design.md` (Dashboard, Settings, sign-out via `POST /api/auth/sign-out`), responsive (sheet on mobile).
5. `/dashboard`: projects grid of `Project` cards (status badge per `design.md` mapping, repo name, default branch, created date, link to `/projects/[projectId]`); empty state with the "Connect GitHub" CTA (a link to `/api/github/install`); "Add repository" dialog = repo picker (choose an `Installation`, list `Repo`s with "Load more" on `hasMore`, `POST /api/projects`); `?connected=1` / `?error=github` notices; "Recent flows" section showing the empty state "No flows yet" (flows API is Phase 3).
6. `/projects/[projectId]` shell: header (repo name, status badge, stale and reconnect notices), Delete project (confirm dialog, `DELETE`), Analyze button rendered disabled until Phase 2 wires it.
7. `/settings`: display name form (`PATCH /api/profile`), connected installations list with Disconnect (`DELETE /api/github/installations/:id`) and a "Manage on GitHub" link, nothing about plans.
8. Data layer: `src/features/<feature>/queries.ts` with TanStack Query hooks calling the real endpoints through one fetch wrapper (`src/features/api/client.ts`) that unwraps the envelope and throws typed errors; `src/features/<feature>/fixtures.ts` with sample `Project`, `Installation`, `Repo`, `Profile` objects (exact shapes in section 6) used by component tests. **No mock toggle in app code.** Until `status.md` says a piece is ready, the UI is verified with fixtures in tests; integration with the live API happens in the Phase 1 review.
9. Tests: form validation (login, signup, display name), dashboard loading / empty / error / populated states with fixtures, status badge mapping, repo picker pagination.

**Owner setup (outside the repo, before Phase 1 review):** fill `.env.local`; in Supabase Auth set Site URL to `APP_URL` and add `<APP_URL>/api/auth/callback` to the redirect URLs; create the GitHub App with permissions Contents: read and Metadata: read, events Installation and Push, Callback URL `<APP_URL>/api/github/installations/callback`, "Request user authorization (OAuth) during installation" enabled, Webhook URL `<APP_URL>/api/github/webhook` with `GITHUB_WEBHOOK_SECRET`.

- **Phase 2 — Analysis:** backend: path policy, secret scanner, validity check, chunked pipeline, job worker (claim, steps, retry), `analyze` / `analyses` / `recommendations` / `findings` endpoints, webhook `push` → stale, daily caps. frontend: project page, analysis page, analysis progress, skipped-files breakdown by reason, findings, recommendations list, stale and reconnect notices (mock data first).
- **Phase 3 — Flows:** backend: node catalog generator, FlowSpec, compiler, validator, generation job, `generate` / `flows` / `export` endpoints, **dev/CI n8n import test** for `tests/conformance/` (D-9; a script plus a CI job, not a user feature). frontend: React Flow canvas, node inspector, export UI, checklist, "import not yet verified" notice.
- **Phase 4 — Simulation:** backend: simulator, TestSpec, test API. frontend: test panel, badges.
- **Phase 5 — Hardening:** full security review, per-route rate limits tuned, audit log, error states, MFA enrolment (Supabase Auth TOTP) in `/settings`, landing polish, accessibility pass.
- **Later (NOT READY):** subscription, user-facing n8n live testing.

## 12. Definition of done for v1
A user can sign up, connect a repo, get a validity result, see masked findings and recommendations, generate flows, inspect nodes, run the simulation, and export JSON that passes the validator. Security review has no open high or medium items. No secret file content is ever read, stored, logged, or sent to the model.
