import "../src/lib/backend.ts";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { loadSiteConfig } from "../src/background/config.ts";
import { installId, track, trackFirstViewOnce } from "../src/background/events.ts";
import { FLUSH_ALARM, flushPrices, queuePrice } from "../src/background/prices.ts";
import { POLL_ALARM, pollAndShow, registerNotificationClicks } from "../src/background/notifications.ts";
import { syncContentScripts } from "../src/background/register.ts";
import { WEBSITE_URL } from "../src/lib/env.ts";
import type { Message, PanelMode, ProductSnapshot } from "../src/lib/messages.ts";
import { getReviews, getSizeProfile, getSummary, getTracking, pickUsualSize } from "@smartbuy/data";
import { historyState, lowestInWindow, sizeAdvice } from "@smartbuy/core";
import { currentIdentity } from "../src/lib/auth.ts";
import { getSession, removeSession, setSession } from "../src/lib/storage.ts";
import { siteById } from "../src/lib/sites.ts";
import type { ProductSummary } from "@smartbuy/core";

const SUMMARY_TTL_MS = 10 * 60 * 1000;
const tabKey = (tabId: number) => `tab:${tabId}`;

interface TabState {
  product: ProductSnapshot | null;
  mode: PanelMode | null;
}

async function readSummary(siteId: string, parentSku: string): Promise<ProductSummary | null> {
  const key = `summary:${siteId}:${parentSku}`;
  const cached = await getSession<{ at: number; summary: ProductSummary | null }>(key);
  if (cached && Date.now() - cached.at < SUMMARY_TTL_MS) return cached.summary;
  const summary = await getSummary(siteId, parentSku);
  await setSession(key, { at: Date.now(), summary });
  return summary;
}

async function setPanelEnabled(tabId: number, enabled: boolean): Promise<void> {
  await browser.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled });
}

export default defineBackground(() => {
  // The toolbar button opens the popup. The side panel opens from the strip, and only on product pages.
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  void browser.sidePanel.setOptions({ enabled: false });
  if (WEBSITE_URL) void browser.runtime.setUninstallURL(`${WEBSITE_URL}/bye`);
  void browser.alarms.create(POLL_ALARM, { delayInMinutes: 1, periodInMinutes: 5 });
  registerNotificationClicks();
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === POLL_ALARM) void pollAndShow();
    if (alarm.name === FLUSH_ALARM) void flushPrices();
  });

  browser.runtime.onInstalled.addListener(async (details) => {
    await installId();
    await syncContentScripts();
    if (details.reason === "install") {
      void track({ event: "install" });
      await browser.tabs.create({ url: browser.runtime.getURL("/welcome.html") });
    }
  });
  browser.runtime.onStartup.addListener(() => void syncContentScripts());
  browser.permissions.onAdded.addListener(() => void syncContentScripts());
  browser.permissions.onRemoved.addListener(() => void syncContentScripts());
  browser.tabs.onRemoved.addListener((tabId) => void removeSession(tabKey(tabId)));

  browser.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    const message = raw as Message;
    const tabId = sender.tab?.id;

    switch (message.type) {
      case "site-config": {
        const site = siteById(message.siteId);
        if (!site) return false;
        void loadSiteConfig(site).then(sendResponse);
        return true;
      }

      case "product-detected": {
        if (tabId === undefined) return false;
        void (async () => {
          const state: TabState = { product: message.product, mode: null };
          await setSession(tabKey(tabId), state);
          await setPanelEnabled(tabId, true);
          void queuePrice(message.product);
          void trackFirstViewOnce(message.product.siteId);
          void track({ event: "product_view", siteId: message.product.siteId, parentSku: message.product.parentSku });
          sendResponse({ ok: true });
        })();
        return true;
      }

      case "product-cleared": {
        if (tabId === undefined) return false;
        void (async () => {
          await removeSession(tabKey(tabId));
          await setPanelEnabled(tabId, false);
          sendResponse({ ok: true });
        })();
        return true;
      }

      case "summary": {
        void readSummary(message.siteId, message.parentSku).then(
          (summary) => sendResponse({ summary }),
          () => sendResponse({ summary: undefined, error: true }),
        );
        return true;
      }

      case "price-info": {
        void (async () => {
          try {
            const t = await getTracking({ siteId: message.siteId, parentSku: message.parentSku, sku: message.sku, token: null, userId: null });
            const now = new Date();
            const low = historyState(t.points, now).kind === "ok" ? lowestInWindow(t.points, now) : null;
            sendResponse({ lowest: low ? { price: low.price, since: low.since.toISOString() } : null });
          } catch {
            sendResponse({ lowest: null });
          }
        })();
        return true;
      }

      case "size-advice": {
        void (async () => {
          try {
            const identity = await currentIdentity();
            const site = siteById(message.siteId);
            if (!identity || !site) return sendResponse({ advice: null });
            const sizeGroup = (await loadSiteConfig(site)).config.sizeGroup;
            if (!sizeGroup) return sendResponse({ advice: null });
            const usual = pickUsualSize(await getSizeProfile(identity.token, identity.userId), message.productType, message.brand);
            if (!usual) return sendResponse({ advice: null });
            const summary = await getSummary(message.siteId, message.parentSku, identity.token);
            if (!summary) return sendResponse({ advice: null });
            const { reviews } = await getReviews(summary.productId, identity.token, identity.userId);
            const advice = sizeAdvice(reviews, usual, sizeGroup);
            sendResponse({ advice: advice.kind === "advice" ? { headline: advice.headline, support: advice.support } : null });
          } catch {
            sendResponse({ advice: null });
          }
        })();
        return true;
      }

      case "open-panel": {
        if (tabId === undefined) return false;
        // sidePanel.open must run while the click that caused it is still the active user gesture, so it goes first.
        // A refusal (no gesture, panel disabled) must not lose the request, so the mode is stored either way.
        let opened: Promise<unknown>;
        try {
          opened = Promise.resolve(browser.sidePanel.open({ tabId }));
        } catch (error) {
          opened = Promise.reject(error);
        }
        const outcome = opened.then(() => true, () => false);
        void (async () => {
          const state = (await getSession<TabState>(tabKey(tabId))) ?? { product: null, mode: null };
          await setSession(tabKey(tabId), { ...state, mode: message.mode } satisfies TabState);
          const ok = await outcome;
          if (ok) void track({ event: "panel_open", siteId: state.product?.siteId });
          sendResponse({ ok });
        })();
        return true;
      }

      case "tab-product": {
        void (async () => {
          const state = await getSession<TabState>(tabKey(message.tabId));
          if (state?.mode) await setSession(tabKey(message.tabId), { ...state, mode: null } satisfies TabState);
          sendResponse({ product: state?.product ?? null, mode: state?.mode ?? null });
        })();
        return true;
      }

      case "detect-failed": {
        void track({ event: "detect_failed", siteId: message.failure.siteId, props: { confidence: message.failure.confidence, conflict: message.failure.conflict, signals: message.failure.signals } });
        sendResponse({ ok: true });
        return false;
      }

      case "sync-content-scripts": {
        void syncContentScripts().then((registered) => sendResponse({ registered }));
        return true;
      }
    }
    return false;
  });
});
