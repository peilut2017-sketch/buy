import { describe, expect, it } from "vitest";
import {
  detectWithConfig,
  parsePriceText,
  readListingCardsWithConfig,
  readPriceStockWithConfig,
  readProductMeta,
  readSelectedVariantWithConfig,
  readVariantOptionsWithConfig,
} from "./engine.ts";
import type { AdapterConfig } from "./types.ts";

const base: AdapterConfig = {
  productUrl: "^/p/([a-z]{2}\\d{4})$",
  signals: {
    canonical: { selector: "link[rel=canonical]", attr: "href", skuRegex: "/p/([a-z]{2}\\d{4})$" },
    jsonLd: { type: "Product", skuPath: "sku" },
  },
  parentSku: { fromSku: "^([a-z]{2}\\d{2})" },
  emailDomains: [],
  productType: "apparel",
};

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("parsePriceText", () => {
  it.each([
    ["₪149.90", 149.9],
    ["149,90 ש״ח", 149.9],
    ["₪1,249.90", 1249.9],
    ["1.249,90", 1249.9],
    ["1,249", 1249],
    ["  ₪ 99 ", 99],
    ["149.9", 149.9],
  ])("reads %s", (text, expected) => {
    expect(parsePriceText(text)).toBe(expected);
  });
  it.each(["", "אזל מהמלאי", null, undefined])("finds no price in %s", (text) => {
    expect(parsePriceText(text as string | null | undefined)).toBeNull();
  });
});

describe("detectWithConfig", () => {
  it("reads structured data inside @graph wrappers and arrays, and survives broken JSON", () => {
    const doc = parse(`<head>
      <script type="application/ld+json">{ not json</script>
      <script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":["Thing","Product"],"sku":"ab1234"}]}</script>
    </head>`);
    const d = detectWithConfig("x", doc, new URL("https://x.test/p/ab1234"), base);
    expect(d).toMatchObject({ sku: "ab1234", confidence: "high" });
    expect(d.signals.find((s) => s.name === "jsonLd")?.agrees).toBe(true);
  });

  it("ignores a numeric or missing SKU in structured data gracefully", () => {
    const doc = parse(`<head><script type="application/ld+json">{"@type":"Product","name":"x"}</script></head>`);
    const d = detectWithConfig("x", doc, new URL("https://x.test/p/ab1234"), base);
    expect(d).toMatchObject({ sku: "ab1234", confidence: "medium" });
  });
});

describe("variants", () => {
  const cfg: AdapterConfig = {
    ...base,
    variants: { groups: ".opt", label: ".opt-label", option: ".opt-value", selected: ".on", unavailable: ".out" },
  };
  const doc = parse(`
    <div class="opt"><span class="opt-label">צבע</span>
      <button class="opt-value on">כחול</button><button class="opt-value">שחור</button></div>
    <div class="opt"><span class="opt-label">מידה</span>
      <button class="opt-value out">S</button><button class="opt-value on">M</button><button class="opt-value" data-value="L">  </button></div>
    <div class="opt"><button class="opt-value">no label, skipped</button></div>`);

  it("reads every group and option from the page", () => {
    expect(readVariantOptionsWithConfig(doc, cfg)).toEqual([
      { name: "צבע", values: [{ value: "כחול", selected: true, available: true }, { value: "שחור", selected: false, available: true }] },
      {
        name: "מידה",
        values: [
          { value: "S", selected: false, available: false },
          { value: "M", selected: true, available: true },
          { value: "L", selected: false, available: true },
        ],
      },
    ]);
  });

  it("reads the selected value of each group", () => {
    expect(readSelectedVariantWithConfig(doc, cfg)).toEqual({ צבע: "כחול", מידה: "M" });
  });

  it("returns nothing when the config has no variant rules", () => {
    expect(readVariantOptionsWithConfig(doc, base)).toEqual([]);
  });
});

