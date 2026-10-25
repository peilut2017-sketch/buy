// Price history, watches and notification settings. Same rules as data.ts: nothing invented, and every write is
// confirmed by the server before the caller hears it succeeded.

import type { PricePoint } from "@smartbuy/core";
import { ApiError, callFunction, rest } from "./rest.ts";

const SKU_SAFE = /^[a-z0-9_-]{1,40}$/i;
const safe = (sku: string): string => {
  if (!SKU_SAFE.test(sku)) throw new ApiError("invalid sku", 400);
  return sku;
};

export interface Watch {
  id: number;
  productId: number;
  variantId: number | null;
  targetPrice: number | null;
  dropPercent: number | null;
  notifyRestock: boolean;
  restockValues: Record<string, string> | null;
  active: boolean;
}

interface WatchRow {
  id: number;
  product_id: number;
  variant_id: number | null;
  target_price: number | string | null;
  drop_percent: number | null;
  notify_restock: boolean;
  restock_variant_values: Record<string, string> | null;
  active: boolean;
}

const WATCH_COLUMNS = "id,product_id,variant_id,target_price,drop_percent,notify_restock,restock_variant_values,active";

const toWatch = (r: WatchRow): Watch => ({
  id: Number(r.id),
  productId: Number(r.product_id),
  variantId: r.variant_id === null ? null : Number(r.variant_id),
  targetPrice: r.target_price === null ? null : Number(r.target_price),
  dropPercent: r.drop_percent,
  notifyRestock: r.notify_restock,
  restockValues: r.restock_variant_values,
  active: r.active,
});

export interface TrackingData {
  /** Null when nobody has viewed or reviewed the product yet, so there is no row to watch. */
  productId: number | null;
  variantId: number | null;
  points: PricePoint[];
  watch: Watch | null;
}

export async function getTracking(input: { siteId: string; parentSku: string; sku: string; token: string | null; userId: string | null; days?: number }): Promise<TrackingData> {
  const products = await rest<{ id: number }[]>("products", { params: { site_id: `eq.${input.siteId}`, parent_sku: `eq.${safe(input.parentSku)}`, select: "id", limit: 1 } });
  const productId = products[0] ? Number(products[0].id) : null;
  if (productId === null) return { productId: null, variantId: null, points: [], watch: null };

  const variants = await rest<{ id: number }[]>("variants", { params: { product_id: `eq.${productId}`, sku: `eq.${safe(input.sku)}`, select: "id", limit: 1 } });
  const variantId = variants[0] ? Number(variants[0].id) : null;

  // The window starts a bit early: the price in effect at the start of the window was set before it.
  const since = new Date(Date.now() - ((input.days ?? 90) + 400) * 86_400_000).toISOString();
  const [history, watches] = await Promise.all([
    variantId === null
      ? Promise.resolve([])
      : rest<{ observed_at: string; price: number | string | null; in_stock: boolean | null }[]>("price_history", { params: { variant_id: `eq.${variantId}`, observed_at: `gte.${since}`, select: "observed_at,price,in_stock", order: "observed_at.asc", limit: 2000 } }),
    input.token && input.userId
      ? rest<WatchRow[]>("watches", { params: { user_id: `eq.${input.userId}`, product_id: `eq.${productId}`, select: WATCH_COLUMNS }, token: input.token })
      : Promise.resolve([] as WatchRow[]),
  ]);
  const mine = watches.find((w) => w.variant_id === variantId) ?? watches[0];
  return {
    productId,
    variantId,
    points: history.map((h) => ({ at: h.observed_at, price: h.price === null ? null : Number(h.price), inStock: h.in_stock })),
    watch: mine ? toWatch(mine) : null,
  };
}

export class TargetTooHighError extends Error {}

export interface WatchInput {
  productId: number;
  variantId: number | null;
  targetPrice: number | null;
  dropPercent: number | null;
  notifyRestock: boolean;
  restockValues: Record<string, string> | null;
}

export async function saveWatch(token: string, userId: string, input: WatchInput, existingId: number | null): Promise<Watch> {
  const body = {
    product_id: input.productId,
    variant_id: input.variantId,
    target_price: input.targetPrice,
    drop_percent: input.dropPercent,
    notify_restock: input.notifyRestock,
    restock_variant_values: input.notifyRestock ? input.restockValues : null,
    active: true,
  };
  try {
    const rows =
      existingId === null
        ? await rest<WatchRow[]>("watches", { method: "POST", params: { select: WATCH_COLUMNS }, body: { ...body, user_id: userId }, token, prefer: "return=representation" })
        : await rest<WatchRow[]>("watches", { method: "PATCH", params: { id: `eq.${existingId}`, select: WATCH_COLUMNS }, body, token, prefer: "return=representation" });
    if (rows.length !== 1 || !rows[0]) throw new ApiError("not saved", 500);
    return toWatch(rows[0]);
  } catch (e) {
    if (e instanceof ApiError && /target_price_must_be_below_current/.test(e.message)) throw new TargetTooHighError();
    throw e;
  }
}

export async function deleteWatch(token: string, id: number): Promise<void> {
  const rows = await rest<unknown[]>("watches", { method: "DELETE", params: { id: `eq.${id}`, select: "id" }, token, prefer: "return=representation" });
  if (rows.length !== 1) throw new ApiError("not deleted", 500);
}

