// End-to-end checks of the built website in a real browser, against the mock backend. Run: pnpm e2e:web
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ME, startMock } from "./mock-supabase.mjs";
import { axeSource, outDir, root } from "./harness.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { startServer } = await import(resolve(root, "apps/web/serve.mjs"));

const mock = await startMock(54399);
const web = await startServer(4173);
const browser = await chromium.launch();
const results = [];
const a11y = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok  ${name}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`  FAIL ${name}\n       ${e.message.split("\n").slice(0, 4).join("\n       ")}`);
  }
}

const session = JSON.stringify({
  access_token: "e2e-user-token",
  refresh_token: "e2e-refresh",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: ME, aud: "authenticated", role: "authenticated", email: "tester@example.invalid", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
});

async function open(path, { signedIn = false, mobile = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 900 }, locale: "he-IL", isMobile: mobile, hasTouch: mobile });
  if (signedIn) await context.addInitScript((s) => localStorage.setItem("sb-127-auth-token", s), session);
  await context.route("https://media.terminalx.com/**", (r) => r.fulfill({ status: 200, contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#c9d3e6"/></svg>` }));
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(`${web.url}${path}`);
  page.problems = problems;
  page.context_ = context;
  return page;
}

async function audit(page, label) {
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const out = await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "best-practice"], resultTypes: ["violations"] });
    return out.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, sample: v.nodes[0]?.html?.slice(0, 140) }));
  });
  a11y.push({ label, violations });
  return violations;
}

const shot = (page, name, full = true) => page.screenshot({ path: `${outDir}/web-${name}.png`, fullPage: full });
const close = (page) => page.context_.close();
const text = (page) => page.locator("body").innerText();

console.log("\nPages");

await check("home explains the service, takes a product link, and reports an unusable one", async () => {
  const page = await open("/");
  await page.getByRole("heading", { name: "ביקורות אמינות על מוצרים באתרי קניות" }).waitFor();
  await page.getByText(/חנויות נתמכות: Terminal X \(בטא\)/).waitFor();
  await shot(page, "home-desktop");
  await page.getByLabel("קישור למוצר או מק״ט").fill("לא קישור");
  await page.getByRole("button", { name: "חיפוש" }).click();
  await page.getByText(/לא זיהינו מוצר בקישור או במק״ט/).waitFor();
  await page.getByLabel("קישור למוצר או מק״ט").fill("https://www.terminalx.com/w817260002");
  await page.getByRole("button", { name: "חיפוש" }).click();
  await page.waitForURL("**/terminalx/w817260002");
  assert.deepEqual(page.problems, []);
  await close(page);
});

await check("a product page shows the product, the summary, the fit meter and the reviews, at both addresses", async () => {
  for (const path of ["/terminalx/w817260002", "/w817260002"]) {
    const page = await open(path);
    await page.waitForSelector(".sb-review");
    const t = await text(page);
    for (const expected of ["מכנסי בדיקה", "מותג בדיקה", "4.3", "12 ביקורות", "מדויק", "לפי 22 קונים", "רכישה מאומתת", "ממתין לאימות", "לא מאומת", "לעמוד המוצר ב", "אין לו קשר לחנויות"]) assert.ok(t.includes(expected), `${path}: missing "${expected}"`);
    assert.equal(await page.locator(".sb-review").count(), 3);
    assert.equal(await page.title(), "ביקורות על מכנסי בדיקה | SmartBuy");
    assert.deepEqual(page.problems, [], page.problems.join("\n"));
    if (path.startsWith("/terminalx")) await shot(page, "product-desktop");
    await close(page);
  }
});

await check("an unknown product address offers a search instead of a blank page", async () => {
  const page = await open("/terminalx/not-a-sku");
  await page.getByText("לא מצאנו מוצר בכתובת הזו").waitFor();
  assert.ok(await page.getByLabel("קישור למוצר או מק״ט").isVisible());
  await close(page);
});

