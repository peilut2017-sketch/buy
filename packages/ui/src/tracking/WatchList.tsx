import { deleteWatch, listWatches, type Identity, type WatchListItem } from "@smartbuy/data";
import { useState } from "preact/hooks";
import { formatIls } from "@smartbuy/core";
import { Button, Notice, Skel } from "../components.tsx";
import { useResource } from "../hooks.ts";

function describe(item: WatchListItem): string {
  return [
    item.targetPrice !== null ? `יעד ${formatIls(item.targetPrice)}` : null,
    item.dropPercent !== null ? `ירידה של ${item.dropPercent}%` : null,
    item.notifyRestock ? "חזרה למלאי" : null,
  ].filter(Boolean).join(" · ");
}

function Row({ item, identity, onChanged, productHref }: { item: WatchListItem; identity: Identity; onChanged: () => void; productHref: (item: WatchListItem) => string | null }) {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const href = productHref(item);

  const stop = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await deleteWatch(identity.token, item.id);
      onChanged(); // the row goes away only after the server confirmed the delete
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <li class="sb-stack sb-gap-1" style={{ paddingBlock: "var(--space-2)" }}>
      <span class="sb-t-heading sb-clamp-2">{item.product.name ?? "מוצר"}</span>
      <span class="sb-t-support sb-secondary">{describe(item)}</span>
      {failed && <Notice kind="error">המעקב לא הופסק. נסו שוב.</Notice>}
      <div class="sb-row sb-gap-2">
        {href && <a class="sb-t-support" href={href} target="_blank" rel="noreferrer">לעמוד המוצר</a>}
        <Button variant="quiet" small disabled={busy} onClick={stop}>הפסקת מעקב</Button>
      </div>
    </li>
  );
}

/** The user's active watches. `productHref` decides where a product links to (the store page or this site's page). */
export function WatchList({ identity, productHref }: { identity: Identity; productHref?: (item: WatchListItem) => string | null }) {
  const data = useResource(() => listWatches(identity.token, identity.userId), [identity.userId]);
  const href = productHref ?? ((item: WatchListItem) => (item.product.url?.startsWith("https://") ? item.product.url : null));

  if (data.status === "loading") return <Skel width="80%" height="48px" />;
  if (data.status === "error") return <Notice kind="error" title="לא הצלחנו לטעון" action={<Button small onClick={data.reload}>ניסיון חוזר</Button>} />;
  if (data.data.length === 0) return <p class="sb-t-support sb-secondary">עוד אין מוצרים במעקב. בעמוד מוצר לוחצים על "מעקב מחיר".</p>;
  return (
    <ul class="sb-list">
      {data.data.map((w) => <Row key={w.id} item={w} identity={identity} onChanged={data.reload} productHref={href} />)}
    </ul>
  );
}
