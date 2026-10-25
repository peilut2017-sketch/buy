// Admin screens for tracking, notifications and analytics (spec 19). Read-only: every number is counted by the database
// under the admin's own rights (RLS), so a moderator who opens the page by mistake sees zeros and not data.

import { ApiError, rest, restCount, type Identity } from "@smartbuy/data";
import { Button, Notice, SelectField, Skel, useResource } from "@smartbuy/ui";
import { useState } from "preact/hooks";

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();

function errorText(e: unknown): string {
  return e instanceof ApiError ? e.message : "הנתונים לא נטענו. בדקו את החיבור ונסו שוב.";
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div class="kpi"><strong>{typeof value === "number" ? value.toLocaleString("en-US") : value}</strong><span class="sb-t-support sb-secondary">{label}</span></div>
  );
}

/* ---------------------------------------------------------------- tracking and notifications */

const KIND_LABEL: Record<string, string> = {
  price_target: "מחיר יעד", price_drop: "ירידת מחיר באחוזים", restock: "חזרה למלאי", new_review_on_watch: "ביקורת חדשה במעקב",
  my_review_activity: "פעילות בביקורת שלי", moderation_decision: "החלטת פיקוח", weekly_digest: "סיכום שבועי",
  pending_review_reminder: "תזכורת לביקורת", durability_reminder: "תזכורת לעדכון", digest: "הודעה מאוחדת",
};
const CHANNELS = [{ id: "extension", label: "תוסף" }, { id: "telegram", label: "טלגרם" }, { id: "email", label: "מייל" }];

interface FailureRow { id: number; channel: string; kind: string; error: string | null; sent_at: string }

