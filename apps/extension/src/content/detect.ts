// Turns what the page shows into the snapshot the rest of the extension works with.

import { isDetected, readProductMeta, type AdapterConfig, type Detection } from "@smartbuy/core";
import type { ProductSnapshot } from "../lib/messages.ts";
import type { RegisteredSite } from "../lib/sites.ts";

export interface PageReading {
  detection: Detection;
  /** Null when the page is not a product we are sure about. */
  product: ProductSnapshot | null;
}

export function readPage(site: RegisteredSite, doc: Document, url: URL, cfg: AdapterConfig, now = Date.now()): PageReading {
  const detection = site.adapter.detectProduct(doc, url, cfg);
  if (!isDetected(detection) || detection.sku === null || detection.parentSku === null) return { detection, product: null };
  const meta = readProductMeta(doc, cfg);
  return {
    detection,
    product: {
      siteId: site.id,
      sku: detection.sku,
      parentSku: detection.parentSku,
      confidence: detection.confidence,
      url: `${url.origin}${url.pathname}`,
      name: meta.name,
      brand: meta.brand,
      imageUrl: meta.imageUrl,
      price: site.adapter.readPriceStock(doc, cfg),
      variantValues: site.adapter.readSelectedVariant(doc, cfg),
      variantOptions: site.adapter.readVariantOptions(doc, cfg),
      productType: cfg.productType,
      detectedAt: now,
    },
  };
}

/** A failure worth reporting to the admin: the signals contradict each other, or only a weak one was found. */
export function isReportableFailure(detection: Detection): boolean {
  return detection.conflict || detection.confidence === "low";
}
