---
name: apple-liquid-glass
description: Apply SmartBuy's restrained Apple-style Liquid Glass material system to browser-extension UI — which surfaces get glass, the three material levels, exact token values, contrast fallbacks over dark or busy pages, and the anti-patterns to reject. Use for any SmartBuy UI surface (injected strip, floating panel, side panel, popup, website).
---

# Apple-style Liquid Glass for SmartBuy

SmartBuy floats over real shopping pages. Glass is how it says "I am a layer above the page" without shouting. Used everywhere, glass becomes noise and hurts readability. Used in the right two or three places, it makes the extension feel native.

The source of truth for values is `docs/02-design-system.md` (tokens in section 2.1). This skill is the *how* and *when*.

## The one decision: does this surface float over a web page?

| Surface | Floats over the page? | Material |
| --- | --- | --- |
| Injected floating panel shell, product-page strip, popovers and menus opened from them | Yes | Level B glass |
| Active segment of the segmented control, one primary transient layer | Yes, interactive | Level C |
| Reviews, price chart, forms, lists *inside* the shell | No, they are content | Level A solid |
| Chrome side panel, extension popup, options page | No (own window) | Level A only |
| Website | No | Level A; glass only for the mobile bottom tab bar |

If a surface does not overlap a web page, it gets no blur. No exceptions for "it looks nicer".

## Level A — base content

- `background: var(--sb-surface)` (white) or `var(--sb-canvas)`.
- No `backdrop-filter`, no gradient, no shadow.
- Group related rows on one surface and separate them with 1px `var(--sb-divider)`. Do not wrap each item in its own card.
- Radius `var(--radius-region)` (12px) when it sits inside a glass shell.

## Level B — floating glass

```css
.sb-shell {
  background: var(--sb-glass-bg);
  -webkit-backdrop-filter: var(--sb-glass-blur);
  backdrop-filter: var(--sb-glass-blur);
  border: 1px solid var(--sb-glass-border);
  box-shadow: var(--sb-glass-shadow), var(--sb-glass-highlight);
  border-radius: var(--radius-shell);
}
```

- One glass layer per floating element. Never stack glass on glass.
- The look is frosted, soft and quiet: not clear plastic, not neon, not reflective.
- The content inside is Level A, so text never sits directly on blur.

## Level C — interactive accent

For the active tab of the segmented control and, at most, one primary transient layer.

```css
.sb-segment[aria-selected="true"] {
  background: var(--sb-glass-c-bg);
  border: 1px solid var(--sb-glass-c-border);
  box-shadow: var(--sb-glass-c-shadow);
  font-weight: 600;
}
```

- Interaction changes brightness or depth slightly (120–180ms ease-out). No permanent glow, no bevels.

## Contrast over the real page

The page under SmartBuy can be white, black, or a busy photo. Glass that is fine on white can be unreadable on a dark product photo.

1. When the shell opens, sample the luminance of the area under it once (e.g. average `getComputedStyle` background colours of the elements behind its rect, or a cheap 8x8 canvas sample of the visible product image when available).
2. If the background is dark or high-variance, switch the shell to `var(--sb-glass-bg-opaque)`.
3. `@media (prefers-reduced-transparency: reduce)` → near-opaque background, no blur (already in tokens).
4. Text always meets 4.5:1 against the *Level A* surface it sits on, which is why content never sits on glass directly.
5. Test every surface on one light and one dark product page before calling it done.

## Shadow DOM

Injected UI lives in a shadow root (`:host` carries the tokens). `backdrop-filter` works inside shadow DOM because it filters what is painted behind the host element. Make sure the host element itself is positioned (`position: fixed` or `absolute`) with a defined size, and has no `overflow: hidden` ancestor clipping the blur. Set `isolation: isolate` on the host and a high but sane `z-index` (2147483000), and test against the store's sticky header.

## Reject these

- Blur on every container, or blur inside the side panel/popup.
- Purple/rainbow gradients, neon borders, glowing buttons, coloured shadows.
- A card per piece of information, the same big radius on everything.
- Large shadows on inner components.
- Pulsing, floating or parallax decoration.
- Glass behind long-form text.

## Checklist before finishing a surface

- [ ] Glass only where the surface overlaps the page.
- [ ] Content inside glass is on a Level A surface.
- [ ] Tested on light and dark product pages; opaque fallback works.
- [ ] Reduced transparency and reduced motion respected.
- [ ] Radii follow the scale: 8 / 10 / 12 / 16.
- [ ] No component uses a value that is not a token.
