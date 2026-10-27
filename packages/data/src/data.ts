// Reads and writes for the panel and popup. Rows are mapped to the view types in @smartbuy/core.
// Nothing here invents data: a missing row is a missing row, and every write is confirmed by the server
// before the caller is told it succeeded (CLAUDE.md rule 8).

import type { ProductSummary, ReviewUpdateView, ReviewView, ReviewerLevel, VerificationState } from "@smartbuy/core";
import { ApiError, callFunction, rest } from "./rest.ts";

const SKU_SAFE = /^[a-z0-9_-]{1,40}$/i;

function safeSku(sku: string): string {
  if (!SKU_SAFE.test(sku)) throw new ApiError("invalid sku", 400);
  return sku;
}

/* ---------------------------------------------------------------- product summary */

interface SummaryRow {
  product_id: number;
  reviews_count: number | string;
  verified_count: number | string;
  rating_avg: number | string | null;
  fit_small: number | string;
  fit_exact: number | string;
  fit_large: number | string;
}

const num = (v: number | string | null | undefined): number => Number(v ?? 0);

export function toSummary(row: SummaryRow): ProductSummary {
  return {
    productId: row.product_id,
    reviewsCount: num(row.reviews_count),
    verifiedCount: num(row.verified_count),
    ratingAvg: row.rating_avg === null || row.rating_avg === undefined ? null : Number(row.rating_avg),
    fitSmall: num(row.fit_small),
    fitExact: num(row.fit_exact),
    fitLarge: num(row.fit_large),
  };
}

/** Null when the product has no row yet, which means nobody has reviewed it. */
export async function getSummary(siteId: string, parentSku: string, token?: string | null): Promise<ProductSummary | null> {
  const rows = await rest<SummaryRow[]>("product_summary", {
    params: { site_id: `eq.${siteId}`, parent_sku: `eq.${safeSku(parentSku)}`, select: "*", limit: 1 },
    token,
  });
  return rows[0] ? toSummary(rows[0]) : null;
}

/* ---------------------------------------------------------------- reviews */

interface ReviewRow {
  id: number;
  user_id: string;
  rating: number;
  title: string | null;
  body: string | null;
  answers: Record<string, unknown> | null;
  variant_values: Record<string, string> | null;
  verification: VerificationState;
  purchase_month: string | null;
  purchased_at: string | null;
  delivered_at: string | null;
  written_at: string;
  edited_at: string | null;
  helpful_count: number;
  status: "draft" | "visible" | "hidden" | "removed";
}

interface AuthorRow {
  user_id: string;
  display_name: string;
  level: ReviewerLevel;
  reviews_count: number;
  helpful_received: number;
}

interface UpdateRow {
  id: number;
  review_id: number;
  body: string;
  rating: number | null;
  created_at: string;
}

/** The signed-in user's own review of this product, in any state. Used to prefill the form. */
export interface MyReview {
  id: number;
  rating: number;
  title: string | null;
  body: string | null;
  answers: Record<string, unknown>;
  variantValues: Record<string, string>;
  purchaseMonth: string | null;
  verification: VerificationState;
  status: ReviewRow["status"];
}

export interface ReviewsResult {
  reviews: ReviewView[];
  mine: MyReview | null;
}

const REVIEW_COLUMNS =
  "id,user_id,rating,title,body,answers,variant_values,verification,purchase_month,purchased_at,delivered_at,written_at,edited_at,helpful_count,status";

