import { REPORT_REASONS, validateReport, type ReportReason, type ReviewView } from "@smartbuy/core";
import { Button, ChoiceGroup, FieldError, Notice, TextArea } from "@smartbuy/ui";
import { useState } from "preact/hooks";
import type { Identity } from "../lib/auth.ts";
import { reportReview } from "../lib/data.ts";
import { ApiError, NetworkError } from "../lib/rest.ts";

const REASON_LABEL: Record<ReportReason, string> = {
  spam: "ספאם או פרסומת",
  off_topic: "לא קשור למוצר",
  offensive: "תוכן פוגעני",
  personal_or_defamation: "פרטים אישיים או לשון הרע",
  fake: "נראית מזויפת",
  other: "אחר",
};

type Phase = { kind: "form" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed"; message: string };

export function ReportForm({ review, identity, onClose }: { review: ReviewView; identity: Identity; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  const submit = async (e: Event) => {
    e.preventDefault();
    const checked = validateReport({ reason, details });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    setPhase({ kind: "sending" });
    try {
      await reportReview(identity.token, review.id, checked.value.reason, checked.value.details);
      setPhase({ kind: "sent" });
    } catch (err) {
      const message =
        err instanceof NetworkError ? "אין חיבור לשרת. בדקו את החיבור ונסו שוב."
        : err instanceof ApiError && err.status === 409 ? "כבר דיווחתם על הביקורת הזו."
        : err instanceof ApiError && err.status === 429 ? "שלחתם יותר מדי דיווחים. נסו שוב מאוחר יותר."
        : "הדיווח לא נשלח. נסו שוב.";
      setPhase({ kind: "failed", message });
    }
  };

  if (phase.kind === "sent") {
    return (
      <div class="sb-stack sb-gap-3">
        <Notice kind="success" title="הדיווח התקבל">נבדוק את הביקורת ונעדכן אתכם בהחלטה.</Notice>
        <Button onClick={onClose}>חזרה לביקורות</Button>
      </div>
    );
  }

  return (
    <form class="form" onSubmit={submit} noValidate>
      <div class="sb-stack" style={{ gap: "2px" }}>
        <h2 class="sb-t-heading">דיווח על ביקורת</h2>
        <p class="sb-t-support sb-secondary">הדיווח אנונימי כלפי הכותב.</p>
      </div>
      <ChoiceGroup<ReportReason>
        legend="סיבת הדיווח"
        value={reason}
        onChange={setReason}
        options={REPORT_REASONS.map((r) => ({ value: r, label: REASON_LABEL[r] }))}
        error={errors.reason}
        disabled={phase.kind === "sending"}
      />
      <TextArea label="הסבר (לא חובה)" value={details} onInput={setDetails} maxChars={500} rows={3} error={errors.details} disabled={phase.kind === "sending"} />
      {phase.kind === "failed" && <FieldError>{phase.message}</FieldError>}
      <div class="sb-row sb-gap-2">
        <Button type="submit" variant="primary" disabled={phase.kind === "sending"}>{phase.kind === "sending" ? "שולחים…" : "שליחת דיווח"}</Button>
        <Button onClick={onClose} disabled={phase.kind === "sending"}>ביטול</Button>
      </div>
    </form>
  );
}
