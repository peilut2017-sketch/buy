// Reads price and stock from a product page's structured data (schema.org JSON-LD), from the raw HTML text.
// Used by the scheduled price check, which has no DOM. The same offer rules are used by the extension (core/engine.ts).

export interface JsonLdRule {
  type: string;
  skuPath: string;
  skuRegex?: string;
}

export interface ParsedProduct {
  sku: string | null;
  name: string | null;
  price: number | null;
  currency: string;
  inStock: boolean | null;
}

export function availabilityToStock(value: unknown): boolean | null {
  if (typeof value !== "string") return null;
  if (/InStock|LimitedAvailability|OnlineOnly/i.test(value)) return true;
  if (/OutOfStock|SoldOut|Discontinued/i.test(value)) return false;
  return null;
}

/** One offer per size: in stock when any size is, out of stock only when every size is known to be. */
export function summarizeOffers(offers: unknown): { price: number | null; currency: string | null; inStock: boolean | null } {
  const list = (Array.isArray(offers) ? offers : [offers]).filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null);
  const first = list[0];
  if (!first) return { price: null, currency: null, inStock: null };
  const raw = first.price ?? first.lowPrice;
  const price = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : null;
  const stocks = list.map((o) => availabilityToStock(o.availability));
  return {
    price: price !== null && Number.isFinite(price) && price > 0 ? price : null,
    currency: typeof first.priceCurrency === "string" ? first.priceCurrency : null,
    inStock: stocks.some((s) => s === true) ? true : stocks.every((s) => s === false) ? false : null,
  };
}

const LD = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function hasType(obj: Record<string, unknown>, type: string): boolean {
  const t = obj["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

function valueAtPath(object: unknown, path: string): unknown {
  let current: unknown = object;
  for (const part of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function parseProductHtml(html: string, rule: JsonLdRule): ParsedProduct | null {
  const visit = (node: unknown, out: Record<string, unknown>[]): void => {
    if (Array.isArray(node)) return node.forEach((n) => visit(n, out));
    if (typeof node !== "object" || node === null) return;
    const obj = node as Record<string, unknown>;
    out.push(obj);
    if (obj["@graph"]) visit(obj["@graph"], out);
  };
  const found: Record<string, unknown>[] = [];
  for (const match of html.matchAll(LD)) {
    try {
      visit(JSON.parse(match[1] ?? ""), found);
    } catch {
      // Broken structured data on a page is normal; the other blocks still count.
    }
  }
  const product = found.find((o) => hasType(o, rule.type));
  if (!product) return null;

  const rawSku = valueAtPath(product, rule.skuPath);
  const skuText = typeof rawSku === "string" || typeof rawSku === "number" ? String(rawSku) : null;
  const sku = skuText && rule.skuRegex ? (new RegExp(rule.skuRegex, "i").exec(skuText)?.[1] ?? null) : skuText;
  const summary = summarizeOffers(product.offers);
  return {
    sku: sku ? sku.toLowerCase() : null,
    name: typeof product.name === "string" ? product.name.trim().slice(0, 200) : null,
    price: summary.price,
    currency: summary.currency ?? "ILS",
    inStock: summary.inStock,
  };
}
