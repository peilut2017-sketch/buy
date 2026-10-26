// Stars on category and search pages (spec 3): a small rating and review count on each product that has reviews.
// Quiet by design: nothing is added to a card without reviews, nothing is added on product pages, the person can turn it
// off, and a page that does not match the rules is left exactly as it was.

import { countLabel, formatRating, parentSkuOf, REVIEWS, type AdapterConfig } from "@smartbuy/core";
import { Root, Stars } from "@smartbuy/ui";
import baseCss from "@smartbuy/ui/base.css?inline";
import tokensCss from "@smartbuy/ui/tokens.css?inline";
import { h, render } from "preact";
import { send } from "../lib/messages.ts";
import type { RegisteredSite } from "../lib/sites.ts";
import { LISTING_SETTING } from "../lib/settings.ts";
import { getLocal } from "../lib/storage.ts";

export const LISTING_HOST_TAG = "smartbuy-stars";
const MAX_CARDS_PER_PAGE = 200;
const BATCH = 60;
const RESCAN_DELAY_MS = 400;

const css = `${tokensCss}\n${baseCss}\n.listing { display: inline-flex; align-items: center; gap: 6px; padding-block: 2px; }`;
let sheet: CSSStyleSheet | null | undefined;

/** One shared stylesheet for every card; browsers without constructable stylesheets fall back to a style element. */
function sharedSheet(): CSSStyleSheet | null {
  if (sheet !== undefined) return sheet;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
  } catch {
    sheet = null;
  }
  return sheet;
}

export interface Rating {
  ratingAvg: number;
  reviewsCount: number;
}

function Badge({ rating }: { rating: Rating }) {
  return (
    <Root class="listing">
      <Stars value={rating.ratingAvg} size={14} />
      <span class="sb-t-support">
        <span class="sb-num">{formatRating(rating.ratingAvg)}</span>
        <span class="sb-secondary"> ({countLabel(rating.reviewsCount, REVIEWS)})</span>
      </span>
    </Root>
  );
}

export class ListingStars {
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private hosts = new Map<Element, HTMLElement>();
  private known = new Map<string, Rating | null>();
  private cfg: AdapterConfig | null = null;
  private run = 0;

  constructor(private readonly site: RegisteredSite, private readonly doc: Document) {}

  /** Starts watching the page. Does nothing when the store has no listing rules or the person turned the stars off. */
  async start(cfg: AdapterConfig): Promise<void> {
    this.stop();
    const run = ++this.run;
    if (!cfg.listing || !this.site.adapter.readListingCards) return;
    const enabled = (await getLocal<boolean>(LISTING_SETTING).catch(() => null)) ?? true;
    if (!enabled || run !== this.run) return;
    this.cfg = cfg;
    await this.scan(run);
    if (run !== this.run) return;
    // Category pages load more products as the person scrolls.
    this.observer = new MutationObserver(() => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.scan(run), RESCAN_DELAY_MS);
    });
    this.observer.observe(this.doc.body, { childList: true, subtree: true });
  }

  stop(): void {
    this.run++;
    clearTimeout(this.timer);
    this.observer?.disconnect();
    this.observer = null;
    for (const host of this.hosts.values()) host.remove();
    this.hosts.clear();
  }

  private async scan(run: number): Promise<void> {
    const cfg = this.cfg;
    if (!cfg || !this.site.adapter.readListingCards) return;
    let cards;
    try {
      cards = this.site.adapter.readListingCards(this.doc, cfg);
    } catch {
      return; // broken rules must never break the page
    }
    const fresh = cards.filter((c) => !this.hosts.has(c.element) && c.element.isConnected).slice(0, MAX_CARDS_PER_PAGE - this.hosts.size);
    const parents = new Map<Element, string>();
    for (const card of fresh) {
      const parent = parentSkuOf(card.sku, cfg);
      if (parent) parents.set(card.element, parent.toLowerCase());
    }
    const missing = [...new Set(parents.values())].filter((p) => !this.known.has(p));
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      let summaries: Awaited<ReturnType<typeof send<"listing-summaries">>>["summaries"] = [];
      try {
        summaries = (await send("listing-summaries", { siteId: this.site.id, parentSkus: batch })).summaries;
      } catch {
        return; // try again on the next change of the page
      }
      for (const parent of batch) this.known.set(parent, null);
      for (const s of summaries) this.known.set(s.parentSku.toLowerCase(), { ratingAvg: s.ratingAvg, reviewsCount: s.reviewsCount });
    }
    if (run !== this.run) return;

    for (const [element, parent] of parents) {
      const rating = this.known.get(parent);
      if (!rating || this.hosts.has(element)) continue;
      this.hosts.set(element, this.mount(element, rating));
    }
  }

  private mount(card: Element, rating: Rating): HTMLElement {
    const host = this.doc.createElement(LISTING_HOST_TAG);
    host.setAttribute("dir", "rtl");
    host.style.cssText = "display:block;margin:4px 0;";
    const shadow = host.attachShadow({ mode: "open" });
    const shared = sharedSheet();
    if (shared) shadow.adoptedStyleSheets = [shared];
    else {
      const style = this.doc.createElement("style");
      style.textContent = css;
      shadow.append(style);
    }
    const container = this.doc.createElement("div");
    shadow.append(container);
    render(h(Badge, { rating }), container);
    card.append(host);
    return host;
  }
}
