# Supabase — הרצה ובדיקה

המיגרציות ב-`migrations/` הן מקור האמת לבסיס הנתונים, בפיתוח ובייצור. אין עריכות ידניות בלוח הבקרה של Supabase.

## מה נבדק ומה לא

- **נבדק:** `migrations/0001_init.sql` רצה על PostgreSQL 16 נקי עם תפקידים ו-`auth` מדומים (`tests/local_stub.sql`), ו-`tests/rls_smoke.sql` עבר במלואו.
- **לא נבדק:** הרצה על Supabase אמיתי (מקומי או בענן), `auth.users` האמיתית, והתחברות עם גוגל. הריצה הראשונה שם היא הבדיקה האמיתית. אם משהו נכשל, מתקנים את `0001_init.sql` במקום (היא עוד לא הורצה בשום סביבה) ומריצים שוב.

## סביבות

שני פרויקטים נפרדים (הוחלט ב-25.10.2026):

| סביבה | איפה | שימוש |
| --- | --- | --- |
| פיתוח | Supabase על השרת ב-Hetzner/Coolify, או `supabase start` במחשב | פיתוח ובדיקות |
| ייצור | Supabase בענן | משתמשים אמיתיים |

גרסת Postgres בשתי הסביבות צריכה להיות זהה ו-15 ומעלה (התצוגות משתמשות ב-`security_invoker`).

## הרצה מקומית עם Supabase CLI

דורש Docker.

```bash
supabase init          # פעם אחת. יוצר supabase/config.toml
supabase start
supabase db reset      # מריץ את כל המיגרציות מאפס
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/rls_smoke.sql
```

בבדיקה האחרונה אין צורך ב-`local_stub.sql`: ב-Supabase כבר יש תפקידים ו-`auth`.

## הרצה על Postgres רגיל (בדיקות בלבד)

```bash
createdb sb_test
psql -d sb_test -v ON_ERROR_STOP=1 -f supabase/tests/local_stub.sql
psql -d sb_test -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init.sql
psql -d sb_test -v ON_ERROR_STOP=1 -f supabase/tests/rls_smoke.sql
```

הבדיקה רצה בטרנזקציה ונגמרת ב-`ROLLBACK`, אז אפשר להריץ אותה שוב ושוב. בסוף היא מדפיסה `ALL SMOKE TESTS PASSED`.

## פרויקט בענן

1. ליצור פרויקט ב-supabase.com (ייצור) ולשמור את הסיסמה למסד הנתונים במנהל הסיסמאות.
2. `supabase link --project-ref <project-ref>` ואז `supabase db push`.
3. **התחברות:** בלוח הבקרה, Authentication, להפעיל Google (מזהה לקוח וסוד מ-Google Cloud Console) וקישור התחברות במייל. להגדיר Site URL וכתובות הפניה לאתר ולתוסף. אין לבקש הרשאת קריאה לגמייל.
4. **מפתחות:** מפתח `anon` בתוסף ובאתר. מפתח השירות (`service_role`) רק ב-Edge Functions. שניהם בקבצי `.env` שלא נכנסים ל-git.

## אחרי ההרצה הראשונה

**מנהל ראשון.** משתמשים לא יכולים לשנות תפקיד, אז מוסיפים מנהל ב-SQL Editor, אחרי שהוא נכנס פעם אחת עם גוגל:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = '<אימייל המנהל>');
```

**חישוב רמות מדרגים.** ביקורת נספרת רק 48 שעות אחרי כתיבתה, אז צריך משימה מתוזמנת שמריצה פעם בשעה:

```sql
select public.recompute_reviewer_stats();
```

אפשר עם `pg_cron` או עם Edge Function מתוזמנת. אחרי שינוי נקודתי (מחיקת ביקורת, סימון "מועיל") אפשר לקרוא עם מזהה משתמש.

**כללי התחלה.** `sites.adapter_config` של טרמינל איקס ריק עד שמסתיים מחקר שלב 0. גם `product_type` נקבע על ידי המתאם, ולכן הסוגים `apparel`, `footwear` ו-`general` ב-`category_questions` הם נקודת התחלה שתאושר מול הממצאים.

## כללים למיגרציות הבאות

1. קובץ חדש לכל שינוי (`0002_...`). לא עורכים מיגרציה שכבר הורצה.
2. כל טבלה חדשה: `enable row level security`, מדיניות מפורשת, והרשאות מפורשות ל-`anon`/`authenticated`. Supabase פותח טבלאות חדשות ל-API כברירת מחדל, וההסרה היא באחריות המיגרציה.
3. כל כתיבה שצריכה בדיקה, הגבלת קצב או תיעוד עוברת ב-Edge Function. לא נותנים הרשאת כתיבה ישירה ללקוח כדי "לחסוך פונקציה".
4. מוסיפים בדיקה ל-`tests/rls_smoke.sql` לכל מדיניות או הרשאת עמודה חדשה.
5. אל תוסיפו עמודות ל-`reviewer_public` בלי בדיקת פרטיות: היא רצה בהרשאות הבעלים.
