import { formatDateHe } from "@smartbuy/core";
import { ApiError, deleteReview, getPendingReviews, rest, type Identity, type PendingReview } from "@smartbuy/data";
import { AccountPanel, Button, DataControls, Notice, NotificationSettingsPanel, RequireAccount, Skel, Stars, WatchList, useResource } from "@smartbuy/ui";
import { useState } from "preact/hooks";
import { boot } from "../lib/boot.tsx";
import { Shell } from "../shell.tsx";

interface MyReviewRow {
  id: number;
  rating: number;
  title: string | null;
  body: string | null;
  status: "draft" | "visible" | "hidden" | "removed";
  written_at: string;
  helpful_count: number;
  products: { site_id: string; parent_sku: string; name: string | null };
}

const STATUS_TEXT: Record<MyReviewRow["status"], string> = {
  draft: "טיוטה",
  visible: "מוצגת",
  hidden: "מוסתרת",
  removed: "הוסרה",
};

function MyReviews({ identity }: { identity: Identity }) {
  const data = useResource(
    () =>
      rest<MyReviewRow[]>("reviews", {
        params: { user_id: `eq.${identity.userId}`, select: "id,rating,title,body,status,written_at,helpful_count,products(site_id,parent_sku,name)", order: "written_at.desc", limit: 100 },
        token: identity.token,
      }),
    [identity.userId],
  );
  const [error, setError] = useState<string | null>(null);

  if (data.status === "loading") return <Skel width="80%" height="48px" />;
  if (data.status === "error") return <Notice kind="error" title="הביקורות לא נטענו" action={<Button small onClick={data.reload}>ניסיון חוזר</Button>} />;
  if (data.data.length === 0) return <Notice kind="empty" title="עוד לא כתבתם ביקורות">ביקורת שתכתבו תופיע כאן, ותוכלו לערוך או למחוק אותה.</Notice>;

  const remove = async (id: number) => {
    if (!window.confirm("למחוק את הביקורת? אי אפשר לשחזר אותה.")) return;
    setError(null);
    try {
      await deleteReview(identity.token, id);
      data.reload();
    } catch (e) {
      setError(e instanceof ApiError ? "הביקורת לא נמחקה. נסו שוב." : "הביקורת לא נמחקה. בדקו את החיבור ונסו שוב.");
    }
  };

  return (
    <div class="sb-stack sb-gap-2">
      {error && <Notice kind="error">{error}</Notice>}
      <ul class="sb-list">
        {data.data.map((r) => (
          <li key={r.id} class="sb-stack sb-gap-2" style={{ paddingBlock: "var(--space-3)" }}>
            <div class="sb-row sb-gap-2 sb-wrap">
              <a class="sb-t-heading" href={`/${r.products.site_id}/${r.products.parent_sku}`}>{r.products.name ?? r.products.parent_sku}</a>
              <span class="sb-t-support sb-secondary">{STATUS_TEXT[r.status]}</span>
            </div>
            <Stars value={r.rating} />
            {r.body ? <p class="sb-t-body">{r.body.length > 160 ? `${r.body.slice(0, 160)}…` : r.body}</p> : <p class="sb-t-support sb-secondary">דירוג בלי טקסט. הוא לא מוצג לאחרים עד שתכתבו ביקורת.</p>}
            <p class="sb-t-support sb-secondary">{formatDateHe(r.written_at)}{r.helpful_count > 0 ? ` · ${r.helpful_count} סימוני מועיל` : ""}</p>
            <div><Button variant="danger" small icon="trash" onClick={() => remove(r.id)}>מחיקה</Button></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pending({ identity }: { identity: Identity }) {
  const data = useResource(() => getPendingReviews(identity.token), [identity.userId]);
  if (data.status === "loading") return <Skel width="70%" height="36px" />;
  if (data.status === "error") return <Notice kind="error" title="לא הצלחנו לטעון" action={<Button small onClick={data.reload}>ניסיון חוזר</Button>} />;
  if (data.data.length === 0) return <p class="sb-t-support sb-secondary">אין כרגע מוצרים שממתינים לביקורת. מוצרים שרכשתם יופיעו כאן אחרי שהתוסף יאמת את ההזמנה.</p>;
  return (
    <ul class="sb-list">
      {data.data.map((p: PendingReview) => (
        <li key={p.orderItemId} style={{ paddingBlock: "var(--space-3)" }}>
          <a class="sb-t-heading" href={`/${p.product.siteId}/${p.product.parentSku}`}>{p.product.name ?? p.sku}</a>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="web__card sb-stack sb-gap-3">
      <h2 class="sb-t-heading">{title}</h2>
      {children}
    </section>
  );
}

function Account() {
  return (
    <Shell active="account">
      <h1 class="sb-t-name" style={{ fontSize: "24px", lineHeight: "30px" }}>החשבון שלי</h1>
      <RequireAccount reason="כדי לראות את החשבון צריך להתחבר.">
        {({ identity }) => (
          <>
            <Section title="פרטים"><AccountPanel identity={identity} /></Section>
            <Section title="הביקורות שלי"><MyReviews identity={identity} /></Section>
            <Section title="ממתינים לביקורת"><Pending identity={identity} /></Section>
            <Section title="מוצרים במעקב"><WatchList identity={identity} productHref={(w) => `/${w.product.siteId}/${w.sku ?? w.product.parentSku}`} /></Section>
            <Section title="התראות"><NotificationSettingsPanel identity={identity} /></Section>
            <Section title="הפרטיות שלכם"><DataControls identity={identity} /></Section>
          </>
        )}
      </RequireAccount>
    </Shell>
  );
}

boot(<Account />);
