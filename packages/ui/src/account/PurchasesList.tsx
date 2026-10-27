import { formatDateHe } from "@smartbuy/core";
import { listPurchases, type Identity, type Purchase } from "@smartbuy/data";
import { Button, Notice, Skel } from "../components.tsx";
import { useResource } from "../hooks.ts";

/**
 * The person's purchases that have no review yet, from the orders the extension read on the store's order page.
 * `excludeProductIds` removes the ones another list on the same screen already shows.
 */
export function PurchasesList({ identity, excludeProductIds = [] }: { identity: Identity; excludeProductIds?: readonly number[] }) {
  const data = useResource(() => listPurchases(identity.token, identity.userId), [identity.userId]);
  if (data.status === "loading") return <Skel width="80%" height="48px" />;
  if (data.status === "error") return <Notice kind="error" title="לא הצלחנו לטעון את הרכישות" action={<Button small onClick={data.reload}>ניסיון חוזר</Button>} />;

  const skip = new Set(excludeProductIds);
  const items: Purchase[] = data.data.filter((p) => !skip.has(p.productId));
  if (items.length === 0) {
    return (
      <p class="sb-t-support sb-secondary">
        אין כרגע רכישות שעוד אין עליהן ביקורת. רכישות מופיעות כאן אחרי שהתוסף קורא את עמוד ההזמנות שלכם בחנות (אחרי שאישרתם בדיקת הזמנות).
      </p>
    );
  }
  return (
    <ul class="sb-list" aria-label="רכישות בלי ביקורת">
      {items.map((p) => (
        <li key={p.productId} class="sb-stack sb-gap-1" style={{ paddingBlock: "var(--space-3)" }}>
          <div class="product">
            {p.imageUrl ? <img class="product__thumb" src={p.imageUrl} alt="" referrerpolicy="no-referrer" loading="lazy" /> : <div class="product__thumb" aria-hidden="true" />}
            <div class="product__text">
              <span class="sb-t-heading sb-clamp-2">{p.name ?? <bdi dir="ltr">{p.parentSku.toUpperCase()}</bdi>}</span>
              {p.orderedAt && <span class="sb-t-support sb-secondary">הוזמן ב-{formatDateHe(p.orderedAt)}</span>}
              {p.url?.startsWith("https://") && <a class="sb-t-support" href={p.url} target="_blank" rel="noreferrer">לעמוד המוצר, לכתיבת ביקורת</a>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
