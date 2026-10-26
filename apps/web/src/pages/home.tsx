import { Button, Notice, Skel, useResource } from "@smartbuy/ui";
import { boot } from "../lib/boot.tsx";
import { BACKEND_CONFIGURED, EXTENSION_STORE_URL } from "../lib/env.ts";
import { Search } from "../lib/Search.tsx";
import { loadSites } from "../lib/sites.ts";
import { Shell } from "../shell.tsx";

function Home() {
  const sites = useResource(() => loadSites(), []);
  return (
    <Shell active="home">
      <section class="hero">
        <h1>ביקורות אמינות על מוצרים באתרי קניות</h1>
        <p class="sb-t-body sb-secondary">קראו מה אומרים הקונים לפני שאתם קונים: התאמת מידה, איכות, ומי באמת קנה. בלי הרשמה לקריאה.</p>
      </section>

      {!BACKEND_CONFIGURED ? (
        <Notice kind="error" title="החיבור לשרת לא הוגדר">גרסת הפיתוח הזו נבנתה בלי כתובת שרת.</Notice>
      ) : sites.status === "loading" ? (
        <Skel width="100%" height="64px" />
      ) : sites.status === "error" ? (
        <Notice kind="error" title="לא הצלחנו לטעון את רשימת החנויות" action={<Button small icon="refresh" onClick={sites.reload}>ניסיון חוזר</Button>}>
          בדקו את החיבור לאינטרנט ונסו שוב.
        </Notice>
      ) : (
        <div class="web__card">
          <Search sites={sites.data} />
          <p class="sb-t-support sb-secondary" style={{ marginBlockStart: "var(--space-3)" }}>
            חנויות נתמכות: {sites.data.filter((s) => s.status !== "paused").map((s) => (s.status === "beta" ? `${s.name} (בטא)` : s.name)).join(", ") || "עוד אין"}
          </p>
        </div>
      )}

      <section class="web__card prose" aria-labelledby="h-how">
        <h2 id="h-how" style={{ marginBlockStart: 0 }}>מה מיוחד כאן</h2>
        <ul>
          <li>כל ביקורת מציגה כמה זמן אחרי הקנייה נכתבה.</li>
          <li>ביקורת מאומתת מסומנת ככזו רק כשהרכישה אומתה.</li>
          <li>מד התאמת המידה מראה אם המוצר קטן, מדויק או גדול, לפי הקונים.</li>
          <li>אין השפעה של הכנסה או פרסום על סדר הביקורות. <a href="/how-it-works">איך זה עובד</a></li>
        </ul>
        {EXTENSION_STORE_URL && (
          <p><a class="sb-btn sb-btn--primary" href={EXTENSION_STORE_URL} rel="noopener">התקנת התוסף ל-Chrome</a></p>
        )}
      </section>
    </Shell>
  );
}

boot(<Home />);
