// Price and stock reports from the extension (spec 13). Anonymous: an install id and nothing about the user.
// Only CHANGES are stored. A price far from the recent median is held until a second, independent install reports it.

import { BAD_REQUEST, dayStart, fail, isRecord, ok } from "../http.ts";
import { checkParentSku, cleanSku, cleanVariantValues, type Handler } from "./context.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 20;
const MAX_PRICE = 100_000;

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : (((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const reportPrices: Handler = async (ctx, body) => {
  if (!isRecord(body) || !Array.isArray(body.items)) return BAD_REQUEST;
  if (typeof body.installId !== "string" || !UUID.test(body.installId)) return fail(400, "חסר מזהה התקנה.");
  if (!ctx.pepper) return fail(500, "השרת לא מוגדר לדיווחי מחיר.");
  if (body.items.length === 0 || body.items.length > MAX_ITEMS) return fail(400, "מספר הפריטים בבקשה לא תקין.");

  const settings = await ctx.store.getSettings();
  const installHash = await sha256Hex(`${body.installId.toLowerCase()}:${ctx.pepper}`);
  const now = ctx.now.toISOString();
  const today = dayStart(ctx.now);
  let used = await ctx.store.countPriceEventsByInstallSince(installHash, today);
  const result = { accepted: 0, unchanged: 0, pendingConfirmation: 0, rejected: 0 };

  for (const raw of body.items as unknown[]) {
    if (!isRecord(raw)) {
      result.rejected++;
      continue;
    }
    if (used >= settings.priceReports.perInstallPerDay) return fail(429, "יותר מדי דיווחים להיום.");

    const sku = cleanSku(raw.sku);
    const parentSku = cleanSku(raw.parentSku);
    const price = typeof raw.price === "number" && Number.isFinite(raw.price) && raw.price > 0 && raw.price <= MAX_PRICE ? Math.round(raw.price * 100) / 100 : null;
    const inStock = typeof raw.inStock === "boolean" ? raw.inStock : null;
    const site = typeof raw.siteId === "string" ? await ctx.store.getSite(raw.siteId) : null;
    if (!sku || !parentSku || !site || site.status === "paused" || !site.adapterConfig.productType || (price === null && inStock === null)) {
      result.rejected++;
      continue;
    }
    if (!checkParentSku(sku, parentSku, site.adapterConfig.parentSku?.fromSku)) {
      result.rejected++;
      continue;
    }

    const product = await ctx.store.upsertProduct({ siteId: site.id, parentSku, name: null, brand: null, imageUrl: null, url: null, productType: site.adapterConfig.productType, now });
    const variantId = await ctx.store.upsertVariant(product.id, sku, cleanVariantValues(raw.variantValues));
    const currency = typeof raw.currency === "string" && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : "ILS";

    const last = await ctx.store.lastPrice(variantId);
    if (last && last.price === price && last.inStock === inStock) {
      result.unchanged++;
      continue;
    }

    if (price !== null) {
      const recent = await ctx.store.recentPrices(variantId, 10);
      if (recent.length >= 3) {
        const mid = median(recent);
        if (Math.abs(price - mid) / mid > settings.priceReports.outlierRatio) {
          const since = new Date(ctx.now.getTime() - settings.priceReports.windowHours * 3_600_000).toISOString();
          const others = await ctx.store.countOutlierConfirmations(variantId, price, since, installHash);
          if (others + 1 < settings.priceReports.confirmations) {
            await ctx.store.addOutlierCandidate({ variantId, price, inStock, installHash, now });
            result.pendingConfirmation++;
            continue;
          }
          await ctx.store.clearOutlierCandidates(variantId, price);
        }
      }
    }

    await ctx.store.insertPriceEvent({ variantId, price, currency, inStock, installHash, now });
    used++;
    result.accepted++;
  }
  return ok(result);
};
