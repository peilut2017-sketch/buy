import { Button, IconButton, Notice, Root, Skel, StarInput, Switch, SignInCard, WatchList, RequireTerms } from "@smartbuy/ui";
import { browser } from "wxt/browser";
import { useState } from "preact/hooks";
import { useSession, type Identity } from "../lib/auth.ts";
import { dismissPending, getPendingReviews, getProfile, setProfileFlag, submitReview, type PendingReview } from "@smartbuy/data";
import { BACKEND_CONFIGURED } from "../lib/env.ts";
import { useResource } from "@smartbuy/ui";

function PendingItem({ item, identity, onChanged }: { item: PendingReview; identity: Identity; onChanged: () => void }) {
  const [rating, setRating] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  const saveRating = async (value: number) => {
    setRating(value);
    setState("saving");
    try {
      const result = await submitReview(identity.token, {
        siteId: item.product.siteId,
        sku: item.sku,
        parentSku: item.product.parentSku,
        productType: item.product.productType ?? "general",
        detectionConfidence: "high",
        source: "extension",
        product: { name: item.product.name, brand: null, imageUrl: item.product.imageUrl, url: item.product.url ?? "" },
        variantValues: {},
        rating: value,
        title: null,
        body: null,
        answers: {},
        purchaseMonth: null,
      });
      if (!result.reviewId) throw new Error("not saved");
      setState("saved");
    } catch {
      setState("failed");
    }
  };

  const dismiss = async () => {
    setState("saving");
    try {
      await dismissPending(identity.token, identity.userId, item.orderItemId);
      onChanged();
    } catch {
      setState("failed");
    }
  };

  return (
    <li class="sb-stack sb-gap-2" style={{ paddingBlock: "var(--space-3)" }}>
      <div class="product">
        {item.product.imageUrl ? <img class="product__thumb" src={item.product.imageUrl} alt="" referrerpolicy="no-referrer" /> : <div class="product__thumb" aria-hidden="true" />}
        <div class="product__text">
          <span class="sb-t-heading sb-clamp-2">{item.product.name ?? <bdi dir="ltr">{item.sku}</bdi>}</span>
          {item.product.url && (
            <a class="sb-t-support" href={item.product.url} target="_blank" rel="noreferrer">לעמוד המוצר</a>
          )}
        </div>
      </div>
      {state === "saved" ? (
        <Notice kind="success" title="הדירוג נשמר">אפשר להשלים את הטקסט בעמוד המוצר. ביקורת בלי טקסט לא מתפרסמת.</Notice>
      ) : (
        <>
          <StarInput legend="דירוג מהיר" value={rating} onChange={saveRating} />
          {state === "failed" && <Notice kind="error">הפעולה לא נשמרה. נסו שוב.</Notice>}
          <div><Button variant="quiet" small disabled={state === "saving"} onClick={dismiss}>לא רוצה לדרג</Button></div>
        </>
      )}
    </li>
  );
}

function SignedIn({ identity }: { identity: Identity }) {
  const pending = useResource(() => getPendingReviews(identity.token), [identity.userId]);
  const profile = useResource(() => getProfile(identity.token, identity.userId), [identity.userId]);
  const [quietError, setQuietError] = useState(false);
  const [quiet, setQuiet] = useState<boolean | null>(null);
  const quietValue = quiet ?? profile.data?.quietMode ?? false;

  const toggleQuiet = async (next: boolean) => {
    setQuietError(false);
    try {
      await setProfileFlag(identity.token, identity.userId, { quiet_mode: next });
      setQuiet(next); // shown only after the server confirmed it
    } catch {
      setQuietError(true);
    }
  };

  return (
    <>
      <section class="sb-stack sb-gap-2" aria-labelledby="pending-h">
        <h2 class="sb-t-heading" id="pending-h">ממתינים לביקורת</h2>
        {pending.status === "loading" && <Skel width="80%" height="48px" />}
        {pending.status === "error" && <Notice kind="error" title="לא הצלחנו לטעון" action={<Button small onClick={pending.reload}>ניסיון חוזר</Button>} />}
        {pending.status === "ready" && pending.data.length === 0 && (
          <p class="sb-t-support sb-secondary">אין כרגע מוצרים שממתינים לביקורת. מוצרים שרכשתם יופיעו כאן כשנוכל לאמת את ההזמנה.</p>
        )}
        {pending.status === "ready" && pending.data.length > 0 && (
          <ul class="sb-list">
            {pending.data.map((item) => <PendingItem key={item.orderItemId} item={item} identity={identity} onChanged={pending.reload} />)}
          </ul>
        )}
      </section>
      <hr class="sb-rule" />
      <section class="sb-stack sb-gap-2" aria-labelledby="watch-h">
        <h2 class="sb-t-heading" id="watch-h">מוצרים במעקב</h2>
        <WatchList identity={identity} />
      </section>
      <hr class="sb-rule" />
      <section class="sb-stack sb-gap-2">
        <Switch checked={quietValue} onChange={toggleQuiet} label="מצב שקט" description="משתיק את כל ההתראות עד שתכבו אותו." disabled={profile.status !== "ready"} />
        {quietError && <Notice kind="error">ההגדרה לא נשמרה. נסו שוב.</Notice>}
      </section>
    </>
  );
}

export function Popup() {
  const session = useSession();
  return (
    <Root class="popup">
      <header class="panel__header" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <h1 class="sb-t-name">SmartBuy</h1>
        <IconButton icon="sliders" label="הגדרות" onClick={() => void browser.runtime.openOptionsPage()} />
      </header>
      <main class="panel__main">
        {!BACKEND_CONFIGURED ? (
          <Notice kind="error" title="החיבור לשרת לא הוגדר">גרסת הפיתוח הזו נבנתה בלי כתובת שרת.</Notice>
        ) : session.status === "loading" ? (
          <Skel width="70%" height="18px" />
        ) : session.status === "out" ? (
          <SignInCard reason="כדי לראות ביקורות שממתינות לכם צריך להתחבר." />
        ) : (
          <RequireTerms identity={session.identity}><SignedIn identity={session.identity} /></RequireTerms>
        )}
      </main>
      <footer class="panel__footer">SmartBuy הוא שירות עצמאי ואין לו קשר לחנויות.</footer>
    </Root>
  );
}
