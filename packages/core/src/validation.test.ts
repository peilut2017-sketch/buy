import { describe, expect, it } from "vitest";
import {
  decideAutoHide,
  hashOrderNumber,
  isAbusiveReporter,
  isReviewWave,
  normalizeOrderNumber,
  pendingDueAt,
  validateNickname,
  validateOrderInput,
  validateReport,
  validateReview,
  validateReviewUpdate,
  writtenBeforeDelivery,
  canWriteVerified,
  type ReviewContext,
} from "./index.ts";

const now = new Date("2026-10-25T10:00:00Z");
const ctx = (over: Partial<ReviewContext> = {}): ReviewContext => ({ verified: false, requiredAnswers: ["fit"], now, ...over });
const text = "המכנסיים נוחים והבד באיכות טובה, ממליץ בחום.";

describe("validateReview", () => {
  it("accepts a complete unverified review and normalizes the month", () => {
    const r = validateReview({ rating: 4, body: `  ${text}  `, answers: { fit: "exact" }, purchaseMonth: "2026-09" }, ctx());
    expect(r).toEqual({
      ok: true,
      value: { rating: 4, title: null, body: text, answers: { fit: "exact" }, purchaseMonth: "2026-09-01" },
    });
  });

  it("a verified review needs no purchase month and ignores one", () => {
    const r = validateReview({ rating: 5, body: text, answers: { fit: "small" }, purchaseMonth: "2026-09" }, ctx({ verified: true }));
    expect(r).toMatchObject({ ok: true, value: { purchaseMonth: null } });
  });

  it("requires the purchase month for an unverified review with text", () => {
    const r = validateReview({ rating: 4, body: text, answers: { fit: "exact" } }, ctx());
    expect(r).toEqual({ ok: false, errors: { purchaseMonth: "בחרו את חודש הרכישה." } });
  });

  it("rejects a purchase month in the future but allows the current month", () => {
    expect(validateReview({ rating: 4, body: text, answers: { fit: "exact" }, purchaseMonth: "2026-11" }, ctx())).toMatchObject({
      ok: false,
      errors: { purchaseMonth: "חודש הרכישה לא יכול להיות בעתיד." },
    });
    expect(validateReview({ rating: 4, body: text, answers: { fit: "exact" }, purchaseMonth: "2026-10" }, ctx()).ok).toBe(true);
  });

  it("requires the answers the category marks as required", () => {
    const r = validateReview({ rating: 4, body: text, purchaseMonth: "2026-09" }, ctx());
    expect(r).toEqual({ ok: false, errors: { fit: "בחרו איך המידה." } });
    expect(validateReview({ rating: 4, body: text, purchaseMonth: "2026-09" }, ctx({ requiredAnswers: [] })).ok).toBe(true);
  });

  it("enforces the text length with the count in the message", () => {
    const short = validateReview({ rating: 4, body: "קצר מדי", answers: { fit: "exact" }, purchaseMonth: "2026-09" }, ctx());
    expect(short).toMatchObject({ ok: false, errors: { body: "הביקורת קצרה מדי. כתבו לפחות 30 תווים (כרגע 7)." } });
    const long = validateReview({ rating: 4, body: "א".repeat(2001), answers: { fit: "exact" }, purchaseMonth: "2026-09" }, ctx());
    expect(long).toMatchObject({ ok: false, errors: { body: "הביקורת ארוכה מדי. אפשר עד 2,000 תווים." } });
  });

  it("counts characters the way the database does", () => {
    const emoji = "😀".repeat(30);
    expect(validateReview({ rating: 4, body: emoji, answers: { fit: "exact" }, purchaseMonth: "2026-09" }, ctx()).ok).toBe(true);
  });

  it("when the form requires text it reports every problem at once, including the ones that depend on text", () => {
    const r = validateReview({ rating: null }, ctx({ requireBody: true }));
    expect(r).toEqual({
      ok: false,
      errors: {
        rating: "בחרו דירוג בין 1 ל-5 כוכבים.",
        body: "כתבו כמה מילים על המוצר.",
        fit: "בחרו איך המידה.",
        purchaseMonth: "בחרו את חודש הרכישה.",
      },
    });
  });

  it("a rating alone is a quick rating: no text, no other requirements", () => {
    expect(validateReview({ rating: 3 }, ctx())).toEqual({
      ok: true,
      value: { rating: 3, title: null, body: null, answers: {}, purchaseMonth: null },
    });
  });

  it.each([0, 6, 3.5, "5", null, undefined])("rejects the rating %s", (rating) => {
    expect(validateReview({ rating }, ctx())).toMatchObject({ ok: false, errors: { rating: "בחרו דירוג בין 1 ל-5 כוכבים." } });
  });

  it("limits the title, and drops an empty one", () => {
    expect(validateReview({ rating: 4, title: "א".repeat(81) }, ctx())).toMatchObject({ ok: false, errors: { title: "הכותרת יכולה להכיל עד 80 תווים." } });
    expect(validateReview({ rating: 4, title: "   " }, ctx())).toMatchObject({ ok: true, value: { title: null } });
  });

  it("rejects unknown or malformed answers", () => {
    expect(validateReview({ rating: 4, answers: { fit: "huge" } }, ctx())).toMatchObject({ ok: false, errors: { fit: "בחרו קטן, מדויק או גדול." } });
    expect(validateReview({ rating: 4, answers: { value: 9 } }, ctx())).toMatchObject({ ok: false, errors: { value: "דרגו בין 1 ל-5." } });
    expect(validateReview({ rating: 4, answers: { color: "red" } }, ctx())).toMatchObject({ ok: false, errors: { color: "שאלה לא מוכרת." } });
    expect(validateReview({ rating: 4, answers: "fit" }, ctx())).toMatchObject({ ok: false, errors: { answers: "התשובות לא תקינות." } });
  });
});

