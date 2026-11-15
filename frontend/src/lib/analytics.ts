// Pure functions: seasonal normal, anomaly class, rank, cumulative season, uncertainty.
import type { Band, Series, SeriesKind, MethodKey } from "./types";

export type AnomalyClass = "low" | "normal" | "high" | "exceptional";

export function anomalyClass(ratio: number): AnomalyClass {
  if (ratio < 0.5) return "low";
  if (ratio < 1.5) return "normal";
  if (ratio < 3) return "high";
  return "exceptional";
}

/**
 * What a value can say about its normal:
 * - "nodata": no satellite delivered (value null);
 * - "none":   no fires, and that is what usually happens (normal below MIN_NORMAL);
 * - "few":    too few hotspots on both sides for a meaningful % (Greenland in June: 6 vs 2);
 * - "ok":     a ratio can be computed (including value 0 against a real normal).
 */
export type CompareState = "nodata" | "none" | "few" | "ok";

/** Below this many hotspots (per month; scaled for days), a normal is too small to divide by. */
export const MIN_NORMAL = 10;

export function compare(value: number | null, normal: number, min = MIN_NORMAL): { ratio: number | null; state: CompareState; klass: AnomalyClass | null } {
  if (value == null) return { ratio: null, state: "nodata", klass: null };
  if (!(normal >= min)) {
    if (value === 0) return { ratio: null, state: "none", klass: null };
    // A real event where fires are rare (Greenland, Aug 2017: 991 vs 11) still gets a ratio.
    if (value < min) return { ratio: null, state: "few", klass: null };
    const ratio = value / Math.max(normal, min / 10);
    return { ratio, state: "ok", klass: anomalyClass(ratio) };
  }
  const ratio = value / normal;
  return { ratio, state: "ok", klass: anomalyClass(ratio) };
}

