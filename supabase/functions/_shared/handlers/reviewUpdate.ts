// A later update to the same review: "עדכון אחרי 4 חודשים". The review's rating becomes the latest one.

import { BAD_REQUEST, NOT_FOUND, fail, isRecord, ok, posInt } from "../http.ts";
import { validateReviewUpdate } from "../validation.ts";
import { requireProfile, type Handler } from "./context.ts";

export const reviewUpdate: Handler = async (ctx, body) => {
  const gate = await requireProfile(ctx);
  if ("response" in gate) return gate.response;
  if (!ctx.user || !isRecord(body)) return BAD_REQUEST;
  const reviewId = posInt(body.reviewId);
  if (!reviewId) return BAD_REQUEST;

  const review = await ctx.store.getReview(reviewId);
  if (!review) return NOT_FOUND;
  if (review.userId !== ctx.user.id) return fail(403, "אפשר לעדכן רק ביקורת שכתבתם.");
  if (review.status !== "visible" || review.body === null) return fail(409, "אפשר להוסיף עדכון רק לביקורת שמוצגת.");

  const settings = await ctx.store.getSettings();
  const checked = validateReviewUpdate({ body: body.body, rating: body.rating }, { maxChars: settings.reviewLimits.maxChars });
  if (!checked.ok) return fail(422, "בדקו את השדות המסומנים.", checked.errors);
  if ((await ctx.store.countUpdates(reviewId)) >= settings.updatesPerReview) return fail(429, "הגעתם למספר העדכונים המרבי לביקורת הזו.");

  const updateId = await ctx.store.insertReviewUpdate({ reviewId, body: checked.value.body, rating: checked.value.rating });
  if (checked.value.rating !== null) await ctx.store.setReviewRating(reviewId, checked.value.rating);
  return ok({ updateId });
};
