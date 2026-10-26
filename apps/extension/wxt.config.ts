import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import preact from "@preact/preset-vite";
import { defineConfig } from "wxt";

// Store host permissions come from each adapter's site.json: one source for the manifest and the code.
const sites: { hostPermission: string }[] = ["terminalx"].map((id) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../packages/adapters/${id}/site.json`), "utf8")),
);

// Test builds only (SB_E2E=1): grant the store at install so Playwright can run without a permission prompt,
// and let the side panel be pointed at a tab. Never used for a release build.
const e2e = process.env.SB_E2E === "1";

export default defineConfig({
  outDir: e2e ? ".output-e2e" : ".output",
  vite: () => ({ plugins: [preact()] }),
  hooks: {
    // WXT copies the content script's `matches` into host_permissions. Ours is registered at runtime, after the user
    // grants a store, so the install must ask for no host access at all (CLAUDE.md rule 4).
    "build:manifestGenerated": (_wxt, manifest) => {
      manifest.host_permissions = e2e ? sites.map((s) => s.hostPermission) : [];
    },
  },
  manifest: {
    name: "SmartBuy",
    description: "ביקורות אמינות ומעקב מחירים לאתרי קניות. שירות עצמאי, ללא קשר לחנויות.",
    minimum_chrome_version: "114",
    // Each permission has one stated purpose (docs/03-architecture.md, Chrome Web Store section).
    permissions: ["storage", "sidePanel", "scripting", "identity", "alarms", "notifications"],
    // Store domains are optional and requested at runtime, so adding a store never disables the extension for existing users.
    optional_host_permissions: sites.map((s) => s.hostPermission),
    host_permissions: [],
    action: { default_title: "SmartBuy" },
  },
});
