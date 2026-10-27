import { defineContentScript } from "wxt/utils/define-content-script";
import { ORDERS_HOOK_SOURCE, ORDERS_READY_SOURCE } from "../src/lib/hook.ts";

/**
 * Runs inside the store's own page, before its scripts, and listens to the answers the page itself already receives.
 * The person's "my orders" list arrives as a JSON answer to a request the page makes with the person's own session. This
 * script makes no request of its own: it passes a copy of an answer to the extension, and only when the answer contains
 * the orders list (data.customerOrders). Everything else is left untouched and unread beyond that one check.
 */
const MAX_BYTES = 3_000_000;

export default defineContentScript({
  registration: "runtime",
  matches: ["https://*/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    const w = window as unknown as { __smartbuyOrdersHook?: boolean };
    if (w.__smartbuyOrdersHook) return;
    w.__smartbuyOrdersHook = true;

    // The orders list can arrive before the extension's other script starts listening (it starts when the page is idle),
    // so what was seen is kept and handed over when that script says it is ready.
    const seen: unknown[] = [];
    const post = (payload: unknown) => window.postMessage({ source: ORDERS_HOOK_SOURCE, payload }, window.location.origin);
    window.addEventListener("message", (event) => {
      if (event.source === window && (event.data as { source?: unknown } | null)?.source === ORDERS_READY_SOURCE) seen.forEach(post);
    });

    const offer = (text: string) => {
      if (text.length > MAX_BYTES || !text.includes('"customerOrders"')) return;
      try {
        const payload = JSON.parse(text);
        seen.push(payload);
        if (seen.length > 20) seen.shift();
        post(payload);
      } catch {
        /* not JSON */
      }
    };

    const originalFetch = window.fetch;
    window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      const result = originalFetch.apply(this, args);
      void result.then((response) => {
        try {
          if (/json/i.test(response.headers.get("content-type") ?? "")) void response.clone().text().then(offer, () => undefined);
        } catch {
          /* never disturb the page */
        }
      }, () => undefined);
      return result;
    } as typeof fetch;

    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest["open"]>) {
      this.addEventListener("load", () => {
        try {
          if ((this.responseType === "" || this.responseType === "text") && /json/i.test(this.getResponseHeader("content-type") ?? "")) offer(this.responseText);
        } catch {
          /* never disturb the page */
        }
      });
      return open.apply(this, args);
    } as typeof XMLHttpRequest.prototype.open;
  },
});
