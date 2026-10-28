// Light, dark or follow the system. The choice becomes the data-sb-theme attribute that tokens.css reads.
// Where the choice is stored is up to the app (extension storage, localStorage); this module only resolves and applies it.

export type ThemePref = "light" | "dark" | "system";

export const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "light", label: "בהיר" },
  { value: "dark", label: "כהה" },
  { value: "system", label: "לפי המערכת" },
];

/** Anything unknown or missing is light, the default. */
export function normalizeTheme(value: unknown): ThemePref {
  return value === "dark" || value === "system" ? value : "light";
}

export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): "light" | "dark" {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}

/** Sets the attribute on `target` (the document element, or a shadow host) and, for "system", keeps it in step with the OS. Returns a cleanup. */
export function applyTheme(target: Element, pref: ThemePref, win: Window | null = typeof window === "undefined" ? null : window): () => void {
  const query = win?.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
  const set = () => target.setAttribute("data-sb-theme", resolveTheme(pref, query?.matches === true));
  set();
  if (pref !== "system" || !query) return () => undefined;
  query.addEventListener("change", set);
  return () => query.removeEventListener("change", set);
}
