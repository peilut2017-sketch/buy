// Prints the SQL that publishes a store's detection rules to public.sites.
// Usage: node scripts/print-adapter-sql.mjs terminalx   then run the output in the Supabase SQL editor.
// The adapter_version column goes up by itself when the rules change, so clients pick the new copy up.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const id = process.argv[2];
if (!id) {
  console.error("usage: node scripts/print-adapter-sql.mjs <site-id>");
  process.exit(1);
}
const dir = resolve(import.meta.dirname, `../packages/adapters/${id}`);
const site = JSON.parse(readFileSync(resolve(dir, "site.json"), "utf8"));
const config = JSON.stringify(JSON.parse(readFileSync(resolve(dir, "config.json"), "utf8")));
const quote = (text) => `'${text.replace(/'/g, "''")}'`;
console.log(`update public.sites set adapter_config = ${quote(config)}::jsonb where id = ${quote(site.id)};`);
