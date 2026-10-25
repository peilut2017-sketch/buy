# ארכיטקטורה

## רכיבים

| רכיב | טכנולוגיה | אחריות |
| --- | --- | --- |
| Content script | WXT + Preact, בתוך Shadow DOM | זיהוי מוצר, הפס בעמוד, כוכבים ברשימות, דיווח מחיר, קריאת וריאנטים |
| Side panel | `chrome.sidePanel` + Preact | ביקורות, כתיבה, דיווח, מעקב מחיר |
| Popup | Preact | מעקבים, ממתינים לביקורת, התראות, מצב שקט |
| Options | Preact | הגדרות, ערוצים, פרטיות, אתרים פעילים |
| Background (service worker) | TypeScript | סשן, מטמון, הרשאות, משיכת הזמנות, `chrome.alarms`, התראות מקומיות |
| Web app | קבצי HTML בודדים + Supabase JS, Cloudflare Pages | עמוד מוצר, חיפוש, הדבקת קישור, חשבון, ניהול |
| Supabase | Postgres, Auth, RLS, Edge Functions | נתונים, הרשאות, לוגיקה בצד השרת |
| Edge Functions | Deno | כתיבת ביקורת, אימות הזמנה, טלגרם, שליחת התראות, סריקת מוצרים במעקב, ייצוא נתונים |
| Email Worker | Cloudflare Email Routing + Worker | קליטת מיילים, בדיקת DKIM, פירוס הזמנה |
| Telegram bot | Edge Function כ-webhook | קישור חשבון, שליחת התראות |

## Manifest V3

```jsonc
{
  "permissions": ["storage", "sidePanel", "notifications", "alarms", "scripting"],
  "optional_host_permissions": ["https://www.terminalx.com/*"],
  "host_permissions": [],            // API calls go to Supabase, which allows CORS
  "side_panel": { "default_path": "sidepanel.html" }
}
```

- **Content scripts נרשמים דינמית** עם `chrome.scripting.registerContentScripts` רק אחרי שהמשתמש אישר הרשאה לאתר. אתר חדש לא משבית את התוסף אצל משתמשים קיימים.
- **אין קוד מרוחק.** מהשרת מגיעים רק נתונים: כללי זיהוי, ספים, דגלי פיצ'רים.
- `chrome.runtime.setUninstallURL` לסקר יציאה קצר באתר.

## ממשק המתאם

כל אתר הוא תיקייה ב-`packages/adapters/<site>/` שמממשת:

```ts
export interface SiteAdapter {
  id: string;                                   // "terminalx"
  matchesUrl(url: URL): boolean;
  detectProduct(doc: Document, url: URL, cfg: AdapterConfig): Detection;
  readVariantOptions(doc: Document, cfg: AdapterConfig): VariantOption[]; // מה ניתן לבחור בעמוד
  readSelectedVariant(doc: Document, cfg: AdapterConfig): VariantValues;
  readPriceStock(doc: Document, cfg: AdapterConfig): PriceSnapshot | null;
  readListingCards?(doc: Document, cfg: AdapterConfig): ListingCard[];  // כוכבים ברשימות
  fetchOrders?(cfg: AdapterConfig): Promise<Order[]>;                     // רץ ב-background
  parseConfirmationEmail?(raw: ParsedEmail): Order | null;                // רץ ב-Email Worker
}

export interface Detection {
  siteId: string;
  sku: string | null;          // מק"ט מלא (וריאנט)
  parentSku: string | null;    // דגם אב
  confidence: "high" | "medium" | "low" | "none";
  signals: { name: string; value: string | null; agrees: boolean }[];
}
```

`AdapterConfig` מגיע מ-`sites.adapter_config` (גרסה + selectors + regexים), נשמר ב-`chrome.storage.local` לשש שעות, ויש עותק מובנה בתוסף כגיבוי. מנוע הזיהוי ב-`packages/core` מריץ את הסימנים ומחליט לפי הכללים באפיון (סעיף 4).

## זרימות

### צפייה בעמוד מוצר

