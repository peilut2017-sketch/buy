// Detection rules for a store: the server copy when reachable, the cached copy for up to six hours,
// and the copy bundled in the extension as the fallback. Rules are data only (CLAUDE.md rule 3).

import { configFromSite, isFresh, pickConfig, type CachedConfig, type SiteRecord, type SiteStatus } from "@smartbuy/core";
import { getLocal, setLocal } from "../lib/storage.ts";
import { rest } from "@smartbuy/data";
import type { SiteConfigResult } from "../lib/messages.ts";
import type { RegisteredSite } from "../lib/sites.ts";

interface SiteRow {
  id: string;
  name: string;
  status: SiteStatus;
  domains: string[];
  adapter_config: unknown;
  adapter_version: number;
}

interface StoredConfig extends CachedConfig {
  status: SiteStatus;
}

const key = (siteId: string) => `siteConfig:${siteId}`;

async function fetchRemote(siteId: string): Promise<{ record: SiteRecord } | null> {
  try {
    const rows = await rest<SiteRow[]>("sites", {
      params: { id: `eq.${siteId}`, select: "id,name,status,domains,adapter_config,adapter_version", limit: 1 },
      timeoutMs: 8_000,
    });
    const r = rows[0];
    if (!r) return null;
    return { record: { id: r.id, name: r.name, status: r.status, domains: r.domains, adapterConfig: r.adapter_config, adapterVersion: r.adapter_version } };
  } catch {
    return null;
  }
}

export async function loadSiteConfig(site: RegisteredSite, now = Date.now()): Promise<SiteConfigResult> {
  const stored = await getLocal<StoredConfig>(key(site.id));

  if (isFresh(stored, now)) {
    const picked = pickConfig(site.bundled, stored, null);
    return { status: stored?.status ?? "beta", version: picked.version, config: picked.config, source: picked.source };
  }

  const remote = await fetchRemote(site.id);
  const remoteVersioned = remote ? configFromSite(remote.record, null) : null;

  let status: SiteStatus = stored?.status ?? "beta";
  if (remote) {
    status = remote.record.status;
    // Keep the last good config when the server's copy is broken, but still record the status (a kill switch must work).
    const keep = remoteVersioned ?? stored;
    await setLocal(key(site.id), {
      version: keep?.version ?? site.bundled.version,
      config: keep?.config ?? site.bundled.config,
      fetchedAt: now,
      status,
    } satisfies StoredConfig);
  }

  const picked = pickConfig(site.bundled, stored, remoteVersioned);
  return { status, version: picked.version, config: picked.config, source: picked.source };
}
