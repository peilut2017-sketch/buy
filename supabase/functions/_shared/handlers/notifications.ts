// Delivery of queued notifications and the channels they go to. Spec 14, architecture "התראות" and "קישור טלגרם".

import { BAD_REQUEST, UNAUTHENTICATED, fail, isRecord, ok } from "../http.ts";
import { israelDate } from "../shabbat.ts";
import { planForUser, type Message } from "../notify.ts";
import { requireProfile, type Handler } from "./context.ts";

/** Midnight in Israel as an instant. Israel's offsets are whole hours, so stepping by the hour lands exactly on it. */
export function israelDayStart(now: Date): Date {
  const today = israelDate(now);
  let t = Date.UTC(today.year, today.month - 1, today.day) - 3 * 3_600_000;
  while (true) {
    const d = israelDate(new Date(t));
    if (d.year === today.year && d.month === today.month && d.day === today.day) return new Date(t);
    t += 3_600_000;
  }
}

const MAX_USERS_PER_RUN = 200;

/** Runs on a schedule (every few minutes) with the service key. */
export const sendNotifications: Handler = async (ctx) => {
  if (!ctx.isService) return fail(403, "הפעולה שמורה למערכת.");
  if (!ctx.hebcal) return fail(500, "השרת לא מוגדר לחישוב זמני שבת.");
  const summary = { users: 0, sent: 0, skipped: 0, deferred: 0, failed: 0 };
  const now = ctx.now.toISOString();
  await ctx.store.enqueueReminders(now);

  for (const userId of await ctx.store.listUsersWithQueued(MAX_USERS_PER_RUN)) {
    summary.users++;
    const items = await ctx.store.listQueuedForUser(userId);
    const context = await ctx.store.getNotifyContext(userId, israelDayStart(ctx.now).toISOString());
    const plan = planForUser(items, context, ctx.now, ctx.hebcal);

    await ctx.store.markQueue(plan.outcomes.filter((o) => o.status === "skip").map((o) => o.id), "skipped");
    summary.skipped += plan.outcomes.filter((o) => o.status === "skip").length;
    summary.deferred += plan.outcomes.filter((o) => o.status === "defer").length;

    const batchId = crypto.randomUUID();
    const delivered = new Set<number>();
    const failedIds = new Set<number>();
    for (const message of plan.messages) {
      const error = await deliver(ctx, message);
      await ctx.store.logNotification({
        userId,
        channel: message.channel,
        kind: message.itemIds.length === 1 ? (items.find((i) => i.id === message.itemIds[0])?.kind ?? "digest") : "digest",
        payload: { batchId, itemIds: message.itemIds, title: message.title, text: message.text, url: message.url },
        status: error ? "failed" : "sent",
        error,
        now,
      });
      for (const id of message.itemIds) (error ? failedIds : delivered).add(id);
    }
    // An item counts as sent if any channel took it; it fails only when every channel it was routed to failed.
    for (const id of delivered) failedIds.delete(id);
    await ctx.store.markQueue([...delivered], "sent");
    await ctx.store.markQueue([...failedIds], "failed");
    summary.sent += delivered.size;
    summary.failed += failedIds.size;
  }
  return ok(summary);
};

async function deliver(ctx: Parameters<Handler>[0], message: Message): Promise<string | null> {
  if (message.channel === "extension") return null; // the extension picks it up by polling
  try {
    if (!ctx.senders || !message.address) throw new Error("channel is not configured");
    const text = message.url ? `${message.text}\n${message.url}` : message.text;
    if (message.channel === "telegram") await ctx.senders.telegram(message.address, text);
    else if (message.channel === "email") await ctx.senders.email(message.address, message.title, message.text, message.url);
    else throw new Error(`channel ${message.channel} is not supported yet`);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.slice(0, 200) : "send failed";
  }
}

/** Creates the one-time link that connects a Telegram chat to the account (valid 15 minutes). */
export const telegramLink: Handler = async (ctx) => {
  const gate = await requireProfile(ctx);
  if ("response" in gate) return gate.response;
  if (!ctx.user) return UNAUTHENTICATED;
  if (!ctx.telegramBotUsername) return fail(503, "חיבור טלגרם עוד לא הוגדר.");
  const token = await ctx.store.createTelegramToken(ctx.user.id);
  return ok({ url: `https://t.me/${ctx.telegramBotUsername}?start=${token}`, expiresInMinutes: 15 });
};

const HELP = "כדי לחבר את הצ׳אט ל-SmartBuy, פתחו את ההגדרות ולחצו על \"חיבור טלגרם\".";

/** Telegram calls this for every message to the bot. It always answers 200, because Telegram retries anything else. */
export const telegramWebhook: Handler = async (ctx, body) => {
  if (!ctx.webhookVerified) return fail(403, "הבקשה לא אומתה.");
  if (!isRecord(body) || !isRecord(body.message) || !isRecord(body.message.chat)) return ok();
  const chatId = String(body.message.chat.id ?? "");
  const text = typeof body.message.text === "string" ? body.message.text.trim() : "";
  if (!chatId || !ctx.senders) return ok();
  const reply = (t: string) => ctx.senders?.telegram(chatId, t).catch(() => undefined);

  if (text.startsWith("/start")) {
    const token = text.slice(6).trim();
    if (!token) return (await reply(HELP), ok());
    const userId = await ctx.store.consumeTelegramToken(token, ctx.now.toISOString());
    if (!userId) return (await reply("הקישור לא תקף או שפג תוקפו. צרו קישור חדש בהגדרות."), ok());
    await ctx.store.upsertChannel({ userId, channel: "telegram", address: chatId, verified: true, enabled: true });
    await reply("החיבור הצליח. נשלח לכאן התראות על מחירים ומלאי לפי ההעדפות שלכם. לעצירה: /stop");
  } else if (text === "/stop") {
    const stopped = await ctx.store.disableChannelByAddress("telegram", chatId);
    await reply(stopped > 0 ? "ההתראות בטלגרם הופסקו. אפשר לחבר שוב בהגדרות." : HELP);
  } else {
    await reply(HELP);
  }
  return ok();
};

/** What the extension polls for, and acknowledges once it has shown a notification. */
export const extensionNotifications: Handler = async (ctx, body) => {
  const gate = await requireProfile(ctx);
  if ("response" in gate) return gate.response;
  if (!ctx.user || !isRecord(body)) return BAD_REQUEST;
  if (body.action === "poll") return ok({ notifications: await ctx.store.listExtensionPending(ctx.user.id, 10) });
  if (body.action === "ack" && Array.isArray(body.ids)) {
    const ids = body.ids.filter((i): i is number => typeof i === "number" && Number.isInteger(i) && i > 0).slice(0, 50);
    await ctx.store.ackExtension(ctx.user.id, ids, ctx.now.toISOString());
    return ok();
  }
  return BAD_REQUEST;
};

/** Switch email on (to the account's own address) or off. Telegram is connected through its link, and can only be switched off here. */
export const setChannel: Handler = async (ctx, body) => {
  const gate = await requireProfile(ctx);
  if ("response" in gate) return gate.response;
  if (!ctx.user || !isRecord(body) || typeof body.enabled !== "boolean") return BAD_REQUEST;
  if (body.channel === "email") {
    if (!ctx.user.email) return fail(409, "לחשבון אין כתובת מייל.");
    await ctx.store.upsertChannel({ userId: ctx.user.id, channel: "email", address: ctx.user.email, verified: true, enabled: body.enabled });
    return ok();
  }
  return BAD_REQUEST;
};
