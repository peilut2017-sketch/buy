// Price formatting, history and tracking rules. Spec: docs/01-product-spec.md section 13.

import { formatDateHe } from "./time.ts";

export const SHEKEL = "₪";

/** ₪149.90 and ₪150: the shekel sign comes first with no space (the Hebrew copy rule); whole amounts show no decimals. */
export function formatIls(amount: number): string {
  const whole = Number.isInteger(amount);
  return `${SHEKEL}${amount.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Reads what a person typed into the target price field: "99", "99.90", "99,90", "₪ 99". */
export function parseAmountInput(text: string): number | null {
  const cleaned = text.replace(/[\s₪]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export type TargetCheck = { ok: true; value: number } | { ok: false; error: string };

/** The target must be positive and lower than the current price (spec 13). */
export function validateTargetPrice(input: string, currentPrice: number | null): TargetCheck {
  if (input.trim() === "") return { ok: false, error: "הזינו מחיר יעד." };
  const value = parseAmountInput(input);
  if (value === null || value <= 0) return { ok: false, error: "הזינו מחיר תקין, למשל 99.90." };
  if (currentPrice !== null && value >= currentPrice) {
    return { ok: false, error: `מחיר היעד צריך להיות נמוך מהמחיר הנוכחי (${formatIls(currentPrice)}).` };
  }
  return { ok: true, value };
}

export interface PricePoint {
  /** When the change was observed. */
  at: string | Date;
  price: number | null;
  inStock: boolean | null;
}

const DAY_MS = 86_400_000;
export const HISTORY_DAYS = 90;
/** Under this many days of tracking, the chart says tracking has only just begun. */
export const SPARSE_BELOW_DAYS = 14;

function sorted(points: readonly PricePoint[]): { t: number; price: number | null; inStock: boolean | null }[] {
  return points
    .map((p) => ({ t: new Date(p.at).getTime(), price: p.price, inStock: p.inStock }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}

export interface SeriesPoint {
  t: number;
  price: number;
}

/**
 * Step series for the chart. Only changes are stored, so the price holds until the next change.
 * Starts at the window edge with the price in effect then, and ends at `now`.
 */
export function buildSeries(points: readonly PricePoint[], now: Date, days = HISTORY_DAYS): SeriesPoint[] {
  const events = sorted(points).filter((p) => p.price !== null) as { t: number; price: number }[];
  const end = now.getTime();
  const start = end - days * DAY_MS;
  const series: SeriesPoint[] = [];
  const before = [...events].reverse().find((p) => p.t <= start);
  if (before) series.push({ t: start, price: before.price });
  for (const p of events) {
    if (p.t > start && p.t <= end) series.push({ t: p.t, price: p.price });
  }
  const last = series[series.length - 1];
  if (last && last.t < end) series.push({ t: end, price: last.price });
  return series;
}

export interface LowestPrice {
  price: number;
  /** When the lowest price began inside the window. */
  since: Date;
}

export function lowestInWindow(points: readonly PricePoint[], now: Date, days = HISTORY_DAYS): LowestPrice | null {
  const series = buildSeries(points, now, days);
  let lowest: SeriesPoint | null = null;
  for (const p of series) {
    if (lowest === null || p.price < lowest.price) lowest = p;
  }
  return lowest ? { price: lowest.price, since: new Date(lowest.t) } : null;
}

export type HistoryState =
  | { kind: "none" }
  | { kind: "sparse"; since: Date; message: string }
  | { kind: "ok"; since: Date };

/** Whether there is enough data for a chart. The message is the one the spec asks for. */
export function historyState(points: readonly PricePoint[], now: Date): HistoryState {
  const events = sorted(points).filter((p) => p.price !== null);
  const first = events[0];
  if (!first) return { kind: "none" };
  const since = new Date(first.t);
  const trackedDays = (now.getTime() - first.t) / DAY_MS;
  const distinct = new Set(events.map((e) => e.price)).size;
  if (trackedDays < SPARSE_BELOW_DAYS || distinct < 2) {
    return { kind: "sparse", since, message: `אנחנו עוקבים אחרי המחיר מ-${formatDateHe(since)}` };
  }
  return { kind: "ok", since };
}
