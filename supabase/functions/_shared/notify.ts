// Notification planning (spec 14). Pure: given what is queued for one user and their settings, decide what is sent now,
// what waits, and what is dropped. The same message text is used for every channel.

import { formatIls } from "./notify-format.ts";
import { cityById, shabbatEndsAt, TIMEZONE, type HebcalLike } from "./shabbat.ts";

export type NotificationKind =
  | "price_target"
  | "price_drop"
  | "restock"
  | "new_review_on_watch"
  | "my_review_activity"
  | "moderation_decision"
  | "weekly_digest"
  | "pending_review_reminder"
  | "durability_reminder";

export type ChannelName = "extension" | "telegram" | "email" | "webpush";

export interface QueuedItem {
  id: number;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface UserSettings {
  quietMode: boolean;
  quietHours: { from: string; to: string } | null;
  shabbatMode: boolean;
  shabbatCity: string | null;
  dailyCap: number;
}

export interface PrefsByKind {
  [kind: string]: { enabled: boolean; channels: ChannelName[] } | undefined;
}

export interface ChannelRow {
  channel: ChannelName;
  enabled: boolean;
  verified: boolean;
  address: string | null;
}

export interface UserContext {
  settings: UserSettings;
  prefs: PrefsByKind;
  channels: ChannelRow[];
  /** Merged messages already sent today (Israel date). The daily cap counts these. */
  messagesToday: number;
}

export type Outcome =
  | { id: number; status: "send"; channels: ChannelName[] }
  | { id: number; status: "skip"; reason: "pref_disabled" | "quiet_mode" | "no_channel" | "expired" }
  | { id: number; status: "defer"; reason: "quiet_hours" | "shabbat" | "daily_cap"; until: Date | null };

export interface Message {
  channel: ChannelName;
  address: string | null;
  title: string;
  text: string;
  itemIds: number[];
  /** First product link in the batch, so one tap opens something useful. */
  url: string | null;
}

export interface Plan {
  outcomes: Outcome[];
  messages: Message[];
}

/** Queued items older than this are dropped instead of delivered late (a price alert two days later is noise). */
export const EXPIRES_AFTER_MS = 48 * 3_600_000;

function minutesOfDay(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function israelMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour")?.value) * 60 + Number(parts.find((p) => p.type === "minute")?.value);
}

/** When the quiet hours end, if `now` is inside them. A window that wraps midnight (22:00 to 08:00) is supported. */
export function quietHoursEnd(now: Date, hours: UserSettings["quietHours"]): Date | null {
  if (!hours) return null;
  const from = minutesOfDay(hours.from);
  const to = minutesOfDay(hours.to);
  if (from === null || to === null || from === to) return null;
  const t = israelMinutes(now);
  const inside = from < to ? t >= from && t < to : t >= from || t < to;
  if (!inside) return null;
  const remaining = (to - t + 1440) % 1440;
  return new Date(now.getTime() + (remaining === 0 ? 1440 : remaining) * 60_000);
}

export function planForUser(items: readonly QueuedItem[], user: UserContext, now: Date, hebcal: HebcalLike): Plan {
  const outcomes: Outcome[] = [];
  const live: QueuedItem[] = [];

  for (const item of items) {
    if (now.getTime() - Date.parse(item.createdAt) > EXPIRES_AFTER_MS) {
      outcomes.push({ id: item.id, status: "skip", reason: "expired" });
    } else if (user.prefs[item.kind]?.enabled === false) {
      outcomes.push({ id: item.id, status: "skip", reason: "pref_disabled" });
    } else if (user.settings.quietMode) {
      outcomes.push({ id: item.id, status: "skip", reason: "quiet_mode" });
    } else {
      live.push(item);
    }
  }
  if (live.length === 0) return { outcomes, messages: [] };

  const quietUntil = quietHoursEnd(now, user.settings.quietHours);
  if (quietUntil) {
    for (const item of live) outcomes.push({ id: item.id, status: "defer", reason: "quiet_hours", until: quietUntil });
    return { outcomes, messages: [] };
  }
  const shabbatUntil = user.settings.shabbatMode ? shabbatEndsAt(now, cityById(user.settings.shabbatCity), hebcal) : null;
  if (shabbatUntil) {
    for (const item of live) outcomes.push({ id: item.id, status: "defer", reason: "shabbat", until: shabbatUntil });
    return { outcomes, messages: [] };
  }

  const usable = user.channels.filter((c) => c.enabled && c.verified && (c.channel === "extension" || (c.address ?? "") !== ""));
  const routed: { item: QueuedItem; channels: ChannelName[] }[] = [];
  for (const item of live) {
    const wanted = user.prefs[item.kind]?.channels ?? ["extension"];
    const channels = usable.filter((c) => wanted.includes(c.channel)).map((c) => c.channel);
    if (channels.length === 0) outcomes.push({ id: item.id, status: "skip", reason: "no_channel" });
    else routed.push({ item, channels });
  }
  if (routed.length === 0) return { outcomes, messages: [] };

  if (user.messagesToday >= user.settings.dailyCap) {
    for (const { item } of routed) outcomes.push({ id: item.id, status: "defer", reason: "daily_cap", until: null });
    return { outcomes, messages: [] };
  }

  // One merged message per channel, however many items arrived in this run.
  const messages: Message[] = [];
  const channelNames = [...new Set(routed.flatMap((r) => r.channels))];
  for (const channel of channelNames) {
    const forChannel = routed.filter((r) => r.channels.includes(channel)).map((r) => r.item);
    const built = buildMessage(forChannel);
    messages.push({ channel, address: usable.find((c) => c.channel === channel)?.address ?? null, itemIds: forChannel.map((i) => i.id), ...built });
  }
  for (const { item, channels } of routed) outcomes.push({ id: item.id, status: "send", channels });
  return { outcomes, messages };
}

/* ---------------------------------------------------------------- message text */

const name = (p: Record<string, unknown>): string => (typeof p.name === "string" && p.name !== "" ? p.name : "מוצר שאתם עוקבים אחריו");
const price = (v: unknown): string | null => (typeof v === "number" ? formatIls(v) : typeof v === "string" && v !== "" ? formatIls(Number(v)) : null);

/** One line per item, in the product's voice: what happened and the number that matters. */
export function describe(item: QueuedItem): string {
  const p = item.payload;
  switch (item.kind) {
    case "price_target":
      return `${name(p)}: המחיר ירד ל-${price(p.price)}, בדיוק ביעד שקבעתם (${price(p.targetPrice)}).`;
    case "price_drop":
      return `${name(p)}: המחיר ירד ב-${p.dropPercent}% ומגיע ל-${price(p.price)}${price(p.previousPrice) ? ` (היה ${price(p.previousPrice)})` : ""}.`;
    case "restock":
      return `${name(p)}: חזר למלאי.`;
    case "new_review_on_watch":
      return `${name(p)}: נוספה ביקורת חדשה (${p.rating} כוכבים).`;
    case "my_review_activity":
      return `${name(p)}: מישהו סימן את הביקורת שלכם כמועילה.`;
    case "moderation_decision":
      return typeof p.reason === "string" ? `עדכון על ביקורת או דיווח שלכם: ${p.reason}` : "יש עדכון על ביקורת או דיווח שלכם.";
    case "pending_review_reminder":
      return `${p.count === 1 ? "מוצר אחד שקניתם מחכה" : `${p.count} מוצרים שקניתם מחכים`} לביקורת.`;
    case "durability_reminder":
      return `${name(p)}: איך המוצר מחזיק אחרי כמה חודשים? אפשר להוסיף עדכון לביקורת.`;
    case "weekly_digest": {
      const changes = Array.isArray(p.changes) ? (p.changes as Record<string, unknown>[]) : [];
      if (changes.length === 0) return "סיכום שבועי: אין שינויי מחיר במוצרים שאתם עוקבים אחריהם.";
      const lines = changes.slice(0, 5).map((c) => `${name(c)}: ${price(c.from) ?? "?"} → ${price(c.to) ?? "?"}`);
      const more = changes.length > 5 ? ` ועוד ${changes.length - 5}` : "";
      return `סיכום שבועי, ${changes.length === 1 ? "מוצר אחד השתנה" : `${changes.length} מוצרים השתנו`} מתוך ${p.watching ?? changes.length} במעקב: ${lines.join("; ")}${more}.`;
    }
  }
}

export function buildMessage(items: readonly QueuedItem[]): { title: string; text: string; url: string | null } {
  const url = items.map((i) => i.payload.url).find((u): u is string => typeof u === "string" && u.startsWith("https://")) ?? null;
  if (items.length === 1) {
    const only = items[0] as QueuedItem;
    return { title: "SmartBuy", text: describe(only), url };
  }
  return { title: `SmartBuy: ${items.length} עדכונים`, text: items.map((i) => `• ${describe(i)}`).join("\n"), url };
}
