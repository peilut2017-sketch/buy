import { Notice, Root } from "@smartbuy/ui";
import { useState } from "preact/hooks";
import { StoreList } from "./StoreList.tsx";

/** One screen after install (spec 16): what it does, why a store permission is asked, what is NOT collected. */
export function Welcome() {
  const [granted, setGranted] = useState(false);
  return (
    <Root class="welcome">
      <main style={{ maxInlineSize: "560px", marginInline: "auto", padding: "var(--space-8) var(--space-4)" }} class="sb-stack sb-gap-6">
        <header class="sb-stack sb-gap-2">
          <h1 class="sb-t-name" style={{ fontSize: "24px", lineHeight: "30px" }}>ברוכים הבאים ל-SmartBuy</h1>
          <p class="sb-t-body">ביקורות אמינות ומעקב מחירים באתרי קניות שאין בהם ביקורות. בלי הרשמה חובה: אפשר לקרוא ביקורות מיד.</p>
        </header>

        <section class="sb-stack sb-gap-3" aria-labelledby="w-store">
          <h2 class="sb-t-heading" id="w-store">איזו חנות להפעיל?</h2>
          <p class="sb-t-support sb-secondary">כדי להציג ביקורות בעמודי מוצר, Chrome יבקש אישור לקרוא את האתר של החנות. בלי אישור התוסף לא רואה אותו, ואפשר לבטל בכל רגע.</p>
          <StoreList onGranted={() => setGranted(true)} />
          {granted && <Notice kind="success" title="החנות הופעלה">פתחו עמוד מוצר בחנות, והפס של SmartBuy יופיע בפינה.</Notice>}
        </section>

        <section class="sb-stack sb-gap-2" aria-labelledby="w-privacy">
          <h2 class="sb-t-heading" id="w-privacy">מה אנחנו לא אוספים</h2>
          <ul class="sb-t-body sb-stack sb-gap-1" style={{ paddingInlineStart: "var(--space-5)", listStyle: "disc" }}>
            <li>היסטוריית גלישה או עמודים שביקרתם בהם.</li>
            <li>כתובת IP בסטטיסטיקות שימוש.</li>
            <li>מספרי הזמנה: אם תאמתו רכישה, נשמר רק גיבוב שלהם.</li>
            <li>את השם האמיתי שלכם. מוצג רק הכינוי שתבחרו.</li>
          </ul>
        </section>

        <p class="sb-t-support sb-secondary">SmartBuy הוא שירות עצמאי ואין לו קשר לחנויות.</p>
      </main>
    </Root>
  );
}
