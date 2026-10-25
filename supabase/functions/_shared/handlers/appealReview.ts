// One appeal per hidden or removed review (spec 10).

import { BAD_REQUEST, NOT_FOUND, fail, isRecord, ok, posInt } from "../http.ts";
import { charLength } from "../validation.ts";
import { requireProfile, type Handler } from "./context.ts";

export const appealReview: Handler = async (ctx, body) => {
  const gate = await requireProfile(ctx);
  if ("response" in gate) return gate.response;
  if (!ctx.user || !isRecord(body)) return BAD_REQUEST;
  const reviewId = posInt(body.reviewId);
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!reviewId) return BAD_REQUEST;
  if (charLength(text) < 10 || charLength(text) > 1000) return fail(422, "בדקו את השדות המסומנים.", { body: "כתבו בין 10 ל-1,000 תווים." });

  const review = await ctx.store.getReview(reviewId);
  if (!review) return NOT_FOUND;
  if (review.userId !== ctx.user.id) return fail(403, "אפשר לערער רק על ביקורת שכתבתם.");
  if (review.status !== "hidden" && review.status !== "removed") return fail(409, "אין מה לערער: הביקורת מוצגת.");
  if (await ctx.store.findAppeal(reviewId)) return fail(409, "כבר שלחתם ערעור על הביקורת הזו.");

  await ctx.store.insertAppeal({ reviewId, userId: ctx.user.id, body: text });
  return ok();
};
