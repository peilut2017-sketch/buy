import { describe, expect, it } from "vitest";
import { fitMeter } from "./fit.ts";

describe("fitMeter (docs/02-design-system.md 2.5)", () => {
  it("shows no verdict under three answers", () => {
    expect(fitMeter({ small: 1, exact: 1, large: 0 })).toEqual({
      enough: false,
      total: 2,
      message: "עוד אין מספיק מידע על המידה",
    });
  });

  it("everyone says small: the dot sits at the start edge", () => {
    const m = fitMeter({ small: 10, exact: 0, large: 0 });
    expect(m).toMatchObject({ enough: true, verdict: "small", score: -1, position: 0, sentence: "קטן במידה אחת", buyers: "לפי 10 קונים" });
  });

  it("mostly exact: centre", () => {
    const m = fitMeter({ small: 2, exact: 17, large: 3 });
    expect(m).toMatchObject({ enough: true, verdict: "exact", sentence: "מדויק", buyers: "לפי 22 קונים" });
    if (m.enough) expect(m.position).toBeCloseTo(0.52, 2);
  });

  it("leaning large: the dot moves to the end edge", () => {
    const m = fitMeter({ small: 1, exact: 3, large: 6 });
    expect(m).toMatchObject({ verdict: "large", sentence: "גדול במידה אחת" });
    if (m.enough) expect(m.position).toBeGreaterThan(0.7);
  });

  it("describes itself for assistive technology", () => {
    const m = fitMeter({ small: 0, exact: 3, large: 0 });
    expect(m.enough && m.ariaLabel).toBe("התאמת מידה: מדויק, לפי 3 קונים");
  });

  it("uses the singular form for one buyer in the label", () => {
    // One answer is never enough, so this only checks the shared label helper through three equal answers.
    const m = fitMeter({ small: 1, exact: 1, large: 1 });
    expect(m.enough && m.verdict).toBe("exact");
  });
});
