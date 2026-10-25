// Config-driven page reading. Store adapters supply the config; this engine runs it over a Document.
// No network calls here: detection works on the page that is already loaded.

import { decideDetection, normalizeSku, type SignalReading } from "./detection.ts";
import type {
  AdapterConfig,
  Detection,
  ListingCard,
  PriceSnapshot,
  SignalRule,
  VariantOption,
  VariantValues,
} from "./types.ts";

function firstGroup(pattern: string, text: string): string | null {
  const match = new RegExp(pattern, "i").exec(text);
  return match?.[1] ?? null;
}

export function skuFromPath(url: URL, cfg: AdapterConfig): string | null {
  return firstGroup(cfg.productUrl, url.pathname);
}

export function parentSkuOf(sku: string, cfg: AdapterConfig): string | null {
  return firstGroup(cfg.parentSku.fromSku, sku);
}

function readRule(doc: Document, rule: SignalRule): string | null {
  const el = doc.querySelector(rule.selector);
  if (!el) return null;
  const raw = rule.attr ? el.getAttribute(rule.attr) : el.textContent;
  return raw ? firstGroup(rule.skuRegex, raw) : null;
}

function valueAtPath(object: unknown, path: string): unknown {
  let current: unknown = object;
  for (const part of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Every JSON-LD object on the page, flattened out of arrays and @graph wrappers. */
export function readJsonLd(doc: Document): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node !== "object" || node === null) return;
    const obj = node as Record<string, unknown>;
    found.push(obj);
    if (obj["@graph"]) visit(obj["@graph"]);
  };
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      visit(JSON.parse(script.textContent ?? ""));
    } catch {
      // A page with broken structured data is normal. The other signals still count.
    }
  }
  return found;
}

