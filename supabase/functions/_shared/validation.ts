// Review validation shared by the Edge Functions (authoritative) and the extension forms (convenience).
// Pure TypeScript with no Deno or browser APIs, so Vitest, Deno and the browser all run the same rules.
// Spec: docs/01-product-spec.md section 6. User-facing messages are Hebrew.

export type Fit = "small" | "exact" | "large";
export type PhotoMatch = "yes" | "roughly" | "no";

export interface ReviewAnswers {
  fit?: Fit;
  usual_size?: string;
  matches_photo?: PhotoMatch;
  value?: number;
  recommend?: boolean;
}

export interface ReviewLimits {
  minChars: number;
  maxChars: number;
  titleMax: number;
  updateMinChars: number;
}

export const DEFAULT_REVIEW_LIMITS: ReviewLimits = {
  minChars: 30,
  maxChars: 2000,
  titleMax: 80,
  updateMinChars: 10,
};

export interface ReviewInput {
  rating?: unknown;
  title?: unknown;
  body?: unknown;
  answers?: unknown;
  purchaseMonth?: unknown;
}

export interface ReviewContext {
  /** Decided by the server from a matching order. A client can never claim it. */
  verified: boolean;
  /** Question keys marked required for the product type (from category_questions). */
  requiredAnswers: readonly string[];
  now: Date;
  limits?: Partial<ReviewLimits>;
}

export interface CleanReview {
  rating: number;
  title: string | null;
  body: string | null;
  answers: ReviewAnswers;
  /** First day of the month, YYYY-MM-01. Null for verified reviews and quick ratings. */
  purchaseMonth: string | null;
}

export type FieldErrors = Record<string, string>;
export type Validation<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

const FITS: readonly string[] = ["small", "exact", "large"];
const PHOTO_MATCHES: readonly string[] = ["yes", "roughly", "no"];
const ANSWER_KEYS: readonly string[] = ["fit", "usual_size", "matches_photo", "value", "recommend"];

/** Length in characters as the database counts them (code points), not UTF-16 units. */
export function charLength(text: string): number {
  return Array.from(text).length;
}

function cleanText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** "2026-09" or "2026-09-01" to "2026-09-01". Null when the shape is wrong. */
export function normalizeMonth(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/.exec(raw.trim());
  return match ? `${match[1]}-${match[2]}-01` : null;
}

export function validateAnswers(raw: unknown): Validation<ReviewAnswers> {
  if (raw === null || raw === undefined) return { ok: true, value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: { answers: "התשובות לא תקינות." } };
  }
  const input = raw as Record<string, unknown>;
  const errors: FieldErrors = {};
  const value: ReviewAnswers = {};

  for (const key of Object.keys(input)) {
    if (!ANSWER_KEYS.includes(key)) errors[key] = "שאלה לא מוכרת.";
  }
  if (input.fit !== undefined && input.fit !== null) {
    if (typeof input.fit === "string" && FITS.includes(input.fit)) value.fit = input.fit as Fit;
    else errors.fit = "בחרו קטן, מדויק או גדול.";
  }
  if (input.matches_photo !== undefined && input.matches_photo !== null) {
    if (typeof input.matches_photo === "string" && PHOTO_MATCHES.includes(input.matches_photo)) {
      value.matches_photo = input.matches_photo as PhotoMatch;
    } else errors.matches_photo = "בחרו כן, בערך או לא.";
  }
  if (input.value !== undefined && input.value !== null) {
    if (Number.isInteger(input.value) && (input.value as number) >= 1 && (input.value as number) <= 5) {
      value.value = input.value as number;
    } else errors.value = "דרגו בין 1 ל-5.";
  }
  if (input.recommend !== undefined && input.recommend !== null) {
    if (typeof input.recommend === "boolean") value.recommend = input.recommend;
    else errors.recommend = "בחרו כן או לא.";
  }
  if (input.usual_size !== undefined && input.usual_size !== null) {
    const size = cleanText(input.usual_size);
    if (size !== null && charLength(size) <= 20) value.usual_size = size;
    else if (size !== null) errors.usual_size = "המידה ארוכה מדי.";
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

/**
 * Validates a review before it is stored.
 * A review without text is a quick rating: it needs only a rating and is never published.
 * A review with text also needs the required answers, and a purchase month unless it is verified.
 */
export function validateReview(input: ReviewInput, ctx: ReviewContext): Validation<CleanReview> {
  const limits = { ...DEFAULT_REVIEW_LIMITS, ...ctx.limits };
  const errors: FieldErrors = {};

  const rating = input.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    errors.rating = "בחרו דירוג בין 1 ל-5 כוכבים.";
  }

  const title = cleanText(input.title);
  if (title !== null && charLength(title) > limits.titleMax) {
    errors.title = `הכותרת יכולה להכיל עד ${limits.titleMax} תווים.`;
  }

  const body = cleanText(input.body);
  if (body !== null) {
    const length = charLength(body);
    if (length < limits.minChars) {
      errors.body = `הביקורת קצרה מדי. כתבו לפחות ${limits.minChars} תווים (כרגע ${length}).`;
    } else if (length > limits.maxChars) {
      errors.body = `הביקורת ארוכה מדי. אפשר עד ${formatNumber(limits.maxChars)} תווים.`;
    }
  }

  const answers = validateAnswers(input.answers);
  if (!answers.ok) Object.assign(errors, answers.errors);

  let purchaseMonth: string | null = null;
  if (body !== null) {
    if (answers.ok) {
      for (const key of ctx.requiredAnswers) {
        if ((answers.value as Record<string, unknown>)[key] === undefined) {
          errors[key] = key === "fit" ? "בחרו איך המידה." : "זו שאלת חובה.";
        }
      }
    }
    if (!ctx.verified) {
      purchaseMonth = normalizeMonth(input.purchaseMonth);
      if (purchaseMonth === null) {
        errors.purchaseMonth = "בחרו את חודש הרכישה.";
      } else if (purchaseMonth.slice(0, 7) > ctx.now.toISOString().slice(0, 7)) {
        errors.purchaseMonth = "חודש הרכישה לא יכול להיות בעתיד.";
      }
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      rating: rating as number,
      title,
      body,
      answers: answers.ok ? answers.value : {},
      purchaseMonth,
    },
  };
}

