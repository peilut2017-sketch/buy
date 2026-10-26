// The scheduled price check (spec 13): twice a day, open the product pages that people watch and record price and stock
// when they changed. Allowed by the terms of use (section "פעולות אוטומטיות בשמכם"). It is deliberately gentle:
// a small batch, a pause between pages, an honest user agent, only pages nobody reported in the last hours, and it
// stops for the day at the first sign that the store is refusing it.

import { fail, ok } from "../http.ts";
import { parseProductHtml } from "../pageParse.ts";
import type { Handler } from "./context.ts";

export const MAX_PER_RUN = 60;
export const MIN_GAP_HOURS = 12;
export const DELAY_MS = 1500;
const BLOCKED = new Set([401, 403, 407, 429, 503]);

export interface ScrapeSummary {
  checked: number;
  changed: number;
  unchanged: number;
  failed: number;
  mismatched: number;
  blocked: boolean;
}

export const scrapeWatched: Handler = async (ctx) => {
  if (!ctx.isService) return fail(403, "הפעולה שמורה למערכת.");
  if (!ctx.fetchPage) return fail(500, "השרת לא מוגדר לבדיקת מחירים.");

  const now = ctx.now.toISOString();
  const summary: ScrapeSummary = { checked: 0, changed: 0, unchanged: 0, failed: 0, mismatched: 0, blocked: false };
  const targets = await ctx.store.listScrapeTargets(new Date(ctx.now.getTime() - MIN_GAP_HOURS * 3_600_000).toISOString(), MAX_PER_RUN);
  const sites = new Map<string, Awaited<ReturnType<typeof ctx.store.getSite>>>();

  for (const target of targets) {
    if (!sites.has(target.siteId)) sites.set(target.siteId, await ctx.store.getSite(target.siteId));
    const site = sites.get(target.siteId);
    const template = site?.adapterConfig.pageUrl;
    const rule = site?.adapterConfig.signals?.jsonLd;
    if (!site || site.status === "paused" || !template || !rule) continue;

    const url = template.replace("{sku}", encodeURIComponent(target.sku.toUpperCase()));
    // The address comes from the store's own rules, and must stay on the store's own domains.
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    if (!site.domains.includes(host)) continue;

    if (summary.checked > 0) await ctx.sleep?.(DELAY_MS);
    summary.checked++;
    let page: { status: number; text: string };
    try {
      page = await ctx.fetchPage(url);
    } catch {
      summary.failed++;
      continue;
    }
    if (BLOCKED.has(page.status)) {
      summary.blocked = true;
      break; // the store is saying no: stop for this run and tell the admin
    }
    if (page.status !== 200) {
      summary.failed++;
      continue;
    }

    const parsed = parseProductHtml(page.text, rule);
    if (!parsed) {
      summary.failed++;
      continue;
    }
    // A redirect to another product, or a changed page, must not write a price on the wrong item.
    if (parsed.sku !== target.sku.toLowerCase() || (parsed.price === null && parsed.inStock === null)) {
      summary.mismatched++;
      continue;
    }

    const last = await ctx.store.lastPrice(target.variantId);
    if (last && last.price === parsed.price && last.inStock === parsed.inStock) {
      summary.unchanged++;
      continue;
    }
    // A price read by the server from the store's own page is trusted without a second report.
    await ctx.store.insertPriceEvent({ variantId: target.variantId, price: parsed.price, currency: parsed.currency, inStock: parsed.inStock, installHash: null, source: "scrape", now });
    summary.changed++;
  }

  await ctx.store.setPrivateSetting("scrape_state", { at: now, ...summary });
  return ok(summary);
};
