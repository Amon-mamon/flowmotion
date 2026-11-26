> **MERGED 2026-11-27 (architect, D-55, D-56):** approved and merged into `docs/design.md` "Landing page" and `docs/contract.md` section 11 "Landing redesign". Those docs are the source of truth; this file is kept for history only.

# LANDING-DESIGN — landing page direction (proposal for owner approval, 2026-11-27)

**Status: proposal. Nothing is built from this until the owner approves.** After approval the architect merges the tokens into `docs/design.md` and the frontend builds the page.

**Direction:** vercel.com's look — minimal, sharp type, generous space, thin grid lines and borders, crisp product previews, restrained precise motion — in **Flow Motion's own colours**: near-black, white, and the coral-red accent.

**Basis:** the owner's reference (vercel.com), the existing tokens in `docs/design.md` and `src/app/globals.css`, and general knowledge of Vercel's public style. No design-library comparison was run (UXKIN is not connected), so this is not based on a fresh side-by-side review of real sites.

## Why this fits
- Flow Motion already uses **Geist** (Vercel's typeface), near-black surfaces, 1 px borders and a "no glass" rule. The landing page sharpens that system instead of replacing it.
- Vercel's style is almost monochrome with one strong accent. Flow Motion's rule is "light red, black and white only", which is the same idea.
- It reads as an engineering-grade tool that scales, which is the feeling the owner asked for.

## 1. Colour (unchanged brand, two additions)
| Token | Value | Role |
|---|---|---|
| `--fm-background` | `#0A0A0A` | page background |
| `--fm-surface` | `#141414` | product frames, cards, FAQ panels |
| `--fm-surface-2` | `#1C1C1C` | hover, code blocks |
| `--fm-border` | `#2A2A2A` | card and control borders |
| `--fm-accent` | `#FF6B6B` | primary buttons, links, active states, graph edges, the one glow |
| `--fm-accent-strong` | `#FF8A8A` | hover on accent |
| `--fm-foreground` | `#FFFFFF` | headings and body text |
| `--fm-muted` | `#A3A3A3` | secondary text (contrast about 8.6:1 on background) |
| **new** `--fm-grid` | `#161616` | hairline background grid and section dividers (decorative only, never text) |
| **new** `--fm-muted-2` | `#7A7A7A` | tertiary labels such as mono step numbers (about 4.6:1, passes 4.5:1) |

Rules: accent buttons use **black text** (white on coral fails contrast). No new hues. One soft radial glow of the accent at about 8% opacity, used **only** behind the hero product preview. No gradient text, no purple-blue gradients, no glass or blur.

## 2. Typography (Geist and Geist Mono)
| Step | Size / line height (desktop → mobile) | Weight | Use |
|---|---|---|---|
| Display | 72/76 → 44/48 | 600, tracking -0.04em | hero headline only |
| H2 | 48/52 → 32/36 | 600, tracking -0.03em | section headings |
| H3 | 24/32 → 20/28 | 600 | step and card titles |
| Lead | 20/30 → 18/28 | 400 | hero subline, section intros |
| Body | 16/26 | 400 | paragraphs (max 65 characters per line) |
| Small | 14/20 | 400–500 | captions, footer |
| Mono label | 12/16 Geist Mono, uppercase, tracking 0.08em | 500 | step numbers ("01 / CONNECT"), tags, code |

## 3. Spacing and layout
- 8 px grid, as today.
- Section padding: 128 px top and bottom on desktop, 80 px on mobile.
- Content width 1200 px; reading width 640 px; 16 px side gutter on phones.
- A faint 1 px background grid (`--fm-grid`) in the hero and security section; hairline dividers between sections instead of colour blocks.
- Layout variety: hero centred; every other section left-aligned or split (text left, visual right). No row of three identical cards.

## 4. Shape and depth
- Radius: 12 px cards and product frames, 8 px controls, full pill for small tags.
- No drop shadows. Depth comes from borders, surface steps and 3D perspective on the product previews.

## 5. Motion (Motion library, scroll-driven, restrained)
- Easing `cubic-bezier(0.16, 1, 0.3, 1)`; durations 200–600 ms; transform and opacity only (no layout animation), so it stays smooth on phones.
- **Hero:** the product frame (analysis view turning into a node graph) starts tilted (`rotateX` about 14°, slight scale-down) and flattens to 0° as the visitor scrolls, under CSS `perspective`.
- **How it works:** a pinned scroll story in four steps. Text steps scroll on the left, while the sticky visual on the right transforms: repo file tree → files marked safe or blocked with secrets masked → recommendation cards → node graph with coral edges drawing in.
- **Feature section:** cards rise slightly and lose a small tilt as they enter.
- **Reduced motion:** every transform becomes a simple opacity fade; the pinned story becomes four stacked static panels.
- **Mobile (under 768 px):** no pinning; each step is its own panel with a short fade.
- No Three.js (owner approval needed for a new dependency; CSS 3D covers this direction).

## 6. Page structure
1. **Header** (sticky, hairline bottom border): wordmark · How it works · Security · FAQ · Sign in (quiet) · **Get started** (accent).
2. **Hero:** headline, one-line subline, Get started + "See how it works" (secondary), then the tilted product frame over the faint grid with the single accent glow.
3. **Fact strip** (mono labels, real facts only): "Reads only safe files" · "Secrets masked before any AI call" · "32 supported n8n nodes" · "Exports n8n-ready JSON".
4. **How it works:** the four-step pinned story (Connect → Scan → Recommend → Generate and export).
5. **Features:** an uneven grid. One large card with a live node graph preview, plus smaller cards for masked security findings, an export JSON snippet (mono) and recommendation cards.
6. **Security:** split layout. Plain guarantees on the left (read-only access, deny list, no code execution, secrets never stored or sent), a small mono "masked finding" example on the right.
7. **Plans coming soon** (exact existing copy, unchanged).
8. **FAQ:** two-column accordion.
9. **Final call to action** band and footer (Privacy, Terms).

## 7. Components
- **Primary button:** accent fill, black text, 8 px radius; hover `--fm-accent-strong`; focus ring 2 px accent with 2 px offset; disabled 40% opacity.
- **Secondary button:** transparent, 1 px border at 20% white; hover `--fm-surface-2`.
- **Quiet link:** white or muted text with a small arrow that moves 2 px on hover.
- **Card:** `--fm-surface`, 1 px `--fm-border`, 12 px radius; hover border `#3A3A3A`.
- **Product frame:** card plus a slim top bar with three neutral dots and a mono path label, holding real app UI.
- **Tag:** pill, 1 px border, mono label.

## 8. Imagery and icons
- Product previews are **built from the app's real components with sample data**, not screenshots, so they stay sharp and match the theme exactly.
- Icons: Lucide only (already used in the app), 1.5 px stroke.
- No stock photos, no illustrations of people, no emoji, no fake customer logos or testimonials (there are no customers yet).

## Decisions for the owner
1. **Approve this direction**, or tell me what to change.
2. **Hero headline.** Proposal: "Turn your repository into working n8n automations." Subline: "Flow Motion reads your code safely, finds what to automate, and builds the workflows for you."
3. **Unbuilt features on the page:** flow generation (Phase 3b) and simulation (Phase 4) aren't built yet. Recommendation: show generation as the final step of the story with a small "Coming soon" tag until 3b ships, and leave simulation off the page for now.
