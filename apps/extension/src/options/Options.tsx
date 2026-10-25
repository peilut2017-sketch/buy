import { AccountPanel, DataControls, QuietModeSwitch, Root, SignInCard, Skel } from "@smartbuy/ui";
import { useSession } from "../lib/auth.ts";
import { BACKEND_CONFIGURED } from "../lib/env.ts";
import { StoreList } from "./StoreList.tsx";

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="sb-stack sb-gap-3" style={{ paddingBlock: "var(--space-5)", borderBlockStart: "1px solid var(--sb-divider)" }}>
      <h2 class="sb-t-heading">{title}</h2>
      {children}
    </section>
  );
}

export function Options() {
  const session = useSession();
  return (
    <Root class="options">
      <main style={{ maxInlineSize: "560px", marginInline: "auto", padding: "var(--space-6) var(--space-4)" }}>
        <h1 class="sb-t-name" style={{ marginBlockEnd: "var(--space-4)" }}>הגדרות SmartBuy</h1>

        <Section title="חנויות">
          <p class="sb-t-support sb-secondary">התוסף פועל רק בחנויות שהפעלתם, ורק בעמודי מוצר. הוא לא שומר היסטוריית גלישה.</p>
          <StoreList />
        </Section>

        {BACKEND_CONFIGURED && (
          <Section title="חשבון">
            {session.status === "loading" && <Skel width="60%" height="36px" />}
            {session.status === "out" && <SignInCard reason="החשבון מאפשר לכתוב ביקורות, לסמן ביקורות כמועילות ולדווח." />}
            {session.status === "in" && <AccountPanel identity={session.identity} />}
          </Section>
        )}

        {session.status === "in" && (
          <>
            <Section title="התראות"><QuietModeSwitch identity={session.identity} /></Section>
            <Section title="הפרטיות שלכם"><DataControls identity={session.identity} /></Section>
          </>
        )}

        <Section title="איך זה עובד">
          <p class="sb-t-body">SmartBuy הוא שירות עצמאי ואין לו קשר לחנויות. סדר הביקורות ותוכנן לא מושפעים מהכנסה או מפרסום. ביקורת מאומתת מסומנת ככזו רק כשהרכישה אומתה.</p>
        </Section>
      </main>
    </Root>
  );
}
