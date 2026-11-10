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
