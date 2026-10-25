import * as hebcal from "@hebcal/core";
import { describe, expect, it } from "vitest";
import { buildMessage, describe as describeItem, planForUser, quietHoursEnd, type ChannelRow, type QueuedItem, type UserContext } from "./notify.ts";
import { cityById, ISRAELI_CITIES, israelDate, shabbatEndsAt, shabbatWindow } from "./shabbat.ts";

const jerusalem = cityById("jerusalem")!;

/** City coordinates are rounded to two decimals, so times are checked to the minute. */
const near = (actual: Date | undefined | null, iso: string) => expect(Math.abs((actual?.getTime() ?? 0) - Date.parse(iso))).toBeLessThan(60_000);

describe("Shabbat window (spec 14)", () => {
  // 2026-10-30 is a Friday. Sunset in Jerusalem is about 16:51 local time (14:51 UTC), and the stars come out about 17:27 on Saturday.
  it("runs from Friday's sunset to Saturday's nightfall in Jerusalem", () => {
    const w = shabbatWindow(new Date("2026-10-30T12:00:00Z"), jerusalem, hebcal)!;
    near(w.start, "2026-10-30T14:51:31.000Z");
    near(w.end, "2026-10-31T15:27:45.000Z");
  });

  it("is inside the window from sunset on Friday through Saturday until nightfall, and not before or after", () => {
    const at = (iso: string) => shabbatEndsAt(new Date(iso), jerusalem, hebcal);
    expect(at("2026-10-30T14:00:00Z")).toBeNull(); // Friday afternoon, before sunset
    near(at("2026-10-30T15:00:00Z"), "2026-10-31T15:27:45.000Z");
    near(at("2026-10-31T10:00:00Z"), "2026-10-31T15:27:45.000Z");
    expect(at("2026-10-31T15:30:00Z")).toBeNull(); // after nightfall
    expect(at("2026-11-01T10:00:00Z")).toBeNull(); // Sunday
    expect(at("2026-10-28T10:00:00Z")).toBeNull(); // midweek
  });

  it("uses the Israeli date, so late Friday night UTC is still Friday in Israel", () => {
    expect(israelDate(new Date("2026-10-30T22:30:00Z"))).toMatchObject({ day: 31, weekday: 6 });
    expect(israelDate(new Date("2026-10-30T12:00:00Z"))).toMatchObject({ day: 30, weekday: 5 });
  });

  it("differs by city: sunset is earlier in the north-east than in Eilat's longitude-adjusted south", () => {
    const haifa = shabbatWindow(new Date("2026-10-30T12:00:00Z"), cityById("haifa")!, hebcal)!;
    const eilat = shabbatWindow(new Date("2026-10-30T12:00:00Z"), cityById("eilat")!, hebcal)!;
    expect(haifa.start.getTime()).not.toBe(eilat.start.getTime());
    expect(Math.abs(haifa.start.getTime() - eilat.start.getTime())).toBeLessThan(40 * 60_000);
  });

  it("has no window without a known city, and every listed city works", () => {
    expect(shabbatEndsAt(new Date("2026-10-31T10:00:00Z"), cityById("nowhere"), hebcal)).toBeNull();
    for (const city of ISRAELI_CITIES) expect(shabbatWindow(new Date("2026-10-30T12:00:00Z"), city, hebcal)?.end.getTime()).toBeGreaterThan(0);
  });
});

describe("quiet hours", () => {
  // Israel is UTC+2 on 2026-11-10 (standard time).
  const hours = { from: "22:00", to: "08:00" };
  it("covers a window that wraps midnight and reports when it ends", () => {
    expect(quietHoursEnd(new Date("2026-11-10T21:00:00Z"), hours)?.toISOString()).toBe("2026-11-11T06:00:00.000Z"); // 23:00 local
    expect(quietHoursEnd(new Date("2026-11-10T03:00:00Z"), hours)?.toISOString()).toBe("2026-11-10T06:00:00.000Z"); // 05:00 local
    expect(quietHoursEnd(new Date("2026-11-10T10:00:00Z"), hours)).toBeNull(); // 12:00 local
  });
  it("supports a daytime window and ignores empty or broken ones", () => {
    expect(quietHoursEnd(new Date("2026-11-10T10:00:00Z"), { from: "09:00", to: "13:00" })).not.toBeNull();
    expect(quietHoursEnd(new Date("2026-11-10T10:00:00Z"), null)).toBeNull();
    expect(quietHoursEnd(new Date("2026-11-10T10:00:00Z"), { from: "22:00", to: "22:00" })).toBeNull();
    expect(quietHoursEnd(new Date("2026-11-10T10:00:00Z"), { from: "bad", to: "08:00" })).toBeNull();
  });
});

