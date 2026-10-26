import { describe, expect, it } from "vitest";
import { resolveProductInput, type LookupSite } from "./lookup.ts";

const sites: LookupSite[] = [
  { id: "alpha", domains: ["alpha.test", "www.alpha.test"], productUrl: "^/([a-z]\\d{5,9})/?$", parentSku: "^(.{6})" },
  { id: "beta", domains: ["beta.test"], productUrl: "^/item/(\\d{4})$", parentSku: "^(\\d{4})" },
];

describe("resolveProductInput", () => {
  it("reads a product link by its domain", () => {
    expect(resolveProductInput("https://www.alpha.test/W817260002?ref=x", sites)).toEqual({ siteId: "alpha", sku: "w817260002", parentSku: "w81726" });
    expect(resolveProductInput("https://beta.test/item/1234", sites)).toEqual({ siteId: "beta", sku: "1234", parentSku: "1234" });
  });

  it("does not guess the store for a link on an unknown domain", () => {
    expect(resolveProductInput("https://evil.test/w817260002", sites)).toBeNull();
    expect(resolveProductInput("https://www.alpha.test/women", sites)).toBeNull();
  });

  it("reads a bare SKU or path, trying stores in order", () => {
    expect(resolveProductInput("w817260002", sites)).toEqual({ siteId: "alpha", sku: "w817260002", parentSku: "w81726" });
    expect(resolveProductInput("/w817260002", sites)?.siteId).toBe("alpha");
    expect(resolveProductInput("item/1234", sites)?.siteId).toBe("beta");
  });

  it("returns null for nothing useful", () => {
    expect(resolveProductInput("", sites)).toBeNull();
    expect(resolveProductInput("hello world", sites)).toBeNull();
    expect(resolveProductInput("javascript:alert(1)", sites)).toBeNull();
  });

  it("survives a broken pattern in a store's rules", () => {
    expect(resolveProductInput("w817260002", [{ id: "x", domains: [], productUrl: "([", parentSku: "^(.)" }])).toBeNull();
  });
});