describe("price and stock", () => {
  const cfg: AdapterConfig = {
    ...base,
    price: { selector: ".price", regularSelector: ".was" },
    stock: { outOfStockSelector: ".sold-out" },
  };

  it("prefers the visible price and keeps a regular price only when it is higher", () => {
    const doc = parse(`<span class="was">₪199.90</span><span class="price">₪149.90</span>`);
    expect(readPriceStockWithConfig(doc, cfg)).toEqual({ price: 149.9, regularPrice: 199.9, currency: "ILS", inStock: null });
    const odd = parse(`<span class="was">₪100</span><span class="price">₪149.90</span>`);
    expect(readPriceStockWithConfig(odd, cfg)?.regularPrice).toBeNull();
  });

  it("marks out of stock from the page", () => {
    const doc = parse(`<span class="price">₪149.90</span><div class="sold-out">אזל</div>`);
    expect(readPriceStockWithConfig(doc, cfg)?.inStock).toBe(false);
  });

  it("reads schema.org offers, arrays included", () => {
    const doc = parse(`<script type="application/ld+json">{"@type":"Product","sku":"ab1234","offers":[{"price":99,"priceCurrency":"ILS","availability":"https://schema.org/OutOfStock"}]}</script>`);
    expect(readPriceStockWithConfig(doc, base)).toEqual({ price: 99, regularPrice: null, currency: "ILS", inStock: false });
  });

  it("is null when the page offers nothing", () => {
    expect(readPriceStockWithConfig(parse("<p>hi</p>"), base)).toBeNull();
  });
});

describe("listing cards", () => {
  const cfg: AdapterConfig = { ...base, listing: { card: ".card", link: "a" } };
  it("extracts the SKU of each card from its link", () => {
    const doc = parse(`
      <div class="card"><a href="/p/ab1234">one</a></div>
      <div class="card"><a href="https://x.test/p/CD5678?ref=cat">two</a></div>
      <div class="card"><a href="/women">not a product</a></div>
      <div class="card">no link</div>`);
    expect(readListingCardsWithConfig(doc, cfg).map((c) => c.sku)).toEqual(["ab1234", "cd5678"]);
  });
  it("returns nothing without listing rules", () => {
    expect(readListingCardsWithConfig(parse("<div class='card'></div>"), base)).toEqual([]);
  });
});

describe("readProductMeta", () => {
  const html = (head: string, body = "") => parse(`<head>${head}</head><body>${body}</body>`);

  it("prefers structured data", () => {
    const doc = html(`<title>Fallback</title><meta property="og:title" content="OG name">
      <script type="application/ld+json">{"@type":"Product","name":"  מכנסי   דוגמה ","brand":{"@type":"Brand","name":"מותג"},"image":["https://img.test/a.jpg"]}</script>`);
    expect(readProductMeta(doc, base)).toEqual({ name: "מכנסי דוגמה", brand: "מותג", imageUrl: "https://img.test/a.jpg" });
  });

  it("falls back to Open Graph, then the heading, then the title", () => {
    expect(readProductMeta(html(`<meta property="og:title" content="OG name"><meta property="og:image" content="/pic.jpg">`), base)).toMatchObject({
      name: "OG name",
      imageUrl: expect.stringMatching(/\/pic\.jpg$/),
    });
    expect(readProductMeta(html(`<title>Doc title</title>`, `<h1> Heading </h1>`), base).name).toBe("Heading");
    expect(readProductMeta(html(`<title>Doc title</title>`), base).name).toBe("Doc title");
  });

  it("returns nulls rather than inventing anything, and refuses non-web image URLs", () => {
    const empty = readProductMeta(parse("<p></p>"), base);
    expect(empty).toEqual({ name: null, brand: null, imageUrl: null });
    expect(readProductMeta(html(`<meta property="og:image" content="javascript:alert(1)">`), base).imageUrl).toBeNull();
    expect(readProductMeta(html(`<meta property="og:image" content="data:image/png;base64,AAAA">`), base).imageUrl).toBeNull();
  });

  it("cuts very long names", () => {
    expect(readProductMeta(html(`<title>${"א".repeat(500)}</title>`), base).name).toHaveLength(200);
  });
});
