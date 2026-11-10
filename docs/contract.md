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
- Auth: `/login`, `/signup`, `/auth/callback`
- App (auth required): `/dashboard`, `/projects/[projectId]`, `/projects/[projectId]/analysis/[analysisId]`, `/flows/[flowId]`, `/settings`
- Middleware: unauthenticated users go to `/login`; authenticated users visiting `/login` go to `/dashboard`.

## 4. Analysis pipeline (backend)
1. **Validate project (no AI).** Fetch the file tree (paths only) through the GitHub API. Valid if there is a strong marker of a website or app: `package.json` with a web or app framework (next, react, vue, svelte, nuxt, astro, express, fastify, nest, hono, react-native), `index.html` with assets, Python (django, flask, fastapi), Ruby (rails), PHP (laravel), Flutter `pubspec.yaml`, or a Go/Java/.NET web framework. Invalid: empty, docs-only, dotfiles-only, data-only, single script, no source. Output `{ kind: "website" | "app" | "invalid", reason }`. Stop on invalid.
2. **Select files.** Apply the path policy from `security.md` (deny first, then extension allowlist, size cap 200 KB per file, at most 400 files, prioritised: routes, API handlers, jobs, webhooks, CI files, manifests, schema files, README). Blocked files are counted by reason (`denied`, `extension`, `size`), never fetched. The ordered list of selected paths is stored on the job row (`state.selected_paths`) so later batches can resume.
3. **Fetch in batches, scan and redact.** Files are fetched in batches of **25** in priority order (one batch per worker step, see below). The secret scanner runs on every fetched file. Matches become masked findings and are redacted from text that goes onward. Redacted text lives only in the job's temporary state until the analysis ends (D-6).
4. **Static detection.** Deterministic extractors produce signals: routes, webhooks, cron or scheduled jobs, queue consumers, email/Slack/Discord/Telegram SDK usage, database writes, CI workflows, env var names used in code (names only).
5. **AI analysis.** The model receives signals and redacted snippets inside delimiters and returns `RecommendationDraft[]` (section 7), validated by Zod. The model has no tools. Drafts referencing node types outside `node-catalog.md` are dropped, not failed. **Token budget: at most 120k input tokens per analysis prompt.** Files are included in priority order until the budget is hit; the rest are not sent and are counted as `files_skipped_budget`. One model call per analysis.
6. **Persist.** Save recommendations and findings. Delete all temporary text, including the job's `state` blob. Mark the analysis done.

**Generation** (one job per selected recommendation): AI produces a `FlowSpec` (section 7), validated against the catalog; the compiler builds n8n JSON; the validator checks it; the simulator runs the `TestSpec`; save the result. The AI never writes n8n JSON. **Token budget: at most 30k input tokens per generation prompt.** If validation or the simulator fails, generation is retried at most twice (`testing.md`), so the **total cost cap is 3 model calls per flow**; after that the flow is `failed` with `error_code = GENERATION_EXHAUSTED`.

### Background jobs (chunked state machine, Supabase only)
Supabase Edge Functions have a short wall-clock limit, so one invocation can never fetch 400 files and call the model. Every long job is a row in `jobs` (section 5) and runs as a resumable state machine. **One worker invocation does at most one step or one batch**, writes progress to the job row, and reschedules itself. No third-party queue.

- Analysis steps (`jobs.step`): `validate` → `select` → `fetch:N` (N = batch index, 25 files per batch, repeated until all selected files are fetched) → `scan` → `detect` → `ai` → `persist`. Validation failure ends the job at `validate` with analysis status `rejected`.
- Generation steps: `ai` → `compile` → `validate` → `simulate` → `persist`. A failed `validate` or `simulate` goes back to `ai` and increments `state.model_calls` (max 3 in total, above; this counter is separate from `jobs.attempts`).
- **Per-step time budget: 20 seconds.** The `ai` step may take up to 60 seconds (one model call). A step that exceeds its budget aborts and the job is retried from the same step (the step must be idempotent).
- Progress: each step updates `jobs.step`, `jobs.state` (jsonb: selected paths, batch cursor, counts, redacted snippets while needed), `jobs.updated_at`, and the `analyses.progress` / `analyses.status` the user sees. Status mapping: `validate` → `validating`; `select`/`fetch`/`scan` → `scanning`; `detect`/`ai`/`persist` → `analyzing`.
- Scheduling: a `pg_cron` job runs every 10 seconds and invokes the worker Edge Function over HTTP (`pg_net`) with a service-role bearer token; the worker claims one job (section 5), executes one step, and if the job is not finished calls itself once more immediately (self-call) so the cron tick is only a safety net. The `POST .../analyze` and `.../generate` handlers insert the job row and trigger one worker call directly so the first step starts without waiting for the tick.
- Only the worker (service role) reads or writes `jobs.state`. The user-facing `GET /api/analyses/:id` reads only `analyses`.

