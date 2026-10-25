# SmartBuy

תוסף ל-Chrome ואתר שמוסיפים ביקורות אמינות ומעקב מחירים לאתרי קניות בישראל. מתחילים בטרמינל איקס.

## איך מתחילים עם Claude Code

1. פותחים את התיקייה במחשב ומאתחלים git:
   ```
   cd smartbuy
   git init
   git add -A
   git commit -m "Project spec and skills"
   ```
2. מפעילים את Claude Code בתוך התיקייה:
   ```
   claude
   ```
3. Claude Code קורא אוטומטית את `CLAUDE.md`, והסקילים שבתיקייה `.claude/skills/` זמינים לו מיד. אין צורך בהתקנה נוספת.
4. בודקים שהסקילים זמינים: שואלים את Claude Code "אילו סקילים זמינים לך בפרויקט?", וצריכים להופיע `apple-liquid-glass`, `frontend-design`, `hebrew-rtl-ui` ו-`site-adapter`.
5. מדביקים את ההנחיה הראשונה מתוך `docs/00-first-prompts.md`.

## מה יש בתיקייה

| קובץ | תוכן |
| --- | --- |
| `CLAUDE.md` | הנחיות עבודה ל-Claude Code: כללים, מבנה, סקילים |
| `docs/01-product-spec.md` | האפיון המלא של המוצר |
| `docs/02-design-system.md` | מערכת העיצוב (Liquid Glass, גריד, טוקנים) |
| `docs/03-architecture.md` | ארכיטקטורה, הרשאות וזרימת נתונים |
| `docs/04-data-model.md` | מבנה הנתונים |
| `supabase/migrations/0001_init.sql` | טיוטת סכמה למסד הנתונים |
| `docs/05-roadmap.md` | שלבים, משימות ותנאי סיום |
| `docs/06-research-checklist.md` | מה לבדוק באתר לפני כתיבת קוד |
| `docs/07-open-decisions.md` | החלטות פתוחות |
| `.claude/skills/` | סקילים לפרויקט |

## קישורים

- סקיצות העיצוב (פרטי, דורש שיתוף): https://claude.ai/artifact/PSqzxhmBocwuEB47CdjnWa
- מסמך התכנון (פרטי): https://claude.ai/artifact/Dc1Bgon1DvXwTrk17HT3Cf
