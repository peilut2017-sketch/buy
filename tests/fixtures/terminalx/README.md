# Terminal X fixtures — SYNTHETIC

These pages were written by hand to exercise the detection logic. **They are not copies of terminalx.com.**
Phase 0 research could not reach the live site (network policy), so nothing here proves the real page has
this structure. Each file starts with a `FIXTURE (synthetic)` comment.

Replace them with real saved pages (personal data removed) once phase 0 can run, and keep this README
updated with the date and source of each file. See `docs/06-research-checklist.md`.

Fixtures are test data only and are never shown in the product.

| File | Purpose |
| --- | --- |
| `product-all-signals.html` | URL SKU confirmed by canonical, og:url, og:image and JSON-LD |
| `product-no-signals.html` | A page with no confirming signal: expect medium confidence |
| `product-conflict.html` | Canonical and og:url both point at another SKU: expect the majority to win and a conflict flag |
| `not-a-product.html` | A category page: nothing to detect |
