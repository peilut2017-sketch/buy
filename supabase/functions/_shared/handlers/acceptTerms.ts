// Records that the signed-in person accepted the current terms of use (shown at /terms on the website).

import { BAD_REQUEST, fail, isRecord, ok } from "../http.ts";
import { TERMS_VERSION } from "../terms.ts";
import { requireProfile, type Handler } from "./context.ts";

export const acceptTerms: Handler = async (ctx, body) => {
  const gate = await requireProfile(ctx, { terms: false });
  if ("response" in gate) return gate.response;
  if (!ctx.user || !isRecord(body)) return BAD_REQUEST;
  // The person must have seen the version that is current now, not an older one left in an open tab.
  if (body.version !== TERMS_VERSION) return fail(409, "תנאי השימוש התעדכנו. טענו את העמוד מחדש ואשרו את הגרסה העדכנית.");
  await ctx.store.acceptTerms(ctx.user.id, TERMS_VERSION, ctx.now.toISOString());
  return ok({ version: TERMS_VERSION });
};