1. Content script מזהה מוצר (מתאם + מנוע זיהוי).
2. מציג מיד שלד של הפס, ומבקש סיכום מ-`product_summary` (מטמון 10 דקות ב-background).
3. שולח ברקע דיווח מחיר ומלאי, בלי מזהה משתמש, מצטבר ונשלח פעם בדקה.
4. כשל זיהוי נשלח כאירוע `detect_failed` עם הסימנים (בלי מידע אישי).

### כתיבת ביקורת

1. הטופס בפאנל נשלח ל-Edge Function `submit-review`.
2. הפונקציה בודקת: משתמש מחובר, מגבלת קצב, אורך טקסט, וריאנט קיים, ביקורת קיימת לאותו משתמש ומוצר (אחת לכל דגם אב, אפשר לעדכן).
3. אם יש הזמנה מאומתת תואמת, הביקורת מסומנת מאומתת ומקבלת את תאריכי ההזמנה.
4. מחזירה את הביקורת השמורה. רק אז הממשק מציג "פורסם".

### אימות דרך התוסף

1. המשתמש מאשר פעם אחת "בדיקת הזמנות".
2. Background מריץ `adapter.fetchOrders()` עם העוגיות של המשתמש מול החנות, לכל היותר פעם ביום ורק כשהמשתמש גולש בחנות.
3. נשלחים ל-`verify-orders`: hash של מספר ההזמנה, תאריכים, מק"טים ווריאנטים. שום פרט אישי אחר.
4. השרת נועל את ה-hash לחשבון, מאמת ביקורות ממתינות, ומעדכן את "ממתינים לביקורת".

### אימות במייל

1. מייל מגיע לכתובת `verify@<domain>` (העברה במסנן או קובץ מצורף).
2. Email Worker בודק DKIM מול הדומיין שמוגדר ב-`sites.adapter_config.emailDomains`.
3. מוצא את המשתמש לפי כתובת המעביר (מכותרות ההעברה או מהשולח של מייל עם קובץ מצורף).
4. מפרסר עם `adapter.parseConfirmationEmail` ושולח ל-`verify-orders`.
5. מייל בלי חתימה תקפה נדחה, והמשתמש מקבל הסבר.

### התראות

1. דיווח מחיר שיוצר שינוי נשמר ב-`price_events`.
2. טריגר מוצא מעקבים שהתנאי שלהם התקיים ומכניס ל-`notification_queue`.
3. `send-notifications` (כל 5 דקות) מאחד לפי משתמש, מכבד תקרה יומית, שעות שקטות ושבת (חישוב זמני שבת בצד השרת לפי מיקום המשתמש, עם ספרייה כמו `@hebcal/core`), ושולח לפי הערוצים.
4. כל שליחה נרשמת ב-`notification_log` עם סטטוס.

### קישור טלגרם

1. בהגדרות: "חיבור טלגרם" יוצר טוקן חד-פעמי ל-15 דקות.
2. קישור `https://t.me/<bot>?start=<token>`.
3. ה-webhook מקבל `/start <token>`, מקשר את ה-chat לחשבון, ומאשר בהודעה.

## אבטחה

- RLS על כל טבלה. כתיבות שדורשות בדיקה עוברות רק דרך Edge Functions.
- מפתח `anon` בלבד בתוסף ובאתר. מפתח השירות רק בפונקציות.
- מגבלות קצב בפונקציות לפי משתמש ולפי מזהה התקנה.
- דיווחי מחיר: מזהה התקנה אקראי, לא מקושר למשתמש, עם מגבלת קצב וזיהוי חריגים (מחיר שסוטה מאוד מהחציון לא מתקבל עד אישור נוסף).

## סביבות ובדיקות

- שני פרויקטים: פיתוח וייצור. משתני סביבה ב-`.env` (לא ב-git).
- בדיקות מתאם עם Vitest מול עמודים ומיילים שמורים ב-`tests/fixtures/`.
- בדיקות קצה עם Playwright שטוען את התוסף ובודק פס, פאנל ומצבים, על עמוד בהיר ועמוד כהה.
- לפני כל העלאה לחנות של Chrome: בדיקה ידנית על 10 עמודי מוצר אמיתיים.

## חנות Chrome

- מטרה יחידה וברורה: "ביקורות ומעקב מחירים לאתרי קניות".
- הסבר לכל הרשאה, וטופס גילוי פרטיות מלא.
- שם ואייקון בלי סימני מסחר של חנויות.
