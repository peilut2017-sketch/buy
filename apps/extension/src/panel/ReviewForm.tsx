import { validateReview, type ReviewAnswers } from "@smartbuy/core";
import { Button, Chip, ChoiceGroup, FieldError, Notice, SelectField, StarInput, TextArea, TextField } from "@smartbuy/ui";
import { useMemo, useState } from "preact/hooks";
import type { Identity } from "../lib/auth.ts";
import { submitReview, type MyReview, type Question, type SubmitReviewPayload } from "../lib/data.ts";
import { ApiError, NetworkError } from "../lib/rest.ts";
import { recentMonths } from "./format.ts";
import type { ProductRef } from "./ProductHeader.tsx";

type Phase = { kind: "form" } | { kind: "sending" } | { kind: "sent"; edited: boolean } | { kind: "failed"; message: string };

export interface ReviewFormProps {
  product: ProductRef;
  identity: Identity;
  existing: MyReview | null;
  questions: Question[];
  /** The user has a delivered order for this product, so the purchase month is not asked. */
  hasOrder: boolean;
  onDone: () => void;
  onCancel: () => void;
}

const YES_NO = [
  { value: "yes", label: "כן" },
  { value: "no", label: "לא" },
] as const;

function initialAnswers(existing: MyReview | null): Record<string, unknown> {
  return { ...(existing?.answers ?? {}) };
}

