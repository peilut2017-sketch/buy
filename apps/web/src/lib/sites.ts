import { resolveProductInput, type LookupSite } from "@smartbuy/core";
import { rest } from "@smartbuy/data";

export interface PublicSite {
  id: string;
  name: string;
  status: "active" | "beta" | "paused";
  domains: string[];
  adapterConfig: { productUrl?: string; parentSku?: { fromSku?: string }; productType?: string };
}

interface SiteRow {
  id: string;
  name: string;
  status: PublicSite["status"];
  domains: string[];
  adapter_config: PublicSite["adapterConfig"] | null;
}

/** Stores are public data: the website learns which ones exist, and how to read a product link, from the same table as the extension. */
export async function loadSites(): Promise<PublicSite[]> {
  const rows = await rest<SiteRow[]>("sites", { params: { select: "id,name,status,domains,adapter_config", order: "name.asc" } });
  return rows.map((r) => ({ id: r.id, name: r.name, status: r.status, domains: r.domains, adapterConfig: r.adapter_config ?? {} }));
}

export function lookupSites(sites: readonly PublicSite[]): LookupSite[] {
  return sites
    .filter((s) => s.status !== "paused" && s.adapterConfig.productUrl && s.adapterConfig.parentSku?.fromSku)
    .map((s) => ({ id: s.id, domains: s.domains, productUrl: s.adapterConfig.productUrl as string, parentSku: s.adapterConfig.parentSku?.fromSku as string }));
}

export function resolveInput(input: string, sites: readonly PublicSite[]) {
  return resolveProductInput(input, lookupSites(sites));
}

export const productPath = (siteId: string, sku: string) => `/${siteId}/${sku}`;
