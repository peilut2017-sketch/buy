import { DEFAULT_REVIEW_LIMITS, validateReviewUpdate, type ReviewView } from "@smartbuy/core";
import { addReviewUpdate, ApiError, NetworkError, type Identity } from "@smartbuy/data";
import { useState } from "preact/hooks";
import { Button, FieldError, Notice, StarInput, TextArea } from "../components.tsx";

type Phase = { kind: "form" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed"; message: string };

/** "How does it hold up?": a later update on the user's own review. The rating is optional and replaces the review's rating. */
export function UpdateForm({ review, identity, onClose }: { review: ReviewView; identity: Identity; onClose: (changed: boolean) => void }) {
  const [body, setBody] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  const submit = async (e: Event) => {
    e.preventDefault();
    const checked = validateReviewUpdate({ body, rating });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    setPhase({ kind: "sending" });
    try {
      await addReviewUpdate(identity.token, review.id, checked.value.body, checked.value.rating);
      setPhase({ kind: "sent" });
    } catch (err) {
      const message =
        err instanceof NetworkError ? "אין חיבור לשרת. העדכון לא נשמר. בדקו את החיבור ונסו שוב."
        : err instanceof ApiError && err.status === 429 ? "הגעתם למספר העדכונים המרבי לביקורת הזו."
        : err instanceof ApiError && err.status === 409 ? "אפשר להוסיף עדכון רק לביקורת שמוצגת."
        : "העדכון לא נשמר. נסו שוב.";
      setPhase({ kind: "failed", message });
    }
  };

  if (phase.kind === "sent") {
    return (
      <div class="sb-stack sb-gap-3">
        <Notice kind="success" title="העדכון נשמר">הוא יוצג בתוך הביקורת שלכם, עם התאריך.</Notice>
        <Button onClick={() => onClose(true)}>חזרה לביקורות</Button>
      </div>
    );
  }

  return (
    <form class="form" onSubmit={submit} noValidate>
      <div class="sb-stack" style={{ gap: "2px" }}>
        <h2 class="sb-t-heading">עדכון לביקורת</h2>
        <p class="sb-t-support sb-secondary">איך המוצר מחזיק עכשיו? הביקורת המקורית נשארת כמו שהיא.</p>
      </div>
      <TextArea label="מה השתנה?" value={body} onInput={setBody} minChars={DEFAULT_REVIEW_LIMITS.updateMinChars} maxChars={DEFAULT_REVIEW_LIMITS.maxChars} rows={4} error={errors.body} disabled={phase.kind === "sending"} />
      <StarInput legend="דירוג מעודכן (לא חובה)" value={rating} onChange={setRating} error={errors.rating} />
      {phase.kind === "failed" && <FieldError>{phase.message}</FieldError>}
      <div class="sb-row sb-gap-2">
        <Button type="submit" variant="primary" disabled={phase.kind === "sending"}>{phase.kind === "sending" ? "שומרים…" : "שמירת עדכון"}</Button>
        <Button onClick={() => onClose(false)} disabled={phase.kind === "sending"}>ביטול</Button>
      </div>
    </form>
  );
}
