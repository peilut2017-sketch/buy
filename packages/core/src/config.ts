// Adapter config handling: validation, and choosing between the server copy, the cached copy and the bundled fallback.
// Rules are data (CLAUDE.md rule 3). Nothing here executes remote code.

import type { AdapterConfig, SiteRecord, VersionedConfig } from "./types.ts";

export const CONFIG_TTL_MS = 6 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compiles(pattern: unknown): pattern is string {
  if (typeof pattern !== "string" || pattern === "") return false;
  try {
    new RegExp(pattern, "i");
    return true;
  } catch {
    return false;
  }
}

function validSelector(doc: Document | null, selector: unknown): boolean {
  if (typeof selector !== "string" || selector === "") return false;
  if (!doc) return true;
  try {
    doc.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

export type ConfigCheck = { ok: true; config: AdapterConfig } | { ok: false; reason: string };

/**
 * Checks that a server-provided value has the shape the engine needs, and that every regular expression compiles
 * and every selector parses. A broken config is rejected as a whole, so a bad edit in the admin screen
 * can never take detection down: the previous or bundled config stays in use.
 */
export function validateConfig(raw: unknown, doc: Document | null = typeof document === "undefined" ? null : document): ConfigCheck {
  if (!isRecord(raw)) return { ok: false, reason: "config is not an object" };
  if (!compiles(raw.productUrl)) return { ok: false, reason: "productUrl is not a valid pattern" };
  if (!isRecord(raw.parentSku) || !compiles(raw.parentSku.fromSku)) {
    return { ok: false, reason: "parentSku.fromSku is not a valid pattern" };
  }
  if (typeof raw.productType !== "string" || raw.productType === "") return { ok: false, reason: "productType is missing" };
  if (!Array.isArray(raw.emailDomains) || !raw.emailDomains.every((d) => typeof d === "string")) {
    return { ok: false, reason: "emailDomains must be a list of strings" };
  }
  if (!isRecord(raw.signals)) return { ok: false, reason: "signals is missing" };

  for (const key of ["canonical", "ogUrl", "image"] as const) {
    const rule = raw.signals[key];
    if (rule === undefined) continue;
    if (!isRecord(rule) || !validSelector(doc, rule.selector) || !compiles(rule.skuRegex)) {
      return { ok: false, reason: `signals.${key} is invalid` };
    }
    if (rule.attr !== undefined && typeof rule.attr !== "string") return { ok: false, reason: `signals.${key}.attr is invalid` };
  }
  const jsonLd = raw.signals.jsonLd;
  if (jsonLd !== undefined) {
    if (!isRecord(jsonLd) || typeof jsonLd.type !== "string" || typeof jsonLd.skuPath !== "string") {
      return { ok: false, reason: "signals.jsonLd is invalid" };
    }
    if (jsonLd.skuRegex !== undefined && !compiles(jsonLd.skuRegex)) return { ok: false, reason: "signals.jsonLd.skuRegex is invalid" };
  }

  const variants = raw.variants;
  if (variants !== undefined) {
    if (!isRecord(variants) || !["groups", "label", "option", "selected"].every((k) => validSelector(doc, variants[k]))) {
      return { ok: false, reason: "variants is invalid" };
    }
    if (variants.unavailable !== undefined && !validSelector(doc, variants.unavailable)) return { ok: false, reason: "variants.unavailable is invalid" };
  }
  const price = raw.price;
  if (price !== undefined && (!isRecord(price) || !validSelector(doc, price.selector))) return { ok: false, reason: "price is invalid" };
  const listing = raw.listing;
  if (listing !== undefined && (!isRecord(listing) || !validSelector(doc, listing.card) || !validSelector(doc, listing.link))) {
    return { ok: false, reason: "listing is invalid" };
  }
  return { ok: true, config: raw as unknown as AdapterConfig };
}

export interface CachedConfig extends VersionedConfig {
  fetchedAt: number;
}

export function isFresh(cached: CachedConfig | null, now: number, ttl = CONFIG_TTL_MS): boolean {
  return cached !== null && now - cached.fetchedAt < ttl;
}

/** Turns a `sites` row into a versioned config, or null when the row is unusable. */
export function configFromSite(site: SiteRecord, doc?: Document | null): VersionedConfig | null {
  const check = validateConfig(site.adapterConfig, doc);
  if (!check.ok || !Number.isInteger(site.adapterVersion) || site.adapterVersion < 1) return null;
  return { version: site.adapterVersion, config: check.config };
}

/**
 * Picks the config to use: the newest valid one among the server copy, the cached copy and the bundled fallback.
 * Ties go to the bundled copy, which ships with the extension and is known to work with this code.
 */
export function pickConfig(
  bundled: VersionedConfig,
  cached: VersionedConfig | null,
  remote: VersionedConfig | null,
): VersionedConfig & { source: "remote" | "cache" | "bundled" } {
  let best: VersionedConfig & { source: "remote" | "cache" | "bundled" } = { ...bundled, source: "bundled" };
  for (const [candidate, source] of [
    [cached, "cache"],
    [remote, "remote"],
  ] as const) {
    if (candidate && candidate.version > best.version) best = { ...candidate, source };
  }
  return best;
}