describe("validateReviewUpdate / validateReport / validateNickname", () => {
  it("validates an update", () => {
    expect(validateReviewUpdate({ body: "אחרי 4 חודשים הבד עדיין במצב מצוין", rating: 5 })).toMatchObject({ ok: true, value: { rating: 5 } });
    expect(validateReviewUpdate({ body: "קצר" })).toMatchObject({ ok: false });
    expect(validateReviewUpdate({ body: "אחרי 4 חודשים הבד עדיין במצב מצוין", rating: 9 })).toMatchObject({ ok: false });
  });

  it("validates a report", () => {
    expect(validateReport({ reason: "spam" })).toEqual({ ok: true, value: { reason: "spam", details: null } });
    expect(validateReport({ reason: "nope" })).toMatchObject({ ok: false, errors: { reason: "בחרו סיבה לדיווח." } });
    expect(validateReport({ reason: "other", details: "א".repeat(501) })).toMatchObject({ ok: false });
  });

  it("validates a nickname", () => {
    expect(validateNickname("  דנה   כהן ")).toEqual({ ok: true, value: "דנה כהן" });
    expect(validateNickname("a")).toMatchObject({ ok: false });
    expect(validateNickname("א".repeat(31))).toMatchObject({ ok: false });
    expect(validateNickname("dana<script>")).toMatchObject({ ok: false });
    expect(validateNickname("dana_k.88")).toMatchObject({ ok: true });
  });
});

