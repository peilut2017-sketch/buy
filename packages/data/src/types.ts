import type { PriceSnapshot, VariantOption } from "@smartbuy/core";

/** The signed-in user as the data layer needs them: who they are, and the token that proves it. */
export interface Identity {
  token: string;
  userId: string;
  email: string | null;
}

/**
 * The product a review screen is about. The extension builds it from the open page; the website builds it from the
 * address and the `products` table. Name, image and price are optional because nobody is allowed to invent them.
 */
export interface ReviewTarget {
  siteId: string;
  siteName: string;
  /** Full SKU, including the variant part. */
  sku: string;
  parentSku: string;
  /** Which review questions apply: "apparel", "footwear" or "general". */
  productType: string;
  confidence: "high" | "medium" | "low";
  name: string | null;
  brand: string | null;
  imageUrl: string | null;
  url: string;
  price: PriceSnapshot | null;
  variantValues: Record<string, string>;
  variantOptions: VariantOption[];
  /** Where a review is written: the extension can later verify it from orders, the website marks it as pending. */
  source: "extension" | "web";
}
