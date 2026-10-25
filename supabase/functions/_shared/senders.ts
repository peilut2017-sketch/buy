// Delivery to the outside channels. Plain fetch, with the fetch function injected so tests never touch the network.

export type Fetch = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface Senders {
  telegram(chatId: string, text: string): Promise<void>;
  email(to: string, subject: string, text: string, url: string | null): Promise<void>;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A plain right-to-left message: the text, one link when there is one, and a pointer to the settings. */
export function emailHtml(text: string, url: string | null, settingsUrl: string): string {
  const body = text.split("\n").map((l) => `<p style="margin:0 0 8px">${escapeHtml(l)}</p>`).join("");
  const link = url ? `<p style="margin:16px 0"><a href="${escapeHtml(url)}">לעמוד המוצר</a></p>` : "";
  return `<div dir="rtl" lang="he" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d1d1f">${body}${link}<hr style="border:0;border-top:1px solid #ddd;margin:16px 0"><p style="font-size:12px;color:#686b73">SmartBuy הוא שירות עצמאי ואין לו קשר לחנויות. כדי לשנות או להפסיק את ההודעות: <a href="${escapeHtml(settingsUrl)}">הגדרות</a>.</p></div>`;
}

export function createSenders(config: { fetch: Fetch; telegramToken?: string; resendKey?: string; emailFrom?: string; settingsUrl?: string }): Senders {
  return {
    async telegram(chatId, text) {
      if (!config.telegramToken) throw new Error("telegram is not configured");
      const res = await config.fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
      });
      if (!res.ok) throw new Error(`telegram answered ${res.status}`);
    },
    async email(to, subject, text, url) {
      if (!config.resendKey || !config.emailFrom) throw new Error("email is not configured");
      const res = await config.fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.resendKey}` },
        body: JSON.stringify({ from: config.emailFrom, to, subject, html: emailHtml(text, url, config.settingsUrl ?? "#"), text }),
      });
      if (!res.ok) throw new Error(`email provider answered ${res.status}`);
    },
  };
}
