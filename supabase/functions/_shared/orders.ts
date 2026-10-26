// Order helpers shared by verify-orders and tests. Pure functions over Web Crypto, available in Deno, Node and browsers.
// Privacy (CLAUDE.md rule 7): only a hash of the order number is ever stored, never the number itself.

export interface OrderItemInput {
  sku: string;
}

export interface OrderInput {
  /** The store's order number. Hashed immediately; never persisted. */
  orderNumber: string;
  orderedAt: string | null;   // YYYY-MM-DD
  deliveredAt: string | null; // YYYY-MM-DD
  items: OrderItemInput[];
}

/** "  tx-1234 " and "TX-1234" must hash the same way, so the same order cannot be claimed twice. */
export function normalizeOrderNumber(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** sha256(siteId ":" normalized order number ":" pepper). The pepper is a server secret. */
export async function hashOrderNumber(siteId: string, orderNumber: string, pepper: string): Promise<string> {
  if (pepper.length < 16) throw new Error("order hash pepper is missing or too short");
  const data = new TextEncoder().encode(`${siteId}:${normalizeOrderNumber(orderNumber)}:${pepper}`);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Spec 8: a product enters "waiting for a review" 14 days after delivery. */
export function pendingDueAt(deliveredAt: string, afterDays = 14): string {
  return `${addDays(deliveredAt, afterDays)}T00:00:00Z`;
}

/** Spec 7: a review opens for writing as verified only after the delivery date. */
export function canWriteVerified(deliveredAt: string | null, today: string): boolean {
  return deliveredAt !== null && deliveredAt <= today;
}

export type OrderValidation = { ok: true } | { ok: false; error: string };

export function validateOrderInput(order: OrderInput): OrderValidation {
  if (typeof order.orderNumber !== "string" || normalizeOrderNumber(order.orderNumber).length < 3) {
    return { ok: false, error: "מספר ההזמנה לא תקין." };
  }
  if (order.orderedAt !== null && !isIsoDate(order.orderedAt)) return { ok: false, error: "תאריך ההזמנה לא תקין." };
  if (order.deliveredAt !== null && !isIsoDate(order.deliveredAt)) return { ok: false, error: "תאריך המסירה לא תקין." };
  if (!Array.isArray(order.items) || order.items.length === 0 || order.items.length > 100) {
    return { ok: false, error: "פריטי ההזמנה לא תקינים." };
  }
  if (order.items.some((i) => typeof i.sku !== "string" || i.sku.trim() === "" || i.sku.length > 40)) {
    return { ok: false, error: "מק״ט לא תקין בהזמנה." };
  }
  return { ok: true };
}
