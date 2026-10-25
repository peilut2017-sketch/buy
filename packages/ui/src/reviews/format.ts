import {
  FIT_LABEL,
  LEVEL_LABEL,
  REVIEWS,
  SELF_REPORTED_NOTE,
  STAGE_LABEL,
  countLabel,
  formatDateHe,
  formatRelative,
  sincePurchase,
  updateAfterText,
  type ReviewView,
} from "@smartbuy/core";

/** "מועיל" counts are shown as plain numbers; zero shows no number. */
export function helpfulLabel(count: number): string {
  return count > 0 ? `מועיל (${count})` : "מועיל";
}

export function authorLine(review: ReviewView): string {
  if (!review.author) return "";
  const { level, reviewsCount, helpfulReceived } = review.author;
  const parts = [LEVEL_LABEL[level], countLabel(reviewsCount, REVIEWS)];
  if (helpfulReceived > 0) parts.push(`${helpfulReceived} סימוני מועיל`);
  return parts.join(" · ");
}

export interface ReviewTiming {
  stage: string | null;
  afterPurchase: string | null;
  selfReportedNote: string | null;
  written: string;
  edited: string | null;
  flagged: boolean;
}

export function reviewTiming(review: ReviewView, now: Date): ReviewTiming {
  const since = sincePurchase(review, review.writtenAt);
  return {
    stage: since ? STAGE_LABEL[since.stage] : null,
    afterPurchase: since ? `נכתבה ${since.text}` : null,
    selfReportedNote: since?.selfReported ? SELF_REPORTED_NOTE : null,
    written: formatRelative(review.writtenAt, now),
    edited: review.editedAt ? `נערך ${formatDateHe(review.editedAt)}` : null,
    flagged: since?.beforeDelivery ?? false,
  };
}

export function updateLabel(review: ReviewView, updateAt: string): string {
  return updateAfterText(review.writtenAt, updateAt);
}

const PHOTO_LABEL: Record<string, string> = { yes: "כן", roughly: "בערך", no: "לא" };

/** The review's optional answers as short facts: "המידה: קטן · תואם לתמונה: כן". */
export function answerFacts(answers: Record<string, unknown>): string[] {
  const facts: string[] = [];
  const fit = answers.fit;
  if (fit === "small" || fit === "exact" || fit === "large") facts.push(`המידה: ${FIT_LABEL[fit]}`);
  if (typeof answers.usual_size === "string") facts.push(`מידה רגילה: ${answers.usual_size}`);
  if (typeof answers.matches_photo === "string" && PHOTO_LABEL[answers.matches_photo]) facts.push(`תואם לתמונה: ${PHOTO_LABEL[answers.matches_photo]}`);
  if (typeof answers.value === "number") facts.push(`איכות ביחס למחיר: ${answers.value} מתוך 5`);
  if (answers.recommend === true) facts.push("ממליץ לקנות");
  if (answers.recommend === false) facts.push("לא ממליץ לקנות");
  return facts;
}

/** What the buyer bought, for example "צבע: כחול · מידה: M". The groups named in `order` come first, in that order. */
export function variantText(values: Record<string, string>, order: readonly (string | null | undefined)[] = []): string {
  const rank = (name: string) => {
    const i = order.indexOf(name);
    return i === -1 ? order.length : i;
  };
  return Object.entries(values)
    .filter(([, v]) => v.trim() !== "")
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
}

const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

/** The last 24 months for the purchase-month list, newest first, as { value: "2026-09", label: "ספטמבר 2026" }. */
export function recentMonths(now: Date, count = 24): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  for (let i = 0; i < count; i++) {
    out.push({ value: `${year}-${String(month + 1).padStart(2, "0")}`, label: `${MONTHS[month]} ${year}` });
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return out;
}