export function ReviewForm({ product, identity, existing, questions, hasOrder, onDone, onCancel }: ReviewFormProps) {
  const snap = product.snapshot;
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [answers, setAnswers] = useState<Record<string, unknown>>(initialAnswers(existing));
  const [month, setMonth] = useState(existing?.purchaseMonth?.slice(0, 7) ?? "");
  const [variant, setVariant] = useState<Record<string, string>>({ ...(existing?.variantValues ?? {}), ...(snap?.variantValues ?? {}) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const months = useMemo(() => recentMonths(new Date()), []);
  const sending = phase.kind === "sending";

  const setAnswer = (key: string, value: unknown) => setAnswers((a) => ({ ...a, [key]: value }));

  const submit = async (e: Event) => {
    e.preventDefault();
    // The text is what makes it a review, so the form requires it and shows every problem at once.
    const checked = validateReview(
      { rating, title, body, answers, purchaseMonth: month || null },
      { verified: hasOrder, requiredAnswers: questions.filter((q) => q.required).map((q) => q.key), now: new Date(), requireBody: true },
    );
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setPhase({ kind: "sending" });

    const payload: SubmitReviewPayload = {
      siteId: product.siteId,
      sku: product.sku,
      parentSku: product.parentSku,
      productType: snap?.productType ?? "general",
      detectionConfidence: snap?.confidence === "high" ? "high" : snap?.confidence === "medium" ? "medium" : "low",
      product: { name: snap?.name ?? null, brand: snap?.brand ?? null, imageUrl: snap?.imageUrl ?? null, url: snap?.url ?? "" },
      variantValues: variant,
      rating: checked.value.rating,
      title: checked.value.title,
      body: checked.value.body,
      answers: checked.value.answers as ReviewAnswers & Record<string, unknown>,
      purchaseMonth: checked.value.purchaseMonth,
    };
    try {
      const result = await submitReview(identity.token, payload);
      if (!result.reviewId) throw new ApiError("not saved", 500);
      setPhase({ kind: "sent", edited: existing !== null });
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
        setErrors(err.fieldErrors);
        setPhase({ kind: "form" });
        return;
      }
      setPhase({
        kind: "failed",
        message:
          err instanceof NetworkError ? "אין חיבור לשרת. הביקורת לא נשמרה. בדקו את החיבור ונסו שוב."
          : err instanceof ApiError && err.status === 429 ? "כתבתם יותר מדי ביקורות היום. נסו שוב מחר."
          : err instanceof ApiError && err.status === 401 ? "ההתחברות פגה. התחברו מחדש ונסו שוב."
          : "הביקורת לא נשמרה. נסו שוב.",
      });
    }
  };

  if (phase.kind === "sent") {
    return (
      <div class="sb-stack sb-gap-3">
        <Notice kind="success" title={phase.edited ? "השינויים נשמרו" : "הביקורת פורסמה"}>
          {phase.edited ? "הביקורת שלכם עודכנה ומסומנת כנערכה." : "תודה! הביקורת שלכם תעזור למי שקונה אחריכם."}
        </Notice>
        <Button variant="primary" onClick={onDone}>חזרה לביקורות</Button>
      </div>
    );
  }

  const fit = questions.find((q) => q.key === "fit");
  const usualSize = questions.find((q) => q.key === "usual_size");
  const photo = questions.find((q) => q.key === "matches_photo");
  const value = questions.find((q) => q.key === "value");
  const recommend = questions.find((q) => q.key === "recommend");
  const options = (q: Question | undefined) => (q && Array.isArray(q.options) ? q.options : []);
  const variantGroups = snap?.variantOptions ?? [];

  return (
    <form class="form" onSubmit={submit} noValidate aria-label={existing ? "עריכת ביקורת" : "כתיבת ביקורת"}>
      <h2 class="sb-t-heading">{existing ? "עריכת הביקורת" : "כתיבת ביקורת"}</h2>

      <StarInput value={rating} onChange={setRating} error={errors.rating} />

      {(variantGroups.length > 0 || Object.keys(variant).length > 0) && (
        <div class="form__section">
          <span class="sb-label">הווריאנט שקניתם</span>
          {variantGroups.length > 0
            ? variantGroups.map((g) => (
                <SelectField
                  key={g.name}
                  label={g.name}
                  value={variant[g.name] ?? ""}
                  onChange={(v) => setVariant((cur) => ({ ...cur, [g.name]: v }))}
                  options={g.values.map((v) => ({ value: v.value, label: v.value }))}
                  placeholder="בחירה"
                  disabled={sending}
                />
              ))
            : (
              <div class="sb-row sb-gap-2 sb-wrap">
                {Object.entries(variant).map(([k, v]) => <Chip key={k}>{k}: {v}</Chip>)}
              </div>
            )}
        </div>
      )}

      <div class="form__section">
        {fit && (
          <ChoiceGroup
            legend={fit.label}
            value={(answers.fit as string | undefined) ?? null}
            onChange={(v) => setAnswer("fit", v)}
            options={options(fit)}
            error={errors.fit}
            disabled={sending}
          />
        )}
        {usualSize && (
          <TextField label={usualSize.label} value={String(answers.usual_size ?? "")} maxLength={20} placeholder="למשל M או 42" onInput={(e) => setAnswer("usual_size", (e.currentTarget as HTMLInputElement).value || undefined)} error={errors.usual_size} disabled={sending} />
        )}
        {photo && (
          <ChoiceGroup
            legend={photo.label}
            value={(answers.matches_photo as string | undefined) ?? null}
            onChange={(v) => setAnswer("matches_photo", v)}
            options={options(photo)}
            error={errors.matches_photo}
            disabled={sending}
          />
        )}
        {value && <StarInput legend={value.label} value={typeof answers.value === "number" ? answers.value : null} onChange={(n) => setAnswer("value", n)} error={errors.value} />}
        {recommend && (
          <ChoiceGroup
            legend={recommend.label}
            value={answers.recommend === true ? "yes" : answers.recommend === false ? "no" : null}
            onChange={(v) => setAnswer("recommend", v === "yes")}
            options={[...YES_NO]}
            error={errors.recommend}
            disabled={sending}
          />
        )}
      </div>

      {!hasOrder && (
        <SelectField
          label="מתי קניתם?"
          hint="החודש מוצג ליד הביקורת, מסומן כדיווח שלכם."
          value={month}
          onChange={setMonth}
          options={months}
          placeholder="בחירת חודש"
          error={errors.purchaseMonth}
          disabled={sending}
        />
      )}

      <TextField label="כותרת (לא חובה)" value={title} maxLength={80} onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} error={errors.title} disabled={sending} />
      <TextArea label="הביקורת שלכם" value={body} onInput={setBody} minChars={30} maxChars={2000} rows={6} placeholder="איך המוצר בפועל? איך הבד, המידה והגזרה?" error={errors.body} disabled={sending} />

      {phase.kind === "failed" && <FieldError>{phase.message}</FieldError>}

      <div class="sb-row sb-gap-2">
        <Button type="submit" variant="primary" disabled={sending}>{sending ? "שולחים…" : existing ? "שמירת השינויים" : "פרסום ביקורת"}</Button>
        <Button onClick={onCancel} disabled={sending}>ביטול</Button>
      </div>
    </form>
  );
}
