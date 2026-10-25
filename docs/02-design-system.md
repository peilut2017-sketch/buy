# מערכת העיצוב — SmartBuy

הקובץ בנוי משני חלקים:

1. **המפרט המקורי** של בעל המוצר, כמו שהוא. הוא הבסיס ומקור האמת.
2. **תוספת לפרויקט** (בסוף הקובץ): התאמות ל-RTL ועברית, טוקנים כ-CSS מוכן, הסטייה היחידה מהמפרט (ניגודיות כפתור), אלמנט החתימה, ומיפוי רמות החומר למשטחים.

כשיש סתירה בין החלקים, התוספת גוברת רק בנקודות שהיא מציינת במפורש.

---

## חלק 1: המפרט המקורי

SmartBuy — Visual Design System & Grid Specification

1. Design direction

Design SmartBuy as a premium browser-shopping companion inspired by Apple’s Liquid Glass material language and macOS interface craftsmanship.

The interface must feel native to the browser environment: quiet, precise, tactile, information-dense where necessary, and almost invisible when the user is not interacting with it.

The visual signature is muted translucent glass floating above a clean, unified content surface.

This is not a generic SaaS dashboard, not a glassmorphism showcase, and not a landing page. It is a compact utility that helps people make better purchasing decisions while browsing a real product page.

Priorities, in order:

1. Immediate readability and useful shopping information.
2. Consistent grid, alignment, spacing, and typography.
3. Restrained Liquid Glass for floating interface layers.
4. High-quality interaction feedback.
5. Visual character through precise details rather than decoration.

2. Before implementation

Read and apply these skills if installed:

* apple-liquid-glass
* frontend-design

Use Apple’s Human Interface Guidelines for material and contrast decisions.

Before changing code:

1. Inspect the existing SmartBuy extension, framework, component structure, and current styling.
2. Identify the actual extension surface: popup, side panel, injected product-page panel, or a combination.
3. Inventory the existing components and preserve working functionality.
4. Create a short design plan with tokens, grid, typography, surface hierarchy, and interaction states.
5. Implement the design system consistently across the existing surfaces.

Do not replace working application logic with a visual mockup. Do not fabricate review data, prices, price history, or availability.

3. Grid system

Use a consistent 4px base unit and an 8px primary spacing rhythm.

Spacing tokens:

* space-1: 4px
* space-2: 8px
* space-3: 12px
* space-4: 16px
* space-5: 20px
* space-6: 24px
* space-8: 32px
* space-10: 40px

Use these tokens instead of arbitrary margins and padding.

Main extension panel

* Use one consistent content column.
* Use 16px horizontal internal padding as the default.
* Use 12–16px between logically separate sections.
* Use 8–12px between related controls.
* Align section headings, body text, prices, and controls to a shared content edge.
* Use 1px separators to divide related rows within a unified surface.
* Avoid nesting multiple panels inside other panels unless the hierarchy genuinely requires it.

Width and sizing

* For a browser popup, respect the actual extension viewport and avoid horizontal scrolling.
* For a side panel or injected panel, use a stable width appropriate to the existing implementation and the surrounding webpage.
* Use min-width: 0 on flexible children.
* Allow long product names, merchant names, and review text to wrap or truncate intentionally.
* Never allow prices, buttons, or filter controls to overflow.
* Use a consistent spacing scale rather than percentages for small internal gaps.

Layout behavior

* Product information appears first.
* The main navigation follows the product identity.
* The active feature occupies the main content region.
* Secondary actions remain visually subordinate.
* Price tracking and review filters must not compete for the same visual priority.
* At narrower widths, collapse horizontal arrangements before reducing text to unreadable sizes.

4. Surface hierarchy

Use three deliberate material levels.

Level A — Base content surface

Used for reviews, product details, price-history information, and lists.

* Solid or nearly solid neutral background.
* No blur.
* No decorative gradient.
* No floating glass effect.
* Minimal separators and subtle grouping.
* Content should remain readable over any underlying webpage.

Level B — Floating glass surface

