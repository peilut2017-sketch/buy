// Keeps the strip in step with the page: finds the product, shows the strip, and follows single-page navigation.

import { SIZE_ADVICE_MIN_REVIEWS, isDetected, validateConfig, type ProductSummary } from "@smartbuy/core";
import { send, type PanelMode, type ProductSnapshot, type SiteConfigResult } from "../lib/messages.ts";
import type { RegisteredSite } from "../lib/sites.ts";
import { isReportableFailure, readPage } from "./detect.ts";
import { ListingStars } from "./listing.tsx";
import { mountStrip, type MountedStrip } from "./mount.ts";
import type { StripPrice, StripProps, StripState } from "./Strip.tsx";

/** Client-rendered pages may not have their markup ready at document_idle, so detection retries a few times. */
const RETRY_DELAYS_MS = [0, 1_000, 3_000];

export class PageController {
  private strip: MountedStrip | null = null;
  private readonly listing: ListingStars;
  private shown: string | null = null;
  private dismissed = new Set<string>();
  private reported = new Set<string>();
  private runId = 0;
  private config: SiteConfigResult | null = null;
  private price: StripPrice | null = null;
  private advice: StripProps["advice"] = null;
  private handlers: Pick<StripProps, "onOpen" | "onClose" | "onRetry"> = { onOpen: () => undefined, onClose: () => undefined, onRetry: () => undefined };

  constructor(private readonly site: RegisteredSite, private readonly doc: Document, private readonly win: Window) {
    this.listing = new ListingStars(site, doc);
  }

  /** Call on first load and whenever the address changes without a page load. */
  async refresh(): Promise<void> {
    const run = ++this.runId;
    const config = await this.loadConfig();
    if (run !== this.runId) return;
    if (config.status === "paused") {
      this.listing.stop();
      return this.clear();
    }

    // After a single-page navigation the address changes first and the page's own tags (canonical, structured data) follow,
    // so a contradiction is not trusted until the signals have had time to settle.
    let settled: ReturnType<typeof readPage> | null = null;
    for (const delay of RETRY_DELAYS_MS) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (run !== this.runId) return;
      const url = new URL(this.win.location.href);
      const reading = readPage(this.site, this.doc, url, config.config);
      if (reading.product && isDetected(reading.detection) && !reading.detection.conflict) return this.show(reading.product, run);
      settled = reading;
      if (isReportableFailure(reading.detection)) this.reportOnce(url.pathname, reading.detection);
    }
    // Still contradictory after the last try: the majority rule of the spec decides (and the conflict was reported).
    if (settled?.product && isDetected(settled.detection)) return this.show(settled.product, run);
    this.clear();
    // Not a product page: a category or search page may list products that have reviews.
    void this.listing.start(config.config);
  }

  destroy(): void {
    this.runId++;
    this.listing.stop();
    this.strip?.unmount();
    this.strip = null;
  }

  private async loadConfig(): Promise<SiteConfigResult> {
    if (this.config) return this.config;
    let result: SiteConfigResult;
    try {
      result = await send("site-config", { siteId: this.site.id });
    } catch {
      result = { status: "beta", version: this.site.bundled.version, config: this.site.bundled.config, source: "bundled" };
    }
    // A server config that does not work on this page must never break detection: fall back to the bundled rules.
    const checked = validateConfig(result.config, this.doc);
    this.config = checked.ok ? result : { ...result, config: this.site.bundled.config, source: "bundled" };
    return this.config;
  }

  private async show(product: ProductSnapshot, run: number): Promise<void> {
    this.listing.stop();
    if (this.shown === product.sku && this.strip) return;
    this.clearStripOnly();
    this.shown = product.sku;
    this.price = null;
    this.advice = null;
    void send("product-detected", { product }).catch(() => undefined);
    if (this.dismissed.has(product.sku)) return;

    this.handlers = {
      onOpen: (mode) => void send("open-panel", { mode }).catch(() => undefined),
      onClose: () => {
        this.dismissed.add(product.sku);
        this.clearStripOnly();
      },
      onRetry: () => void this.loadSummary(product, this.runId),
    };
    this.strip = mountStrip(this.doc, { state: { kind: "loading" }, price: null, advice: null, ...this.handlers });
    void this.loadPrice(product, run);
    await this.loadSummary(product, run);
  }

  /** The price line is secondary: if it cannot be loaded the strip simply shows the current price and no history. */
  private async loadPrice(product: ProductSnapshot, run: number): Promise<void> {
    const current = product.price?.price ?? null;
    this.price = { current, lowest: null };
    this.redraw();
    try {
      const { lowest } = await send("price-info", { siteId: product.siteId, parentSku: product.parentSku, sku: product.sku });
      if (run !== this.runId || this.shown !== product.sku) return;
      this.price = { current, lowest };
      this.redraw();
    } catch {
      /* keep the price without history */
    }
  }

  private async loadSummary(product: ProductSnapshot, run: number): Promise<void> {
    this.setState({ kind: "loading" });
    let state: StripState;
    try {
      const response = (await send("summary", { siteId: product.siteId, parentSku: product.parentSku })) as { summary?: ProductSummary | null; error?: boolean };
      state = response.error || response.summary === undefined ? { kind: "error" } : { kind: "ready", summary: response.summary };
    } catch {
      state = { kind: "error" };
    }
    if (run === this.runId && this.shown === product.sku) this.setState(state);
    if (state.kind === "ready" && state.summary && state.summary.reviewsCount >= SIZE_ADVICE_MIN_REVIEWS) void this.loadAdvice(product, run);
  }

  /** Personal size advice needs the account and enough comparable reviews; without either the strip says nothing about it. */
  private async loadAdvice(product: ProductSnapshot, run: number): Promise<void> {
    try {
      const { advice } = await send("size-advice", { siteId: product.siteId, parentSku: product.parentSku, productType: product.productType, brand: product.brand });
      if (run !== this.runId || this.shown !== product.sku) return;
      this.advice = advice;
      this.redraw();
    } catch {
      /* no advice */
    }
  }

  private state: StripState = { kind: "loading" };

  private setState(state: StripState): void {
    this.state = state;
    this.redraw();
  }

  private redraw(): void {
    this.strip?.update({ state: this.state, price: this.price, advice: this.advice, ...this.handlers });
  }

  private clearStripOnly(): void {
    this.strip?.unmount();
    this.strip = null;
  }

  private clear(): void {
    this.clearStripOnly();
    if (this.shown !== null) {
      this.shown = null;
      void send("product-cleared", {}).catch(() => undefined);
    }
  }

  private reportOnce(path: string, detection: Parameters<typeof isReportableFailure>[0]): void {
    if (this.reported.has(path)) return;
    this.reported.add(path);
    void send("detect-failed", {
      failure: { siteId: detection.siteId, confidence: detection.confidence, conflict: detection.conflict, signals: detection.signals },
    }).catch(() => undefined);
  }
}
