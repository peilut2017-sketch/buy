// Create or edit a review. Spec: docs/01-product-spec.md sections 5 to 7; architecture: "כתיבת ביקורת".
// The server decides everything that matters: who is verified, what the product type is, and the rate limit.

import { BAD_REQUEST, dayStart, fail, isRecord, ok, todayIso } from "../http.ts";
import { isReviewWave, writtenBeforeDelivery } from "../moderation.ts";
import type { SaveReviewInput, Verification } from "../store.ts";
import { validateReview } from "../validation.ts";
import { checkParentSku, cleanLabel, cleanSku, cleanUrl, cleanVariantValues, requireProfile, type Handler } from "./context.ts";

const CONFIDENCE = ["high", "medium", "low"] as const;

export const submitReview: Handler = async (ctx, body) => {
  const gate = await requireProfile(ctx, { nickname: true });
  if ("response" in gate) return gate.response;
  const { user } = ctx;
  if (!user || !isRecord(body)) return BAD_REQUEST;

  const siteId = typeof body.siteId === "string" ? body.siteId : "";
  const sku = cleanSku(body.sku);
  const parentSku = cleanSku(body.parentSku);
  if (!siteId || !sku || !parentSku) return BAD_REQUEST;

  const site = await ctx.store.getSite(siteId);
  if (!site) return fail(404, "החנות הזו לא נתמכת.");
  if (site.status === "paused") return fail(403, "הכתיבה לחנות הזו מושהית זמנית.");
  // Fail closed: without the store's rules the server cannot know which questions apply, so it does not guess.
  if (!site.adapterConfig.productType) return fail(503, "החנות עוד לא הוגדרה לכתיבת ביקורות. נסו שוב בהמשך.");
  if (!checkParentSku(sku, parentSku, site.adapterConfig.parentSku?.fromSku)) return fail(400, "המק״ט והדגם לא מתאימים זה לזה.");

  const settings = await ctx.store.getSettings();
  const productType = site.adapterConfig.productType;
  const now = ctx.now;
  const today = todayIso(now);

  const existingProduct = await ctx.store.findProduct(siteId, parentSku);
  const match = existingProduct ? await ctx.store.findDeliveredOrderItem(user.id, existingProduct.id, today) : null;
  const requiredAnswers = await ctx.store.getRequiredQuestionKeys(productType);

  const checked = validateReview(
    { rating: body.rating, title: body.title, body: body.body, answers: body.answers, purchaseMonth: body.purchaseMonth },
    { verified: match !== null, requiredAnswers, now, limits: { minChars: settings.reviewLimits.minChars, maxChars: settings.reviewLimits.maxChars } },
  );
  if (!checked.ok) return fail(422, "בדקו את השדות המסומנים.", checked.errors);
  const review = checked.value;

  const existing = existingProduct ? await ctx.store.findReview(user.id, existingProduct.id) : null;
  if (existing?.status === "removed") return fail(403, "הביקורת הוסרה ואי אפשר לערוך אותה.");
  if (existing && existing.body !== null && review.body === null) {
    return fail(409, "כבר כתבתם ביקורת על המוצר הזה. ערכו אותה במקום לדרג מחדש.");
  }
  if (!existing) {
    const since = dayStart(now);
    if ((await ctx.store.countReviewsByUserSince(user.id, since)) >= settings.reviewLimits.perDay) {
      return fail(429, "כתבתם יותר מדי ביקורות היום. נסו שוב מחר.");
    }
  }

  const product = await ctx.store.upsertProduct({
    siteId,
    parentSku,
    name: isRecord(body.product) ? cleanLabel(body.product.name, 200) : null,
    brand: isRecord(body.product) ? cleanLabel(body.product.brand, 80) : null,
    imageUrl: isRecord(body.product) ? cleanUrl(body.product.imageUrl) : null,
    url: isRecord(body.product) ? cleanUrl(body.product.url) : null,
    productType,
    now: now.toISOString(),
  });
  const variantValues = cleanVariantValues(body.variantValues);
  const variantId = await ctx.store.upsertVariant(product.id, sku, variantValues);

  let verification: Verification = body.source === "web" ? "pending" : "unverified";
  let orderItemId: number | null = null;
  let purchasedAt: string | null = null;
  let deliveredAt: string | null = null;
  if (match) {
    verification = "verified";
    orderItemId = match.orderItemId;
    purchasedAt = match.orderedAt;
    deliveredAt = match.deliveredAt;
  }

  const confidence = CONFIDENCE.find((c) => c === body.detectionConfidence) ?? "low";
  const input: SaveReviewInput = {
    existingId: existing?.id ?? null,
    userId: user.id,
    productId: product.id,
    variantId,
    variantValues,
    rating: review.rating,
    title: review.title,
    body: review.body,
    answers: review.answers,
    verification,
    orderItemId,
    purchaseMonth: match ? null : review.purchaseMonth,
    purchasedAt,
    deliveredAt,
    detectionConfidence: confidence,
    now: now.toISOString(),
  };
  const saved = await ctx.store.saveReview(input);

  if (verification === "verified" && writtenBeforeDelivery(now, deliveredAt)) await ctx.store.addFlag(saved.id, "written_before_delivery");
  if (saved.created) {
    const since = new Date(now.getTime() - settings.reviewWave.windowHours * 3_600_000).toISOString();
    const times = (await ctx.store.listReviewTimesOnProduct(product.id, since)).map((t) => new Date(t));
    if (isReviewWave(times, now, settings.reviewWave)) await ctx.store.addFlag(saved.id, "review_wave");
    await ctx.store.insertEvent({ event: "review_submitted", platform: "server", siteId, productId: product.id, userId: user.id, installId: null, props: {} });
  }
  if (review.body !== null) await ctx.store.clearPending(user.id, product.id);
  await ctx.store.recomputeStats(user.id);

  return ok({ reviewId: saved.id, verification, published: review.body !== null && (existing?.status ?? "visible") === "visible" });
};
