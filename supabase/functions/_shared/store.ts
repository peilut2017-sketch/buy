// The data operations the Edge Function handlers need, as an interface. The Supabase implementation lives in
// store.supabase.ts (Deno only); tests use an in-memory one. Handlers never touch a database client directly.

import type { AutoHideSettings, ReportForDecision, ReporterAbuseSettings, WaveSettings } from "./moderation.ts";
import type { ChannelName, ChannelRow, NotificationKind, PrefsByKind, QueuedItem, UserSettings } from "./notify.ts";
import type { ReportReason, ReviewAnswers } from "./validation.ts";

export type ReviewStatus = "draft" | "visible" | "hidden" | "removed";
export type Verification = "verified" | "pending" | "unverified";
export type Role = "user" | "moderator" | "admin";

export interface Settings {
  reviewLimits: { perDay: number; minChars: number; maxChars: number; countAfterHours: number };
  autoHide: AutoHideSettings;
  reporterAbuse: ReporterAbuseSettings;
  reviewWave: WaveSettings;
  notifications: { pendingAfterDeliveryDays: number };
  /** Reports one user may file per day, so reporting cannot be used to harass. */
  reportsPerDay: number;
  updatesPerReview: number;
  priceReports: { perInstallPerDay: number; outlierRatio: number; confirmations: number; windowHours: number; historyDays: number };
}

export const DEFAULT_SETTINGS: Settings = {
  reviewLimits: { perDay: 5, minChars: 30, maxChars: 2000, countAfterHours: 48 },
  autoHide: { reports: 3, minReporterLevel: "active", instantReasons: ["personal_or_defamation"] },
  reporterAbuse: { dismissedRatio: 0.7, minReports: 5 },
  reviewWave: { threshold: 5, windowHours: 24 },
  notifications: { pendingAfterDeliveryDays: 14 },
  reportsPerDay: 20,
  updatesPerReview: 5,
  priceReports: { perInstallPerDay: 200, outlierRatio: 0.6, confirmations: 2, windowHours: 24, historyDays: 90 },
};

export interface SiteRow {
  id: string;
  status: "active" | "beta" | "paused";
  /** Detection rules as stored in sites.adapter_config. Only the fields the server relies on are typed. */
  adapterConfig: { parentSku?: { fromSku?: string }; productType?: string; pageUrl?: string; signals?: { jsonLd?: { type: string; skuPath: string; skuRegex?: string } } };
  domains: string[];
}

export interface ProfileRow {
  id: string;
  displayName: string | null;
  role: Role;
  blockedAt: string | null;
  orderCheckConsent: boolean;
  /** The terms version this person accepted, or null if they have not accepted any. */
  termsVersion: string | null;
}

export interface ProductRow {
  id: number;
  siteId: string;
  parentSku: string;
}

export interface ReviewRow {
  id: number;
  userId: string;
  productId: number;
  rating: number;
  body: string | null;
  status: ReviewStatus;
  verification: Verification;
  writtenAt: string;
}

export interface OrderItemMatch {
  orderItemId: number;
  orderedAt: string | null;
  deliveredAt: string | null;
}

export interface SaveReviewInput {
  existingId: number | null;
  userId: string;
  productId: number;
  variantId: number | null;
  variantValues: Record<string, string>;
  rating: number;
  title: string | null;
  body: string | null;
  answers: ReviewAnswers;
  verification: Verification;
  orderItemId: number | null;
  purchaseMonth: string | null;
  purchasedAt: string | null;
  deliveredAt: string | null;
  detectionConfidence: "high" | "medium" | "low";
  now: string;
}

export interface ReportRow {
  id: number;
  reviewId: number;
  reporterId: string | null;
  reason: ReportReason;
  status: "open" | "upheld" | "dismissed";
}

export interface AppealRow {
  id: number;
  reviewId: number;
  userId: string;
  status: "open" | "accepted" | "rejected";
}

export interface TakedownRow {
  id: number;
  reviewId: number | null;
  status: "open" | "upheld" | "dismissed";
}

