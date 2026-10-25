import { Icon, Root } from "@smartbuy/ui";
import type { ComponentChildren } from "preact";

export type Section = "home" | "how" | "account" | "none";

const LINKS: { id: Exclude<Section, "none">; href: string; label: string; icon: "search" | "info" | "user" }[] = [
  { id: "home", href: "/", label: "חיפוש", icon: "search" },
  { id: "how", href: "/how-it-works", label: "איך זה עובד", icon: "info" },
  { id: "account", href: "/account", label: "החשבון שלי", icon: "user" },
];

export function Shell({ children, active = "none", wide }: { children: ComponentChildren; active?: Section; wide?: boolean }) {
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
      <main class={wide ? "web__main web__main--wide" : "web__main"} id="main">{children}</main>
      <footer class="web__footer">
        <nav aria-label="מידע">
          <a href="/privacy">מדיניות פרטיות</a>
          <a href="/terms">תנאי שימוש</a>
          <a href="/accessibility">הצהרת נגישות</a>
          <a href="/takedown">בקשת הסרה</a>
        </nav>
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
