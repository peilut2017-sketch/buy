import { Icon, Root, ThemeChoice, type ThemePref } from "@smartbuy/ui";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { loadTheme, setTheme } from "./lib/theme.ts";

export type Section = "home" | "how" | "account" | "none";

const LINKS: { id: Exclude<Section, "none">; href: string; label: string; icon: "search" | "info" | "user" }[] = [
  { id: "home", href: "/", label: "חיפוש", icon: "search" },
  { id: "how", href: "/how-it-works", label: "איך זה עובד", icon: "info" },
  { id: "account", href: "/account", label: "החשבון שלי", icon: "user" },
];

/** The appearance is applied at once; the note appears only when the browser refused to keep it. */
function ThemeSwitch() {
  const [pref, setPref] = useState<ThemePref>(loadTheme);
  const [kept, setKept] = useState(true);
  return (
    <div class="web__theme">
      <ThemeChoice value={pref} onChange={(v) => { setPref(v); setKept(setTheme(v)); }} />
      {!kept && <p class="sb-t-support" role="status">הדפדפן לא שומר את הבחירה, והיא תחול רק בעמוד הזה.</p>}
    </div>
  );
}

export function Shell({ children, active = "none", wide, home }: { children: ComponentChildren; active?: Section; wide?: boolean; home?: boolean }) {
  return (
    <Root class="web">
      <a class="web__skip" href="#main">דלגו לתוכן</a>
      <header class="web__header">
        <div class="web__bar">
          <a class="web__brand" href="/"><span class="web__mark" aria-hidden="true" />SmartBuy</a>
          <nav class="web__nav" aria-label="ראשי">
            {LINKS.map((l) => (
              <a key={l.id} href={l.href} aria-current={active === l.id ? "page" : undefined}>{l.label}</a>
            ))}
          </nav>
        </div>
      </header>
      <main class={home ? "web__main web__main--wide web__main--home" : wide ? "web__main web__main--wide" : "web__main"} id="main">{children}</main>
      <footer class="web__footer">
        <nav aria-label="מידע">
          <a href="/privacy">מדיניות פרטיות</a>
          <a href="/terms">תנאי שימוש</a>
          <a href="/accessibility">הצהרת נגישות</a>
          <a href="/takedown">בקשת הסרה</a>
        </nav>
        <ThemeSwitch />
        <p>SmartBuy הוא שירות עצמאי ואין לו קשר לחנויות. סימני המסחר שייכים לבעליהם.</p>
      </footer>
      <nav class="web__tabbar sb-shell" aria-label="ניווט תחתון">
        {LINKS.map((l) => (
          <a key={l.id} href={l.href} aria-current={active === l.id ? "page" : undefined}>
            <Icon name={l.icon} size={20} />
            {l.label}
          </a>
        ))}
      </nav>
    </Root>
  );
}
