import { Button, TextField } from "@smartbuy/ui";
import { useState } from "preact/hooks";
import { productPath, resolveInput, type PublicSite } from "./sites.ts";

/** Paste a product link or a SKU, get to its reviews (spec 17). */
export function Search({ sites, autoFocus }: { sites: readonly PublicSite[]; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: Event) => {
    e.preventDefault();
    const found = resolveInput(text, sites);
    if (!found) return setError("לא זיהינו מוצר בקישור או במק״ט. הדביקו קישור מעמוד מוצר באחת החנויות הנתמכות.");
    location.assign(productPath(found.siteId, found.sku));
  };
  return (
    <form class="search" onSubmit={submit} noValidate role="search" aria-label="חיפוש ביקורות">
      <TextField label="קישור למוצר או מק״ט" value={text} onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)} dir="ltr" class="ltr-input" placeholder="https://…" error={error ?? undefined} autofocus={autoFocus} />
      <div style={{ alignSelf: "flex-start", paddingBlockStart: "22px" }}>
        <Button type="submit" variant="primary" icon="search" disabled={text.trim() === ""}>חיפוש</Button>
      </div>
    </form>
  );
}