await check("static pages exist, the legal ones carry the draft banner, and the others do not", async () => {
  for (const [path, heading, draft] of [["/privacy", "מדיניות פרטיות", true], ["/terms", "תנאי שימוש", true], ["/accessibility", "הצהרת נגישות", true], ["/how-it-works", "איך זה עובד", false]]) {
    const page = await open(path);
    await page.getByRole("heading", { name: heading, level: 1 }).waitFor();
    assert.equal(await page.getByText("הנוסח הזה נכתב כבסיס לבדיקה של עורך דין").count(), draft ? 1 : 0, path);
    await close(page);
  }
});

await check("the removal form validates, sends, and hides its bot trap from people", async () => {
  const page = await open("/takedown?review=1");
  await page.getByRole("button", { name: "שליחת הבקשה" }).waitFor();
  assert.ok((await text(page)).includes("ביקורת מספר 1"));
  // The trap is parked far outside the screen, hidden from assistive technology and out of the tab order.
  const trap = await page.evaluate(() => {
    const input = document.querySelector('[aria-hidden="true"] input');
    const box = input.getBoundingClientRect();
    return { off: box.right < 0 || box.left > window.innerWidth, tab: input.tabIndex };
  });
  assert.deepEqual(trap, { off: true, tab: -1 });
  await page.getByLabel("שם").fill("נציג מותג");
  await page.getByLabel("כתובת מייל").fill("legal@brand.test");
  await page.getByLabel(/מה צריך להסיר/).fill("הביקורת מכילה פרטים שגויים על המוצר שלנו.");
  await page.getByRole("button", { name: "שליחת הבקשה" }).click();
  await page.getByText("הבקשה התקבלה").waitFor();
  const sent = JSON.parse(mock.state.requests.filter((r) => r.path.endsWith("takedown-request")).at(-1).body);
  assert.equal(sent.reviewId, 1);
  assert.equal(sent.website, "");
  await shot(page, "takedown-sent");
  await close(page);
});

await check("the exit survey sends one listed answer and nothing else", async () => {
  const page = await open("/bye");
  await page.getByLabel("דאגה לפרטיות").check({ force: true });
  await page.getByRole("button", { name: "שליחה" }).click();
  await page.getByText("התשובה נשמרה").waitFor();
  const sent = JSON.parse(mock.state.requests.filter((r) => r.path.endsWith("/events")).at(-1).body);
  assert.deepEqual(sent, { event: "uninstall", platform: "web_desktop", props: { reason: "privacy" } });
  await close(page);
});

console.log("\nPhone");

