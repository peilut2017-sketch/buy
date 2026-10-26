// Moderation rules shared by the report Edge Function and tests. Pure functions.
// Spec: docs/01-product-spec.md sections 9 to 11. Thresholds come from public.settings, not from constants here.

import type { ReportReason } from "./validation.ts";

export type ReviewerLevel = "new" | "active" | "experienced" | "leading";

const LEVEL_ORDER: readonly ReviewerLevel[] = ["new", "active", "experienced", "leading"];

export function levelAtLeast(level: ReviewerLevel, minimum: ReviewerLevel): boolean {
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(minimum);
}

export interface AutoHideSettings {
  /** Distinct qualifying reporters needed to hide a review. */
  reports: number;
  minReporterLevel: ReviewerLevel;
  /** Reasons that hide a review at once, until a moderator looks. */
  instantReasons: readonly ReportReason[];
}

export interface ReporterAbuseSettings {
  dismissedRatio: number;
  minReports: number;
}

export interface ReportForDecision {
  reporterId: string;
  reason: ReportReason;
  reporterLevel: ReviewerLevel;
  reporterReportsFiled: number;
  reporterReportsDismissed: number;
}

/** A reporter whose reports are mostly dismissed (over the ratio, from at least minReports) loses weight. */
export function isAbusiveReporter(
  filed: number,
  dismissed: number,
  settings: ReporterAbuseSettings,
): boolean {
  return filed >= settings.minReports && dismissed / filed > settings.dismissedRatio;
}

export type AutoHideDecision =
  | { hide: false; reason: null }
  | { hide: true; reason: "instant" | "threshold" };

/**
 * Decides whether the reports on one review hide it automatically.
 * Instant reasons (personal details, defamation) hide at once. Otherwise the review needs
 * `settings.reports` different reporters at the minimum level, none of them an abusive reporter.
 */
export function decideAutoHide(
  reports: readonly ReportForDecision[],
  settings: AutoHideSettings,
  abuse: ReporterAbuseSettings,
): AutoHideDecision {
  if (reports.some((r) => settings.instantReasons.includes(r.reason))) {
    return { hide: true, reason: "instant" };
  }
  const qualifying = new Set<string>();
  for (const r of reports) {
    if (!levelAtLeast(r.reporterLevel, settings.minReporterLevel)) continue;
    if (isAbusiveReporter(r.reporterReportsFiled, r.reporterReportsDismissed, abuse)) continue;
    qualifying.add(r.reporterId);
  }
  return qualifying.size >= settings.reports ? { hide: true, reason: "threshold" } : { hide: false, reason: null };
}

export interface WaveSettings {
  threshold: number;
  windowHours: number;
}

/** Spec 11: more than `threshold` reviews on one product inside the window are flagged for a look. */
export function isReviewWave(writtenAt: readonly Date[], now: Date, settings: WaveSettings): boolean {
  const since = now.getTime() - settings.windowHours * 3_600_000;
  return writtenAt.filter((d) => d.getTime() >= since && d.getTime() <= now.getTime()).length > settings.threshold;
}

/** Spec 6 sanity check: a verified review written before the delivery date is flagged. */
export function writtenBeforeDelivery(writtenAt: Date, deliveredAt: string | null): boolean {
  if (!deliveredAt) return false;
  return writtenAt.toISOString().slice(0, 10) < deliveredAt;
}