export function toReviewViews(
  rows: ReviewRow[],
  authors: AuthorRow[],
  updates: UpdateRow[],
  votedIds: ReadonlySet<number>,
  userId: string | null,
): ReviewsResult {
  const authorById = new Map(authors.map((a) => [a.user_id, a]));
  const updatesByReview = new Map<number, ReviewUpdateView[]>();
  for (const u of updates) {
    const list = updatesByReview.get(u.review_id) ?? [];
    list.push({ id: u.id, body: u.body, rating: u.rating, createdAt: u.created_at });
    updatesByReview.set(u.review_id, list);
  }

  let mine: MyReview | null = null;
  const reviews: ReviewView[] = [];
  for (const r of rows) {
    const isMine = userId !== null && r.user_id === userId;
    if (isMine) {
      mine = {
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        answers: r.answers ?? {},
        variantValues: r.variant_values ?? {},
        purchaseMonth: r.purchase_month,
        verification: r.verification,
        status: r.status,
      };
    }
    const publicReview = r.status === "visible" && r.body !== null;
    // Only the author sees a hidden review, and a quick rating (no text) is never listed.
    if (r.body === null || !(publicReview || isMine)) continue;
    const a = authorById.get(r.user_id);
    reviews.push({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      answers: r.answers ?? {},
      variantValues: r.variant_values ?? {},
      verification: r.verification,
      purchaseMonth: r.purchase_month,
      purchasedAt: r.purchased_at,
      deliveredAt: r.delivered_at,
      writtenAt: r.written_at,
      editedAt: r.edited_at,
      helpfulCount: r.helpful_count,
      author: a ? { name: a.display_name, level: a.level, reviewsCount: a.reviews_count, helpfulReceived: a.helpful_received } : null,
      updates: updatesByReview.get(r.id) ?? [],
      mine: isMine,
      votedHelpful: votedIds.has(r.id),
      hidden: r.status !== "visible",
    });
  }
  return { reviews, mine };
}

export async function getReviews(productId: number, token: string | null, userId: string | null): Promise<ReviewsResult> {
  const rows = await rest<ReviewRow[]>("reviews", {
    params: { product_id: `eq.${productId}`, select: REVIEW_COLUMNS, order: "written_at.desc", limit: 200 },
    token,
  });
  if (rows.length === 0) return { reviews: [], mine: null };

  const reviewIds = rows.map((r) => r.id).join(",");
  const authorIds = [...new Set(rows.map((r) => r.user_id))].join(",");
  const [authors, updates, votes] = await Promise.all([
    rest<AuthorRow[]>("reviewer_public", { params: { user_id: `in.(${authorIds})`, select: "*" }, token }),
    rest<UpdateRow[]>("review_updates", { params: { review_id: `in.(${reviewIds})`, select: "*", order: "created_at.asc" }, token }),
    token ? rest<{ review_id: number }[]>("helpful_votes", { params: { review_id: `in.(${reviewIds})`, select: "review_id" }, token }) : Promise.resolve([]),
  ]);
  return toReviewViews(rows, authors, updates, new Set(votes.map((v) => v.review_id)), userId);
}

/* ---------------------------------------------------------------- questions */

export interface Question {
  key: string;
  label: string;
  kind: "choice" | "scale" | "boolean" | "size";
  options: { value: string; label: string }[] | { min: number; max: number } | null;
  required: boolean;
}

interface QuestionRow {
  question_key: string;
  label: string;
  kind: Question["kind"];
  options: Question["options"];
  required: boolean;
}

export async function getQuestions(productType: string): Promise<Question[]> {
  const rows = await rest<QuestionRow[]>("category_questions", {
    params: { product_type: `eq.${productType}`, select: "*", order: "sort.asc" },
  });
  return rows.map((r) => ({ key: r.question_key, label: r.label, kind: r.kind, options: r.options, required: r.required }));
}

/* ---------------------------------------------------------------- profile */

export interface Profile {
  displayName: string | null;
  quietMode: boolean;
  orderCheckConsent: boolean;
  showListingStars: boolean;
  /** The version of the terms of use this person accepted, or null. */
  termsVersion: string | null;
}

interface ProfileRow {
  display_name: string | null;
  quiet_mode: boolean;
  order_check_consent: boolean;
  show_listing_stars: boolean;
  terms_version: string | null;
}

export async function getProfile(token: string, userId: string): Promise<Profile | null> {
  const rows = await rest<ProfileRow[]>("profiles", {
    params: { id: `eq.${userId}`, select: "display_name,quiet_mode,order_check_consent,show_listing_stars,terms_version" },
    token,
  });
  const r = rows[0];
  return r ? { displayName: r.display_name, quietMode: r.quiet_mode, orderCheckConsent: r.order_check_consent, showListingStars: r.show_listing_stars, termsVersion: r.terms_version } : null;
}

