import type { ReviewTarget } from "@smartbuy/data";
import type { ProductSnapshot } from "../lib/messages.ts";

/** What the panel knows about a product: read from the open page, or looked up by link or SKU (then there is no snapshot). */
export interface ProductRef {
  siteId: string;
  siteName: string;
  parentSku: string;
  sku: string;
  snapshot: ProductSnapshot | null;
}

export function toTarget(ref: ProductRef, sizeGroup: string | null = null): ReviewTarget {
  const snap = ref.snapshot;
  return {
    siteId: ref.siteId,
    siteName: ref.siteName,
    sku: ref.sku,
    parentSku: ref.parentSku,
    productType: snap?.productType ?? "general",
    confidence: snap?.confidence === "high" ? "high" : snap?.confidence === "medium" ? "medium" : "low",
    name: snap?.name ?? null,
    brand: snap?.brand ?? null,
    imageUrl: snap?.imageUrl ?? null,
    url: snap?.url ?? "",
    price: snap?.price ?? null,
    variantValues: snap?.variantValues ?? {},
    variantOptions: snap?.variantOptions ?? [],
    sizeGroup,
    source: "extension",
  };
}
