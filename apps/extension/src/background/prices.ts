// Price and stock reports from the pages people already look at (spec 13). Anonymous, batched about once a minute,
// and only when something changed since this browser last reported it.

import { reportPrices, type PriceObservation } from "@smartbuy/data";
import { browser } from "wxt/browser";
import type { ProductSnapshot } from "../lib/messages.ts";
import { getSession, setSession } from "../lib/storage.ts";
import { installId } from "./events.ts";

const QUEUE_KEY = "priceQueue";
const LAST_KEY = "priceLast";
export const FLUSH_ALARM = "flush-prices";
const MAX_BATCH = 20;

export function toObservation(p: ProductSnapshot): PriceObservation | null {
  const price = p.price?.price ?? null;
  const inStock = p.price?.inStock ?? null;
  if (price === null && inStock === null) return null;
  return { siteId: p.siteId, sku: p.sku, parentSku: p.parentSku, price, inStock, currency: p.price?.currency ?? "ILS", variantValues: p.variantValues };
}

const signature = (o: PriceObservation) => `${o.price ?? ""}|${o.inStock ?? ""}`;

/** Queues an observation unless it equals the last one this browser reported for the same SKU. */
export async function queuePrice(product: ProductSnapshot): Promise<boolean> {
  const obs = toObservation(product);
  if (!obs) return false;
  const last = (await getSession<Record<string, string>>(LAST_KEY)) ?? {};
  const key = `${obs.siteId}:${obs.sku}`;
  if (last[key] === signature(obs)) return false;
  const queue = (await getSession<PriceObservation[]>(QUEUE_KEY)) ?? [];
  await setSession(QUEUE_KEY, [...queue.filter((q) => `${q.siteId}:${q.sku}` !== key), obs]);
  await setSession(LAST_KEY, { ...last, [key]: signature(obs) });
  await browser.alarms.create(FLUSH_ALARM, { delayInMinutes: 1 });
  return true;
}

export async function flushPrices(): Promise<void> {
  const queue = (await getSession<PriceObservation[]>(QUEUE_KEY)) ?? [];
  if (queue.length === 0) return;
  const batch = queue.slice(0, MAX_BATCH);
  await setSession(QUEUE_KEY, queue.slice(MAX_BATCH));
  try {
    await reportPrices(await installId(), batch);
  } catch {
    // Offline or refused: put the batch back, so the next change or alarm tries again.
    const rest = (await getSession<PriceObservation[]>(QUEUE_KEY)) ?? [];
    await setSession(QUEUE_KEY, [...batch, ...rest].slice(0, 100));
    await browser.alarms.create(FLUSH_ALARM, { delayInMinutes: 5 });
    return;
  }
  if (queue.length > MAX_BATCH) await browser.alarms.create(FLUSH_ALARM, { delayInMinutes: 1 });
}
