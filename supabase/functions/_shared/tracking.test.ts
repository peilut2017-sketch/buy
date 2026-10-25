// Phase 2 on a real PostgreSQL: price reports, watches, the notification triggers, delivery, Telegram, and admin alerts.
// Skipped unless SB_TEST_DB_URL is set (see testing/db.ts).
import * as hebcal from "@hebcal/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { evaluateAlerts, REPEAT_AFTER_MS } from "./alerts.ts";
import { adminAlerts } from "./handlers/adminAlerts.ts";
import { extensionNotifications, israelDayStart, sendNotifications, setChannel, telegramLink, telegramWebhook } from "./handlers/notifications.ts";
import { reportPrices } from "./handlers/reportPrices.ts";
import { submitReview } from "./handlers/submitReview.ts";
import { createSenders, emailHtml, type Fetch } from "./senders.ts";
import type { HebcalLike } from "./shabbat.ts";
import { createTestDb, TEST_DB_URL, type TestDb } from "./testing/db.ts";
import { ctxFor, NOW, reviewBody, seed, USERS } from "./testing/fixtures.ts";

const INSTALL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INSTALL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("israelDayStart", () => {
  it("is midnight in Israel, in winter and in summer time", () => {
    expect(israelDayStart(new Date("2026-11-10T10:00:00Z")).toISOString()).toBe("2026-11-09T22:00:00.000Z");
    expect(israelDayStart(new Date("2026-07-10T10:00:00Z")).toISOString()).toBe("2026-07-09T21:00:00.000Z");
    expect(israelDayStart(new Date("2026-11-09T22:30:00Z")).toISOString()).toBe("2026-11-09T22:00:00.000Z");
  });
});

describe("senders and alert rules (no database)", () => {
  it("sends Telegram and email through the provider APIs, and reports a refusal", async () => {
    const calls: { url: string; body: string }[] = [];
    const ok: Fetch = async (url, init) => (calls.push({ url, body: init?.body ?? "" }), { ok: true, status: 200, text: async () => "" });
    const senders = createSenders({ fetch: ok, telegramToken: "T", resendKey: "R", emailFrom: "SmartBuy <no-reply@example.test>", settingsUrl: "https://x.test/account" });
    await senders.telegram("42", "שלום");
    await senders.email("a@b.test", "נושא", "שורה אחת\nשורה שתיים", "https://shop.test/p");
    expect(calls[0]).toMatchObject({ url: "https://api.telegram.org/botT/sendMessage" });
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ chat_id: "42", text: "שלום" });
    expect(calls[1]!.url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(calls[1]!.body).html).toContain("https://shop.test/p");

    const refuse: Fetch = async () => ({ ok: false, status: 403, text: async () => "no" });
    await expect(createSenders({ fetch: refuse, telegramToken: "T" }).telegram("42", "x")).rejects.toThrow("403");
    await expect(createSenders({ fetch: ok }).telegram("42", "x")).rejects.toThrow("not configured");
  });

  it("escapes what it puts into an email", () => {
    expect(emailHtml("<b>x</b> & y", 'https://a.test/?q="1"', "https://x.test")).not.toContain("<b>x</b>");
    expect(emailHtml("a", null, "https://x.test")).not.toContain("לעמוד המוצר");
  });

  it("alerts on a sharp detection drop, failing notifications, a report spike and a review wave, and does not repeat for six hours", () => {
    const stats = { perSite: [{ siteId: "terminalx", views: 10, failed: 15 }], failedNotifications: 6, newReports: 12, newWaveFlags: 1 };
    const first = evaluateAlerts(stats, {}, NOW);
    expect(first.alerts.map((a) => a.key)).toEqual(["detect:terminalx", "notify-failed", "reports", "review-wave"]);
    expect(evaluateAlerts(stats, first.state, new Date(NOW.getTime() + 3_600_000)).alerts).toEqual([]);
    expect(evaluateAlerts(stats, first.state, new Date(NOW.getTime() + REPEAT_AFTER_MS)).alerts).toHaveLength(4);
  });

  it("stays quiet when there is too little traffic to judge a rate", () => {
    expect(evaluateAlerts({ perSite: [{ siteId: "x", views: 2, failed: 5 }], failedNotifications: 0, newReports: 0, newWaveFlags: 0 }, {}, NOW).alerts).toEqual([]);
  });
});

