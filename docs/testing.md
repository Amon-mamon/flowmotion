> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Testing — mock-data simulation inside Flow Motion

Goal: show users a flow works before they export it, without calling real services and without running n8n. Live testing in real n8n is NOT READY (`n8n.md`).

## Levels
| Level | Meaning | Required checks |
|---|---|---|
| **Valid** | The file is structurally correct | Static validator passes |
| **Simulated** | The logic works on mock data | Valid + all test cases pass + 100% branch coverage (every catalog node is simulatable and the validator rejects unsupported expressions, so every Valid flow can be simulated) |
| Live | Works with the user's real services | Not offered. Users test it themselves |

Exports are blocked below Valid. Show the Simulated badge only when earned.
Required UI wording for Simulated: "Simulated with mock data in Flow Motion. Behavior with your real credentials and services may differ." Never use "guaranteed" or "works" without that qualifier.

## Static validator (produces Valid)
1. Workflow shape matches the expected n8n structure (Zod schema).
2. Node names unique; every connection points to an existing node; output and input indexes are below the catalog's output/input count for that node (IF has 2 outputs, Merge has 2 inputs).
3. Exactly one trigger; no orphan nodes; no cycles except `splitInBatches` loops.
4. Every `type` is in the allowlist and `typeVersion` equals the catalog's.
5. Every node's parameters pass its Zod schema from the catalog.
6. Expressions only use the supported subset: every string parameter that starts with `=` must be `=` followed by text in which each `{{ … }}` parses with the grammar in `contract.md` section 7; a string containing `{{` without the leading `=`, or a leading `=` with anything outside the grammar, fails.
7. No secrets: run the secret scanner on the whole output. No node has a `credentials` key.
8. No excluded nodes. No `http://` anywhere in a parameter string; an `httpRequest` URL must begin with a `YOUR_…_URL` placeholder (never a literal host or an expression); no forbidden auth header names (`node-catalog.md`).
9. Every `YOUR_...` placeholder is listed in the setup checklist.
10. Size limit (256 KB of JSON) and node count limit (max 40 nodes).
The same rules apply to the FlowSpec before compiling (`contract.md` section 7, rules `F1`..`F12`), so the validator is a second, independent check on the compiler output. It reads only the compiled JSON, the checklist, and the generated catalog (`validateWorkflow`, Phase 3a). Rule 5 at this level means: every top-level parameter name exists in the catalog's definitions for that node and version, and option-type parameters hold one of the catalog's option values.

**Phase 3 note:** Phase 3 produces the level **Valid** only. The `TestSpec` is drafted by the model and shape-checked (rule `F11`) and stored, but nothing executes it until Phase 4; no `flow_test_runs` row exists for Phase 3 flows, and the UI shows "Valid" with the wording in `design.md`.

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
- The AI may draft the TestSpec, but the code validates and runs it. Failures are shown to the user, never hidden. A flow that fails its own tests is not shown as Simulated, and generation is retried within the hard cap of 3 started model calls per flow (`contract.md` section 4, D-40). After the last call: validator never passed → flow `failed` with `GENERATION_EXHAUSTED`; validator passed but tests still fail → flow `ready` at level Valid with the failing run stored (`passed = false`) and shown in the test panel (OQ-13).
- `POST /api/flows/:id/test` re-runs the stored TestSpec; it never calls the model. Results are stored as a new `flow_test_runs` row.

## Simulator engine (`src/lib/simulator`)
- Executes the FlowSpec graph with n8n item semantics: arrays of `{ json }` items passed along connections.
- Tier 1 nodes: implemented in-house following the documented n8n behavior. Tier 2 nodes: return the matching `mocks` entry, or the catalog's default fixture. No network access at all. `wait` skips time. `scheduleTrigger` runs one tick.
- Expression subset: `{{ $json.field }}`, `{{ $json["field"] }}`, `{{ $node["Name"].json.field }}`, string and number literals, basic comparisons (exact grammar in `contract.md` section 7). Anything else is rejected by validator rule 6 (and the FlowSpec rules), so it never reaches the simulator.
- Deterministic: same input gives same output. Limits: 5 s time, 1000 items, 2 MB output, no recursion beyond catalog loops.
- The simulator is our reimplementation, so it can differ from real n8n. That is why the badge says "Simulated". Keep a fixtures folder (`tests/conformance/`) holding golden exports: from Phase 3 they are imported into a pinned n8n by the dev/CI import test (`n8n.md`, D-9), and later the same cases can be replayed there (user-facing live testing stays NOT READY).

## Required automated tests (backend)
Validator: one failing test per rule above. Compiler: golden-file tests per node type. Simulator: per-node behavior tests and branch coverage test. Secret scanner and path policy: see `security.md`.

## UI (frontend)
Test panel on the flow page: Run test button, per-case pass or fail, the path taken highlighted on the canvas, node-by-node input and output viewer, coverage summary, level badge, and the required wording.
