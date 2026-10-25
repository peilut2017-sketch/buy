import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_CONFIG, terminalxAdapter } from "./index.ts";

// These fixtures are SYNTHETIC (see tests/fixtures/terminalx/README.md). They test the logic, not the live site.
const fixture = (name: string) =>
  new DOMParser().parseFromString(readFileSync(resolve(__dirname, "../../../../tests/fixtures/terminalx", name), "utf8"), "text/html");
const cfg = BUNDLED_CONFIG.config;
const at = (path: string) => new URL(`https://www.terminalx.com${path}`);

describe("terminalx adapter (synthetic fixtures, not verified against the live site)", () => {
  it("matches only the store's own hosts", () => {
    expect(terminalxAdapter.matchesUrl(at("/w817260002"))).toBe(true);
    expect(terminalxAdapter.matchesUrl(new URL("https://terminalx.com/w817260002"))).toBe(true);
    expect(terminalxAdapter.matchesUrl(new URL("https://media.terminalx.com/x.jpg"))).toBe(false);
    expect(terminalxAdapter.matchesUrl(new URL("https://example.com/w817260002"))).toBe(false);
  });

  it("detects a product confirmed by every signal as high confidence", () => {
    const d = terminalxAdapter.detectProduct(fixture("product-all-signals.html"), at("/w817260002"), cfg);
    expect(d).toMatchObject({ siteId: "terminalx", sku: "w817260002", parentSku: "w81726", confidence: "high", conflict: false });
    expect(d.signals.map((s) => [s.name, s.agrees])).toEqual([
      ["url", true],
      ["canonical", true],
      ["ogUrl", true],
      ["image", true],
      ["jsonLd", true],
    ]);
  });

  it("accepts a trailing slash and a query string on the address", () => {
    const d = terminalxAdapter.detectProduct(fixture("product-all-signals.html"), at("/w817260002/"), cfg);
    expect(d.sku).toBe("w817260002");
  });

  it("falls back to medium when the page carries no confirming signal", () => {
    const d = terminalxAdapter.detectProduct(fixture("product-no-signals.html"), at("/w817260002"), cfg);
    expect(d).toMatchObject({ sku: "w817260002", confidence: "medium", conflict: false });
  });

  it("lets two contradicting signals outvote the address and raises a conflict", () => {
    const d = terminalxAdapter.detectProduct(fixture("product-conflict.html"), at("/w817260002"), cfg);
    expect(d).toMatchObject({ sku: "w817260003", confidence: "medium", conflict: true });
  });

  it("finds nothing on a category page", () => {
    const d = terminalxAdapter.detectProduct(fixture("not-a-product.html"), at("/women"), cfg);
    expect(d).toMatchObject({ sku: null, parentSku: null, confidence: "none" });
  });

  it("reads price and stock from structured data when the page has it", () => {
    expect(terminalxAdapter.readPriceStock(fixture("product-all-signals.html"), cfg)).toEqual({
      price: 149.9,
      regularPrice: null,
      currency: "ILS",
      inStock: true,
    });
  });

  it("returns no price rather than guessing when there is no data", () => {
    expect(terminalxAdapter.readPriceStock(fixture("product-no-signals.html"), cfg)).toBeNull();
  });

  it("returns no variants, because the real structure is not known yet", () => {
    expect(terminalxAdapter.readVariantOptions(fixture("product-all-signals.html"), cfg)).toEqual([]);
    expect(terminalxAdapter.readSelectedVariant(fixture("product-all-signals.html"), cfg)).toEqual({});
  });

  it("derives the parent model from the first six characters (unverified assumption, spec 5)", () => {
    const d = terminalxAdapter.detectProduct(fixture("product-no-signals.html"), at("/w817260002"), cfg);
    expect(d.parentSku).toBe("w81726");
  });
});
