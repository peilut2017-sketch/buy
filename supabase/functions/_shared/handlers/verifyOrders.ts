// Order verification (spec 7). The extension sends what the store's own order pages show, after the user agreed
// to order checks. Privacy rule 7: only a hash of the order number is stored, plus dates and SKUs.

import { BAD_REQUEST, fail, isRecord, ok, todayIso } from "../http.ts";
import { canWriteVerified, hashOrderNumber, pendingDueAt, validateOrderInput, type OrderInput } from "../orders.ts";
import { checkParentSku, cleanSku, requireProfile, type Handler } from "./context.ts";

const MAX_ORDERS = 50;

export const verifyOrders: Handler = async (ctx, body) => {
  const gate = await requireProfile(ctx);
  if ("response" in gate) return gate.response;
  if (!ctx.user || !isRecord(body) || !Array.isArray(body.orders)) return BAD_REQUEST;
  if (!gate.profile.orderCheckConsent) return fail(403, "כדי לאמת רכישות צריך לאשר בדיקת הזמנות בהגדרות.");
  if (!ctx.pepper) return fail(500, "השרת לא מוגדר לאימות הזמנות.");
  if (body.orders.length > MAX_ORDERS) return fail(413, "יותר מדי הזמנות בבקשה אחת.");

  const siteId = typeof body.siteId === "string" ? body.siteId : "";
  const site = await ctx.store.getSite(siteId);
  if (!site) return fail(404, "החנות הזו לא נתמכת.");
  if (site.status === "paused") return fail(403, "אימות הזמנות לחנות הזו מושהה זמנית.");
  if (!site.adapterConfig.productType || !site.adapterConfig.parentSku?.fromSku) return fail(503, "החנות עוד לא הוגדרה לאימות הזמנות.");

  const settings = await ctx.store.getSettings();
  const today = todayIso(ctx.now);
  const summary = { accepted: 0, alreadyKnown: 0, conflicts: 0, rejected: 0, upgraded: 0 };

  for (const raw of body.orders as unknown[]) {
    const order = raw as OrderInput;
    if (!isRecord(raw) || !validateOrderInput(order).ok) {
      summary.rejected++;
      continue;
    }
    const orderHash = await hashOrderNumber(siteId, order.orderNumber, ctx.pepper);
    const owner = await ctx.store.findOrderOwner(siteId, orderHash);
    if (owner === ctx.user.id) {
      summary.alreadyKnown++;
      continue;
    }
    if (owner !== null) {
      // One order locks to one account: someone else already claimed it.
      summary.conflicts++;
      continue;
    }

    const items: { sku: string; productId: number | null; variantId: number | null }[] = [];
    for (const item of order.items) {
      const sku = cleanSku(item.sku);
      if (!sku) continue;
      const rule = site.adapterConfig.parentSku?.fromSku;
      const parent = rule ? new RegExp(rule, "i").exec(sku)?.[1]?.toLowerCase() ?? null : null;
      if (!parent || !checkParentSku(sku, parent, rule)) {
        items.push({ sku, productId: null, variantId: null });
        continue;
      }
      const product = await ctx.store.upsertProduct({ siteId, parentSku: parent, name: null, brand: null, imageUrl: null, url: null, productType: site.adapterConfig.productType, now: ctx.now.toISOString() });
      items.push({ sku, productId: product.id, variantId: await ctx.store.upsertVariant(product.id, sku, {}) });
    }
    if (items.length === 0) {
      summary.rejected++;
      continue;
    }

    const stored = await ctx.store.insertOrder({ userId: ctx.user.id, siteId, orderHash, orderedAt: order.orderedAt, deliveredAt: order.deliveredAt, source: "extension", items });
    summary.accepted++;

    for (const [index, item] of items.entries()) {
      const orderItemId = stored.itemIds[index];
      if (item.productId === null || orderItemId === undefined || !order.deliveredAt) continue;
      if (canWriteVerified(order.deliveredAt, today)) {
        summary.upgraded += await ctx.store.upgradeReviewsFromOrder({ userId: ctx.user.id, productId: item.productId, orderItemId, orderedAt: order.orderedAt, deliveredAt: order.deliveredAt });
      }
      const review = await ctx.store.findReview(ctx.user.id, item.productId);
      if (!review || review.body === null) {
        await ctx.store.addPending({ userId: ctx.user.id, orderItemId, productId: item.productId, dueAt: pendingDueAt(order.deliveredAt, settings.notifications.pendingAfterDeliveryDays) });
      }
    }
  }
  if (summary.upgraded > 0) await ctx.store.recomputeStats(ctx.user.id);
  return ok(summary);
};
