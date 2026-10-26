// Builds the website pointed at the mock backend for the end-to-end tests.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const result = spawnSync("pnpm", ["--filter", "@smartbuy/web", "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, WEB_SUPABASE_URL: "http://127.0.0.1:54399", WEB_SUPABASE_ANON_KEY: "e2e-anon-key", WEB_EXTENSION_STORE_URL: "" },
});
process.exit(result.status ?? 1);
