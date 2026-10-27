// Terminal X adapter. Everything that knows about this store lives here and in its `sites` row.
//
// The rules in config.json come from real pages saved on 25.10.2026 (tests/fixtures/terminalx, docs/10-phase0-findings.md)
// and are tested against all 20 product pages and 3 listing pages. What the sample cannot prove (the whole catalogue,
// future site changes) is covered by the server-side config and the detect_failed reports, not by this file.
//
// SKUs: a product page has a 10-character colour-level SKU (letter, 5 digits of model, 4 digits of colour), or a short
// 6-character SKU on some beauty items. Sizes add 2 digits (12 characters, as in order emails). The model, which all
// colours of a product share, is the first 6 characters.

import {
  detectWithConfig,
  readListingCardsWithConfig,
  readPriceStockWithConfig,
  readSelectedVariantWithConfig,
  readVariantOptionsWithConfig,
  validateConfig,
  type AdapterConfig,
  type Order,
  type OrderItem,
  type SiteAdapter,
  type VersionedConfig,
} from "@smartbuy/core";
import bundled from "../config.json" with { type: "json" };
import site from "../site.json" with { type: "json" };

export const SITE = site;
export const SITE_ID = site.id;
export const DOMAINS: readonly string[] = site.domains;
/** The only host permission this store needs. Requested at runtime, never at install (CLAUDE.md rule 4). */
export const HOST_PERMISSION: string = site.hostPermission;
/** Match patterns for the dynamically registered content script. */
export const CONTENT_MATCHES: readonly string[] = site.contentMatches;

const check = validateConfig(bundled, null);
if (!check.ok) throw new Error(`terminalx bundled config is invalid: ${check.reason}`);

/** Shipped inside the extension as the fallback when the server copy cannot be reached or is rejected. */
export const BUNDLED_CONFIG: VersionedConfig = { version: 1, config: check.config };

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#039;": "'", "&#39;": "'", "&nbsp;": " " };

function plainText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|nbsp|#0?39);/g, (e) => ENTITIES[e] ?? e)
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The order confirmation email ("הזמנתך התקבלה"). Reads the order number, every item's 12-character SKU with its colour and
 * size, and the date the email was sent. There is no delivery date in this email, so it stays null: the review is verified
 * later, from the delivery the person confirms in the extension. The sender's domain is checked by the Email Worker (DKIM);
 * this function only refuses mail that is not from the store at all.
 */
export function parseConfirmationEmail(raw: { from: string; subject: string; text: string; html: string | null; date?: string | null }): Order | null {
  if (!/@(?:[a-z0-9-]+\.)*terminalx\.com>?\s*$/i.test(raw.from.trim())) return null;
  const text = plainText(raw.html ?? raw.text);
  const orderNumber = /מספר הזמנה\s*:\s*#?\s*([A-Za-z0-9_]+)/.exec(text)?.[1];
  if (!orderNumber) return null;

  const items: OrderItem[] = [];
  const itemPattern = /([A-Z]\d{11})\s+[\d,.]+\s*₪/g;
  let from = text.indexOf("קוד מוצר");
  for (let m = itemPattern.exec(text); m; m = itemPattern.exec(text)) {
    const segment = text.slice(Math.max(from, 0), m.index);
    const colour = /צבע\s*:\s*(.+?)\s+מידה\s*:/.exec(segment)?.[1]?.trim();
    const size = /מידה\s*:\s*(.+?)\s+ארץ ייצור/.exec(segment)?.[1]?.trim();
    const variant: Record<string, string> = {};
    if (colour) variant["צבע"] = colour;
    if (size) variant["מידה"] = size;
    items.push({ sku: m[1]!.toLowerCase(), ...(Object.keys(variant).length > 0 ? { variant } : {}) });
    from = m.index + m[0].length;
  }
  if (items.length === 0) return null;

  const sent = raw.date ? new Date(raw.date) : null;
  return { orderNumber, orderedAt: sent && !Number.isNaN(sent.getTime()) ? sent.toISOString().slice(0, 10) : null, deliveredAt: null, items };
}

const NOT_PURCHASES = new Set(["refunded", "canceled", "cancelled", "closed"]);
const IMAGE_BASE = "https://media.terminalx.com/pub/media/catalog/product";

/** The calendar day in Israel, so an order placed at 23:30 local time is not filed under the next day (the store sends UTC). */
function israelDay(iso: string): string | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}

/**
 * The "my orders" list (data.customerOrders). It has no SKUs, sizes or delivery dates, but each item's picture path
 * carries the product's SKU (k126100017-....jpg), which is the page SKU. Colour and size are therefore not known here.
 */
export function parseOrdersResponse(json: unknown, cfg: AdapterConfig): Order[] | null {
  const items = (json as { data?: { customerOrders?: { items?: unknown } } } | null)?.data?.customerOrders?.items;
  if (!Array.isArray(items)) return null;
  const out: Order[] = [];
  for (const raw of items) {
    if (typeof raw !== "object" || raw === null) continue;
    const o = raw as Record<string, unknown>;
    const number = typeof o.order_number === "string" ? o.order_number.trim() : "";
    if (!number || NOT_PURCHASES.has(String(o.status ?? "").toLowerCase())) continue;
    const gallery = Array.isArray(o.items_gallery) ? o.items_gallery : [];
    const titles = Array.isArray(o.items_titles) ? o.items_titles : [];
    const seen = new Set<string>();
    const orderItems: OrderItem[] = [];
    gallery.forEach((path, i) => {
      if (typeof path !== "string") return;
      const sku = /\/([a-z]\d{5}(?:\d{4})?)-\d+\.(?:jpe?g|png|webp)/i.exec(path)?.[1]?.toLowerCase();
      if (!sku || seen.has(sku)) return;
      seen.add(sku);
      const title = typeof titles[i] === "string" ? (titles[i] as string).replace(/\s+/g, " ").trim().slice(0, 200) : "";
      orderItems.push({
        sku,
        ...(title ? { name: title } : {}),
        ...(cfg.pageUrl ? { url: cfg.pageUrl.replace("{sku}", sku.toUpperCase()) } : {}),
        imageUrl: `${IMAGE_BASE}${path.split("?")[0]}`,
      });
    });
    if (orderItems.length === 0) continue;
    const iso = typeof o.created_at_iso === "string" ? o.created_at_iso : null;
    out.push({ orderNumber: number, orderedAt: iso ? israelDay(iso) : null, deliveredAt: null, items: orderItems });
  }
  return out;
}

export const terminalxAdapter: SiteAdapter = {
  id: SITE_ID,
  matchesUrl: (url) => DOMAINS.includes(url.hostname),
  detectProduct: (doc, url, cfg: AdapterConfig) => detectWithConfig(SITE_ID, doc, url, cfg),
  readVariantOptions: readVariantOptionsWithConfig,
  readSelectedVariant: readSelectedVariantWithConfig,
  readPriceStock: readPriceStockWithConfig,
  readListingCards: readListingCardsWithConfig,
  parseConfirmationEmail,
  parseOrdersResponse,
};
