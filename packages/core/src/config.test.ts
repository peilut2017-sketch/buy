import { describe, expect, it } from "vitest";
import { configFromSite, CONFIG_TTL_MS, isFresh, pickConfig, validateConfig } from "./config.ts";
import type { AdapterConfig, SiteRecord, VersionedConfig } from "./types.ts";

const good: AdapterConfig = {
  productUrl: "^/([a-z]\\d{9})$",
  signals: { canonical: { selector: "link[rel=canonical]", attr: "href", skuRegex: "/([a-z]\\d{9})$" } },
  parentSku: { fromSku: "^(.{6})" },
  emailDomains: ["example.test"],
  productType: "apparel",
};
const v = (version: number, config: AdapterConfig = good): VersionedConfig => ({ version, config });

describe("validateConfig", () => {
  it("accepts a well-formed config", () => {
    expect(validateConfig(good).ok).toBe(true);
  });

  it.each([
    ["not an object", null],
    ["a bad URL pattern", { ...good, productUrl: "([" }],
    ["a missing URL pattern", { ...good, productUrl: "" }],
    ["a bad parent pattern", { ...good, parentSku: { fromSku: "(" } }],
    ["a missing product type", { ...good, productType: "" }],
    ["email domains that are not strings", { ...good, emailDomains: [1] }],
    ["missing signals", { ...good, signals: undefined }],
    ["a signal with a bad regex", { ...good, signals: { canonical: { selector: "a", attr: "href", skuRegex: "(" } } }],
    ["a signal with a bad selector", { ...good, signals: { canonical: { selector: "a[", attr: "href", skuRegex: "x" } } }],
    ["a malformed JSON-LD rule", { ...good, signals: { jsonLd: { type: 5 } } }],
    ["variant rules with a missing selector", { ...good, variants: { groups: ".a", label: ".b", option: ".c" } }],
    ["a price rule with a bad selector", { ...good, price: { selector: "div[" } }],
    ["listing rules that are not an object", { ...good, listing: "x" }],
  ])("rejects %s", (_name, raw) => {
    expect(validateConfig(raw).ok).toBe(false);
  });

  it("works without a DOM, checking patterns only", () => {
    expect(validateConfig(good, null).ok).toBe(true);
  });
});

describe("pickConfig", () => {
  it("keeps the bundled copy when nothing newer exists", () => {
    expect(pickConfig(v(1), null, null)).toMatchObject({ version: 1, source: "bundled" });
  });
  it("uses the newest of cache and remote", () => {
    expect(pickConfig(v(1), v(3), v(2))).toMatchObject({ version: 3, source: "cache" });
    expect(pickConfig(v(1), v(2), v(5))).toMatchObject({ version: 5, source: "remote" });
  });
  it("prefers the bundled copy on a tie", () => {
    expect(pickConfig(v(2), v(2), v(2))).toMatchObject({ source: "bundled" });
  });
});

describe("configFromSite", () => {
  const site = (over: Partial<SiteRecord>): SiteRecord => ({
    id: "x",
    name: "X",
    status: "beta",
    domains: ["x.test"],
    adapterConfig: good,
    adapterVersion: 4,
    ...over,
  });
  it("turns a valid row into a versioned config", () => {
    expect(configFromSite(site({}))).toEqual({ version: 4, config: good });
  });
  it("rejects a row whose config is broken or whose version is invalid, so the old config stays in use", () => {
    expect(configFromSite(site({ adapterConfig: {} }))).toBeNull();
    expect(configFromSite(site({ adapterVersion: 0 }))).toBeNull();
  });
});

describe("isFresh", () => {
  it("expires after six hours", () => {
    const cached = { ...v(1), fetchedAt: 1_000 };
    expect(isFresh(cached, 1_000 + CONFIG_TTL_MS - 1)).toBe(true);
    expect(isFresh(cached, 1_000 + CONFIG_TTL_MS)).toBe(false);
    expect(isFresh(null, 0)).toBe(false);
  });
});
