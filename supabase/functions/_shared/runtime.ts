// Deno entry plumbing for the Edge Functions: CORS, the JSON body, who is calling, and the database connection.
// This is the only file that touches Deno, fetch to the auth service, or the Postgres driver; handlers stay pure.

import * as hebcal from "npm:@hebcal/core@5";
import postgres from "npm:postgres@3";
import { fail, type AuthUser, type HttpResult } from "./http.ts";
import type { Ctx, Handler } from "./handlers/context.ts";
import { createSenders } from "./senders.ts";
import type { HebcalLike } from "./shabbat.ts";
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

/** Compares without stopping at the first difference, so the time taken does not reveal how much matched. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
      const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      const isService = sameSecret(bearer, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
      const ctx: Ctx = {
        user: isService ? null : await userFromToken(req),
        now: new Date(),
        store: createStore(database(), { deleteAuthUser }),
        pepper: Deno.env.get("ORDER_HASH_PEPPER"),
        isService,
        webhookVerified: sameSecret(req.headers.get("x-telegram-bot-api-secret-token") ?? "", Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? ""),
        senders: createSenders({
          fetch: (url, init) => fetch(url, init),
          telegramToken: Deno.env.get("TELEGRAM_BOT_TOKEN"),
          resendKey: Deno.env.get("RESEND_API_KEY"),
          emailFrom: Deno.env.get("EMAIL_FROM"),
          settingsUrl: Deno.env.get("WEBSITE_URL") ? `${Deno.env.get("WEBSITE_URL")}/account` : undefined,
        }),
        hebcal: hebcal as unknown as HebcalLike,
        telegramBotUsername: Deno.env.get("TELEGRAM_BOT_USERNAME"),
        adminChatId: Deno.env.get("ADMIN_TELEGRAM_CHAT_ID"),
        websiteUrl: Deno.env.get("WEBSITE_URL"),
        // The price check says who it is and where to complain, and gives up quickly on a slow page.
        fetchPage: async (url) => {
          const res = await fetch(url, {
            headers: { "user-agent": `SmartBuyPriceCheck/1.0 (+${Deno.env.get("WEBSITE_URL") ?? "https://smartbuy.invalid"}/how-it-works)`, "accept-language": "he-IL,he;q=0.9" },
            redirect: "follow",
            signal: AbortSignal.timeout(20_000),
          });
          return { status: res.status, text: res.status === 200 ? await res.text() : "" };
        },
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      };
      return json(await handler(ctx, body));
    } catch (error) {
      console.error("function failed", error);
      return json(fail(500, "משהו השתבש. נסו שוב."));
    }
  });
}
