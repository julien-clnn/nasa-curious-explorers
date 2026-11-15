// Data colour scales. UI chrome never uses these; data never uses the UI accent.

export type Stop = [number, [number, number, number]];

function ramp(stops: Stop[], v: number) {
  const x = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], v));
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (x <= b) {
      const u = (x - a) / (b - a || 1);
      return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * u)).join(",")})`;
    }
  }
  return `rgb(${stops[stops.length - 1][1].join(",")})`;
}

/**
 * Fire figures (counts) use one sequential scale: very light yellow → dark red.
 */
const FIRE: [number, number, number][] = [
  [255, 247, 194], [255, 224, 138], [253, 186, 77], [244, 137, 47], [224, 89, 42], [184, 50, 31], [126, 20, 22], [74, 10, 14],
];

/**
 * "vs usual" is diverging, read on log2(ratio): ÷4 and below = dark blue (fewer fires than
 * usual), usual = light grey, ×4 and above = dark red (more fires than usual).
 */
const DIVERGING: [number, number, number][] = [
  [5, 48, 97], [33, 102, 172], [67, 147, 195], [146, 197, 222], [226, 226, 226], [244, 165, 130], [214, 96, 77], [178, 24, 43], [103, 0, 31],
];
export const ANOMALY_STOPS: Stop[] = DIVERGING.map((c, i) => [-1 + (2 * i) / (DIVERGING.length - 1), c]);
const ANOMALY = ANOMALY_STOPS;
const gradient = (stops: Stop[]) => `linear-gradient(90deg, ${stops.map(([, c]) => `rgb(${c.join(",")})`).join(", ")})`;
export const ANOMALY_GRADIENT = gradient(ANOMALY_STOPS);
export const rgb = (c: [number, number, number]) => `rgb(${c.join(",")})`;

/**
 * Anomalies are coloured on log2(ratio), so ×2 and ÷2 are equally far from normal.
 * `span` is the log2 value reaching full colour; pick it per region with anomalySpan().
 */
export const anomalyColor = (ratio: number, span: number) => ramp(ANOMALY, Math.log2(Math.max(ratio, 1e-3)) / span);

/** 95th percentile of |log2 ratio|, at least log2(1.4): world stays readable, countries are not saturated. */
export function anomalySpan(ratios: number[]) {
  const v = ratios.filter((r) => r > 0).map((r) => Math.abs(Math.log2(r))).sort((a, b) => a - b);
  if (!v.length) return 1;
  return Math.max(Math.log2(1.4), v[Math.floor(v.length * 0.95)]);
}

/** Legend end labels for a span: e.g. ["−29%", "+40%"]. */
export const spanLabels = (span: number) => [`÷${fmtX(2 ** span)}`, `×${fmtX(2 ** span)}`];
const fmtX = (x: number) => (x >= 10 ? String(Math.round(x)) : String(Math.round(x * 10) / 10));

/** Count: the same ramp on 0..1. */
export const COUNT_STOPS: Stop[] = FIRE.map((c, i) => [i / (FIRE.length - 1), c]);
export const countColor = (t: number) => ramp(COUNT_STOPS, t);
export const COUNT_GRADIENT = gradient(COUNT_STOPS);

export const SOURCE_COLOR: Record<string, string> = {
  snpp: "var(--observed)",
  n20: "#2f6db5",
  modis: "var(--converted)",
  terra: "var(--converted)",
  aqua: "var(--converted)",
  none: "var(--hatch)",
};
