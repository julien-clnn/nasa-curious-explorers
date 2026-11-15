import { useMemo, useRef } from "react";
import { t } from "@/i18n";
import { compare, type MonthStat } from "@/lib/analytics";
import { anomalyColor, anomalySpan, countColor } from "@/lib/colors";
import type { Metric } from "@/lib/urlState";

/**
 * One block per year of the record, coloured like the calendar; click or drag to pick a
 * year. The globe follows. A dashed marker shows when VIIRS starts (2012). Partial years
 * (the first and the current one) are compared on the months they have.
 */
export function TimeBar({ stats, selected, onSelect, metric }: { stats: MonthStat[]; selected: string; onSelect: (year: string) => void; metric: Metric }) {
  const bar = useRef<HTMLDivElement>(null);
  const years = useMemo(() => {
    const by = new Map<number, MonthStat[]>();
    stats.forEach((s) => by.set(s.year, [...(by.get(s.year) ?? []), s]));
    return [...by].map(([year, ms]) => {
      const known = ms.filter((s) => s.value != null);
      const value = known.length ? known.reduce((a, s) => a + s.value!, 0) : null;
      const normal = known.reduce((a, s) => a + s.normal, 0);
      return { year, value, ...compare(value, normal), partial: ms.length < 12 };
    });
  }, [stats]);
  const vmax = useMemo(() => Math.max(1, ...years.filter((y) => !y.partial).map((y) => y.value ?? 0)), [years]);
  const span = useMemo(() => anomalySpan(years.map((y) => y.ratio ?? 0)), [years]);
  const color = (y: (typeof years)[number]) => {
    if (y.value == null) return "transparent";
    if (metric === "count") return y.value === 0 ? "var(--seg)" : countColor(Math.sqrt(Math.min(1, y.value / vmax)));
    return y.state === "ok" ? anomalyColor(y.ratio!, span) : "var(--seg)";
  };
  const at = Math.max(0, years.findIndex((y) => String(y.year) === selected.slice(0, 4)));
  const viirs = years.findIndex((y) => y.year === 2012);
  const left = (i: number) => `${(i / years.length) * 100}%`;
  const mid = (i: number) => `${((i + 0.5) / years.length) * 100}%`;

  const pick = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    const i = Math.max(0, Math.min(years.length - 1, Math.floor(((clientX - r.left) / r.width) * years.length)));
    if (String(years[i].year) !== selected) onSelect(String(years[i].year));
  };

  return (
    <div className="timebar glass" role="group" aria-label={t("tb.label")}>
      <div
        ref={bar}
        className="timebar-track"
        role="slider"
        tabIndex={0}
        aria-valuemin={years[0]?.year}
        aria-valuemax={years[years.length - 1]?.year}
        aria-valuenow={years[at]?.year}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          pick(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && pick(e.clientX)}
        onKeyDown={(e) => {
          const d = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
          if (!d) return;
          e.preventDefault();
          onSelect(String(years[Math.max(0, Math.min(years.length - 1, at + d))].year));
        }}
      >
        <div className="timebar-ticks">
          {years.map((y, i) => (
            <i key={y.year} className={i === at ? "on" : undefined} style={{ background: color(y) }} title={String(y.year)} />
          ))}
        </div>
        {viirs > 0 && (
          <div className="timebar-viirs" style={{ left: `calc(${left(viirs)} - 1px)` }}>
            <span>{t("tb.viirs")}</span>
          </div>
        )}
      </div>
      <div className="timebar-years num">
        {years.map((y, i) => (
          <span key={y.year} className={i === at ? "on" : undefined} style={{ left: mid(i) }}>{i === at ? y.year : `’${String(y.year).slice(2)}`}</span>
        ))}
      </div>
    </div>
  );
}
