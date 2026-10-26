// Moderator and admin actions. Every action needs a reason and is written to the audit log (spec 10, 19).
// Direct table writes by staff are deliberately not allowed: this is the only path, so nothing goes unlogged.

import { BAD_REQUEST, BLOCKED, NOT_FOUND, UNAUTHENTICATED, fail, isRecord, ok, posInt } from "../http.ts";
import type { ProfileRow, ReviewStatus, Role } from "../store.ts";
import type { Ctx, Handler } from "./context.ts";

const ROLES: readonly Role[] = ["user", "moderator", "admin"];
const STATUSES: readonly ReviewStatus[] = ["visible", "hidden", "removed"];

function note(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length >= 3 && text.length <= 500 ? text : null;
}

const NEEDS_REASON = fail(422, "כל החלטה דורשת סיבה (לפחות 3 תווים).", { note: "כתבו סיבה." });
const ADMIN_ONLY = fail(403, "הפעולה הזו שמורה למנהל.");

/** Sets the review's visibility and refreshes the author's level. False when the review does not exist. */
async function applyReviewAction(ctx: Ctx, reviewId: number, action: "keep" | "hide" | "remove", reason: string): Promise<boolean> {
  const review = await ctx.store.getReview(reviewId);
  if (!review) return false;
  const status: ReviewStatus = action === "keep" ? "visible" : action === "hide" ? "hidden" : "removed";
  await ctx.store.setReviewStatus(reviewId, status, action === "keep" ? null : reason);
  await ctx.store.recomputeStats(review.userId);
  return true;
}

export const moderate: Handler = async (ctx, body) => {
  if (!ctx.user) return UNAUTHENTICATED;
  const actor: ProfileRow | null = await ctx.store.getProfile(ctx.user.id);
  if (!actor || actor.blockedAt) return BLOCKED;
  if (actor.role !== "moderator" && actor.role !== "admin") return fail(403, "אין לכם הרשאה לפעולה הזו.");
  if (!isRecord(body) || typeof body.action !== "string") return BAD_REQUEST;
  const isAdmin = actor.role === "admin";
  const now = ctx.now.toISOString();
  const audit = (action: string, targetType: string, targetId: string | number, details: Record<string, unknown>) =>
    ctx.store.writeAudit({ actorId: actor.id, action, targetType, targetId: String(targetId), details });

  switch (body.action) {
    case "decide_report": {
      const reportId = posInt(body.reportId);
      const reason = note(body.note);
      const decision = body.decision === "upheld" || body.decision === "dismissed" ? body.decision : null;
      const reviewAction = body.reviewAction === "keep" || body.reviewAction === "hide" || body.reviewAction === "remove" ? body.reviewAction : null;
      if (!reportId || !decision || !reviewAction) return BAD_REQUEST;
      if (!reason) return NEEDS_REASON;
      const report = await ctx.store.getReportRow(reportId);
      if (!report) return NOT_FOUND;
      await ctx.store.decideReport(reportId, decision, actor.id, reason, now);
      const review = await ctx.store.getReview(report.reviewId);
      await applyReviewAction(ctx, report.reviewId, reviewAction, reason);
      if (report.reporterId) {
        await ctx.store.queueNotification({ userId: report.reporterId, kind: "moderation_decision", payload: { reportId, decision, kind: "report" }, dedupeKey: `report:${reportId}` });
        await ctx.store.recomputeStats(report.reporterId);
      }
      if (review && reviewAction !== "keep") {
        await ctx.store.queueNotification({ userId: review.userId, kind: "moderation_decision", payload: { reviewId: review.id, decision: reviewAction, reason }, dedupeKey: `review:${review.id}:${reviewAction}` });
      }
      await audit("decide_report", "report", reportId, { decision, reviewAction, reason });
      return ok();
    }

    case "decide_appeal": {
      const appealId = posInt(body.appealId);
      const reason = note(body.note);
      const decision = body.decision === "accepted" || body.decision === "rejected" ? body.decision : null;
      if (!appealId || !decision) return BAD_REQUEST;
      if (!reason) return NEEDS_REASON;
      const appeal = await ctx.store.getAppeal(appealId);
      if (!appeal) return NOT_FOUND;
      await ctx.store.decideAppeal(appealId, decision, actor.id, now);
      if (decision === "accepted") await applyReviewAction(ctx, appeal.reviewId, "keep", reason);
      await ctx.store.queueNotification({ userId: appeal.userId, kind: "moderation_decision", payload: { appealId, decision, reason }, dedupeKey: `appeal:${appealId}` });
      await audit("decide_appeal", "appeal", appealId, { decision, reason });
      return ok();
    }

    case "decide_takedown": {
      const takedownId = posInt(body.takedownId);
      const reason = note(body.note);
      const decision = body.decision === "upheld" || body.decision === "dismissed" ? body.decision : null;
      const reviewAction = body.reviewAction === "keep" || body.reviewAction === "hide" || body.reviewAction === "remove" ? body.reviewAction : null;
      if (!takedownId || !decision || !reviewAction) return BAD_REQUEST;
      if (!reason) return NEEDS_REASON;
      const takedown = await ctx.store.getTakedown(takedownId);
      if (!takedown) return NOT_FOUND;
      await ctx.store.decideTakedown(takedownId, decision, actor.id, now);
      if (takedown.reviewId !== null) await applyReviewAction(ctx, takedown.reviewId, reviewAction, reason);
      await audit("decide_takedown", "takedown", takedownId, { decision, reviewAction, reason });
      return ok();
    }

    case "set_review_status": {
      const reviewId = posInt(body.reviewId);
      const reason = note(body.note);
      const status = STATUSES.find((s) => s === body.status);
      if (!reviewId || !status) return BAD_REQUEST;
      if (!reason) return NEEDS_REASON;
      const action = status === "visible" ? "keep" : status === "hidden" ? "hide" : "remove";
      if (!(await applyReviewAction(ctx, reviewId, action, reason))) return NOT_FOUND;
      await audit("set_review_status", "review", reviewId, { status, reason });
      return ok();
    }

    case "set_role": {
      if (!isAdmin) return ADMIN_ONLY;
      const userId = typeof body.userId === "string" ? body.userId : "";
      const role = ROLES.find((r) => r === body.role);
      const reason = note(body.note);
      if (!userId || !role) return BAD_REQUEST;
      if (!reason) return NEEDS_REASON;
      // An admin cannot change their own role, so the last admin cannot lock everyone out by accident.
      if (userId === actor.id) return fail(409, "אי אפשר לשנות את התפקיד של עצמכם.");
      if (!(await ctx.store.getProfile(userId))) return NOT_FOUND;
      await ctx.store.setRole(userId, role);
      await audit("set_role", "user", userId, { role, reason });
      return ok();
    }

    case "set_blocked": {
      if (!isAdmin) return ADMIN_ONLY;
      const userId = typeof body.userId === "string" ? body.userId : "";
      const reason = note(body.note);
      if (!userId || typeof body.blocked !== "boolean") return BAD_REQUEST;
      if (!reason) return NEEDS_REASON;
      if (userId === actor.id) return fail(409, "אי אפשר לחסום את עצמכם.");
      if (!(await ctx.store.getProfile(userId))) return NOT_FOUND;
      await ctx.store.setBlocked(userId, body.blocked ? now : null);
      await audit(body.blocked ? "block_user" : "unblock_user", "user", userId, { reason });
      return ok();
    }
  }
  return BAD_REQUEST;
};
