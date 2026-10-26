// Content scripts are registered at runtime, and only for stores the user has granted access to.
// Adding a store to a new release therefore never changes anything for existing users (CLAUDE.md rule 4).

import { browser } from "wxt/browser";
import { SITES } from "../lib/sites.ts";
import { loadSiteConfig } from "./config.ts";

export const CONTENT_SCRIPT_FILE = "/content-scripts/content.js";
const idOf = (siteId: string) => `sb-${siteId}`;

export async function syncContentScripts(): Promise<string[]> {
  const registered = new Set((await browser.scripting.getRegisteredContentScripts()).map((s) => s.id));
  const active: string[] = [];

  for (const site of SITES) {
    const id = idOf(site.id);
    const granted = await browser.permissions.contains({ origins: [site.hostPermission] });
    const { status } = await loadSiteConfig(site);
    const wanted = granted && status !== "paused";

    if (wanted && !registered.has(id)) {
      await browser.scripting.registerContentScripts([
        { id, matches: site.contentMatches, js: [CONTENT_SCRIPT_FILE], runAt: "document_idle", persistAcrossSessions: true },
      ]);
      await injectIntoOpenTabs(site.contentMatches);
    }
    if (!wanted && registered.has(id)) {
      await browser.scripting.unregisterContentScripts({ ids: [id] });
    }
    if (wanted) active.push(site.id);
  }
  return active;
}

/** Pages that were already open when access was granted start working without a reload. */
async function injectIntoOpenTabs(matches: string[]): Promise<void> {
  const tabs = await browser.tabs.query({ url: matches });
  await Promise.all(
    tabs
      .filter((t) => t.id !== undefined)
      .map((t) => browser.scripting.executeScript({ target: { tabId: t.id as number }, files: [CONTENT_SCRIPT_FILE] }).catch(() => undefined)),
  );
}
