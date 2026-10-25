import { VERIFICATION_LABEL, type ReviewView } from "@smartbuy/core";
import { Button, Chip, Notice, Stars } from "@smartbuy/ui";
import { useState } from "preact/hooks";
import { answerFacts, authorLine, helpfulLabel, reviewTiming, updateLabel, variantText } from "./format.ts";

const LONG_TEXT = 260;

export interface ReviewItemProps {
  review: ReviewView;
  now: Date;
  /** The helpful or report buttons need a signed-in user; the parent decides what happens when there is none. */
  busy: boolean;
  onHelpful: (review: ReviewView) => void;
  onReport: (review: ReviewView) => void;
  onEdit: (review: ReviewView) => void;
  onDelete: (review: ReviewView) => void;
  onAppeal: (review: ReviewView) => void;
}

function VerificationChip({ review }: { review: ReviewView }) {
  if (review.verification === "verified") return <Chip tone="verified" icon="shield">{VERIFICATION_LABEL.verified}</Chip>;
  if (review.verification === "pending") return <Chip tone="pending" icon="hourglass">{VERIFICATION_LABEL.pending}</Chip>;
  return <Chip>{VERIFICATION_LABEL.unverified}</Chip>;
}

export function ReviewItem({ review, now, busy, onHelpful, onReport, onEdit, onDelete, onAppeal }: ReviewItemProps) {
  const [expanded, setExpanded] = useState(false);
  const timing = reviewTiming(review, now);
  const facts = answerFacts(review.answers);
  const variant = variantText(review.variantValues);
  const long = review.body.length > LONG_TEXT;

  return (
    <article class="sb-review" aria-label={`ביקורת של ${review.author?.name ?? "משתמש"}`}>
      {review.hidden && (
        <Notice kind="info" title="הביקורת הוסתרה">
          היא מוצגת רק למי שכתב אותה. אפשר לערער על ההחלטה.
        </Notice>
      )}

      <header class="sb-stack" style={{ gap: "2px" }}>
        <div class="sb-row sb-gap-2 sb-wrap">
          <span class="sb-t-heading">{review.author?.name ?? "משתמש"}</span>
          <VerificationChip review={review} />
        </div>
        {review.author && <span class="sb-t-support sb-secondary">{authorLine(review)}</span>}
      </header>

      <div class="sb-row sb-gap-2 sb-wrap">
        <Stars value={review.rating} />
        {timing.stage && <Chip>{timing.stage}</Chip>}
      </div>

      {(timing.afterPurchase || timing.written) && (
        <p class="sb-t-support sb-secondary">
          {timing.written}
          {timing.afterPurchase && `, ${timing.afterPurchase.replace(/^נכתבה /, "")}`}
          {timing.selfReportedNote && ` (${timing.selfReportedNote})`}
          {timing.edited && ` · ${timing.edited}`}
        </p>
      )}

      {variant && <p class="sb-t-support sb-secondary">{variant}</p>}
      {review.title && <h2 class="sb-t-heading">{review.title}</h2>}

      <p class={long && !expanded ? "sb-review__body sb-review__body--clamped" : "sb-review__body"}>{review.body}</p>
      {long && (
        <div>
          <Button variant="quiet" small onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
            {expanded ? "הצגת פחות" : "קריאת המשך"}
          </Button>
        </div>
      )}

      {facts.length > 0 && <p class="sb-t-support sb-secondary">{facts.join(" · ")}</p>}

      {review.updates.length > 0 && (
        <div class="sb-review__updates">
          {review.updates.map((u) => (
            <div key={u.id} class="sb-stack" style={{ gap: "2px" }}>
              <span class="sb-t-meta sb-secondary">{updateLabel(review, u.createdAt)}</span>
              {u.rating !== null && <Stars value={u.rating} size={14} />}
              <p class="sb-review__body">{u.body}</p>
            </div>
          ))}
        </div>
      )}

      <div class="review-actions">
        {!review.mine && !review.hidden && (
          <Button variant="quiet" small icon="thumb" disabled={busy} aria-pressed={review.votedHelpful} onClick={() => onHelpful(review)}>
            {helpfulLabel(review.helpfulCount)}
          </Button>
        )}
        {review.mine && review.helpfulCount > 0 && <span class="sb-t-support sb-secondary" style={{ alignSelf: "center", paddingInline: "8px" }}>{helpfulLabel(review.helpfulCount)}</span>}
        {!review.mine && (
          <Button variant="quiet" small icon="flag" disabled={busy} onClick={() => onReport(review)}>
            דיווח
          </Button>
        )}
        {review.mine && (
          <>
            <Button variant="quiet" small icon="edit" disabled={busy} onClick={() => onEdit(review)}>עריכה</Button>
            <Button variant="danger" small icon="trash" disabled={busy} onClick={() => onDelete(review)}>מחיקה</Button>
            {review.hidden && <Button variant="quiet" small disabled={busy} onClick={() => onAppeal(review)}>ערעור</Button>}
          </>
        )}
      </div>
    </article>
  );
}
