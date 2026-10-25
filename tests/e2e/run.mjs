// End-to-end checks of the real built extension against synthetic pages and a mock backend.
// Run: pnpm e2e   (builds the test variant first). Screenshots go to tests/e2e/out/.
import assert from "node:assert/strict";
import { axeSource, launch, outDir, signIn } from "./harness.mjs";

const env = await launch();
const { context, mock, worker } = env;
const results = [];
const a11y = [];
let current = "";

async function check(name, fn) {
  current = name;
  const before = new Set(context.pages());
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`  FAIL ${name}\n       ${e.message.split("\n").slice(0, 4).join("\n       ")}`);
  } finally {
    // A failed check must not leave its pages behind for the next one to pick up by mistake.
    for (const page of context.pages()) if (!before.has(page)) await page.close().catch(() => undefined);
  }
}

const shot = (page, name, opts = {}) => page.screenshot({ path: `${outDir}/${name}.png`, ...opts });

async function productPage(sku, query = "") {
  const page = await context.newPage();
  await page.goto(`https://www.terminalx.com/${sku}${query}`);
  return page;
}

async function stripOf(page) {
  await page.waitForSelector("smartbuy-strip", { timeout: 8000 });
  const strip = page.locator("smartbuy-strip");
  // Wait for the loading skeleton to be replaced by real content.
  await page.waitForFunction(() => {
    const root = document.querySelector("smartbuy-strip")?.shadowRoot;
    return root && !root.querySelector('[aria-label="טוענים ביקורות"]');
  }, null, { timeout: 8000 });
  return strip;
}

const stripText = (page) => page.evaluate(() => document.querySelector("smartbuy-strip")?.shadowRoot?.textContent ?? "");

async function tabIdOf(page) {
  const url = page.url().split("?")[0];
  return worker.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(u))?.id, url);
}

async function openPanel(sku, query = "") {
  const product = await productPage(sku, query);
  if (!sku.startsWith("w")) throw new Error("bad sku");
  await product.waitForSelector("smartbuy-strip", { timeout: 8000 }).catch(() => undefined);
  await product.waitForTimeout(400);
  const tabId = await tabIdOf(product);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(env.extUrl(`sidepanel.html?tab=${tabId}`));
  return { product, panel, tabId };
}

async function runAxe(page, label, selector) {
  // evaluate() is not subject to the extension pages' CSP, unlike addScriptTag with inline content.
  await page.evaluate(axeSource);
  const result = await page.evaluate(async (sel) => {
    const target = sel ? document.querySelector(sel) : document;
    // eslint-disable-next-line no-undef
    const out = await axe.run(target, { runOnly: ["wcag2a", "wcag2aa", "best-practice"], resultTypes: ["violations"] });
    return out.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, sample: v.nodes[0]?.html?.slice(0, 140) }));
  }, selector ?? null);
  a11y.push({ label, violations: result });
  return result;
}

console.log("\nStrip");

await check("strip over a light page shows the summary, the fit meter and a transparent glass frame", async () => {
  const page = await productPage("w817260002");
  await stripOf(page);
  const text = await stripText(page);
  for (const expected of ["4.3", "12 ביקורות", "8 מאומתות", "מדויק", "לפי 22 קונים", "ביקורות"]) assert.ok(text.includes(expected), `missing "${expected}" in: ${text}`);
  assert.equal(await page.locator("smartbuy-strip .sb-shell--opaque").count(), 0, "light page should keep the glass frame");
  assert.equal(await page.locator("smartbuy-strip .sb-shell").count(), 1);
  await shot(page, "strip-light");
  await page.close();
});

await check("strip over a dark page switches the frame to the opaque variant", async () => {
  const page = await productPage("w817260002", "?theme=dark");
  await stripOf(page);
  await page.waitForTimeout(300);
  assert.equal(await page.locator("smartbuy-strip .sb-shell--opaque").count(), 1);
  await shot(page, "strip-dark");
  await page.close();
});

