> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Decisions

Format: `D-n [date] decision — reason`

- **D-1** Flow Motion generates and exports flows. It does not run them. — Avoids building a workflow engine.
- **D-2** The AI never writes n8n JSON. It writes a FlowSpec from the allowed catalog; our compiler writes the JSON. — Prevents format mismatches.
- **D-3** Allowed nodes come from a generated catalog pinned to one n8n version. — Exports must match n8n.
- **D-4** Testing is an in-house mock-data simulator with honest levels (Valid, Simulated). — Users want proof without live credentials; live n8n testing is parked.
- **D-5** GitHub only, read-only GitHub App. — Smallest permission surface.
- **D-6** No source code is stored; only derived results. — Privacy and security.
- **D-7** Subscription and n8n live testing are NOT READY. — Test the product first.
- **D-8** Stack: Next.js, Supabase, Zod, react-hook-form, TanStack Query, Zustand, shadcn/ui, Motion, React Flow. — Owner's choice plus React Flow for the canvas.
- **D-9** [2026-11-10] A dev-only and CI-only n8n import test is allowed from Phase 3: the team runs a pinned n8n locally or in CI, imports every golden export from `tests/conformance/`, and confirms it opens with no errors. User-facing live testing stays NOT READY. — The export is the paid deliverable and must be proven to import; this is internal tooling with no user data and no customer-facing n8n. OQ-5 (licence) stays open and the owner must confirm it before public launch.
- **D-10** [2026-11-10] Background jobs (resolves OQ-4): a `jobs` table plus a Supabase Edge Function worker, run as a chunked, resumable state machine. One worker invocation does at most one step or one 25-file batch, writes progress to the job row, and reschedules itself (`pg_cron` tick every 10 s plus an immediate self-call). Per-step budget 20 s (60 s for the model call). Claiming uses `FOR UPDATE SKIP LOCKED`; retries use exponential backoff up to 5 attempts per step. — Edge Functions have a short wall-clock limit, so one invocation cannot fetch 400 files and call the model; this keeps the design Supabase-only with no third-party queue.
