// Plain-fetch access to Supabase (PostgREST and Edge Functions). One data path for the background worker and the
// extension pages; supabase-js is used only for sign-in. Reads of public data need no token.

import { BACKEND_CONFIGURED, SUPABASE_ANON_KEY, SUPABASE_URL } from "./env.ts";

export class NetworkError extends Error {
  constructor(message = "network") {
    super(message);
    this.name = "NetworkError";
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NotConfiguredError extends Error {
  constructor() {
    super("backend not configured");
    this.name = "NotConfiguredError";
  }
}

export type Params = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  params?: Params;
  body?: unknown;
  /** The signed-in user's access token. Without it the request runs as the anonymous role. */
  token?: string | null;
  /** PostgREST Prefer header, for example "return=representation". */
  prefer?: string;
  timeoutMs?: number;
}

function headers(token: string | null | undefined, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SUPABASE_ANON_KEY,
    authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}`,
    ...extra,
  };
}

async function execute(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  if (!BACKEND_CONFIGURED) throw new NotConfiguredError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const obj = (json ?? {}) as { message?: string; code?: string; errors?: Record<string, string>; error?: string };
    throw new ApiError(obj.message ?? obj.error ?? `request failed (${res.status})`, res.status, obj.code, obj.errors);
  }
  return json as T;
}

/** A PostgREST call: `rest("reviews", { params: { product_id: "eq.5", select: "*" } })`. */
export async function rest<T>(table: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", params = {}, body, token, prefer, timeoutMs = 15_000 } = options;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  const qs = query.toString();
  const res = await execute(
    `${SUPABASE_URL}/rest/v1/${table}${qs ? `?${qs}` : ""}`,
    {
      method,
      headers: headers(token, {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(prefer ? { prefer } : {}),
      }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    timeoutMs,
  );
  return parse<T>(res);
}

/** An Edge Function call. Errors keep the server's per-field Hebrew messages. */
export async function callFunction<T>(name: string, body: unknown, token?: string | null, timeoutMs = 20_000): Promise<T> {
  const res = await execute(
    `${SUPABASE_URL}/functions/v1/${name}`,
    { method: "POST", headers: headers(token, { "content-type": "application/json" }), body: JSON.stringify(body) },
    timeoutMs,
  );
  return parse<T>(res);
}