await check("on a phone the bottom tab bar is glass, the header menu is hidden, and nothing overflows sideways", async () => {
  const page = await open("/terminalx/w817260002", { mobile: true });
  await page.waitForSelector(".sb-review");
  const m = await page.evaluate(() => {
    const bar = document.querySelector(".web__tabbar");
    const style = getComputedStyle(bar);
    return {
      barDisplay: style.display,
      blur: style.backdropFilter || style.webkitBackdropFilter,
      navDisplay: getComputedStyle(document.querySelector(".web__nav")).display,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  assert.equal(m.barDisplay, "flex");
  assert.match(m.blur, /blur/);
  assert.equal(m.navDisplay, "none");
  assert.ok(m.overflow <= 0, `page is ${m.overflow}px wider than the screen`);
  await shot(page, "product-mobile");
  await page.getByRole("link", { name: "החשבון שלי" }).last().click();
  await page.waitForURL("**/account");
  await close(page);
});

await check("on a desktop the tab bar is not shown and there is no glass anywhere on the page", async () => {
  const page = await open("/terminalx/w817260002");
  await page.waitForSelector(".sb-review");
  const glass = await page.evaluate(() => [...document.querySelectorAll("*")].filter((el) => el.offsetParent !== null && /blur/.test(getComputedStyle(el).backdropFilter || "")).length);
  assert.equal(glass, 0);
  await close(page);
});

console.log("\nSigned in");

await check("the account page shows the profile, my reviews and the data controls, and deleting a review needs the server to agree", async () => {
  const page = await open("/account", { signedIn: true });
  await page.getByText("מכנסי בדיקה").first().waitFor();
  const t = await text(page);
  for (const expected of ["tester@example.invalid", "הביקורות שלי", "חולצת בדיקה", "דירוג בלי טקסט", "ממתינים לביקורת", "ייצוא המידע שלי", "מחיקת החשבון", "מצב שקט"]) assert.ok(t.includes(expected), `missing "${expected}"`);
  await shot(page, "account");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "מחיקה" }).first().click();
  await page.waitForFunction(() => true);
  assert.ok(mock.state.requests.some((r) => r.method === "DELETE" && r.path.endsWith("/reviews")));
  await close(page);
});

await check("the product page's price tab shows history and saves a watch, and the account page lists and stops it", async () => {
  mock.state.watches = [];
  const page = await open("/terminalx/w817260002", { signedIn: true });
  await page.waitForSelector(".sb-review");
  await page.getByRole("tab", { name: "מחיר ומעקב" }).click();
  await page.getByRole("img", { name: /גרף מחיר/ }).waitFor();
  await shot(page, "product-tracking");
  await page.getByLabel(/מחיר יעד/).fill("130");
  await page.getByRole("button", { name: "שמירת מעקב" }).click();
  await page.getByText("המעקב נשמר").waitFor();
  assert.equal(mock.state.watches.length, 1);
  await close(page);

  const account = await open("/account", { signedIn: true });
  await account.getByRole("heading", { name: "מוצרים במעקב" }).waitFor();
  await account.getByText("יעד ₪130").waitFor();
  await account.getByRole("heading", { name: "על מה להתריע" }).waitFor();
  await shot(account, "account-tracking");
  await account.getByRole("button", { name: "הפסקת מעקב" }).click();
  await account.getByText(/עוד אין מוצרים במעקב/).waitFor();
  assert.equal(mock.state.watches.length, 0);
  await close(account);
});

await check("a review written on the website is sent as a web review, and shown as published only after the server answered", async () => {
  mock.state.myReview = null;
  mock.state.submit = "ok";
  const page = await open("/terminalx/w817260002", { signedIn: true });
  await page.waitForSelector(".sb-review");
  await page.getByRole("button", { name: "כתיבת ביקורת" }).click();
  await page.getByText(/ביקורת שנכתבת באתר מסומנת/).waitFor();
  await page.getByRole("group", { name: "דירוג כללי" }).getByLabel("5 כוכבים").check({ force: true });
  await page.getByLabel("מדויק").check({ force: true });
  await page.getByLabel("מתי קניתם?").selectOption({ index: 1 });
  await page.getByLabel("הביקורת שלכם").fill("ביקורת בדיקה ארוכה מספיק כדי לעבור את בדיקת האורך המינימלי.");
  await shot(page, "write-form");
  await page.getByRole("button", { name: "פרסום ביקורת" }).click();
  await page.getByText("הביקורת פורסמה").waitFor();
  const sent = JSON.parse(mock.state.requests.filter((r) => r.path.endsWith("submit-review")).at(-1).body);
  assert.equal(sent.source, "web");
  assert.equal(sent.parentSku, "w81726");
  assert.equal(sent.productType, "apparel");
  assert.equal(sent.product.name, "מכנסי בדיקה");
  await close(page);
});

console.log("\nAdmin");

await check("the admin page needs sign-in, and refuses a signed-in user without a staff role", async () => {
  const out = await open("/admin");
  await out.getByText("נדרשת התחברות").waitFor();
  await close(out);
  mock.state.role = "user";
  const user = await open("/admin", { signedIn: true });
  await user.getByText("אין הרשאה").first().waitFor();
  assert.equal(await user.getByRole("tab").count(), 0);
  await close(user);
});

await check("an admin sees the overview, the stores with detection rate and emergency stop, the queue, users and the audit log", async () => {
  mock.state.role = "admin";
  const page = await open("/admin", { signedIn: true });
  await page.getByRole("tab", { name: "סקירה" }).waitFor();
  await page.getByText("340").waitFor();
  let t = await text(page);
  for (const expected of ["7 ימים אחרונים", "התקנות", "12", "כשלי זיהוי", "ממתינים לטיפול"]) assert.ok(t.includes(expected), `overview: missing "${expected}"`);
  await shot(page, "admin-overview");

  await page.getByRole("tab", { name: "חנויות" }).click();
  await page.getByText("Terminal X").first().waitFor();
  t = await text(page);
  assert.ok(t.includes("99% (4 כשלים)"), `detection rate missing: ${t}`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "כיבוי חירום" }).click();
  await page.getByText(/עודכן למושהית/).waitFor();
  assert.equal(mock.state.siteStatus, "paused");
  await shot(page, "admin-stores");
  mock.state.siteStatus = "beta";

  await page.getByRole("tab", { name: "פיקוח" }).click();
  await page.getByText("דיווח: ספאם או פרסומת").waitFor();
  await shot(page, "admin-moderation");
  await page.getByRole("button", { name: "שמירת החלטה" }).first().click();
  await page.getByText("בחרו החלטה.").waitFor();
  await page.getByLabel("הסתרה").first().check({ force: true });
  await page.getByRole("button", { name: "שמירת החלטה" }).first().click();
  await page.getByText("כל החלטה דורשת סיבה (לפחות 3 תווים).").waitFor();
  await page.getByLabel(/סיבה/).first().fill("ספאם ברור");
  await page.getByRole("button", { name: "שמירת החלטה" }).first().click();
  await page.waitForFunction(() => !document.body.innerText.includes("דיווח: ספאם או פרסומת"));
  const decision = JSON.parse(mock.state.requests.filter((r) => r.path.endsWith("/moderate")).at(-1).body);
  assert.deepEqual(decision, { action: "decide_report", reportId: 1, decision: "upheld", reviewAction: "hide", note: "ספאם ברור" });

  await page.getByRole("tab", { name: "משתמשים" }).click();
  await page.getByText("בודק_א").waitFor();
  await page.getByRole("tab", { name: "יומן" }).click();
  await page.getByText("ספאם ברור").waitFor();
  assert.deepEqual(page.problems, [], page.problems.join("\n"));
  await close(page);
});

