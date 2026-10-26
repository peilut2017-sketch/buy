// Decides whether the strip's glass frame needs its opaque variant. Glass that looks fine over white can be
// unreadable over a dark or busy product photo (docs/02-design-system.md, section 2.4). Measured once, when mounted.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Computed styles are always `rgb(...)` or `rgba(...)`. Anything else is treated as unknown. */
export function parseCssColor(value: string): Rgba | null {
  const match = /^rgba?\(\s*(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*\.?\d+%?))?\s*\)$/.exec(value.trim());
  if (!match) return null;
  const alphaRaw = match[4];
  const a = alphaRaw === undefined ? 1 : alphaRaw.endsWith("%") ? Number.parseFloat(alphaRaw) / 100 : Number.parseFloat(alphaRaw);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a };
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance({ r, g, b }: Pick<Rgba, "r" | "g" | "b">): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export interface BackdropSample {
  /** Lowest luminance found among the solid colours behind the strip. Null when none was found. */
  luminance: number | null;
  /** A background image or gradient sits behind the strip: contrast cannot be known. */
  busy: boolean;
}

export const DARK_BELOW = 0.45;

export function needsOpaque(sample: BackdropSample): boolean {
  return sample.busy || (sample.luminance !== null && sample.luminance < DARK_BELOW);
}

export function sampleBackdrop(doc: Document, rect: { left: number; top: number; right: number; bottom: number }, ignore: Element): BackdropSample {
  const win = doc.defaultView;
  if (!win) return { luminance: null, busy: true };
  const xs = [rect.left + 8, (rect.left + rect.right) / 2, rect.right - 8];
  const ys = [rect.top + 8, (rect.top + rect.bottom) / 2, rect.bottom - 8];
  let lowest: number | null = null;
  let busy = false;

  for (const x of xs) {
    for (const y of ys) {
      for (const el of doc.elementsFromPoint(x, y)) {
        if (el === ignore || ignore.contains(el)) continue;
        const style = win.getComputedStyle(el);
        if (style.backgroundImage && style.backgroundImage !== "none") busy = true;
        const colour = parseCssColor(style.backgroundColor);
        if (colour && colour.a >= 0.5) {
          const l = luminance(colour);
          lowest = lowest === null ? l : Math.min(lowest, l);
          break; // the first opaque layer from the top is what shows through
        }
      }
    }
  }
  return { luminance: lowest, busy };
}
