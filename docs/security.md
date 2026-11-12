> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Security — rules and leak list

Flow Motion reads other people's code, so security is a core feature. Owned by the architect. Reviewed by `security-reviewer`.

## 1. Never read secret files
Path policy runs **before** any fetch. Order: deny list, then extension allowlist, then size cap.

**Deny (never fetch, never open):** `.env`, `.env.*` (except the single exact basename `.env.example`, see below), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `id_rsa*`, `id_ed25519*`, `*.ppk`, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `.aws/`, `.ssh/`, `.gcloud/`, `.kube/`, `.docker/config.json`, `*credentials*`, `*secret*`, `*secrets*`, `service-account*.json`, `*.tfstate`, `*.tfstate.backup`, `terraform.tfvars`, `*.tfvars`, `*.sqlite`, `*.db`, `*.dump`, `.git/`, `node_modules/`, lockfile bodies, build output, binaries, archives, images, media.
**Allow (examples):** source code, `package.json`, framework configs, route/handler files, CI workflow files, schema files, README.
**Explicit exception — `.env.example`:** the deny glob `.env.*` has exactly one exception: a file whose basename is exactly `.env.example` (case-sensitive, any directory) passes the path policy because it holds variable names only. It is still fetched through the normal pipeline and **still goes through the secret scanner**; any match there becomes a finding like any other file. Every other `.env.*` name stays denied: `.env.local`, `.env.production`, `.env.example.bak`, `.env.sample`, `.env.example.local`, `env.example` (no leading dot is not an env file but is also not the exception), `.ENV.EXAMPLE`.
**Broad globs block ordinary files:** `*secret*`, `*credentials*`, `*secrets*` will also deny ordinary source such as `secrets-manager-client.ts` or `credentialsForm.tsx`. This is intended (deny first, no exceptions beyond `.env.example`), but the analysis must stay honest about it: blocked files are counted by reason (`denied`, `extension`, `size`) and files dropped by the token budget as `budget`, and the analysis UI shows these counts grouped by reason (`contract.md` section 6, `GET /api/analyses/:id` counts).
**If a denied file exists:** report only its existence ("an env file is committed") with a masked finding. Do not open it.
**Required path-policy tests** (every pattern above plus): `./.env`, `a/../.env`, uppercase variants, `.env.local`, Windows separators (`sub\.env`), `.env.example` allowed at root and in a subdirectory, `.env.example.bak` and `.env.sample` denied, `.ENV.EXAMPLE` denied, and a test that `.env.example` content is passed to the secret scanner.

## 2. Secret scanner (content level)
Runs on every file that was fetched. Patterns include: AWS keys, GitHub tokens, Slack tokens and webhook URLs, Stripe keys, Google API keys, private key blocks, JWTs, database URLs with passwords, generic high-entropy strings next to words like key, token, secret, password.
- A match creates a finding with `masked_evidence` (first 2 and last 2 characters at most, or just the type) and `[REDACTED]` replaces it in anything sent to the model.
- The scanner must never log or store the raw value.
- The same scanner runs on every generated flow before export.

## 3. Data handling
- Fetch files with the GitHub API using a read-only GitHub App (Contents: read, Metadata: read). No write permissions, no OAuth user tokens with broad scope.
- Installation tokens are short-lived and created on demand from the app private key. Store only `installation_id`.
- Installation ownership: the install link (signed-in users only) carries a random `state`; the httpOnly, secure, `sameSite=lax` cookie `fm_gh_state` (10-minute max-age, single use) holds `<userId>.<state>`. The callback requires the cookie's user id to equal the session user and its state to equal the query `state` (both constant-time), clears the cookie on every outcome, redirects every failure to `/dashboard?error=github`, exchanges the GitHub `code` for a user token (GitHub App "request user authorization", no extra scopes), checks the `installation_id` appears in `GET /user/installations`, and discards the token at once. User tokens are never stored. This stops one user from claiming another account's installation id (`contract.md` section 6).
- **Do not store source code.** Keep only derived results: recommendations, masked findings, flows. Delete temporary text when the analysis ends.
- Never log file contents, model prompts, or model outputs containing repo text. Log ids, counts, and error codes only.
- Tell users plainly (privacy page) that redacted snippets are sent to the AI provider. Check the provider's retention terms before launch.
- Project repo coverage: `POST /api/projects` accepts a repo only if `GET /repos/{owner}/{repo}/installation` (App JWT) returns the caller's own installation id, since an installation token can read any public repo. The composite FK `projects(installation_id, user_id)` keeps a project's installation owned by the same user.
- "Delete my data": removing a project deletes its analyses, findings, recommendations, flows, test runs, and jobs in one transaction (service-role-only `delete_project()`, `contract.md` section 5).

