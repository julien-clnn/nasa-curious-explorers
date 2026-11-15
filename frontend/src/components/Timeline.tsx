import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/i18n";
import type { MonthStat } from "@/lib/analytics";
import { fmtCompact, fmtPctDelta, fmtYm } from "@/lib/format";
import { Panel } from "./ui";

// Drawn in real pixels (the viewBox follows the panel width) so text stays legible and the
// chart gets taller, instead of a fixed 1200-wide drawing shrunk into a narrow panel.
const LEFT = 56;
const RIGHT = 14;
const TOP = 22;
const BOT = 250;
const HEIGHT = BOT + 30;
const JUNCTION = "2012-02"; // first full month of Suomi-NPP VIIRS

function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p / 0.5) * 0.5 * p;
}

export function Timeline({ stats, raw, selected, onSelect, regionName, footer, showRaw: showRawProp, simple = false }: {
  stats: MonthStat[];
  raw: (number | null)[];
  selected: string;
  onSelect: (ym: string) => void;
  regionName: string;
  footer: string;
  showRaw: boolean;
  simple?: boolean;
}) {
  // Simple mode keeps the converted/observed story but drops the raw MODIS line and its explanation.
  const showRaw = showRawProp && !simple;
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = stats.length;
  const box = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(700);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setCw(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);
  const W = cw - LEFT - RIGHT;
  const geo = useMemo(() => {
    const vmax = niceMax(Math.max(...stats.map((s) => Math.max(s.value ?? 0, s.normal))));
    const X = (i: number) => (i * W) / (n - 1);
    const Y = (v: number) => BOT - ((BOT - TOP) * v) / vmax;
    const j = Math.max(0, stats.findIndex((s) => s.ym >= JUNCTION));
    const area = (a: number, b: number) => {
      const pts = stats.slice(a, b + 1).map((s, k) => `${X(a + k).toFixed(1)} ${Y(s.value ?? 0).toFixed(1)}`);
      return pts.length ? `M${X(a).toFixed(1)} ${BOT}L${pts.join("L")}L${X(b).toFixed(1)} ${BOT}Z` : "";
    };
    const line = (vals: (number | null)[]): string => {
      let d = "";
      vals.forEach((v, i) => {
        if (v == null) return;
        d += `${i === 0 || vals[i - 1] == null ? "M" : "L"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`;
      });
      return d;
    };
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * vmax);
    const years = [...new Set(stats.map((s) => s.year))].filter((y) => y % (W < 520 ? 5 : 2) === 0);
    return { X, Y, j, conv: area(0, j), obs: area(j, n - 1), norm: line(stats.map((s) => s.normal)), raw: line(raw), ticks, years, vmax };
  }, [stats, raw, n, W]);

  // `selected` is a prefix: one month ("2025-12") or a whole year ("2025").
  const si = stats.findIndex((s) => s.ym.startsWith(selected));
  const se = si < 0 ? -1 : si + stats.slice(si).filter((s) => s.ym.startsWith(selected)).length - 1;
  const sel = si === se ? stats[si] : undefined;
  const indexAt = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect();
    const vbX = ((clientX - r.left) / r.width) * cw - LEFT;
    return Math.max(0, Math.min(n - 1, Math.round((vbX / W) * (n - 1))));
  };
  const h = hover != null ? stats[hover] : null;
  const peak = stats.reduce((a, b) => ((b.value ?? 0) > (a.value ?? 0) ? b : a), stats[0]);

  return (
    <Panel
      eyebrow={t("tl.eyebrow", { region: regionName, from: fmtYm(stats[0].ym), to: fmtYm(stats[n - 1].ym) })}
      title={t("tl.title")}
      actions={
        <div className="flex flex-wrap gap-4" style={{ fontSize: 12, color: "var(--text-2)" }}>
          <span className="flex items-center gap-2"><svg width="22" height="12" aria-hidden="true"><defs><pattern id="hl" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="4" fill="var(--converted)" /></pattern></defs><rect width="22" height="12" rx="2" fill="url(#hl)" /></svg>{t("tl.converted")}</span>
          <span className="flex items-center gap-2"><span className="inline-block h-3 w-[22px] rounded-sm" style={{ background: "var(--observed)" }} />{t("tl.observed")}</span>
          <span className="flex items-center gap-2"><svg width="22" height="12" aria-hidden="true"><path d="M0 6h22" stroke="var(--text)" strokeWidth="1.5" strokeDasharray="2 3" /></svg>{t("tl.normal")}</span>
          {showRaw && <span className="flex items-center gap-2"><svg width="22" height="12" aria-hidden="true"><path d="M0 6h22" stroke="#98a2b3" strokeWidth="1.5" /></svg>{t("tl.rawModis")}</span>}
        </div>
      }
      footer={simple ? undefined : footer}
    >
      <p className="muted m-0 max-w-[760px]">{simple ? t("tl.leadSimple") : showRaw ? t("tl.lead") : t("tl.leadRaw")}</p>
      <div className="relative" ref={box}>
        <svg
          ref={svg}
          viewBox={`${-LEFT} 0 ${cw} ${HEIGHT}`}
          className="block h-auto w-full cursor-crosshair overflow-visible"
          role="img"
          aria-label={t("tl.alt", { region: regionName })}
          onMouseMove={(e) => setHover(indexAt(e.clientX))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => onSelect(stats[indexAt(e.clientX)].ym)}
        >
          <defs>
            <pattern id="conv" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.4" height="5" fill="var(--converted)" /></pattern>
            <linearGradient id="obs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--observed)" /><stop offset="1" stopColor="var(--observed)" stopOpacity=".18" /></linearGradient>
          </defs>
          <g stroke="var(--grid)">{geo.ticks.map((v) => <path key={v} d={`M0 ${geo.Y(v)}H${W}`} />)}</g>
          <g fill="var(--muted)" fontSize="11" textAnchor="end">{geo.ticks.filter((_, i) => i % 2 === 0).map((v) => <text key={v} x={-10} y={geo.Y(v) + 3}>{fmtCompact(v)}</text>)}</g>
          {si >= 0 && <rect x={geo.X(si) - 3} y={4} width={geo.X(se) - geo.X(si) + 6} height={BOT - 4} fill="var(--accent)" fillOpacity=".12" stroke="var(--accent)" strokeOpacity=".6" />}
          <path d={geo.conv} fill="url(#conv)" />
          <path d={geo.obs} fill="url(#obs)" />
          {showRaw && <path d={geo.raw} fill="none" stroke="#98a2b3" strokeWidth="1.3" />}
          <path d={geo.norm} fill="none" stroke="var(--text)" strokeOpacity=".7" strokeWidth="1.2" strokeDasharray="2 3" />
          <path d={`M${geo.X(geo.j)} 0V${BOT}`} stroke="var(--text)" strokeWidth="1.2" strokeDasharray="4 3" />
          <text x={geo.X(geo.j) - 8} y={11} textAnchor="end" fontSize="11.5" fill="var(--converted-ink)">← {t("tl.converted")}</text>
          <text x={geo.X(geo.j) + 8} y={11} fontSize="11.5" fill="var(--observed-ink)">{t("tl.observed")} →</text>
          {peak?.value != null && <text x={geo.X(stats.indexOf(peak))} y={geo.Y(peak.value) - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">{fmtYm(peak.ym)} · {fmtCompact(peak.value)}</text>}
          {sel?.value != null && <circle cx={geo.X(si)} cy={geo.Y(sel.value)} r="5" fill="var(--panel)" stroke="var(--text)" strokeWidth="2" />}
          {h && <path d={`M${geo.X(hover!)} ${TOP}V${BOT}`} stroke="var(--muted)" strokeWidth="1" />}
          <g fill="var(--muted)" fontSize="11" textAnchor="middle">{geo.years.map((y) => <text key={y} x={geo.X(stats.findIndex((s) => s.year === y))} y={BOT + 20}>{y}</text>)}</g>
        </svg>
        {h && (
          <div className="tooltip num" style={{ left: `${((geo.X(hover!) + LEFT) / cw) * 100}%`, top: 0, transform: "translateX(-50%)" }}>
            <strong>{fmtYm(h.ym, "long")}</strong> · {fmtCompact(h.value)} · {fmtPctDelta(h.ratio)} {t("cal.vsNormal")}
          </div>
        )}
      </div>
    </Panel>
  );
}