function hasType(obj: Record<string, unknown>, type: string): boolean {
  const t = obj["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

function jsonLdProduct(doc: Document, type: string): Record<string, unknown> | null {
  return readJsonLd(doc).find((o) => hasType(o, type)) ?? null;
}

export function readSignals(doc: Document, cfg: AdapterConfig): SignalReading[] {
  const readings: SignalReading[] = [];
  for (const name of ["canonical", "ogUrl", "image"] as const) {
    const rule = cfg.signals[name];
    if (rule) readings.push({ name, value: readRule(doc, rule) });
  }
  const ld = cfg.signals.jsonLd;
  if (ld) {
    const product = jsonLdProduct(doc, ld.type);
    const raw = product ? valueAtPath(product, ld.skuPath) : undefined;
    const text = typeof raw === "string" || typeof raw === "number" ? String(raw) : null;
    readings.push({ name: "jsonLd", value: text ? (ld.skuRegex ? firstGroup(ld.skuRegex, text) : text) : null });
  }
  return readings;
}

export function detectWithConfig(siteId: string, doc: Document, url: URL, cfg: AdapterConfig): Detection {
  return decideDetection({
    siteId,
    urlSku: skuFromPath(url, cfg),
    verifications: readSignals(doc, cfg),
    parentOf: (sku) => parentSkuOf(sku, cfg),
  });
}

export function readVariantOptionsWithConfig(doc: Document, cfg: AdapterConfig): VariantOption[] {
  const rules = cfg.variants;
  if (!rules) return [];
  const groups: VariantOption[] = [];
  for (const group of Array.from(doc.querySelectorAll(rules.groups))) {
    const name = group.querySelector(rules.label)?.textContent?.trim();
    if (!name) continue;
    const values = Array.from(group.querySelectorAll(rules.option))
      .map((el) => ({
        value: (el.getAttribute("data-value") ?? el.textContent ?? "").trim(),
        selected: el.matches(rules.selected),
        available: rules.unavailable ? !el.matches(rules.unavailable) : true,
      }))
      .filter((v) => v.value !== "");
    if (values.length > 0) groups.push({ name, values });
  }
  return groups;
}

export function readSelectedVariantWithConfig(doc: Document, cfg: AdapterConfig): VariantValues {
  const selected: VariantValues = {};
  for (const group of readVariantOptionsWithConfig(doc, cfg)) {
    const chosen = group.values.find((v) => v.selected);
    if (chosen) selected[group.name] = chosen.value;
  }
  return selected;
}

/** "₪1,249.90", "149,90 ש״ח" and "149.9" all give a number. Null when there is no price in the text. */
export function parsePriceText(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[^\d.,]/g, "");
  if (cleaned === "") return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma > lastDot) {
    // "149,90" decimal comma, or "1.249,90" European thousands.
    const decimals = cleaned.length - lastComma - 1;
    normalized = decimals === 3 && lastDot === -1 ? cleaned.replace(/,/g, "") : cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = cleaned.replace(/,/g, "");
  }
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function availabilityToStock(value: unknown): boolean | null {
  if (typeof value !== "string") return null;
  if (/InStock|LimitedAvailability|OnlineOnly/i.test(value)) return true;
  if (/OutOfStock|SoldOut|Discontinued/i.test(value)) return false;
  return null;
}

/** Structured data first (a web standard), then the configured selectors. */
export function readPriceStockWithConfig(doc: Document, cfg: AdapterConfig): PriceSnapshot | null {
  let price: number | null = null;
  let regularPrice: number | null = null;
  let currency = cfg.price?.currency ?? "ILS";
  let inStock: boolean | null = null;

  const ld = cfg.signals.jsonLd;
  const product = ld ? jsonLdProduct(doc, ld.type) : null;
  if (product) {
    const offers = product.offers;
    const offer = (Array.isArray(offers) ? offers[0] : offers) as Record<string, unknown> | undefined;
    if (offer && typeof offer === "object") {
      const p = offer.price ?? offer.lowPrice;
      price = typeof p === "number" ? p : parsePriceText(typeof p === "string" ? p : null);
      if (typeof offer.priceCurrency === "string") currency = offer.priceCurrency;
      inStock = availabilityToStock(offer.availability);
    }
  }
  if (cfg.price) {
    const fromPage = parsePriceText(doc.querySelector(cfg.price.selector)?.textContent);
    if (fromPage !== null) price = fromPage;
    if (cfg.price.regularSelector) regularPrice = parsePriceText(doc.querySelector(cfg.price.regularSelector)?.textContent);
  }
  if (cfg.stock?.outOfStockSelector && doc.querySelector(cfg.stock.outOfStockSelector)) inStock = false;
  else if (cfg.stock?.inStockSelector && doc.querySelector(cfg.stock.inStockSelector)) inStock = true;

  if (price === null && inStock === null) return null;
  if (regularPrice !== null && price !== null && regularPrice <= price) regularPrice = null;
  return { price, regularPrice, currency, inStock };
}

export function readListingCardsWithConfig(doc: Document, cfg: AdapterConfig): ListingCard[] {
  const rules = cfg.listing;
  if (!rules) return [];
  const cards: ListingCard[] = [];
  for (const el of Array.from(doc.querySelectorAll(rules.card))) {
    const href = el.querySelector(rules.link)?.getAttribute("href");
    if (!href) continue;
    let pathname: string;
    try {
      pathname = new URL(href, doc.location?.href ?? "https://example.invalid/").pathname;
    } catch {
      continue;
    }
    const sku = normalizeSku(firstGroup(cfg.productUrl, pathname));
    if (sku) cards.push({ sku, element: el });
  }
  return cards;
}

export interface ProductMeta {
  name: string | null;
  brand: string | null;
  imageUrl: string | null;
}

function clean(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const value = text.replace(/\s+/g, " ").trim();
  return value === "" ? null : value.slice(0, max);
}

function absoluteHttp(raw: unknown, base: string): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const text = typeof value === "object" && value !== null ? (value as Record<string, unknown>).url : value;
  if (typeof text !== "string") return null;
  try {
    const url = new URL(text, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Name, brand and picture for the panel header. Standard markup first; nothing is invented when it is missing. */
export function readProductMeta(doc: Document, cfg: AdapterConfig): ProductMeta {
  const ld = cfg.signals.jsonLd ? jsonLdProduct(doc, cfg.signals.jsonLd.type) : jsonLdProduct(doc, "Product");
  const base = doc.baseURI || "https://example.invalid/";
  const og = (property: string) => doc.querySelector(`meta[property='${property}']`)?.getAttribute("content");
  const brandRaw = ld?.brand;
  const brand =
    typeof brandRaw === "string" ? brandRaw : typeof brandRaw === "object" && brandRaw !== null ? String((brandRaw as Record<string, unknown>).name ?? "") : null;
  return {
    name: clean(typeof ld?.name === "string" ? ld.name : null, 200) ?? clean(og("og:title"), 200) ?? clean(doc.querySelector("h1")?.textContent, 200) ?? clean(doc.title, 200),
    brand: clean(brand, 80),
    imageUrl: absoluteHttp(ld?.image, base) ?? absoluteHttp(og("og:image"), base),
  };
}