export interface EventRow {
  event: string;
  platform: "extension" | "web_desktop" | "web_mobile" | "server";
  siteId: string | null;
  productId: number | null;
  userId: string | null;
  installId: string | null;
  props: Record<string, unknown>;
}

export interface OrderToStore {
  userId: string;
  siteId: string;
  orderHash: string;
  orderedAt: string | null;
  deliveredAt: string | null;
  /** The delivery date is an assumption (the store's list has none), not something the store reported. */
  deliveryEstimated?: boolean;
  source: "extension" | "email" | "order_lookup";
  items: { sku: string; productId: number | null; variantId: number | null }[];
}

export interface Notification {
  userId: string;
  kind: "moderation_decision" | "my_review_activity" | "pending_review_reminder";
  payload: Record<string, unknown>;
  dedupeKey: string;
}

export interface PriceEventInput {
  variantId: number;
  price: number | null;
  currency: string;
  inStock: boolean | null;
  /** Null for the scheduled price check: no install is involved. */
  installHash: string | null;
  source?: "user_report" | "scrape";
  now: string;
}

export interface ScrapeTarget {
  variantId: number;
  siteId: string;
  sku: string;
}

export interface LastPrice {
  price: number | null;
  inStock: boolean | null;
}

export interface NotifyContextRow {
  settings: UserSettings;
  prefs: PrefsByKind;
  channels: ChannelRow[];
  messagesToday: number;
}

export interface ExtensionNotification {
  id: number;
  title: string;
  text: string;
  url: string | null;
}

export interface AdminStats {
  perSite: { siteId: string; views: number; failed: number }[];
  failedNotifications: number;
  newReports: number;
  newWaveFlags: number;
  /** Pages the scheduled price check was refused on in its last run. */
  scrapeBlocked?: number;
}

export interface Store {
  getSettings(): Promise<Settings>;
  getSite(id: string): Promise<SiteRow | null>;
  getProfile(userId: string): Promise<ProfileRow | null>;
  acceptTerms(userId: string, version: string, now: string): Promise<void>;
  getRequiredQuestionKeys(productType: string): Promise<string[]>;

  upsertProduct(input: { siteId: string; parentSku: string; name: string | null; brand: string | null; imageUrl: string | null; url: string | null; productType: string; now: string }): Promise<ProductRow>;
  findProduct(siteId: string, parentSku: string): Promise<ProductRow | null>;
  upsertVariant(productId: number, sku: string, attributes: Record<string, string>): Promise<number>;

  findReview(userId: string, productId: number): Promise<ReviewRow | null>;
  getReview(id: number): Promise<ReviewRow | null>;
  countReviewsByUserSince(userId: string, sinceIso: string): Promise<number>;
  listReviewTimesOnProduct(productId: number, sinceIso: string): Promise<string[]>;
  findDeliveredOrderItem(userId: string, productId: number, today: string): Promise<OrderItemMatch | null>;
  saveReview(input: SaveReviewInput): Promise<{ id: number; created: boolean }>;
  addFlag(reviewId: number, reason: "written_before_delivery" | "review_wave"): Promise<void>;
  clearPending(userId: string, productId: number): Promise<void>;
  recomputeStats(userId: string): Promise<void>;
  setReviewStatus(reviewId: number, status: ReviewStatus, reason: string | null): Promise<void>;
  setReviewRating(reviewId: number, rating: number): Promise<void>;

  countUpdates(reviewId: number): Promise<number>;
  insertReviewUpdate(input: { reviewId: number; body: string; rating: number | null }): Promise<number>;

  findReport(reviewId: number, reporterId: string): Promise<ReportRow | null>;
  countReportsByUserSince(userId: string, sinceIso: string): Promise<number>;
  insertReport(input: { reviewId: number; reporterId: string; reason: ReportReason; details: string | null }): Promise<number>;
  listReportsForDecision(reviewId: number): Promise<ReportForDecision[]>;
  getReportRow(id: number): Promise<ReportRow | null>;
  decideReport(id: number, decision: "upheld" | "dismissed", by: string, note: string | null, now: string): Promise<void>;

