> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Status

Everyone appends one line per finished piece of work: `[role] [date] done / next / blockers`.

## Phases
| Phase | State |
|---|---|
| 0 Foundation | not started |
| 1 Auth and shell | not started |
| 2 Analysis | not started |
| 3 Flows | not started |
| 4 Simulation | not started |
| 5 Hardening | not started |
| Subscription | NOT READY |
| n8n live testing (user-facing) | NOT READY — dev/CI import test allowed from Phase 3 (D-9) |

## Readiness of pieces (backend updates, frontend reads)
| Piece | Ready for frontend? |
|---|---|
| Auth | no |
| GitHub connect | no |
| Analyze API | no |
| Recommendations API | no |
| Generate API | no |
| Flow and export API | no |
| Test API | no |

Until a piece says yes, the frontend uses mock data that matches `contract.md`.

## Log
(append below)
[architect] 2026-11-10 done: pre-phase gap pass / next: Phase 0 / blockers: owner to confirm OQ-5, OQ-12