Used for the SmartBuy shell, floating navigation, popovers, and other elements that genuinely overlap the webpage.

Suggested starting values for a light theme:

* Background: rgba(248, 249, 252, 0.78)
* backdrop-filter: blur(24px) saturate(145%)
* Border: 1px solid rgba(255, 255, 255, 0.68)
* Inner highlight: subtle 1px inset highlight
* Shadow: 0 8px 28px rgba(20, 30, 50, 0.10)

These are initial web implementation values, not literal Apple system material specifications. Adjust based on real backgrounds and contrast tests.

Glass must have a soft, frosted appearance. It must not look like clear plastic, a glowing neon panel, or a highly reflective sci-fi interface.

Level C — Interactive glass accent

Reserved for the most important active navigation element, primary action, or transient interactive layer.

* Slightly more defined edge.
* More visible background separation.
* Subtle change in brightness or depth on interaction.
* No permanent glow.
* No exaggerated 3D bevels.
* No multiple stacked glass layers for a single button.

Use this level sparingly.

5. Color tokens

Establish a small semantic palette and define it as CSS variables.

Suggested light-theme tokens:

* –sb-canvas: #F5F6F8
* –sb-surface: #FFFFFF
* –sb-text-primary: #1D1D1F
* –sb-text-secondary: #686B73
* –sb-divider: rgba(30, 35, 45, 0.09)
* –sb-accent: #087FE8
* –sb-success: #248A52
* –sb-warning: #B87516
* –sb-danger: #C53B3B

Rules:

* Use neutral colors for most of the interface.
* Blue is the principal interactive accent.
* Green, amber, and red communicate actual status only.
* Star ratings may use restrained warm yellow.
* Product photography and the underlying website provide most of the color.
* Do not introduce purple-to-blue gradients, rainbow highlights, colored glow effects, or multiple competing accent colors.
* Do not use color as the only way to communicate state.

Support a dark theme only if the current extension architecture requires or already supports it. Dark mode must be deliberately designed rather than produced by mechanically inverting the light palette.

6. Typography

Use the system font stack for a browser extension unless the existing project has a justified typographic identity:

font-family: -apple-system, BlinkMacSystemFont, “Segoe UI”, sans-serif;

Typography should feel native, precise, and unforced.

Suggested type scale:

* Product name: 16px / 22px, weight 600
* Main price: 24px / 30px, weight 650
* Section heading: 14px / 20px, weight 600
* Body and review text: 13px / 19px, weight 400
* Supporting information: 12px / 16px, weight 400
* Compact metadata: 11px / 15px, weight 500

Use tabular numerals for prices, percentages, and historical price values.

Avoid:

* Oversized marketing-style headings inside a compact utility.
* ALL-CAPS labels used as decoration.
* Excessive letter spacing.
* Monospace text for ordinary metadata.
* Too many font sizes or weights.
* Highlighting random words to manufacture visual hierarchy.

7. Component geometry

Define a limited, intentional radius scale:

* Small controls: 8px
* Inputs and standard buttons: 10px
* Unified content regions: 12px
* Main floating shell: 16px
* Pill controls: fully rounded only when their behavior warrants it

Do not apply the same large radius to every element.

Buttons:

* Standard control height: 36px
* Compact control height: 30–32px where necessary
* Primary action: clear label, restrained accent, strong readable contrast
* Secondary action: neutral background or text-only treatment
* Icon-only actions require a tooltip or accessible name
* Focus states must remain visible

Inputs:

* Clear label and value.
* Consistent height and padding.
* Visible focus and invalid states.
* Do not communicate errors solely through border color.

Icons:

* Use one consistent line-icon family.
* Keep stroke weight and optical size consistent.
* Prefer 16px and 18px icons for compact controls.
* Do not use emoji as interface icons.
* Do not add an icon when text already communicates the action clearly.

8. SmartBuy-specific layout

Product header

Present the product thumbnail, product name, merchant context, and current price in one compact, aligned region.

The current price should be the primary numerical focal point. The product name may wrap to two lines before being truncated.

Do not put every field into its own card.

Navigation

Use a compact segmented navigation for:

