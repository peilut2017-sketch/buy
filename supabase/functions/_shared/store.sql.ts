// The Store on plain SQL. In the Edge Functions it runs on postgres.js over SUPABASE_DB_URL (a service-level
// connection, so RLS does not apply: every check below is explicit). Tests run it on a real PostgreSQL.
// The driver is injected so this file has no Deno-only imports.

import type { ReportForDecision, ReviewerLevel } from "./moderation.ts";
import type {
  AppealRow,
  EventRow,
  Notification,
  OrderItemMatch,
  OrderToStore,
  ProductRow,
  ProfileRow,
  ReportRow,
  ReviewRow,
  Role,
  SaveReviewInput,
  Settings,
  SiteRow,
  Store,
  TakedownRow,
} from "./store.ts";
import { DEFAULT_SETTINGS } from "./store.ts";
import type { ReportReason } from "./validation.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** The part of postgres.js this file uses. */
export interface Sql {
  (strings: TemplateStringsArray, ...values: unknown[]): PromiseLike<Row[]>;
  begin<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  json(value: unknown): unknown;
}

export interface StoreOptions {
  /** Deletes the sign-in account (GoTrue admin API). Profiles and everything tied to them cascade from it. */
  deleteAuthUser: (userId: string) => Promise<void>;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

function mapReview(r: Row): ReviewRow {
  return {
    id: Number(r.id),
    userId: r.user_id,
    productId: Number(r.product_id),
    rating: r.rating,
    body: r.body,
    status: r.status,
    verification: r.verification,
    writtenAt: iso(r.written_at),
  };
}

function mergeSettings(rows: Row[]): Settings {
  const byKey = new Map(rows.map((r) => [r.key as string, r.value as Row]));
  const d = DEFAULT_SETTINGS;
  const limits = byKey.get("review_limits") ?? {};
  const hide = byKey.get("auto_hide") ?? {};
  const abuse = byKey.get("reporter_abuse") ?? {};
  const wave = byKey.get("review_wave") ?? {};
  const notes = byKey.get("notifications") ?? {};
  const extra = byKey.get("moderation_limits") ?? {};
  return {
    reviewLimits: {
      perDay: limits.per_day ?? d.reviewLimits.perDay,
      minChars: limits.min_chars ?? d.reviewLimits.minChars,
      maxChars: limits.max_chars ?? d.reviewLimits.maxChars,
      countAfterHours: limits.count_after_hours ?? d.reviewLimits.countAfterHours,
    },
    autoHide: {
      reports: hide.reports ?? d.autoHide.reports,
      minReporterLevel: (hide.min_reporter_level ?? d.autoHide.minReporterLevel) as ReviewerLevel,
      instantReasons: (hide.instant_reasons ?? d.autoHide.instantReasons) as ReportReason[],
    },
    reporterAbuse: { dismissedRatio: abuse.dismissed_ratio ?? d.reporterAbuse.dismissedRatio, minReports: abuse.min_reports ?? d.reporterAbuse.minReports },
    reviewWave: { threshold: wave.threshold ?? d.reviewWave.threshold, windowHours: wave.window_hours ?? d.reviewWave.windowHours },
    notifications: { pendingAfterDeliveryDays: notes.pending_after_delivery_days ?? d.notifications.pendingAfterDeliveryDays },
    reportsPerDay: extra.reports_per_day ?? d.reportsPerDay,
    updatesPerReview: extra.updates_per_review ?? d.updatesPerReview,
  };
}

export function createStore(sql: Sql, options: StoreOptions): Store {
  return {
    async getSettings() {
      return mergeSettings(await sql`select key, value from public.settings`);
    },

    async getSite(id): Promise<SiteRow | null> {
      const [r] = await sql`select id, status, adapter_config from public.sites where id = ${id}`;
      return r ? { id: r.id, status: r.status, adapterConfig: r.adapter_config ?? {} } : null;
    },

    async getProfile(userId): Promise<ProfileRow | null> {
      const [r] = await sql`select id, display_name, role, blocked_at, order_check_consent from public.profiles where id = ${userId}`;
      return r
        ? { id: r.id, displayName: r.display_name, role: r.role, blockedAt: r.blocked_at ? iso(r.blocked_at) : null, orderCheckConsent: r.order_check_consent }
        : null;
    },

    async getRequiredQuestionKeys(productType) {
      const rows = await sql`select question_key from public.category_questions where product_type = ${productType} and required`;
      return rows.map((r) => r.question_key as string);
    },

    async upsertProduct(i): Promise<ProductRow> {
      // Names and pictures come from the client, so they only fill an empty field and never overwrite what is there.
      const [r] = await sql`
        insert into public.products (site_id, parent_sku, name, brand, image_url, url, product_type, first_seen_at, last_seen_at)
        values (${i.siteId}, ${i.parentSku}, ${i.name}, ${i.brand}, ${i.imageUrl}, ${i.url}, ${i.productType}, ${i.now}, ${i.now})
        on conflict (site_id, parent_sku) do update set
          name = coalesce(products.name, excluded.name),
          brand = coalesce(products.brand, excluded.brand),
          image_url = coalesce(products.image_url, excluded.image_url),
          url = coalesce(products.url, excluded.url),
          product_type = coalesce(products.product_type, excluded.product_type),
          last_seen_at = excluded.last_seen_at
        returning id, site_id, parent_sku`;
      return { id: Number(r!.id), siteId: r!.site_id, parentSku: r!.parent_sku };
    },

    async findProduct(siteId, parentSku) {
      const [r] = await sql`select id, site_id, parent_sku from public.products where site_id = ${siteId} and parent_sku = ${parentSku}`;
      return r ? { id: Number(r.id), siteId: r.site_id, parentSku: r.parent_sku } : null;
    },

    async upsertVariant(productId, sku, attributes) {
      const [r] = await sql`
        insert into public.variants (product_id, sku, attributes) values (${productId}, ${sku}, ${sql.json(attributes)})
        on conflict (product_id, sku) do update set
          attributes = case when variants.attributes = '{}'::jsonb then excluded.attributes else variants.attributes end
        returning id`;
      return Number(r!.id);
    },

    async findReview(userId, productId) {
      const [r] = await sql`select id, user_id, product_id, rating, body, status, verification, written_at from public.reviews where user_id = ${userId} and product_id = ${productId}`;
      return r ? mapReview(r) : null;
    },

    async getReview(id) {
      const [r] = await sql`select id, user_id, product_id, rating, body, status, verification, written_at from public.reviews where id = ${id}`;
      return r ? mapReview(r) : null;
    },

    async countReviewsByUserSince(userId, sinceIso) {
      const [r] = await sql`select count(*)::int as n from public.reviews where user_id = ${userId} and written_at >= ${sinceIso}`;
      return r!.n;
    },

    async listReviewTimesOnProduct(productId, sinceIso) {
      const rows = await sql`select written_at from public.reviews where product_id = ${productId} and written_at >= ${sinceIso}`;
      return rows.map((r) => iso(r.written_at));
    },

    async findDeliveredOrderItem(userId, productId, today): Promise<OrderItemMatch | null> {
      const [r] = await sql`
        select oi.id, o.ordered_at::text as ordered_at, o.delivered_at::text as delivered_at
        from public.order_items oi join public.orders o on o.id = oi.order_id
        where o.user_id = ${userId} and oi.product_id = ${productId} and o.delivered_at is not null and o.delivered_at <= ${today}::date
        order by o.delivered_at desc limit 1`;
      return r ? { orderItemId: Number(r.id), orderedAt: r.ordered_at, deliveredAt: r.delivered_at } : null;
    },

    async saveReview(i: SaveReviewInput) {
      if (i.existingId === null) {
        const [r] = await sql`
          insert into public.reviews (user_id, product_id, variant_id, variant_values, rating, title, body, answers, verification, order_item_id,
                                      purchase_month, purchased_at, delivered_at, detection_confidence, written_at)
          values (${i.userId}, ${i.productId}, ${i.variantId}, ${sql.json(i.variantValues)}, ${i.rating}, ${i.title}, ${i.body}, ${sql.json(i.answers)},
                  ${i.verification}, ${i.orderItemId}, ${i.purchaseMonth}::date, ${i.purchasedAt}::date, ${i.deliveredAt}::date, ${i.detectionConfidence}, ${i.now})
          returning id`;
        return { id: Number(r!.id), created: true };
      }
      await sql`
        update public.reviews set variant_id = ${i.variantId}, variant_values = ${sql.json(i.variantValues)}, rating = ${i.rating}, title = ${i.title},
          body = ${i.body}, answers = ${sql.json(i.answers)}, verification = ${i.verification}, order_item_id = ${i.orderItemId},
          purchase_month = ${i.purchaseMonth}::date, purchased_at = ${i.purchasedAt}::date, delivered_at = ${i.deliveredAt}::date,
          detection_confidence = ${i.detectionConfidence}, edited_at = ${i.now}
        where id = ${i.existingId} and user_id = ${i.userId}`;
      return { id: i.existingId, created: false };
    },

    async addFlag(reviewId, reason) {
      await sql`insert into public.review_flags (review_id, reason) values (${reviewId}, ${reason}) on conflict (review_id, reason) do nothing`;
    },

    async clearPending(userId, productId) {
      await sql`delete from public.pending_reviews where user_id = ${userId} and product_id = ${productId}`;
    },

    async recomputeStats(userId) {
      await sql`select public.recompute_reviewer_stats(${userId}::uuid)`;
    },

    async setReviewStatus(reviewId, status, reason) {
      await sql`update public.reviews set status = ${status}, status_reason = ${reason} where id = ${reviewId}`;
    },

    async setReviewRating(reviewId, rating) {
      await sql`update public.reviews set rating = ${rating} where id = ${reviewId}`;
    },

    async countUpdates(reviewId) {
      const [r] = await sql`select count(*)::int as n from public.review_updates where review_id = ${reviewId}`;
      return r!.n;
    },

    async insertReviewUpdate(i) {
      const [r] = await sql`insert into public.review_updates (review_id, body, rating) values (${i.reviewId}, ${i.body}, ${i.rating}) returning id`;
      return Number(r!.id);
    },

    async findReport(reviewId, reporterId): Promise<ReportRow | null> {
      const [r] = await sql`select id, review_id, reporter_id, reason, status from public.reports where review_id = ${reviewId} and reporter_id = ${reporterId}`;
      return r ? { id: Number(r.id), reviewId: Number(r.review_id), reporterId: r.reporter_id, reason: r.reason, status: r.status } : null;
    },

    async countReportsByUserSince(userId, sinceIso) {
      const [r] = await sql`select count(*)::int as n from public.reports where reporter_id = ${userId} and created_at >= ${sinceIso}`;
      return r!.n;
    },

    async insertReport(i) {
      const [r] = await sql`insert into public.reports (review_id, reporter_id, reason, details) values (${i.reviewId}, ${i.reporterId}, ${i.reason}, ${i.details}) returning id`;
      return Number(r!.id);
    },

    async listReportsForDecision(reviewId): Promise<ReportForDecision[]> {
      const rows = await sql`
        select r.reporter_id, r.reason, coalesce(s.level, 'new') as level,
               coalesce(s.reports_filed, 0) as filed, coalesce(s.reports_dismissed, 0) as dismissed
        from public.reports r left join public.reviewer_stats s on s.user_id = r.reporter_id
        where r.review_id = ${reviewId} and r.reporter_id is not null and r.status <> 'dismissed'`;
      return rows.map((r) => ({
        reporterId: r.reporter_id,
        reason: r.reason,
        reporterLevel: r.level,
        reporterReportsFiled: r.filed,
        reporterReportsDismissed: r.dismissed,
      }));
    },

    async getReportRow(id) {
      const [r] = await sql`select id, review_id, reporter_id, reason, status from public.reports where id = ${id}`;
      return r ? { id: Number(r.id), reviewId: Number(r.review_id), reporterId: r.reporter_id, reason: r.reason, status: r.status } : null;
    },

    async decideReport(id, decision, by, note, now) {
      await sql`update public.reports set status = ${decision}, decided_by = ${by}, decision_note = ${note}, decided_at = ${now} where id = ${id}`;
    },

    async findAppeal(reviewId): Promise<AppealRow | null> {
      const [r] = await sql`select id, review_id, user_id, status from public.appeals where review_id = ${reviewId}`;
      return r ? { id: Number(r.id), reviewId: Number(r.review_id), userId: r.user_id, status: r.status } : null;
    },

    async getAppeal(id) {
      const [r] = await sql`select id, review_id, user_id, status from public.appeals where id = ${id}`;
      return r ? { id: Number(r.id), reviewId: Number(r.review_id), userId: r.user_id, status: r.status } : null;
    },

    async insertAppeal(i) {
      const [r] = await sql`insert into public.appeals (review_id, user_id, body) values (${i.reviewId}, ${i.userId}, ${i.body}) returning id`;
      return Number(r!.id);
    },

    async decideAppeal(id, decision, by, now) {
      await sql`update public.appeals set status = ${decision}, decided_by = ${by}, decided_at = ${now} where id = ${id}`;
    },

    async insertTakedown(i) {
      const [r] = await sql`insert into public.takedown_requests (review_id, requester_name, requester_email, reason) values (${i.reviewId}, ${i.name}, ${i.email}, ${i.reason}) returning id`;
      return Number(r!.id);
    },

    async getTakedown(id): Promise<TakedownRow | null> {
      const [r] = await sql`select id, review_id, status from public.takedown_requests where id = ${id}`;
      return r ? { id: Number(r.id), reviewId: r.review_id === null ? null : Number(r.review_id), status: r.status } : null;
    },

    async decideTakedown(id, decision, by, now) {
      await sql`update public.takedown_requests set status = ${decision}, decided_by = ${by}, decided_at = ${now} where id = ${id}`;
    },

    async queueNotification(n: Notification) {
      await sql`insert into public.notification_queue (user_id, kind, payload, dedupe_key) values (${n.userId}, ${n.kind}, ${sql.json(n.payload)}, ${n.dedupeKey}) on conflict (user_id, dedupe_key) do nothing`;
    },

    async insertEvent(e: EventRow) {
      await sql`insert into public.events (event, platform, site_id, product_id, user_id, install_id, props) values (${e.event}, ${e.platform}, ${e.siteId}, ${e.productId}, ${e.userId}, ${e.installId}, ${sql.json(e.props)})`;
    },

    async findOrderOwner(siteId, orderHash) {
      const [r] = await sql`select user_id from public.orders where site_id = ${siteId} and order_hash = ${orderHash}`;
      return r ? (r.user_id as string) : null;
    },

    async insertOrder(o: OrderToStore) {
      return await sql.begin(async (tx) => {
        const [order] = await tx`
          insert into public.orders (user_id, site_id, order_hash, ordered_at, delivered_at, source)
          values (${o.userId}, ${o.siteId}, ${o.orderHash}, ${o.orderedAt}::date, ${o.deliveredAt}::date, ${o.source}) returning id`;
        const itemIds: number[] = [];
        for (const item of o.items) {
          const [row] = await tx`insert into public.order_items (order_id, product_id, variant_id, sku) values (${order!.id}, ${item.productId}, ${item.variantId}, ${item.sku}) returning id`;
          itemIds.push(Number(row!.id));
        }
        return { orderId: Number(order!.id), itemIds };
      });
    },

    async addPending(i) {
      await sql`insert into public.pending_reviews (user_id, order_item_id, product_id, due_at) values (${i.userId}, ${i.orderItemId}, ${i.productId}, ${i.dueAt}) on conflict do nothing`;
    },

    async upgradeReviewsFromOrder(i) {
      const rows = await sql`
        update public.reviews set verification = 'verified', order_item_id = ${i.orderItemId}, purchased_at = ${i.orderedAt}::date,
          delivered_at = ${i.deliveredAt}::date, purchase_month = null
        where user_id = ${i.userId} and product_id = ${i.productId} and verification <> 'verified' returning id`;
      return rows.length;
    },

    async setRole(userId, role: Role) {
      await sql`update public.profiles set role = ${role} where id = ${userId}`;
    },

    async setBlocked(userId, blockedAt) {
      await sql`update public.profiles set blocked_at = ${blockedAt} where id = ${userId}`;
    },

    async writeAudit(i) {
      await sql`insert into public.admin_audit_log (actor_id, action, target_type, target_id, details) values (${i.actorId}, ${i.action}, ${i.targetType}, ${i.targetId}, ${sql.json(i.details)})`;
    },

    async exportUser(userId) {
      const [profile] = await sql`
        select display_name, role, quiet_mode, quiet_hours, shabbat_mode, shabbat_city, daily_notification_cap, show_listing_stars, order_check_consent, created_at
        from public.profiles where id = ${userId}`;
      const reviews = await sql`
        select r.id, p.site_id, p.parent_sku, r.rating, r.title, r.body, r.answers, r.variant_values, r.verification, r.purchase_month::text, r.purchased_at::text,
               r.delivered_at::text, r.written_at, r.edited_at, r.status, r.helpful_count
        from public.reviews r join public.products p on p.id = r.product_id where r.user_id = ${userId} order by r.written_at`;
      const updates = await sql`select u.review_id, u.body, u.rating, u.created_at from public.review_updates u join public.reviews r on r.id = u.review_id where r.user_id = ${userId} order by u.created_at`;
      const votes = await sql`select review_id, created_at from public.helpful_votes where user_id = ${userId}`;
      const sizes = await sql`select garment_type, brand, size from public.size_profiles where user_id = ${userId}`;
      const watches = await sql`select product_id, variant_id, target_price, drop_percent, notify_restock, active, created_at from public.watches where user_id = ${userId}`;
      const channels = await sql`select channel, enabled, verified from public.notification_channels where user_id = ${userId}`;
      const prefs = await sql`select kind, channels, enabled from public.notification_prefs where user_id = ${userId}`;
      const reports = await sql`select review_id, reason, details, status, created_at from public.reports where reporter_id = ${userId}`;
      const appeals = await sql`select review_id, body, status, created_at from public.appeals where user_id = ${userId}`;
      const orders = await sql`
        select o.site_id, o.ordered_at::text, o.delivered_at::text, o.source, o.created_at,
               coalesce((select json_agg(oi.sku) from public.order_items oi where oi.order_id = o.id), '[]'::json) as skus
        from public.orders o where o.user_id = ${userId} order by o.created_at`;
      const pending = await sql`select product_id, due_at, dismissed from public.pending_reviews where user_id = ${userId}`;
      return {
        exportedAt: new Date().toISOString(),
        note: "מספרי הזמנה לא נשמרים אצלנו, רק גיבוב שלהם, ולכן הם לא מופיעים כאן.",
        profile: profile ?? null,
        reviews, reviewUpdates: updates, helpfulVotes: votes, sizeProfiles: sizes, watches,
        notificationChannels: channels, notificationPrefs: prefs, reportsFiled: reports, appeals, orders, pendingReviews: pending,
      };
    },

    async deleteUser(userId) {
      await options.deleteAuthUser(userId);
    },
  };
}
