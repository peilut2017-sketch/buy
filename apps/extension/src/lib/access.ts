// Store access: each store is an optional host permission the user grants (or withdraws) at runtime.

import { browser } from "wxt/browser";
import { useCallback, useEffect, useState } from "preact/hooks";
import { send } from "./messages.ts";
import { SITES, type RegisteredSite } from "./sites.ts";

export type AccessMap = Record<string, boolean>;

export async function readAccess(): Promise<AccessMap> {
  const entries = await Promise.all(SITES.map(async (s) => [s.id, await browser.permissions.contains({ origins: [s.hostPermission] })] as const));
  return Object.fromEntries(entries);
}

/** Must be called directly from a click handler: Chrome only shows the permission prompt for a user gesture. */
export async function grantAccess(site: RegisteredSite): Promise<boolean> {
  const granted = await browser.permissions.request({ origins: [site.hostPermission] });
  if (granted) await send("sync-content-scripts", {});
  return granted;
}

export async function revokeAccess(site: RegisteredSite): Promise<void> {
  await browser.permissions.remove({ origins: [site.hostPermission] });
  await send("sync-content-scripts", {});
}

export function useAccess(): { access: AccessMap | null; refresh: () => void } {
  const [access, setAccess] = useState<AccessMap | null>(null);
  const refresh = useCallback(() => void readAccess().then(setAccess), []);
  useEffect(() => {
    refresh();
    browser.permissions.onAdded.addListener(refresh);
    browser.permissions.onRemoved.addListener(refresh);
    return () => {
      browser.permissions.onAdded.removeListener(refresh);
      browser.permissions.onRemoved.removeListener(refresh);
    };
  }, [refresh]);
  return { access, refresh };
}
