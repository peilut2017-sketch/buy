// Notifications in the browser. The server decides whether, when and what to send (preferences, quiet hours, Shabbat,
// daily cap, merging); the extension only shows what the server has already decided to deliver, then acknowledges it.

import { ackExtensionNotifications, pollExtensionNotifications } from "@smartbuy/data";
import { browser } from "wxt/browser";
import { currentIdentity } from "../lib/auth.ts";
import { BACKEND_CONFIGURED } from "../lib/env.ts";
import { getSession, removeSession, setSession } from "../lib/storage.ts";

export const POLL_ALARM = "poll-notifications";
const URL_KEY = (id: string) => `notice:${id}`;

export async function pollAndShow(): Promise<number> {
  if (!BACKEND_CONFIGURED) return 0;
  const identity = await currentIdentity().catch(() => null);
  if (!identity) return 0;
  let notices;
  try {
    notices = await pollExtensionNotifications(identity.token);
  } catch {
    return 0;
  }
  const shown: number[] = [];
  for (const n of notices) {
    try {
      await browser.notifications.create(`sb-${n.id}`, { type: "basic", iconUrl: browser.runtime.getURL("/icon/128.png"), title: n.title, message: n.text });
      if (n.url) await setSession(URL_KEY(`sb-${n.id}`), n.url);
      shown.push(n.id);
    } catch {
      // The browser refused (notifications blocked): leave it unacknowledged for the next poll.
    }
  }
  if (shown.length > 0) await ackExtensionNotifications(identity.token, shown).catch(() => undefined);
  return shown.length;
}

export function registerNotificationClicks(): void {
  browser.notifications.onClicked.addListener(async (id) => {
    const url = await getSession<string>(URL_KEY(id));
    if (url) await browser.tabs.create({ url });
    await removeSession(URL_KEY(id));
    await browser.notifications.clear(id);
  });
}
