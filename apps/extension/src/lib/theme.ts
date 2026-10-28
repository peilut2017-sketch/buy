import { applyTheme, normalizeTheme, type ThemePref } from "@smartbuy/ui";
import { browser } from "wxt/browser";
import { THEME_SETTING } from "./settings.ts";

export async function loadTheme(): Promise<ThemePref> {
  try {
    const got = await browser.storage.local.get(THEME_SETTING);
    return normalizeTheme(got[THEME_SETTING]);
  } catch {
    return "light";
  }
}

export async function saveTheme(pref: ThemePref): Promise<void> {
  await browser.storage.local.set({ [THEME_SETTING]: pref });
}

/**
 * Keeps `target` (the document element of an extension page, or the strip's shadow host) in the chosen theme, and follows a change
 * made on the options page at once. Light is applied first, so a slow or failed storage read never leaves the page unstyled.
 */
export function watchTheme(target: Element, win: Window | null = typeof window === "undefined" ? null : window): () => void {
  let stop = applyTheme(target, "light", win);
  let live = true;
  const set = (pref: ThemePref) => {
    if (!live) return;
    stop();
    stop = applyTheme(target, pref, win);
  };
  void loadTheme().then(set);
  const onChange = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === "local" && THEME_SETTING in changes) set(normalizeTheme(changes[THEME_SETTING]?.newValue));
  };
  try {
    browser.storage.onChanged.addListener(onChange);
  } catch {
    /* no storage events (tests): the first read is enough */
  }
  return () => {
    live = false;
    stop();
    try {
      browser.storage.onChanged.removeListener(onChange);
    } catch {
      /* nothing to remove */
    }
  };
}
