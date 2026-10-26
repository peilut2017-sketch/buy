import { defineContentScript } from "wxt/utils/define-content-script";
import { PageController } from "../src/content/controller.ts";
import { siteForUrl } from "../src/lib/sites.ts";

declare global {
  interface Window {
    __smartbuyLoaded?: boolean;
  }
}

export default defineContentScript({
  // Registered at runtime, only for stores the user has granted access to (see src/background/register.ts).
  // `matches` is required by the type but is not used for registration; the real patterns come from each site's adapter.
  registration: "runtime",
  matches: ["https://*/*"],
  main(ctx) {
    if (window.__smartbuyLoaded) return;
    window.__smartbuyLoaded = true;

    const site = siteForUrl(new URL(location.href));
    if (!site) return;

    const controller = new PageController(site, document, window);
    void controller.refresh();

    // Single-page navigation: WXT fires this event when the address changes without a page load.
    let timer: ReturnType<typeof setTimeout> | undefined;
    ctx.addEventListener(window, "wxt:locationchange", () => {
      clearTimeout(timer);
      timer = setTimeout(() => void controller.refresh(), 250);
    });
    ctx.onInvalidated(() => {
      clearTimeout(timer);
      controller.destroy();
      window.__smartbuyLoaded = false;
    });
  },
});
