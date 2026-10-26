// Alerts to the admin on Telegram (spec 19): a sharp drop in detection, failing notifications, a spike in reports,
// a suspicious wave of reviews. Pure: stats and the last-alert times in, alerts and the new times out.

import type { AdminStats } from "./store.ts";

export interface Alert {
  key: string;
  text: string;
}

export const MIN_VIEWS_FOR_RATE = 20;
export const DETECTION_FAILURE_ALERT = 0.3;
export const FAILED_NOTIFICATIONS_ALERT = 5;
export const REPORTS_ALERT = 10;
/** The same alert is not repeated within this time. */
export const REPEAT_AFTER_MS = 6 * 3_600_000;

export function evaluateAlerts(stats: AdminStats, lastSent: Record<string, string>, now: Date): { alerts: Alert[]; state: Record<string, string> } {
  const found: Alert[] = [];
  for (const s of stats.perSite) {
    const total = s.views + s.failed;
    if (total >= MIN_VIEWS_FOR_RATE && s.failed / total > DETECTION_FAILURE_ALERT) {
      found.push({ key: `detect:${s.siteId}`, text: `ירידה חדה בשיעור הזיהוי ב-${s.siteId}: ${s.failed} כשלים מתוך ${total} בשעה האחרונה.` });
    }
  }
  if (stats.failedNotifications >= FAILED_NOTIFICATIONS_ALERT) found.push({ key: "notify-failed", text: `${stats.failedNotifications} התראות נכשלו בשליחה בשעה האחרונה.` });
  if (stats.newReports >= REPORTS_ALERT) found.push({ key: "reports", text: `קפיצה בדיווחים: ${stats.newReports} דיווחים חדשים בשעה האחרונה.` });
  if (stats.scrapeBlocked) found.push({ key: "scrape-blocked", text: "בדיקת המחירים האוטומטית נחסמה על ידי החנות. הסריקה נעצרה. כדאי לבדוק את הלוג ואת התנאים מול החנות." });
  if (stats.newWaveFlags > 0) found.push({ key: "review-wave", text: `זוהה גל ביקורות חשוד (${stats.newWaveFlags}). כדאי לבדוק בתור הפיקוח.` });

  const state = { ...lastSent };
  const alerts: Alert[] = [];
  for (const alert of found) {
    const last = lastSent[alert.key] ? Date.parse(lastSent[alert.key] as string) : 0;
    if (now.getTime() - last >= REPEAT_AFTER_MS) {
      alerts.push(alert);
      state[alert.key] = now.toISOString();
    }
  }
  return { alerts, state };
}
