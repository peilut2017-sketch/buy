// Time since purchase and relative dates, in Hebrew. Spec: docs/01-product-spec.md section 6.
// Stage boundaries match the SQL function public.review_stage (7 and 90 days).

import type { ReviewStage } from "./types.ts";

const DAY_MS = 86_400_000;

export const STAGE_LABEL: Record<ReviewStage, string> = {
  first_impression: "התרשמות ראשונה",
  after_use: "אחרי שימוש",
  long_term: "שימוש ממושך",
};

/** Whole days from `from` to `to`, by calendar date in UTC. Negative when `to` is earlier. */
export function daysBetween(from: string | Date, to: string | Date): number {
  const a = new Date(from);
  const b = new Date(to);
  const start = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const end = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((end - start) / DAY_MS);
}

export function reviewStage(daysSincePurchase: number): ReviewStage {
  if (daysSincePurchase <= 7) return "first_impression";
  if (daysSincePurchase <= 90) return "after_use";
  return "long_term";
}

export interface PurchaseDates {
  deliveredAt: string | null;
  purchasedAt: string | null;
  /** First day of the month the author declared, for unverified reviews. */
  purchaseMonth: string | null;
}

export type ReferenceSource = "delivered" | "purchased" | "self_reported";

/** The date the time since purchase counts from: delivery, then order date, then the author's own month. */
export function purchaseReference(dates: PurchaseDates): { date: string; source: ReferenceSource } | null {
  if (dates.deliveredAt) return { date: dates.deliveredAt, source: "delivered" };
  if (dates.purchasedAt) return { date: dates.purchasedAt, source: "purchased" };
  if (dates.purchaseMonth) return { date: dates.purchaseMonth, source: "self_reported" };
  return null;
}

export interface SincePurchase {
  days: number;
  stage: ReviewStage;
  source: ReferenceSource;
  /** "3 שבועות אחרי הקנייה" */
  text: string;
  /** Set when the date comes from the author, not from an order. */
  selfReported: boolean;
  /** A verified review written before delivery. Flagged for a moderator (spec 6). */
  beforeDelivery: boolean;
}

export const SELF_REPORTED_NOTE = "לפי דיווח הכותב";

export function sincePurchase(dates: PurchaseDates, writtenAt: string | Date): SincePurchase | null {
  const ref = purchaseReference(dates);
  if (!ref) return null;
  const days = daysBetween(ref.date, writtenAt);
  const effective = Math.max(days, 0);
  return {
    days: effective,
    stage: reviewStage(effective),
    source: ref.source,
    text: formatAfterPurchase(effective),
    selfReported: ref.source === "self_reported",
    beforeDelivery: ref.source === "delivered" && days < 0,
  };
}

/** The duration as a Hebrew noun phrase with dual forms: "יומיים", "שבוע", "3 חודשים". */
export function durationHe(days: number): string {
  const d = Math.max(0, Math.floor(days));
  if (d === 1) return "יום";
  if (d === 2) return "יומיים";
  if (d < 7) return `${d} ימים`;
  if (d < 60) {
    const weeks = Math.floor(d / 7);
    return weeks === 1 ? "שבוע" : weeks === 2 ? "שבועיים" : `${weeks} שבועות`;
  }
  if (d < 700) {
    const months = Math.round(d / 30.44);
    return months === 1 ? "חודש" : months === 2 ? "חודשיים" : `${months} חודשים`;
  }
  const years = Math.round(d / 365.25);
  return years === 1 ? "שנה" : years === 2 ? "שנתיים" : `${years} שנים`;
}

export function formatAfterPurchase(days: number): string {
  return days <= 0 ? "ביום הקנייה" : `${durationHe(days)} אחרי הקנייה`;
}

/** 23.10.2026, by the calendar date in Israel. */
export function formatDateHe(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")}`;
}

/** "היום", "אתמול", "לפני שבועיים". Beyond about six weeks it falls back to the date. */
export function formatRelative(value: string | Date, now: Date): string {
  const days = daysBetween(value, now);
  if (days <= 0) return "היום";
  if (days === 1) return "אתמול";
  if (days === 2) return "שלשום";
  if (days < 7) return `לפני ${days} ימים`;
  if (days < 45) return `לפני ${durationHe(days)}`;
  return formatDateHe(value);
}

/** Months between two dates, for "עדכון אחרי 4 חודשים". */
export function updateAfterText(reviewWrittenAt: string | Date, updateAt: string | Date): string {
  return `עדכון אחרי ${durationHe(daysBetween(reviewWrittenAt, updateAt))}`;
}
