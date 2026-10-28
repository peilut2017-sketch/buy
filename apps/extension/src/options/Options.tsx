import { browser } from "wxt/browser";
import { useEffect, useState } from "preact/hooks";
import { AccountPanel, DataControls, NotificationSettingsPanel, SizeProfilePanel, Root, SignInCard, Skel, Switch, RequireTerms, ThemeChoice, type ThemePref } from "@smartbuy/ui";
import { useSession } from "../lib/auth.ts";
import { BACKEND_CONFIGURED } from "../lib/env.ts";
import { LISTING_SETTING } from "../lib/settings.ts";
import { getLocal, setLocal } from "../lib/storage.ts";
import { loadTheme, saveTheme } from "../lib/theme.ts";
import { Diagnostics } from "./Diagnostics.tsx";
import { StoreList } from "./StoreList.tsx";

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="sb-stack sb-gap-3" style={{ paddingBlock: "var(--space-5)", borderBlockStart: "1px solid var(--sb-divider)" }}>
      <h2 class="sb-t-heading">{title}</h2>
      {children}
    </section>
  );
}

/** Local to this browser, so it works without an account. Shown as changed only after the browser stored it. */
function ListingStarsSwitch() {
  const [value, setValue] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void getLocal<boolean>(LISTING_SETTING).then((v) => setValue(v ?? true), () => setValue(true));
  }, []);
  const change = async (next: boolean) => {
    setFailed(false);
    try {
      await setLocal(LISTING_SETTING, next);
      setValue(next);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div class="sb-stack sb-gap-2">
      <Switch checked={value ?? true} disabled={value === null} onChange={change} label="כוכבים ברשימות מוצרים" description="בעמודי קטגוריה וחיפוש מוצג דירוג קטן על מוצרים שיש להם ביקורות. מוצר בלי ביקורות לא מקבל כלום." />
      {failed && <p class="sb-t-support" role="alert">ההגדרה לא נשמרה. נסו שוב.</p>}
    </div>
  );
}

/** The choice is stored in this browser. The page follows it through the storage change, so it is shown as changed only after it was stored. */
function ThemeSetting() {
  const [value, setValue] = useState<ThemePref | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void loadTheme().then(setValue);
  }, []);
  const change = async (next: ThemePref) => {
    setFailed(false);
    try {
      await saveTheme(next);
      setValue(next);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div class="sb-stack sb-gap-2">
      <ThemeChoice value={value ?? "light"} disabled={value === null} onChange={change} />
      <p class="sb-t-support sb-secondary">חל על הפס בעמוד המוצר, על פאנל הצד, על החלון הזה ועל חלון התוסף.</p>
      {failed && <p class="sb-t-support" role="alert">ההגדרה לא נשמרה. נסו שוב.</p>}
    </div>
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

        <Section title="תצוגה בחנות"><ListingStarsSwitch /></Section>

        <Section title="מראה"><ThemeSetting /></Section>

        {BACKEND_CONFIGURED && (
          <Section title="חשבון">
            {session.status === "loading" && <Skel width="60%" height="36px" />}
            {session.status === "out" && <SignInCard reason="החשבון מאפשר לכתוב ביקורות, לסמן ביקורות כמועילות ולדווח." />}
            {session.status === "in" && <AccountPanel identity={session.identity} />}
          </Section>
        )}

        {session.status === "in" && (
          <>
            <RequireTerms identity={session.identity}>
              <Section title="התראות"><NotificationSettingsPanel identity={session.identity} /></Section>
              <Section title="המידות שלי"><SizeProfilePanel identity={session.identity} /></Section>
            </RequireTerms>
            <Section title="הפרטיות שלכם"><DataControls identity={session.identity} /></Section>
          </>
        )}

        <Section title="בדיקת חיבור לשרת"><Diagnostics /></Section>
        <p class="sb-t-support sb-secondary">גרסה: <bdi dir="ltr">{browser.runtime.getManifest().version_name ?? browser.runtime.getManifest().version}</bdi></p>

        <Section title="איך זה עובד">
          <p class="sb-t-body">SmartBuy הוא שירות עצמאי ואין לו קשר לחנויות. סדר הביקורות ותוכנן לא מושפעים מהכנסה או מפרסום. ביקורת מאומתת מסומנת ככזו רק כשהרכישה אומתה.</p>
        </Section>
      </main>
    </Root>
  );
}
