import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_CONFIG, terminalxAdapter } from "./index.ts";

// REAL pages saved from terminalx.com on 25.10.2026 (rendered DOM, logged out, personal identifiers scrubbed).
// See tests/fixtures/terminalx/README.md and docs/10-phase0-findings.md. These tests are the acceptance check
// "detection is right on 20 real product pages" from docs/05-roadmap.md.
const dir = resolve(__dirname, "../../../../tests/fixtures/terminalx");
const html = (name: string) => readFileSync(resolve(dir, name), "utf8");
const parse = (name: string) => new DOMParser().parseFromString(html(name), "text/html");
const cfg = BUNDLED_CONFIG.config;

const PRODUCT_FILES = readdirSync(dir).filter((f) => /^product-.*-[A-Z]\d+\.html$/.test(f)).sort();
const skuOf = (file: string) => /-([A-Z]\d+)\.html$/.exec(file)![1]!;

interface LdOffer { availability: string; price: number; priceCurrency: string }
function jsonLdOffers(name: string): LdOffer[] {
  const doc = parse(name);
  for (const script of Array.from(doc.querySelectorAll("script[type='application/ld+json']"))) {
    const data = JSON.parse(script.textContent ?? "null");
    if (data?.["@type"] === "Product") return data.offers;
  }
  throw new Error(`no Product JSON-LD in ${name}`);
}

describe("terminalx adapter on 20 real product pages", () => {
  it("has the 20 pages the research collected", () => {
    expect(PRODUCT_FILES).toHaveLength(20);
  });

  describe.each(PRODUCT_FILES)("%s", (file) => {
    const sku = skuOf(file);
    const doc = parse(file);
    // Visitors arrive with ?color= added by the page itself, so the real address is used.
    const url = new URL(`https://www.terminalx.com/product/${sku}?color=1`);

    it("is detected with high confidence, and the model SKU is the first six characters", () => {
      const d = terminalxAdapter.detectProduct(doc, url, cfg);
      expect(d.sku).toBe(sku.toLowerCase());
      expect(d.parentSku).toBe(sku.slice(0, 6).toLowerCase());
      expect(d.confidence).toBe("high");
      expect(d.conflict).toBe(false);
      expect(d.signals.find((s) => s.name === "canonical")?.agrees).toBe(true);
      expect(d.signals.find((s) => s.name === "jsonLd")?.agrees).toBe(true);
    });

    it("reads one option per size, and the unavailable ones match the structured data", () => {
      const offers = jsonLdOffers(file);
      const sizes = terminalxAdapter.readVariantOptions(doc, cfg).find((g) => g.name === "מידה");
      expect(sizes, "size group").toBeDefined();
      expect(sizes!.values).toHaveLength(offers.length);
      expect(sizes!.values.filter((v) => !v.available)).toHaveLength(offers.filter((o) => o.availability.endsWith("OutOfStock")).length);
    });

    it("reads the colour group with a value for every swatch", () => {
      const colour = terminalxAdapter.readVariantOptions(doc, cfg).find((g) => g.name === "צבע");
      if (!colour) return; // single-colour beauty and home items have no colour group
      expect(colour.values.length).toBeGreaterThan(0);
      for (const v of colour.values) expect(v.value).not.toMatch(/:\s*צבע/);
    });

    it("reads the price and stock the page shows", () => {
      const offers = jsonLdOffers(file);
      const price = terminalxAdapter.readPriceStock(doc, cfg);
      expect(price).not.toBeNull();
      expect(price!.currency).toBe("ILS");
      expect(price!.price).toBe(offers[0]!.price);
      expect(price!.inStock).toBe(offers.some((o) => o.availability.endsWith("InStock")));
      if (price!.regularPrice !== null) expect(price!.regularPrice).toBeGreaterThan(price!.price!);
    });
  });

  it("does not trust og:url, which the site breaks whenever a colour is in the address", () => {
    const withColour = parse("product-shirt-K047460001.html").querySelector("meta[property='og:url']")?.getAttribute("content");
    expect(withColour).toBe("https://www.terminalx.com/product/K047460001?color=48552/product/K047460001");
    expect(cfg.signals).not.toHaveProperty("ogUrl");
  });

  it("recognises the same model in different colours as one parent", () => {
    const a = terminalxAdapter.detectProduct(parse("product-shirt-K145940001.html"), new URL("https://www.terminalx.com/product/K145940001"), cfg);
    const b = terminalxAdapter.detectProduct(parse("product-shirt-K145940005.html"), new URL("https://www.terminalx.com/product/K145940005"), cfg);
    expect(a.parentSku).toBe("k14594");
    expect(b.parentSku).toBe(a.parentSku);
    expect(a.sku).not.toBe(b.sku);
  });

  it("handles the short beauty SKU, whose image carries a longer name", () => {
    const d = terminalxAdapter.detectProduct(parse("product-beauty-K26294.html"), new URL("https://www.terminalx.com/product/K26294"), cfg);
    expect(d).toMatchObject({ sku: "k26294", parentSku: "k26294", confidence: "high", conflict: false });
  });

  it("accepts the other address forms a shopper can arrive from", () => {
    const doc = parse("product-shirt-K047460001.html");
    for (const path of ["/brands/calvin-klein/K047460001", "/women/tops/shirts/k047460001?color=48552", "/product/K047460001/"]) {
      expect(terminalxAdapter.detectProduct(doc, new URL(`https://www.terminalx.com${path}`), cfg).sku, path).toBe("k047460001");
    }
  });

  it("does not detect category or search pages as products", () => {
    for (const [file, path] of [["category-women-shirts.html", "/women/tops/shirts"], ["category-men-tshirts.html", "/men/shirts/tshirts"], ["category-search-shirt.html", "/catalogsearch/result/"]] as const) {
      const d = terminalxAdapter.detectProduct(parse(file), new URL(`https://www.terminalx.com${path}`), cfg);
      expect(d.sku, file).toBeNull();
    }
  });

  it("finds the products on category and search pages, 24 per page, with their model SKU", () => {
    for (const file of ["category-women-shirts.html", "category-men-tshirts.html", "category-search-shirt.html"]) {
      const cards = terminalxAdapter.readListingCards!(parse(file), cfg);
      expect(cards, file).toHaveLength(24);
      for (const c of cards) expect(c.sku).toMatch(/^[a-z]\d{5}(\d{4})?$/);
    }
  });
});

