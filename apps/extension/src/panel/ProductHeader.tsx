import { formatIls } from "@smartbuy/core";
import { Icon } from "@smartbuy/ui";
import { useState } from "preact/hooks";
import type { ProductSnapshot } from "../lib/messages.ts";

export interface ProductRef {
  siteId: string;
  siteName: string;
  parentSku: string;
  sku: string;
  /** Present when the product was read from the open page. Absent for a manual lookup. */
  snapshot: ProductSnapshot | null;
}

/** Thumbnail, name (two lines, then cut), store and price. A missing image or price leaves a quiet gap, never a made-up one. */
export function ProductHeader({ product }: { product: ProductRef }) {
  const [imageFailed, setImageFailed] = useState(false);
  const snap = product.snapshot;
  const showImage = snap?.imageUrl && !imageFailed;
  const price = snap?.price?.price ?? null;
  return (
    <div class="product">
      {showImage ? (
        <img class="product__thumb" src={snap.imageUrl as string} alt="" onError={() => setImageFailed(true)} referrerpolicy="no-referrer" />
      ) : (
        <div class="product__thumb product__thumb--empty" aria-hidden="true">
          <Icon name="search" size={20} />
        </div>
      )}
      <div class="product__text">
        <h1 class="sb-t-name sb-clamp-2">{snap?.name ?? <>מוצר <bdi dir="ltr">{product.sku}</bdi></>}</h1>
        <p class="sb-t-support sb-secondary">
          {snap?.brand ? `${snap.brand} · ` : ""}
          {product.siteName}
          {snap?.name ? <> · <bdi dir="ltr">{product.sku}</bdi></> : null}
        </p>
        {price !== null && (
          <p class="sb-t-price" aria-label={`מחיר ${formatIls(price)}`}>
            {formatIls(price)}
          </p>
        )}
        {snap?.price?.inStock === false && <p class="sb-t-support sb-secondary">אזל מהמלאי</p>}
      </div>
    </div>
  );
}