export class NicknameTakenError extends Error {}

export async function setNickname(token: string, userId: string, name: string): Promise<string> {
  try {
    const rows = await rest<{ display_name: string }[]>("profiles", {
      method: "PATCH",
      params: { id: `eq.${userId}`, select: "display_name" },
      body: { display_name: name },
      token,
      prefer: "return=representation",
    });
    const saved = rows[0]?.display_name;
    if (!saved) throw new ApiError("not saved", 500);
    return saved;
  } catch (e) {
    if (e instanceof ApiError && (e.code === "23505" || e.status === 409)) throw new NicknameTakenError();
    throw e;
  }
}

export async function setProfileFlag(token: string, userId: string, patch: Partial<{ quiet_mode: boolean; order_check_consent: boolean; show_listing_stars: boolean }>): Promise<void> {
  const rows = await rest<unknown[]>("profiles", { method: "PATCH", params: { id: `eq.${userId}`, select: "id" }, body: patch, token, prefer: "return=representation" });
  if (rows.length !== 1) throw new ApiError("not saved", 500);
}

/* ---------------------------------------------------------------- actions */

export async function setHelpful(token: string, userId: string, reviewId: number, on: boolean): Promise<void> {
  if (on) {
    await rest("helpful_votes", { method: "POST", body: { review_id: reviewId, user_id: userId }, token, prefer: "return=minimal" });
    return;
  }
  const rows = await rest<unknown[]>("helpful_votes", {
    method: "DELETE",
    params: { review_id: `eq.${reviewId}`, user_id: `eq.${userId}`, select: "review_id" },
    token,
    prefer: "return=representation",
  });
  if (rows.length !== 1) throw new ApiError("not saved", 500);
}

export async function deleteReview(token: string, reviewId: number): Promise<void> {
  const rows = await rest<unknown[]>("reviews", {
    method: "DELETE",
    params: { id: `eq.${reviewId}`, select: "id" },
    token,
    prefer: "return=representation",
  });
  if (rows.length !== 1) throw new ApiError("not deleted", 500);
}

export interface SubmitReviewPayload {
  siteId: string;
  sku: string;
  parentSku: string;
  productType: string;
  detectionConfidence: "high" | "medium" | "low";
  source: "extension" | "web";
  product: { name: string | null; brand: string | null; imageUrl: string | null; url: string };
  variantValues: Record<string, string>;
  rating: number;
  title: string | null;
  body: string | null;
  answers: Record<string, unknown>;
  purchaseMonth: string | null;
}

export interface SubmitReviewResult {
  reviewId: number;
  verification: VerificationState;
  published: boolean;
}

export function submitReview(token: string, payload: SubmitReviewPayload): Promise<SubmitReviewResult> {
  return callFunction<SubmitReviewResult>("submit-review", payload, token);
}

export function addReviewUpdate(token: string, reviewId: number, body: string, rating: number | null): Promise<{ updateId: number }> {
  return callFunction<{ updateId: number }>("review-update", { reviewId, body, rating }, token);
}

export function reportReview(token: string, reviewId: number, reason: string, details: string | null): Promise<{ ok: true }> {
  return callFunction<{ ok: true }>("report-review", { reviewId, reason, details }, token);
}

/* ---------------------------------------------------------------- pending reviews (popup) */

export interface PendingReview {
  orderItemId: number;
  dueAt: string;
  product: { id: number; siteId: string; parentSku: string; name: string | null; imageUrl: string | null; url: string | null; productType: string | null };
  sku: string;
}

interface PendingRow {
  order_item_id: number;
  due_at: string;
  products: { id: number; site_id: string; parent_sku: string; name: string | null; image_url: string | null; url: string | null; product_type: string | null };
  order_items: { sku: string };
}

