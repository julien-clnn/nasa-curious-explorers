// The selected period: a whole year ("2025"), a month ("2025-12") or a single day ("2025-12-14").
import { locale } from "@/i18n";
import { monthName } from "./format";

export type Grain = "year" | "month" | "day";

export interface Period {
  grain: Grain;
  /** Canonical string, as stored in the URL. */
  key: string;
  year: number;
  /** Month the views anchored on months use: the month itself, the day's month, or the year's last available month. */
  ym: string;
  /** Prefix shared by every month inside the period: "2025" or "2025-12". */
  prefix: string;
  /** Only for a day: 0-based index in the year (matches the daily files). */
  dayOfYear?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function clampYm(ym: string, first: string, last: string) {
  return ym < first ? first : ym > last ? last : ym;
}

/** Reads any of the three forms; anything invalid or out of range falls back to the last month. */
export function parsePeriod(s: string, first: string, last: string): Period {
  const y = /^(\d{4})$/.exec(s);
  if (y) {
    const year = Math.min(Math.max(Number(y[1]), Number(first.slice(0, 4))), Number(last.slice(0, 4)));
    const ym = clampYm(`${year}-12`, first, last);
    return { grain: "year", key: String(year), year, ym, prefix: String(year) };
  }
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (d) {
    const ym = clampYm(`${d[1]}-${d[2]}`, first, last);
    const year = Number(ym.slice(0, 4));
    const month = Number(ym.slice(5, 7));
    const day = ym === `${d[1]}-${d[2]}` ? Math.min(Math.max(1, Number(d[3])), daysInMonth(year, month)) : 1;
    const key = `${ym}-${pad(day)}`;
    const dayOfYear = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 864e5);
    return { grain: "day", key, year, ym, prefix: ym, dayOfYear };
  }
  const ym = /^\d{4}-\d{2}$/.test(s) ? clampYm(s, first, last) : last;
  return { grain: "month", key: ym, year: Number(ym.slice(0, 4)), ym, prefix: ym };
}

/** Same date, another grain (keeps the year, and the month when it can). */
export function toGrain(p: Period, grain: Grain): string {
  if (grain === "year") return String(p.year);
  if (grain === "month") return p.ym;
  return p.grain === "day" ? p.key : `${p.ym}-01`;
}

/** One step back or forward at the period's own grain; null at the ends of the record. */
export function step(p: Period, n: number, first: string, last: string): string | null {
  let next: string;
  if (p.grain === "year") next = String(p.year + n);
  else if (p.grain === "month") {
    const d = new Date(Date.UTC(p.year, Number(p.ym.slice(5, 7)) - 1 + n, 1));
    next = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  } else {
    const d = new Date(Date.parse(`${p.key}T00:00:00Z`) + n * 864e5);
    next = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const ym = next.length === 4 ? next : next.slice(0, 7);
  if (next.length === 4) return next >= first.slice(0, 4) && next <= last.slice(0, 4) ? next : null;
  return ym >= first && ym <= last ? next : null;
}

/** Months covered by the period, within the record. */
export function monthsOf(p: Period, first: string, last: string): string[] {
  if (p.grain !== "year") return [p.ym];
  return Array.from({ length: 12 }, (_, i) => `${p.year}-${pad(i + 1)}`).filter((m) => m >= first && m <= last);
}

export function fmtPeriod(p: Period, style: "long" | "short" = "short") {
  if (p.grain === "year") return String(p.year);
  const m = Number(p.ym.slice(5, 7));
  if (p.grain === "month") return `${monthName(m, style)} ${p.year}`;
  return new Intl.DateTimeFormat(locale(), { day: "numeric", month: style, year: "numeric", timeZone: "UTC" }).format(new Date(`${p.key}T00:00:00Z`));
}
