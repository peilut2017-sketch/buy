// Export and deletion of a user's own data (spec 20).

import { BAD_REQUEST, UNAUTHENTICATED, isRecord, ok } from "../http.ts";
import type { Handler } from "./context.ts";

export const exportMyData: Handler = async (ctx) => {
  if (!ctx.user) return UNAUTHENTICATED;
  return ok(await ctx.store.exportUser(ctx.user.id));
};

/** Deleting the sign-in account cascades to the profile, reviews, orders, watches and everything tied to them. */
export const deleteMyAccount: Handler = async (ctx, body) => {
  if (!ctx.user) return UNAUTHENTICATED;
  if (!isRecord(body) || body.confirm !== true) return BAD_REQUEST;
  await ctx.store.deleteUser(ctx.user.id);
  return ok();
};
