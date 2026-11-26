> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Node catalog — allowed n8n nodes

Flow Motion may only use node types listed here. The catalog exists so exports always match what n8n expects.

## How the catalog is built
Three layers, each checked against the others by a test (Phase 3a, D-38; `contract.md` section 11):
1. **This file** (architect): the two type tables below are the human list of allowed nodes, and "FlowSpec parameters" is the contract for what each node may contain.
2. **`src/lib/n8n-catalog/allowlist.ts`** (backend, hand-written from the tables): the code allowlist. **No flow, draft, FlowSpec, or export may contain a node type outside it**; this is enforced three times: recommendation drafts (dropped), FlowSpec rule `F2`, validator rule 4.
3. **`src/lib/n8n-catalog/catalog.generated.json`** (generated, **never hand-edited**): `scripts/generate-node-catalog.mjs` (`npm run catalog:generate`) installs the pinned `n8n-nodes-base` into a temporary directory outside the repo and writes, for every allowlisted type at its default version: `typeVersion`, `displayName`, input and output counts, n8n credential type names, and the parameter definitions (name, type, option values, children). It fails if an allowlisted type is missing from the pinned package. `n8n-nodes-base` is never a dependency in `package.json` and is never imported by the app (OQ-5): the committed JSON is the only artifact used at runtime.

- **Pin:** `src/lib/n8n-catalog/version.ts` holds `N8N_VERSION` (the stable `n8n` release current when Phase 3a starts, OQ-7), `NODES_BASE_VERSION` (the `n8n-nodes-base` version that release depends on), and `CATALOG_VERSION` (`"<N8N_VERSION>+fm<n>"`, `n` bumped on any profile change). **Current (D-47):** `2.49.5` / `2.49.5` / `2.49.5+fm2` (fm2 from the Phase 3a review fixes). Every node uses the latest `typeVersion` in the pinned package (for example webhook 2.2).
- **Generated shape (D-47):** catalog `inputs` / `outputs` are `number | "dynamic"`. `"dynamic"` is what the static description holds where n8n computes the count from parameters (webhook and respondToWebhook outputs, switch outputs, merge inputs); the profile and the validator resolve those from parameters (switch: cases plus fallback; merge: `numberInputs`) and use 1 otherwise. The generator reads only the package's static `dist/types/nodes.json` (no package code runs) and merges property definitions that share a name and type.
- **Known limit (R3a-4, D-53, backlog):** the generator merges a node's properties across all of its versions and resources (display rules are dropped), so the catalog lists some parameters that are not valid at the pinned `typeVersion` (notion has both `databaseId` and `dataSourceId`). Validator rule 5 therefore also checks the validator's own parameter table (D-50, `security.md` section 9), and the import test plus one manual open of each golden is what proves the emitted names.
- **Node profiles** (`src/lib/n8n-catalog/profiles/`, hand-written, one per node): the strict Zod schema for the node's FlowSpec params (table below), the function that turns them into n8n parameters for the pinned `typeVersion`, the credential name, input and output counts, and the short reference text shown to the model. Flow Motion deliberately supports **one small, fixed set of operations per node**, not everything n8n offers; that keeps flows checkable and simulatable.
- **Consistency test (build gate):** the tables below, the allowlist, the generated catalog keys, and the profile index must list the same types; each profile's `typeVersion` must equal the catalog's; every n8n parameter name a profile emits must exist in the catalog's definitions for that node.
- Each exported flow records `catalog_version` and `n8n_version`. The UI shows "Compatible with n8n x.y".
- Upgrading n8n: bump the pin, regenerate, fix any profile the consistency test flags, run the compiler/validator/simulator tests, and re-run the dev import test (`n8n.md`, D-9); exports are "unverified import" until it passes for the new pin. Never upgrade silently.
- The type names below were checked against n8n's core node reference. The generator is the final authority. If a name differs, backend reports it in `requests.md` and the architect fixes this list.

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
| `merge` | Combine branches (two inputs, 0 and 1; FlowSpec edges set `input`) |
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

## FlowSpec parameters (Phase 3a, D-39)
What the model may put in `params` for each node. Schemas are strict (unknown keys fail). Types `Text`, `Value`, `Placeholder`, `FieldName`, `FieldPath`, `Ident` and the expression subset are defined in `contract.md` section 7 (no `://` in a `Text`, reserved names refused, D-49, D-51). `Condition = { left: Value, op: "equals" | "notEquals" | "contains" | "notContains" | "gt" | "gte" | "lt" | "lte" | "exists" | "notExists" | "isTrue" | "isFalse", right?: Value }` (`right` required except for the last four). `Pair = { name: FieldName, value: Value }`. `LiteralPair = { name: FieldName, value: Text without "{{" | number | boolean }` (D-52). The n8n-side structure each profile emits is the backend's, checked by the consistency test and the import test; accepted n8n-side differences are noted in the table (D-47).

