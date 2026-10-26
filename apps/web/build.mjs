// Builds each page into ONE self-contained HTML file: its own CSS and script inlined, plus a Content-Security-Policy
// that allows exactly those two inline blocks by hash. Output: apps/web/dist/, ready for Cloudflare Pages.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const here = import.meta.dirname;
const dist = resolve(here, "dist");

function loadEnv() {
  const out = { ...process.env };
  const file = resolve(here, ".env");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && !line.trim().startsWith("#") && out[match[1]] === undefined) out[match[1]] = match[2];
    }
  }
  return out;
}
const env = loadEnv();
const SB_URL = (env.WEB_SUPABASE_URL ?? "").replace(/\/$/, "");

/** name: output file; entry: module in src/pages; robots: index or not. */
export const PAGES = [
  { name: "index", entry: "home", title: "SmartBuy: ביקורות אמינות לאתרי קניות", description: "ביקורות אמינות ומעקב מחירים לאתרי קניות שאין בהם ביקורות. קראו מה אומרים הקונים לפני שאתם קונים.", robots: "index" },
  { name: "product", entry: "product", title: "ביקורות על המוצר | SmartBuy", description: "ביקורות קונים על מוצר, כולל התאמת מידה ואימות רכישה.", robots: "index" },
  { name: "account", entry: "account", title: "החשבון שלי | SmartBuy", description: "הביקורות, ההגדרות והמידע שלכם.", robots: "noindex" },
  { name: "takedown", entry: "takedown", title: "בקשת הסרה | SmartBuy", description: "בקשה להסרת ביקורת או תוכן מהשירות.", robots: "index" },
  { name: "bye", entry: "bye", title: "תודה שניסיתם | SmartBuy", description: "מה גרם לכם להסיר את התוסף?", robots: "noindex" },
  { name: "how-it-works", entry: "how", title: "איך זה עובד | SmartBuy", description: "איך הביקורות נאספות, מאומתות ומוצגות, ומה אנחנו לא עושים.", robots: "index" },
  { name: "privacy", entry: "privacy", title: "מדיניות פרטיות | SmartBuy", description: "איזה מידע נשמר, למה, ואיך אפשר לייצא או למחוק אותו.", robots: "index" },
  { name: "terms", entry: "terms", title: "תנאי שימוש | SmartBuy", description: "תנאי השימוש בשירות.", robots: "index" },
  { name: "accessibility", entry: "accessibility", title: "הצהרת נגישות | SmartBuy", description: "הצהרת הנגישות של האתר והתוסף.", robots: "index" },
  { name: "admin", entry: "admin", title: "ניהול | SmartBuy", description: "לוח ניהול.", robots: "noindex" },
];

const sha = (text) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

async function bundle(entry) {
  const result = await esbuild.build({
    entryPoints: [resolve(here, `src/pages/${entry}.tsx`)],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2022",
    minify: true,
    legalComments: "none",
    jsx: "automatic",
    jsxImportSource: "preact",
    loader: { ".css": "text" },
    define: {
      __SB_URL__: JSON.stringify(SB_URL),
      __SB_ANON_KEY__: JSON.stringify(env.WEB_SUPABASE_ANON_KEY ?? ""),
      __SB_STORE_URL__: JSON.stringify(env.WEB_EXTENSION_STORE_URL ?? ""),
      "process.env.NODE_ENV": '"production"',
    },
  });
  return result.outputFiles[0].text;
}

const css = ["@smartbuy/ui/src/tokens.css", "@smartbuy/ui/src/base.css", "@smartbuy/ui/src/reviews.css"]
  .map((spec) => readFileSync(resolve(here, spec.replace("@smartbuy/ui/", "../../packages/ui/")), "utf8"))
  .concat(readFileSync(resolve(here, "src/web.css"), "utf8"))
  .join("\n");

const escapeHtml = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export async function build() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  const connect = SB_URL ? ` ${SB_URL}` : "";
  const sizes = [];
  for (const page of PAGES) {
    const script = (await bundle(page.entry)).replace(/<\/script/gi, "<\\/script");
    const csp = [
      "default-src 'none'",
      `script-src ${sha(script)}`,
      `style-src ${sha(css)}`,
      "img-src https: data:",
      `connect-src 'self'${connect}`,
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
    const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
<title>${escapeHtml(page.title)}</title>
<meta name="description" content="${escapeHtml(page.description)}">
<meta name="robots" content="${page.robots === "index" ? "index, follow" : "noindex, nofollow"}">
<meta name="theme-color" content="#F5F6F8">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'%3E%3Crect width='128' height='128' rx='28' fill='%230870D0'/%3E%3Crect x='24' y='61' width='80' height='6' rx='3' fill='%23fff' fill-opacity='.55'/%3E%3Ccircle cx='82' cy='64' r='20' fill='%23fff'/%3E%3C/svg%3E">
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script>${script}</script>
</body>
</html>`;
    writeFileSync(resolve(dist, `${page.name}.html`), html);
    sizes.push(`${page.name}.html ${(html.length / 1024).toFixed(0)} kB`);
  }
  cpSync(resolve(here, "public"), dist, { recursive: true });
  return sizes;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sizes = await build();
  console.log(`web built (${SB_URL ? "backend configured" : "NO backend configured"}):\n  ${sizes.join("\n  ")}`);
}