const NOW = new Date("2026-11-10T10:00:00Z"); // Tuesday, 12:00 in Israel
const item = (id: number, kind: QueuedItem["kind"], payload: Record<string, unknown> = {}, createdAt = "2026-11-10T09:55:00Z"): QueuedItem => ({ id, kind, payload: { name: "מכנסי בדיקה", url: "https://www.terminalx.com/w817260002", ...payload }, createdAt });
const channels = (...c: Partial<ChannelRow>[]): ChannelRow[] => c.map((x) => ({ channel: "extension", enabled: true, verified: true, address: null, ...x }));
const user = (over: Partial<UserContext> = {}): UserContext => ({
  settings: { quietMode: false, quietHours: null, shabbatMode: false, shabbatCity: null, dailyCap: 3 },
  prefs: {},
  channels: channels({}),
  messagesToday: 0,
  ...over,
});

describe("planForUser", () => {
  it("sends one merged message for everything that arrived in the same run", () => {
    const plan = planForUser([item(1, "price_target", { price: 99.9, targetPrice: 100 }), item(2, "restock"), item(3, "price_drop", { price: 90, previousPrice: 120, dropPercent: 25 })], user(), NOW, hebcal);
    expect(plan.outcomes.every((o) => o.status === "send")).toBe(true);
    expect(plan.messages).toHaveLength(1);
    expect(plan.messages[0]).toMatchObject({ channel: "extension", itemIds: [1, 2, 3], title: "SmartBuy: 3 עדכונים", url: "https://www.terminalx.com/w817260002" });
    expect(plan.messages[0]!.text.split("\n")).toHaveLength(3);
  });

  it("drops what the user switched off, and everything in quiet mode", () => {
    const prefs = { restock: { enabled: false, channels: ["extension" as const] } };
    const off = planForUser([item(1, "restock"), item(2, "price_target", { price: 99 })], user({ prefs }), NOW, hebcal);
    expect(off.outcomes).toEqual([{ id: 1, status: "skip", reason: "pref_disabled" }, { id: 2, status: "send", channels: ["extension"] }]);
    const quiet = planForUser([item(1, "price_target", { price: 99 })], user({ settings: { ...user().settings, quietMode: true } }), NOW, hebcal);
    expect(quiet.outcomes).toEqual([{ id: 1, status: "skip", reason: "quiet_mode" }]);
    expect(quiet.messages).toEqual([]);
  });

  it("holds messages during quiet hours until they end, and does not count them against the cap", () => {
    const settings = { ...user().settings, quietHours: { from: "09:00", to: "13:00" } };
    const plan = planForUser([item(1, "price_target", { price: 99 })], user({ settings }), NOW, hebcal);
    expect(plan.outcomes[0]).toMatchObject({ status: "defer", reason: "quiet_hours" });
    expect((plan.outcomes[0] as { until: Date }).until.toISOString()).toBe("2026-11-10T11:00:00.000Z");
    expect(plan.messages).toEqual([]);
  });

  it("holds messages during Shabbat until it ends", () => {
    const settings = { ...user().settings, shabbatMode: true, shabbatCity: "jerusalem" };
    const saturday = new Date("2026-10-31T10:00:00Z");
    const plan = planForUser([item(1, "restock", {}, "2026-10-31T09:55:00Z")], user({ settings }), saturday, hebcal);
    expect(plan.outcomes[0]).toMatchObject({ status: "defer", reason: "shabbat" });
    near((plan.outcomes[0] as { until: Date }).until, "2026-10-31T15:27:45.000Z");
    // Shabbat mode without a city cannot be computed, so it does not silence anything.
    const noCity = planForUser([item(1, "restock", {}, "2026-10-31T09:55:00Z")], user({ settings: { ...settings, shabbatCity: null } }), saturday, hebcal);
    expect(noCity.outcomes[0]!.status).toBe("send");
  });

  it("stops at the daily cap and waits for tomorrow", () => {
    const plan = planForUser([item(1, "restock")], user({ messagesToday: 3 }), NOW, hebcal);
    expect(plan.outcomes[0]).toMatchObject({ status: "defer", reason: "daily_cap" });
    expect(planForUser([item(1, "restock")], user({ messagesToday: 2 }), NOW, hebcal).messages).toHaveLength(1);
    expect(planForUser([item(1, "restock")], user({ messagesToday: 0, settings: { ...user().settings, dailyCap: 0 } }), NOW, hebcal).messages).toHaveLength(0);
  });

  it("drops items that waited more than two days", () => {
    const plan = planForUser([item(1, "restock", {}, "2026-11-07T09:00:00Z")], user(), NOW, hebcal);
    expect(plan.outcomes).toEqual([{ id: 1, status: "skip", reason: "expired" }]);
  });

  it("routes each kind to the channels the user picked, and only to connected, verified ones", () => {
    const prefs = { price_target: { enabled: true, channels: ["telegram" as const, "email" as const] }, restock: { enabled: true, channels: ["extension" as const] } };
    const ch = channels({ channel: "extension" }, { channel: "telegram", address: "555" }, { channel: "email", address: "a@b.test", verified: false });
    const plan = planForUser([item(1, "price_target", { price: 99 }), item(2, "restock")], user({ prefs, channels: ch }), NOW, hebcal);
    expect(plan.messages.map((m) => [m.channel, m.address, m.itemIds])).toEqual([["telegram", "555", [1]], ["extension", null, [2]]]);
    // The unverified email channel is never used, and a kind with no usable channel is skipped.
    const none = planForUser([item(1, "price_target", { price: 99 })], user({ prefs: { price_target: { enabled: true, channels: ["email"] } }, channels: ch }), NOW, hebcal);
    expect(none.outcomes).toEqual([{ id: 1, status: "skip", reason: "no_channel" }]);
  });

  it("does not use a telegram or email channel that has no address", () => {
    const plan = planForUser([item(1, "restock")], user({ prefs: { restock: { enabled: true, channels: ["telegram"] } }, channels: channels({ channel: "telegram", address: null }) }), NOW, hebcal);
    expect(plan.outcomes[0]).toMatchObject({ status: "skip", reason: "no_channel" });
  });

  it("does nothing for an empty queue", () => {
    expect(planForUser([], user(), NOW, hebcal)).toEqual({ outcomes: [], messages: [] });
  });
});