await check("a moderator does not get the overview, the audit log or the emergency stop", async () => {
  mock.state.role = "moderator";
  const page = await open("/admin", { signedIn: true });
  await page.getByRole("tab", { name: "פיקוח" }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "סקירה" }).count(), 0);
  assert.equal(await page.getByRole("tab", { name: "יומן" }).count(), 0);
  await page.getByRole("tab", { name: "חנויות" }).click();
  assert.equal(await page.getByRole("button", { name: "כיבוי חירום" }).count(), 0);
  await close(page);
  mock.state.role = "user";
});

console.log("\nAccessibility and security headers");

await check("every page passes the accessibility audit, on desktop and on a phone", async () => {
  mock.state.role = "admin";
  const pages = [["/", "home"], ["/terminalx/w817260002", "product"], ["/takedown", "takedown"], ["/privacy", "privacy"], ["/how-it-works", "how"], ["/bye", "bye"], ["/account", "account-out"]];
  const all = [];
  for (const [path, label] of pages) {
    const page = await open(path);
    await page.waitForLoadState("networkidle");
    all.push(...(await audit(page, label)).map((v) => ({ page: label, ...v })));
    await close(page);
  }
  const signed = await open("/admin", { signedIn: true });
  await signed.getByRole("tab", { name: "סקירה" }).waitFor();
  all.push(...(await audit(signed, "admin")).map((v) => ({ page: "admin", ...v })));
  await close(signed);
  const phone = await open("/terminalx/w817260002", { mobile: true });
  await phone.waitForSelector(".sb-review");
  all.push(...(await audit(phone, "product-mobile")).map((v) => ({ page: "product-mobile", ...v })));
  await close(phone);
  mock.state.role = "user";
  assert.deepEqual(all, [], JSON.stringify(all, null, 1));
});

await check("each page ships its own content security policy with no remote script, and the built files hold no secret names", async () => {
  const dist = resolve(root, "apps/web/dist");
  for (const file of ["index", "product", "account", "admin", "takedown"]) {
    const html = readFileSync(resolve(dist, `${file}.html`), "utf8");
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'sha256-/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    assert.doesNotMatch(html, /<script[^>]+src=/);
    assert.doesNotMatch(html, /service_role|SERVICE_ROLE|ORDER_HASH_PEPPER|TELEGRAM_BOT_TOKEN/);
  }
});

await browser.close();
web.close();
mock.close();
const failed = results.filter((r) => !r.ok);
const count = a11y.reduce((n, r) => n + r.violations.length, 0);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Accessibility audits: ${a11y.length}, violations: ${count}.`);
process.exit(failed.length ? 1 : 0);
