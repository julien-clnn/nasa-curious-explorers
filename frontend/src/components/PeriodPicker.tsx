import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { monthName } from "@/lib/format";
import { daysInMonth, fmtPeriod, step, type Grain, type Period } from "@/lib/period";
import { Icon, Segmented } from "./ui";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Period control: arrows step by the current grain; clicking the date opens a small calendar
 * where the visitor picks a year, a month or a single day.
 */
export function PeriodPicker({ period, first, last, onChange, style }: { period: Period; first: string; last: string; onChange: (date: string) => void; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const [grain, setGrain] = useState<Grain>(period.grain);
  // What the calendar is showing (a year for months, a month for days), independent of the selection.
  const [browse, setBrowse] = useState(period.ym);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setGrain(period.grain);
    setBrowse(period.ym);
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (date: string) => {
    onChange(date);
    setOpen(false);
  };
  const prev = step(period, -1, first, last);
  const next = step(period, 1, first, last);
  const firstYear = Number(first.slice(0, 4));
  const lastYear = Number(last.slice(0, 4));
  const by = Number(browse.slice(0, 4));
  const bm = Number(browse.slice(5, 7));
  const moveBrowse = (n: number) => {
    if (grain === "month") setBrowse(`${by + n}-${pad(bm)}`);
    else {
      const d = new Date(Date.UTC(by, bm - 1 + n, 1));
      setBrowse(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
    }
  };
  const canBrowse = (n: number) => (grain === "month" ? by + n >= firstYear && by + n <= lastYear : (() => {
    const d = new Date(Date.UTC(by, bm - 1 + n, 1));
    const ym = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
    return ym >= first && ym <= last;
  })());

  return (
    <div ref={ref} className="ctl relative" style={style}>
      <span className="eyebrow">{t("ctx.period")}</span>
      <span className="flex w-full items-center gap-1.5">
        <button type="button" className="step" disabled={!prev} aria-label={t("ctx.prev")} onClick={() => prev && onChange(prev)}>‹</button>
        <button type="button" className="period-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="calendar" size={15} stroke={1.8} />
          <span className="num">{fmtPeriod(period)}</span>
          <Icon name={open ? "up" : "chevron"} size={14} />
        </button>
        <button type="button" className="step" disabled={!next} aria-label={t("ctx.next")} onClick={() => next && onChange(next)}>›</button>
      </span>

      {open && (
        <div className="popover flex flex-col gap-3 p-3" role="dialog" aria-label={t("ctx.period")} style={{ width: 300 }}>
          <Segmented
            label={t("period.grain")}
            value={grain}
            onChange={(g) => {
              setGrain(g);
              setBrowse(period.ym);
            }}
            items={[
              { value: "day", label: t("period.day") },
              { value: "month", label: t("period.month") },
              { value: "year", label: t("period.year") },
            ]}
          />

          {grain !== "year" && (
            <div className="flex items-center justify-between">
              <button type="button" className="step" disabled={!canBrowse(-1)} aria-label={t("ctx.prev")} onClick={() => moveBrowse(-1)}>‹</button>
              <span style={{ fontWeight: 600 }}>{grain === "month" ? by : `${monthName(bm, "long")} ${by}`}</span>
              <button type="button" className="step" disabled={!canBrowse(1)} aria-label={t("ctx.next")} onClick={() => moveBrowse(1)}>›</button>
            </div>
          )}

          {grain === "year" && (
            <div className="grid grid-cols-5 gap-1">
              {Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i).map((y) => (
                <button key={y} type="button" className="pick" aria-pressed={period.grain === "year" && period.year === y} onClick={() => pick(String(y))}>{y}</button>
              ))}
            </div>
          )}

          {grain === "month" && (
            <div className="grid grid-cols-4 gap-1">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                const ym = `${by}-${pad(m)}`;
                return (
                  <button key={m} type="button" className="pick" disabled={ym < first || ym > last} aria-pressed={period.grain === "month" && period.ym === ym} onClick={() => pick(ym)}>{monthName(m)}</button>
                );
              })}
            </div>
          )}

          {grain === "day" && (
            <div className="grid grid-cols-7 gap-1 text-center">
              {Array.from({ length: 7 }, (_, i) => (
                <span key={i} className="muted" style={{ fontSize: 11 }}>
                  {new Intl.DateTimeFormat(undefined, { weekday: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i)))}
                </span>
              ))}
              {/* Monday-first offset */}
              {Array.from({ length: (new Date(Date.UTC(by, bm - 1, 1)).getUTCDay() + 6) % 7 }, (_, i) => <span key={`e${i}`} />)}
              {Array.from({ length: daysInMonth(by, bm) }, (_, i) => i + 1).map((d) => {
                const key = `${by}-${pad(bm)}-${pad(d)}`;
                return (
                  <button key={d} type="button" className="pick num" aria-pressed={period.grain === "day" && period.key === key} onClick={() => pick(key)}>{d}</button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
