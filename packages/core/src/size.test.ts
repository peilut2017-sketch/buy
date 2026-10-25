import { describe, expect, it } from "vitest";
import { sizeAdvice } from "./size.ts";
import type { ReviewView } from "./types.ts";

// SYNTHETIC reviews, only the fields the advice reads.
let id = 0;
function review(usual: string, bought: string, fit: string, extra: Partial<ReviewView> = {}): ReviewView {
  return {
    id: ++id, rating: 4, title: null, body: "x", answers: { usual_size: usual, fit }, variantValues: { "מידה": bought },
    verification: "unverified", purchaseMonth: null, purchasedAt: null, deliveredAt: null, writtenAt: "2026-10-01T00:00:00Z", editedAt: null,
    helpfulCount: 0, author: null, updates: [], mine: false, votedHelpful: false, hidden: false, ...extra,
  };
}

describe("sizeAdvice (spec section 15)", () => {
  it("shows nothing below five comparable reviews", () => {
    const rs = [review("M", "L", "exact"), review("M", "L", "exact"), review("M", "L", "exact"), review("M", "L", "exact")];
    expect(sizeAdvice(rs, "M", "מידה")).toEqual({ kind: "none" });
  });

  it("recommends the size that comparable buyers found exact", () => {
    const rs = [review("M", "L", "exact"), review("M", "L", "exact"), review("M", "L", "exact"), review("M", "M", "small"), review("M", "M", "small")];
    const advice = sizeAdvice(rs, "M", "מידה");
    expect(advice).toMatchObject({ kind: "advice", size: "L", sameAsUsual: false, basedOn: 5, headline: "בשבילך: קח L" });
  });

  it("says so when the usual size fits", () => {
    const rs = [review("m", "M", "exact"), review("M", "M", "exact"), review("M", "M", "exact"), review("M", "L", "large"), review("M", "L", "exact")];
    const advice = sizeAdvice(rs, " m ", "מידה");
    expect(advice).toMatchObject({ kind: "advice", size: "M", sameAsUsual: true });
    if (advice.kind === "advice") expect(advice.headline).toContain("המידה הרגילה שלך");
  });

  it("ignores buyers with a different usual size, unanswered fit, hidden reviews and my own", () => {
    const rs = [
      review("S", "L", "exact"), review("S", "L", "exact"), review("S", "L", "exact"),
      review("M", "L", "exact", { hidden: true }), review("M", "L", "exact", { mine: true }),
      review("M", "L", "unknown"),
    ];
    expect(sizeAdvice(rs, "M", "מידה")).toEqual({ kind: "none" });
  });

  it("gives no advice when no size has enough exact answers", () => {
    const rs = [review("M", "S", "exact"), review("M", "M", "exact"), review("M", "L", "exact"), review("M", "XL", "large"), review("M", "XL", "large")];
    expect(sizeAdvice(rs, "M", "מידה")).toEqual({ kind: "none" });
  });

  it("needs the store's size group and a usual size", () => {
    const rs = Array.from({ length: 6 }, () => review("M", "L", "exact"));
    expect(sizeAdvice(rs, "M", null)).toEqual({ kind: "none" });
    expect(sizeAdvice(rs, "  ", "מידה")).toEqual({ kind: "none" });
  });
});
