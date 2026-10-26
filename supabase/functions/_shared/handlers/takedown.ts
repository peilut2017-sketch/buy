// The public "request removal" form (spec 10, 20): for someone who is not a user, such as a brand or a person mentioned.

import { BAD_REQUEST, fail, isRecord, ok, posInt } from "../http.ts";
import { charLength } from "../validation.ts";
import type { Handler } from "./context.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const takedownRequest: Handler = async (ctx, body) => {
  if (!isRecord(body)) return BAD_REQUEST;
  // A hidden field that people never fill in. Filled means a bot: answer like a success and store nothing.
  if (typeof body.website === "string" && body.website !== "") return ok();

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const errors: Record<string, string> = {};
  if (charLength(name) < 2 || charLength(name) > 100) errors.name = "כתבו שם (2 עד 100 תווים).";
  if (!EMAIL.test(email) || email.length > 200) errors.email = "כתבו כתובת מייל תקינה.";
  if (charLength(reason) < 10 || charLength(reason) > 2000) errors.reason = "הסבירו את הבקשה (10 עד 2,000 תווים).";
  if (Object.keys(errors).length > 0) return fail(422, "בדקו את השדות המסומנים.", errors);

  const requestedId = posInt(body.reviewId);
  const review = requestedId ? await ctx.store.getReview(requestedId) : null;
  await ctx.store.insertTakedown({ reviewId: review?.id ?? null, name, email, reason });
  return ok();
};
