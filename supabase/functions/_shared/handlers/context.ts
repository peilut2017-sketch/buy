import type { AuthUser, HttpResult } from "../http.ts";
import { BLOCKED, UNAUTHENTICATED, fail } from "../http.ts";
import type { ProfileRow, Store } from "../store.ts";

export interface Ctx {
  /** The signed-in user, from a verified token. Null for anonymous calls. */
  user: AuthUser | null;
  now: Date;
  store: Store;
  /** Server secret for hashing order numbers. */
  pepper?: string;
}

export type Handler = (ctx: Ctx, body: unknown) => Promise<HttpResult>;

/** The signed-in, unblocked user's profile, or the response to send instead. */
export async function requireProfile(ctx: Ctx, opts: { nickname?: boolean } = {}): Promise<{ profile: ProfileRow } | { response: HttpResult }> {
  if (!ctx.user) return { response: UNAUTHENTICATED };
  const profile = await ctx.store.getProfile(ctx.user.id);
  if (!profile) return { response: fail(403, "החשבון לא נמצא. התחברו מחדש.") };
  if (profile.blockedAt) return { response: BLOCKED };
  if (opts.nickname && !profile.displayName) return { response: fail(403, "בחרו כינוי לפני כתיבת ביקורת.") };
  return { profile };
}

const SKU = /^[a-z0-9_-]{3,40}$/i;

export function cleanSku(value: unknown): string | null {
  return typeof value === "string" && SKU.test(value.trim()) ? value.trim().toLowerCase() : null;
}

/** Only http(s) addresses of reasonable length are stored. Anything else is dropped, never repaired. */
export function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function cleanLabel(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : text.slice(0, max);
}

/** { "מידה": "M" } with sane limits. Keys and values are short strings, at most ten pairs. */
export function cleanVariantValues(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 10)) {
    const key = cleanLabel(k, 40);
    const val = cleanLabel(v, 60);
    if (key && val) out[key] = val;
  }
  return out;
}

/** The parent model SKU. The store's own rule decides when one is configured; otherwise it must be a prefix of the SKU. */
export function checkParentSku(sku: string, parentSku: string, fromSkuRule: string | undefined): boolean {
  if (fromSkuRule) {
    try {
      return new RegExp(fromSkuRule, "i").exec(sku)?.[1]?.toLowerCase() === parentSku;
    } catch {
      return false;
    }
  }
  return parentSku.length >= 3 && sku.startsWith(parentSku);
}
