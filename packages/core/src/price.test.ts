import { describe, expect, it } from "vitest";
import { buildSeries, formatIls, historyState, lowestInWindow, parseAmountInput, validateTargetPrice } from "./price.ts";

const now = new Date("2026-10-25T12:00:00Z");
const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

describe("formatIls", () => {
  it("puts the shekel sign first, with tabular-friendly decimals", () => {
    expect(formatIls(149.9)).toBe("₪149.90");
    expect(formatIls(150)).toBe("₪150");
    expect(formatIls(1249.9)).toBe("₪1,249.90");
  });
});

describe("parseAmountInput", () => {
  it.each([
    ["99", 99],
    ["99.90", 99.9],
    ["99,90", 99.9],
    ["₪ 120", 120],
  ])("reads %s", (text, expected) => {
    expect(parseAmountInput(text)).toBe(expected);
  });
  it.each(["", "abc", "9.999", "-5", "1e3"])("rejects %s", (text) => {
    expect(parseAmountInput(text)).toBeNull();
  });
});

describe("validateTargetPrice (spec 13)", () => {
  it("must be lower than the current price", () => {
    expect(validateTargetPrice("99.90", 149.9)).toEqual({ ok: true, value: 99.9 });
    expect(validateTargetPrice("149.90", 149.9)).toEqual({ ok: false, error: "מחיר היעד צריך להיות נמוך מהמחיר הנוכחי (₪149.90)." });
    expect(validateTargetPrice("200", 149.9).ok).toBe(false);
  });
  it("asks for a value, and for a valid one", () => {
    expect(validateTargetPrice("", 149.9)).toEqual({ ok: false, error: "הזינו מחיר יעד." });
    expect(validateTargetPrice("abc", 149.9)).toEqual({ ok: false, error: "הזינו מחיר תקין, למשל 99.90." });
    expect(validateTargetPrice("0", 149.9).ok).toBe(false);
  });
  it("accepts any positive target when the current price is unknown", () => {
    expect(validateTargetPrice("50", null)).toEqual({ ok: true, value: 50 });
  });
});

describe("price history", () => {
  const points = [
    { at: day(120), price: 199, inStock: true },
    { at: day(60), price: 149.9, inStock: true },
    { at: day(30), price: 129.9, inStock: true },
    { at: day(10), price: 169.9, inStock: false },
  ];

  it("starts the series at the window edge with the price then in effect", () => {
    const series = buildSeries(points, now);
    expect(series[0]).toEqual({ t: now.getTime() - 90 * 86_400_000, price: 199 });
    expect(series.at(-1)).toEqual({ t: now.getTime(), price: 169.9 });
    expect(series.map((p) => p.price)).toEqual([199, 149.9, 129.9, 169.9, 169.9]);
  });

  it("finds the lowest price in 90 days and when it began", () => {
    const low = lowestInWindow(points, now);
    expect(low?.price).toBe(129.9);
    expect(low?.since.toISOString()).toBe(day(30));
  });

  it("ignores a lower price that fell outside the window", () => {
    const low = lowestInWindow([{ at: day(200), price: 50, inStock: true }, { at: day(100), price: 120, inStock: true }], now);
    expect(low?.price).toBe(120);
  });

  it("has nothing to say without data", () => {
    expect(lowestInWindow([], now)).toBeNull();
    expect(buildSeries([], now)).toEqual([]);
  });

  it("reports the state of the history for the chart", () => {
    expect(historyState([], now)).toEqual({ kind: "none" });
    const fresh = historyState([{ at: day(3), price: 100, inStock: true }], now);
    expect(fresh).toMatchObject({ kind: "sparse", message: "אנחנו עוקבים אחרי המחיר מ-22.10.2026" });
    expect(historyState(points, now).kind).toBe("ok");
    expect(historyState([{ at: day(60), price: 100, inStock: true }], now).kind).toBe("sparse");
  });
});
