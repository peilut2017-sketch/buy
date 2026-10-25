// Keeps the strip in step with the page: finds the product, shows the strip, and follows single-page navigation.

import { isDetected, validateConfig, type ProductSummary } from "@smartbuy/core";
import { send, type PanelMode, type ProductSnapshot, type SiteConfigResult } from "../lib/messages.ts";
import type { RegisteredSite } from "../lib/sites.ts";
import { isReportableFailure, readPage } from "./detect.ts";
import { mountStrip, type MountedStrip } from "./mount.ts";
import type { StripProps, StripState } from "./Strip.tsx";

/** Client-rendered pages may not have their markup ready at document_idle, so detection retries a few times. */
const RETRY_DELAYS_MS = [0, 1_000, 3_000];

export class PageController {
  private strip: MountedStrip | null = null;
  private shown: string | null = null;
  private dismissed = new Set<string>();
  private reported = new Set<string>();
  private runId = 0;
  private config: SiteConfigResult | null = null;
  private handlers: Pick<StripProps, "onOpen" | "onClose" | "onRetry"> = { onOpen: () => undefined, onClose: () => undefined, onRetry: () => undefined };

  constructor(private readonly site: RegisteredSite, private readonly doc: Document, private readonly win: Window) {}

  /** Call on first load and whenever the address changes without a page load. */
  async refresh(): Promise<void> {
    const run = ++this.runId;
    const config = await this.loadConfig();
    if (run !== this.runId) return;
    if (config.status === "paused") return this.clear();

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
  }

  destroy(): void {
    this.runId++;
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
    if (this.shown === product.sku && this.strip) return;
    this.clearStripOnly();
    this.shown = product.sku;
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
    this.strip = mountStrip(this.doc, { state: { kind: "loading" }, ...this.handlers });
    await this.loadSummary(product, run);
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
  }

  private setState(state: StripState): void {
    this.strip?.update({ state, ...this.handlers });
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
