// Typed messages between the content script, the background worker and the extension pages.

import { browser } from "wxt/browser";
import type { AdapterConfig, Confidence, Order, PriceSnapshot, ProductSummary, SiteStatus, VariantOption } from "@smartbuy/core";

export interface ProductSnapshot {
  siteId: string;
  sku: string;
  parentSku: string;
  confidence: Confidence;
  url: string;
  name: string | null;
  brand: string | null;
  imageUrl: string | null;
  price: PriceSnapshot | null;
  /** What is selected on the page right now, for example { "מידה": "M" }. */
  variantValues: Record<string, string>;
  /** Every option group the page offers, so the review form can offer the same choices. */
  variantOptions: VariantOption[];
  /** Which review questions apply: "apparel", "footwear" or "general". */
  productType: string;
  detectedAt: number;
}

export interface SiteConfigResult {
  status: SiteStatus;
  version: number;
  config: AdapterConfig;
  source: "remote" | "cache" | "bundled";
}

/** What happened to the orders the page showed: the toast on the orders page tells the person in plain words. */
export type OrdersOutcome =
  | { status: "ok"; sent: number; accepted: number; alreadyKnown: number; conflicts: number }
  | { status: "signed-out" | "no-consent" | "terms" | "error" };

export type PanelMode = "reviews" | "write" | "tracking";

export interface DetectFailure {
  siteId: string;
  confidence: Confidence;
  conflict: boolean;
  signals: { name: string; value: string | null; agrees: boolean }[];
}

interface Requests {
  "site-config": { req: { siteId: string }; res: SiteConfigResult };
  "product-detected": { req: { product: ProductSnapshot }; res: { ok: true } };
  "product-updated": { req: { product: ProductSnapshot }; res: { ok: true } };
  "product-cleared": { req: Record<string, never>; res: { ok: true } };
  summary: { req: { siteId: string; parentSku: string }; res: { summary: ProductSummary | null } };
  "open-panel": { req: { mode: PanelMode }; res: { ok: boolean } };
  "price-info": { req: { siteId: string; parentSku: string; sku: string }; res: { lowest: { price: number; since: string } | null } };
  "size-advice": { req: { siteId: string; parentSku: string; productType: string; brand: string | null }; res: { advice: { headline: string; support: string } | null } };
  "listing-summaries": { req: { siteId: string; parentSkus: string[] }; res: { summaries: { parentSku: string; reviewsCount: number; ratingAvg: number }[] } };
  "orders-captured": { req: { siteId: string; orders: Order[] }; res: OrdersOutcome };
  "enable-order-check": { req: { siteId: string; orders: Order[] }; res: OrdersOutcome };
  "open-options": { req: Record<string, never>; res: { ok: true } };
  "tab-product": { req: { tabId: number }; res: { product: ProductSnapshot | null; mode: PanelMode | null } };
  "detect-failed": { req: { failure: DetectFailure }; res: { ok: true } };
  "sync-content-scripts": { req: Record<string, never>; res: { registered: string[] } };
}

export type MessageType = keyof Requests;
export type RequestOf<T extends MessageType> = Requests[T]["req"];
export type ResponseOf<T extends MessageType> = Requests[T]["res"];
export type Message = { [T in MessageType]: { type: T } & Requests[T]["req"] }[MessageType];

export async function send<T extends MessageType>(type: T, payload: RequestOf<T>): Promise<ResponseOf<T>> {
  return (await browser.runtime.sendMessage({ type, ...payload })) as ResponseOf<T>;
}