await check("strip over a busy gradient page switches to the opaque variant", async () => {
  const page = await productPage("w817260002", "?theme=busy");
  await stripOf(page);
  await page.waitForTimeout(300);
  assert.equal(await page.locator("smartbuy-strip .sb-shell--opaque").count(), 1);
  await shot(page, "strip-busy");
  await page.close();
});

await check("the store's hostile CSS does not reach the strip", async () => {
  const page = await productPage("w817260002", "?hostile=1");
  await stripOf(page);
  const style = await page.evaluate(() => {
    const root = document.querySelector("smartbuy-strip").shadowRoot;
    const rating = getComputedStyle(root.querySelector(".strip__rating"));
    const button = getComputedStyle(root.querySelector(".sb-btn--primary"));
    return { size: rating.fontSize, spacing: rating.letterSpacing, color: rating.color, background: button.backgroundColor, border: button.borderStyle };
  });
  assert.equal(style.size, "16px");
  assert.notEqual(style.spacing, "6px");
  assert.equal(style.background, "rgb(8, 112, 208)");
  assert.notEqual(style.border, "dashed");
  await shot(page, "strip-hostile-page");
  await page.close();
});

await check("empty state invites a first review", async () => {
  const page = await productPage("w900010001");
  await stripOf(page);
  const text = await stripText(page);
  assert.ok(text.includes("עוד אין ביקורות על המוצר הזה"));
  assert.ok(text.includes("כתיבת ביקורת"));
  await shot(page, "strip-empty");
  await page.close();
});

await check("network error shows a retry that tries again", async () => {
  const page = await productPage("w900020001");
  await stripOf(page);
  assert.ok((await stripText(page)).includes("הביקורות לא נטענו"));
  const before = mock.state.requests.filter((r) => r.path.endsWith("product_summary")).length;
  await shot(page, "strip-error");
  await page.locator("smartbuy-strip").getByRole("button", { name: "ניסיון חוזר" }).click();
  await page.waitForTimeout(800);
  const after = mock.state.requests.filter((r) => r.path.endsWith("product_summary")).length;
  assert.ok(after > before, "retry did not call the backend again");
  await page.close();
});

await check("fewer than three fit answers shows no verdict", async () => {
  const page = await productPage("w900030001");
  await stripOf(page);
  const text = await stripText(page);
  assert.ok(text.includes("3.5"));
  assert.ok(!text.includes("מדויק") && !text.includes("לפי"), `unexpected fit text: ${text}`);
  await page.close();
});

await check("a non-product page shows nothing and asks the backend nothing", async () => {
  const before = mock.state.requests.length;
  const page = await productPage("women");
  await page.waitForTimeout(1500);
  assert.equal(await page.locator("smartbuy-strip").count(), 0);
  const summaryCalls = mock.state.requests.slice(before).filter((r) => r.path.endsWith("product_summary"));
  assert.equal(summaryCalls.length, 0);
  await page.close();
});