describe("message text", () => {
  it("says what happened with the number that matters, in Hebrew", () => {
    expect(describeItem(item(1, "price_target", { price: 99.9, targetPrice: 100 }))).toBe("מכנסי בדיקה: המחיר ירד ל-₪99.90, בדיוק ביעד שקבעתם (₪100).");
    expect(describeItem(item(2, "price_drop", { price: 90, previousPrice: 120, dropPercent: 25 }))).toBe("מכנסי בדיקה: המחיר ירד ב-25% ומגיע ל-₪90 (היה ₪120).");
    expect(describeItem(item(3, "restock"))).toBe("מכנסי בדיקה: חזר למלאי.");
    expect(describeItem(item(4, "pending_review_reminder", { name: undefined, count: 1 }))).toBe("מוצר אחד שקניתם מחכה לביקורת.");
    expect(describeItem(item(5, "pending_review_reminder", { count: 4 }))).toBe("4 מוצרים שקניתם מחכים לביקורת.");
  });

  it("uses a single line for one item and a list for several, and only links to https addresses", () => {
    expect(buildMessage([item(1, "restock")])).toMatchObject({ title: "SmartBuy", url: "https://www.terminalx.com/w817260002" });
    expect(buildMessage([item(1, "restock"), item(2, "restock")]).text.startsWith("• ")).toBe(true);
    expect(buildMessage([item(1, "restock", { url: "javascript:alert(1)" })]).url).toBeNull();
  });
});