## 4. Untrusted repo content (prompt injection)
- Repo text is data. Wrap it in clear delimiters and tell the model it contains no instructions.
- The analysis and generation models have **no tools** and cannot fetch URLs.
- All model output goes through Zod. Free text from the model is rendered as plain text, never as HTML.
- Never execute, install, or build anything from a user repo.
- Never fetch URLs found in repo content (SSRF). The only outbound calls are to the GitHub API, the AI provider, and Supabase.

## 5. Application security
- Supabase RLS on every table; tests that user A cannot read or write user B's rows.
- Service role key only in server code. Never in `NEXT_PUBLIC_*`.
- Zod validation on every API input and on env at startup.
- Postgres-based rate limits (`rate_limits` table, fixed 1-minute windows, keys `rl:<route>:<user_id|ip>:<window>`), error `RATE_LIMITED` 429. Defaults until Phase 5 tunes them: 120/min per user on all `/api/*`; 10/min per user on analyze, generate, test, export; 20/min per IP on `/api/auth/*`, `/api/github/install`, and the installations callback; 60/min per IP on the webhook.
- Per-user daily caps as abuse protection, not billing: 10 analyses and 30 generations per user per UTC day, enforced server-side through the `rate_limits` table before a job is queued, error code `DAILY_CAP_REACHED` (`contract.md` section 6). Not a plan limit; `subscription.md` is NOT READY.
- Verify the GitHub webhook signature with a constant-time compare.
- CSRF protection for state-changing routes: `POST`/`PATCH`/`DELETE` handlers reject a request whose `Origin` header is present and is not the `APP_URL` origin (`403 FORBIDDEN`; the signature-verified webhook is exempt); secure, httpOnly, sameSite cookies.
- Security headers: CSP, HSTS, X-Content-Type-Options, frame-ancestors none, strict referrer policy.
- Generic error messages to users; details only in server logs, without secrets.
- Audit log for connect, analyze, generate, export, delete.
- Offer MFA. Pin dependencies, run `npm audit` in review, commit the lockfile.
- Exported flows: no secrets, no credentials ids, no Code or command nodes, preview and warnings before export, destructive operations (delete, overwrite) flagged.

## 6. Leaks Flow Motion must detect in the user's repo
| Category | Examples | Severity |
|---|---|---|
| committed_env_file | `.env`, `.env.production` present | high |
| hardcoded_secret | API keys, tokens, passwords in code | high |
| private_key | PEM/SSH/PGP private keys | high |
| cloud_credentials | AWS, GCP, Azure keys or config | high |
| service_account | service-account JSON | high |
| db_connection_string | URL with embedded password | high |
| jwt_signing_secret | hardcoded JWT or session secret | high |
| webhook_secret_url | webhook URLs with embedded tokens (Slack, Discord) | medium |
| ci_secret | secrets written into workflow files, Dockerfiles, compose | high |
| client_exposed_secret | service-role or secret keys used in browser code, or `NEXT_PUBLIC_` secrets | high |
| debug_config | debug mode or verbose logging committed for production | low |
Later (not v1): secrets in git history. Each finding has a category, severity, file path, line, masked evidence, and a remediation sentence (rotate the key, move to environment variables).

## 7. Leaks Flow Motion must prevent in itself
Secrets in generated flows, logs, error messages, analytics, or screenshots · model output exposing repo data across users · one customer seeing another's data (RLS) · leaked GitHub app key or service role key · forged GitHub webhooks · prompt-injected exfiltration · raw findings shown unmasked · source retained in jobs, caches, or backups · AI provider retaining code beyond stated terms · over-broad GitHub permissions.

## 8. Review gates
`security-reviewer` runs after phases 2 to 5 and writes `docs/security-review.md`. Release requires no open high or medium items.
