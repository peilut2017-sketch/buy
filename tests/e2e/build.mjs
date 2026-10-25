// Builds the test variant of the extension (granted store host, panel can be pointed at a tab, mock backend URL).
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const result = spawnSync("pnpm", ["--filter", "@smartbuy/extension", "build"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    SB_E2E: "1",
    WXT_E2E: "1",
    WXT_SUPABASE_URL: "http://127.0.0.1:54399",
    WXT_SUPABASE_ANON_KEY: "e2e-anon-key",
  },
});
process.exit(result.status ?? 1);
