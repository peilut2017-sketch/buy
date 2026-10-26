import { Button, Notice } from "@smartbuy/ui";
import { useState } from "preact/hooks";
import { PASSWORD_LOGIN_ENABLED, SUPABASE_ANON_KEY, SUPABASE_URL } from "../lib/env.ts";

interface Line {
  ok: boolean;
  text: string;
}

/** A one-click connection check for trial runs: says what the build was given and what the server answers. No secrets are shown. */
export function Diagnostics() {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const out: Line[] = [];
    const host = (() => {
      try {
        return new URL(SUPABASE_URL).host;
      } catch {
        return null;
      }
    })();
    out.push({ ok: SUPABASE_URL !== "" && host !== null, text: SUPABASE_URL === "" ? "בבנייה לא הוזנה כתובת שרת (WXT_SUPABASE_URL ריק)." : host ? `כתובת השרת בבנייה: ${host}` : "כתובת השרת בבנייה לא תקינה (חסר https://?)." });
    out.push({ ok: SUPABASE_ANON_KEY !== "", text: SUPABASE_ANON_KEY === "" ? "בבנייה לא הוזן מפתח anon." : `מפתח anon בבנייה: ${SUPABASE_ANON_KEY.length} תווים${SUPABASE_ANON_KEY.startsWith("eyJ") || SUPABASE_ANON_KEY.startsWith("sb_publishable_") ? "" : " (לא נראה כמו מפתח anon)"}.` });
    out.push({ ok: true, text: `כניסה עם סיסמה: ${PASSWORD_LOGIN_ENABLED ? "מופעלת" : "כבויה"}.` });

    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      const headers = { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${SUPABASE_ANON_KEY}` };
      const probe = async (label: string, url: string, init?: RequestInit, exists = false) => {
        try {
          const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(10_000) });
          const body = (await res.text()).slice(0, 160).replace(/\s+/g, " ");
          // For a function, any answer except "not found" and a server error proves it is deployed and running.
          const ok = exists ? res.status !== 404 && res.status < 500 : res.ok;
          out.push({ ok, text: `${label}: ${res.status}${ok ? "" : ` ${body}`}` });
          return ok ? body : null;
        } catch (e) {
          out.push({ ok: false, text: `${label}: אין תקשורת (${e instanceof Error ? e.message : "שגיאה"})` });
          return null;
        }
      };
      await probe("קריאת חנויות", `${SUPABASE_URL}/rest/v1/sites?select=id,status&limit=3`);
      await probe("סיכום מוצרים", `${SUPABASE_URL}/rest/v1/product_summary?select=product_id&limit=1`);
      await probe("שירות ההתחברות", `${SUPABASE_URL}/auth/v1/settings`);
      await probe("פונקציית אירועים", `${SUPABASE_URL}/functions/v1/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "ping" }) }, true);
    }
    setLines(out);
    setBusy(false);
  };

  return (
    <div class="sb-stack sb-gap-3">
      <p class="sb-t-support sb-secondary">בודק מה נבנה בתוסף ואם השרת עונה. אפשר לצלם את התוצאה ולשלוח.</p>
      <div><Button onClick={run} disabled={busy}>{busy ? "בודקים…" : "בדיקת חיבור"}</Button></div>
      {lines && (
        <ul class="sb-stack sb-gap-2" role="status" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {lines.map((l, i) => (
            <li key={i}><Notice kind={l.ok ? "success" : "error"}><bdi dir="auto">{l.ok ? "תקין. " : "בעיה. "}{l.text}</bdi></Notice></li>
          ))}
        </ul>
      )}
    </div>
  );
}