export async function getPendingReviews(token: string): Promise<PendingReview[]> {
  const rows = await rest<PendingRow[]>("pending_reviews", {
    params: {
      select: "order_item_id,due_at,products(id,site_id,parent_sku,name,image_url,url,product_type),order_items(sku)",
      dismissed: "eq.false",
      due_at: `lte.${new Date().toISOString()}`,
      order: "due_at.asc",
      limit: 20,
    },
    token,
  });
  return rows.map((r) => ({
    orderItemId: r.order_item_id,
    dueAt: r.due_at,
    product: { id: r.products.id, siteId: r.products.site_id, parentSku: r.products.parent_sku, name: r.products.name, imageUrl: r.products.image_url, url: r.products.url, productType: r.products.product_type },
    sku: r.order_items.sku,
  }));
}

export async function dismissPending(token: string, userId: string, orderItemId: number): Promise<void> {
  const rows = await rest<unknown[]>("pending_reviews", {
    method: "PATCH",
    params: { user_id: `eq.${userId}`, order_item_id: `eq.${orderItemId}`, select: "order_item_id" },
    body: { dismissed: true },
    token,
    prefer: "return=representation",
  });
  if (rows.length !== 1) throw new ApiError("not saved", 500);
}

/* ---------------------------------------------------------------- verification context and appeals */

/** True when the user has a delivered order containing this product, so a review can be written as verified. */
export async function hasDeliveredOrder(token: string, productId: number, today = new Date().toISOString().slice(0, 10)): Promise<boolean> {
  const rows = await rest<{ id: number; orders: { delivered_at: string | null } }[]>("order_items", {
    params: { product_id: `eq.${productId}`, select: "id,orders(delivered_at)", limit: 20 },
    token,
  });
  return rows.some((r) => r.orders.delivered_at !== null && r.orders.delivered_at <= today);
}

export function appealReview(token: string, reviewId: number, body: string): Promise<{ ok: true }> {
  return callFunction<{ ok: true }>("appeal-review", { reviewId, body }, token);
}


/* ---------------------------------------------------------------- listing stars */

export interface ListingSummary {
  parentSku: string;
  reviewsCount: number;
  ratingAvg: number;
}

const LISTING_MAX = 60;

/**
 * Rating and review count for many products at once, for the stars on category pages.
 * Anonymous on purpose: no token, so the request says which products were on screen but not who looked.
 * Products without public reviews are simply absent from the answer.
 */
export async function getListingSummaries(siteId: string, parentSkus: readonly string[]): Promise<ListingSummary[]> {
  const skus = [...new Set(parentSkus.filter((s) => /^[a-z0-9_-]{1,40}$/i.test(s)))].slice(0, LISTING_MAX);
  if (skus.length === 0) return [];
  const rows = await rest<{ parent_sku: string; reviews_count: number; rating_avg: number | string | null }[]>("product_summary", {
    params: { site_id: `eq.${siteId}`, parent_sku: `in.(${skus.join(",")})`, reviews_count: "gt.0", select: "parent_sku,reviews_count,rating_avg", limit: LISTING_MAX },
  });
  return rows.filter((r) => r.rating_avg !== null).map((r) => ({ parentSku: r.parent_sku, reviewsCount: Number(r.reviews_count), ratingAvg: Number(r.rating_avg) }));
}


/** Records that the person accepted this version of the terms. The server keeps the time and refuses an outdated version. */
export function acceptTerms(token: string, version: string): Promise<{ version: string }> {
  return callFunction<{ version: string }>("accept-terms", { version }, token);
}

/* ---------------------------------------------------------------- orders */

export interface OrderPayload {
  orderNumber: string;
  orderedAt: string | null;
  deliveredAt: string | null;
  items: { sku: string; name?: string; url?: string; imageUrl?: string }[];
}

export interface VerifyOrdersResult {
  accepted: number;
  alreadyKnown: number;
  conflicts: number;
  rejected: number;
  upgraded: number;
}

/** Sends orders the person's own browser read from the store's "my orders" page. The server stores a hash of the number, never the number. */
export function verifyOrders(token: string, siteId: string, orders: OrderPayload[]): Promise<VerifyOrdersResult> {
  return callFunction<VerifyOrdersResult>("verify-orders", { siteId, orders }, token);
}
