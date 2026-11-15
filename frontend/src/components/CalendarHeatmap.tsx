import { useMemo, useState } from "react";
import { t } from "@/i18n";
import { compare, type MonthStat } from "@/lib/analytics";
import { ANOMALY_GRADIENT, COUNT_GRADIENT, anomalyColor, anomalySpan, countColor, spanLabels } from "@/lib/colors";
import { fmtCompact, fmtInt, fmtPctDelta, monthName } from "@/lib/format";
import type { Metric } from "@/lib/urlState";
import { Panel, Segmented } from "./ui";

const JUNCTION = 2012;

export function CalendarHeatmap({ stats, selected, onSelect, metric, onMetric, regionName, footer, simple = false }: {
  stats: MonthStat[];
  selected: string;
  onSelect: (ym: string) => void;
  metric: Metric;
  onMetric: (m: Metric) => void;
  regionName: string;
  footer: string;
  simple?: boolean;
}) {
  const [table, setTable] = useState(false);
  const years = useMemo(() => [...new Set(stats.map((s) => s.year))], [stats]);
  const byKey = useMemo(() => new Map(stats.map((s) => [s.ym, s])), [stats]);
  const vmax = useMemo(() => Math.max(...stats.map((s) => s.value ?? 0)), [stats]);
  const span = useMemo(() => anomalySpan(stats.map((s) => s.ratio ?? 0)), [stats]);
  const [lo, hi] = spanLabels(span);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const normals = months.map((m) => stats.find((s) => s.month === m)?.normal ?? null);
  const nmax = Math.max(...normals.map((n) => n ?? 0));

  /** Colour, or the CSS class of a state that is not a colour (no data / no fires / too few to compare). */
  const cellLook = (s: MonthStat): { color?: string; cls: string } => {
    if (s.value == null) return { cls: "hatch" };
    if (metric === "count") return s.value === 0 ? { cls: "is-empty" } : { color: countColor(Math.sqrt(s.value / vmax)), cls: "" };
    if (s.state === "none") return { cls: "is-empty" };
    if (s.state === "few") return { cls: "is-few" };
    return { color: anomalyColor(s.ratio!, span), cls: "" };
  };
  const stateText = (s: MonthStat) =>
    s.state === "none" ? t("cal.noneUsual") : s.state === "few" ? t("cal.tooFew") : `${fmtPctDelta(s.ratio)} ${t("cal.vsNormal")}${s.klass ? ` · ${t(`class.${s.klass}`)}` : ""}`;
  // Per year: total, and ratio to the normals of the months present (partial years stay fair).
  const yearStats = useMemo(() => {
    const out = new Map<number, { value: number; ratio: number | null; state: MonthStat["state"]; color: string | null }>();
    for (const y of years) {
      const xs = stats.filter((s) => s.year === y && s.value != null);
      const value = xs.reduce((a, s) => a + (s.value ?? 0), 0);
      const norm = xs.reduce((a, s) => a + s.normal, 0);
      const c = compare(xs.length ? value : null, norm);
      out.set(y, { value, ratio: c.ratio, state: c.state, color: null });
    }
    const ymaxLocal = Math.max(...[...out.values()].map((v) => v.value), 1);
    const yspan = anomalySpan([...out.values()].map((v) => v.ratio ?? 0));
    for (const v of out.values()) v.color = metric === "anomaly" ? (v.ratio == null ? null : anomalyColor(v.ratio, yspan)) : countColor(Math.sqrt(v.value / ymaxLocal));
    return out;
  }, [stats, years, metric]);
  const ymax = Math.max(...[...yearStats.values()].map((v) => v.value), 1);
  const label = (s: MonthStat) =>
    `${monthName(s.month, "long")} ${s.year}: ${s.value == null ? t("state.noData") : `${fmtInt(s.value)} · ${stateText(s)} (${t("cal.normal").toLowerCase()} ${fmtInt(s.normal)})`}`;

  return (
    <Panel
      eyebrow={t("cal.eyebrow", { region: regionName, from: years[0], to: years[years.length - 1] })}
      title={t("cal.title")}
      actions={
        simple ? undefined : <>
          <Segmented label={t("cal.metric")} value={metric} onChange={onMetric} items={[{ value: "anomaly", label: t("cal.anomaly") }, { value: "count", label: t("cal.count") }]} />
          <button type="button" className="btn" onClick={() => setTable(!table)}>{table ? t("common.viewChart") : t("common.viewTable")}</button>
        </>
      }
      footer={simple ? undefined : footer}
    >
      {table && !simple ? (
        <div className="max-h-[520px] overflow-auto">
          <table className="num w-full text-left text-sm">
            <thead className="muted"><tr><th>{t("common.month")}</th><th>{t("common.value")}</th><th>{t("cal.normal")}</th><th>{t("cal.vsNormal")}</th><th>{t("cal.class")}</th></tr></thead>
            <tbody>
              {[...stats].reverse().map((s) => (
                <tr key={s.ym} style={{ borderTop: "1px solid var(--line)" }}>
                  <td>{s.ym}</td><td>{fmtInt(s.value)}</td><td>{fmtInt(s.normal)}</td><td>{s.state === "ok" ? fmtPctDelta(s.ratio) : s.state === "nodata" ? "—" : stateText(s)}</td><td>{s.klass ? t(`class.${s.klass}`) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="cal flex flex-col" role="grid" aria-label={t("cal.title")}>
          <div role="row" className="cal-row cal-head">
            <span />
            {months.map((m) => <span key={m} role="columnheader">{monthName(m)}</span>)}
            <span role="columnheader" className="text-right">{metric === "anomaly" ? t("cal.yearVsNormal") : t("cal.yearTotal")}</span>
          </div>
          {years.map((y) => {
            const ys = yearStats.get(y)!;
            const sel = selected.startsWith(String(y));
            return (
              <div key={y} className="contents">
                {y === JUNCTION && (
                  <div className="cal-junction" role="presentation">
                    <span className="cal-junction-line" />
                    <span className="cal-junction-pill">{t("cal.junction")}</span>
                    <span className="cal-junction-line" />
                  </div>
                )}
                <div role="row" className={`cal-row ${sel ? "is-sel" : ""}`}>
                  <button type="button" role="rowheader" className="cal-year num" onClick={() => onSelect(String(y))} title={String(y)}>{y}</button>
                  {months.map((m) => {
                    const key = `${y}-${String(m).padStart(2, "0")}`;
                    const s = byKey.get(key);
                    if (!s) return <span key={m} className="cal-cell hatch" role="gridcell" aria-label={`${monthName(m)} ${y}: ${t("state.noData")}`} />;
                    const look = cellLook(s);
                    return (
                      <button
                        key={m}
                        type="button"
                        role="gridcell"
                        className={`cal-cell ${look.cls}`}
                        style={look.color ? { background: look.color } : undefined}
                        aria-pressed={selected.length >= 7 && key.startsWith(selected)}
                        aria-label={label(s)}
                        title={label(s)}
                        onClick={() => onSelect(key)}
                      />
                    );
                  })}
                  <span className="cal-sum num" title={`${y}: ${fmtInt(ys.value)} · ${ys.state === "ok" ? `${fmtPctDelta(ys.ratio)} ${t("cal.vsNormal")}` : ys.state === "none" ? t("cal.noneUsual") : ys.state === "few" ? t("cal.tooFew") : t("state.noData")}`}>
                    <span className="cal-sum-track">
                      <span className="cal-sum-bar" style={{ width: `${Math.max(3, (ys.value / ymax) * 100)}%`, background: ys.color ?? "var(--hatch)" }} />
                    </span>
                    <span className="cal-sum-txt">{metric === "count" ? fmtCompact(ys.value) : ys.state === "ok" ? fmtPctDelta(ys.ratio) : ys.state === "none" ? "0" : ys.state === "few" ? "·" : "—"}</span>
                  </span>
                </div>
              </div>
            );
          })}
          <div className="cal-row cal-normal" role="row">
            <span className="muted" style={{ fontSize: 11 }}>{t("cal.normal")}</span>
            {normals.map((n, i) => (
              <span key={i} className="cal-norm" title={`${t("cal.normal")} ${monthName(i + 1, "long")}: ${fmtInt(n)}`}>
                <span className="cal-norm-bar" style={{ height: `${n && nmax ? Math.max(2, (n / nmax) * 26) : 0}px` }} />
                <span className="num">{fmtCompact(n).replace(" ", "")}</span>
              </span>
            ))}
            <span />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2.5" style={{ fontSize: 11, color: "var(--text-2)" }}>
        {metric === "anomaly" ? (
          <>
            <span>{t("cal.below")}</span>
            <span className="cal-legend">
              <span className="inline-block h-2.5 w-48 rounded-full" style={{ background: ANOMALY_GRADIENT }} />
              <span className="num muted flex justify-between" style={{ fontSize: 10 }}><span>{lo}</span><span>{t("cal.normal").toLowerCase()}</span><span>{hi}</span></span>
            </span>
            <span>{t("cal.above")}</span>
          </>
        ) : (
          <>
            <span>0</span>
            <span className="inline-block h-2.5 w-48 rounded-full" style={{ background: COUNT_GRADIENT }} />
            <span className="num">{fmtCompact(vmax)}</span>
          </>
        )}
        <span className="ml-2 flex items-center gap-1.5"><span className="cal-cell is-empty inline-block" style={{ height: 10, width: 14 }} />{metric === "count" ? t("cal.zero") : t("cal.noneUsual")}</span>
        {metric === "anomaly" && <span className="flex items-center gap-1.5"><span className="cal-cell is-few inline-block" style={{ height: 10, width: 14 }} />{t("cal.tooFew")}</span>}
        <span className="flex items-center gap-1.5"><span className="hatch inline-block h-2.5 w-3.5 rounded-sm" />{t("state.noData")}</span>
      </div>
    </Panel>
  );
}
