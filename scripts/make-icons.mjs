// Renders the extension icon (the size-fit motif: a thin line and a filled dot) to PNGs at the sizes Chrome needs.
// Usage: node scripts/make-icons.mjs   (needs Playwright's Chromium)
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const out = resolve(import.meta.dirname, "../apps/extension/public/icon");
mkdirSync(out, { recursive: true });

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#0870D0"/>
  <rect x="24" y="61" width="80" height="6" rx="3" fill="#FFFFFF" fill-opacity="0.55"/>
  <circle cx="82" cy="64" r="20" fill="#FFFFFF"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of [16, 32, 48, 96, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent">${svg(size)}</body>`);
  writeFileSync(resolve(out, `${size}.png`), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
}
await browser.close();
console.log("icons written to", out);