describe.skipIf(!TEST_DB_URL)("phase 2 on PostgreSQL", () => {
  let db: TestDb;
  const sent: { to: string; text: string }[] = [];
  const failTelegram = { on: false };

  const senders = () =>
    createSenders({
      fetch: async (url, init) => {
        const body = JSON.parse(init?.body ?? "{}");
        if (url.includes("telegram") && failTelegram.on) return { ok: false, status: 500, text: async () => "" };
        sent.push({ to: String(body.chat_id ?? body.to), text: String(body.text) });
        return { ok: true, status: 200, text: async () => "" };
      },
      telegramToken: "T",
      resendKey: "R",
      emailFrom: "SmartBuy <no-reply@example.test>",
    });
  const service = (over = {}) => ctxFor(db, null, { isService: true, hebcal: hebcal as unknown as HebcalLike, senders: senders(), ...over });

  const price = (installId: string, price: number | null, inStock: boolean | null = true, sku = "w817260002") =>
    reportPrices(ctxFor(db, null), { installId, items: [{ siteId: "terminalx", sku, parentSku: sku.slice(0, 6), price, inStock, currency: "ILS", variantValues: { מידה: "M" } }] });

  async function variantId(sku = "w817260002") {
    return Number((await db.raw`select id from public.variants where sku = ${sku}`)[0]!.id);
  }
  async function productId(parent = "w81726") {
    return Number((await db.raw`select id from public.products where parent_sku = ${parent}`)[0]!.id);
  }
  const queue = () => db.raw`select user_id, kind, payload, status from public.notification_queue order by id`;

  beforeAll(async () => {
    db = await createTestDb();
    await seed(db);
  });
  afterAll(async () => {
    await db?.drop();
  });
  beforeEach(async () => {
    await db.raw`truncate public.products, public.events, public.notification_queue, public.notification_log, public.telegram_link_tokens, public.settings restart identity cascade`;
    await db.raw`insert into public.settings (key, value) values
      ('review_limits', '{"per_day":5,"min_chars":30,"max_chars":2000,"count_after_hours":0}'),
      ('price_reports', '{"per_install_per_day":200,"outlier_ratio":0.6,"confirmations":2,"window_hours":24,"history_days":90}'),
      ('notifications', '{"daily_cap":3,"pending_reminder_days":7,"pending_after_delivery_days":14,"durability_after_days":90}')`;
    await db.raw`update public.profiles set quiet_mode = false, quiet_hours = null, shabbat_mode = false, shabbat_city = null, daily_notification_cap = 3`;
    await db.raw`delete from public.notification_channels where channel <> 'extension'`;
  });

  describe("report-prices", () => {
    it("stores a first report, ignores an unchanged one, and stores a change", async () => {
      expect((await price(INSTALL_A, 149.9)).body).toMatchObject({ accepted: 1 });
      expect((await price(INSTALL_B, 149.9)).body).toMatchObject({ unchanged: 1, accepted: 0 });
      expect((await price(INSTALL_A, 129.9)).body).toMatchObject({ accepted: 1 });
      expect((await price(INSTALL_A, 129.9, false)).body).toMatchObject({ accepted: 1 }); // stock changed
      expect(await db.raw`select 1 from public.price_events`).toHaveLength(3);
    });

    it("keeps only a hash of the install, never the install id", async () => {
      await price(INSTALL_A, 100);
      const [e] = await db.raw`select install_hash, source from public.price_events`;
      expect(e).toMatchObject({ source: "user_report" });
      expect(e!.install_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(await db.raw`select * from public.price_events`)).not.toContain(INSTALL_A);
    });

    it("holds a price far from the median until a second install reports it", async () => {
      for (const p of [100, 101, 99, 100]) await price(INSTALL_A, p);
      expect((await price(INSTALL_A, 10)).body).toMatchObject({ pendingConfirmation: 1, accepted: 0 });
      expect((await price(INSTALL_A, 10)).body).toMatchObject({ pendingConfirmation: 1 }); // the same install does not confirm itself
      expect((await price(INSTALL_B, 10)).body).toMatchObject({ accepted: 1 });
      expect((await db.raw`select price from public.price_events order by id desc limit 1`)[0]!.price).toBe("10.00");
      expect(await db.raw`select 1 from public.price_outlier_candidates`).toHaveLength(0);
    });

    it("rejects bad input and limits how many reports one install can send a day", async () => {
      expect((await reportPrices(ctxFor(db, null), { installId: "nope", items: [] })).status).toBe(400);
      const bad = await reportPrices(ctxFor(db, null), { installId: INSTALL_A, items: [{ siteId: "terminalx", sku: "w817260002", parentSku: "zzzzzz", price: 10 }, { siteId: "nowhere", sku: "w817260002", parentSku: "w81726", price: 10 }, { siteId: "terminalx", sku: "w817260002", parentSku: "w81726", price: -5 }] });
      expect(bad.body).toMatchObject({ rejected: 3 });
      await db.raw`update public.settings set value = jsonb_set(value, '{per_install_per_day}', '2') where key = 'price_reports'`;
      await price(INSTALL_A, 11);
      await price(INSTALL_A, 12);
      expect((await price(INSTALL_A, 13)).status).toBe(429);
    });
  });

  describe("watches and the queue", () => {
    async function watch(who: keyof typeof USERS, fields: Record<string, unknown>) {
      return db.raw`insert into public.watches ${db.raw({ user_id: USERS[who], product_id: await productId(), variant_id: await variantId(), ...fields } as never)} returning id`;
    }

    it("refuses a target at or above the current price, and accepts one below it", async () => {
      await price(INSTALL_A, 149.9);
      await expect(watch("alice", { target_price: 149.9 })).rejects.toThrow(/target_price_must_be_below_current/);
      await expect(watch("alice", { target_price: 200 })).rejects.toThrow(/target_price_must_be_below_current/);
      expect(await watch("alice", { target_price: 99.9 })).toHaveLength(1);
    });

    it("accepts a target when no price is known yet", async () => {
      await price(INSTALL_A, null, true);
      expect(await watch("bob", { target_price: 50 })).toHaveLength(1);
    });

    it("notifies once when the price crosses the target, and not while it stays below", async () => {
      await price(INSTALL_A, 149.9);
      await watch("alice", { target_price: 100 });
      await price(INSTALL_A, 120);
      expect(await queue()).toHaveLength(0);
      await price(INSTALL_A, 99);
      await price(INSTALL_A, 95);
      const rows = await queue();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: USERS.alice, kind: "price_target", status: "queued" });
      expect(rows[0]!.payload).toMatchObject({ price: 99, previousPrice: 120, targetPrice: 100, sku: "w817260002" });
      await price(INSTALL_A, 130);
      await price(INSTALL_A, 90); // crosses again
      expect(await queue()).toHaveLength(2);
    });

    it("notifies on a drop of at least the chosen percentage", async () => {
      await price(INSTALL_A, 200);
      await watch("alice", { drop_percent: 20 });
      await price(INSTALL_A, 170);
      expect(await queue()).toHaveLength(0);
      await price(INSTALL_A, 130); // 24% below 170
      expect((await queue())[0]).toMatchObject({ kind: "price_drop" });
    });

    it("notifies when the chosen size comes back in stock, and only then", async () => {
      await price(INSTALL_A, 100, false);
      await watch("alice", { notify_restock: true, restock_variant_values: { מידה: "M" } });
      await watch("bob", { notify_restock: true, restock_variant_values: { מידה: "L" } });
      await price(INSTALL_A, 100, true);
      const rows = await queue();
      expect(rows.map((r) => [r.user_id, r.kind])).toEqual([[USERS.alice, "restock"]]);
    });

    it("ignores inactive watches and watches on other products", async () => {
      await price(INSTALL_A, 150);
      await watch("alice", { target_price: 100, active: false });
      await price(INSTALL_A, 90);
      expect(await queue()).toHaveLength(0);
    });

    it("tells watchers about a new review, but not its author, and tells an author about helpful votes", async () => {
      await price(INSTALL_A, 150);
      await watch("alice", { target_price: 100 });
      await watch("bob", { target_price: 100 });
      await submitReview(ctxFor(db, "bob"), reviewBody());
      const rows = await queue();
      expect(rows.filter((r) => r.kind === "new_review_on_watch").map((r) => r.user_id)).toEqual([USERS.alice]);
      const [review] = await db.raw`select id from public.reviews`;
      await db.raw`insert into public.helpful_votes (review_id, user_id) values (${review!.id}, ${USERS.carol})`;
      expect((await queue()).filter((r) => r.kind === "my_review_activity").map((r) => r.user_id)).toEqual([USERS.bob]);
    });

    it("enqueues a weekly waiting-for-review reminder once, and a durability reminder once", async () => {
      await price(INSTALL_A, 150);
      const pid = await productId();
      await db.raw`insert into public.orders (id, user_id, site_id, order_hash, delivered_at, source) overriding system value values (1, ${USERS.alice}, 'terminalx', 'h1', '2026-09-01', 'extension')`;
      await db.raw`insert into public.order_items (id, order_id, product_id, sku) overriding system value values (1, 1, ${pid}, 'w817260002')`;
      await db.raw`insert into public.pending_reviews (user_id, order_item_id, product_id, due_at) values (${USERS.alice}, 1, ${pid}, '2026-09-15')`;
      await db.raw`select public.enqueue_reminders(${NOW.toISOString()}::timestamptz)`;
      await db.raw`select public.enqueue_reminders(${NOW.toISOString()}::timestamptz)`;
      expect((await queue()).filter((r) => r.kind === "pending_review_reminder")).toHaveLength(1);

      await db.raw`insert into public.reviews (user_id, product_id, rating, body, verification, order_item_id, delivered_at) values (${USERS.bob}, ${pid}, 4, ${"x".repeat(40)}, 'verified', 1, '2026-06-01')`;
      await db.raw`select public.enqueue_reminders(${NOW.toISOString()}::timestamptz)`;
      await db.raw`select public.enqueue_reminders(${NOW.toISOString()}::timestamptz)`;
      expect((await queue()).filter((r) => r.kind === "durability_reminder")).toHaveLength(1);
    });
  });

  describe("weekly digest", () => {
    async function pricedWatch(user: keyof typeof USERS, before: number, now: number) {
      await price(INSTALL_A, before);
      const vid = await variantId();
      await db.raw`update public.price_events set observed_at = ${new Date(NOW.getTime() - 10 * 86_400_000).toISOString()} where variant_id = ${vid}`;
      await price(INSTALL_B, now);
      await db.raw`update public.price_events set observed_at = ${new Date(NOW.getTime() - 2 * 86_400_000).toISOString()} where variant_id = ${vid} and price = ${now}`;
      const pid = await productId();
      await db.raw`insert into public.watches (user_id, product_id, variant_id, target_price) values (${USERS[user]}, ${pid}, ${vid}, ${before - 100})`;
    }
    const digest = () => db.raw`select enqueue_weekly_digest(${NOW.toISOString()}::timestamptz)`.then(() => queue()).then((rows) => rows.filter((r) => r.kind === "weekly_digest"));

    beforeEach(async () => {
      await db.raw`truncate public.watches, public.price_events restart identity cascade`;
    });

    it("is off by default, and on request names the products whose price changed in the week, once", async () => {
      await pricedWatch("alice", 200, 150);
      expect(await digest()).toHaveLength(0);
      await db.raw`update public.notification_prefs set enabled = true where user_id = ${USERS.alice} and kind = 'weekly_digest'`;
      const rows = await digest();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.user_id).toBe(USERS.alice);
      expect(rows[0]!.payload).toMatchObject({ watching: 1, changes: [{ from: 200, to: 150 }] });
      expect(await digest()).toHaveLength(1);
    });

    it("says nothing when no watched price moved", async () => {
      await pricedWatch("alice", 150, 150);
      await db.raw`update public.notification_prefs set enabled = true where user_id = ${USERS.alice} and kind = 'weekly_digest'`;
      expect(await digest()).toHaveLength(0);
    });
  });

  describe("send-notifications", () => {
    beforeEach(async () => {
      sent.length = 0;
      failTelegram.on = false;
      await db.raw`truncate public.watches restart identity`;
      await price(INSTALL_A, 150);
    });

    async function enqueue(user: keyof typeof USERS, kind: string, payload: Record<string, unknown> = {}, key = `${kind}:${Math.random()}`) {
      await db.raw`insert into public.notification_queue (user_id, kind, payload, dedupe_key, created_at) values (${USERS[user]}, ${kind}, ${db.raw.json({ name: "מכנסי בדיקה", url: "https://www.terminalx.com/w817260002", price: 90, targetPrice: 100, ...payload })}, ${key}, ${new Date(NOW.getTime() - 60_000).toISOString()})`;
    }
    const run = (over = {}) => sendNotifications(service({ now: NOW, ...over }), {});

    it("is only for the scheduler", async () => {
      expect((await sendNotifications(ctxFor(db, "alice", { hebcal: hebcal as unknown as HebcalLike }), {})).status).toBe(403);
      expect((await sendNotifications(ctxFor(db, null), {})).status).toBe(403);
    });

    it("merges everything for one user into one extension message that the extension then polls and acknowledges", async () => {
      await enqueue("alice", "price_target");
      await enqueue("alice", "restock");
      expect((await run()).body).toMatchObject({ users: 1, sent: 2, skipped: 0, deferred: 0, failed: 0 });
      expect((await queue()).map((r) => r.status)).toEqual(["sent", "sent"]);
      const logs = await db.raw`select channel, kind, status, payload from public.notification_log`;
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ channel: "extension", kind: "digest", status: "sent" });

      const poll = await extensionNotifications(ctxFor(db, "alice"), { action: "poll" });
      const list = (poll.body as { notifications: { id: number; title: string; text: string; url: string }[] }).notifications;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ title: "SmartBuy: 2 עדכונים", url: "https://www.terminalx.com/w817260002" });
      expect((await extensionNotifications(ctxFor(db, "bob"), { action: "poll" })).body).toEqual({ notifications: [] });
      await extensionNotifications(ctxFor(db, "alice"), { action: "ack", ids: [list[0]!.id] });
      expect((await extensionNotifications(ctxFor(db, "alice"), { action: "poll" })).body).toEqual({ notifications: [] });
      expect((await run()).body).toMatchObject({ users: 0 });
    });

    it("sends to Telegram and email when connected and chosen, and logs each", async () => {
      await db.raw`insert into public.notification_channels (user_id, channel, address, verified, enabled) values (${USERS.alice}, 'telegram', '4242', true, true), (${USERS.alice}, 'email', 'alice@test.invalid', true, true)`;
      await db.raw`update public.notification_prefs set channels = '{extension,telegram,email}' where user_id = ${USERS.alice} and kind = 'price_target'`;
      await enqueue("alice", "price_target");
      await run();
      expect(sent.map((s) => s.to).sort()).toEqual(["4242", "alice@test.invalid"]);
      expect(sent.find((s) => s.to === "4242")!.text).toContain("https://www.terminalx.com/w817260002");
      expect((await db.raw`select channel from public.notification_log order by channel`).map((r) => r.channel)).toEqual(["email", "extension", "telegram"]);
    });

    it("marks an item failed only when every channel it was routed to failed, and logs the error", async () => {
      await db.raw`insert into public.notification_channels (user_id, channel, address, verified, enabled) values (${USERS.alice}, 'telegram', '4242', true, true)`;
      await db.raw`update public.notification_prefs set channels = '{telegram}' where user_id = ${USERS.alice} and kind = 'price_target'`;
      failTelegram.on = true;
      await enqueue("alice", "price_target");
      expect((await run()).body).toMatchObject({ failed: 1, sent: 0 });
      expect((await queue())[0]!.status).toBe("failed");
      expect((await db.raw`select status, error from public.notification_log`)[0]).toMatchObject({ status: "failed", error: expect.stringContaining("500") });
    });

    it("respects preferences, quiet mode, and keeps items during quiet hours and at the daily cap", async () => {
      await db.raw`update public.notification_prefs set enabled = false where user_id = ${USERS.alice} and kind = 'restock'`;
      await enqueue("alice", "restock");
      await db.raw`update public.profiles set quiet_mode = true where id = ${USERS.bob}`;
      await enqueue("bob", "price_target");
      await db.raw`update public.profiles set quiet_hours = ${db.raw.json({ from: "11:00", to: "13:00" })} where id = ${USERS.carol}`;
      await enqueue("carol", "price_target"); // 12:00 in Israel
      await run();
      const rows = await queue();
      expect(rows.map((r) => [r.kind, r.status])).toEqual([["restock", "skipped"], ["price_target", "skipped"], ["price_target", "queued"]]);

      await db.raw`update public.profiles set quiet_hours = null where id = ${USERS.carol}`;
      await db.raw`update public.profiles set daily_notification_cap = 1 where id = ${USERS.carol}`;
      await run();
      expect((await queue())[2]!.status).toBe("sent");
      await enqueue("carol", "restock");
      await run();
      expect((await queue())[3]!.status).toBe("queued"); // the cap of one message a day is reached
      expect(await db.raw`select 1 from public.notification_log where user_id = ${USERS.carol}`).toHaveLength(1);
    });

    it("holds notifications through Shabbat", async () => {
      await db.raw`update public.profiles set shabbat_mode = true, shabbat_city = 'jerusalem' where id = ${USERS.dave}`;
      const saturday = new Date("2026-10-31T10:00:00Z");
      await db.raw`insert into public.notification_queue (user_id, kind, payload, dedupe_key, created_at) values (${USERS.dave}, 'restock', '{"name":"x"}', 'sh', ${new Date(saturday.getTime() - 60_000).toISOString()})`;
      await run({ now: saturday });
      expect((await queue())[0]!.status).toBe("queued");
      await run({ now: new Date("2026-10-31T16:00:00Z") });
      expect((await queue())[0]!.status).toBe("sent");
    });

    it("drops items that waited more than two days", async () => {
      await db.raw`insert into public.notification_queue (user_id, kind, payload, dedupe_key, created_at) values (${USERS.erin}, 'restock', '{"name":"x"}', 'old', ${new Date(NOW.getTime() - 3 * 86_400_000).toISOString()})`;
      await run();
      expect((await queue())[0]!.status).toBe("skipped");
    });
  });

  describe("channels", () => {
    beforeEach(() => {
      sent.length = 0;
    });

    it("connects Telegram through a one-time link, and the link works once", async () => {
      expect((await telegramLink(ctxFor(db, null, { telegramBotUsername: "smartbuy_bot" }), {})).status).toBe(401);
      expect((await telegramLink(ctxFor(db, "alice"), {})).status).toBe(503);
      const link = (await telegramLink(ctxFor(db, "alice", { telegramBotUsername: "smartbuy_bot" }), {})).body as { url: string };
      expect(link.url).toMatch(/^https:\/\/t\.me\/smartbuy_bot\?start=[0-9a-f]{32}$/);
      const token = link.url.split("start=")[1];
      const hook = (text: string, chat = 777, over = {}) => telegramWebhook(service({ webhookVerified: true, now: new Date(), ...over }), { message: { chat: { id: chat }, text } });

      expect((await telegramWebhook(service({ webhookVerified: false }), { message: { chat: { id: 1 }, text: "/start x" } })).status).toBe(403);
      expect((await hook(`/start ${token}`)).status).toBe(200);
      expect((await db.raw`select address, verified, enabled from public.notification_channels where channel = 'telegram'`)[0]).toMatchObject({ address: "777", verified: true, enabled: true });
      expect(sent.at(-1)!.text).toContain("החיבור הצליח");
      await hook(`/start ${token}`, 888);
      expect(sent.at(-1)!.text).toContain("לא תקף");
      expect(await db.raw`select 1 from public.notification_channels where channel = 'telegram'`).toHaveLength(1);

      await hook("/stop");
      expect((await db.raw`select enabled from public.notification_channels where channel = 'telegram'`)[0]!.enabled).toBe(false);
      await hook("שלום");
      expect(sent.at(-1)!.text).toContain("חיבור טלגרם");
    });

    it("rejects an expired link", async () => {
      const token = (((await telegramLink(ctxFor(db, "bob", { telegramBotUsername: "b" }), {})).body) as { url: string }).url.split("start=")[1];
      await db.raw`update public.telegram_link_tokens set expires_at = now() - interval '1 minute'`;
      await telegramWebhook(service({ webhookVerified: true, now: new Date() }), { message: { chat: { id: 5 }, text: `/start ${token}` } });
      expect(await db.raw`select 1 from public.notification_channels where channel = 'telegram'`).toHaveLength(0);
    });

    it("switches email on to the account's own address, and off again", async () => {
      expect((await setChannel(ctxFor(db, "alice"), { channel: "email", enabled: true })).status).toBe(200);
      expect((await db.raw`select address, verified, enabled from public.notification_channels where channel = 'email'`)[0]).toMatchObject({ address: "alice@test.invalid", verified: true, enabled: true });
      await setChannel(ctxFor(db, "alice"), { channel: "email", enabled: false });
      expect((await db.raw`select enabled from public.notification_channels where channel = 'email'`)[0]!.enabled).toBe(false);
      expect((await setChannel(ctxFor(db, "alice"), { channel: "sms", enabled: true })).status).toBe(400);
      expect((await setChannel(ctxFor(db, null), { channel: "email", enabled: true })).status).toBe(401);
    });
  });

  describe("admin alerts", () => {
    it("sends an alert to the admin chat once, and remembers it", async () => {
      sent.length = 0;
      for (let i = 0; i < 30; i++) await db.raw`insert into public.events (event, platform, site_id) values (${i < 12 ? "detect_failed" : "product_view"}, 'extension', 'terminalx')`;
      const ctx = () => service({ now: new Date(), adminChatId: "999" });
      expect((await adminAlerts(ctxFor(db, null), {})).status).toBe(403);
      expect((await adminAlerts(ctx(), {})).body).toMatchObject({ sent: 1 });
      expect(sent[0]).toMatchObject({ to: "999" });
      expect(sent[0]!.text).toContain("terminalx");
      expect((await adminAlerts(ctx(), {})).body).toMatchObject({ sent: 0 });
      expect((await adminAlerts(service({ now: new Date() }), {})).body).toMatchObject({ sent: 0, note: "alerts are not configured" });
    });
  });
});