await check("closing the strip removes it, and clicking the main button records the request for the panel", async () => {
  const page = await productPage("w817260002");
  await stripOf(page);
  const tabId = await tabIdOf(page);
  await page.locator("smartbuy-strip").getByRole("button", { name: "ביקורות", exact: true }).click();
  await page.waitForTimeout(500);
  // The panel really opened (not just a stored request), and it read the product of this tab.
  const panels = await worker.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })).length);
  assert.ok(panels > 0, "the side panel did not open");
  const stored = await worker.evaluate(async (id) => (await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`], tabId);
  assert.equal(stored?.product?.parentSku, "w81726");
  assert.equal(stored?.mode, null, "the panel should have consumed the requested mode");
  await page.locator("smartbuy-strip").getByRole("button", { name: "סגירת הפס" }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator("smartbuy-strip").count(), 0);
  await page.close();
});

await check("single-page navigation to another product updates the strip", async () => {
  const page = await productPage("w817260002");
  await stripOf(page);
  // A real single-page app updates its address first and its head tags a moment later.
  await page.evaluate(() => {
    history.pushState({}, "", "/w900010001");
    setTimeout(() => {
      const url = "https://www.terminalx.com/w900010001";
      document.querySelector("link[rel=canonical]").href = url;
      document.querySelector("meta[property='og:url']").content = url;
      document.querySelector("meta[property='og:image']").content = "https://media.terminalx.com/pub/media/catalog/product/w/9/w900010001-1.jpg";
      document.querySelector("script[type='application/ld+json']").textContent = JSON.stringify({ "@type": "Product", sku: "w900010001", name: "x" });
    }, 600);
  });
  await page.waitForFunction(() => document.querySelector("smartbuy-strip")?.shadowRoot?.textContent?.includes("עוד אין ביקורות"), null, { timeout: 8000 });
  await page.close();
});

await check("the strip passes the accessibility audit on light and dark pages", async () => {
  for (const theme of ["light", "dark"]) {
    const page = await productPage("w817260002", `?theme=${theme}`);
    await stripOf(page);
    await page.waitForTimeout(300);
    const violations = await runAxe(page, `strip-${theme}`, "smartbuy-strip");
    assert.deepEqual(violations, [], JSON.stringify(violations));
    await page.close();
  }
});

console.log("\nSide panel");

await check("panel shows the product, the summary, the fit meter and every review with its label", async () => {
  const { product, panel } = await openPanel("w817260002");
  await panel.waitForSelector(".sb-review", { timeout: 8000 });
  const text = await panel.locator("body").innerText();
  for (const expected of ["מכנסי בדיקה", "מותג בדיקה", "Terminal X", "₪149.90", "4.3", "12 ביקורות", "8 מאומתות", "מדויק", "לפי 22 קונים",
    "רכישה מאומתת", "ממתין לאימות", "לא מאומת", "אחרי שימוש", "שימוש ממושך", "אחרי הקנייה", "לפי דיווח הכותב", "נערך 21.10.2026", "עדכון אחרי יום",
    "בודק_א", "מוביל", "31 ביקורות", "64 סימוני מועיל", "כתיבת ביקורת", "אין לו קשר לחנויות"]) {
    assert.ok(text.includes(expected), `missing "${expected}"`);
  }
  assert.equal(await panel.locator(".sb-review").count(), 3);
  assert.equal(await panel.locator("html").getAttribute("dir"), "rtl");
  await shot(panel, "panel-reviews", { fullPage: true });
  await product.close();
  await panel.close();
});

await check("long review text is cut and can be expanded", async () => {
  const { product, panel } = await openPanel("w817260002");
  await panel.waitForSelector(".sb-review");
  assert.equal(await panel.locator(".sb-review__body--clamped").count(), 1);
  await panel.getByRole("button", { name: "קריאת המשך" }).click();
  assert.equal(await panel.locator(".sb-review__body--clamped").count(), 0);
  await panel.getByRole("button", { name: "הצגת פחות" }).click();
  assert.equal(await panel.locator(".sb-review__body--clamped").count(), 1);
  await product.close();
  await panel.close();
});

await check("filters narrow the list, show a count, and clear", async () => {
  const { product, panel } = await openPanel("w817260002");
  await panel.waitForSelector(".sb-review");
  await panel.getByRole("button", { name: "רק מאומתות" }).click();
  assert.equal(await panel.locator(".sb-review").count(), 1);
  await panel.getByRole("button", { name: /ניקוי סינון/ }).first().click();
  assert.equal(await panel.locator(".sb-review").count(), 3);
  await panel.getByRole("button", { name: "שימוש ממושך" }).click();
  assert.equal(await panel.locator(".sb-review").count(), 1, "only the March purchase counts as long term");
  await panel.getByRole("button", { name: "רק מאומתות" }).click();
  assert.ok(await panel.getByText("אין ביקורות שמתאימות לסינון").isVisible());
  await shot(panel, "panel-filtered-empty");
  await panel.getByRole("button", { name: "ניקוי סינון", exact: true }).click();
  assert.equal(await panel.locator(".sb-review").count(), 3);
  await product.close();
  await panel.close();
});

await check("acting without an account asks for sign-in instead of failing", async () => {
  const { product, panel } = await openPanel("w817260002");
  await panel.waitForSelector(".sb-review");
  await panel.getByRole("button", { name: /^מועיל/ }).first().click();
  await panel.getByText("נדרשת התחברות").waitFor();
  assert.ok(await panel.getByRole("button", { name: "המשך עם Google" }).isVisible());
  await shot(panel, "panel-signin");
  await panel.getByRole("button", { name: "המשך עם קוד במייל" }).click();
  assert.ok(await panel.getByLabel("כתובת מייל").isVisible());
  await product.close();
  await panel.close();
});

await check("empty product, failing backend, and a product the page did not identify", async () => {
  const a = await openPanel("w900010001");
  await a.panel.getByText("עוד אין ביקורות על המוצר הזה").first().waitFor();
  await shot(a.panel, "panel-empty");
  await a.product.close();
  await a.panel.close();

  const b = await openPanel("w900020001");
  await b.panel.getByText("הביקורות לא נטענו").waitFor();
  assert.ok(await b.panel.getByRole("button", { name: "ניסיון חוזר" }).isVisible());
  await shot(b.panel, "panel-error");
  await b.product.close();
  await b.panel.close();

  const c = await openPanel("women");
  await c.panel.getByText("לא זיהינו מוצר בעמוד הזה").waitFor();
  await c.panel.getByLabel("קישור או מק״ט").fill("לא קישור");
  await c.panel.getByRole("button", { name: "חיפוש" }).click();
  await c.panel.getByText(/לא זיהינו מוצר בקישור/).waitFor();
  await c.panel.getByLabel("קישור או מק״ט").fill("https://www.terminalx.com/w817260002");
  await c.panel.getByRole("button", { name: "חיפוש" }).click();
  await c.panel.waitForSelector(".sb-review");
  assert.ok((await c.panel.locator("body").innerText()).includes("w817260002"));
  await shot(c.panel, "panel-manual-lookup");
  await c.product.close();
  await c.panel.close();
});

await check("a very long product name is cut at two lines and a missing image leaves a quiet placeholder", async () => {
  const name = encodeURIComponent("מכנסי ג׳ינס ארוכים במיוחד עם שם ארוך מאוד מאוד שממשיך ממשיך וממשיך ואמור להיחתך אחרי שתי שורות בלבד בתוך הפאנל");
  const { product, panel } = await openPanel("w817260002", `?name=${name}&noimage=1`);
  await panel.waitForSelector(".product__thumb--empty");
  const h = await panel.evaluate(() => {
    const el = document.querySelector(".product h1");
    return { height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) };
  });
  assert.ok(h.height <= h.line * 2 + 1, `name is ${h.height}px tall, more than two lines`);
  await shot(panel, "panel-long-name-no-image");
  await product.close();
  await panel.close();
});

console.log("\nSigned in");
await signIn(env);

await check("a signed-in user toggles helpful, and the count follows the server", async () => {
  const { product, panel } = await openPanel("w817260002");
  await panel.waitForSelector(".sb-review");
  const button = panel.getByRole("button", { name: /^מועיל/ }).first();
  assert.equal(await button.getAttribute("aria-pressed"), "true");
  await button.click();
  await panel.waitForFunction(() => document.querySelector(".sb-review .sb-btn[aria-pressed]")?.getAttribute("aria-pressed") === "false");
  assert.ok((await button.innerText()).includes("6"), await button.innerText());
  await product.close();
  await panel.close();
});

await check("the review form validates every field and keeps what was typed", async () => {
  const { product, panel } = await openPanel("w817260002");
  await panel.waitForSelector(".sb-review");
  await panel.getByRole("button", { name: "כתיבת ביקורת" }).click();
  await panel.getByRole("heading", { name: "כתיבת ביקורת" }).waitFor();
  await shot(panel, "panel-write-empty", { fullPage: true });
  await panel.getByRole("button", { name: "פרסום ביקורת" }).click();
  const text = await panel.locator("body").innerText();
  for (const e of ["בחרו דירוג בין 1 ל-5 כוכבים.", "בחרו איך המידה.", "בחרו את חודש הרכישה.", "כתבו כמה מילים על המוצר."]) assert.ok(text.includes(e), `missing error "${e}"`);
  assert.equal(await panel.locator("[aria-invalid=true]").count() > 0, true);
  await shot(panel, "panel-write-errors", { fullPage: true });
  await panel.getByRole("group", { name: "דירוג כללי" }).getByLabel("4 כוכבים").check({ force: true });
  await panel.getByLabel("מדויק").check({ force: true });
  await panel.getByLabel("מתי קניתם?").selectOption({ index: 2 });
  await panel.getByLabel("הביקורת שלכם").fill("קצר");
  await panel.getByRole("button", { name: "פרסום ביקורת" }).click();
  assert.ok((await panel.locator("body").innerText()).includes("הביקורת קצרה מדי. כתבו לפחות 30 תווים (כרגע 3)."));
  assert.equal(await panel.getByLabel("הביקורת שלכם").inputValue(), "קצר");
  await product.close();
  await panel.close();
});

await check("a failed save is reported as failed and never as published", async () => {
  mock.state.submit = "fail";
  const { product, panel } = await openPanel("w817260002");
  await panel.waitForSelector(".sb-review");
  await panel.getByRole("button", { name: "כתיבת ביקורת" }).click();
  await panel.getByRole("group", { name: "דירוג כללי" }).getByLabel("5 כוכבים").check({ force: true });
  await panel.getByLabel("גדול").check({ force: true });
  await panel.getByLabel("מתי קניתם?").selectOption({ index: 1 });
  await panel.getByLabel("הביקורת שלכם").fill("ביקורת בדיקה ארוכה מספיק כדי לעבור את בדיקת האורך המינימלי.");
  await panel.getByRole("button", { name: "פרסום ביקורת" }).click();
  await panel.getByText("הביקורת לא נשמרה. נסו שוב.").waitFor();
  assert.equal(await panel.getByText("הביקורת פורסמה").count(), 0);
  await shot(panel, "panel-write-failed", { fullPage: true });

  mock.state.submit = "fields";
  await panel.getByRole("button", { name: "פרסום ביקורת" }).click();
  await panel.getByText("הביקורת קצרה מדי. כתבו לפחות 30 תווים (כרגע 5).").waitFor();
  mock.state.submit = "ok";
  await product.close();
  await panel.close();
});

await check("a saved review shows as published only after the server answered, then appears as mine", async () => {
  mock.state.submit = "ok";
  const { product, panel } = await openPanel("w817260002");
  await panel.waitForSelector(".sb-review");
  await panel.getByRole("button", { name: "כתיבת ביקורת" }).click();
  await panel.getByRole("group", { name: "דירוג כללי" }).getByLabel("5 כוכבים").check({ force: true });
  await panel.getByLabel("גדול").check({ force: true });
  await panel.getByLabel("מתי קניתם?").selectOption({ index: 1 });
  await panel.getByLabel("כותרת (לא חובה)").fill("כותרת בדיקה");
  await panel.getByLabel("הביקורת שלכם").fill("ביקורת בדיקה ארוכה מספיק כדי לעבור את בדיקת האורך המינימלי.");
  await panel.getByRole("button", { name: "פרסום ביקורת" }).click();
  await panel.getByText("הביקורת פורסמה").waitFor();
  const sent = JSON.parse(mock.state.requests.filter((r) => r.path.endsWith("submit-review")).at(-1).body);
  assert.equal(sent.rating, 5);
  assert.equal(sent.parentSku, "w81726");
  assert.equal(sent.sku, "w817260002");
  assert.equal(sent.answers.fit, "large");
  assert.match(sent.purchaseMonth, /^\d{4}-\d{2}-01$/);
  assert.equal(sent.product.name, "מכנסי בדיקה");
  await shot(panel, "panel-write-success");
  await panel.getByRole("button", { name: "חזרה לביקורות" }).last().click();
  await panel.getByRole("button", { name: "עריכת הביקורת שלי" }).waitFor();
  assert.ok(await panel.getByRole("button", { name: "מחיקה" }).isVisible());
  await shot(panel, "panel-reviews-with-mine", { fullPage: true });
  await product.close();
  await panel.close();
});

await check("reporting needs a reason, confirms only after the server accepted, and handles the nickname step", async () => {
  mock.state.myReview = null;
  const { product, panel } = await openPanel("w817260002");
  await panel.waitForSelector(".sb-review");
  await panel.getByRole("button", { name: "דיווח" }).first().click();
  await panel.getByRole("button", { name: "שליחת דיווח" }).click();
  await panel.getByText("בחרו סיבה לדיווח.").waitFor();
  await panel.getByLabel("ספאם או פרסומת").check({ force: true });
  await panel.getByRole("button", { name: "שליחת דיווח" }).click();
  await panel.getByText("הדיווח התקבל").waitFor();
  await shot(panel, "panel-report-sent");

  mock.state.nickname = null;
  await panel.reload();
  await panel.waitForSelector(".sb-review");
  await panel.getByRole("button", { name: "כתיבת ביקורת" }).click();
  await panel.getByRole("heading", { name: "בחירת כינוי" }).waitFor();
  await panel.getByLabel("כינוי").fill("תפוס");
  await panel.getByRole("button", { name: "שמירת כינוי" }).click();
  await panel.getByText("הכינוי הזה תפוס. בחרו כינוי אחר.").waitFor();
  await panel.getByLabel("כינוי").fill("שם חדש");
  await panel.getByRole("button", { name: "שמירת כינוי" }).click();
  await panel.getByRole("heading", { name: "כתיבת ביקורת" }).waitFor();
  mock.state.nickname = "דנה_בדיקה";
  await product.close();
  await panel.close();
});

await check("the panel passes the accessibility audit in its main states", async () => {
  const { product, panel } = await openPanel("w817260002");
  await panel.waitForSelector(".sb-review");
  const list = await runAxe(panel, "panel-list");
  assert.deepEqual(list, [], JSON.stringify(list));
  await panel.getByRole("button", { name: "כתיבת ביקורת" }).click();
  await panel.getByRole("heading", { name: "כתיבת ביקורת" }).waitFor();
  const form = await runAxe(panel, "panel-form");
  assert.deepEqual(form, [], JSON.stringify(form));
  await product.close();
  await panel.close();
});

console.log("\nPrice tracking");

await check("the strip shows the price, the lowest price of 90 days and a tracking button", async () => {
  const page = await productPage("w817260002");
  await stripOf(page);
  await page.waitForFunction(() => document.querySelector("smartbuy-strip")?.shadowRoot?.textContent?.includes("הכי נמוך"), null, { timeout: 8000 });
  const text = await stripText(page);
  for (const expected of ["₪149.90", "הכי נמוך ב-90 יום", "מעקב מחיר"]) assert.ok(text.includes(expected), `missing "${expected}" in: ${text}`);
  await shot(page, "strip-price");
  const violations = await runAxe(page, "strip-price", "smartbuy-strip");
  assert.deepEqual(violations, [], JSON.stringify(violations));
  await page.close();
});

await check("the panel's price tab draws the history, rejects a target at or above the price, and saves a watch only after the server confirmed", async () => {
  mock.state.watches = [];
  const { product, panel } = await openPanel("w817260002");
  await panel.getByRole("tab", { name: "מחיר ומעקב" }).click();
  await panel.getByRole("img", { name: /מחיר/ }).waitFor();
  const text = await panel.locator("body").innerText();
  for (const expected of ["₪149.90", "הכי נמוך ב-90 יום"]) assert.ok(text.includes(expected), `missing "${expected}"`);
  await shot(panel, "panel-tracking", { fullPage: true });

  await panel.getByLabel(/מחיר יעד/).fill("200");
  await panel.getByRole("button", { name: "שמירת מעקב" }).click();
  await panel.getByText(/צריך להיות נמוך מהמחיר הנוכחי/).first().waitFor();
  assert.equal(mock.state.watches.length, 0, "nothing should be saved for an invalid target");

  await panel.getByLabel(/מחיר יעד/).fill("120");
  await panel.getByRole("button", { name: "שמירת מעקב" }).click();
  await panel.getByText("המעקב נשמר").waitFor();
  assert.equal(mock.state.watches.length, 1);
  assert.equal(Number(mock.state.watches[0].target_price), 120);
  await panel.getByText(/עוקבים: מחיר יעד ₪120/).waitFor();
  const violations = await runAxe(panel, "panel-tracking");
  assert.deepEqual(violations, [], JSON.stringify(violations));
  await product.close();
  await panel.close();
});

await check("a failed save of a watch is reported as failed", async () => {
  mock.state.watches = [];
  const { product, panel } = await openPanel("w817260002");
  await panel.getByRole("tab", { name: "מחיר ומעקב" }).click();
  await panel.getByLabel(/מחיר יעד/).fill("100");
  await panel.route("**/rest/v1/watches*", (route) => route.abort());
  await panel.getByRole("button", { name: "שמירת מעקב" }).click();
  await panel.getByText(/המעקב לא נשמר/).waitFor();
  assert.equal(await panel.getByText("המעקב נשמר").count(), 0);
  await product.close();
  await panel.close();
});

await check("the popup lists watches and stopping one removes it on the server", async () => {
  mock.state.watches = [{ id: 40, user_id: "x", product_id: 1, variant_id: 11, target_price: "120", drop_percent: null, notify_restock: false, restock_variant_values: null, active: true }];
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 560 });
  await page.goto(env.extUrl("popup.html"));
  await page.getByText("מוצרים במעקב").waitFor();
  await page.getByText("יעד ₪120").waitFor();
  await shot(page, "popup-watches");
  await page.getByRole("button", { name: "הפסקת מעקב" }).click();
  await page.getByText(/עוד אין מוצרים במעקב/).waitFor();
  assert.equal(mock.state.watches.length, 0);
  const violations = await runAxe(page, "popup-watches");
  assert.deepEqual(violations, [], JSON.stringify(violations));
  await page.close();
});

await check("settings: notification preferences are saved on the server and confirmed", async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 800, height: 1000 });
  await page.goto(env.extUrl("options.html"));
  await page.getByRole("heading", { name: "על מה להתריע" }).waitFor();
  await page.getByRole("switch", { name: "ירידה של אחוז שהגדרתי" }).click({ force: true });
  await page.getByText("ההגדרה נשמרה.").waitFor();
  assert.equal(mock.state.prefs.find((x) => x.kind === "price_drop").enabled, false);
  await page.getByRole("switch", { name: "שעות שקטות" }).click({ force: true });
  await page.getByText("ההגדרה נשמרה.").waitFor();
  assert.deepEqual(mock.state.profileExtra.quiet_hours, { from: "22:00", to: "08:00" });
  await shot(page, "options-notifications", { fullPage: true });
  const violations = await runAxe(page, "options-notifications");
  assert.deepEqual(violations, [], JSON.stringify(violations));
  await page.close();
});

console.log("\nPopup, settings and welcome");

await check("popup (signed in) shows the empty waiting list and the quiet-mode switch", async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 520 });
  await page.goto(env.extUrl("popup.html"));
  await page.getByText("אין כרגע מוצרים שממתינים לביקורת").waitFor();
  const sw = page.getByRole("switch", { name: /מצב שקט/ });
  assert.equal(await sw.isChecked(), false);
  await sw.check({ force: true });
  await page.waitForFunction(() => document.querySelector('[role=switch]').checked === true);
  await shot(page, "popup-signed-in");
  const violations = await runAxe(page, "popup");
  assert.deepEqual(violations, [], JSON.stringify(violations));
  await page.close();
});

await check("popup lists a product waiting for a review and saves a quick rating", async () => {
  mock.state.pending = [{ order_item_id: 7, due_at: "2026-10-01T00:00:00Z", products: { id: 1, site_id: "terminalx", parent_sku: "w81726", name: "חולצת בדיקה", image_url: null, url: "https://www.terminalx.com/w817260002", product_type: "apparel" }, order_items: { sku: "w817260002" } }];
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 520 });
  await page.goto(env.extUrl("popup.html"));
  await page.getByText("חולצת בדיקה").waitFor();
  await page.getByLabel("4 כוכבים").check({ force: true });
  await page.getByText("הדירוג נשמר").waitFor();
  const sent = JSON.parse(mock.state.requests.filter((r) => r.path.endsWith("submit-review")).at(-1).body);
  assert.equal(sent.body, null);
  assert.equal(sent.rating, 4);
  await shot(page, "popup-pending");
  mock.state.pending = [];
  await page.close();
});

await check("settings page lists the store with its state and the account controls", async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto(env.extUrl("options.html"));
  await page.getByRole("heading", { name: "הגדרות SmartBuy" }).waitFor();
  await page.getByText("tester@example.invalid", { exact: true }).waitFor();
  const text = await page.locator("body").innerText();
  for (const expected of ["Terminal X", "ביטול גישה", "tester@example.invalid", "ייצוא המידע שלי", "מחיקת החשבון", "אין לו קשר לחנויות"]) assert.ok(text.includes(expected), `missing "${expected}"`);
  await shot(page, "options", { fullPage: true });
  const violations = await runAxe(page, "options");
  assert.deepEqual(violations, [], JSON.stringify(violations));
  await page.close();
});

await check("welcome page explains the permission and what is not collected", async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto(env.extUrl("welcome.html"));
  const text = await page.locator("body").innerText();
  for (const expected of ["ברוכים הבאים", "איזו חנות להפעיל?", "מה אנחנו לא אוספים", "היסטוריית גלישה"]) assert.ok(text.includes(expected), `missing "${expected}"`);
  await shot(page, "welcome", { fullPage: true });
  const violations = await runAxe(page, "welcome");
  assert.deepEqual(violations, [], JSON.stringify(violations));
  await page.close();
});

await check("no anonymous event carries both a product and an install or user id", async () => {
  const events = mock.state.requests.filter((r) => r.path.endsWith("/functions/v1/events")).map((r) => JSON.parse(r.body));
  assert.ok(events.length > 0);
  for (const e of events.filter((x) => x.event === "product_view")) assert.equal(e.installId, undefined, "product_view must not carry an install id");
  assert.ok(events.some((e) => e.event === "first_product_view" && e.parentSku === undefined));
});

await check("viewing a product queues an anonymous price report that is sent in a batch", async () => {
  const queued = await worker.evaluate(async () => ((await chrome.storage.session.get("priceQueue")).priceQueue ?? []).length);
  const sentAlready = mock.state.priceReports.length;
  assert.ok(queued > 0 || sentAlready > 0, "no price observation was queued");
  const deadline = Date.now() + 90_000;
  while (mock.state.priceReports.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 1000));
  assert.ok(mock.state.priceReports.length > 0, "the batch was never sent");
  const report = mock.state.priceReports[0];
  assert.ok(typeof report.installId === "string" && report.installId.length > 0);
  assert.ok(report.items.length > 0);
  for (const item of report.items) assert.equal(item.userId, undefined, "price reports must not carry a user");
});

console.log("");
await env.close();
const failed = results.filter((r) => !r.ok);
const violationCount = a11y.reduce((n, r) => n + r.violations.length, 0);
console.log(`${results.length - failed.length}/${results.length} checks passed. Accessibility audits: ${a11y.length}, violations: ${violationCount}.`);
if (violationCount) for (const r of a11y.filter((x) => x.violations.length)) console.log(r.label, JSON.stringify(r.violations, null, 1));
process.exit(failed.length ? 1 : 0);
