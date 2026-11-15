import { useState } from "react";
import { t } from "@/i18n";
import { cumulative, cumulativeBand, type MonthStat } from "@/lib/analytics";
import { fmtCompact, monthName } from "@/lib/format";
import { Panel } from "./ui";

const COMPARE_COLORS = ["#2f6db5", "#7a4fb5", "#0f8a7e"];

export function SeasonChart({ stats, year, normalYears }: { stats: MonthStat[]; year: number; normalYears: [number, number] }) {
  const [extra, setExtra] = useState<number[]>([]);
  const [picking, setPicking] = useState(false);
  const band = cumulativeBand(stats, normalYears);
  const cur = cumulative(stats, year);
  const others = extra.map((y) => ({ y, c: cumulative(stats, y) }));
  const vmax = Math.max(...band.map((b) => b.hi), ...cur.map((v) => v ?? 0), ...others.flatMap((o) => o.c.map((v) => v ?? 0))) * 1.05;
  const X = (i: number) => 20 + (i * 520) / 11;
  const Y = (v: number) => 176 - (164 * v) / vmax;
  const path = (vals: (number | null)[]) => vals.map((v, i) => (v == null ? "" : `${i === 0 || vals[i - 1] == null ? "M" : "L"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`)).join("");
  const bandPath = `M${band.map((b, i) => `${X(i)} ${Y(b.hi)}`).join("L")}L${[...band].reverse().map((b, k) => `${X(11 - k)} ${Y(b.lo)}`).join("L")}Z`;
  const last = cur.reduce<number>((a, v, i) => (v != null ? i : a), -1);
  const years = [...new Set(stats.map((s) => s.year))].filter((y) => y !== year && !extra.includes(y));

  return (
    <Panel eyebrow={t("season.eyebrow")} title={t("season.title", { year })}>
      <svg viewBox="0 0 610 200" className="block h-auto w-full" role="img" aria-label={t("season.alt", { year, from: normalYears[0], to: normalYears[1] })}>
        <g stroke="var(--grid)">{[0, 0.5, 1].map((f) => <path key={f} d={`M20 ${Y(f * vmax * 0.95)}H560`} />)}</g>
        <path d={bandPath} fill="var(--accent)" fillOpacity=".12" />
        <path d={path(band.map((b) => b.med))} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 3" />
        {others.map((o, k) => <path key={o.y} d={path(o.c)} fill="none" stroke={COMPARE_COLORS[k]} strokeWidth="1.8" />)}
        <path d={path(cur)} fill="none" stroke="var(--observed)" strokeWidth="2.5" />
        {last >= 0 && <text x={X(last) + 6} y={Y(cur[last]!) - 4} fontSize="11" fill="var(--observed-ink)">{fmtCompact(cur[last])}</text>}
        <text x={X(11) + 6} y={Y(band[11].med) + 4} fontSize="11" fill="var(--accent)">{fmtCompact(band[11].med)}</text>
        <g fill="var(--muted)" fontSize="11" textAnchor="middle">{[1, 3, 5, 7, 9, 11].map((m) => <text key={m} x={X(m - 1)} y={194}>{monthName(m, "narrow")}</text>)}</g>
        <g fill="var(--muted)" fontSize="11" textAnchor="end"><text x={16} y={179}>0</text><text x={16} y={Y(vmax * 0.475) + 3}>{fmtCompact(vmax * 0.475)}</text></g>
      </svg>
      <div className="flex flex-wrap items-center gap-3" style={{ fontSize: 11, color: "var(--text-2)" }}>
        <span className="flex items-center gap-1.5"><span className="inline-block h-[3px] w-4" style={{ background: "var(--observed)" }} />{year}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-4" style={{ borderTop: "2px dashed var(--accent)" }} />{t("season.median", { from: normalYears[0], to: normalYears[1] })}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-3.5" style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)" }} />{t("season.band")}</span>
        {others.map((o, k) => (
          <button key={o.y} type="button" className="chip" onClick={() => setExtra(extra.filter((y) => y !== o.y))} aria-label={t("season.remove", { year: o.y })}>
            <span className="inline-block h-[3px] w-3" style={{ background: COMPARE_COLORS[k] }} />{o.y} ✕
          </button>
        ))}
        <span className="relative ml-auto">
          {extra.length < 3 && <button type="button" className="btn" onClick={() => setPicking(!picking)}>+ {t("season.compare")}</button>}
          {picking && (
            <span className="popover" style={{ left: "auto", right: 0, width: 220, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
              {years.map((y) => (
                <button key={y} type="button" className="btn num justify-center" onClick={() => { setExtra([...extra, y]); setPicking(false); }}>{y}</button>
              ))}
            </span>
          )}
        </span>
      </div>
    </Panel>
  );
}