## 5. Data model (Supabase, RLS on every table)
- `profiles(id → auth.users, display_name, created_at)`
- `github_installations(id, user_id, installation_id, account_login, created_at)`
- `projects(id, user_id, installation_id, repo_full_name, default_branch, status[pending|valid|invalid], invalid_reason, detected_kind, last_commit_sha, stale, created_at)`
- `analyses(id, project_id, user_id, status[queued|validating|scanning|analyzing|done|failed|rejected], progress, commit_sha, files_considered, files_read, files_blocked, files_blocked_by_reason jsonb, files_skipped_budget, error_code, started_at, finished_at)` — `files_blocked_by_reason` is `{ denied, extension, size }` counts; `files_skipped_budget` counts files selected but not sent to the model because of the token budget (section 4)
- `jobs(id, user_id, kind[analyze|generate], ref_id, status[queued|running|done|failed], step, state jsonb, attempts, max_attempts, run_after, locked_at, locked_by, last_error_code, created_at, updated_at)` — `ref_id` is the `analyses.id` or `flows.id`; `step` and `state` are the state machine cursor (section 4). `max_attempts` defaults to 5. `state` is cleared on `done` and `failed` so no repo text outlives the job.
- `security_findings(id, analysis_id, user_id, category, severity, file_path, line, masked_evidence, remediation)` — never raw secrets
- `recommendations(id, analysis_id, user_id, title, description, trigger_kind, confidence, source_files text[], required_credentials text[], risk_level, estimated_tokens, status[new|selected|generated])`
- `flows(id, user_id, recommendation_id, name, flow_spec jsonb, n8n_json jsonb, setup_checklist jsonb, catalog_version, n8n_version, status[generating|ready|failed], created_at)`
- `flow_test_runs(id, flow_id, user_id, level[valid|simulated], passed, results jsonb, simulator_version, created_at)`
- `usage_events(id, user_id, kind, tokens_in, tokens_out, ref_id, created_at)` — log only, no limits
- `audit_log(id, user_id, action, ref, created_at)`
- `rate_limits(key, window_start, count)` — Postgres-based limiter

**RLS:** users can `select` rows where `user_id = auth.uid()`. Pipeline tables (`analyses`, `security_findings`, `recommendations`, `flows`, `flow_test_runs`, `jobs`) are written only by server code using the service role. On `jobs` the owner's `select` policy excludes the `state` column (expose it through a view or column grant, never to the client). The service role key is never imported in client code.

**Job claiming and retry:**
- Claim: in one transaction, `SELECT ... FROM jobs WHERE status = 'queued' AND run_after <= now() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`, then set `status = 'running'`, `locked_at = now()`, `locked_by = <worker invocation id>`, `attempts = attempts + 1`. Wrap this in a Postgres function (`claim_job()`) called by the worker.
- Stale lock: a `running` job with `locked_at` older than 2 minutes is treated as crashed and is re-queued by the next claim (same function).
- Retry and backoff: on a step error the worker sets `status = 'queued'`, `last_error_code`, and `run_after = now() + 30s * 2^(attempts - 1)` (30s, 60s, 120s, 240s). When `attempts >= max_attempts` the job becomes `failed` and the referenced analysis or flow is marked `failed` with the same `error_code`. Non-retryable errors (invalid project, `DAILY_CAP_REACHED`, Zod failure on model output after the generation cost cap) fail immediately.
- `attempts` counts tries of the **current step**. After a step succeeds the worker advances `step`, sets `status = 'queued'`, `run_after = now()`, `locked_at = null`, `attempts = 0`, and the next claim picks it up.

## 6. API (Next.js route handlers)
Envelope: `{ ok: true, data } | { ok: false, error: { code, message } }`. Every handler checks the session, validates input with Zod, and applies the rate limiter.
- `POST /api/github/webhook` — verify signature; on push mark project `stale = true` (no automatic AI spend)
- `GET /api/github/installations/callback`
- `GET /api/projects` · `POST /api/projects { repoFullName, installationId }` · `GET /api/projects/:id` · `DELETE /api/projects/:id`
- `POST /api/projects/:id/analyze` → `{ analysisId }`; refused with `DAILY_CAP_REACHED` above the daily cap (below)
- `GET /api/analyses/:id` → `{ status, progress, validation, counts }` where `counts = { files_considered, files_read, files_blocked, files_blocked_by_reason: { denied, extension, size }, files_skipped_budget }`. The UI must show skipped files grouped by reason (denied, extension, size, budget), because broad deny globs also block ordinary source files (`security.md` section 1).
- `GET /api/projects/:id/recommendations` · `GET /api/projects/:id/findings`
- `POST /api/recommendations/generate { recommendationIds: string[] }` → `{ flowIds }`; refused with `DAILY_CAP_REACHED` if the request would exceed the daily cap (counts each recommendation)
- `GET /api/flows/:id` → flow, FlowSpec, checklist, latest test run
- `POST /api/flows/:id/test` → `{ testRunId }`
- `GET /api/flows/:id/export` → n8n JSON download; refused unless level is at least Valid

