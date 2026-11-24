# n8n live testing — NOT READY (user-facing)

> ## ⛔ NOT READY — user-facing live testing
> Do not build, stub, or wire any user-facing feature that runs a user's flow in n8n, shows a "live test" option, or lets a customer touch an n8n instance operated by Flow Motion. Flow Motion tests flows for users with its own mock-data simulator (`testing.md`). Remove this banner only when the owner says so.

> ## ✅ Allowed now (from Phase 3): dev-only and CI-only import verification (D-9)
> The team may run a **pinned** n8n locally and in CI, import every golden export from `tests/conformance/`, and confirm each opens with no errors. This is internal tooling, never exposed to users, never deployed as part of the app, and uses no user credentials or user data. It exists because the export is the paid deliverable and must be proven to import. See `contract.md` section 8 and Phase 3 backend scope.

## Why user-facing live testing is parked
- n8n uses the Sustainable Use License. Running n8n on Flow Motion's servers **for customers** may be restricted. The owner plans to talk to n8n first (OQ-5). The owner must confirm the licence position before public launch; the dev/CI import test is a development-time use the team considers acceptable meanwhile, but OQ-5 stays open.
- The credential placeholder format in exports must be verified by a real import (OQ-6). The dev/CI import test is what verifies it.

## Dev/CI import test (allowed now, Phase 3 backend)
1. Pin one n8n version (OQ-7; default latest stable at the start of Phase 3). The same pin feeds the catalog generator (`node-catalog.md`).
2. Run n8n locally or in CI (Docker, pinned tag, no network egress needed, no user data). Any dev-only dependency or CI image needs a `docs/requests.md` entry.
3. Import every file in `tests/conformance/` through n8n's import (CLI or REST on the local instance) and assert: import succeeds, node count and connection count match the export, and no "unknown node" or parameter errors.
4. When the test passes for the pinned version, the internal "unverified import" flag is cleared (`contract.md` section 8). Any pin bump sets it again until the test is re-run.
   Phase 3a form (`contract.md` section 11, backend item 8): `scripts/n8n-import-test.mjs`, run by hand with `npm run test:n8n-import`, using the pinned Docker image or `npx n8n@<pin>` in a temporary user folder; nothing is added to `package.json`; it skips cleanly when no runner is available. The repo has no CI yet, so there is no CI job (OQ-25).
5. Record the verified settings block, `typeVersion` values, and credential placeholder format back into `contract.md` section 8 (resolves OQ-6).

## Plan for user-facing live testing, when the owner says so
1. Owner confirms the licence position with n8n and records it in `docs/decisions.md` (OQ-5).
2. Replay the same `TestSpec` fixtures in real n8n and compare the results with the simulator. Differences become simulator bug fixes.
3. Only then consider a user-facing "live test" feature, with sandboxing: no network egress, no user credentials, mock services only.

## Open questions
Licence answer from n8n (OQ-5, must be confirmed before public launch), which n8n version to pin (OQ-7), how credentials should appear in exported nodes (OQ-6, resolved by the dev import test).
