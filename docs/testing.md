> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Testing — mock-data simulation inside Flow Motion

Goal: show users a flow works before they export it, without calling real services and without running n8n. Live testing in real n8n is NOT READY (`n8n.md`).

## Levels
| Level | Meaning | Required checks |
|---|---|---|
| **Valid** | The file is structurally correct | Static validator passes |
| **Simulated** | The logic works on mock data | Valid + all test cases pass + 100% branch coverage + all nodes simulatable |
| Live | Works with the user's real services | Not offered. Users test it themselves |

Exports are blocked below Valid. Show the Simulated badge only when earned.
Required UI wording for Simulated: "Simulated with mock data in Flow Motion. Behavior with your real credentials and services may differ." Never use "guaranteed" or "works" without that qualifier.

## Static validator (produces Valid)
1. Workflow shape matches the expected n8n structure (Zod schema).
2. Node names unique; every connection points to an existing node.
3. Exactly one trigger; no orphan nodes; no cycles except `splitInBatches` loops.
4. Every `type` is in the allowlist and `typeVersion` equals the catalog's.
5. Every node's parameters pass its Zod schema from the catalog.
6. Expressions only use the supported subset.
7. No secrets: run the secret scanner on the whole output.
8. No excluded nodes. URLs must be `https`.
9. Every `YOUR_...` placeholder is listed in the setup checklist.
10. Size limit and node count limit (max 40 nodes).

## TestSpec
```ts
TestSpec = { cases: {
  name: string,
  trigger: { kind: "manual" | "webhook" | "schedule", payload: JsonValue },
  mocks: Record<nodeKey, JsonValue>,           // responses for tier-2 nodes
  expect: { reachedNodes: string[], notReachedNodes?: string[],
            outputs?: Record<nodeKey, JsonValue> }   // partial match
}[] }
```
Rules:
- At least one happy-path case, and one case per branch of every IF, Switch, and Filter.
- Branch coverage must be 100% for Simulated. Show a coverage report.
- Empty or trivial `expect` blocks are rejected.
- Fixtures use fake data only (`example.com`, made-up names). Never real-looking secrets or emails.
- The AI may draft the TestSpec, but the code validates and runs it. Failures are shown to the user, never hidden. A flow that fails its own tests is not shown as Simulated, and generation is retried at most twice.

## Simulator engine (`src/lib/simulator`)
- Executes the FlowSpec graph with n8n item semantics: arrays of `{ json }` items passed along connections.
- Tier 1 nodes: implemented in-house following the documented n8n behavior. Tier 2 nodes: return the matching `mocks` entry, or the catalog's default fixture. No network access at all. `wait` skips time. `scheduleTrigger` runs one tick.
- Expression subset: `{{ $json.field }}`, `{{ $json["field"] }}`, `{{ $node["Name"].json.field }}`, string and number literals, basic comparisons. Anything else makes the flow Valid only.
- Deterministic: same input gives same output. Limits: 5 s time, 1000 items, 2 MB output, no recursion beyond catalog loops.
- The simulator is our reimplementation, so it can differ from real n8n. That is why the badge says "Simulated". Keep a fixtures folder (`tests/conformance/`) so the same cases can be replayed in real n8n later (`n8n.md`).

## Required automated tests (backend)
Validator: one failing test per rule above. Compiler: golden-file tests per node type. Simulator: per-node behavior tests and branch coverage test. Secret scanner and path policy: see `security.md`.

## UI (frontend)
Test panel on the flow page: Run test button, per-case pass or fail, the path taken highlighted on the canvas, node-by-node input and output viewer, coverage summary, level badge, and the required wording.
