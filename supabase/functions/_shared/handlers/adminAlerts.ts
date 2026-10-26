import { evaluateAlerts } from "../alerts.ts";
import { fail, ok } from "../http.ts";
import type { Handler } from "./context.ts";

/** Runs every few minutes with the service key; looks at the last hour and alerts the admin on Telegram. */
export const adminAlerts: Handler = async (ctx) => {
  if (!ctx.isService) return fail(403, "הפעולה שמורה למערכת.");
  if (!ctx.adminChatId || !ctx.senders) return ok({ sent: 0, note: "alerts are not configured" });
  const base = await ctx.store.adminStats(new Date(ctx.now.getTime() - 3_600_000).toISOString());
  // The last price check counts only while it is recent, so one old refusal does not alert forever.
  const scrape = (await ctx.store.getPrivateSetting("scrape_state")) as { at?: string; blocked?: boolean } | null;
  const recent = scrape?.at ? ctx.now.getTime() - Date.parse(scrape.at) < 12 * 3_600_000 : false;
  const stats = { ...base, scrapeBlocked: recent && scrape?.blocked ? 1 : 0 };
  const last = ((await ctx.store.getPrivateSetting("admin_alert_state")) ?? {}) as Record<string, string>;
  const { alerts, state } = evaluateAlerts(stats, last, ctx.now);
  let sent = 0;
  for (const alert of alerts) {
    try {
      await ctx.senders.telegram(ctx.adminChatId, `SmartBuy: ${alert.text}`);
      sent++;
    } catch {
      delete state[alert.key]; // not delivered, so it may be tried again on the next run
    }
  }
  await ctx.store.setPrivateSetting("admin_alert_state", state);
  return ok({ sent });
};
