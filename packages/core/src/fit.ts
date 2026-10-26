// The size-fit meter: SmartBuy's signature element. Spec: docs/02-design-system.md section 2.5.

import { BUYERS, countLabel } from "./he.ts";

export interface FitCounts {
  small: number;
  exact: number;
  large: number;
}

export type FitVerdict = "small" | "exact" | "large";

export const FIT_MIN_ANSWERS = 3;
/** Share of the answers by which the average must lean before the verdict stops being "exact". */
export const FIT_LEAN_THRESHOLD = 0.34;

export const FIT_NOT_ENOUGH = "עוד אין מספיק מידע על המידה";

export type FitMeter =
  | { enough: false; total: number; message: string }
  | {
      enough: true;
      total: number;
      verdict: FitVerdict;
      /** -1 (everyone says small) to 1 (everyone says large). */
      score: number;
      /** 0 at the start edge (small, the right side in RTL) to 1 at the end edge (large). */
      position: number;
      sentence: string;
      buyers: string;
      /** For role="img" on the meter. */
      ariaLabel: string;
    };

const SENTENCE: Record<FitVerdict, string> = {
  small: "קטן במידה אחת",
  exact: "מדויק",
  large: "גדול במידה אחת",
};

export function fitMeter(counts: FitCounts): FitMeter {
  const total = counts.small + counts.exact + counts.large;
  if (total < FIT_MIN_ANSWERS) return { enough: false, total, message: FIT_NOT_ENOUGH };
  const score = (counts.large - counts.small) / total;
  const verdict: FitVerdict = score <= -FIT_LEAN_THRESHOLD ? "small" : score >= FIT_LEAN_THRESHOLD ? "large" : "exact";
  const buyers = `לפי ${countLabel(total, BUYERS)}`;
  const sentence = SENTENCE[verdict];
  return {
    enough: true,
    total,
    verdict,
    score,
    position: (score + 1) / 2,
    sentence,
    buyers,
    ariaLabel: `התאמת מידה: ${sentence}, ${buyers}`,
  };
}
