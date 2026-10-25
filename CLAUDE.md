# SmartBuy — project instructions for Claude Code

SmartBuy is a Chrome extension plus a companion website that adds trustworthy product reviews and price tracking to Israeli shopping sites. The first supported store is Terminal X (terminalx.com). KSP, Amazon and others come later, so everything store-specific lives in a per-site adapter from day one.

The owner (Nachoom) is a hands-on product owner who builds solo with Claude Code. **Talk to him in Hebrew.** Code, identifiers, commit messages and code comments are in English. All user-facing UI text is Hebrew, RTL.

## Read before working

| File | What it holds | Read when |
| --- | --- | --- |
| `docs/01-product-spec.md` | Full product spec: features, rules, numbers | Before any feature work |
| `docs/02-design-system.md` | Visual design system (Liquid Glass, grid, tokens) | Before any UI work |
| `docs/03-architecture.md` | Stack, components, data flow, permissions | Before any structural change |
| `docs/04-data-model.md` + `supabase/migrations/` | Database schema and RLS | Before touching data |
| `docs/05-roadmap.md` | Phases, tasks, acceptance criteria | To pick the next task |
| `docs/06-research-checklist.md` | Phase 0 facts to verify on the live site | Before writing adapter code |
| `docs/07-open-decisions.md` | Decisions still open | When a task depends on one |

Visual reference (owner's private links, open only if he shares access): sketch canvas `https://claude.ai/artifact/PSqzxhmBocwuEB47CdjnWa` (row "גרסה ג׳" is the chosen direction), planning doc `https://claude.ai/artifact/Dc1Bgon1DvXwTrk17HT3Cf`.

## Skills in this repo

Project skills live in `.claude/skills/`. Use them:

- `apple-liquid-glass` — materials, glass levels, contrast. Load for any UI surface.
- `frontend-design` — distinctive, non-templated visual design. Load for any new UI.
- `hebrew-rtl-ui` — RTL layout, Hebrew typography and copy rules. Load for any UI or copy.
- `site-adapter` — how to add or fix a store adapter. Load for any store-specific work.

## Hard rules

1. **Never fabricate data.** No fake reviews, prices, price history or stock in the product. Fixtures for tests live in `tests/fixtures/` and are clearly marked. Empty states are real states.
2. **Store-specific code only in adapters** (`packages/adapters/<site>/`). Core code never mentions a store by name.
3. **Detection rules are data.** Selectors and patterns ship from the server (`sites.adapter_config`), with a bundled fallback. Never ship remote *code* (Manifest V3 forbids it).
4. **Host permissions are optional.** Store domains go in `optional_host_permissions` and are requested at runtime. Adding a store must never disable the extension for existing users.
5. **Isolate injected UI** in a Shadow DOM root. The host page's CSS must not leak in, ours must not leak out.
6. **Quiet by default** ("לא חופר"): no unsolicited popups, one small strip on product pages, everything else on click. Respect daily notification caps, quiet hours and Shabbat mode.
7. **Privacy:** no browsing history, no IP in analytics, orders stored only as a hash of the order number plus SKU and variant. Price reports are not linked to users.
8. **Never show a success state before persistence succeeded** (saves, reviews, tracking).
9. **Accessibility:** keyboard operable, visible focus, accessible names on icon buttons, contrast ≥ 4.5:1 for text, never colour alone for state, respect `prefers-reduced-motion` and `prefers-reduced-transparency`.
10. Keep secrets out of the repo. Use `.env` files listed in `.gitignore`.

## Stack (proposed, confirm in phase 0)

- Extension: WXT + TypeScript + Preact, Manifest V3. Surfaces: content-script strip, Chrome side panel, popup, options page.
- Backend: Supabase (Postgres, Auth with Google, Edge Functions, RLS). Cloud vs the owner's self-hosted Supabase on Hetzner/Coolify is an open decision.
- Website (mobile + admin): the owner's usual stack, single-file HTML pages + Supabase JS, deployed on Cloudflare Pages.
- Email verification inbox: Cloudflare Email Routing + Email Worker (DKIM check).
- Notifications: Telegram bot (Edge Function webhook), email via a transactional provider, `chrome.notifications` in the extension.

## Repo layout (target)

```
apps/extension/        WXT project (entrypoints: content, sidepanel, popup, background, options)
apps/web/              mobile site + admin (single-file HTML pages)
packages/core/         shared types, detection engine, review/price logic (no store names)
packages/adapters/     one folder per store: config + parsers + tests
packages/ui/           design tokens and shared components
supabase/migrations/   SQL migrations
supabase/functions/    Edge Functions (telegram, notify, verify-order, scrape-watched)
workers/email-verify/  Cloudflare Email Worker
tests/fixtures/        saved HTML pages and emails for adapter tests (marked as fixtures)
docs/                  specs (source of truth)
```

## Working style

- Work phase by phase from `docs/05-roadmap.md`. Do not start a phase before the previous one's acceptance criteria pass.
- Phase 0 (research) comes before adapter code: verify on the live site, save fixtures, record findings in `docs/06-research-checklist.md`.
- Before UI work, write a short design plan (tokens, grid, states) and check it against `docs/02-design-system.md`.
- Inspect rendered UI, not only source: test on a light and a dark product page, long names, missing images, empty and error states.
- When a spec detail is missing or conflicts, ask the owner in Hebrew with a concrete recommendation, and record the answer in `docs/07-open-decisions.md`.
- Small, focused commits. Update the docs when behaviour changes.
