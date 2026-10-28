import { fitMeter } from "@smartbuy/core";
import { Button, FitMeter, Notice, Skel, Stars, useResource } from "@smartbuy/ui";
import { boot } from "../lib/boot.tsx";
import { BACKEND_CONFIGURED, EXTENSION_STORE_URL } from "../lib/env.ts";
import { Search } from "../lib/Search.tsx";
import { loadSites } from "../lib/sites.ts";
import { Shell } from "../shell.tsx";

const FEATURES = [
  { title: "מתי נכתבה הביקורת", text: "כל ביקורת מציגה כמה זמן אחרי הקנייה היא נכתבה, ואפשר להוסיף לה עדכון אחרי שימוש ממושך." },
  { title: "רכישה מאומתת באמת", text: "ביקורת מאומתת מסומנת ככזו רק כשהרכישה אומתה. כל השאר מסומנות כמו שהן." },
  { title: "איזו מידה לקחת", text: "מד התאמת המידה מראה אם המוצר קטן, מדויק או גדול, לפי הקונים ועם מספר הקונים שמאחוריו." },
  { title: "בלי כסף בדרך", text: "אין השפעה של הכנסה או פרסום על סדר הביקורות או על תוכנן." },
];

/** The strip as it looks on a product page. Built from the real components with sample numbers, and said so on the screen. */
function Demo() {
  const meter = fitMeter({ small: 2, exact: 7, large: 13 });
  return (
    <figure class="demo" aria-label="הדגמה של הפס בעמוד מוצר">
      <div class="demo__card">
        <div class="sb-row sb-gap-2">
          <span class="demo__score">4.3</span>
          <Stars value={4.3} size={18} />
        </div>
        <FitMeter meter={meter} />
      </div>
      <figcaption class="sb-t-support sb-secondary">הדגמה בלבד: המספרים כאן לדוגמה ולא ממוצר אמיתי.</figcaption>
    </figure>
  );
}

function Home() {
  const sites = useResource(() => loadSites(), []);
  return (
    <Shell active="home" home>
      <section class="hero">
        <h1>ביקורות אמינות על מוצרים באתרי קניות</h1>
        <p class="hero__lead">קראו מה אומרים הקונים לפני שאתם קונים: התאמת מידה, איכות, ומי באמת קנה. בלי הרשמה לקריאה.</p>

        {!BACKEND_CONFIGURED ? (
          <Notice kind="error" title="החיבור לשרת לא הוגדר">גרסת הפיתוח הזו נבנתה בלי כתובת שרת.</Notice>
        ) : sites.status === "loading" ? (
          <div class="hero__search"><Skel width="100%" height="64px" /></div>
        ) : sites.status === "error" ? (
          <div class="hero__search">
            <Notice kind="error" title="לא הצלחנו לטעון את רשימת החנויות" action={<Button small icon="refresh" onClick={sites.reload}>ניסיון חוזר</Button>}>
              בדקו את החיבור לאינטרנט ונסו שוב.
            </Notice>
          </div>
        ) : (
          <div class="hero__search web__card">
            <Search sites={sites.data} />
            <p class="sb-t-support sb-secondary" style={{ marginBlockStart: "var(--space-3)" }}>
              חנויות נתמכות: {sites.data.filter((s) => s.status !== "paused").map((s) => (s.status === "beta" ? `${s.name} (בטא)` : s.name)).join(", ") || "עוד אין"}
            </p>
          </div>
        )}
      </section>

      <Demo />

      <section class="features" aria-labelledby="h-how">
        <h2 id="h-how" class="section-title">מה מיוחד כאן</h2>
        <div class="features__grid">
          {FEATURES.map((f) => (
            <div key={f.title} class="feature">
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
        <p class="features__more"><a href="/how-it-works">איך זה עובד</a></p>
      </section>

      {EXTENSION_STORE_URL && (
        <section class="cta" aria-labelledby="h-install">
          <h2 id="h-install" class="section-title">הביקורות ליד המוצר, בלי לצאת מהחנות</h2>
          <p class="hero__lead">התוסף מוסיף לעמוד המוצר פס קטן עם הדירוג והתאמת המידה. הוא פועל רק בחנויות שתפעילו.</p>
          <p><a class="sb-btn sb-btn--primary cta__button" href={EXTENSION_STORE_URL} rel="noopener">התקנת התוסף ל-Chrome</a></p>
        </section>
      )}
    </Shell>
  );
}

boot(<Home />);
