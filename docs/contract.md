> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Contract — Flow Motion v1

Single source of truth. Owned by the architect. Status: DRAFT v1.

## 1. Scope
**In v1:** landing page, auth, dashboard; connect GitHub repo (read-only GitHub App); project validity check; safe file reading; security findings; automation recommendations; generate flows from selected recommendations; node canvas with inspector; mock-data simulation; n8n JSON export plus setup checklist.
**Out of v1:** running flows for users, live n8n testing (`n8n.md`), subscription/billing/credit enforcement (`subscription.md`), team workspaces, non-GitHub sources, other export formats, Code nodes.

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
- Marketing: `/`
- Auth: `/login`, `/signup`, `/auth/callback`
- App (auth required): `/dashboard`, `/projects/[projectId]`, `/projects/[projectId]/analysis/[analysisId]`, `/flows/[flowId]`, `/settings`
- Middleware: unauthenticated users go to `/login`; authenticated users visiting `/login` go to `/dashboard`.

## 4. Analysis pipeline (backend)
1. **Validate project (no AI).** Fetch the file tree (paths only) through the GitHub API. Valid if there is a strong marker of a website or app: `package.json` with a web or app framework (next, react, vue, svelte, nuxt, astro, express, fastify, nest, hono, react-native), `index.html` with assets, Python (django, flask, fastapi), Ruby (rails), PHP (laravel), Flutter `pubspec.yaml`, or a Go/Java/.NET web framework. Invalid: empty, docs-only, dotfiles-only, data-only, single script, no source. Output `{ kind: "website" | "app" | "invalid", reason }`. Stop on invalid.
2. **Select files.** Apply the path policy from `security.md` (deny first, then extension allowlist, size cap 200 KB per file, at most 400 files, prioritised: routes, API handlers, jobs, webhooks, CI files, manifests, schema files, README). Blocked files are counted, never fetched.
3. **Scan and redact.** The secret scanner runs on every fetched file. Matches become masked findings and are redacted from text that goes onward.
4. **Static detection.** Deterministic extractors produce signals: routes, webhooks, cron or scheduled jobs, queue consumers, email/Slack/Discord/Telegram SDK usage, database writes, CI workflows, env var names used in code (names only).
5. **AI analysis.** The model receives signals and redacted snippets inside delimiters and returns `RecommendationDraft[]`, validated by Zod. The model has no tools. Drafts may only reference node types in `node-catalog.md`.
6. **Persist.** Save recommendations and findings. Discard all source text. Mark the analysis done.

**Generation** (one job per selected recommendation): AI produces a `FlowSpec` (section 7), validated against the catalog; the compiler builds n8n JSON; the validator checks it; the simulator runs the `TestSpec`; save the result. The AI never writes n8n JSON.

## 5. Data model (Supabase, RLS on every table)
- `profiles(id → auth.users, display_name, created_at)`
- `github_installations(id, user_id, installation_id, account_login, created_at)`
- `projects(id, user_id, installation_id, repo_full_name, default_branch, status[pending|valid|invalid], invalid_reason, detected_kind, last_commit_sha, stale, created_at)`
- `analyses(id, project_id, user_id, status[queued|validating|scanning|analyzing|done|failed|rejected], progress, commit_sha, files_considered, files_read, files_blocked, error_code, started_at, finished_at)`
- `security_findings(id, analysis_id, user_id, category, severity, file_path, line, masked_evidence, remediation)` — never raw secrets
- `recommendations(id, analysis_id, user_id, title, description, trigger_kind, confidence, source_files text[], required_credentials text[], risk_level, estimated_tokens, status[new|selected|generated])`
- `flows(id, user_id, recommendation_id, name, flow_spec jsonb, n8n_json jsonb, setup_checklist jsonb, catalog_version, n8n_version, status[generating|ready|failed], created_at)`
- `flow_test_runs(id, flow_id, user_id, level[valid|simulated], passed, results jsonb, simulator_version, created_at)`
- `usage_events(id, user_id, kind, tokens_in, tokens_out, ref_id, created_at)` — log only, no limits
- `audit_log(id, user_id, action, ref, created_at)`
- `rate_limits(key, window_start, count)` — Postgres-based limiter

**RLS:** users can `select` rows where `user_id = auth.uid()`. Pipeline tables (`analyses`, `security_findings`, `recommendations`, `flows`, `flow_test_runs`) are written only by server code using the service role. The service role key is never imported in client code.

## 6. API (Next.js route handlers)
Envelope: `{ ok: true, data } | { ok: false, error: { code, message } }`. Every handler checks the session, validates input with Zod, and applies the rate limiter.
- `POST /api/github/webhook` — verify signature; on push mark project `stale = true` (no automatic AI spend)
- `GET /api/github/installations/callback`
- `GET /api/projects` · `POST /api/projects { repoFullName, installationId }` · `GET /api/projects/:id` · `DELETE /api/projects/:id`
- `POST /api/projects/:id/analyze` → `{ analysisId }`
- `GET /api/analyses/:id` → `{ status, progress, validation, counts }`
- `GET /api/projects/:id/recommendations` · `GET /api/projects/:id/findings`
- `POST /api/recommendations/generate { recommendationIds: string[] }` → `{ flowIds }`
- `GET /api/flows/:id` → flow, FlowSpec, checklist, latest test run
- `POST /api/flows/:id/test` → `{ testRunId }`
- `GET /api/flows/:id/export` → n8n JSON download; refused unless level is at least Valid

Long jobs run in the background (DB-queued job plus Supabase Edge Function worker, see OQ-4). The client polls with TanStack Query.

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
- Credentials: never include ids or secrets. Placeholder format is open (OQ-6) until verified by an import test.
- The settings block and any top-level fields must be verified by importing into a real n8n (OQ-6, OQ-7). Until then, mark exports "unverified import" internally.

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
- **Phase 1 — Auth and shell:** backend: schema, RLS, auth, GitHub App connect. frontend: landing, login/signup, dashboard shell, design tokens.
- **Phase 2 — Analysis:** backend: path policy, secret scanner, validity check, pipeline, job runner. frontend: project page, analysis progress, findings, recommendations list (mock data first).
- **Phase 3 — Flows:** backend: node catalog generator, FlowSpec, compiler, validator, generation job. frontend: React Flow canvas, node inspector, export UI, checklist.
- **Phase 4 — Simulation:** backend: simulator, TestSpec, test API. frontend: test panel, badges.
- **Phase 5 — Hardening:** full security review, rate limits, audit log, error states, landing polish, accessibility pass.
- **Later (NOT READY):** subscription, n8n live testing.

## 12. Definition of done for v1
A user can sign up, connect a repo, get a validity result, see masked findings and recommendations, generate flows, inspect nodes, run the simulation, and export JSON that passes the validator. Security review has no open high or medium items. No secret file content is ever read, stored, logged, or sent to the model.
