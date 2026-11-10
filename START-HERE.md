> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# START-HERE.md — how to use this pack

## 1. Setup (you, once)
1. Create the project folder and copy this pack into it (keep the `.claude/` and `docs/` folders).
2. `git init` and make a first commit.
3. Create a Supabase project and a GitHub App (read-only: Contents + Metadata). Put values in `.env.local` yourself. Never paste secrets into the chat.
4. Install Claude Code, open the project folder, run `claude`.

## 2. First prompt (review the plan before building)
```
Use the architect subagent. Read AGENTS.md and every file in docs/. Check them for gaps,
contradictions, or anything unclear. Fix what you can in docs/, put the rest in
docs/open-questions.md with a recommended default, and give me a short summary.
Do not write application code.
```
Read the summary, answer the open questions, then continue.

## 3. Phase prompts
Run one phase at a time. Template:
```
Run Phase N from docs/contract.md following CLAUDE.md. Architect first, then backend and
frontend in parallel in a single step, then code-reviewer (plus security-reviewer if the
phase is 2 to 5). Fix findings, update docs/status.md, and commit.
```
Phase 0 is different:
```
Run Phase 0 from docs/contract.md. Use only the backend subagent to scaffold the app
and install the full stack. Then run code-reviewer and commit.
```

## 4. Checks between phases
- `docs/status.md` shows the phase done and no open high or medium findings.
- The app runs locally. Try the new feature yourself.
- Read `docs/requests.md` and `docs/open-questions.md` for anything waiting on you.

## 5. Not ready yet
`docs/subscription.md` and `docs/n8n.md` are deliberately not built. Do not ask Claude to build them until you remove the NOT READY banners.