* Reviews
* Price tracking
* Price comparison, if implemented

The active tab should be unmistakable through contrast and surface treatment, not through a bright glow.

A glass treatment is acceptable for the navigation because it represents an interactive control layer.

Reviews

Keep review content on a unified surface.

Each review should have:

* Reviewer identity or supported anonymous label
* Rating
* Review text
* Verified-purchase indicator only when supported by real data
* Helpful and report actions

Separate reviews with subtle dividers. Avoid a grid of identical floating review cards.

Filters

Keep filters close to the review list they control.

Use compact, consistent controls for rating, verified purchase, sorting, and other supported criteria.

Filters should wrap or collapse sensibly at narrow widths. Show active filter state clearly and provide a simple way to clear filters.

Price tracking

Make the current price, target price, and tracking status immediately understandable.

Use a simple chart with restrained grid lines and a clear price series. Avoid gradients beneath every chart or decorative chart animation.

The target-price input and stock-alert control should form one coherent interaction group. Save, success, validation, and failure states must all be visually distinct.

Never display a successful save state until persistence has actually succeeded.

9. Motion and interaction

Motion must communicate cause and effect.

Suggested timing:

* Hover or focus transition: 120–180ms
* Button press: 100–140ms
* Popover or panel transition: 180–240ms

Use gentle ease-out transitions. A slight change in opacity, background, or scale is enough.

Use motion for:

* Opening and closing a panel.
* Switching tabs.
* Expanding a review.
* Confirming a successful save.
* Showing a validation message.

Avoid:

* Animating every component on page load.
* Repeated floating or pulsing elements.
* Large spring bounces.
* Parallax effects in a compact extension.
* Animations that delay access to useful information.

Respect prefers-reduced-motion.

10. Accessibility and robustness

* Maintain readable contrast on both light and dark underlying webpages.
* Do not assume the page behind the extension is white.
* Use a dimming or more opaque backing when translucent glass harms readability.
* Provide visible keyboard focus.
* Ensure controls are keyboard operable.
* Use accessible names for icon-only controls.
* Support reduced transparency where feasible.
* Handle missing product images, long product names, unavailable prices, empty reviews, loading, and network errors.
* Never let the page’s CSS unintentionally override SmartBuy’s layout.
* Isolate extension styles using the existing architecture, CSS Modules, or an appropriate scoped root.
* Test stacking contexts, z-index, overflow, and browser zoom.

11. Anti-patterns — reject these during implementation

Do not use:

* A separate rounded card for every piece of information.
* Backdrop blur on every container.
* Generic purple gradients or rainbow glass.
* Neon borders or glowing buttons.
* A large empty hero section inside the extension.
* Excessive pills and badges.
* Random decorative icons.
* Large shadows on every component.
* Different corner radii without a system.
* Placeholder reviews or fabricated price history presented as real.
* Generic dashboard layouts unrelated to shopping.
* Decorative labels that add no information.
* Arbitrary CSS values that contradict the design tokens.

12. Quality gate

Before marking the design complete:

1. Inspect the actual rendered extension, not only the source code.
2. Test the panel against both a light and a dark product webpage.
3. Test short and long product names, missing images, and unavailable data.
4. Test review filters, tab switching, price-target editing, and save states.
5. Verify that content alignment and spacing remain consistent.
6. Check that glass is limited to appropriate overlapping surfaces.
7. Remove any decoration that does not improve usability or identity.
8. Compare the result against the design tokens and correct inconsistencies.
9. Preserve all existing working functionality.
10. Report what changed, what was tested, and any remaining issues.

The final result should feel like a carefully crafted browser utility from a premium software studio — not a generic AI-generated dashboard.

---

## חלק 2: תוספת לפרויקט

### 2.1 טוקנים כ-CSS

במפרט המקורי שמות המשתנים הופיעו עם מקף ארוך (`–sb-canvas`). השם הנכון הוא עם שני מקפים. אלה הטוקנים לשימוש, ב-`packages/ui/tokens.css`:

