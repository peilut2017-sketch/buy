// Terminal X adapter. Everything that knows about this store lives here and in its `sites` row.
//
// NOT VERIFIED AGAINST THE LIVE SITE. The rules in config.json come from docs/06-research-checklist.md
// ("מה כבר ידוע") and from the standard Magento/schema.org conventions, because phase 0 research could not
// reach terminalx.com. Variants, price, stock, listing and order rules are deliberately left out rather than guessed.
// Until phase 0 is done, detection relies on the URL SKU plus whichever standard signals the page happens to carry.

import {
  detectWithConfig,
  readListingCardsWithConfig,
  readPriceStockWithConfig,
  readSelectedVariantWithConfig,
  readVariantOptionsWithConfig,
  validateConfig,
  type AdapterConfig,
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

export const terminalxAdapter: SiteAdapter = {
  id: SITE_ID,
  matchesUrl: (url) => DOMAINS.includes(url.hostname),
  detectProduct: (doc, url, cfg: AdapterConfig) => detectWithConfig(SITE_ID, doc, url, cfg),
  readVariantOptions: readVariantOptionsWithConfig,
  readSelectedVariant: readSelectedVariantWithConfig,
  readPriceStock: readPriceStockWithConfig,
  readListingCards: readListingCardsWithConfig,
};
