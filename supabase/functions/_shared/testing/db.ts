// A throwaway PostgreSQL database with the real migration applied, for integration tests of the handlers.
// Set SB_TEST_DB_URL to a server you may create databases on, for example
//   postgres://postgres@127.0.0.1:5432/postgres
// Without it the integration tests are skipped. On plain Postgres the Supabase stand-in (tests/local_stub.sql) is applied first.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import type { Sql } from "../store.sql.ts";

const root = resolve(__dirname, "../../../..");

export const TEST_DB_URL = process.env.SB_TEST_DB_URL ?? "";

export interface TestDb {
  sql: Sql;
  raw: ReturnType<typeof postgres>;
  drop(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const admin = postgres(TEST_DB_URL, { max: 1, onnotice: () => undefined });
  const name = `sb_fn_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.unsafe(`create database ${name}`);
  const url = new URL(TEST_DB_URL);
  url.pathname = `/${name}`;
  const raw = postgres(url.toString(), { max: 4, onnotice: () => undefined });

  const hasSupabase = (await raw`select 1 from information_schema.schemata where schema_name = 'auth'`).length > 0;
  if (!hasSupabase) await raw.unsafe(readFileSync(resolve(root, "supabase/tests/local_stub.sql"), "utf8"));
  // Every migration, in order, exactly as a real project would apply them.
  const migrations = resolve(root, "supabase/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    await raw.unsafe(readFileSync(resolve(migrations, file), "utf8"));
  }

  return {
    sql: raw as unknown as Sql,
    raw,
    async drop() {
      await raw.end({ timeout: 2 });
      await admin.unsafe(`drop database ${name} with (force)`);
      await admin.end({ timeout: 2 });
    },
  };
}
