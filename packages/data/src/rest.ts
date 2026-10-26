// Plain-fetch access to Supabase (PostgREST and Edge Functions). One data path for the background worker and the
// extension pages; supabase-js is used only for sign-in. Reads of public data need no token.


export interface BackendConfig {
  url: string;
  anonKey: string;
}

let backend: BackendConfig = { url: "", anonKey: "" };

/** Call once at start-up, with the Supabase URL and the public anon key. */
export function configureBackend(config: BackendConfig): void {
  backend = { url: config.url.replace(/\/$/, ""), anonKey: config.anonKey };
}

export const isBackendConfigured = (): boolean => backend.url !== "" && backend.anonKey !== "";

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
    apikey: backend.anonKey,
    authorization: `Bearer ${token ?? backend.anonKey}`,
    ...extra,
  };
}

async function execute(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  if (!isBackendConfigured()) throw new NotConfiguredError();
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
    `${backend.url}/rest/v1/${table}${qs ? `?${qs}` : ""}`,
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
    `${backend.url}/functions/v1/${name}`,
    { method: "POST", headers: headers(token, { "content-type": "application/json" }), body: JSON.stringify(body) },
    timeoutMs,
  );
  return parse<T>(res);
}

/** Number of rows matching the filters, without fetching them (PostgREST `Prefer: count=exact`). */
export async function restCount(table: string, params: Params = {}, token?: string | null): Promise<number> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  const res = await execute(
    `${backend.url}/rest/v1/${table}?${query.toString()}`,
    { method: "HEAD", headers: headers(token, { prefer: "count=exact", range: "0-0", "range-unit": "items" }) },
    15_000,
  );
  if (!res.ok) throw new ApiError(`request failed (${res.status})`, res.status);
  const total = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1];
  return total === undefined ? 0 : Number(total);
}
