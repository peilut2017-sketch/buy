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
import type { ChannelName, ChannelRow, PrefsByKind, QueuedItem } from "./notify.ts";
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
  const prices = byKey.get("price_reports") ?? {};
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
    priceReports: {
      perInstallPerDay: prices.per_install_per_day ?? d.priceReports.perInstallPerDay,
      outlierRatio: prices.outlier_ratio ?? d.priceReports.outlierRatio,
      confirmations: prices.confirmations ?? d.priceReports.confirmations,
      windowHours: prices.window_hours ?? d.priceReports.windowHours,
      historyDays: prices.history_days ?? d.priceReports.historyDays,
    },
  };
}

export function createStore(sql: Sql, options: StoreOptions): Store {
  return {
    async getSettings() {
      return mergeSettings(await sql`select key, value from public.settings`);
    },

    async getSite(id): Promise<SiteRow | null> {
      const [r] = await sql`select id, status, adapter_config, domains from public.sites where id = ${id}`;
      return r ? { id: r.id, status: r.status, adapterConfig: r.adapter_config ?? {}, domains: r.domains ?? [] } : null;
    },

    async getProfile(userId): Promise<ProfileRow | null> {
      const [r] = await sql`select id, display_name, role, blocked_at, order_check_consent, terms_version from public.profiles where id = ${userId}`;
      return r
        ? { id: r.id, displayName: r.display_name, role: r.role, blockedAt: r.blocked_at ? iso(r.blocked_at) : null, orderCheckConsent: r.order_check_consent, termsVersion: r.terms_version }
        : null;
    },

    async acceptTerms(userId, version, now) {
      await sql`update public.profiles set terms_accepted_at = ${now}, terms_version = ${version} where id = ${userId}`;
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

    // ---- phase 2: price reports
    async findVariant(productId, sku) {
      const [r] = await sql`select id from public.variants where product_id = ${productId} and sku = ${sku}`;
      return r ? Number(r.id) : null;
    },

    async countPriceEventsByInstallSince(installHash, sinceIso) {
      const [r] = await sql`select count(*)::int as n from public.price_events where install_hash = ${installHash} and observed_at >= ${sinceIso}`;
      return r!.n;
    },

    async lastPrice(variantId) {
      const [r] = await sql`select price, in_stock from public.price_events where variant_id = ${variantId} order by id desc limit 1`;
      return r ? { price: r.price === null ? null : Number(r.price), inStock: r.in_stock } : null;
    },

    async recentPrices(variantId, limit) {
      const rows = await sql`select price from public.price_events where variant_id = ${variantId} and price is not null order by id desc limit ${limit}`;
      return rows.map((r) => Number(r.price));
    },

    async countOutlierConfirmations(variantId, price, sinceIso, excludeInstallHash) {
      const [r] = await sql`
        select count(distinct install_hash)::int as n from public.price_outlier_candidates
        where variant_id = ${variantId} and price = ${price} and observed_at >= ${sinceIso} and install_hash <> ${excludeInstallHash}`;
      return r!.n;
    },

    async addOutlierCandidate(i) {
      await sql`insert into public.price_outlier_candidates (variant_id, price, in_stock, install_hash, observed_at) values (${i.variantId}, ${i.price}, ${i.inStock}, ${i.installHash}, ${i.now}) on conflict do nothing`;
    },

    async clearOutlierCandidates(variantId, price) {
      await sql`delete from public.price_outlier_candidates where variant_id = ${variantId} and price = ${price}`;
    },

    async insertPriceEvent(i) {
      await sql`insert into public.price_events (variant_id, price, currency, in_stock, observed_at, source, install_hash) values (${i.variantId}, ${i.price}, ${i.currency}, ${i.inStock}, ${i.now}, ${i.source ?? 'user_report'}, ${i.installHash})`;
    },

    async listScrapeTargets(olderThanIso, limit) {
      const rows = await sql`
        select v.id as variant_id, v.sku, p.site_id
        from public.variants v
        join public.products p on p.id = v.product_id
        join public.sites s on s.id = p.site_id and s.status <> 'paused'
        where exists (select 1 from public.watches w where w.active and w.product_id = p.id and (w.variant_id is null or w.variant_id = v.id))
          and coalesce((select max(e.observed_at) from public.price_events e where e.variant_id = v.id), 'epoch'::timestamptz) < ${olderThanIso}::timestamptz
        order by v.id
        limit ${limit}`;
      return rows.map((r) => ({ variantId: Number(r.variant_id), siteId: r.site_id as string, sku: r.sku as string }));
    },

    // ---- phase 2: notifications
    async enqueueReminders(now) {
      await sql`select public.enqueue_reminders(${now}::timestamptz)`;
    },

    async listUsersWithQueued(limit) {
      const rows = await sql`select user_id from public.notification_queue where status = 'queued' group by user_id order by min(created_at) limit ${limit}`;
      return rows.map((r) => r.user_id as string);
    },

    async listQueuedForUser(userId): Promise<QueuedItem[]> {
      const rows = await sql`select id, kind, payload, created_at from public.notification_queue where user_id = ${userId} and status = 'queued' order by id`;
      return rows.map((r) => ({ id: Number(r.id), kind: r.kind, payload: r.payload, createdAt: iso(r.created_at) }));
    },

    async getNotifyContext(userId, dayStartIso) {
      const [p] = await sql`select quiet_mode, quiet_hours, shabbat_mode, shabbat_city, daily_notification_cap from public.profiles where id = ${userId}`;
      const prefRows = await sql`select kind, channels, enabled from public.notification_prefs where user_id = ${userId}`;
      const channelRows = await sql`select channel, enabled, verified, address from public.notification_channels where user_id = ${userId}`;
      const [sent] = await sql`
        select count(distinct payload ->> 'batchId')::int as n from public.notification_log
        where user_id = ${userId} and status = 'sent' and sent_at >= ${dayStartIso}`;
      const prefs: PrefsByKind = {};
      for (const r of prefRows) prefs[r.kind] = { enabled: r.enabled, channels: r.channels as ChannelName[] };
      const channels: ChannelRow[] = channelRows.map((r) => ({ channel: r.channel, enabled: r.enabled, verified: r.verified, address: r.address }));
      return {
        settings: {
          quietMode: p?.quiet_mode ?? false,
          quietHours: p?.quiet_hours ?? null,
          shabbatMode: p?.shabbat_mode ?? false,
          shabbatCity: p?.shabbat_city ?? null,
          dailyCap: p?.daily_notification_cap ?? 3,
        },
        prefs,
        channels,
        messagesToday: sent!.n,
      };
    },

    async markQueue(ids, status) {
      if (ids.length === 0) return;
      await sql`update public.notification_queue set status = ${status} where id = any(${ids}::bigint[])`;
    },

    async logNotification(i) {
      await sql`insert into public.notification_log (user_id, channel, kind, payload, status, error, sent_at) values (${i.userId}, ${i.channel}, ${i.kind}, ${sql.json(i.payload)}, ${i.status}, ${i.error}, ${i.now})`;
    },

    async listExtensionPending(userId, limit) {
      const rows = await sql`
        select id, payload from public.notification_log
        where user_id = ${userId} and channel = 'extension' and status = 'sent' and extension_shown_at is null
        order by id limit ${limit}`;
      return rows.map((r) => ({ id: Number(r.id), title: String(r.payload.title ?? "SmartBuy"), text: String(r.payload.text ?? ""), url: typeof r.payload.url === "string" ? r.payload.url : null }));
    },

    async ackExtension(userId, ids, now) {
      if (ids.length === 0) return;
      await sql`update public.notification_log set extension_shown_at = ${now} where user_id = ${userId} and channel = 'extension' and id = any(${ids}::bigint[])`;
    },

    // ---- phase 2: channels
    async createTelegramToken(userId) {
      await sql`delete from public.telegram_link_tokens where user_id = ${userId}`;
      const [r] = await sql`insert into public.telegram_link_tokens (user_id) values (${userId}) returning token`;
      return r!.token as string;
    },

    async consumeTelegramToken(token, now) {
      const rows = await sql`delete from public.telegram_link_tokens where token = ${token} returning user_id, expires_at`;
      const r = rows[0];
      return r && new Date(r.expires_at).getTime() > Date.parse(now) ? (r.user_id as string) : null;
    },

    async upsertChannel(i) {
      await sql`
        insert into public.notification_channels (user_id, channel, address, verified, enabled) values (${i.userId}, ${i.channel}, ${i.address}, ${i.verified}, ${i.enabled})
        on conflict (user_id, channel) do update set address = excluded.address, verified = excluded.verified, enabled = excluded.enabled`;
    },

    async disableChannelByAddress(channel, address) {
      const rows = await sql`update public.notification_channels set enabled = false where channel = ${channel} and address = ${address} returning user_id`;
      return rows.length;
    },

    // ---- phase 2: admin alerts
    async getPrivateSetting(key) {
      const [r] = await sql`select value from public.settings where key = ${key}`;
      return r ? (r.value as Record<string, unknown>) : null;
    },

    async setPrivateSetting(key, value) {
      await sql`insert into public.settings (key, value, is_public) values (${key}, ${sql.json(value)}, false) on conflict (key) do update set value = excluded.value`;
    },

    async adminStats(sinceIso) {
      const perSite = await sql`
        select site_id, count(*) filter (where event = 'product_view')::int as views, count(*) filter (where event = 'detect_failed')::int as failed
        from public.events where occurred_at >= ${sinceIso} and site_id is not null group by site_id`;
      const [failed] = await sql`select count(*)::int as n from public.notification_log where status = 'failed' and sent_at >= ${sinceIso}`;
      const [reports] = await sql`select count(*)::int as n from public.reports where created_at >= ${sinceIso}`;
      const [waves] = await sql`select count(*)::int as n from public.review_flags where reason = 'review_wave' and created_at >= ${sinceIso}`;
      return {
        perSite: perSite.map((r) => ({ siteId: r.site_id, views: r.views, failed: r.failed })),
        failedNotifications: failed!.n,
        newReports: reports!.n,
        newWaveFlags: waves!.n,
      };
    },

    async deleteUser(userId) {
      await options.deleteAuthUser(userId);
    },
  };
}
