// Anonymous usage events from the extension and the website. Privacy rule 7: no browsing history.
// A product view carries the product but never an install or user id; every other event is stored without a user id.

import { BAD_REQUEST, fail, isRecord, ok } from "../http.ts";
import { cleanSku, type Handler } from "./context.ts";

/** Events a client may send. signup and review_submitted are written by the server itself, with the user id. */
const CLIENT_EVENTS = ["install", "first_product_view", "product_view", "panel_open", "detect_failed", "uninstall"] as const;
const PLATFORMS = ["extension", "web_desktop", "web_mobile"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PROPS_BYTES = 2048;

export const events: Handler = async (ctx, body) => {
  if (!isRecord(body)) return BAD_REQUEST;
  const event = CLIENT_EVENTS.find((e) => e === body.event);
  const platform = PLATFORMS.find((p) => p === body.platform);
  if (!event || !platform) return BAD_REQUEST;

  let siteId: string | null = null;
  let productId: number | null = null;
  if (typeof body.siteId === "string") {
    const site = await ctx.store.getSite(body.siteId);
    if (!site) return fail(404, "החנות לא נתמכת.");
    siteId = site.id;
    const parentSku = cleanSku(body.parentSku);
    if (parentSku && (event === "product_view" || event === "detect_failed")) {
      // Creates the product row if nobody has reviewed it yet, so views of products without reviews can be counted.
      productId = (await ctx.store.upsertProduct({
        siteId,
        parentSku,
        name: null,
        brand: null,
        imageUrl: null,
        url: null,
        productType: site.adapterConfig.productType ?? "general",
        now: ctx.now.toISOString(),
      })).id;
    }
  }

  const installId = typeof body.installId === "string" && UUID.test(body.installId) ? body.installId.toLowerCase() : null;
  if (event !== "product_view" && event !== "uninstall" && !installId) return fail(400, "חסר מזהה התקנה.");

  let props: Record<string, unknown> = {};
  if (event === "detect_failed" && isRecord(body.props)) {
    if (JSON.stringify(body.props).length > MAX_PROPS_BYTES) return fail(413, "הבקשה גדולה מדי.");
    props = body.props;
  }

  await ctx.store.insertEvent({
    event,
    platform,
    siteId,
    productId,
    userId: null,
    installId: event === "product_view" ? null : installId,
    props,
  });
  return ok();
};