export const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;
export const parseYm = (s: string) => ({ year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) });
export function addMonths(s: string, n: number) {
  const { year, month } = parseYm(s);
  const d = new Date(Date.UTC(year, month - 1 + n, 1));
  return ym(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

export function quantile(values: number[], q: number): number {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return NaN;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}
export const median = (v: number[]) => quantile(v, 0.5);

/** The values the user is looking at: harmonized for a method, or a raw sensor. */
export function values(s: Series, kind: SeriesKind, method: MethodKey): (number | null)[] {
  if (kind === "modis") return s.modis;
  if (kind === "viirs") return s.viirs;
  return s.harmonized[method] ?? s.months.map(() => null);
}

export interface MonthStat {
  ym: string;
  year: number;
  month: number;
  value: number | null;
  normal: number;
  p10: number;
  p90: number;
  ratio: number | null;
  klass: AnomalyClass | null;
  state: CompareState;
}

/** Per month: value, seasonal normal (median of the same month over normalYears), ratio and class. */
export function monthStats(s: Series, v: (number | null)[], normalYears: [number, number]): MonthStat[] {
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  s.months.forEach((m, i) => {
    const { year, month } = parseYm(m);
    const x = v[i];
    if (x != null && year >= normalYears[0] && year <= normalYears[1] && s.gapDays[i] === 0) byMonth[month - 1].push(x);
  });
  const norm = byMonth.map((xs) => ({ n: median(xs), p10: quantile(xs, 0.1), p90: quantile(xs, 0.9) }));
  return s.months.map((m, i) => {
    const { year, month } = parseYm(m);
    const value = v[i];
    const { n, p10, p90 } = norm[month - 1];
    return { ym: m, year, month, value, normal: n, p10, p90, ...compare(value, n) };
  });
}

/** 1-based rank of `target` among all years for the same calendar month (highest = 1). */
export function rankInMonth(stats: MonthStat[], target: string) {
  const t = stats.find((s) => s.ym === target);
  if (!t || t.value == null) return null;
  const same = stats.filter((s) => s.month === t.month && s.value != null).sort((a, b) => b.value! - a.value!);
  return { rank: same.findIndex((s) => s.ym === target) + 1, of: same.length, top: same[0] };
}

/** Cumulative values through a year, 12 entries (null after the last available month). */
export function cumulative(stats: MonthStat[], year: number): (number | null)[] {
  let acc = 0;
  return Array.from({ length: 12 }, (_, m) => {
    const s = stats.find((x) => x.year === year && x.month === m + 1);
    if (!s || s.value == null) return null;
    acc += s.value;
    return acc;
  });
}

/** Median and p10/p90 band of the cumulative curve over a range of years. */
export function cumulativeBand(stats: MonthStat[], years: [number, number]) {
  const curves: number[][] = [];
  for (let y = years[0]; y <= years[1]; y++) {
    const c = cumulative(stats, y);
    if (c.every((x) => x != null)) curves.push(c as number[]);
  }
  return Array.from({ length: 12 }, (_, m) => {
    const col = curves.map((c) => c[m]);
    return { lo: quantile(col, 0.1), med: median(col), hi: quantile(col, 0.9) };
  });
}

/**
 * 80 % interval for a monthly value: only the converted share is uncertain.
 * Bands are observed/predicted ratios by size of the predicted count.
 */
export function interval(value: number, convertedShare: number, bands: Band[]) {
  if (convertedShare <= 0 || !bands.length) return { lo: value, hi: value, exact: true };
  const conv = value * convertedShare;
  const band = [...bands].reverse().find((b) => conv >= b.predicted_from) ?? bands[0];
  const obs = value - conv;
  return { lo: obs + conv * band.p10, hi: obs + conv * band.p90, exact: false };
}

/** Least-squares slope of annual totals, as % of the mean per decade. */
export function trendPerDecade(years: number[], totals: number[]) {
  const n = years.length;
  const mx = years.reduce((a, b) => a + b, 0) / n;
  const my = totals.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  years.forEach((x, i) => {
    num += (x - mx) * (totals[i] - my);
    den += (x - mx) ** 2;
  });
  return ((num / den) * 10 * 100) / my;
}

export interface PeriodFigures {
  value: number | null;
  normal: number;
  ratio: number | null;
  klass: AnomalyClass | null;
  state: CompareState;
  /** Months of the series inside the period (indices into stats / series arrays). */
  idx: number[];
  rank: { rank: number; of: number; topLabel: string; topValue: number } | null;
  aboveP90: boolean;
  belowP10: boolean;
}

const sumOrNull = (xs: (number | null)[]) => (xs.some((x) => x != null) ? xs.reduce<number>((a, b) => a + (b ?? 0), 0) : null);

function figures(value: number | null, normal: number, idx: number[], rank: PeriodFigures["rank"], p10 = -Infinity, p90 = Infinity, min = MIN_NORMAL): PeriodFigures {
  return { value, normal, ...compare(value, normal, min), idx, rank, aboveP90: value != null && value > p90, belowP10: value != null && value < p10 };
}

/** Value, seasonal normal and rank for a month. */
export function monthFigures(stats: MonthStat[], ymKey: string): PeriodFigures | null {
  const i = stats.findIndex((s) => s.ym === ymKey);
  const s = stats[i];
  if (!s) return null;
  const r = rankInMonth(stats, ymKey);
  return figures(s.value, s.normal, [i], r && { rank: r.rank, of: r.of, topLabel: String(r.top.year), topValue: r.top.value! }, s.p10, s.p90);
}

/**
 * A year is the sum of its months; its normal is the sum of those months' normals.
 * Ranked against the other years over the same calendar months (so a partial first year still compares fairly).
 */
export function yearFigures(stats: MonthStat[], year: number): PeriodFigures | null {
  const idx = stats.flatMap((s, i) => (s.year === year ? [i] : []));
  if (!idx.length) return null;
  const months = idx.map((i) => stats[i].month);
  const value = sumOrNull(idx.map((i) => stats[i].value));
  const normal = idx.reduce((a, i) => a + stats[i].normal, 0);
  const totals = [...new Set(stats.map((s) => s.year))].flatMap((y) => {
    const vs = months.map((m) => stats.find((s) => s.year === y && s.month === m)?.value ?? null);
    return vs.every((v) => v != null) ? [{ y, v: vs.reduce<number>((a, b) => a + b!, 0) }] : [];
  });
  totals.sort((a, b) => b.v - a.v);
  const at = totals.findIndex((x) => x.y === year);
  const rank = at < 0 ? null : { rank: at + 1, of: totals.length, topLabel: String(totals[0].y), topValue: totals[0].v };
  return figures(value, normal, idx, rank);
}

/** A day against its month's normal spread evenly over the month's days. */
export function dayFigures(stats: MonthStat[], ymKey: string, value: number | null, daysInMonth: number): PeriodFigures | null {
  const i = stats.findIndex((s) => s.ym === ymKey);
  if (i < 0) return null;
  return figures(value, stats[i].normal / daysInMonth, [i], null, -Infinity, Infinity, MIN_NORMAL / daysInMonth);
}
