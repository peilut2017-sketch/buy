---
name: hebrew-rtl-ui
description: Rules for building Hebrew, right-to-left UI and writing Hebrew interface copy in SmartBuy — logical CSS properties, bidi handling of SKUs, prices and URLs, icon mirroring, typography, number formatting and the voice of the copy. Use for any UI component or any user-facing Hebrew text.
---

# Hebrew RTL UI and copy

All SmartBuy UI is Hebrew and right-to-left. RTL is built in from the first line, never patched afterwards.

## Layout

- Set `dir="rtl"` and `lang="he"` on every root: document, shadow root container, side panel, popup, emails.
- Use logical properties only: `margin-inline-start/end`, `padding-inline`, `inset-inline-start/end`, `border-inline-start`, `text-align: start`. A lint rule (the `stylelint-use-logical` plugin, or a grep in CI) should flag `left`/`right`, `margin-left` and friends in UI code.
- Flex and grid follow `dir` automatically; do not use `row-reverse` to "fix" RTL.
- Absolutely positioned elements (e.g. the size-fit meter dot) use `inset-inline-start` so "small" sits at the start (right).
- Horizontal scroll containers start at the right edge.

## Bidi: mixed Hebrew and Latin

- SKUs, URLs, emails, model names (`Minx Shorty IV`) inside Hebrew text: wrap in `<bdi>` or a span with `dir="ltr"`.
- Inputs for URLs, emails and SKUs: `dir="ltr"`, so typing starts at the left edge.
- Prices: `₪149.90` — shekel sign before the number, no space, `font-variant-numeric: tabular-nums`. Format with `Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' })` and check the output matches this.
- Percentages: `13%`. Ranges: use "עד" or a Hebrew word rather than an en dash between numbers when ambiguity is possible.
- Dates: relative for recent ("לפני שבועיים"), absolute as `23.10.2026` otherwise. Use `Intl.RelativeTimeFormat('he')` and verify the wording.

## Icons

- Mirror directional icons: back/forward arrows, chevrons in lists, "open in new tab" arrow direction, progress direction. Use `transform: scaleX(-1)` under `[dir=rtl]` or separate assets.
- Do not mirror: star, bell, check, search, close, gear, clock, brand marks, media play.

## Typography

- Font stack from tokens: system font (SF Hebrew on Apple), fallback Assistant.
- Hebrew needs slightly more line-height than Latin at the same size; keep the scale in `docs/02-design-system.md` (13/19 body).
- No ALL CAPS (Hebrew has no case anyway; do not uppercase Latin brand names either).
- Correct punctuation in UI text: gershayim `״` (U+05F4) in abbreviations — מק״ט, ש״ח; geresh `׳` (U+05F3) — ג׳קט. ASCII `"` and `'` only in code.
- Avoid letter-spacing on Hebrew.

## Copy voice

- Plain, warm and exact, like a knowledgeable friend. No marketing language ("חוויה מושלמת", "גלו").
- Address the user in plural or neutral forms to avoid gendering: "בדקו את החיבור", "אפשר לחפש", "כתיבת ביקורת". When a form is unavoidable, use a slash only as a last resort (ממליצ/ה).
- Buttons say the action as a noun of action and keep the same word through the flow: "שמירת מעקב" → "המעקב נשמר"; "פרסום ביקורת" → "הביקורת פורסמה"; "דיווח" → "הדיווח התקבל".
- Errors say what happened and what to do, without apologising: "הביקורות לא נטענו. בדקו את החיבור לאינטרנט ונסו שוב."
- Empty states invite an action: "עוד אין ביקורות על המוצר הזה. קנית אותו? הביקורת שלך תעזור לבאים אחריך."
- Never use English UI words when a common Hebrew one exists (מעקב, not tracking). Store and brand names stay as they are written.

## Review-specific strings

| Concept | Hebrew |
| --- | --- |
| Verified purchase | רכישה מאומתת |
| Pending verification | ממתין לאימות |
| Unverified | לא מאומת |
| Written N after purchase | נכתבה 3 שבועות אחרי הקנייה |
| Stages | התרשמות ראשונה / אחרי שימוש / שימוש ממושך |
| Self-reported purchase date | לפי דיווח הכותב |
| Update after time | עדכון אחרי 4 חודשים |
| Edited | נערך |
| Helpful | מועיל |
| Report | דיווח |
| Fit | קטן / מדויק / גדול |
| Reviewer levels | חדש / פעיל / מנוסה / מוביל |

## Checklist

- [ ] No physical left/right in CSS.
- [ ] Mixed-direction strings wrapped.
- [ ] Directional icons mirrored, others not.
- [ ] Numbers tabular, prices formatted, dates verified.
- [ ] Copy uses the vocabulary above and the same verb through each flow.
