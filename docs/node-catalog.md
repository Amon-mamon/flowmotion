> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Node catalog — allowed n8n nodes

Flow Motion may only use node types listed here. The catalog exists so exports always match what n8n expects.

## How the catalog is built
- `scripts/generate-node-catalog` reads the node definitions from **one pinned n8n version** and writes `src/lib/n8n-catalog/catalog.generated.json` (type, typeVersion, parameters, outputs). **Never hand-edit it.**
- `src/lib/n8n-catalog/allowlist.ts` holds the allowed type names below. The build fails if an allowed type is missing from the pinned version, or if the catalog and allowlist disagree.
- Each exported flow records `catalog_version` and `n8n_version`. The UI shows "Compatible with n8n x.y".
- Upgrading n8n: bump the pin, regenerate, run the compiler/validator/simulator tests, and (when ready, see `n8n.md`) re-run the import test. Never upgrade silently.
- Per-node Zod parameter schemas are derived from the generated catalog. FlowSpec params must pass them.
- The type names below were checked against n8n's core node reference. The generator is the final authority. If a name differs, fix this list.
- OQ-5 (license) must be settled before depending on n8n packages. Until then, extraction is a dev-time step and the generated JSON is the only artifact the app uses at runtime.

## Tier 1 — core nodes (no credentials, simulated fully)
| Type (`n8n-nodes-base.`) | Purpose |
|---|---|
| `manualTrigger` | Start by hand |
| `webhook` | HTTP trigger |
| `scheduleTrigger` | Cron or interval trigger |
| `respondToWebhook` | Reply to a webhook caller |
| `if` | Two-way branch (0 = true, 1 = false) |
| `switch` | Multi-way branch |
| `filter` | Keep matching items |
| `set` | Add or edit fields |
| `merge` | Combine branches |
| `splitInBatches` | Loop over items in batches |
| `splitOut` | Turn an array field into items |
| `aggregate` | Combine items into one |
| `sort` | Sort items |
| `limit` | Keep first or last N items |
| `removeDuplicates` | Deduplicate |
| `renameKeys` | Rename fields |
| `dateTime` | Date and time operations |
| `wait` | Pause (skipped in simulation) |
| `noOp` | Placeholder or join point |
| `stopAndError` | Fail on purpose with a message |

## Tier 2 — action nodes (need credentials, stubbed in simulation)
| Type (`n8n-nodes-base.`) | Purpose | Credential |
|---|---|---|
| `httpRequest` | Call the user's own API or any HTTP API | optional |
| `emailSend` | Send email over SMTP | SMTP |
| `slack` | Post messages | Slack |
| `discord` | Post messages | Discord |
| `telegram` | Send messages | Telegram |
| `gmail` | Send or read mail | Google |
| `googleSheets` | Read or append rows | Google |
| `notion` | Pages and databases | Notion |
| `airtable` | Records | Airtable |
| `github` | Issues, releases, files | GitHub |
| `postgres` | SQL queries | Postgres |
| `supabase` | Supabase rows | Supabase |

## Excluded in v1 (never generate)
`code`, `executeCommand`, `readWriteFile`, `ssh`, `ftp`, `executeWorkflow` and sub-workflow nodes, `errorTrigger`, `localFileTrigger`, all app trigger nodes (use `webhook` or `scheduleTrigger` instead), AI/LangChain nodes, n8n API nodes, community nodes. Reason: arbitrary code execution, local system access, references to things that do not exist after import, or no reliable way to simulate them.

## Mapping repo features to nodes (guidance for analysis)
- Cron job or scheduled task in code → `scheduleTrigger` then the steps it performs
- Webhook handler (payments, forms, third-party callbacks) → `webhook` plus `respondToWebhook`
- New signup or form submission → `webhook` → `set` → `slack` or `gmail`
- Notification code → `slack`, `discord`, `telegram`, `emailSend`
- Database writes or reports → `postgres` or `supabase` → `googleSheets` or `notion`
- Release or CI events → `webhook` → `github` or `slack`
- Calls to the project's own API → `httpRequest` with a `YOUR_APP_URL` placeholder

## Per-node simulation support
Each catalog entry has `simulation: "full" | "stubbed"`. Tier 1 is `full`. Tier 2 is `stubbed` (returns mock data, never calls out). A flow can reach the Simulated level only if every node is `full` or `stubbed` and every expression is in the supported subset (`testing.md`).
