# Terminal X fixtures

## REAL pages (saved 25.10.2026, logged out)

Saved as `document.documentElement.outerHTML` of the rendered page (after React hydration), so they show the DOM the
extension sees, not the raw server response. Personal identifiers of the capturing browser (ad and tracking ids) were
replaced with `SCRUBBED_*`. The only e-mail address left is the public support@terminalx.com. Full notes and the exact
source URLs: `docs/10-phase0-findings.md`. Total size about 42 MB, so keep new real pages to what a test needs.

| File | Source | Purpose |
| --- | --- | --- |
| `product-*-<SKU>.html` (20 files) | `https://www.terminalx.com/product/<SKU>` | Women, men, kids, beauty, home, sport and sale products. The SKU is in the file name |
| `category-women-shirts.html` | `/women/tops/shirts` | Listing page, 24 cards |
| `category-men-tshirts.html` | `/men/shirts/tshirts` | Listing page, 24 cards |
| `category-search-shirt.html` | `/catalogsearch/result/?q=חולצה` | Search results, 24 cards |
| `order-confirmation-sanitized.eml` | A real order confirmation of 18.10.2026 | Recipient, address, phone, order number and tracking links scrubbed. **Not evidence of a DKIM signature**: any edit breaks the body hash. The checks on the original are in the findings |
| `orders-list-response-sanitized.json` | The "my orders" list response | Shape only: no SKUs, no variants, no delivery date. Order numbers, names, tokens and invoice PDFs scrubbed |

Tests: `packages/adapters/terminalx/src/real-pages.test.ts`.

## SYNTHETIC pages (written by hand)

Small files that exercise the detection rules in situations real pages do not offer on demand. They are **not** copies of
terminalx.com. Each starts with a `FIXTURE (synthetic)` comment.

| File | Purpose |
| --- | --- |
| `product-all-signals.html` | URL SKU confirmed by canonical, og:image and JSON-LD |
| `product-no-signals.html` | A page with no confirming signal: expect medium confidence |
| `product-conflict.html` | Canonical and JSON-LD both point at another SKU: expect the majority to win and a conflict flag |
| `not-a-product.html` | A category page: nothing to detect |

Fixtures are test data only and are never shown in the product.
