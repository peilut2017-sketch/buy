// The "my orders" page: the page loads the person's order list for itself, the hook hands a copy to this script, the
// adapter reads it, and the background saves it for verification. A small notice says what happened, so nobody has to guess.

import { type AdapterConfig, type Order } from "@smartbuy/core";
import { Button, IconButton, Root } from "@smartbuy/ui";
import baseCss from "@smartbuy/ui/base.css?inline";
import tokensCss from "@smartbuy/ui/tokens.css?inline";
import { h, render } from "preact";
import { ORDERS_HOOK_SOURCE, ORDERS_READY_SOURCE } from "../lib/hook.ts";
import { send, type OrdersOutcome } from "../lib/messages.ts";
import type { RegisteredSite } from "../lib/sites.ts";

const HOST_TAG = "smartbuy-orders";
const HIDE_AFTER_MS = 20_000;

export interface OrdersNoticeProps {
  outcome: OrdersOutcome | "saving";
  read: number;
  onEnable: () => void;
  onOptions: () => void;
  onClose: () => void;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

export function OrdersNotice({ outcome, read, onEnable, onOptions, onClose }: OrdersNoticeProps) {
  const orders = plural(read, "הזמנה אחת", "הזמנות");
  let title = "";
  let text = "";
  let action: preact.ComponentChildren = null;

  if (outcome === "saving") {
    title = "קוראים את ההזמנות שלכם…";
  } else if (outcome.status === "ok") {
    title = `SmartBuy קרא ${orders}`;
    text = outcome.accepted > 0
      ? `${plural(outcome.accepted, "הזמנה אחת חדשה נשמרה", "הזמנות חדשות נשמרו")} לאימות הרכישות שלכם. הרכישות שעוד אין עליהן ביקורת מופיעות בחלון התוסף.`
      : "כל ההזמנות האלה כבר היו שמורות. הרכישות שעוד אין עליהן ביקורת מופיעות בחלון התוסף.";
  } else if (outcome.status === "no-consent") {
    title = `SmartBuy ראה ${orders} בעמוד`;
    text = "כדי לאמת רכישות צריך לאשר בדיקת הזמנות. נשמר רק גיבוב של מספר ההזמנה, המק\"טים והתאריכים.";
    action = <Button variant="primary" small onClick={onEnable}>אישור בדיקת הזמנות</Button>;
  } else if (outcome.status === "signed-out") {
    title = `SmartBuy ראה ${orders} בעמוד`;
    text = "כדי לאמת את הרכישות שלכם צריך להתחבר.";
    action = <Button variant="primary" small onClick={onOptions}>להתחברות</Button>;
  } else if (outcome.status === "terms") {
    title = "צריך לאשר את תנאי השימוש";
    text = "פתחו את החלון של התוסף ואשרו את התנאים, ואז רעננו את העמוד.";
  } else {
    title = "ההזמנות לא נשמרו";
    text = "משהו השתבש בשמירה. רעננו את העמוד ונסו שוב.";
  }

  return (
    <Root class="orders-notice">
      <section class="sb-shell sb-shell--opaque" role="status" aria-live="polite" aria-label="SmartBuy: הזמנות">
        <div class="sb-region" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div class="sb-row sb-spread sb-gap-2">
            <span class="sb-t-heading">{title}</span>
            <IconButton icon="close" label="סגירה" onClick={onClose} />
          </div>
          {text && <span class="sb-t-support sb-secondary">{text}</span>}
          {action && <div>{action}</div>}
        </div>
      </section>
    </Root>
  );
}

export class OrdersCapture {
  private host: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private known = new Map<string, Order>();
  private listener = (event: MessageEvent) => void this.onMessage(event);

  constructor(private readonly site: RegisteredSite, private readonly doc: Document, private readonly win: Window) {}

  start(cfg: () => AdapterConfig): void {
    this.cfg = cfg;
    this.win.addEventListener("message", this.listener);
    this.win.postMessage({ source: ORDERS_READY_SOURCE }, this.win.location.origin);
  }

  stop(): void {
    this.win.removeEventListener("message", this.listener);
    this.remove();
  }

  private cfg: () => AdapterConfig = () => this.site.bundled.config;

  private async onMessage(event: MessageEvent): Promise<void> {
    // Only the page's own hook, on the page's own origin.
    if (event.source !== this.win || event.origin !== this.win.location.origin) return;
    const data = event.data as { source?: unknown; payload?: unknown } | null;
    if (!data || data.source !== ORDERS_HOOK_SOURCE) return;
    let orders: Order[] | null = null;
    try {
      orders = this.site.adapter.parseOrdersResponse?.(data.payload, this.cfg()) ?? null;
    } catch {
      return;
    }
    if (!orders || orders.length === 0) return;
    for (const o of orders) this.known.set(o.orderNumber, o);

    this.show("saving");
    let outcome: OrdersOutcome;
    try {
      outcome = await send("orders-captured", { siteId: this.site.id, orders });
    } catch {
      outcome = { status: "error" };
    }
    this.show(outcome);
  }

  private async enable(): Promise<void> {
    this.show("saving");
    let outcome: OrdersOutcome;
    try {
      outcome = await send("enable-order-check", { siteId: this.site.id, orders: [...this.known.values()] });
    } catch {
      outcome = { status: "error" };
    }
    this.show(outcome);
  }

  private show(outcome: OrdersOutcome | "saving"): void {
    clearTimeout(this.timer);
    if (!this.host) {
      this.doc.querySelectorAll(HOST_TAG).forEach((el) => el.remove());
      const host = this.doc.createElement(HOST_TAG);
      host.setAttribute("dir", "rtl");
      host.setAttribute("lang", "he");
      host.style.cssText = "position:fixed;inset-block-end:16px;inset-inline-start:16px;z-index:2147483000;inline-size:min(360px, calc(100vw - 32px));isolation:isolate;display:block";
      const shadow = host.attachShadow({ mode: "open" });
      const style = this.doc.createElement("style");
      style.textContent = `${tokensCss}\n${baseCss}`;
      const container = this.doc.createElement("div");
      shadow.append(style, container);
      this.doc.documentElement.append(host);
      this.host = host;
    }
    const container = this.host.shadowRoot?.lastElementChild as HTMLElement | null;
    if (!container) return;
    render(h(OrdersNotice, { outcome, read: this.known.size, onEnable: () => void this.enable(), onOptions: () => void send("open-options", {}).catch(() => undefined), onClose: () => this.remove() }), container);
    if (outcome !== "saving" && outcome.status === "ok") this.timer = setTimeout(() => this.remove(), HIDE_AFTER_MS);
  }

  private remove(): void {
    clearTimeout(this.timer);
    this.host?.remove();
    this.host = null;
  }
}
