// Shared types. No store is named in this package: every store-specific fact lives in packages/adapters/<site>.

import type { ReviewerLevel } from "../../../supabase/functions/_shared/moderation.ts";

export type Confidence = "high" | "medium" | "low" | "none";

export interface Signal {
  /** Which independent signal this is: "url", "canonical", "ogUrl", "image", "jsonLd", ... */
  name: string;
  /** The SKU the signal points to, or null when the signal is absent or unreadable. */
  value: string | null;
  /** True when the value equals the SKU the detection settled on. */
  agrees: boolean;
}

export interface Detection {
  siteId: string;
  /** Full SKU, including the variant part. */
  sku: string | null;
  /** Parent model SKU: reviews belong to this. */
  parentSku: string | null;
  confidence: Confidence;
  signals: Signal[];
  /** The URL SKU was contradicted by two or more verification signals. Reported to the admin (spec 4, rule 3). */
  conflict: boolean;
}

export interface VariantOptionValue {
  value: string;
  selected: boolean;
  available: boolean;
}

/** One selectable group on the product page, for example colour or size. Read from the page, never predefined. */
export interface VariantOption {
  name: string;
  values: VariantOptionValue[];
}

/** The selected value of each group, for example { "מידה": "M" }. */
export type VariantValues = Record<string, string>;

export interface PriceSnapshot {
  price: number | null;
  regularPrice: number | null;
  currency: string;
  inStock: boolean | null;
}

export interface ListingCard {
  sku: string;
  element: Element;
}

export interface OrderItem {
  sku: string;
  variant?: VariantValues;
}

export interface Order {
  orderNumber: string;
  orderedAt: string | null;
  deliveredAt: string | null;
  items: OrderItem[];
}

/** One DOM signal that confirms the SKU. All values are data shipped from the server. */
export interface SignalRule {
  selector: string;
  /** Attribute to read. When omitted, the element's text content is used. */
  attr?: string;
  /** Regular expression whose first capture group is the SKU. */
  skuRegex: string;
}

export interface JsonLdRule {
  /** schema.org @type to look for, for example "Product". */
  type: string;
  /** Dot path to the SKU inside the object. */
  skuPath: string;
  skuRegex?: string;
}

export interface VariantRules {
  groups: string;
  label: string;
  option: string;
  selected: string;
  unavailable?: string;
}

export interface PriceRules {
  selector: string;
  regularSelector?: string;
  currency?: string;
}

export interface StockRules {
  inStockSelector?: string;
  outOfStockSelector?: string;
}

export interface ListingRules {
  card: string;
  /** Selector inside a card for the element whose href carries the SKU. */
  link: string;
}

/**
 * Detection rules for one store, shipped from `sites.adapter_config` with a bundled fallback.
 * Data only: Manifest V3 forbids remote code.
 */
export interface AdapterConfig {
  /** Regular expression on the URL pathname. The first capture group is the SKU. */
  productUrl: string;
  signals: {
    canonical?: SignalRule;
    ogUrl?: SignalRule;
    image?: SignalRule;
    jsonLd?: JsonLdRule;
  };
  /** Regular expression on the full SKU. The first capture group is the parent SKU. */
  parentSku: { fromSku: string };
  variants?: VariantRules;
  price?: PriceRules;
  stock?: StockRules;
  listing?: ListingRules;
  /** Domains the store sends order confirmation emails from. Checked against DKIM. */
  emailDomains: string[];
  /** Selects which category_questions apply: "apparel", "footwear", "general". */
  productType: string;
  /** Name of the variant group that holds the size on this store, as the page shows it. Enables personal size advice. */
  sizeGroup?: string;
  /** Name of the variant group that holds the colour. Enables the colour filter on reviews. */
  colorGroup?: string;
}

/** A config together with its version (the `sites.adapter_version` column). */
export interface VersionedConfig {
  version: number;
  config: AdapterConfig;
}

export interface SiteAdapter {
  id: string;
  matchesUrl(url: URL): boolean;
  detectProduct(doc: Document, url: URL, cfg: AdapterConfig): Detection;
  readVariantOptions(doc: Document, cfg: AdapterConfig): VariantOption[];
  readSelectedVariant(doc: Document, cfg: AdapterConfig): VariantValues;
  readPriceStock(doc: Document, cfg: AdapterConfig): PriceSnapshot | null;
  readListingCards?(doc: Document, cfg: AdapterConfig): ListingCard[];
  /** Runs in the background worker with the user's cookies, after consent, at most daily. */
  fetchOrders?(cfg: AdapterConfig): Promise<Order[]>;
  /** Runs in the Email Worker after DKIM passes. */
  parseConfirmationEmail?(raw: { from: string; subject: string; text: string; html: string | null; /** The Date header, as sent. */ date?: string | null }): Order | null;
}

export type SiteStatus = "active" | "beta" | "paused";

/** A `public.sites` row as the extension reads it. */
export interface SiteRecord {
  id: string;
  name: string;
  status: SiteStatus;
  domains: string[];
  adapterConfig: unknown;
  adapterVersion: number;
}

export type VerificationState = "verified" | "pending" | "unverified";
export type ReviewStage = "first_impression" | "after_use" | "long_term";

export interface ReviewUpdateView {
  id: number;
  body: string;
  rating: number | null;
  createdAt: string;
}

/** A review as the panel shows it. Built from `reviews` joined with `reviewer_public`. */
export interface ReviewView {
  id: number;
  rating: number;
  title: string | null;
  body: string;
  answers: Record<string, unknown>;
  variantValues: Record<string, string>;
  verification: VerificationState;
  purchaseMonth: string | null;
  purchasedAt: string | null;
  deliveredAt: string | null;
  writtenAt: string;
  editedAt: string | null;
  helpfulCount: number;
  author: { name: string; level: ReviewerLevel; reviewsCount: number; helpfulReceived: number } | null;
  updates: ReviewUpdateView[];
  /** The signed-in user wrote it. */
  mine: boolean;
  /** The signed-in user already marked it helpful. */
  votedHelpful: boolean;
  /** Only the author sees a review that was hidden. */
  hidden: boolean;
}

export interface ProductSummary {
  productId: number;
  reviewsCount: number;
  verifiedCount: number;
  ratingAvg: number | null;
  fitSmall: number;
  fitExact: number;
  fitLarge: number;
}
