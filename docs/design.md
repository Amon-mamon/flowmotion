> **NOT READY (do not build or stub):** `docs/subscription.md` (plans, billing, credits) and `docs/n8n.md` (live testing in real n8n). Both are planned for later. Everything else in this file applies now.

# Design — Flow Motion

Modern, bold, calm. **Not glassmorphism:** no backdrop blur, no translucent panels, no frosted cards. Solid surfaces with 1 px borders.

## Palette (only these)
| Token | Value | Use |
|---|---|---|
| `--background` | `#0A0A0A` | page background |
| `--surface` | `#141414` | cards, panels |
| `--surface-2` | `#1C1C1C` | hover, inputs |
| `--border` | `#2A2A2A` | borders |
| `--accent` | `#FF6B6B` (light red) | buttons, links, active states, edges |
| `--accent-strong` | `#FF8A8A` | hover |
| `--foreground` | `#FFFFFF` | text on dark surfaces |
| `--muted` | `#A3A3A3` | secondary text |
Only light red, black, and white (plus these neutral greys for depth). No other hues. Status uses shape and text, not extra colors: icon plus label for success, warning, error. Severity badges use outlined red styles with different icons and text.
**Contrast:** white on `#FF6B6B` is too low for small text. Buttons filled with the accent use **black text**. White text goes on black and dark surfaces. (Confirm with the owner: OQ-2.)

## Type and layout
- One clean sans family (for example Geist or Inter) plus a mono family for code and JSON. Large confident headings, generous spacing.
- 8 px spacing grid, 12 px radius on cards, 8 px on controls.
- Use shadcn/ui components themed through CSS variables. Do not hardcode colors in components.

## Landing page (`/`)
Hero (clear promise, one primary button) · how it works as a scroll story · feature highlights (repo scan, node flows, simulation, n8n export) · security section · "Plans coming soon" (no prices, no checkout; subscription is NOT READY) · FAQ · footer with links to `/privacy` and `/terms` (plain static pages, same tokens, no animation).
**Scroll animation:** Motion `useScroll` and `useTransform` with CSS perspective and 3D transforms (tilting, depth, stacking cards). Respect `prefers-reduced-motion` (replace with fades). No Three.js unless the owner asks (OQ-1). Keep it smooth on mobile.

## App
- Dashboard: sidebar, projects grid, empty state with a "Connect GitHub" call to action, recent flows.
- Project page: validity badge, Analyze button, progress, a "files skipped" summary grouped by reason (denied, extension, size, budget) from the analysis counts, findings (masked), recommendations as selectable cards (title, trigger type, confidence, required credentials, risk). A `DAILY_CAP_REACHED` error is shown as a plain notice with the reset time, never as a plan or upgrade prompt.
- Flow page: React Flow canvas (dark, grid dots, accent edges), node cards with icon and label, click a node to open an inspector drawer showing type, parameters (read-only in v1), required credential, source file, and notes. Right-hand or bottom test panel (see `testing.md`). Export button with the setup checklist.
- Every list has loading, empty, and error states.

## Accessibility
Visible focus rings (accent), full keyboard navigation including the canvas where possible, labels on all form fields (react-hook-form + Zod messages), sufficient contrast, reduced motion support, semantic headings.

## Tone
Direct and honest. Never overpromise: say "Simulated with mock data", not "guaranteed to work".