  findAppeal(reviewId: number): Promise<AppealRow | null>;
  getAppeal(id: number): Promise<AppealRow | null>;
  insertAppeal(input: { reviewId: number; userId: string; body: string }): Promise<number>;
  decideAppeal(id: number, decision: "accepted" | "rejected", by: string, now: string): Promise<void>;

  insertTakedown(input: { reviewId: number | null; name: string; email: string; reason: string }): Promise<number>;
  getTakedown(id: number): Promise<TakedownRow | null>;
  decideTakedown(id: number, decision: "upheld" | "dismissed", by: string, now: string): Promise<void>;

  queueNotification(n: Notification): Promise<void>;
  insertEvent(e: EventRow): Promise<void>;

  findOrderOwner(siteId: string, orderHash: string): Promise<string | null>;
  insertOrder(order: OrderToStore): Promise<{ orderId: number; itemIds: number[] }>;
  addPending(input: { userId: string; orderItemId: number; productId: number; dueAt: string }): Promise<void>;
  upgradeReviewsFromOrder(input: { userId: string; productId: number; orderItemId: number; orderedAt: string | null; deliveredAt: string | null }): Promise<number>;

  setRole(userId: string, role: Role): Promise<void>;
  setBlocked(userId: string, blockedAt: string | null): Promise<void>;
  writeAudit(input: { actorId: string; action: string; targetType: string; targetId: string; details: Record<string, unknown> }): Promise<void>;

  exportUser(userId: string): Promise<Record<string, unknown>>;
  deleteUser(userId: string): Promise<void>;

  // ---- phase 2: price reports
  findVariant(productId: number, sku: string): Promise<number | null>;
  countPriceEventsByInstallSince(installHash: string, sinceIso: string): Promise<number>;
  lastPrice(variantId: number): Promise<LastPrice | null>;
  recentPrices(variantId: number, limit: number): Promise<number[]>;
  countOutlierConfirmations(variantId: number, price: number, sinceIso: string, excludeInstallHash: string): Promise<number>;
  addOutlierCandidate(input: { variantId: number; price: number; inStock: boolean | null; installHash: string; now: string }): Promise<void>;
  clearOutlierCandidates(variantId: number, price: number): Promise<void>;
  insertPriceEvent(input: PriceEventInput): Promise<void>;
  /** Variants of watched products that have no price observation newer than `olderThanIso`, oldest first. */
  listScrapeTargets(olderThanIso: string, limit: number): Promise<ScrapeTarget[]>;

  // ---- phase 2: notifications
  enqueueReminders(now: string): Promise<void>;
  listUsersWithQueued(limit: number): Promise<string[]>;
  listQueuedForUser(userId: string): Promise<QueuedItem[]>;
  getNotifyContext(userId: string, dayStartIso: string): Promise<NotifyContextRow>;
  markQueue(ids: number[], status: "sent" | "skipped" | "failed"): Promise<void>;
  logNotification(input: { userId: string; channel: ChannelName; kind: NotificationKind | "digest"; payload: Record<string, unknown>; status: "sent" | "failed"; error: string | null; now: string }): Promise<void>;
  listExtensionPending(userId: string, limit: number): Promise<ExtensionNotification[]>;
  ackExtension(userId: string, ids: number[], now: string): Promise<void>;

  // ---- phase 2: channels
  createTelegramToken(userId: string): Promise<string>;
  consumeTelegramToken(token: string, now: string): Promise<string | null>;
  upsertChannel(input: { userId: string; channel: ChannelName; address: string | null; verified: boolean; enabled: boolean }): Promise<void>;
  disableChannelByAddress(channel: ChannelName, address: string): Promise<number>;

  // ---- phase 2: admin alerts
  getPrivateSetting(key: string): Promise<Record<string, unknown> | null>;
  setPrivateSetting(key: string, value: Record<string, unknown>): Promise<void>;
  adminStats(sinceIso: string): Promise<AdminStats>;
}
