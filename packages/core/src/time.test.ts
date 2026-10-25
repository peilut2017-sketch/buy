import { describe, expect, it } from "vitest";
import {
  daysBetween,
  durationHe,
  formatAfterPurchase,
  formatDateHe,
  formatRelative,
  reviewStage,
  sincePurchase,
  updateAfterText,
} from "./time.ts";

describe("durationHe", () => {
  it.each([
    [1, "יום"],
    [2, "יומיים"],
    [5, "5 ימים"],
    [7, "שבוע"],
    [14, "שבועיים"],
    [21, "3 שבועות"],
    [56, "8 שבועות"],
    [60, "חודשיים"],
    [91, "3 חודשים"],
    [122, "4 חודשים"],
    [400, "13 חודשים"],
    [730, "שנתיים"],
    [1100, "3 שנים"],
  ])("%i days is %s", (days, expected) => {
    expect(durationHe(days)).toBe(expected);
  });
});

describe("formatAfterPurchase", () => {
  it("matches the wording in the spec", () => {
    expect(formatAfterPurchase(21)).toBe("3 שבועות אחרי הקנייה");
    expect(formatAfterPurchase(0)).toBe("ביום הקנייה");
    expect(formatAfterPurchase(1)).toBe("יום אחרי הקנייה");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-10-25T10:00:00Z");
  it.each([
    ["2026-10-25T08:00:00Z", "היום"],
    ["2026-10-24T08:00:00Z", "אתמול"],
    ["2026-10-23T08:00:00Z", "שלשום"],
    ["2026-10-20T08:00:00Z", "לפני 5 ימים"],
    ["2026-10-18T08:00:00Z", "לפני שבוע"],
    ["2026-10-11T08:00:00Z", "לפני שבועיים"],
    ["2026-10-04T08:00:00Z", "לפני 3 שבועות"],
    ["2026-08-01T08:00:00Z", "01.08.2026"],
    ["2026-10-26T08:00:00Z", "היום"],
  ])("%s is %s", (iso, expected) => {
    expect(formatRelative(iso, now)).toBe(expected);
  });
});

describe("formatDateHe", () => {
  it("uses dd.mm.yyyy by the date in Israel", () => {
    expect(formatDateHe("2026-10-23T09:00:00Z")).toBe("23.10.2026");
    // 22:30 UTC is already the next day in Israel.
    expect(formatDateHe("2026-06-30T22:30:00Z")).toBe("01.07.2026");
  });
});

describe("reviewStage (matches public.review_stage in SQL)", () => {
  it.each([
    [0, "first_impression"],
    [7, "first_impression"],
    [8, "after_use"],
    [90, "after_use"],
    [91, "long_term"],
  ] as const)("%i days is %s", (days, stage) => {
    expect(reviewStage(days)).toBe(stage);
  });
});

describe("sincePurchase", () => {
  it("counts from delivery when known", () => {
    const r = sincePurchase({ deliveredAt: "2026-01-27", purchasedAt: "2026-01-20", purchaseMonth: null }, "2026-02-17T10:00:00Z");
    expect(r).toMatchObject({ days: 21, stage: "after_use", source: "delivered", text: "3 שבועות אחרי הקנייה", selfReported: false });
  });

  it("falls back to the order date, then to the month the author declared", () => {
    expect(sincePurchase({ deliveredAt: null, purchasedAt: "2026-01-20", purchaseMonth: null }, "2026-01-22T10:00:00Z")?.source).toBe("purchased");
    const self = sincePurchase({ deliveredAt: null, purchasedAt: null, purchaseMonth: "2026-06-01" }, "2026-10-25T10:00:00Z");
    expect(self).toMatchObject({ source: "self_reported", selfReported: true, stage: "long_term", text: "5 חודשים אחרי הקנייה" });
  });

  it("is null with no purchase date at all", () => {
    expect(sincePurchase({ deliveredAt: null, purchasedAt: null, purchaseMonth: null }, "2026-10-25")).toBeNull();
  });

  it("flags a verified review written before delivery, and never goes negative", () => {
    const r = sincePurchase({ deliveredAt: "2026-02-10", purchasedAt: null, purchaseMonth: null }, "2026-02-05T10:00:00Z");
    expect(r).toMatchObject({ days: 0, beforeDelivery: true });
  });
});

describe("daysBetween and updateAfterText", () => {
  it("counts calendar days", () => {
    expect(daysBetween("2026-10-01", "2026-10-25")).toBe(24);
    expect(daysBetween("2026-10-25", "2026-10-01")).toBe(-24);
  });
  it("describes an update", () => {
    expect(updateAfterText("2026-01-01T00:00:00Z", "2026-05-02T00:00:00Z")).toBe("עדכון אחרי 4 חודשים");
  });
});
