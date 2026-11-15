import { locale } from "@/i18n";

// Intl formatters are slow to create (~0.1 ms each) and the calendar formats hundreds of
// labels per render: build each one once per locale and option set.
const cache = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number) {
  const k = `n${locale()}|${min}|${max}`;
  let f = cache.get(k);
  if (!f) cache.set(k, (f = new Intl.NumberFormat(locale(), { minimumFractionDigits: min, maximumFractionDigits: max })));
  return f;
}
const int = () => nf(0, 0);

export function fmtInt(n: number | null | undefined) {
  return n == null || Number.isNaN(n) ? "—" : int().format(Math.round(n));
}

/** 3,424,045 -> "3.42 M", 61,569 -> "61.6 k" (only for big headline numbers). */
export function fmtCompact(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  const a = Math.abs(n);
  const f = (x: number, d: number) => nf(d, d).format(x);
  if (a >= 1e6) return `${f(n / 1e6, 2)} M`;
  if (a >= 1e5) return `${f(n / 1e3, 0)} k`;
  return fmtInt(n);
}

/** "+36%" / "−45%"; from ×10 up a ratio reads better than a percentage ("×90", not "+8,909%"). */
export function fmtPctDelta(ratio: number | null | undefined) {
  if (ratio == null) return "—";
  if (ratio >= 10) return `×${nf(0, 0).format(ratio)}`;
  const p = (ratio - 1) * 100;
  const s = nf(0, 0).format(Math.abs(p));
  return `${p >= 0 ? "+" : "−"}${s}%`;
}

export function fmtRatio(ratio: number) {
  return `${nf(1, 1).format(ratio)}×`;
}

export function fmtPct(n: number | null | undefined, digits = 1) {
  return n == null ? "—" : `${nf(digits, digits).format(n)} %`;
}

const names = new Map<string, string>();

export function monthName(month: number, style: "long" | "short" | "narrow" = "short") {
  const k = `m${locale()}|${style}|${month}`;
  let name = names.get(k);
  if (name == null) names.set(k, (name = new Intl.DateTimeFormat(locale(), { month: style, timeZone: "UTC" }).format(new Date(Date.UTC(2000, month - 1, 1)))));
  return name;
}

export function fmtYm(s: string, style: "long" | "short" = "short") {
  const [y, m] = s.split("-").map(Number);
  return `${monthName(m, style)} ${y}`;
}

export function ordinal(n: number) {
  const rules = new Intl.PluralRules(locale(), { type: "ordinal" });
  const suffix: Record<string, string> = { one: "st", two: "nd", few: "rd", other: "th" };
  return `${n}${suffix[rules.select(n)] ?? "th"}`;
}