export function TrackingPanel({ identity }: { identity: Identity }) {
  const data = useResource(async () => {
    const since = iso(Date.now() - 7 * DAY);
    const count = (table: string, params: Record<string, string>) => restCount(table, params, identity.token);
    const [watches, sent, failed, perChannel, failures] = await Promise.all([
      count("watches", { active: "eq.true" }),
      count("notification_log", { status: "eq.sent", sent_at: `gte.${since}` }),
      count("notification_log", { status: "eq.failed", sent_at: `gte.${since}` }),
      Promise.all(CHANNELS.map(async (c) => ({ ...c, sent: await count("notification_log", { channel: `eq.${c.id}`, status: "eq.sent", sent_at: `gte.${since}` }), failed: await count("notification_log", { channel: `eq.${c.id}`, status: "eq.failed", sent_at: `gte.${since}` }) }))),
      rest<FailureRow[]>("notification_log", { params: { status: "eq.failed", select: "id,channel,kind,error,sent_at", order: "sent_at.desc", limit: 10 }, token: identity.token }),
    ]);
    return { watches, sent, failed, perChannel, failures };
  }, [identity.userId]);

  if (data.status === "loading") return <Skel width="100%" height="80px" />;
  if (data.status === "error") return <Notice kind="error" title={errorText(data.error)} action={<Button small onClick={data.reload}>ניסיון חוזר</Button>} />;
  const d = data.data;
  return (
    <div class="sb-stack sb-gap-3">
      <h2 class="sb-t-heading">7 ימים אחרונים</h2>
      <div class="kpis">
        <Kpi label="מעקבים פעילים" value={d.watches} />
        <Kpi label="התראות שנשלחו" value={d.sent} />
        <Kpi label="כשלי שליחה" value={d.failed} />
      </div>
      <table class="table">
        <caption class="sb-visually-hidden">התראות לפי ערוץ</caption>
        <thead><tr><th>ערוץ</th><th>נשלחו</th><th>נכשלו</th></tr></thead>
        <tbody>{d.perChannel.map((c) => <tr key={c.id}><td>{c.label}</td><td class="sb-num">{c.sent}</td><td class="sb-num">{c.failed}</td></tr>)}</tbody>
      </table>
      <h2 class="sb-t-heading">כשלים אחרונים</h2>
      {d.failures.length === 0 ? (
        <p class="sb-t-support sb-secondary">אין כשלי שליחה.</p>
      ) : (
        <table class="table">
          <thead><tr><th>מתי</th><th>ערוץ</th><th>סוג</th><th>שגיאה</th></tr></thead>
          <tbody>
            {d.failures.map((f) => (
              <tr key={f.id}>
                <td class="sb-num">{new Date(f.sent_at).toLocaleString("he-IL")}</td>
                <td>{CHANNELS.find((c) => c.id === f.channel)?.label ?? f.channel}</td>
                <td>{KIND_LABEL[f.kind] ?? f.kind}</td>
                <td><bdi dir="ltr">{f.error ?? "—"}</bdi></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p class="sb-t-support sb-secondary">שליחה חוזרת והשבתת ערוץ למשתמש עדיין לא קיימות. אחוז הקלקה לא נמדד: התוסף לא מדווח על לחיצות על התראות.</p>
    </div>
  );
}

/* ---------------------------------------------------------------- analytics */

const FUNNEL = [
  { event: "install", label: "התקנות" },
  { event: "first_product_view", label: "צפייה ראשונה בעמוד מוצר" },
  { event: "signup", label: "הרשמות" },
  { event: "review_submitted", label: "ביקורות" },
  { event: "watch_created", label: "מעקבים" },
];
const PLATFORMS = [{ id: "extension", label: "תוסף" }, { id: "web_desktop", label: "אתר במחשב" }, { id: "web_mobile", label: "אתר בטלפון" }];
const BREAKDOWN = [{ event: "product_view", label: "צפיות בעמודי מוצר" }, { event: "panel_open", label: "פתיחות פאנל" }, { event: "detect_failed", label: "כשלי זיהוי" }];
const PERIODS = [{ value: "7", label: "7 ימים" }, { value: "30", label: "30 יום" }, { value: "90", label: "90 יום" }];

interface RetentionRow { cohort: string; installs: number; week_1: number; week_4: number; week_12: number }
interface SiteRow { id: string; name: string }

const pct = (part: number, whole: number) => (whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`);
const change = (now: number, before: number) => {
  if (before === 0) return now === 0 ? "—" : "חדש";
  const percent = Math.round(((now - before) / before) * 100);
  return percent === 0 ? "ללא שינוי" : `${percent > 0 ? "+" : ""}${percent}%`;
};

function csv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return `﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}`;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function AnalyticsPanel({ identity }: { identity: Identity }) {
  const [days, setDays] = useState("30");
  const data = useResource(async () => {
    const n = Number(days);
    const now = Date.now();
    const range = (from: number, to: number) => `(occurred_at.gte.${iso(from)},occurred_at.lt.${iso(to)})`;
    const count = (params: Record<string, string>) => restCount("events", params, identity.token);
    const current = range(now - n * DAY, now + 60_000);
    const previous = range(now - 2 * n * DAY, now - n * DAY);

    const [sites, retention] = await Promise.all([
      rest<SiteRow[]>("sites", { params: { select: "id,name", order: "name.asc" }, token: identity.token }),
      rest<RetentionRow[]>("admin_retention", { params: { select: "*", order: "cohort.desc", limit: 12 }, token: identity.token }),
    ]);
    const funnel = await Promise.all(FUNNEL.map(async (f) => ({ ...f, now: await count({ event: `eq.${f.event}`, and: current }), before: await count({ event: `eq.${f.event}`, and: previous }) })));
    const bySite = await Promise.all(sites.map(async (s) => ({
      site: s,
      values: await Promise.all(BREAKDOWN.map((b) => count({ event: `eq.${b.event}`, site_id: `eq.${s.id}`, and: current }))),
    })));
    const byPlatform = await Promise.all(BREAKDOWN.map(async (b) => ({ ...b, values: await Promise.all(PLATFORMS.map((p) => count({ event: `eq.${b.event}`, platform: `eq.${p.id}`, and: current }))) })));
    return { funnel, bySite, byPlatform, retention };
  }, [identity.userId, days]);

  if (data.status === "loading") return <Skel width="100%" height="120px" />;
  if (data.status === "error") return <Notice kind="error" title={errorText(data.error)} action={<Button small onClick={data.reload}>ניסיון חוזר</Button>} />;
  const d = data.data;

  const exportCsv = () => {
    const rows: (string | number)[][] = [["קטע", "שורה", "עמודה", "ערך"]];
    for (const f of d.funnel) rows.push(["משפך", f.label, "תקופה נוכחית", f.now], ["משפך", f.label, "תקופה קודמת", f.before]);
    for (const s of d.bySite) BREAKDOWN.forEach((b, i) => rows.push(["לפי חנות", s.site.name, b.label, s.values[i] ?? 0]));
    for (const p of d.byPlatform) PLATFORMS.forEach((pl, i) => rows.push(["לפי פלטפורמה", p.label, pl.label, p.values[i] ?? 0]));
    for (const r of d.retention) rows.push(["שימור", r.cohort, "התקנות", r.installs], ["שימור", r.cohort, "שבוע 1", r.week_1], ["שימור", r.cohort, "שבוע 4", r.week_4], ["שימור", r.cohort, "שבוע 12", r.week_12]);
    download(`smartbuy-analytics-${days}d.csv`, csv(rows));
  };

  return (
    <div class="sb-stack sb-gap-4">
      <div class="sb-row sb-gap-3 sb-wrap" style={{ alignItems: "end" }}>
        <SelectField label="תקופה" value={days} onChange={setDays} options={PERIODS} />
        <Button onClick={exportCsv}>ייצוא CSV</Button>
      </div>

      <section class="sb-stack sb-gap-2" aria-labelledby="an-funnel">
        <h2 class="sb-t-heading" id="an-funnel">משפך</h2>
        <table class="table">
          <thead><tr><th>שלב</th><th>בתקופה</th><th>בתקופה הקודמת</th><th>שינוי</th><th>מהשלב הקודם</th></tr></thead>
          <tbody>
            {d.funnel.map((f, i) => (
              <tr key={f.event}>
                <td>{f.label}</td>
                <td class="sb-num">{f.now.toLocaleString("en-US")}</td>
                <td class="sb-num">{f.before.toLocaleString("en-US")}</td>
                <td class="sb-num"><bdi dir="ltr">{change(f.now, f.before)}</bdi></td>
                <td class="sb-num">{i === 0 ? "—" : pct(f.now, d.funnel[i - 1]?.now ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="sb-t-support sb-secondary">אלה ספירות אירועים בתקופה, לא מעקב אחרי אותם אנשים: התוסף לא קושר צפיות למשתמש (פרטיות). לכן "מהשלב הקודם" הוא יחס גס.</p>
      </section>

      <section class="sb-stack sb-gap-2" aria-labelledby="an-site">
        <h2 class="sb-t-heading" id="an-site">לפי חנות</h2>
        <table class="table">
          <thead><tr><th>חנות</th>{BREAKDOWN.map((b) => <th key={b.event}>{b.label}</th>)}</tr></thead>
          <tbody>{d.bySite.map((s) => <tr key={s.site.id}><td>{s.site.name}</td>{s.values.map((v, i) => <td key={i} class="sb-num">{v.toLocaleString("en-US")}</td>)}</tr>)}</tbody>
        </table>
      </section>

      <section class="sb-stack sb-gap-2" aria-labelledby="an-platform">
        <h2 class="sb-t-heading" id="an-platform">לפי פלטפורמה</h2>
        <table class="table">
          <thead><tr><th>מדד</th>{PLATFORMS.map((p) => <th key={p.id}>{p.label}</th>)}</tr></thead>
          <tbody>{d.byPlatform.map((r) => <tr key={r.event}><td>{r.label}</td>{r.values.map((v, i) => <td key={i} class="sb-num">{v.toLocaleString("en-US")}</td>)}</tr>)}</tbody>
        </table>
      </section>

      <section class="sb-stack sb-gap-2" aria-labelledby="an-retention">
        <h2 class="sb-t-heading" id="an-retention">שימור לפי שבוע התקנה</h2>
        {d.retention.length === 0 ? (
          <p class="sb-t-support sb-secondary">עוד אין התקנות לחישוב.</p>
        ) : (
          <table class="table">
            <thead><tr><th>שבוע התקנה</th><th>התקנות</th><th>שבוע 1</th><th>שבוע 4</th><th>שבוע 12</th></tr></thead>
            <tbody>
              {d.retention.map((r) => (
                <tr key={r.cohort}>
                  <td class="sb-num">{new Date(r.cohort).toLocaleDateString("he-IL")}</td>
                  <td class="sb-num">{r.installs}</td>
                  <td class="sb-num">{pct(r.week_1, r.installs)}</td>
                  <td class="sb-num">{pct(r.week_4, r.installs)}</td>
                  <td class="sb-num">{pct(r.week_12, r.installs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p class="sb-t-support sb-secondary">"פעיל" כאן אומר: פתח את הפאנל באותו שבוע. מי שרק רואה את הפס לא נספר, כי צפיות לא מקושרות להתקנה. המספרים הם גבול תחתון.</p>
      </section>
      <p class="sb-t-support sb-secondary">פילוח לפי קטגוריה, מותג, רמת מדרג, ומשתמש חדש מול חוזר עוד לא קיים.</p>
    </div>
  );
}
