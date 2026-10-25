// Integration tests of the Edge Function handlers against a real PostgreSQL with the real migration.
// Skipped unless SB_TEST_DB_URL is set (see testing/db.ts). Run: SB_TEST_DB_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm test
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appealReview } from "./handlers/appealReview.ts";
import { deleteMyAccount, exportMyData } from "./handlers/account.ts";
import { events } from "./handlers/events.ts";
import { moderate } from "./handlers/moderate.ts";
import { reportReview } from "./handlers/reportReview.ts";
import { reviewUpdate } from "./handlers/reviewUpdate.ts";
import { submitReview } from "./handlers/submitReview.ts";
import { takedownRequest } from "./handlers/takedown.ts";
import { verifyOrders } from "./handlers/verifyOrders.ts";
import { createTestDb, TEST_DB_URL, type TestDb } from "./testing/db.ts";
import { ctxFor, deleted, NOW, REVIEW_TEXT, reviewBody, seed, USERS } from "./testing/fixtures.ts";

describe.skipIf(!TEST_DB_URL)("Edge Function handlers on PostgreSQL", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await seed(db);
  });
  afterAll(async () => {
    await db?.drop();
  });
  beforeEach(async () => {
    await db.raw`truncate public.products, public.orders, public.events, public.reports, public.appeals, public.notification_queue,
                         public.admin_audit_log, public.takedown_requests restart identity cascade`;
    await db.raw`update public.profiles set blocked_at = null, order_check_consent = false`;
    await db.raw`update public.sites set status = 'beta' where id = 'terminalx'`;
    await db.raw`update public.settings set value = jsonb_set(value, '{count_after_hours}', '0') where key = 'review_limits'`;
  });

  const submit = (who: Parameters<typeof ctxFor>[1], body: unknown) => submitReview(ctxFor(db, who), body);
  const reviewIdOf = (res: { body: unknown }) => (res.body as { reviewId: number }).reviewId;

  describe("submit-review", () => {
    it("needs a signed-in, unblocked user with a nickname", async () => {
      expect((await submit(null, reviewBody())).status).toBe(401);
      await db.raw`update public.profiles set blocked_at = now() where id = ${USERS.alice}`;
      expect((await submit("alice", reviewBody())).status).toBe(403);
      await db.raw`update public.profiles set blocked_at = null, display_name = null where id = ${USERS.alice}`;
      const noName = await submit("alice", reviewBody());
      expect(noName).toMatchObject({ status: 403, body: { message: "בחרו כינוי לפני כתיבת ביקורת." } });
      await db.raw`update public.profiles set display_name = 'nick_alice' where id = ${USERS.alice}`;
    });

    it("stores a review, creates the product and variant, and records an event", async () => {
      const res = await submit("alice", reviewBody());
      expect(res).toMatchObject({ status: 200, body: { verification: "unverified", published: true } });
      const [review] = await db.raw`select * from public.reviews`;
      expect(review).toMatchObject({ user_id: USERS.alice, rating: 4, status: "visible", verification: "unverified", detection_confidence: "high" });
      expect(review!.purchase_month.toISOString().slice(0, 10)).toBe("2026-09-01");
      expect(review!.variant_values).toEqual({ מידה: "M" });
      const [product] = await db.raw`select * from public.products`;
      expect(product).toMatchObject({ site_id: "terminalx", parent_sku: "w81726", product_type: "apparel", name: "מכנסי בדיקה" });
      expect((await db.raw`select sku, attributes from public.variants`)[0]).toMatchObject({ sku: "w817260002", attributes: { מידה: "M" } });
      expect((await db.raw`select event, user_id from public.events`)[0]).toMatchObject({ event: "review_submitted", user_id: USERS.alice });
    });

    it("rejects invalid fields with a per-field Hebrew message and stores nothing", async () => {
      const res = await submit("alice", reviewBody("w817260002", { rating: 9, body: "קצר", answers: {}, purchaseMonth: null }));
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ errors: { rating: expect.any(String), body: expect.stringContaining("קצרה מדי"), fit: "בחרו איך המידה.", purchaseMonth: "בחרו את חודש הרכישה." } });
      expect(await db.raw`select 1 from public.reviews`).toHaveLength(0);
      expect(await db.raw`select 1 from public.products`).toHaveLength(0);
    });

    it("uses the site's product type, not the client's, to decide which answers are required", async () => {
      // The body claims "general" (no fit question); the site says apparel, so fit is required.
      const res = await submit("alice", reviewBody("w817260002", { answers: {} }));
      expect(res.body).toMatchObject({ errors: { fit: "בחרו איך המידה." } });
    });

    it("refuses to guess when the store has no rules yet", async () => {
      await db.raw`update public.sites set adapter_config = '{}'::jsonb where id = 'terminalx'`;
      expect((await submit("alice", reviewBody())).status).toBe(503);
      await db.raw`update public.sites set adapter_config = ${db.raw.json({ parentSku: { fromSku: "^(.{6})" }, productType: "apparel" })} where id = 'terminalx'`;
      expect((await submit("alice", reviewBody())).status).toBe(200);
    });

    it("refuses a SKU that does not belong to the parent model, an unknown store and a paused store", async () => {
      expect((await submit("alice", reviewBody("w817260002", { parentSku: "w99999" }))).status).toBe(400);
      expect((await submit("alice", reviewBody("w817260002", { siteId: "nowhere" }))).status).toBe(404);
      await db.raw`update public.sites set status = 'paused' where id = 'terminalx'`;
      expect((await submit("alice", reviewBody())).status).toBe(403);
    });

    it("edits the same review instead of creating a second one, and marks it edited", async () => {
      await submit("alice", reviewBody());
      const res = await submit("alice", reviewBody("w817260002", { rating: 2, title: "עודכן" }));
      expect(res.status).toBe(200);
      const rows = await db.raw`select rating, title, edited_at from public.reviews`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ rating: 2, title: "עודכן" });
      expect(rows[0]!.edited_at).not.toBeNull();
    });

    it("limits new reviews per day but not edits", async () => {
      // Each SKU gets its own parent model (the first six characters), so each is a new review.
      const sku = (i: number) => `w${i}1111${i}999`;
      for (let i = 0; i < 5; i++) expect((await submit("alice", reviewBody(sku(i)))).status).toBe(200);
      expect((await submit("alice", reviewBody(sku(7)))).status).toBe(429);
      expect((await submit("alice", reviewBody(sku(0), { rating: 5 }))).status).toBe(200);
      expect(await db.raw`select 1 from public.reviews`).toHaveLength(5);
    });

    it("never overwrites a product name set earlier (names come from clients)", async () => {
      await submit("alice", reviewBody());
      await submit("bob", reviewBody("w817260002", { product: { name: "שם מזויף", brand: null, imageUrl: "javascript:alert(1)", url: "not a url" } }));
      const [product] = await db.raw`select name, image_url from public.products`;
      expect(product).toMatchObject({ name: "מכנסי בדיקה", image_url: "https://media.example.test/a.jpg" });
    });

    it("drops addresses that are not web addresses", async () => {
      await submit("alice", reviewBody("w555550001", { product: { name: "x", brand: null, imageUrl: "javascript:alert(1)", url: "data:text/html,hi" } }));
      const [product] = await db.raw`select image_url, url from public.products where parent_sku = 'w55555'`;
      expect(product).toMatchObject({ image_url: null, url: null });
    });

    it("a rating alone is stored but not published, and cannot replace a written review", async () => {
      const quick = await submit("alice", reviewBody("w817260002", { body: null, answers: {}, purchaseMonth: null }));
      expect(quick).toMatchObject({ status: 200, body: { published: false } });
      const full = await submit("alice", reviewBody());
      expect(full).toMatchObject({ status: 200, body: { published: true } });
      expect(await db.raw`select 1 from public.reviews`).toHaveLength(1);
      const again = await submit("alice", reviewBody("w817260002", { body: null, answers: {}, purchaseMonth: null }));
      expect(again.status).toBe(409);
    });

    it("marks the review verified when a delivered order for the product exists, and ignores the claimed month", async () => {
      const verify = await verifyOrders(ctxFor(db, "alice"), { siteId: "terminalx", orders: [] });
      expect(verify.status).toBe(403); // no consent yet
      await db.raw`update public.profiles set order_check_consent = true where id = ${USERS.alice}`;
      const orders = [{ orderNumber: "TX-1001", orderedAt: "2026-10-01", deliveredAt: "2026-10-05", items: [{ sku: "w817260002" }] }];
      expect((await verifyOrders(ctxFor(db, "alice"), { siteId: "terminalx", orders })).body).toMatchObject({ accepted: 1 });
      const res = await submit("alice", reviewBody("w817260002", { purchaseMonth: null }));
      expect(res).toMatchObject({ status: 200, body: { verification: "verified" } });
      const [r] = await db.raw`select verification, order_item_id, purchased_at::text, delivered_at::text, purchase_month from public.reviews`;
      expect(r).toMatchObject({ verification: "verified", purchased_at: "2026-10-01", delivered_at: "2026-10-05", purchase_month: null });
      expect(r!.order_item_id).not.toBeNull();
    });

    it("flags a wave of reviews on one product and flags nothing before that", async () => {
      const names = ["alice", "bob", "carol", "dave", "erin", "mia"] as const;
      for (const [i, who] of names.entries()) {
        await submit(who, reviewBody());
        const flags = await db.raw`select reason from public.review_flags`;
        expect(flags).toHaveLength(i === 5 ? 1 : 0);
      }
      expect((await db.raw`select reason from public.review_flags`)[0]).toMatchObject({ reason: "review_wave" });
    });

    it("removes the product from the waiting list once a written review exists", async () => {
      await db.raw`update public.profiles set order_check_consent = true where id = ${USERS.alice}`;
      await verifyOrders(ctxFor(db, "alice"), { siteId: "terminalx", orders: [{ orderNumber: "TX-2002", orderedAt: "2026-09-01", deliveredAt: "2026-09-05", items: [{ sku: "w817260002" }] }] });
      expect(await db.raw`select 1 from public.pending_reviews`).toHaveLength(1);
      await submit("alice", reviewBody());
      expect(await db.raw`select 1 from public.pending_reviews`).toHaveLength(0);
    });
  });

  describe("verify-orders", () => {
    const order = (number: string, sku = "w817260002", over = {}) => ({ orderNumber: number, orderedAt: "2026-09-20", deliveredAt: "2026-09-25", items: [{ sku }], ...over });
    const send = (who: Parameters<typeof ctxFor>[1], orders: unknown[]) => verifyOrders(ctxFor(db, who), { siteId: "terminalx", orders });

    beforeEach(async () => {
      await db.raw`update public.profiles set order_check_consent = true where id in (${USERS.alice}, ${USERS.bob})`;
    });

    it("stores only a hash of the order number, never the number", async () => {
      expect((await send("alice", [order("TX-424242")])).body).toMatchObject({ accepted: 1, alreadyKnown: 0, conflicts: 0, rejected: 0 });
      const [o] = await db.raw`select order_hash from public.orders`;
      expect(o!.order_hash).toMatch(/^[0-9a-f]{64}$/);
      const everything = JSON.stringify(await db.raw`select * from public.orders`) + JSON.stringify(await db.raw`select * from public.order_items`);
      expect(everything).not.toContain("424242");
    });

    it("adds the product to the waiting list 14 days after delivery when there is no review", async () => {
      await send("alice", [order("TX-1")]);
      const [p] = await db.raw`select due_at, dismissed from public.pending_reviews where user_id = ${USERS.alice}`;
      expect(p!.due_at.toISOString()).toBe("2026-10-09T00:00:00.000Z");
      expect(p!.dismissed).toBe(false);
    });

    it("locks an order to the first account that claims it", async () => {
      await send("alice", [order("TX-777")]);
      expect((await send("alice", [order("tx-777")])).body).toMatchObject({ alreadyKnown: 1, accepted: 0 });
      expect((await send("bob", [order("TX-777")])).body).toMatchObject({ conflicts: 1, accepted: 0 });
      expect(await db.raw`select 1 from public.orders`).toHaveLength(1);
    });

    it("upgrades an existing unverified review to verified and removes nothing from it", async () => {
      await submit("alice", reviewBody());
      expect((await send("alice", [order("TX-9")])).body).toMatchObject({ accepted: 1, upgraded: 1 });
      const [r] = await db.raw`select verification, purchase_month, delivered_at::text from public.reviews`;
      expect(r).toMatchObject({ verification: "verified", purchase_month: null, delivered_at: "2026-09-25" });
      expect(await db.raw`select 1 from public.pending_reviews`).toHaveLength(0);
    });

    it("rejects malformed orders and refuses without consent", async () => {
      expect((await send("alice", [{ orderNumber: "x", orderedAt: "bad", deliveredAt: null, items: [] }, order("TX-5")])).body).toMatchObject({ rejected: 1, accepted: 1 });
      expect((await send("carol", [order("TX-6")])).status).toBe(403);
    });

    it("keeps a product that the store's rule cannot map as an order item without a product", async () => {
      await send("alice", [order("TX-8", "zz")]);
      expect(await db.raw`select 1 from public.order_items`).toHaveLength(0); // "zz" is not a valid SKU, so nothing is stored
    });
  });

  describe("report-review, appeal-review, review-update", () => {
    const report = (who: Parameters<typeof ctxFor>[1], reviewId: number, reason = "spam") => reportReview(ctxFor(db, who), { reviewId, reason });
    let reviewId = 0;

    async function levelUp(...who: (keyof typeof USERS)[]) {
      for (const w of who) await db.raw`update public.reviewer_stats set level = 'active' where user_id = ${USERS[w]}`;
    }

    beforeEach(async () => {
      reviewId = reviewIdOf(await submit("alice", reviewBody()));
    });

    it("needs a reason and a signed-in user, and does not allow reporting your own review or twice", async () => {
      expect((await reportReview(ctxFor(db, null), { reviewId, reason: "spam" })).status).toBe(401);
      expect((await reportReview(ctxFor(db, "bob"), { reviewId, reason: "nope" })).status).toBe(422);
      expect((await report("alice", reviewId)).status).toBe(403);
      expect((await report("bob", reviewId)).status).toBe(200);
      expect((await report("bob", reviewId)).status).toBe(409);
      expect((await report("bob", 99999)).status).toBe(404);
    });

    it("hides the review once three different qualifying reporters agree, and tells the author", async () => {
      await levelUp("bob", "carol", "dave");
      await report("bob", reviewId);
      await report("carol", reviewId);
      expect((await db.raw`select status from public.reviews`)[0]!.status).toBe("visible");
      await report("dave", reviewId);
      expect((await db.raw`select status, status_reason from public.reviews`)[0]).toMatchObject({ status: "hidden", status_reason: "auto_hidden_reports" });
      expect((await db.raw`select user_id, kind from public.notification_queue`)[0]).toMatchObject({ user_id: USERS.alice, kind: "moderation_decision" });
      expect((await report("erin", reviewId)).status).toBe(404); // hidden reviews cannot be reported further
    });

    it("does not count new accounts or reporters who are mostly dismissed", async () => {
      await levelUp("bob", "carol");
      await db.raw`update public.reviewer_stats set reports_filed = 10, reports_dismissed = 9 where user_id = ${USERS.dave}`;
      await levelUp("dave");
      await report("bob", reviewId);
      await report("carol", reviewId);
      await report("dave", reviewId); // abusive reporter
      await report("erin", reviewId); // still level "new"
      expect((await db.raw`select status from public.reviews`)[0]!.status).toBe("visible");
    });

    it("hides at once for personal details or defamation", async () => {
      expect((await report("bob", reviewId, "personal_or_defamation")).status).toBe(200);
      expect((await db.raw`select status_reason from public.reviews`)[0]!.status_reason).toBe("auto_hidden_instant");
    });

    it("lets the author appeal once, and only a hidden review", async () => {
      const appeal = (who: Parameters<typeof ctxFor>[1], text = "אני מבקש לבדוק שוב את ההחלטה") => appealReview(ctxFor(db, who), { reviewId, body: text });
      expect((await appeal("alice")).status).toBe(409); // still visible
      await report("bob", reviewId, "personal_or_defamation");
      expect((await appeal("bob")).status).toBe(403);
      expect((await appeal("alice", "קצר")).status).toBe(422);
      expect((await appeal("alice")).status).toBe(200);
      expect((await appeal("alice")).status).toBe(409);
    });

    it("adds an update, makes its rating the review's rating, and limits how many", async () => {
      const update = (who: Parameters<typeof ctxFor>[1], body = "אחרי חודש הבד עדיין במצב טוב", rating: number | null = 5) => reviewUpdate(ctxFor(db, who), { reviewId, body, rating });
      expect((await update("bob")).status).toBe(403);
      expect((await update("alice", "קצר")).status).toBe(422);
      expect((await update("alice")).status).toBe(200);
      expect((await db.raw`select rating from public.reviews`)[0]!.rating).toBe(5);
      for (let i = 0; i < 4; i++) expect((await update("alice", `עדכון מספר ${i} אחרי זמן ארוך`, null)).status).toBe(200);
      expect((await update("alice")).status).toBe(429);
    });
  });

  describe("events", () => {
    const send = (body: unknown) => events(ctxFor(db, null), body);
    const install = "11111111-2222-4333-8444-555555555555";

    it("records a product view with the product and without any install or user id", async () => {
      expect((await send({ event: "product_view", platform: "extension", siteId: "terminalx", parentSku: "w81726", installId: install })).status).toBe(200);
      const [e] = await db.raw`select event, product_id, install_id, user_id from public.events`;
      expect(e).toMatchObject({ event: "product_view", install_id: null, user_id: null });
      expect(e!.product_id).not.toBeNull();
      expect(await db.raw`select 1 from public.products`).toHaveLength(1);
    });

    it("records the first view once per install, with no product", async () => {
      await send({ event: "first_product_view", platform: "extension", siteId: "terminalx", parentSku: "w81726", installId: install });
      const [e] = await db.raw`select install_id, product_id from public.events`;
      expect(e).toMatchObject({ install_id: install, product_id: null });
    });

    it("keeps the signals of a detection failure, and nothing else, in props", async () => {
      await send({ event: "detect_failed", platform: "extension", siteId: "terminalx", parentSku: "w81726", installId: install, props: { conflict: true, signals: [{ name: "url", value: "w817260002", agrees: false }] } });
      await send({ event: "panel_open", platform: "extension", installId: install, props: { secret: "x" } });
      const rows = await db.raw`select event, props from public.events order by id`;
      expect(rows[0]!.props).toMatchObject({ conflict: true });
      expect(rows[1]!.props).toEqual({});
    });

    it("keeps only a listed answer from the exit survey", async () => {
      await send({ event: "uninstall", platform: "web_desktop", props: { reason: "privacy", note: "free text" } });
      await send({ event: "uninstall", platform: "web_desktop", props: { reason: "made up" } });
      const rows = await db.raw`select props from public.events order by id`;
      expect(rows[0]!.props).toEqual({ reason: "privacy" });
      expect(rows[1]!.props).toEqual({});
    });

    it("rejects events a client may not send, a missing install id, an unknown store and oversized props", async () => {
      expect((await send({ event: "signup", platform: "extension", installId: install })).status).toBe(400);
      expect((await send({ event: "panel_open", platform: "extension" })).status).toBe(400);
      expect((await send({ event: "panel_open", platform: "extension", installId: install, siteId: "nowhere" })).status).toBe(404);
      expect((await send({ event: "detect_failed", platform: "extension", installId: install, props: { blob: "x".repeat(3000) } })).status).toBe(413);
      expect((await send("nope")).status).toBe(400);
    });
  });

  describe("account export and deletion", () => {
    it("exports the user's own data, and no order numbers", async () => {
      await submit("alice", reviewBody());
      await db.raw`update public.profiles set order_check_consent = true where id = ${USERS.alice}`;
      await verifyOrders(ctxFor(db, "alice"), { siteId: "terminalx", orders: [{ orderNumber: "TX-31337", orderedAt: "2026-09-20", deliveredAt: "2026-09-25", items: [{ sku: "w817260002" }] }] });
      const res = await exportMyData(ctxFor(db, "alice"), {});
      expect(res.status).toBe(200);
      const data = res.body as Record<string, unknown>;
      expect((data.reviews as unknown[]).length).toBe(1);
      expect((data.orders as { skus: string[] }[])[0]!.skus).toEqual(["w817260002"]);
      expect((data.profile as { display_name: string }).display_name).toBe("nick_alice");
      expect(JSON.stringify(data)).not.toContain("31337");
      expect(JSON.stringify(data)).not.toContain(USERS.bob);
      expect((await exportMyData(ctxFor(db, null), {})).status).toBe(401);
    });

    it("deletes the account together with its reviews and orders, and keeps anonymous events", async () => {
      await submit("alice", reviewBody());
      await submit("bob", reviewBody("w900010001"));
      expect((await deleteMyAccount(ctxFor(db, "alice"), {})).status).toBe(400); // needs explicit confirmation
      expect((await deleteMyAccount(ctxFor(db, "alice"), { confirm: true })).status).toBe(200);
      expect(deleted).toContain(USERS.alice);
      expect(await db.raw`select 1 from public.profiles where id = ${USERS.alice}`).toHaveLength(0);
      expect(await db.raw`select 1 from public.reviews where user_id = ${USERS.alice}`).toHaveLength(0);
      expect(await db.raw`select 1 from public.reviews where user_id = ${USERS.bob}`).toHaveLength(1);
      const [e] = await db.raw`select user_id from public.events where event = 'review_submitted' and product_id is not null order by id limit 1`;
      expect(e!.user_id).toBeNull(); // detached, not deleted
      await db.raw`insert into auth.users (id, email) values (${USERS.alice}, 'alice@test.invalid')`;
      await db.raw`update public.profiles set display_name = 'nick_alice' where id = ${USERS.alice}`;
    });
  });

  describe("moderate", () => {
    const act = (who: Parameters<typeof ctxFor>[1], body: Record<string, unknown>) => moderate(ctxFor(db, who), body);
    let reviewId = 0;
    let reportId = 0;

    beforeEach(async () => {
      reviewId = reviewIdOf(await submit("alice", reviewBody()));
      await report("bob");
      reportId = Number((await db.raw`select id from public.reports`)[0]!.id);
    });
    const report = (who: Parameters<typeof ctxFor>[1]) => reportReview(ctxFor(db, who), { reviewId, reason: "spam" });

    it("is only for moderators and admins", async () => {
      expect((await act(null, { action: "decide_report" })).status).toBe(401);
      expect((await act("bob", { action: "decide_report", reportId, decision: "upheld", reviewAction: "hide", note: "ספאם" })).status).toBe(403);
      await db.raw`update public.profiles set blocked_at = now() where id = ${USERS.mia}`;
      expect((await act("mia", { action: "decide_report", reportId, decision: "upheld", reviewAction: "hide", note: "ספאם" })).status).toBe(403);
      await db.raw`update public.profiles set blocked_at = null where id = ${USERS.mia}`;
    });

    it("needs a reason for every decision, applies it, notifies both sides and writes the audit log", async () => {
      expect((await act("mia", { action: "decide_report", reportId, decision: "upheld", reviewAction: "hide", note: "" })).status).toBe(422);
      expect((await act("mia", { action: "decide_report", reportId, decision: "upheld", reviewAction: "hide", note: "ספאם ברור" })).status).toBe(200);
      expect((await db.raw`select status from public.reviews`)[0]!.status).toBe("hidden");
      expect((await db.raw`select status, decision_note, decided_by from public.reports`)[0]).toMatchObject({ status: "upheld", decision_note: "ספאם ברור", decided_by: USERS.mia });
      expect(await db.raw`select 1 from public.notification_queue`).toHaveLength(2); // reporter and author
      expect((await db.raw`select action, target_type, actor_id, details from public.admin_audit_log`)[0]).toMatchObject({ action: "decide_report", target_type: "report", actor_id: USERS.mia });
    });

    it("restores a review when its appeal is accepted", async () => {
      await act("mia", { action: "set_review_status", reviewId, status: "hidden", note: "בדיקה" });
      await appealReview(ctxFor(db, "alice"), { reviewId, body: "אני מבקש לבדוק שוב את ההחלטה" });
      const appealId = Number((await db.raw`select id from public.appeals`)[0]!.id);
      expect((await act("mia", { action: "decide_appeal", appealId, decision: "accepted", note: "הערעור מוצדק" })).status).toBe(200);
      expect((await db.raw`select status, status_reason from public.reviews`)[0]).toMatchObject({ status: "visible", status_reason: null });
      expect((await db.raw`select status from public.appeals`)[0]!.status).toBe("accepted");
    });

    it("keeps role changes and blocking for admins, and never lets an admin change their own role", async () => {
      expect((await act("mia", { action: "set_role", userId: USERS.bob, role: "moderator", note: "בדיקה" })).status).toBe(403);
      expect((await act("mia", { action: "set_blocked", userId: USERS.bob, blocked: true, note: "בדיקה" })).status).toBe(403);
      expect((await act("adam", { action: "set_role", userId: USERS.adam, role: "user", note: "בדיקה" })).status).toBe(409);
      expect((await act("adam", { action: "set_role", userId: USERS.bob, role: "moderator", note: "מינוי מפקח" })).status).toBe(200);
      expect((await db.raw`select role from public.profiles where id = ${USERS.bob}`)[0]!.role).toBe("moderator");
      await db.raw`update public.profiles set role = 'user' where id = ${USERS.bob}`;
      expect((await act("adam", { action: "set_blocked", userId: USERS.bob, blocked: true, note: "ספאם חוזר" })).status).toBe(200);
      expect((await submit("bob", reviewBody("w900010001"))).status).toBe(403);
      expect((await act("adam", { action: "set_blocked", userId: USERS.bob, blocked: false, note: "בוטל" })).status).toBe(200);
      expect((await db.raw`select count(*)::int as n from public.admin_audit_log`)[0]!.n).toBeGreaterThanOrEqual(3);
    });

    it("rejects unknown actions and missing records", async () => {
      expect((await act("mia", { action: "format_disk" })).status).toBe(400);
      expect((await act("mia", { action: "decide_report", reportId: 99999, decision: "upheld", reviewAction: "hide", note: "בדיקה" })).status).toBe(404);
    });
  });

  describe("takedown-request", () => {
    const send = (body: unknown) => takedownRequest(ctxFor(db, null), body);
    const valid = { name: "נציג מותג", email: "legal@brand.test", reason: "הביקורת מכילה פרטים שגויים על המוצר שלנו." };

    it("stores a valid request for the moderators", async () => {
      expect((await send(valid)).status).toBe(200);
      expect((await db.raw`select requester_name, requester_email, status from public.takedown_requests`)[0]).toMatchObject({ requester_email: "legal@brand.test", status: "open" });
    });

    it("links the review only when it exists", async () => {
      const id = reviewIdOf(await submit("alice", reviewBody()));
      await send({ ...valid, reviewId: id });
      await send({ ...valid, reviewId: 99999 });
      const rows = await db.raw`select review_id from public.takedown_requests order by id`;
      expect(rows.map((r) => (r.review_id === null ? null : Number(r.review_id)))).toEqual([id, null]);
    });

    it("validates the fields and swallows bot submissions without storing them", async () => {
      expect((await send({ name: "x", email: "bad", reason: "קצר" })).status).toBe(422);
      expect((await send({ ...valid, website: "http://spam.test" })).status).toBe(200);
      expect(await db.raw`select 1 from public.takedown_requests`).toHaveLength(0);
    });
  });

  it("the clock used by the handlers is the one the test passes in", () => {
    expect(NOW.toISOString()).toBe("2026-10-25T10:00:00.000Z");
    expect(REVIEW_TEXT.length).toBeGreaterThan(30);
  });
});
