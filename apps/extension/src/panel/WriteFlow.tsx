import { Button, Notice, Skel } from "@smartbuy/ui";
import type { Identity } from "../lib/auth.ts";
import { getQuestions, getReviews, getSummary, hasDeliveredOrder } from "../lib/data.ts";
import { useResource } from "../lib/hooks.ts";
import { ReviewForm } from "./ReviewForm.tsx";
import type { ProductRef } from "./ProductHeader.tsx";

/** Loads what the form needs (questions, the user's own review, whether an order exists), then shows it. */
export function WriteFlow({ product, identity, onDone, onCancel }: { product: ProductRef; identity: Identity; onDone: () => void; onCancel: () => void }) {
  const type = product.snapshot?.productType ?? "general";
  const data = useResource(async () => {
    const summary = await getSummary(product.siteId, product.parentSku, identity.token);
    const [questions, mine, hasOrder] = await Promise.all([
      getQuestions(type),
      summary ? getReviews(summary.productId, identity.token, identity.userId).then((r) => r.mine) : Promise.resolve(null),
      summary ? hasDeliveredOrder(identity.token, summary.productId) : Promise.resolve(false),
    ]);
    return { questions, mine, hasOrder };
  }, [product.siteId, product.parentSku, identity.userId, type]);

  if (data.status === "loading") {
    return (
      <div class="sb-stack sb-gap-3" role="status" aria-label="טוענים את הטופס">
        <Skel width="40%" variant="title" />
        <Skel width="100%" height="96px" />
      </div>
    );
  }
  if (data.status === "error") {
    return (
      <Notice kind="error" title="הטופס לא נטען" action={<div class="sb-row sb-gap-2"><Button small onClick={data.reload}>ניסיון חוזר</Button><Button small variant="quiet" onClick={onCancel}>חזרה</Button></div>}>
        בדקו את החיבור לאינטרנט ונסו שוב.
      </Notice>
    );
  }
  return <ReviewForm product={product} identity={identity} existing={data.data.mine} questions={data.data.questions} hasOrder={data.data.hasOrder} onDone={onDone} onCancel={onCancel} />;
}
