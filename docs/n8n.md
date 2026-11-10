# n8n live testing — NOT READY

> ## ⛔ NOT READY
> Do not build, stub, or wire anything in this file. Flow Motion tests flows today with its own mock-data simulator (`testing.md`). Remove this banner only when the owner says so.

## Why it is parked
- n8n uses the Sustainable Use License. Running n8n on Flow Motion's servers for customers may be restricted. The owner plans to talk to n8n first.
- The credential placeholder format in exports must be verified by a real import (OQ-6).

## Plan, when ready
1. Owner confirms the license position with n8n and records it in `docs/decisions.md`.
2. Run a pinned n8n instance for the team's own development and CI only. Import every golden export from `tests/conformance/` and confirm it opens with no errors.
3. Replay the same `TestSpec` fixtures in real n8n and compare the results with the simulator. Differences become simulator bug fixes.
4. Verify the settings block, `typeVersion` values, and credential placeholder format. Update `contract.md` section 8.
5. Only then consider a user-facing "live test" feature, with sandboxing: no network egress, no user credentials, mock services only.

## Open questions
License answer from n8n, which n8n version to pin, how credentials should appear in exported nodes.
