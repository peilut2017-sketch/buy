import { Button, FieldError, Notice, TextArea } from "@smartbuy/ui";
import type { ReviewView } from "@smartbuy/core";
import { useState } from "preact/hooks";
import type { Identity } from "../lib/auth.ts";
import { appealReview } from "../lib/data.ts";
import { ApiError, NetworkError } from "../lib/rest.ts";

type Phase = { kind: "form" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed"; message: string };

/** One appeal per review (spec 10). The answer arrives as a notification. */
export function AppealForm({ review, identity, onClose }: { review: ReviewView; identity: Identity; onClose: () => void }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  const submit = async (e: Event) => {
    e.preventDefault();
    if (body.trim().length < 10) return setError("כתבו לפחות 10 תווים.");
    if (body.length > 1000) return setError("אפשר עד 1,000 תווים.");
    setError(null);
    setPhase({ kind: "sending" });
    try {
      await appealReview(identity.token, review.id, body.trim());
      setPhase({ kind: "sent" });
    } catch (err) {
      setPhase({
        kind: "failed",
        message:
          err instanceof NetworkError ? "אין חיבור לשרת. בדקו את החיבור ונסו שוב."
          : err instanceof ApiError && err.status === 409 ? "כבר שלחתם ערעור על הביקורת הזו."
          : "הערעור לא נשלח. נסו שוב.",
      });
    }
  };

  if (phase.kind === "sent") {
    return (
      <div class="sb-stack sb-gap-3">
        <Notice kind="success" title="הערעור התקבל">נבדוק שוב ונעדכן אתכם בהחלטה.</Notice>
        <Button onClick={onClose}>חזרה לביקורות</Button>
      </div>
    );
  }
  return (
    <form class="form" onSubmit={submit} noValidate>
      <div class="sb-stack" style={{ gap: "2px" }}>
        <h2 class="sb-t-heading">ערעור על הסתרת הביקורת</h2>
        <p class="sb-t-support sb-secondary">אפשר לערער פעם אחת. הסבירו למה לדעתכם הביקורת מתאימה לכללים.</p>
      </div>
      <TextArea label="הסבר" value={body} onInput={setBody} maxChars={1000} rows={4} error={error ?? undefined} disabled={phase.kind === "sending"} />
      {phase.kind === "failed" && <FieldError>{phase.message}</FieldError>}
      <div class="sb-row sb-gap-2">
        <Button type="submit" variant="primary" disabled={phase.kind === "sending"}>{phase.kind === "sending" ? "שולחים…" : "שליחת ערעור"}</Button>
        <Button onClick={onClose} disabled={phase.kind === "sending"}>ביטול</Button>
      </div>
    </form>
  );
}
