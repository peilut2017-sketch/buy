// Personal size advice. Spec: docs/01-product-spec.md section 15.
// "Take L" is computed only from other buyers who report the same usual size and answered the fit question.
// Nothing is guessed: with too little evidence there is no advice, and the UI shows nothing.

import type { ReviewView } from "./types.ts";
import { countLabel, BUYERS } from "./he.ts";

/** Spec 15: at least five relevant reviews, otherwise nothing is shown. */
export const SIZE_ADVICE_MIN_REVIEWS = 5;
/** A size is only recommended when at least this many buyers of it called the fit exact. */
export const SIZE_ADVICE_MIN_EXACT = 2;

export type SizeAdvice =
  | { kind: "none" }
  | {
      kind: "advice";
      size: string;
      /** The recommended size is the one the person usually wears. */
      sameAsUsual: boolean;
      /** Reviews that were comparable, for the "based on" line. */
      basedOn: number;
      headline: string;
      support: string;
    };

const normalize = (size: string): string => size.trim().toUpperCase();

interface Tally {
  size: string;
  small: number;
  exact: number;
  large: number;
}

/**
 * @param reviews     the product's visible reviews
 * @param usualSize   what the signed-in person usually wears (their size profile)
 * @param sizeGroup   the name of the variant group that holds the size on this store, from the adapter config
 */
export function sizeAdvice(reviews: readonly ReviewView[], usualSize: string, sizeGroup: string | null | undefined): SizeAdvice {
  const mine = normalize(usualSize);
  if (!mine || !sizeGroup) return { kind: "none" };

  const tallies = new Map<string, Tally>();
  let relevant = 0;
  for (const review of reviews) {
    if (review.hidden || review.mine) continue;
    const theirUsual = review.answers.usual_size;
    const fit = review.answers.fit;
    const bought = review.variantValues[sizeGroup];
    if (typeof theirUsual !== "string" || normalize(theirUsual) !== mine) continue;
    if (fit !== "small" && fit !== "exact" && fit !== "large") continue;
    if (typeof bought !== "string" || bought.trim() === "") continue;
    relevant++;
    const key = normalize(bought);
    const tally = tallies.get(key) ?? { size: bought.trim(), small: 0, exact: 0, large: 0 };
    tally[fit]++;
    tallies.set(key, tally);
  }
  if (relevant < SIZE_ADVICE_MIN_REVIEWS) return { kind: "none" };

  const qualified = [...tallies.values()].filter((t) => t.exact >= SIZE_ADVICE_MIN_EXACT && t.exact / (t.small + t.exact + t.large) >= 0.5);
  if (qualified.length === 0) return { kind: "none" };
  // The most "exact" answers win; a tie goes to the size the person already wears, then to the larger sample.
  qualified.sort((a, b) => b.exact - a.exact || Number(normalize(b.size) === mine) - Number(normalize(a.size) === mine) || (b.small + b.exact + b.large) - (a.small + a.exact + a.large));
  const best = qualified[0]!;
  const sameAsUsual = normalize(best.size) === mine;
  return {
    kind: "advice",
    size: best.size,
    sameAsUsual,
    basedOn: relevant,
    headline: sameAsUsual ? `בשבילך: המידה הרגילה שלך, ${best.size}, מתאימה` : `בשבילך: קח ${best.size}`,
    support: `לפי ${countLabel(relevant, BUYERS)} שהמידה הרגילה שלהם כמו שלך (${usualSize.trim()})`,
  };
}
