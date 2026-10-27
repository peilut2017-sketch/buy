// Applies the SQL files in supabase/migrations that a database has not had yet. Usage: SUPABASE_DB_URL=... node scripts/apply-migrations.mjs
//
// It keeps its own list in public._smartbuy_migrations. A database that was set up by pasting SQL (before this list
// existed) is recognised by what is already in it, so only the missing migrations run. Each file runs in one
// transaction: a failure leaves the database as it was and stops the run.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.log("SUPABASE_DB_URL is not set: skipping migrations.");
  process.exit(0);
}

/** What each migration leaves behind, so a database without the list can be matched to the files. */
const PROBES = {
  "0001_init.sql": "select to_regclass('public.sites') is not null as ok",
  "0002_tracking_notifications.sql": "select to_regclass('public.price_outlier_candidates') is not null as ok",
  "0003_weekly_digest.sql": "select to_regprocedure('public.enqueue_weekly_digest(timestamptz)') is not null as ok",
  "0004_admin_tracking_analytics.sql": "select to_regclass('public.admin_retention') is not null as ok",
  "0005_terms_acceptance.sql": "select exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='terms_version') as ok",
  "0006_optional_answers.sql": "select exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='delivery_estimated') as ok",
};

const dir = resolve(import.meta.dirname, "../supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const sql = postgres(url, { max: 1, onnotice: () => undefined, connect_timeout: 20 });

try {
  const [existing] = await sql`select to_regclass('public._smartbuy_migrations') is not null as ok`;
  if (!existing.ok) {
    await sql`create table public._smartbuy_migrations (name text primary key, applied_at timestamptz not null default now())`;
    await sql`alter table public._smartbuy_migrations enable row level security`; // no policy: only the owner role reads it
    let recognised = 0;
    for (const file of files) {
      const probe = PROBES[file];
      if (!probe) continue;
      const [row] = await sql.unsafe(probe);
      if (row.ok) {
        await sql`insert into public._smartbuy_migrations (name) values (${file}) on conflict do nothing`;
        recognised++;
      }
    }
    console.log(`First run on this database: ${recognised} migration(s) already in place.`);
  }

  const done = new Set((await sql`select name from public._smartbuy_migrations`).map((r) => r.name));
  const todo = files.filter((f) => !done.has(f));
  if (todo.length === 0) console.log("Database is up to date.");
  for (const file of todo) {
    console.log(`Applying ${file} ...`);
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(resolve(dir, file), "utf8"));
      await tx`insert into public._smartbuy_migrations (name) values (${file})`;
    });
  }
  if (todo.length > 0) console.log(`Applied ${todo.length} migration(s).`);
} catch (error) {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
