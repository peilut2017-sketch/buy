import { describe, expect, it } from "vitest";
import { activeFilterCount, filterReviews, NO_FILTERS, reviewColors } from "./reviews.ts";
import type { ReviewView } from "./types.ts";

// SYNTHETIC reviews: only the fields the filters read.
let id = 0;
const review = (variantValues: Record<string, string>): ReviewView => ({
  id: ++id, rating: 4, title: null, body: "x", answers: {}, variantValues, verification: "unverified", purchaseMonth: null, purchasedAt: null,
  deliveredAt: null, writtenAt: "2026-10-01T00:00:00Z", editedAt: null, helpfulCount: 0, author: null, updates: [], mine: false, votedHelpful: false, hidden: false,
});

describe("colour filter", () => {
  const rs = [review({ "צבע": "ורוד עתיק", "מידה": "M" }), review({ "צבע": "ורוד עתיק" }), review({ "צבע": " לבן " }), review({ "מידה": "S" })];

  it("lists the colours buyers chose, most reviewed first, and ignores reviews without one", () => {
    expect(reviewColors(rs, "צבע")).toEqual([{ color: "ורוד עתיק", count: 2 }, { color: "לבן", count: 1 }]);
    expect(reviewColors(rs, null)).toEqual([]);
  });

  it("keeps only the chosen colour, ignoring case and spacing, and counts as an active filter", () => {
    const filters = { ...NO_FILTERS, color: "לבן" };
    expect(filterReviews(rs, filters, "צבע")).toHaveLength(1);
    expect(filterReviews(rs, { ...NO_FILTERS, color: "ורוד עתיק" }, "צבע")).toHaveLength(2);
    expect(activeFilterCount(filters)).toBe(1);
  });

  it("does nothing without the store's colour group", () => {
    expect(filterReviews(rs, { ...NO_FILTERS, color: "לבן" })).toHaveLength(4);
  });
});