describe("order confirmation email (sanitized real email, 18.10.2026)", () => {
  const raw = readFileSync(resolve(dir, "order-confirmation-sanitized.eml"), "utf8");

  it("is a real mail from the store, with the order number scrubbed", () => {
    expect(raw).toContain("From: TERMINAL X <support@terminalx.com>");
    expect(raw).toContain("SCRUBBED_ORDER_ID");
  });

  it("gives every item's SKU, colour and size, and the day it was sent", () => {
    // The email is one text/html part; quoted-printable or base64 is decoded by the Email Worker, so the test decodes it the same way.
    const html = decodeBody(raw);
    const order = terminalxAdapter.parseConfirmationEmail!({ from: "TERMINAL X <support@terminalx.com>", subject: "עדכון מהטרמינל ✈ הזמנתך התקבלה", text: "", html, date: "Sun, 18 Oct 2026 07:48:24 +0000" });
    expect(order).toMatchObject({ orderNumber: "SCRUBBED_ORDER_ID", orderedAt: "2026-10-18", deliveredAt: null });
    expect(order!.items).toEqual([
      { sku: "k12610001704", variant: { צבע: "בורדו", מידה: "M" } },
      { sku: "r86809000115", variant: { צבע: "קוניאק", מידה: "OS" } },
      { sku: "k11102000103", variant: { צבע: "כחול נייבי", מידה: "S" } },
    ]);
  });

  it("refuses mail that is not from the store, and mail without an order number or items", () => {
    expect(terminalxAdapter.parseConfirmationEmail!({ from: "x <phish@evil.example>", subject: "", text: "מספר הזמנה: #1 K12610001704 10 ₪", html: null })).toBeNull();
    expect(terminalxAdapter.parseConfirmationEmail!({ from: "support@terminalx.com", subject: "", text: "שלום", html: null })).toBeNull();
    expect(terminalxAdapter.parseConfirmationEmail!({ from: "support@terminalx.com", subject: "", text: "מספר הזמנה: #5", html: null })).toBeNull();
  });

  it("maps the email's SKUs to the same model as the product pages", () => {
    // K12610001704 is the item of model K12610: the page SKU is K126100017, the model its first six characters.
    expect(cfg.parentSku.fromSku).toBe("^([a-z]\\d{5})");
    expect(new RegExp(cfg.parentSku.fromSku, "i").exec("K12610001704")![1]!.toLowerCase()).toBe("k12610");
  });
});

/** Minimal MIME decoding for the one-part test email: headers end at the first blank line. */
function decodeBody(source: string): string {
  const split = source.search(/\r?\n\r?\n/);
  const head = source.slice(0, split);
  const body = source.slice(split).trim();
  if (/content-transfer-encoding:\s*base64/i.test(head)) return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  if (/content-transfer-encoding:\s*quoted-printable/i.test(head)) {
    const bytes: number[] = [];
    const flat = body.replace(/=\r?\n/g, "");
    for (let i = 0; i < flat.length; i++) {
      if (flat[i] === "=" && /^[0-9A-F]{2}$/i.test(flat.slice(i + 1, i + 3))) {
        bytes.push(parseInt(flat.slice(i + 1, i + 3), 16));
        i += 2;
      } else bytes.push(...Buffer.from(flat[i]!, "utf8"));
    }
    return Buffer.from(bytes).toString("utf8");
  }
  return body;
}
