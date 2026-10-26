import { formatIls } from "@smartbuy/core";
import type { ReviewTarget } from "@smartbuy/data";
import { useState } from "preact/hooks";
import { Icon } from "../icons.tsx";

/** Thumbnail, name (two lines, then cut), store and price. A missing image or price leaves a quiet gap, never a made-up one. */
export function ProductHeader({ target }: { target: ReviewTarget }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = target.imageUrl && !imageFailed;
  const price = target.price?.price ?? null;
  return (
    <div class="product">
      {showImage ? (
        <img class="product__thumb" src={target.imageUrl as string} alt="" onError={() => setImageFailed(true)} referrerpolicy="no-referrer" />
      ) : (
        <div class="product__thumb product__thumb--empty" aria-hidden="true">
          <Icon name="search" size={20} />
        </div>
      )}
      <div class="product__text">
        <h1 class="sb-t-name sb-clamp-2">{target.name ?? <>מוצר <bdi dir="ltr">{target.sku}</bdi></>}</h1>
        <p class="sb-t-support sb-secondary">
          {target.brand ? `${target.brand} · ` : ""}
          {target.siteName}
          {target.name ? <> · <bdi dir="ltr">{target.sku}</bdi></> : null}
        </p>
        {price !== null && (
          <p class="sb-t-price" aria-label={`מחיר ${formatIls(price)}`}>
            {formatIls(price)}
          </p>
        )}
        {target.price?.inStock === false && <p class="sb-t-support sb-secondary">אזל מהמלאי</p>}
      </div>
    </div>
  );
}
