# גרסת הרצה ניסיונית

המטרה: להריץ את SmartBuy על טרמינל איקס האמיתי, בדפדפן שלכם, מול Supabase משלכם. לא גרסה לחנות Chrome ולא לציבור.

**מה אי אפשר לעשות בלעדיכם:** ליצור פרויקט Supabase (צריך חשבון שלכם) ולהכניס את המפתחות. את כל השאר הכנתי, ובדקתי על Postgres מקומי ועל עמודים שמורים. **ההרצה הזו על האתר החי היא הבדיקה הראשונה מול השירותים האמיתיים**, אז צפויות תקלות קטנות. תעדו אותן ונתקן.

## בלי טרמינל: הכול מהדפדפן (GitHub Actions)
אם אין לכם טרמינל, שלבים 3 ו-4 למטה (פריסת פונקציות ובניית התוסף) רצים ב-GitHub:

1. ב-GitHub, במאגר: Settings, Secrets and variables, Actions, "New repository secret". ליצור ארבעה סודות:
   - `SUPABASE_ACCESS_TOKEN`: טוקן אישי מ-supabase.com/dashboard/account/tokens ("Generate new token").
   - `SUPABASE_PROJECT_REF`: `sinfarwyndkreufwpjiy`.
   - `SUPABASE_URL`: `https://sinfarwyndkreufwpjiy.supabase.co`.
   - `SUPABASE_ANON_KEY`: מפתח ה-anon (Project Settings, API). לא `service_role`.
2. לשונית Actions, "Trial build and deploy", "Run workflow", לבחור את הענף `claude/build-phase-1`. לסמן "Trial only: show the email + password sign-in" אם אין SMTP. להריץ.
3. כשהריצה ירוקה: בדף הריצה, בתחתית, Artifacts, להוריד `smartbuy-extension` ולפרוק את ה-ZIP לתיקייה.
4. בכרום: `chrome://extensions`, מצב מפתח, "טעינת תוסף שאינו ארוז", לבחור את התיקייה שפרקתם.

הטוקן והמפתחות נשארים ב-Secrets של GitHub ולא נכנסים לקוד. אחרי ההרצה אפשר למחוק את הטוקן ב-Supabase.

## עדכון פרויקט קיים (אחרי שינויים בקוד)
כשמתעדכנת גרסה שיש בה מיגרציה חדשה, צריך גם לעדכן את המסד:
1. ב-SQL Editor של הפרויקט להדביק ולהריץ את הקובץ של המיגרציה החדשה לבדה (למשל `supabase/migrations/0006_optional_answers.sql`, פעם אחת).
2. ב-GitHub Actions להריץ **Trial build and deploy** עם פריסת פונקציות ובניית תוסף, ולטעון את התוסף החדש.

