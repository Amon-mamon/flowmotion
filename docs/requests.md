> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Requests between roles

Add a new entry at the bottom. The owner marks it done.

Format: `[from → to] [date] request` then `Status: open | done`

(no requests yet)

[backend → architect] 2026-11-10 Approve dependencies outside the AGENTS.md stack list, added in Phase 0 (all pinned exactly in package.json): runtime `server-only` 0.0.1 (guards server env/admin client), `@hookform/resolvers` 7.0.5 (react-hook-form + Zod bridge); shadcn v4 `init -d` runtime deps `@base-ui/react` 1.9.0 (shadcn v4 default preset "base-nova" is built on Base UI, not Radix), `class-variance-authority` 0.7.1, `cn` 0.5.2, `lucide-react` 1.71.0, `shadcn` 4.23.0 (globals.css imports `shadcn/tailwind.css`), `tw-animate-css` 1.4.0; dev `vitest` 5.1.0, `vite` 8.3.7, `@vitejs/plugin-react` 6.3.0, `happy-dom` 21.0.4 (jsdom 31 requires Node >= 22.22; owner runs 22.13), `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `@testing-library/jest-dom` 7.0.1, `supabase` 3.1.0 (CLI), `tailwindcss` 4.3.5 and `@tailwindcss/turbopack` 4.3.5 (Tailwind v4 wired through `turbopack.rules["*.css"]` in next.config.ts as create-next-app 16 scaffolds it; there is no postcss.config, so builds use Turbopack, not `--webpack`). `overrides` pins transitive `minimatch` to 11.0.5 under typescript-eslint and ts-morph to clear npm audit moderates; 3 low (deepmerge via the shadcn CLI code path, not used at runtime) remain.
Status: open
