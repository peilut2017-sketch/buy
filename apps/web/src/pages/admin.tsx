import { formatDateHe } from "@smartbuy/core";
import { ApiError, callFunction, rest, restCount, type Identity } from "@smartbuy/data";
import { Button, ChoiceGroup, Notice, RequireAccount, Segmented, SelectField, Skel, TextArea, TextField, useResource } from "@smartbuy/ui";
import { useState } from "preact/hooks";
import { boot, setTitle } from "../lib/boot.tsx";
import { AnalyticsPanel, TrackingPanel } from "../lib/AdminInsights.tsx";
import { Shell } from "../shell.tsx";

type Tab = "overview" | "stores" | "moderation" | "users" | "tracking" | "analytics" | "audit";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "סקירה" },
  { id: "stores", label: "חנויות" },
  { id: "moderation", label: "פיקוח" },
  { id: "users", label: "משתמשים" },
  { id: "tracking", label: "מעקבים והתראות" },
  { id: "analytics", label: "ניתוח נתונים" },
  { id: "audit", label: "יומן" },
];

const moderate = (identity: Identity, body: Record<string, unknown>) => callFunction("moderate", body, identity.token);

function errorText(e: unknown): string {
  return e instanceof ApiError ? e.message : "הפעולה לא הושלמה. בדקו את החיבור ונסו שוב.";
}

const sinceDays = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/* ---------------------------------------------------------------- overview */