| Node | `params` |
|---|---|
| `manualTrigger`, `noOp` | `{}` |
| `webhook` | `{ path: ^[a-z0-9][a-z0-9-]{0,63}$, method: "GET" \| "POST" \| "PUT" \| "PATCH" \| "DELETE", respond: "immediately" \| "respondNode" }` |
| `scheduleTrigger` | `{ cron: string }` (five space-separated fields of `[0-9*/,-]`, at most 60 chars) |
| `respondToWebhook` | `{ statusCode: integer 200..599, body: LiteralPair[0..20] }` (JSON response; literal values only, D-52 / OQ-29: n8n at the pin takes the body as one JSON text, so a runtime value could break it) |
| `if`, `filter` | `{ conditions: Condition[1..5], combine: "and" \| "or" }` (`if` outputs: 0 true, 1 false) |
| `switch` | `{ value: Value, cases: (string \| number)[1..6] (unique; strings are literal, no `{{`, D-47), fallback: boolean }` (output i = case i; fallback = the last output) |
| `set` | `{ fields: Pair[1..20], keepOtherFields: boolean }` |
| `merge` | `{ mode: "append" }` |
| `splitInBatches` | `{ batchSize: integer 1..100 }` (outputs: 0 done, 1 loop) |
| `splitOut` | `{ field: FieldPath }` |
| `aggregate` | `{ as: FieldName }` (all items into one list field) |
| `sort` | `{ by: { field: FieldPath, order: "asc" \| "desc" }[1..3] }` |
| `limit` | `{ maxItems: integer 1..1000, keep: "first" \| "last" }` |
| `removeDuplicates` | `{ fields: FieldPath[0..10] }` (empty = compare all fields) |
| `renameKeys` | `{ keys: { from: FieldPath, to: FieldName }[1..20] }` |
| `dateTime` | `{ operation: "now", as: FieldName }` or `{ operation: "format", value: Value, format: "yyyy-MM-dd" \| "yyyy-MM-dd HH:mm" \| "iso", as: FieldName }` |
| `wait` | `{ seconds: integer 1..3600 }` |
| `stopAndError` | `{ message: Text (1..200 chars) }` (0 outputs: no edge may leave it, D-47) |
| `httpRequest` | `{ method: "GET" \| "POST" \| "PUT" \| "PATCH" \| "DELETE", baseUrl: Placeholder (name ends in `_URL`), path: Text (starts with `/`), query?: Pair[0..10], headers?: Pair[0..10], jsonBody?: Pair[0..20] }`. Header names stay `FieldName` (no `-`, OQ-28) and are rejected when, lowercased, they equal `host`, `forwarded`, `te`, `connection`, `upgrade`, `expect`, or contain `auth`, `token`, `secret`, `key`, `cookie`, `session`, `password`, `passwd`, `signature` (D-51): authentication is added in n8n. |
| `emailSend` | `{ from: Placeholder, to: Placeholder, subject: Text, text: Text }` |
| `slack` | `{ channel: Placeholder, text: Text }` (post a message) |
| `discord` | `{ text: Text }` (post through the webhook credential) |
| `telegram` | `{ chatId: Placeholder, text: Text }` |
| `gmail` | `{ to: Placeholder, subject: Text, message: Text }` (send) |
| `googleSheets` | `{ operation: "append", documentId: Placeholder, sheetName: Placeholder, columns: Pair[1..20] }` or `{ operation: "read", documentId: Placeholder, sheetName: Placeholder }` |
| `notion` | `{ databaseId: Placeholder, title: Text }` (create a database page; at the pinned v3 the profile emits it as n8n `dataSourceId`, D-47, unproven until the import test) |
| `airtable` | `{ baseId: Placeholder, table: Placeholder, fields: Pair[1..20] }` (create a record) |
| `github` | `{ owner: Placeholder, repo: Placeholder, title: Text, body: Text }` (create an issue) |
| `postgres`, `supabase` | `{ operation: "insert", table: Ident, columns: { name: Ident, value: Value }[1..20] }` or `{ operation: "select", table: Ident, limit: integer 1..100 }`. Never raw SQL. |

Not offered in v1 (by design): deleting or overwriting data, raw SQL, file operations, reading mail, literal destinations (every address, channel, id, and host is a `YOUR_…` placeholder the user fills in after import).

## Per-node simulation support
Each node profile has `simulation: "full" | "stubbed"`, `inputs` (count, 2 for `merge`, else 1, 0 for triggers), `outputs` (count, 2 for `if`, N for `switch`, 2 for `splitInBatches`, 0 for `stopAndError`, else 1), and a default fixture for `stubbed` nodes. Tier 1 is `full`. Tier 2 is `stubbed` (returns mock data, never calls out). Every listed node is simulatable and the validator rejects expressions outside the supported subset, so every Valid flow can run in the simulator (`testing.md`).
