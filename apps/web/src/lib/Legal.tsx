import type { ComponentChildren } from "preact";
import { Shell } from "../shell.tsx";

/** A text page. Legal pages carry a draft banner until a lawyer has approved them (docs/05-roadmap.md, phase 0). */
export function TextPage({ title, children, draft, active }: { title: string; children: ComponentChildren; draft?: boolean; active?: "how" }) {
  return (
    <Shell active={active}>
      <article class="web__card prose">
        <h1 class="web__title">{title}</h1>
        {draft && (
          <p class="draft" role="note">
            <strong>טיוטה.</strong> הנוסח הזה נכתב כבסיס לבדיקה של עורך דין, ועדיין לא אושר. סימונים בסוגריים מרובעים [כך] הם פרטים שצריך להשלים. אין להשיק לציבור לפני בדיקה משפטית.
          </p>
        )}
        {children}
      </article>
    </Shell>
  );
}