## מה צריך
- Node 22 ו-pnpm (`corepack enable`), כרום.
- חשבון Supabase (שכבה חינמית מספיקה) ו-[Supabase CLI](https://supabase.com/docs/guides/cli).
- שם הפרויקט וה-ref שלו (מהכתובת `https://<ref>.supabase.co`).

## 1. מסד הנתונים
1. ב-supabase.com: New project. לשמור את סיסמת המסד.
2. `pnpm install` ואז:
   ```bash
   mkdir -p .trial && node scripts/make-trial-sql.mjs > supabase/trial-setup.sql
   ```
3. ב-Supabase: SQL Editor, להדביק את `supabase/trial-setup.sql` ולהריץ (פעם אחת, על פרויקט ריק). הקובץ מכיל את כל המיגרציות וכללי טרמינל איקס בסטטוס `beta`.

## 2. התחברות
בלוח הבקרה: Authentication, Providers, **Email** פעיל.
- ב-Authentication, Email Templates, "Magic Link": להחליף את התוכן כך שיכלול את הקוד: `הקוד שלכם: {{ .Token }}`. התוסף מבקש קוד בן ספרות ולא קישור.
- Authentication, URL Configuration: Site URL שווה לכתובת האתר (אם אין עדיין, כתובת ה-Pages שתקבלו בשלב 5).
- **בלי ספק מייל (SMTP):** Supabase נועל את תבניות המייל עד שמגדירים SMTP מותאם (למשל Resend: Host `smtp.resend.com`, Port 465, Username `resend`, הסיסמה היא מפתח ה-API, שולח `onboarding@resend.dev` שמגיע רק לכתובת של חשבון Resend). אם זה לא מסתדר, אפשר לדלג: ב-Authentication, Users, Add user, ליצור משתמש עם סיסמה ולסמן Auto Confirm. ב-`apps/extension/.env` להוסיף `WXT_TRIAL_PASSWORD_LOGIN=1`, ולבנות מחדש. בפאנל יופיע "כניסה עם סיסמה (גרסת הרצה)". אל תפיצו גרסה כזו לאחרים.
- Google: אופציונלי להרצה. דורש מזהה לקוח ב-Google Cloud והגדרת כתובת הפניה של התוסף (`chrome.identity.getRedirectURL()`). בלי זה אפשר להשתמש בקוד במייל.

## 3. פונקציות
```bash
supabase login
supabase link --project-ref <ref>
supabase secrets set ORDER_HASH_PEPPER=$(openssl rand -hex 32)
scripts/deploy-functions.sh
```
`ORDER_HASH_PEPPER` חובה: בלעדיו אימות הזמנות ודיווחי מחיר נדחים. אל תחליפו אותו אחרי שהתחילו לאמת הזמנות. טלגרם ומייל (Resend) אופציונליים: בלעדיהם ההתראות מגיעות רק דרך התוסף. הרשימה המלאה ב-`supabase/README.md`.

## 4. התוסף
```bash
cd apps/extension
cp .env.example .env
```
למלא ב-`.env`: `WXT_SUPABASE_URL` (Project URL), `WXT_SUPABASE_ANON_KEY` (מפתח anon, **לא** service_role), ואת `WXT_WEBSITE_URL` אם יש אתר. אז:
```bash
pnpm build        # או pnpm zip לקובץ ZIP
```
בכרום: `chrome://extensions`, מצב מפתח, "טעינת תוסף שאינו ארוז", לבחור `apps/extension/.output/chrome-mv3`. ייפתח מסך ברוכים הבאים: לאשר גישה ל-terminalx.com. מי שמתקין אחרי עדכון קוד צריך ללחוץ "טעינה מחדש" בעמוד התוספים.

## 5. האתר (אופציונלי)
האתר משמש לצפייה בביקורות מהטלפון, לחשבון ולניהול. הוא לא חובה לבדיקת התוסף.
```bash
cp apps/web/.env.example apps/web/.env   # WEB_SUPABASE_URL, WEB_SUPABASE_ANON_KEY
pnpm build:web                           # יוצר apps/web/dist
```
להעלות את `apps/web/dist` ל-Cloudflare Pages (`wrangler pages deploy apps/web/dist`) או לבדוק מקומית עם `node apps/web/serve.mjs`.

## 6. מנהל ראשון
להיכנס פעם אחת מהתוסף (קוד במייל), ואז ב-SQL Editor:
```sql
update public.profiles set role = 'admin' where id = (select id from auth.users where email = '<המייל שלכם>');
```
אחרי זה לוח הניהול באתר (`/admin`) פתוח לכם.

## 7. משימות מתוזמנות (אפשר לדלג בהרצה ראשונה)
בלי תזמון: אין התראות מחיר ואין סריקת מוצרים במעקב. דיווחי מחיר מהגלישה שלכם כן עובדים. להפעלה ידנית של בדיקה: `curl -X POST https://<ref>.supabase.co/functions/v1/scrape-watched -H "Authorization: Bearer <service_role>"`. תזמון קבוע ב-`supabase/README.md`.

## מה לבדוק בהרצה
1. **זיהוי:** לפתוח 10 עמודי מוצר מקטגוריות שונות (נשים, גברים, ילדים, ביוטי, הום). הפס צריך להופיע בכולם. בעמוד קטגוריה הוא לא אמור להופיע, וכוכבים יופיעו רק על מוצרים עם ביקורות.
2. **וריאנטים:** בטופס כתיבת ביקורת, הצבע והמידה אמורים להתמלא מהעמוד. להחליף צבע בעמוד ולפתוח שוב את הפאנל: הצבע בטופס מתעדכן.
3. **הרשמה:** כניסה עם קוד במייל, אישור תנאי שימוש, בחירת כינוי.
4. **ביקורת:** לכתוב ביקורת (30 תווים לפחות), לראות אותה עם "נרכש: צבע, מידה", לערוך, להוסיף עדכון, למחוק.
5. **מעקב:** להגדיר יעד מחיר מתחת למחיר הנוכחי, לראות גרף אחרי שמתחילים להצטבר נתונים.
6. **אם משהו לא מזוהה:** לשלוח לי את כתובת העמוד. בלוח הניהול, בחנויות, אחוז הזיהוי מראה כמה כשלים נרשמו.

## מגבלות ידועות בהרצה
- **הביקורות פומביות** לכל מי שמתקין את התוסף מול אותו Supabase. להשתמש בטקסט בדיקה שאפשר לראות.
- **אימות רכישה לא פעיל:** קריאת עמוד ההזמנות בתוסף עוד לא נכתבה (חסרה תגובת "פרטי הזמנה"). ביקורות יהיו "לא מאומתות".
- **תנאי הפרטיות והנגישות באתר הם טיוטות**, והשם SmartBuy זמני.
- **פריסת הפונקציות נבדקה רק בבדיקות מקומיות.** אם `supabase functions deploy` נכשל על ייבוא, שלחו לי את השגיאה.
- התחברות Google, טלגרם ומייל לא נבדקו מול השירותים האמיתיים.

## איסוף נתונים
התוסף שולח דיווחי מחיר ואירועי שימוש אנונימיים (בלי היסטוריית גלישה). פרטים ב-`docs/09-status.md`. להסרה: להסיר את התוסף, והסקר ב-`/bye` (אם הוגדר אתר) מופיע.