export interface ReviewUpdateInput {
  body?: unknown;
  rating?: unknown;
}

export interface CleanReviewUpdate {
  body: string;
  rating: number | null;
}

/** A later update to the same review ("עדכון אחרי 4 חודשים"). */
export function validateReviewUpdate(
  input: ReviewUpdateInput,
  limits: Partial<ReviewLimits> = {},
): Validation<CleanReviewUpdate> {
  const l = { ...DEFAULT_REVIEW_LIMITS, ...limits };
  const errors: FieldErrors = {};
  const body = cleanText(input.body);
  if (body === null || charLength(body) < l.updateMinChars) {
    errors.body = `העדכון קצר מדי. כתבו לפחות ${l.updateMinChars} תווים.`;
  } else if (charLength(body) > l.maxChars) {
    errors.body = `העדכון ארוך מדי. אפשר עד ${formatNumber(l.maxChars)} תווים.`;
  }
  let rating: number | null = null;
  if (input.rating !== undefined && input.rating !== null) {
    if (typeof input.rating === "number" && Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 5) {
      rating = input.rating;
    } else errors.rating = "בחרו דירוג בין 1 ל-5 כוכבים.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { body: body as string, rating } };
}

export type ReportReason = "spam" | "off_topic" | "offensive" | "personal_or_defamation" | "fake" | "other";

export const REPORT_REASONS: readonly ReportReason[] = [
  "spam",
  "off_topic",
  "offensive",
  "personal_or_defamation",
  "fake",
  "other",
];

export interface CleanReport {
  reason: ReportReason;
  details: string | null;
}

export function validateReport(input: { reason?: unknown; details?: unknown }): Validation<CleanReport> {
  const errors: FieldErrors = {};
  const reason = input.reason;
  if (typeof reason !== "string" || !REPORT_REASONS.includes(reason as ReportReason)) {
    errors.reason = "בחרו סיבה לדיווח.";
  }
  const details = cleanText(input.details);
  if (details !== null && charLength(details) > 500) errors.details = "ההסבר יכול להכיל עד 500 תווים.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { reason: reason as ReportReason, details } };
}

/** Nickname rules (spec 12): 2 to 30 characters, no leading or trailing spaces. */
export function validateNickname(raw: unknown): Validation<string> {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  const length = charLength(name);
  if (length < 2) return { ok: false, errors: { displayName: "הכינוי צריך להכיל לפחות 2 תווים." } };
  if (length > 30) return { ok: false, errors: { displayName: "הכינוי יכול להכיל עד 30 תווים." } };
  if (!/^[\p{L}\p{N}_.\- ]+$/u.test(name)) {
    return { ok: false, errors: { displayName: "אפשר להשתמש באותיות, ספרות, רווח, נקודה, מקף וקו תחתון בלבד." } };
  }
  return { ok: true, value: name };
}
