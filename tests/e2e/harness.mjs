// Shared Playwright setup: loads the built extension in Chromium, serves synthetic store pages, and starts the mock backend.
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ANON_KEY, ME, startMock } from "./mock-supabase.mjs";
import { plainPage, productPage } from "./pages/product.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

export const root = resolve(import.meta.dirname, "../..");
export const outDir = resolve(import.meta.dirname, "out");
mkdirSync(outDir, { recursive: true });
export const axeSource = readFileSync(require.resolve("axe-core/axe.min.js", { paths: [root] }), "utf8");

const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#c9d3e6"/><circle cx="100" cy="90" r="40" fill="#8fa3c8"/></svg>`;

/** Which synthetic page each address returns. Query options: theme, name, noimage, hostile. */
function pageFor(url) {
  const sku = url.pathname.slice(1);
  if (!/^[a-z]\d{9}$/.test(sku)) return plainPage();
  const q = url.searchParams;
  return productPage({
    sku,
    theme: q.get("theme") ?? "light",
    name: q.get("name") ?? "מכנסי בדיקה",
    image: q.get("noimage") === null,
    hostile: q.get("hostile") !== null,
  });
}

export async function launch() {
  const extension = resolve(root, "apps/extension/.output-e2e/chrome-mv3");
  const mock = await startMock(54399);
  const userData = mkdtempSync(resolve(tmpdir(), "sb-e2e-"));
  const context = await chromium.launchPersistentContext(userData, {
    headless: false,
    args: ["--headless=new", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--no-first-run"],
    viewport: { width: 1280, height: 900 },
    locale: "he-IL",
  });

  await context.route("https://www.terminalx.com/**", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: pageFor(url) });
  });
  await context.route("https://media.terminalx.com/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: PICTURE }));

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;

  // The content script is registered when the worker starts; give it a moment before the first page load.
  for (let i = 0; i < 50; i++) {
    const count = await worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length);
    if (count > 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    context,
    mock,
    worker,
    extensionId,
    extUrl: (page) => `chrome-extension://${extensionId}/${page}`,
    async close() {
      await context.close();
      mock.close();
    },
  };
}

/** Puts a fake signed-in session where the extension keeps its own, the way a real sign-in would. */
export async function signIn(env) {
  const page = await env.context.newPage();
  await page.goto(env.extUrl("options.html"));
  await page.evaluate(
    async ({ me }) => {
      const now = Math.floor(Date.now() / 1000);
      const session = {
        access_token: "e2e-user-token",
        refresh_token: "e2e-refresh",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: now + 3600,
        user: { id: me, aud: "authenticated", role: "authenticated", email: "tester@example.invalid", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
      };
      await chrome.storage.local.set({ "sb-auth": JSON.stringify(session) });
    },
    { me: ME },
  );
  await page.close();
}

export { ANON_KEY, ME };
