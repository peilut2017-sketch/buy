import { skuFromPath } from "@smartbuy/core";
import { Button, Notice, TextField } from "@smartbuy/ui";
import { useState } from "preact/hooks";
import { SITES } from "../lib/sites.ts";
import type { SiteConfigResult } from "../lib/messages.ts";
import type { ProductRef } from "./ProductHeader.tsx";
import { parentSkuOf } from "@smartbuy/core";

/** Reads a pasted product link or SKU. Returns null when it matches no known store. */
export function lookupProduct(input: string, configs: Record<string, SiteConfigResult["config"]>): ProductRef | null {
  const text = input.trim();
  if (!text) return null;
  for (const site of SITES) {
    const cfg = configs[site.id] ?? site.bundled.config;
    let sku: string | null = null;
    try {
      const url = new URL(text);
      if (site.adapter.matchesUrl(url)) sku = skuFromPath(url, cfg);
    } catch {
      sku = skuFromPath(new URL(`https://x.invalid/${text.replace(/^\/+/, "")}`), cfg);
    }
    if (sku) {
      const lower = sku.toLowerCase();
      const parent = parentSkuOf(lower, cfg);
      if (parent) return { siteId: site.id, siteName: site.name, sku: lower, parentSku: parent, snapshot: null };
    }
  }
  return null;
}

/** Shown when the open tab is not a product page we recognise (spec 4, rule 4). */
export function NotDetected({ onLookup }: { onLookup: (product: ProductRef) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: Event) => {
    e.preventDefault();
    const found = lookupProduct(text, {});
    if (!found) return setError("לא זיהינו מוצר בקישור או במק״ט. בדקו שהדבקתם קישור מעמוד מוצר באחת החנויות הנתמכות.");
    setError(null);
    onLookup(found);
  };

  return (
    <div class="sb-stack sb-gap-4">
      <Notice kind="empty" title="לא זיהינו מוצר בעמוד הזה">
        אפשר לחפש ביקורות לפי קישור למוצר או לפי מק״ט.
      </Notice>
      <form class="sb-stack sb-gap-3" onSubmit={submit} noValidate>
        <TextField
          label="קישור או מק״ט"
          value={text}
          onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
          dir="ltr"
          class="ltr-input"
          placeholder="https://…"
          error={error ?? undefined}
        />
        <Button type="submit" variant="primary" icon="search" disabled={text.trim() === ""}>חיפוש</Button>
      </form>
    </div>
  );
}