```css
:host, :root {
  /* color */
  --sb-canvas: #F5F6F8;
  --sb-surface: #FFFFFF;
  --sb-text-primary: #1D1D1F;
  --sb-text-secondary: #686B73;
  --sb-divider: rgba(30, 35, 45, 0.09);
  --sb-control-border: rgba(30, 35, 45, 0.16);
  --sb-accent: #087FE8;          /* tints, focus rings, switches, chart target line */
  --sb-accent-strong: #0870D0;   /* filled buttons with white text (see 2.2) */
  --sb-accent-text: #0864BA;     /* accent-coloured text on white */
  --sb-success: #248A52;
  --sb-success-text: #1D6E42;
  --sb-warning: #B87516;
  --sb-danger: #C53B3B;
  --sb-danger-text: #A83232;
  --sb-star: #E3A33B;
  --sb-star-empty: #DCDDE1;
  --sb-skeleton: #EEF0F3;

  /* glass, level B (light) */
  --sb-glass-bg: rgba(248, 249, 252, 0.78);
  --sb-glass-bg-opaque: rgba(248, 249, 252, 0.93); /* over dark or busy pages */
  --sb-glass-blur: blur(24px) saturate(145%);
  --sb-glass-border: rgba(255, 255, 255, 0.68);
  --sb-glass-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.75);
  --sb-glass-shadow: 0 8px 28px rgba(20, 30, 50, 0.10);

  /* glass, level C (active segment, primary transient layer) */
  --sb-glass-c-bg: rgba(255, 255, 255, 0.94);
  --sb-glass-c-border: rgba(255, 255, 255, 0.9);
  --sb-glass-c-shadow: 0 1px 3px rgba(20, 30, 50, 0.12);
  --sb-segment-track: rgba(118, 118, 128, 0.12);

  /* spacing */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;

  /* radius */
  --radius-sm: 8px; --radius-control: 10px; --radius-region: 12px; --radius-shell: 16px;

  /* type */
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "Assistant", sans-serif;

  /* motion */
  --dur-hover: 150ms; --dur-press: 120ms; --dur-panel: 220ms;
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
}

@media (prefers-reduced-transparency: reduce) {
  :host, :root { --sb-glass-bg: rgba(248, 249, 252, 0.98); --sb-glass-blur: none; }
}
@media (prefers-reduced-motion: reduce) {
  :host, :root { --dur-hover: 0ms; --dur-press: 0ms; --dur-panel: 0ms; }
}
```

### 2.2 הסטייה היחידה מהמפרט: ניגודיות כפתור

טקסט לבן על `#087FE8` לא עומד ביחס ניגודיות 4.5:1 בגודל 13 פיקסלים. לכן כפתורים מלאים משתמשים ב-`--sb-accent-strong` (`#0870D0`), וטקסט בצבע הדגשה על לבן משתמש ב-`--sb-accent-text`. הכחול המקורי נשאר לגוונים, טבעות פוקוס, מתגים וקו היעד בגרף.

### 2.3 עברית ו-RTL

- `dir="rtl"` ו-`lang="he"` על השורש של כל משטח, כולל שורש ה-Shadow DOM.
- רק תכונות לוגיות: `margin-inline-start`, `padding-inline`, `inset-inline-end`, `border-inline-start`. בלי `left` ו-`right` בקוד הממשק.
- אייקונים כיווניים (חצים, "חזרה", שברון של רשימה) מתהפכים. אייקונים לא כיווניים (כוכב, פעמון, וי) לא מתהפכים.
- מחירים ומספרים: `font-variant-numeric: tabular-nums`. סימן השקל לפני המספר: `₪149.90`.
- מק"ט, כתובות וקישורים בתוך טקסט עברי עטופים ב-`<bdi>` או ב-`dir="ltr"` כדי שלא יתבלגנו.
- גרשיים נכונים: מק״ט, ש״ח (U+05F4), גרש: ג׳ (U+05F3).
- הגופן: גופן המערכת (SF Hebrew במכשירי אפל). כגיבוי מחוץ לאפל: Assistant.
- כל הטקסט בממשק בעברית טבעית ופשוטה, בגוף שני רבים או סתמי. פעולות בשם הפעולה: "שמירת מעקב", "כתיבת ביקורת", "דיווח".

