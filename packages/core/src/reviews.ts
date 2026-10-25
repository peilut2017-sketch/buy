// Review presentation rules: labels, sorting and filtering for the panel list.

import { sincePurchase } from "./time.ts";
import type { ReviewerLevel } from "../../../supabase/functions/_shared/moderation.ts";
import type { ProductSummary, ReviewStage, ReviewView, VerificationState } from "./types.ts";

export const VERIFICATION_LABEL: Record<VerificationState, string> = {
  verified: "רכישה מאומתת",
  pending: "ממתין לאימות",
  unverified: "לא מאומת",
};

export const LEVEL_LABEL: Record<ReviewerLevel, string> = {
  new: "חדש",
  active: "פעיל",
  experienced: "מנוסה",
  leading: "מוביל",
};

export const FIT_LABEL = { small: "קטן", exact: "מדויק", large: "גדול" } as const;

export type SortMode = "relevance" | "newest" | "highest" | "lowest" | "longest_use";

export const SORT_LABEL: Record<SortMode, string> = {
  relevance: "הכי רלוונטיות",
  newest: "החדשות ביותר",
  highest: "דירוג גבוה",
  lowest: "דירוג נמוך",
  longest_use: "הכי הרבה זמן מהקנייה",
};

export interface ReviewFilters {
  /** Show only this star rating. */
  rating: number | null;
  verifiedOnly: boolean;
  /** Show only reviews written long after the purchase (stage "שימוש ממושך"). */
  longTermOnly: boolean;
  fit: "small" | "exact" | "large" | null;
}

export const NO_FILTERS: ReviewFilters = { rating: null, verifiedOnly: false, longTermOnly: false, fit: null };

export function activeFilterCount(filters: ReviewFilters): number {
  return [filters.rating !== null, filters.verifiedOnly, filters.longTermOnly, filters.fit !== null].filter(Boolean).length;
}

export function stageOf(review: ReviewView): ReviewStage | null {
  return sincePurchase(review, review.writtenAt)?.stage ?? null;
}

export function filterReviews(reviews: readonly ReviewView[], filters: ReviewFilters): ReviewView[] {
  return reviews.filter((r) => {
    if (filters.rating !== null && r.rating !== filters.rating) return false;
    if (filters.verifiedOnly && r.verification !== "verified") return false;
    if (filters.longTermOnly && stageOf(r) !== "long_term") return false;
    if (filters.fit !== null && r.answers.fit !== filters.fit) return false;
    return true;
  });
}

/**
 * Verified reviews weigh more in the default order, unverified ones are never hidden (spec 7, decision 4).
 * The weight applies to sorting only, never to the average.
 */
export function relevanceScore(review: ReviewView): number {
  const weight = review.verification === "verified" ? 1.5 : review.verification === "pending" ? 1.2 : 1;
  return weight * (1 + review.helpfulCount);
}

export function sortReviews(reviews: readonly ReviewView[], mode: SortMode): ReviewView[] {
  const byNewest = (a: ReviewView, b: ReviewView) => Date.parse(b.writtenAt) - Date.parse(a.writtenAt);
  const list = [...reviews];
  switch (mode) {
    case "newest":
      return list.sort(byNewest);
    case "highest":
      return list.sort((a, b) => b.rating - a.rating || byNewest(a, b));
    case "lowest":
      return list.sort((a, b) => a.rating - b.rating || byNewest(a, b));
    case "longest_use":
      return list.sort((a, b) => (sincePurchase(b, b.writtenAt)?.days ?? -1) - (sincePurchase(a, a.writtenAt)?.days ?? -1) || byNewest(a, b));
    default:
      return list.sort((a, b) => relevanceScore(b) - relevanceScore(a) || byNewest(a, b));
  }
}

/** "4.3" with one decimal, as the strip shows it. */
export function formatRating(avg: number | null): string {
  return avg === null ? "" : avg.toFixed(1);
}

export function hasReviews(summary: ProductSummary | null): boolean {
  return summary !== null && summary.reviewsCount > 0;
}
