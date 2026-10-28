import { applyTheme, normalizeTheme, type ThemePref } from "@smartbuy/ui";

const KEY = "sb-theme";
let stop: () => void = () => undefined;

/** Light unless the person chose otherwise. A browser that blocks storage simply never remembers the choice. */
export function loadTheme(): ThemePref {
  try {
    return normalizeTheme(localStorage.getItem(KEY));
  } catch {
    return "light";
  }
}

export function initTheme(): void {
  stop();
  stop = applyTheme(document.documentElement, loadTheme());
}

/** Applies the choice now and reports whether the browser kept it for next time. */
export function setTheme(pref: ThemePref): boolean {
  stop();
  stop = applyTheme(document.documentElement, pref);
  try {
    localStorage.setItem(KEY, pref);
    return true;
  } catch {
    return false;
  }
}