### 2.4 מיפוי רמות החומר למשטחים

| משטח | רמה |
| --- | --- |
| מעטפת הפאנל הצף בעמוד, הפס בעמוד המוצר, תפריטים קופצים | B (זכוכית) |
| הלשונית הפעילה בניווט, שכבה זמנית חשובה | C |
| ביקורות, גרף מחיר, טפסים, רשימות | A (משטח מלא) |
| פאנל הצד של Chrome וחלון התוסף | A בלבד. הם לא מעל דף אינטרנט, אז אין סיבה לזכוכית |
| האתר | A, עם זכוכית רק לסרגל הניווט התחתון בטלפון |

מעל עמוד כהה או עמוס, המעטפת עוברת ל-`--sb-glass-bg-opaque`. ההחלטה לפי בהירות הרקע שמתחת לפאנל, נמדדת פעם אחת כשהפאנל נפתח.

### 2.5 אלמנט החתימה: מד התאמת מידה

הדבר היחיד שמותר לו להיות "מיוחד". הוא חוזר בפס, בפאנל, באתר ובפרופיל המידות.

- קו אופקי דק (2px, `--sb-star-empty`), עם סימון קטן באמצע ("מדויק").
- נקודה מלאה (12px, `--sb-text-primary`) במיקום הממוצע המשוקלל: קטן בצד ההתחלה (ימין ב-RTL), גדול בצד הסוף.
- מעליו משפט אחד: "קטן במידה אחת" / "מדויק" / "גדול במידה אחת", ולצדו "לפי 22 קונים".
- מתחתיו שלוש תוויות: קטן, מדויק, גדול (11px).
- לא מוצג כשיש פחות מ-3 תשובות. במקום זה: "עוד אין מספיק מידע על המידה".
- נגיש: `role="img"` עם `aria-label` שמתאר את המשפט ואת מספר הקונים.

### 2.6 רשימת רכיבים ומצבים

כל רכיב נבנה עם כל המצבים שלו לפני שממשיכים לרכיב הבא.

| רכיב | מצבים |
| --- | --- |
| כותרת מוצר (תמונה, שם, חנות, מחיר) | רגיל, שם ארוך (2 שורות ואז קיצור), בלי תמונה, בלי מחיר |
| ניווט מקוטע | פעיל, רגיל, ריחוף, פוקוס |
| סיכום ביקורות | יש ביקורות, אין ביקורות, טעינה |
| מד התאמת מידה | יש מספיק, אין מספיק |
| סינון | ברירת מחדל, סינון פעיל, ניקוי, גלישה לשורה שנייה |
| ביקורת | רגילה, מאומתת, ממתינה לאימות, עם עדכונים, נערכה, מוסתרת (לכותב בלבד), מורחבת ומקוצרת |
| טופס ביקורת | ריק, ממולא, שגיאות שדה, שולח, נשלח, כשל |
| דיווח | בחירת סיבה, שולח, התקבל, כשל |
| גרף מחיר | 90 יום, מעט נתונים, אין נתונים |
| קבוצת מעקב | לא במעקב, עריכה, שגיאת שדה, שומר, נשמר, כשל |
| מוצר לא זוהה | עם חיפוש ידני |
| שגיאת רשת | עם ניסיון חוזר |

### 2.7 סקיצות לייחוס

לוח הסקיצות (פרטי, דורש שיתוף): https://claude.ai/artifact/PSqzxhmBocwuEB47CdjnWa

- **השורה "גרסה ג׳ — SmartBuy, Liquid Glass"** היא הכיוון הנבחר: עמוד מוצר עם פאנל צף, מעקב מחיר מעל עמוד כהה, ומצבי טעינה, ריק ושגיאה.
- השורות א׳ ו-ב׳ הן כיוונים קודמים. מהן לקחת רק את המבנה (מה יש בכל מסך), לא את המראה.
- כל הנתונים בסקיצות הם נתוני דוגמה.
