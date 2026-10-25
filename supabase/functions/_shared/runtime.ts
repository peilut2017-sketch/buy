// Deno entry plumbing for the Edge Functions: CORS, the JSON body, who is calling, and the database connection.
// This is the only file that touches Deno, fetch to the auth service, or the Postgres driver; handlers stay pure.

import postgres from "npm:postgres@3";
import { fail, type AuthUser, type HttpResult } from "./http.ts";
import type { Ctx, Handler } from "./handlers/context.ts";
import { createStore, type Sql } from "./store.sql.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

const env = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
};

let connection: Sql | null = null;
function database(): Sql {
  // `prepare: false` keeps this working behind Supabase's connection pooler.
  connection ??= postgres(env("SUPABASE_DB_URL"), { max: 3, prepare: false }) as unknown as Sql;
  return connection;
}

async function userFromToken(req: Request): Promise<AuthUser | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const res = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, { headers: { apikey: env("SUPABASE_ANON_KEY"), authorization: `Bearer ${token}` } });
  if (!res.ok) return null; // the anon key, an expired token or garbage: not a signed-in user
  const user = (await res.json()) as { id?: string; email?: string };
  return user.id ? { id: user.id, email: user.email ?? null } : null;
}

async function deleteAuthUser(userId: string): Promise<void> {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${env("SUPABASE_URL")}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`could not delete user (${res.status})`);
}

const json = (result: HttpResult): Response =>
  new Response(JSON.stringify(result.body), { status: result.status, headers: { ...CORS, "content-type": "application/json" } });

export function serveHandler(handler: Handler): void {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return json(fail(405, "השיטה לא נתמכת."));

    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }

    try {
      const ctx: Ctx = {
        user: await userFromToken(req),
        now: new Date(),
        store: createStore(database(), { deleteAuthUser }),
        pepper: Deno.env.get("ORDER_HASH_PEPPER"),
      };
      return json(await handler(ctx, body));
    } catch (error) {
      console.error("function failed", error);
      return json(fail(500, "משהו השתבש. נסו שוב."));
    }
  });
}