export interface WatchListItem extends Watch {
  product: { name: string | null; url: string | null; siteId: string; parentSku: string };
  sku: string | null;
}

export async function listWatches(token: string, userId: string): Promise<WatchListItem[]> {
  const rows = await rest<(WatchRow & { products: { name: string | null; url: string | null; site_id: string; parent_sku: string }; variants: { sku: string } | null })[]>("watches", {
    params: { user_id: `eq.${userId}`, active: "eq.true", select: `${WATCH_COLUMNS},products(name,url,site_id,parent_sku),variants(sku)`, order: "created_at.desc", limit: 50 },
    token,
  });
  return rows.map((r) => ({ ...toWatch(r), product: { name: r.products.name, url: r.products.url, siteId: r.products.site_id, parentSku: r.products.parent_sku }, sku: r.variants?.sku ?? null }));
}

/* ---------------------------------------------------------------- notification settings */

export type NotificationKind =
  | "price_target" | "price_drop" | "restock" | "new_review_on_watch" | "my_review_activity"
  | "moderation_decision" | "weekly_digest" | "pending_review_reminder" | "durability_reminder";
export type ChannelName = "extension" | "telegram" | "email" | "webpush";

export interface NotificationSettings {
  quietMode: boolean;
  quietHours: { from: string; to: string } | null;
  shabbatMode: boolean;
  shabbatCity: string | null;
  dailyCap: number;
  prefs: { kind: NotificationKind; enabled: boolean; channels: ChannelName[] }[];
  channels: { channel: ChannelName; enabled: boolean; verified: boolean }[];
}

export async function getNotificationSettings(token: string, userId: string): Promise<NotificationSettings> {
  const [profile, prefs, channels] = await Promise.all([
    rest<{ quiet_mode: boolean; quiet_hours: { from: string; to: string } | null; shabbat_mode: boolean; shabbat_city: string | null; daily_notification_cap: number }[]>("profiles", {
      params: { id: `eq.${userId}`, select: "quiet_mode,quiet_hours,shabbat_mode,shabbat_city,daily_notification_cap" },
      token,
    }),
    rest<{ kind: NotificationKind; enabled: boolean; channels: ChannelName[] }[]>("notification_prefs", { params: { user_id: `eq.${userId}`, select: "kind,enabled,channels" }, token }),
    rest<{ channel: ChannelName; enabled: boolean; verified: boolean }[]>("notification_channels", { params: { user_id: `eq.${userId}`, select: "channel,enabled,verified" }, token }),
  ]);
  const p = profile[0];
  return {
    quietMode: p?.quiet_mode ?? false,
    quietHours: p?.quiet_hours ?? null,
    shabbatMode: p?.shabbat_mode ?? false,
    shabbatCity: p?.shabbat_city ?? null,
    dailyCap: p?.daily_notification_cap ?? 3,
    prefs,
    channels,
  };
}

export async function updateProfileSettings(token: string, userId: string, patch: Partial<{ quiet_mode: boolean; quiet_hours: { from: string; to: string } | null; shabbat_mode: boolean; shabbat_city: string | null; daily_notification_cap: number }>): Promise<void> {
  const rows = await rest<unknown[]>("profiles", { method: "PATCH", params: { id: `eq.${userId}`, select: "id" }, body: patch, token, prefer: "return=representation" });
  if (rows.length !== 1) throw new ApiError("not saved", 500);
}

export async function updatePref(token: string, userId: string, kind: NotificationKind, patch: { enabled?: boolean; channels?: ChannelName[] }): Promise<void> {
  const rows = await rest<unknown[]>("notification_prefs", { method: "PATCH", params: { user_id: `eq.${userId}`, kind: `eq.${kind}`, select: "kind" }, body: patch, token, prefer: "return=representation" });
  if (rows.length !== 1) throw new ApiError("not saved", 500);
}

export async function toggleChannel(token: string, userId: string, channel: ChannelName, enabled: boolean): Promise<void> {
  if (channel === "email") {
    await callFunction("set-channel", { channel: "email", enabled }, token);
    return;
  }
  const rows = await rest<unknown[]>("notification_channels", { method: "PATCH", params: { user_id: `eq.${userId}`, channel: `eq.${channel}`, select: "channel" }, body: { enabled }, token, prefer: "return=representation" });
  if (rows.length !== 1) throw new ApiError("not saved", 500);
}

export function createTelegramLink(token: string): Promise<{ url: string; expiresInMinutes: number }> {
  return callFunction("telegram-link", {}, token);
}

export interface ExtensionNotice {
  id: number;
  title: string;
  text: string;
  url: string | null;
}

export async function pollExtensionNotifications(token: string): Promise<ExtensionNotice[]> {
  return (await callFunction<{ notifications: ExtensionNotice[] }>("extension-notifications", { action: "poll" }, token)).notifications;
}

export function ackExtensionNotifications(token: string, ids: number[]): Promise<unknown> {
  return callFunction("extension-notifications", { action: "ack", ids }, token);
}

export interface PriceObservation {
  siteId: string;
  sku: string;
  parentSku: string;
  price: number | null;
  inStock: boolean | null;
  currency: string;
  variantValues: Record<string, string>;
}

export function reportPrices(installId: string, items: PriceObservation[]): Promise<unknown> {
  return callFunction("report-prices", { installId, items });
}
