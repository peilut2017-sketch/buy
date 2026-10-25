// Report a review (spec 10). Reports from enough different qualifying users hide it until a moderator decides.

import { BAD_REQUEST, NOT_FOUND, fail, isRecord, ok, posInt, dayStart } from "../http.ts";
import { decideAutoHide } from "../moderation.ts";
import { validateReport } from "../validation.ts";
import { requireProfile, type Handler } from "./context.ts";

export const reportReview: Handler = async (ctx, body) => {
  const gate = await requireProfile(ctx);
  if ("response" in gate) return gate.response;
  if (!ctx.user || !isRecord(body)) return BAD_REQUEST;
  const reviewId = posInt(body.reviewId);
  if (!reviewId) return BAD_REQUEST;

  const checked = validateReport({ reason: body.reason, details: body.details });
  if (!checked.ok) return fail(422, "בדקו את השדות המסומנים.", checked.errors);

  const review = await ctx.store.getReview(reviewId);
  if (!review || review.status !== "visible") return NOT_FOUND;
  if (review.userId === ctx.user.id) return fail(403, "אי אפשר לדווח על ביקורת שכתבתם.");
  if (await ctx.store.findReport(reviewId, ctx.user.id)) return fail(409, "כבר דיווחתם על הביקורת הזו.");

  const settings = await ctx.store.getSettings();
  if ((await ctx.store.countReportsByUserSince(ctx.user.id, dayStart(ctx.now))) >= settings.reportsPerDay) {
    return fail(429, "שלחתם יותר מדי דיווחים היום.");
  }

  await ctx.store.insertReport({ reviewId, reporterId: ctx.user.id, reason: checked.value.reason, details: checked.value.details });

  const decision = decideAutoHide(await ctx.store.listReportsForDecision(reviewId), settings.autoHide, settings.reporterAbuse);
  if (decision.hide) {
    await ctx.store.setReviewStatus(reviewId, "hidden", decision.reason === "instant" ? "auto_hidden_instant" : "auto_hidden_reports");
    await ctx.store.queueNotification({
      userId: review.userId,
      kind: "moderation_decision",
      payload: { reviewId, decision: "hidden", pendingReview: true },
      dedupeKey: `hidden:${reviewId}`,
    });
    await ctx.store.recomputeStats(review.userId);
  }
  return ok();
};
