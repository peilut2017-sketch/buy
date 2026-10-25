---
name: site-adapter
description: Procedure for adding a new store to SmartBuy or fixing a broken one — research on the live site, saving fixtures, writing the adapter and its server-side config, multi-signal product detection, variant/price/stock parsing, order and email parsing, tests, optional host permission and rollout. Use for any store-specific work (Terminal X, KSP, Amazon, ...).
---

# Store adapter procedure

Everything that knows about a specific store lives in `packages/adapters/<site-id>/` plus its row in `public.sites` (`adapter_config`). Core code never mentions a store by name. Read `docs/03-architecture.md` (interface `SiteAdapter`) and `docs/01-product-spec.md` sections 4, 5, 7 and 18 first.

## 1. Research (no code yet)

Fill the store's section in `docs/06-research-checklist.md`:

- Product URL pattern and where the SKU lives (path, query, data attribute).
- Every independent signal that confirms the SKU: canonical/og tags, JSON-LD `Product`, `dataLayer`, image path, internal JSON API, breadcrumbs.
- Parent/variant structure: how colour/size/other options appear and which one is selected.
- Price (regular vs sale), currency, stock per variant.
- Listing pages: card structure and SKU per card.
- SPA navigation: does the URL change without a page load?
- Orders page/API and confirmation email sender + DKIM domain (needs the owner's account).
- `robots.txt`, terms of use, CAPTCHA or bot protection. If something requires bypassing protection, stop and ask the owner — we do not do that.

Save fixtures to `tests/fixtures/<site-id>/` with personal data removed and a `README.md` stating date and source. Fixtures are test data only and must never be shown in the product.

## 2. Config (data, not code)

`adapter_config` is versioned JSON. Selectors and regexes go here so they can be fixed without a store release:

```jsonc
{
  "version": 3,
  "productUrl": "^/([a-z]\\d{4,9})$",
  "signals": {
    "canonical": { "selector": "link[rel=canonical]", "attr": "href", "skuRegex": "/([a-z]\\d{4,9})$" },
    "ogUrl":     { "selector": "meta[property='og:url']", "attr": "content", "skuRegex": "/([a-z]\\d{4,9})$" },
    "image":     { "selector": "img.product-image", "attr": "src", "skuRegex": "/([a-z]\\d{9})-\\d+\\." },
    "jsonLd":    { "type": "Product", "skuPath": "sku" }
  },
  "parentSku": { "fromSku": "^(.{6})" },
  "variants": { "groups": "[data-option-group]", "label": "[data-option-label]", "option": "[data-option]", "selected": "[aria-checked=true]" },
  "price": { "selector": "...", "saleSelector": "..." },
  "stock": { "selector": "..." },
  "listing": { "card": "...", "skuFrom": "a[href]" },
  "orders": { "endpoint": "...", "map": { "...": "..." } },
  "emailDomains": ["..."],
  "productType": "apparel"
}
```

The values above are placeholders showing the shape. Fill them from research, never from guesses. Ship the same config bundled in the extension as a fallback.

## 3. Code

- Implement `SiteAdapter` with pure functions over `Document` and config. No network calls in detection.
- `fetchOrders` runs in the background service worker with the user's cookies, only after consent, at most daily. It sends hashed order numbers, dates, SKUs and variants — nothing else.
- `parseConfirmationEmail` runs in the Email Worker after DKIM passes.
- Handle SPA navigation with a URL-change observer and re-run detection.

## 4. Tests

- Vitest: each fixture page → expected `Detection` (sku, parentSku, confidence, every signal), variants, price, stock.
- Include broken fixtures (signal missing, conflicting) to test the decision rules.
- Email fixtures: valid DKIM, plain forward (must be rejected), tampered body (must be rejected).
- Target: 100% correct detection on 20 real pages before enabling the site.

## 5. Rollout

1. Add the domain to `optional_host_permissions` in the manifest.
2. Insert the `sites` row with `status = 'beta'`.
3. Ship. Existing users see an offer to enable the store; nothing is disabled.
4. Watch the admin "stores" screen: detection rate, failures, price coverage.
5. Move to `active` when detection ≥ 99% over a week.

## Fixing a broken adapter

1. Check the admin "stores" screen and `detect_failed` events for which signal broke.
2. Save a fresh fixture of the broken page, add a failing test.
3. Fix the config first. Only change code if the config cannot express the fix.
4. Bump `adapter_version`, publish the config, confirm the detection rate recovers.
5. Use the per-store kill switch if detection is wrong (wrong product) rather than missing — wrong is worse than nothing.