describe("moderation (spec 10, 11)", () => {
  const settings = { reports: 3, minReporterLevel: "active" as const, instantReasons: ["personal_or_defamation" as const] };
  const abuse = { dismissedRatio: 0.7, minReports: 5 };
  const report = (id: string, over = {}) => ({
    reporterId: id,
    reason: "spam" as const,
    reporterLevel: "active" as const,
    reporterReportsFiled: 1,
    reporterReportsDismissed: 0,
    ...over,
  });

  it("hides at once for personal details or defamation", () => {
    expect(decideAutoHide([report("a", { reason: "personal_or_defamation", reporterLevel: "new" })], settings, abuse)).toEqual({ hide: true, reason: "instant" });
  });

  it("hides at the threshold of different qualifying reporters", () => {
    expect(decideAutoHide([report("a"), report("b")], settings, abuse).hide).toBe(false);
    expect(decideAutoHide([report("a"), report("b"), report("c")], settings, abuse)).toEqual({ hide: true, reason: "threshold" });
  });

  it("does not count the same reporter twice, new accounts, or abusive reporters", () => {
    expect(decideAutoHide([report("a"), report("a"), report("b")], settings, abuse).hide).toBe(false);
    expect(decideAutoHide([report("a"), report("b"), report("c", { reporterLevel: "new" })], settings, abuse).hide).toBe(false);
    expect(decideAutoHide([report("a"), report("b"), report("c", { reporterReportsFiled: 10, reporterReportsDismissed: 9 })], settings, abuse).hide).toBe(false);
  });

  it("calls a reporter abusive only above the ratio and from the minimum number of reports", () => {
    expect(isAbusiveReporter(10, 8, abuse)).toBe(true);
    expect(isAbusiveReporter(10, 7, abuse)).toBe(false);
    expect(isAbusiveReporter(4, 4, abuse)).toBe(false);
  });

  it("flags a wave of more than five reviews in 24 hours", () => {
    const at = (h: number) => new Date(now.getTime() - h * 3_600_000);
    const wave = { threshold: 5, windowHours: 24 };
    expect(isReviewWave([at(1), at(2), at(3), at(4), at(5)], now, wave)).toBe(false);
    expect(isReviewWave([at(1), at(2), at(3), at(4), at(5), at(6)], now, wave)).toBe(true);
    expect(isReviewWave([at(1), at(2), at(3), at(4), at(5), at(30)], now, wave)).toBe(false);
  });

  it("flags a verified review written before the delivery date", () => {
    expect(writtenBeforeDelivery(new Date("2026-02-05T10:00:00Z"), "2026-02-10")).toBe(true);
    expect(writtenBeforeDelivery(new Date("2026-02-10T10:00:00Z"), "2026-02-10")).toBe(false);
    expect(writtenBeforeDelivery(new Date("2026-02-05T10:00:00Z"), null)).toBe(false);
  });
});

describe("orders (spec 7, 8; privacy rule 7)", () => {
  const pepper = "test-pepper-0123456789";

  it("hashes the order number the same way however it is typed", async () => {
    const a = await hashOrderNumber("terminalx", " tx-1234 ", pepper);
    const b = await hashOrderNumber("terminalx", "TX-1234", pepper);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("1234");
  });

  it("changes with the site and the pepper, so hashes cannot be matched across them", async () => {
    const base = await hashOrderNumber("terminalx", "TX-1234", pepper);
    expect(await hashOrderNumber("other", "TX-1234", pepper)).not.toBe(base);
    expect(await hashOrderNumber("terminalx", "TX-1234", `${pepper}x`)).not.toBe(base);
  });

  it("refuses to hash without a real pepper", async () => {
    await expect(hashOrderNumber("terminalx", "TX-1234", "short")).rejects.toThrow();
  });

  it("normalizes order numbers", () => {
    expect(normalizeOrderNumber(" tx 12 34 ")).toBe("TX1234");
  });

  it("schedules the review reminder 14 days after delivery", () => {
    expect(pendingDueAt("2026-10-20")).toBe("2026-11-03T00:00:00Z");
    expect(pendingDueAt("2026-12-25")).toBe("2027-01-08T00:00:00Z");
  });

  it("opens verified writing only after delivery", () => {
    expect(canWriteVerified("2026-10-20", "2026-10-25")).toBe(true);
    expect(canWriteVerified("2026-10-25", "2026-10-25")).toBe(true);
    expect(canWriteVerified("2026-10-26", "2026-10-25")).toBe(false);
    expect(canWriteVerified(null, "2026-10-25")).toBe(false);
  });

  it("validates an order payload", () => {
    const ok = { orderNumber: "TX-1234", orderedAt: "2026-10-01", deliveredAt: null, items: [{ sku: "w817260002" }] };
    expect(validateOrderInput(ok)).toEqual({ ok: true });
    expect(validateOrderInput({ ...ok, orderNumber: "x" }).ok).toBe(false);
    expect(validateOrderInput({ ...ok, orderedAt: "2026-13-40" }).ok).toBe(false);
    expect(validateOrderInput({ ...ok, items: [] }).ok).toBe(false);
    expect(validateOrderInput({ ...ok, items: [{ sku: "" }] }).ok).toBe(false);
  });
});
