// Product detection decision rules. Spec: docs/01-product-spec.md section 4.
// Pure: it takes the SKUs that each signal found and decides. Reading the page is the config engine's job.

import type { Confidence, Detection, Signal } from "./types.ts";

export function normalizeSku(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const sku = raw.trim().toLowerCase();
  return sku === "" ? null : sku;
}

export interface SignalReading {
  name: string;
  /** What the signal found, already extracted. Null when the signal is absent or unreadable. */
  value: string | null;
}

export interface DecisionInput {
  siteId: string;
  /** The SKU from the page address. This is the deciding signal when present. */
  urlSku: string | null;
  /** Independent confirmations: canonical, og:url, image path, structured data, ... */
  verifications: SignalReading[];
  /** Derives the parent model SKU from a full SKU. */
  parentOf: (sku: string) => string | null;
}

/** The most common value, only when it has a strict lead. */
function strictMajority(values: string[]): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top) return null;
  const second = ranked[1];
  if (second && second[1] === top[1]) return null;
  return { value: top[0], count: top[1] };
}

/**
 * Rules, in order:
 * 1. URL SKU and at least one agreeing confirmation: high.
 * 2. URL SKU and no confirmation available: medium.
 * 3. URL SKU contradicted by two or more confirmations that outnumber the agreeing ones: the majority wins,
 *    medium, and `conflict` is set so the admin is alerted.
 * 4. No URL SKU: decided by the confirmations. Two or more agree: medium. A single one: low. None or a tie: none.
 * A lone confirmation that disagrees with the URL does not change the SKU, but the result is only medium.
 */
export function decideDetection(input: DecisionInput): Detection {
  const urlSku = normalizeSku(input.urlSku);
  const readings = input.verifications.map((s) => ({ name: s.name, value: normalizeSku(s.value) }));
  const present = readings.filter((s): s is { name: string; value: string } => s.value !== null);

  let sku: string | null = null;
  let confidence: Confidence = "none";
  let conflict = false;

  if (urlSku !== null) {
    const agreeing = present.filter((s) => s.value === urlSku);
    const disagreeing = present.filter((s) => s.value !== urlSku);
    if (disagreeing.length >= 2 && disagreeing.length > agreeing.length) {
      const majority = strictMajority([urlSku, ...present.map((s) => s.value)]);
      if (majority && majority.value !== urlSku) {
        sku = majority.value;
        confidence = "medium";
        conflict = true;
      } else {
        sku = null;
        confidence = "none";
        conflict = true;
      }
    } else {
      sku = urlSku;
      if (agreeing.length >= 1) confidence = "high";
      else {
        confidence = "medium";
        conflict = disagreeing.length > 0;
      }
    }
  } else {
    const majority = strictMajority(present.map((s) => s.value));
    if (majority) {
      sku = majority.value;
      confidence = majority.count >= 2 ? "medium" : "low";
    }
  }

  const signals: Signal[] = [
    { name: "url", value: urlSku, agrees: sku !== null && urlSku === sku },
    ...readings.map((s) => ({ name: s.name, value: s.value, agrees: sku !== null && s.value === sku })),
  ];

  return {
    siteId: input.siteId,
    sku,
    parentSku: sku ? input.parentOf(sku) : null,
    confidence,
    signals,
    conflict,
  };
}

/** The strip and the panel are shown for high and medium confidence only. Low is treated as not detected. */
export function isDetected(detection: Detection): boolean {
  return detection.sku !== null && (detection.confidence === "high" || detection.confidence === "medium");
}

/** A report the extension sends when detection fails or is doubtful. Carries no personal data. */
export function describeFailure(detection: Detection): { siteId: string; confidence: Confidence; conflict: boolean; signals: Signal[] } {
  return {
    siteId: detection.siteId,
    confidence: detection.confidence,
    conflict: detection.conflict,
    signals: detection.signals,
  };
}
