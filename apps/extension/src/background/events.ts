// Anonymous usage events. Privacy rule 7: no browsing history. A product view names the product but never the
// install or the user, and the install id travels only with events that carry no product.

import { callFunction } from "@smartbuy/data";
import { getLocal, setLocal } from "../lib/storage.ts";

const INSTALL_KEY = "installId";
const FIRST_VIEW_KEY = "firstProductViewSent";

export async function installId(): Promise<string> {
  const existing = await getLocal<string>(INSTALL_KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  await setLocal(INSTALL_KEY, fresh);
  return fresh;
}

type EventName = "install" | "first_product_view" | "product_view" | "panel_open" | "detect_failed";

interface EventInput {
  event: EventName;
  siteId?: string;
  parentSku?: string;
  props?: Record<string, unknown>;
}

/** Fire and forget: usage statistics must never slow down or break the product. */
export async function track(input: EventInput): Promise<void> {
  try {
    const withInstall = input.event !== "product_view";
    await callFunction("events", {
      event: input.event,
      platform: "extension",
      siteId: input.siteId,
      parentSku: input.event === "product_view" || input.event === "detect_failed" ? input.parentSku : undefined,
      installId: withInstall ? await installId() : undefined,
      props: input.props ?? {},
    });
  } catch {
    // Offline or not configured: the event is simply dropped.
  }
}

/** The funnel counts one first product view per install, with no product attached. */
export async function trackFirstViewOnce(siteId: string): Promise<void> {
  if (await getLocal<boolean>(FIRST_VIEW_KEY)) return;
  await setLocal(FIRST_VIEW_KEY, true);
  await track({ event: "first_product_view", siteId });
}
