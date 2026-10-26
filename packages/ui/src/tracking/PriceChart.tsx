import { buildSeries, formatDateHe, formatIls, lowestInWindow, type PricePoint } from "@smartbuy/core";

const W = 320;
const H = 150;
const PAD = { top: 10, end: 12, bottom: 22, start: 58 };

/**
 * A step chart of the price over the last 90 days: restrained grid, one line, an optional dashed target.
 * Prices are stored as changes, so the line holds until the next change. Time runs left to right, as numbers and dates do.
 * The direction is set in CSS: SVG text-anchor start/end follow the CSS direction, which the page sets to rtl.
 */
export function PriceChart({ points, target, now, days = 90 }: { points: readonly PricePoint[]; target?: number | null; now: Date; days?: number }) {
  const series = buildSeries(points, now, days);
  if (series.length === 0) return null;

  const start = now.getTime() - days * 86_400_000;
  const prices = series.map((p) => p.price).concat(target ? [target] : []);
  let lo = Math.min(...prices);
  let hi = Math.max(...prices);
  if (lo === hi) {
    lo *= 0.95;
    hi *= 1.05;
  }
  const pad = (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;

  const x = (t: number) => PAD.start + ((t - start) / (now.getTime() - start)) * (W - PAD.start - PAD.end);
  const y = (p: number) => PAD.top + (1 - (p - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  let d = `M ${x(series[0]!.t).toFixed(1)} ${y(series[0]!.price).toFixed(1)}`;
  for (let i = 1; i < series.length; i++) d += ` H ${x(series[i]!.t).toFixed(1)} V ${y(series[i]!.price).toFixed(1)}`;

  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  const last = series[series.length - 1]!;
  const low = lowestInWindow(points, now, days);
  const summary = `גרף מחיר ל-${days} ימים. המחיר הנוכחי ${formatIls(last.price)}${low ? `. הנמוך ביותר ${formatIls(low.price)} מ-${formatDateHe(low.since)}` : ""}${target ? `. יעד המעקב ${formatIls(target)}` : ""}.`;

  return (
    <figure style={{ margin: 0 }}>
      <svg class="sb-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} style={{ inlineSize: "100%", blockSize: "auto", display: "block", direction: "ltr", maxInlineSize: "480px" }}>
        {ticks.map((p) => (
          <g key={p}>
            <line class="sb-chart__grid" x1={PAD.start} x2={W - PAD.end} y1={y(p)} y2={y(p)} />
            <text x={PAD.start - 6} y={y(p) + 4} text-anchor="end">{formatIls(Math.round(p * 100) / 100)}</text>
          </g>
        ))}
        {target ? <line class="sb-chart__target" x1={PAD.start} x2={W - PAD.end} y1={y(target)} y2={y(target)} /> : null}
        <path class="sb-chart__line" d={d} />
        <circle class="sb-chart__dot" cx={x(last.t)} cy={y(last.price)} r="3.5" />
        <text x={PAD.start} y={H - 6} text-anchor="start">{formatDateHe(new Date(start)).slice(0, 5)}</text>
        <text x={W - PAD.end} y={H - 6} text-anchor="end">היום</text>
      </svg>
      <figcaption class="sb-visually-hidden">{summary}</figcaption>
    </figure>
  );
}
