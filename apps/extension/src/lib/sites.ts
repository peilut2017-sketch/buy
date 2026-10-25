// The stores this build knows how to read. The extension app composes adapters; core never names a store.

import {
  BUNDLED_CONFIG as terminalxConfig,
  CONTENT_MATCHES as terminalxMatches,
  HOST_PERMISSION as terminalxHost,
  SITE as terminalxSite,
  terminalxAdapter,
} from "@smartbuy/adapter-terminalx";
import type { SiteAdapter, VersionedConfig } from "@smartbuy/core";

export interface RegisteredSite {
  id: string;
  name: string;
  adapter: SiteAdapter;
  /** Fallback rules shipped inside the extension. */
  bundled: VersionedConfig;
  /** Optional host permission, requested at runtime. */
  hostPermission: string;
  contentMatches: string[];
}

export const SITES: RegisteredSite[] = [
  {
    id: terminalxSite.id,
    name: terminalxSite.name,
    adapter: terminalxAdapter,
    bundled: terminalxConfig,
    hostPermission: terminalxHost,
    contentMatches: [...terminalxMatches],
  },
];

export function siteById(id: string): RegisteredSite | undefined {
  return SITES.find((s) => s.id === id);
}

export function siteForUrl(url: URL): RegisteredSite | undefined {
  return SITES.find((s) => s.adapter.matchesUrl(url));
}
