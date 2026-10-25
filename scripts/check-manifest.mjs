// Builds the release extension and checks the rules that must hold for every release (CLAUDE.md hard rules 3, 4, 10).
// Run: node scripts/check-manifest.mjs
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ext = join(root, "apps/extension");
const build = spawnSync("pnpm", ["--filter", "@smartbuy/extension", "build"], { cwd: root, stdio: "ignore", env: { ...process.env, SB_E2E: "", WXT_E2E: "" } });
if (build.status !== 0) {
  console.error("release build failed");
  process.exit(1);
}

const out = join(ext, ".output/chrome-mv3");
const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
const site = JSON.parse(readFileSync(join(root, "packages/adapters/terminalx/site.json"), "utf8"));
const problems = [];
const expect = (ok, message) => ok || problems.push(message);

expect(manifest.manifest_version === 3, "must be Manifest V3");
expect(JSON.stringify(manifest.host_permissions ?? []) === "[]", `install must request no host access, got ${JSON.stringify(manifest.host_permissions)}`);
expect(JSON.stringify(manifest.optional_host_permissions) === JSON.stringify([site.hostPermission]), "store hosts must be optional host permissions only");
expect(!manifest.content_scripts, "content scripts must be registered at runtime, not in the manifest");
expect(JSON.stringify([...manifest.permissions].sort()) === JSON.stringify(["identity", "scripting", "sidePanel", "storage"]), `unexpected permissions: ${manifest.permissions}`);
expect(!manifest.web_accessible_resources, "nothing should be web accessible");
for (const size of ["16", "32", "48", "128"]) expect(manifest.icons?.[size] && existsSync(join(out, manifest.icons[size])), `icon ${size} missing`);

// No remote code and no secrets in the bundle.
function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(js|html|json)$/.test(name)) yield path;
  }
}
for (const file of files(out)) {
  const text = readFileSync(file, "utf8");
  expect(!/service_role|SERVICE_ROLE|ORDER_HASH_PEPPER|TELEGRAM_BOT_TOKEN/.test(text), `${file} mentions a server secret name`);
  expect(!/<script[^>]+src=["']https?:/.test(text), `${file} loads a remote script`);
}

if (problems.length) {
  console.error(problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log("Manifest check passed: no host access at install, store hosts optional, runtime-registered content script, no secrets.");
