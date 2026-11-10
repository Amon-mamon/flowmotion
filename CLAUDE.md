> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

@AGENTS.md

# CLAUDE.md — how the main Claude session coordinates

You are the coordinator. Subagents live in `.claude/agents/`: `architect`, `backend`, `frontend`, `security-reviewer`, `code-reviewer`. Subagents start with a fresh context and only know what you tell them plus the repo files, so each task you delegate must name the phase, the exact task, and the docs to read.

## Running a phase
1. Run `architect` first to confirm the phase scope in `docs/contract.md`. Wait for it.
2. Launch `backend` and `frontend` **in parallel, in a single step**, when the phase has work for both. Each only edits its own paths (see AGENTS.md). Phase 0 is backend only.
3. When both return, run `code-reviewer`. For phases 2, 3, 4, 5 also run `security-reviewer` in parallel with it.
4. Send each finding to the owning subagent to fix. Re-run the reviewer until no high or medium findings remain.
5. Update `docs/status.md` and make a git commit for the phase (`git add -A && git commit -m "phase N: ..."`). Never push.

## Rules for you
- Never run two subagents that edit the same path at the same time.
- Ask subagents to return a short summary (under 15 lines), not full file contents.
- If a subagent writes to `docs/requests.md`, deliver that request to the owning subagent in the next step.
- Do not build anything marked NOT READY (`docs/subscription.md`, `docs/n8n.md`).
- Do not read `.env*` files. If a subagent needs an environment value, ask the human.
- If something in the contract is ambiguous, ask the human once, then record the answer in `docs/decisions.md` via the architect.
