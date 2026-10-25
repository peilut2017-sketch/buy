// A tiny stand-in for Supabase (PostgREST + Edge Functions) for the end-to-end tests.
// It serves SYNTHETIC data from tests/fixtures/e2e/backend.json and understands only the queries the extension makes.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const data = JSON.parse(readFileSync(resolve(root, "tests/fixtures/e2e/backend.json"), "utf8"));
const bundled = JSON.parse(readFileSync(resolve(root, "packages/adapters/terminalx/config.json"), "utf8"));

export const ME = "00000000-0000-4000-8000-0000000000aa";
export const ANON_KEY = "e2e-anon-key";

export function startMock(port) {
  const state = {
    /** What submit-review does next: "ok", "fail" (500), "fields" (422 with per-field Hebrew errors). */
    submit: "ok",
    requests: [],
    pending: [],
    myReview: null,
    nickname: "דנה_בדיקה",
    role: "user",
    reports: [{ id: 1, review_id: 1, reason: "spam", details: "נראה כמו פרסומת", created_at: "2026-10-24T09:00:00Z" }],
    appeals: [{ id: 1, review_id: 2, body: "אני מבקש לבדוק שוב, הביקורת נכתבה בכנות.", created_at: "2026-10-23T09:00:00Z" }],
    takedowns: [{ id: 1, review_id: null, requester_name: "נציג מותג", requester_email: "legal@brand.test", reason: "פרטים שגויים על המוצר.", created_at: "2026-10-22T09:00:00Z" }],
    audit: [{ id: 1, action: "decide_report", target_type: "report", target_id: "9", created_at: "2026-10-20T09:00:00Z", details: { reason: "ספאם ברור" } }],
    siteStatus: "beta",
  };
  const COUNTS = { install: 12, product_view: 340, panel_open: 55, review_submitted: 9, detect_failed: 4 };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const body = await new Promise((ok) => {
      let text = "";
      req.on("data", (c) => (text += c));
      req.on("end", () => ok(text));
    });
    const signedIn = (req.headers.authorization ?? "") !== `Bearer ${ANON_KEY}`;
    state.requests.push({ method: req.method, path: url.pathname, query: url.search, body, signedIn });

    const send = (status, json, extra) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET,HEAD,POST,PATCH,DELETE,OPTIONS",
        "access-control-expose-headers": "content-range",
        ...(extra ?? {}),
      });
      res.end(json === undefined || req.method === "HEAD" ? "" : JSON.stringify(json));
    };
    if (req.method === "OPTIONS") return send(204);

    const p = url.pathname;
    const q = (name) => (url.searchParams.get(name) ?? "").replace(/^eq\./, "");

    if (req.method === "HEAD") {
      const table = p.split("/").pop();
      const eventName = q("event");
      const n = table === "events" ? COUNTS[eventName] ?? 0 : table === "reports" ? state.reports.length : table === "appeals" ? state.appeals.length : table === "takedown_requests" ? state.takedowns.length : 0;
      return send(200, undefined, { "content-range": `0-0/${n}` });
    }
    if (p === "/rest/v1/sites" && req.method === "PATCH") {
      const patch = JSON.parse(body || "{}");
      if (patch.status) state.siteStatus = patch.status;
      return send(200, [{ id: "terminalx" }]);
    }
    if (p === "/rest/v1/products") {
      return send(200, q("parent_sku") === "w81726" ? [{ name: "מכנסי בדיקה", brand: "מותג בדיקה", image_url: "https://media.terminalx.com/pub/media/catalog/product/w/8/w817260002-1234567.jpg", url: "https://www.terminalx.com/w817260002", product_type: "apparel" }] : []);
    }
    if (p === "/rest/v1/reports") return send(200, state.reports);
    if (p === "/rest/v1/appeals") return send(200, state.appeals);
    if (p === "/rest/v1/takedown_requests") return send(200, state.takedowns);
    if (p === "/rest/v1/admin_audit_log") return send(200, state.audit);
    if (p === "/functions/v1/moderate") {
      const input = JSON.parse(body || "{}");
      if (input.action === "decide_report") state.reports = state.reports.filter((r) => r.id !== input.reportId);
      if (input.action === "decide_appeal") state.appeals = state.appeals.filter((r) => r.id !== input.appealId);
      if (input.action === "decide_takedown") state.takedowns = state.takedowns.filter((r) => r.id !== input.takedownId);
      return send(200, { ok: true });
    }
    if (p === "/functions/v1/takedown-request") return send(200, { ok: true });
    if (p === "/rest/v1/sites") {
      return send(200, [{ id: "terminalx", name: "Terminal X", status: "beta", domains: ["terminalx.com", "www.terminalx.com"], adapter_config: bundled, adapter_version: 1 }].map((x) => ({ ...x, status: state.siteStatus })));
    }
    if (p === "/rest/v1/product_summary") {
      const sku = q("parent_sku");
      if (sku === "w90002") return send(500, { message: "boom" });
      const product = data.products[sku];
      return send(200, product ? [product.summary] : []);
    }
    if (p === "/rest/v1/reviews") {
      if (req.method === "DELETE") return send(200, [{ id: Number(q("id")) }]);
      if (url.searchParams.has("user_id")) {
        return send(200, [{ id: 1, rating: 5, title: null, body: "ביקורת בדיקה שלי עם מספיק טקסט כדי להיראות כמו ביקורת אמיתית.", status: "visible", written_at: "2026-10-10T09:00:00Z", helpful_count: 2, products: { site_id: "terminalx", parent_sku: "w81726", name: "מכנסי בדיקה" } }, { id: 2, rating: 3, title: null, body: null, status: "visible", written_at: "2026-10-11T09:00:00Z", helpful_count: 0, products: { site_id: "terminalx", parent_sku: "w90003", name: "חולצת בדיקה" } }]);
      }
      if (q("product_id") === "3") return send(200, data.reviews.slice(0, 2).map((r, i) => ({ ...r, id: 300 + i })));
      const rows = [...data.reviews];
      if (signedIn && state.myReview) rows.push(state.myReview);
      return send(200, rows);
    }
    if (p === "/rest/v1/reviewer_public") return send(200, data.authors);
    if (p === "/rest/v1/review_updates") return send(200, data.updates);
    if (p === "/rest/v1/helpful_votes") {
      if (req.method === "POST") return send(201);
      if (req.method === "DELETE") return send(200, [{ review_id: 1 }]);
      return send(200, signedIn ? [{ review_id: 1 }] : []);
    }
    if (p === "/rest/v1/category_questions") return send(200, data.questions.filter((x) => x.product_type === q("product_type")));
    if (p === "/rest/v1/profiles") {
      if (req.method === "PATCH") {
        const patch = JSON.parse(body || "{}");
        if (patch.display_name === "תפוס") return send(409, { code: "23505", message: "duplicate key" });
        if (patch.display_name) state.nickname = patch.display_name;
        return send(200, [{ display_name: state.nickname, id: ME }]);
      }
      if (url.searchParams.get("select")?.includes("created_at")) {
        return send(200, [{ id: ME, display_name: state.nickname, role: "user", blocked_at: null, created_at: "2026-09-01T09:00:00Z" }, { id: "00000000-0000-4000-8000-000000000001", display_name: "בודק_א", role: "user", blocked_at: null, created_at: "2026-09-02T09:00:00Z" }]);
      }
      return send(200, [{ display_name: state.nickname, role: state.role, quiet_mode: false, order_check_consent: false, show_listing_stars: true }]);
    }
    if (p === "/rest/v1/order_items") return send(200, []);
    if (p === "/rest/v1/pending_reviews") return send(200, state.pending);

    if (p === "/functions/v1/events") return send(200, { ok: true });
    if (p === "/functions/v1/report-review") return send(200, { ok: true });
    if (p === "/functions/v1/appeal-review") return send(200, { ok: true });
    if (p === "/functions/v1/submit-review") {
      if (state.submit === "fail") return send(500, { message: "boom" });
      if (state.submit === "fields") return send(422, { errors: { body: "הביקורת קצרה מדי. כתבו לפחות 30 תווים (כרגע 5)." } });
      const input = JSON.parse(body || "{}");
      state.myReview = {
        id: 501, user_id: ME, rating: input.rating, title: input.title, body: input.body, answers: input.answers, variant_values: input.variantValues,
        verification: "unverified", purchase_month: input.purchaseMonth ? `${input.purchaseMonth}-01` : null, purchased_at: null, delivered_at: null,
        written_at: new Date().toISOString(), edited_at: null, helpful_count: 0, status: "visible",
      };
      return send(200, { reviewId: 501, verification: "unverified", published: input.body !== null });
    }
    return send(404, { message: `mock: no route for ${req.method} ${p}` });
  });

  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok({ server, state, url: `http://127.0.0.1:${port}`, close: () => server.close() })));
}