function Overview({ identity }: { identity: Identity }) {
  const data = useResource(async () => {
    const since = `gte.${sinceDays(7)}`;
    const count = (params: Record<string, string>, table = "events") => restCount(table, params, identity.token);
    const [installs, views, panels, reviews, failures, reports, appeals, takedowns] = await Promise.all([
      count({ event: "eq.install", occurred_at: since }),
      count({ event: "eq.product_view", occurred_at: since }),
      count({ event: "eq.panel_open", occurred_at: since }),
      count({ event: "eq.review_submitted", occurred_at: since }),
      count({ event: "eq.detect_failed", occurred_at: since }),
      count({ status: "eq.open" }, "reports"),
      count({ status: "eq.open" }, "appeals"),
      count({ status: "eq.open" }, "takedown_requests"),
    ]);
    return { installs, views, panels, reviews, failures, reports, appeals, takedowns };
  }, [identity.userId]);

  if (data.status === "loading") return <Skel width="100%" height="80px" />;
  if (data.status === "error") return <Notice kind="error" title={errorText(data.error)} action={<Button small onClick={data.reload}>ניסיון חוזר</Button>} />;
  const d = data.data;
  const kpi = (label: string, value: number) => (
    <div class="kpi"><strong>{value.toLocaleString("en-US")}</strong><span class="sb-t-support sb-secondary">{label}</span></div>
  );
  return (
    <div class="sb-stack sb-gap-3">
      <h2 class="sb-t-heading">7 ימים אחרונים</h2>
      <div class="kpis">
        {kpi("התקנות", d.installs)}
        {kpi("צפיות בעמודי מוצר", d.views)}
        {kpi("פתיחות פאנל", d.panels)}
        {kpi("ביקורות חדשות", d.reviews)}
        {kpi("כשלי זיהוי", d.failures)}
      </div>
      <h2 class="sb-t-heading">ממתינים לטיפול</h2>
      <div class="kpis">
        {kpi("דיווחים", d.reports)}
        {kpi("ערעורים", d.appeals)}
        {kpi("בקשות הסרה", d.takedowns)}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- stores */

interface SiteRow {
  id: string;
  name: string;
  status: "active" | "beta" | "paused";
  adapter_version: number;
  domains: string[];
}

const STATUS_TEXT = { active: "פעילה", beta: "בטא", paused: "מושהית" } as const;

function Stores({ identity, isAdmin }: { identity: Identity; isAdmin: boolean }) {
  const data = useResource(async () => {
    const sites = await rest<SiteRow[]>("sites", { params: { select: "id,name,status,adapter_version,domains", order: "name.asc" }, token: identity.token });
    const rows = await Promise.all(
      sites.map(async (s) => {
        const [views, failed] = await Promise.all([
          restCount("events", { site_id: `eq.${s.id}`, event: "eq.product_view", occurred_at: `gte.${sinceDays(7)}` }, identity.token),
          restCount("events", { site_id: `eq.${s.id}`, event: "eq.detect_failed", occurred_at: `gte.${sinceDays(7)}` }, identity.token),
        ]);
        return { ...s, views, failed };
      }),
    );
    return rows;
  }, [identity.userId]);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  if (data.status === "loading") return <Skel width="100%" height="80px" />;
  if (data.status === "error") return <Notice kind="error" title={errorText(data.error)} action={<Button small onClick={data.reload}>ניסיון חוזר</Button>} />;

  const setStatus = async (site: SiteRow, status: SiteRow["status"]) => {
    const emergency = status === "paused";
    if (emergency && !window.confirm(`להשהות את ${site.name}? התוסף יפסיק לפעול בחנות הזו אצל כל המשתמשים.`)) return;
    setMessage(null);
    try {
      const rows = await rest<unknown[]>("sites", { method: "PATCH", params: { id: `eq.${site.id}`, select: "id" }, body: { status }, token: identity.token, prefer: "return=representation" });
      if (rows.length !== 1) throw new ApiError("not saved", 500);
      setMessage({ kind: "success", text: `הסטטוס של ${site.name} עודכן ל${STATUS_TEXT[status]}.` });
      data.reload();
    } catch (e) {
      setMessage({ kind: "error", text: errorText(e) });
    }
  };

  return (
    <div class="sb-stack sb-gap-3">
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <table class="table">
        <thead><tr><th>חנות</th><th>סטטוס</th><th>זיהוי (7 ימים)</th><th>גרסת כללים</th><th><span class="sb-visually-hidden">פעולות</span></th></tr></thead>
        <tbody>
          {data.data.map((s) => {
            const total = s.views + s.failed;
            return (
              <tr key={s.id}>
                <td><strong>{s.name}</strong><br /><span class="sb-t-support sb-secondary"><bdi dir="ltr">{s.domains[0]}</bdi></span></td>
                <td>{STATUS_TEXT[s.status]}</td>
                <td class="sb-num">{total === 0 ? "אין נתונים" : `${Math.round((s.views / total) * 100)}% (${s.failed} כשלים)`}</td>
                <td class="sb-num">{s.adapter_version}</td>
                <td>
                  {isAdmin && (
                    <div class="sb-row sb-gap-1 sb-wrap">
                      {s.status !== "paused" ? <Button small variant="danger" onClick={() => setStatus(s, "paused")}>כיבוי חירום</Button> : <Button small onClick={() => setStatus(s, "beta")}>חידוש (בטא)</Button>}
                      {s.status === "beta" && <Button small onClick={() => setStatus(s, "active")}>הפעלה מלאה</Button>}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!isAdmin && <p class="sb-t-support sb-secondary">שינוי סטטוס שמור למנהל.</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- moderation */

interface ReportRow { id: number; review_id: number; reason: string; details: string | null; created_at: string }
interface AppealRow { id: number; review_id: number; body: string; created_at: string }
interface TakedownRow { id: number; review_id: number | null; requester_name: string; requester_email: string; reason: string; created_at: string }
interface ReviewRow { id: number; rating: number; title: string | null; body: string | null; status: string }

const REASON_TEXT: Record<string, string> = {
  spam: "ספאם או פרסומת", off_topic: "לא קשור למוצר", offensive: "תוכן פוגעני", personal_or_defamation: "פרטים אישיים או לשון הרע", fake: "נראית מזויפת", other: "אחר",
};

const REVIEW_STATUS_TEXT: Record<string, string> = { visible: "מוצגת", hidden: "מוסתרת", removed: "הוסרה", draft: "טיוטה" };

function ReviewPreview({ review }: { review: ReviewRow | undefined }) {
  if (!review) return <p class="sb-t-support sb-secondary">הביקורת לא נמצאה (ייתכן שנמחקה).</p>;
  return (
    <blockquote class="sb-stack" style={{ gap: "2px", borderInlineStart: "2px solid var(--sb-divider)", paddingInlineStart: "var(--space-3)" }}>
      <span class="sb-t-support sb-secondary">ביקורת <bdi dir="ltr">{review.id}</bdi> · {review.rating} כוכבים · {REVIEW_STATUS_TEXT[review.status] ?? review.status}</span>
      {review.title && <strong>{review.title}</strong>}
      <span class="sb-review__body">{review.body ?? "(בלי טקסט)"}</span>
    </blockquote>
  );
}

function Decision({ kind, onSubmit }: { kind: "report" | "appeal" | "takedown"; onSubmit: (value: { choice: string; note: string }) => Promise<void> }) {
  const options = kind === "appeal"
    ? [{ value: "accepted", label: "קבלת הערעור (החזרה לתצוגה)" }, { value: "rejected", label: "דחיית הערעור" }]
    : [{ value: "keep", label: "השארה" }, { value: "hide", label: "הסתרה" }, { value: "remove", label: "הסרה" }];
  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!choice) return setState({ busy: false, error: "בחרו החלטה." });
    if (note.trim().length < 3) return setState({ busy: false, error: "כל החלטה דורשת סיבה (לפחות 3 תווים)." });
    setState({ busy: true, error: null });
    try {
      await onSubmit({ choice, note: note.trim() });
    } catch (err) {
      setState({ busy: false, error: errorText(err) });
    }
  };
  return (
    <form class="sb-stack sb-gap-2" onSubmit={submit} noValidate>
      <ChoiceGroup legend="החלטה" options={options} value={choice} onChange={setChoice} disabled={state.busy} />
      <TextArea label="סיבה (נשמרת ביומן ומוצגת למעורבים)" value={note} onInput={setNote} rows={2} maxChars={500} disabled={state.busy} error={state.error ?? undefined} />
      <div><Button type="submit" variant="primary" small disabled={state.busy}>שמירת החלטה</Button></div>
    </form>
  );
}

function Moderation({ identity }: { identity: Identity }) {
  const data = useResource(async () => {
    const t = identity.token;
    const [reports, appeals, takedowns] = await Promise.all([
      rest<ReportRow[]>("reports", { params: { status: "eq.open", select: "id,review_id,reason,details,created_at", order: "created_at.asc", limit: 50 }, token: t }),
      rest<AppealRow[]>("appeals", { params: { status: "eq.open", select: "id,review_id,body,created_at", order: "created_at.asc", limit: 50 }, token: t }),
      rest<TakedownRow[]>("takedown_requests", { params: { status: "eq.open", select: "id,review_id,requester_name,requester_email,reason,created_at", order: "created_at.asc", limit: 50 }, token: t }),
    ]);
    const ids = [...new Set([...reports.map((r) => r.review_id), ...appeals.map((a) => a.review_id), ...takedowns.flatMap((x) => (x.review_id ? [x.review_id] : []))])];
    const reviews = ids.length ? await rest<ReviewRow[]>("reviews", { params: { id: `in.(${ids.join(",")})`, select: "id,rating,title,body,status" }, token: t }) : [];
    return { reports, appeals, takedowns, byId: new Map(reviews.map((r) => [r.id, r])) };
  }, [identity.userId]);

  if (data.status === "loading") return <Skel width="100%" height="80px" />;
  if (data.status === "error") return <Notice kind="error" title={errorText(data.error)} action={<Button small onClick={data.reload}>ניסיון חוזר</Button>} />;
  const { reports, appeals, takedowns, byId } = data.data;
  if (reports.length + appeals.length + takedowns.length === 0) return <Notice kind="empty" title="התור ריק">אין דיווחים, ערעורים או בקשות הסרה שממתינים לטיפול.</Notice>;

  const item = (key: string, title: string, children: preact.ComponentChildren) => (
    <li key={key} class="sb-stack sb-gap-2" style={{ paddingBlock: "var(--space-4)" }}>
      <strong class="sb-t-heading">{title}</strong>
      {children}
    </li>
  );

  return (
    <ul class="sb-list">
      {reports.map((r) =>
        item(`r${r.id}`, `דיווח: ${REASON_TEXT[r.reason] ?? r.reason}`, (
          <>
            {r.details && <p class="sb-t-body">{r.details}</p>}
            <p class="sb-t-support sb-secondary">{formatDateHe(r.created_at)}</p>
            <ReviewPreview review={byId.get(r.review_id)} />
            <Decision kind="report" onSubmit={async ({ choice, note }) => { await moderate(identity, { action: "decide_report", reportId: r.id, decision: choice === "keep" ? "dismissed" : "upheld", reviewAction: choice, note }); data.reload(); }} />
          </>
        )),
      )}
      {appeals.map((a) =>
        item(`a${a.id}`, "ערעור של כותב", (
          <>
            <p class="sb-t-body">{a.body}</p>
            <ReviewPreview review={byId.get(a.review_id)} />
            <Decision kind="appeal" onSubmit={async ({ choice, note }) => { await moderate(identity, { action: "decide_appeal", appealId: a.id, decision: choice, note }); data.reload(); }} />
          </>
        )),
      )}
      {takedowns.map((t) =>
        item(`t${t.id}`, `בקשת הסרה מ${t.requester_name}`, (
          <>
            <p class="sb-t-support sb-secondary"><bdi dir="ltr">{t.requester_email}</bdi> · {formatDateHe(t.created_at)}</p>
            <p class="sb-t-body">{t.reason}</p>
            {t.review_id && <ReviewPreview review={byId.get(t.review_id)} />}
            <Decision kind="takedown" onSubmit={async ({ choice, note }) => { await moderate(identity, { action: "decide_takedown", takedownId: t.id, decision: choice === "keep" ? "dismissed" : "upheld", reviewAction: choice, note }); data.reload(); }} />
          </>
        )),
      )}
    </ul>
  );
}

/* ---------------------------------------------------------------- users */

interface UserRow { id: string; display_name: string | null; role: string; blocked_at: string | null; created_at: string }

function Users({ identity, isAdmin }: { identity: Identity; isAdmin: boolean }) {
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const data = useResource(
    () => rest<UserRow[]>("profiles", { params: { select: "id,display_name,role,blocked_at,created_at", ...(applied ? { display_name: `ilike.*${applied.replace(/[*,()]/g, "")}*` } : {}), order: "created_at.desc", limit: 20 }, token: identity.token }),
    [identity.userId, applied],
  );
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});

  const act = async (body: Record<string, unknown>, okText: string) => {
    const note = window.prompt("סיבה (לפחות 3 תווים):") ?? "";
    if (note.trim().length < 3) return setMessage({ kind: "error", text: "כל פעולה דורשת סיבה." });
    setMessage(null);
    try {
      await moderate(identity, { ...body, note: note.trim() });
      setMessage({ kind: "success", text: okText });
      data.reload();
    } catch (e) {
      setMessage({ kind: "error", text: errorText(e) });
    }
  };

  return (
    <div class="sb-stack sb-gap-3">
      <form class="search" onSubmit={(e) => (e.preventDefault(), setApplied(query.trim()))}>
        <TextField label="חיפוש לפי כינוי" value={query} onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
        <div style={{ alignSelf: "flex-start", paddingBlockStart: "22px" }}><Button type="submit" icon="search">חיפוש</Button></div>
      </form>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {data.status === "loading" && <Skel width="100%" height="48px" />}
      {data.status === "error" && <Notice kind="error" title={errorText(data.error)} action={<Button small onClick={data.reload}>ניסיון חוזר</Button>} />}
      {data.status === "ready" && data.data.length === 0 && <Notice kind="empty" title="לא נמצאו משתמשים" />}
      {data.status === "ready" && data.data.length > 0 && (
        <table class="table">
          <thead><tr><th>כינוי</th><th>תפקיד</th><th>הצטרפות</th><th><span class="sb-visually-hidden">פעולות</span></th></tr></thead>
          <tbody>
            {data.data.map((u) => (
              <tr key={u.id}>
                <td>{u.display_name ?? "(בלי כינוי)"}{u.blocked_at ? " · חסום" : ""}</td>
                <td>{u.role === "admin" ? "מנהל" : u.role === "moderator" ? "מפקח" : "משתמש"}</td>
                <td>{formatDateHe(u.created_at)}</td>
                <td>
                  {isAdmin && (
                    <div class="sb-row sb-gap-1 sb-wrap">
                      <SelectField label="תפקיד" value={roles[u.id] ?? u.role} onChange={(v) => setRoles({ ...roles, [u.id]: v })} options={[{ value: "user", label: "משתמש" }, { value: "moderator", label: "מפקח" }, { value: "admin", label: "מנהל" }]} />
                      <Button small disabled={(roles[u.id] ?? u.role) === u.role} onClick={() => act({ action: "set_role", userId: u.id, role: roles[u.id] }, "התפקיד עודכן.")}>שמירת תפקיד</Button>
                      <Button small variant={u.blocked_at ? "secondary" : "danger"} onClick={() => act({ action: "set_blocked", userId: u.id, blocked: !u.blocked_at }, u.blocked_at ? "החסימה הוסרה." : "המשתמש נחסם.")}>{u.blocked_at ? "ביטול חסימה" : "חסימה"}</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- audit */

interface AuditRow { id: number; action: string; target_type: string; target_id: string; created_at: string; details: Record<string, unknown> | null }

function Audit({ identity }: { identity: Identity }) {
  const data = useResource(() => rest<AuditRow[]>("admin_audit_log", { params: { select: "id,action,target_type,target_id,created_at,details", order: "created_at.desc", limit: 50 }, token: identity.token }), [identity.userId]);
  if (data.status === "loading") return <Skel width="100%" height="80px" />;
  if (data.status === "error") return <Notice kind="error" title={errorText(data.error)} action={<Button small onClick={data.reload}>ניסיון חוזר</Button>} />;
  if (data.data.length === 0) return <Notice kind="empty" title="היומן ריק" />;
  return (
    <table class="table">
      <thead><tr><th>מתי</th><th>פעולה</th><th>יעד</th><th>סיבה</th></tr></thead>
      <tbody>
        {data.data.map((r) => (
          <tr key={r.id}>
            <td>{formatDateHe(r.created_at)}</td>
            <td><bdi dir="ltr">{r.action}</bdi></td>
            <td>{r.target_type} <bdi dir="ltr">{r.target_id}</bdi></td>
            <td>{typeof r.details?.reason === "string" ? r.details.reason : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------------------------------------------------------- page */

function Panels({ identity, role }: { identity: Identity; role: "moderator" | "admin" }) {
  const [tab, setTab] = useState<Tab>("overview");
  const isAdmin = role === "admin";
  // Only admins may read events and the audit log, so moderators get the queue, the stores list and users.
  const tabs = isAdmin ? TABS : TABS.filter((t) => t.id === "moderation" || t.id === "users" || t.id === "stores");
  const current = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? "moderation");
  return (
    <div class="sb-stack sb-gap-4">
      <div class="admin-tabs"><Segmented items={tabs} value={current} onChange={setTab} label="אזורי ניהול" /></div>
      <div class="web__card" role="tabpanel" id={`sb-panel-${current}`} aria-labelledby={`sb-tab-${current}`}>
        {current === "overview" && <Overview identity={identity} />}
        {current === "stores" && <Stores identity={identity} isAdmin={isAdmin} />}
        {current === "moderation" && <Moderation identity={identity} />}
        {current === "users" && <Users identity={identity} isAdmin={isAdmin} />}
        {current === "tracking" && <TrackingPanel identity={identity} />}
        {current === "analytics" && <AnalyticsPanel identity={identity} />}
        {current === "audit" && <Audit identity={identity} />}
      </div>
    </div>
  );
}

function StaffGate({ identity }: { identity: Identity }) {
  const role = useResource(async () => (await rest<{ role: string }[]>("profiles", { params: { id: `eq.${identity.userId}`, select: "role" }, token: identity.token }))[0]?.role ?? "user", [identity.userId]);
  if (role.status === "loading") return <Skel width="100%" height="48px" />;
  if (role.status === "error") return <Notice kind="error" title={errorText(role.error)} action={<Button small onClick={role.reload}>ניסיון חוזר</Button>} />;
  if (role.data !== "admin" && role.data !== "moderator") return <Notice kind="error" title="אין הרשאה">העמוד הזה שמור לצוות הפיקוח והניהול.</Notice>;
  return <Panels identity={identity} role={role.data} />;
}

function Admin() {
  setTitle("ניהול");
  return (
    <Shell wide>
      <h1 class="sb-t-name" style={{ fontSize: "24px", lineHeight: "30px" }}>לוח ניהול</h1>
      <RequireAccount reason="הכניסה ללוח הניהול דורשת התחברות.">{({ identity }) => <StaffGate identity={identity} />}</RequireAccount>
    </Shell>
  );
}

boot(<Admin />);
