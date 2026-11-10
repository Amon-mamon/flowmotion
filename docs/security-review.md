> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Security review

Written by `security-reviewer`. Each finding: `file` · `risk` · `severity` (high/medium/low) · `owner` · `fix` · `status` (open/resolved).

Checklist per run: path policy tests, secret scanner tests, no secret content in logs or storage, RLS tests, service role key only on the server, input validation, webhook signature check, prompt-injection handling, export safety, dependency audit.

(no findings yet)
