// Typed messages between the content script, the background worker and the extension pages.

import { browser } from "wxt/browser";
import type { AdapterConfig, Confidence, PriceSnapshot, ProductSummary, SiteStatus, VariantOption } from "@smartbuy/core";

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

export type PanelMode = "reviews" | "write";

export interface DetectFailure {
  siteId: string;
  confidence: Confidence;
  conflict: boolean;
  signals: { name: string; value: string | null; agrees: boolean }[];
}

interface Requests {
  "site-config": { req: { siteId: string }; res: SiteConfigResult };
  "product-detected": { req: { product: ProductSnapshot }; res: { ok: true } };
  "product-cleared": { req: Record<string, never>; res: { ok: true } };
  summary: { req: { siteId: string; parentSku: string }; res: { summary: ProductSummary | null } };
  "open-panel": { req: { mode: PanelMode }; res: { ok: boolean } };
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
