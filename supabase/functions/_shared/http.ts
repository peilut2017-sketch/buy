// Request and response plumbing shared by the handlers. Pure: no Deno or database access.

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface HttpResult {
  status: number;
  body: unknown;
}

export const ok = (body: unknown = { ok: true }): HttpResult => ({ status: 200, body });
export const fail = (status: number, message: string, errors?: Record<string, string>): HttpResult => ({
  status,
  body: errors ? { message, errors } : { message },
});

export const UNAUTHENTICATED = fail(401, "צריך להתחבר כדי לבצע את הפעולה.");
export const BLOCKED = fail(403, "החשבון חסום. לבירור פנו אלינו דרך האתר.");
export const NOT_FOUND = fail(404, "לא מצאנו את מה שחיפשתם.");
export const BAD_REQUEST = fail(400, "הבקשה לא תקינה.");

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function str(value: unknown, max = 500): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

export function posInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export function dayStart(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

export function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}
