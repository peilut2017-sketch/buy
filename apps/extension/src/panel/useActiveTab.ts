import { browser } from "wxt/browser";
import { useEffect, useState } from "preact/hooks";
import { send, type PanelMode, type ProductSnapshot } from "../lib/messages.ts";

export interface ActiveTab {
  loading: boolean;
  tabId: number | null;
  product: ProductSnapshot | null;
  /** Set once when the strip asked for a specific view. Read it, then clear it. */
  mode: PanelMode | null;
}

/** The product on the page in the active tab, kept in step as the user switches tabs or navigates. */
export function useActiveTab(): ActiveTab {
  const [state, setState] = useState<ActiveTab>({ loading: true, tabId: null, product: null, mode: null });

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        // Test builds can point the panel at a specific tab, because a test cannot open the real side panel.
        const forced = import.meta.env.WXT_E2E === "1" ? Number(new URLSearchParams(location.search).get("tab")) || null : null;
        const [tab] = forced !== null ? [{ id: forced }] : await browser.tabs.query({ active: true, currentWindow: true });
        if (!alive) return;
        if (tab?.id === undefined) return setState({ loading: false, tabId: null, product: null, mode: null });
        const answer = await send("tab-product", { tabId: tab.id });
        if (alive) setState({ loading: false, tabId: tab.id as number, product: answer.product, mode: answer.mode });
      } catch {
        if (alive) setState({ loading: false, tabId: null, product: null, mode: null });
      }
    };
    void refresh();

    const onUpdated = (_id: number, change: { status?: string; url?: string }) => {
      if (change.status === "complete" || change.url) void refresh();
    };
    const onStorage = (changes: Record<string, unknown>) => {
      if (Object.keys(changes).some((k) => k.startsWith("tab:"))) void refresh();
    };
    browser.tabs.onActivated.addListener(refresh);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.storage.session.onChanged.addListener(onStorage);
    return () => {
      alive = false;
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.storage.session.onChanged.removeListener(onStorage);
    };
  }, []);

  return state;
}