Long jobs run in the background as chunked `jobs` rows executed by a Supabase Edge Function worker (section 4, D-10). The client polls with TanStack Query.

**Daily caps (abuse protection, not billing):** per user per UTC day, at most **10 analyses** and **30 generations** (one per recommendation). Enforced server-side in the route handler through the `rate_limits` table (keys `daily:analyze:<user_id>:<yyyy-mm-dd>` and `daily:generate:<user_id>:<yyyy-mm-dd>`), before any job is queued. Error code `DAILY_CAP_REACHED`, HTTP 429, message states when the cap resets. This is not a plan limit and must not be presented as one (`subscription.md` is NOT READY).

**Error codes (stable strings):** `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMITED`, `DAILY_CAP_REACHED`, `PROJECT_INVALID`, `PROJECT_STALE_ANALYSIS`, `GENERATION_EXHAUSTED`, `EXPORT_NOT_VALID`, `INTERNAL`.

## 7. FlowSpec (internal flow format)
```ts
FlowSpec = {
  version: 1,
  name: string,
  description: string,
  nodes: { key: string, nodeType: AllowedNodeType, label: string,
           params: Record<string, JsonValue>,   // validated by the node's Zod schema from the catalog
           sourceFiles?: string[] }[],
  edges: { from: string, to: string, output?: number }[],   // output index for IF / Switch
  requiredCredentials: { type: string, usedBy: string[] }[],
  tests: TestSpec                                            // see testing.md
}
```
Rules: keys unique; exactly one trigger; every node reachable from the trigger; only catalog node types; params only contain fields the catalog allows; no secrets; placeholders must look like `YOUR_APP_URL` and appear in the checklist.

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
Rules: a draft whose `node_types` contains an unknown or excluded type is **dropped** (logged as a count, not an error); a draft that fails the schema in any other way is also dropped; the analysis fails only if the whole array fails to parse or zero drafts survive. `source_files` entries not in the sent set are removed from the draft. All strings are rendered as plain text, never HTML (`security.md` section 4). Surviving drafts become `recommendations` rows; `estimated_tokens` is computed by the backend, not the model.

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
- The settings block, `typeVersion` values, and any top-level fields must be verified by importing into a real n8n. From Phase 3 this is done by the **dev-only / CI-only import test** (`n8n.md` section "Allowed now", D-9): a pinned n8n runs locally or in CI, every golden export from `tests/conformance/` is imported, and the test passes only if each opens with no errors. Exports carry an internal "unverified import" flag until that test passes for the pinned `n8n_version`; the flag is cleared when it passes and set again whenever the pin changes. User-facing live testing stays NOT READY.

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
supabase/migrations/ functions/        [backend]
scripts/                               catalog generator etc.  [backend]
docs/                                  [architect]
```
State rules: TanStack Query for server data; Zustand only for the canvas and editor UI state; react-hook-form + Zod for forms.

## 10. Environment variable names (values never in the repo)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `ANALYSIS_MODEL`, `APP_URL`. Validated at startup by a Zod env schema; the app fails fast if any are missing.

## 11. Phases
- **Phase 0 — Foundation (backend only):** scaffold Next.js, install the full stack, shadcn init, Supabase config, env schema, `.env.example`, lint/typecheck/test setup, baseline migration.
- **Phase 1 — Auth and shell:** backend: schema (including `jobs`), RLS, auth, GitHub App connect. frontend: landing, login/signup, dashboard shell, design tokens, `/privacy` and `/terms` (simple static pages, honest wording: redacted snippets go to the AI provider, no source code is stored, data is deleted when a project is deleted).
- **Phase 2 — Analysis:** backend: path policy, secret scanner, validity check, chunked pipeline, job worker (claim, steps, retry), daily caps. frontend: project page, analysis progress, skipped-files breakdown by reason, findings, recommendations list (mock data first).
- **Phase 3 — Flows:** backend: node catalog generator, FlowSpec, compiler, validator, generation job, **dev/CI n8n import test** for `tests/conformance/` (D-9; a script plus a CI job, not a user feature). frontend: React Flow canvas, node inspector, export UI, checklist.
- **Phase 4 — Simulation:** backend: simulator, TestSpec, test API. frontend: test panel, badges.
- **Phase 5 — Hardening:** full security review, rate limits, audit log, error states, landing polish, accessibility pass.
- **Later (NOT READY):** subscription, user-facing n8n live testing.

## 12. Definition of done for v1
A user can sign up, connect a repo, get a validity result, see masked findings and recommendations, generate flows, inspect nodes, run the simulation, and export JSON that passes the validator. Security review has no open high or medium items. No secret file content is ever read, stored, logged, or sent to the model.
