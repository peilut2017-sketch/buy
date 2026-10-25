// Turns what a person pasted (a product link or a bare SKU) into a store, a SKU and a parent model.
// Works from the rules each store publishes (sites.adapter_config), so no store is named here.

export interface LookupSite {
  id: string;
  domains: string[];
  /** Regular expression on the URL path. The first capture group is the SKU. */
  productUrl: string;
  /** Regular expression on the full SKU. The first capture group is the parent model. */
  parentSku: string;
}

export interface LookupResult {
  siteId: string;
  sku: string;
  parentSku: string;
}

function first(pattern: string, text: string): string | null {
  try {
    return new RegExp(pattern, "i").exec(text)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function resolveSku(site: LookupSite, path: string): LookupResult | null {
  const sku = first(site.productUrl, path);
  const parentSku = sku ? first(site.parentSku, sku) : null;
  return sku && parentSku ? { siteId: site.id, sku, parentSku } : null;
}

/** A link is matched by its domain; a bare SKU is tried against every store in order (the first store wins). */
export function resolveProductInput(input: string, sites: readonly LookupSite[]): LookupResult | null {
  const text = input.trim();
  if (text === "") return null;

  let url: URL | null = null;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }
  if (url && (url.protocol === "https:" || url.protocol === "http:")) {
    const host = url.hostname.toLowerCase();
    for (const site of sites) {
      if (site.domains.some((d) => d.toLowerCase() === host)) {
        const found = resolveSku(site, url.pathname);
        if (found) return found;
      }
    }
    return null;
  }

  // Not a link: a SKU such as "w817260002", or a path such as "/w817260002".
  const path = `/${text.replace(/^\/+/, "")}`;
  for (const site of sites) {
    const found = resolveSku(site, path);
    if (found) return found;
  }
  return null;
}
