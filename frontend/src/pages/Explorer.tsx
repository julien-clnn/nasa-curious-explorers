import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/i18n";
import { dataClient } from "@/lib/dataClient";
import { useData } from "@/lib/useData";
import { dayFigures, monthFigures, monthStats, values, yearFigures } from "@/lib/analytics";
import { daysInMonth, fmtPeriod, monthsOf, type Period } from "@/lib/period";
import { activeSatellites } from "@/lib/satellites";
import { ANOMALY_GRADIENT, COUNT_GRADIENT } from "@/lib/colors";
import { fmtCompact } from "@/lib/format";
import type { Manifest, Method, Region, Series, SeriesKind } from "@/lib/types";
import type { Page, ViewState } from "@/lib/urlState";
import { AnswerStrip } from "@/components/AnswerStrip";
import { CalendarHeatmap } from "@/components/CalendarHeatmap";
import { FireGlobe, type GlobeHandle } from "@/components/FireGlobe";
import { Timeline } from "@/components/Timeline";
import { DailyChart } from "@/components/DailyChart";
import { SeasonChart } from "@/components/SeasonChart";
import { MethodCard } from "@/components/MethodCard";
import { TimeBar } from "@/components/TimeBar";
import { PeriodPicker } from "@/components/PeriodPicker";
import { MethodPicker, RegionPicker } from "@/components/ContextBar";
import { UnusualCountries, unusualCountries } from "@/components/UnusualCountries";
import { ErrorBox, Icon, Segmented, Skeleton } from "@/components/ui";

/** CSV of the monthly series, with a provenance header so the numbers keep their context. */
function csvFor(s: Series, region: Region, method: Method) {
  const head = [`# region: ${region.name}`, `# method: ${method.key}`, `# unit: VIIRS-equivalent hotspots per month`, "month,harmonized,modis_raw,viirs_raw,days,gap_days"];
  const rows = s.months.map((m, i) => [m, s.harmonized[method.key]?.[i] ?? "", s.modis[i] ?? "", s.viirs[i] ?? "", s.days[i], s.gapDays[i]].join(","));
  return URL.createObjectURL(new Blob([[...head, ...rows].join("\n")], { type: "text/csv" }));
}

type PanelSize = "closed" | "normal" | "wide";
type Tab = "calendar" | "trends" | "hotspots" | "about";

/** Panel size, remembered per visitor. */
function usePanel() {
  const [size, setSize] = useState<PanelSize>(() => {
    try {
      const v = localStorage.getItem("panel");
      return v === "closed" || v === "wide" ? v : "normal";
    } catch {
      return "normal";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("panel", size);
    } catch {
      /* private mode */
    }
  }, [size]);
  return [size, setSize] as const;
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

/** Expert settings behind "⋯", so the toolbar stays on one row. */
function MoreMenu({ manifest, method, series, onChange }: { manifest: Manifest; method: Method; series: SeriesKind; onChange: (p: Partial<ViewState>) => void }) {
  const { open, setOpen, ref } = usePopover();
  const [copied, setCopied] = useState(false);
  return (
    <div ref={ref} className="relative">
      <button type="button" className="tool-btn" aria-label={t("tb.more")} aria-expanded={open} onClick={() => setOpen(!open)}>•••</button>
      {open && (
        <div className="popover more-pop flex flex-col gap-3" style={{ left: "auto", right: 0, width: 380 }}>
          <MethodPicker methods={manifest.methods} value={method} onChange={(key) => onChange({ method: key })} />
          <div className="flex flex-col gap-1.5">
            <span className="eyebrow">{t("ctx.series")}</span>
            <Segmented label={t("ctx.series")} value={series} onChange={(v) => onChange({ series: v })} items={[{ value: "harmonized", label: t("series.harmonized") }, { value: "modis", label: t("series.modis") }, { value: "viirs", label: t("series.viirs") }]} />
          </div>
          <button
            type="button"
            className="btn self-start"
            onClick={() => {
              navigator.clipboard?.writeText(location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            <Icon name={copied ? "check" : "link"} size={14} /> {copied ? t("ctx.copied") : t("ctx.copy")}
          </button>
        </div>
      )}
    </div>
  );
}

export function Explorer({ manifest, view, set, method, region, period, dark, simple = false, onNavigate, onExpert }: {
  manifest: Manifest;
  view: ViewState;
  set: (p: Partial<ViewState>) => void;
  method: Method;
  region: Region;
  period: Period;
  dark: boolean;
  simple?: boolean;
  onNavigate: (p: Page) => void;
  onExpert: () => void;
}) {
  const { year, ym } = period;
  const months = monthsOf(period, manifest.firstMonth, manifest.lastMonth);
  const series = useData(() => dataClient.series(region.id), [region.id]);
  const world = useData(() => dataClient.series("world"), []);
  const month = useData(() => dataClient.months(months), [months.join()]);
  const cells = useData(() => dataClient.cellsSum(months), [months.join()]);
  // A year shows its yearly file (0.1°); a month or a day shows the month (0.05°).
  const pointsKey = period.grain === "year" ? String(year) : ym;
  const points = useData(() => dataClient.points(pointsKey), [pointsKey]);
  // A country over a month or a day: every detection at its own position, from 10° tiles.
  const exactOn = region.kind === "country" && period.grain !== "year";
  const exact = useData(() => (exactOn ? dataClient.exact(ym, region.bbox) : Promise.resolve(null)), [exactOn, ym, region.id]);
  const daily = useData(() => dataClient.daily(region.id, year), [region.id, year]);
  const unc = useData(() => dataClient.uncertainty(), []);
  const [size, setSize] = usePanel();
  const [tab, setTab] = useState<Tab>("calendar");
  const globe = useRef<GlobeHandle | null>(null);
  const [scale, setScale] = useState({ top: 0, n: 0, exact: false });
  const onScale = useCallback((top: number, n: number, exact: boolean) => setScale({ top, n, exact }), []);
  const satellites = useMemo(() => activeSatellites(months[0], months[months.length - 1]), [months.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => (series.data ? monthStats(series.data, values(series.data, view.series, method.key), manifest.normalYears) : null), [series.data, view.series, method.key, manifest.normalYears]);
  const pickDaily = (d: NonNullable<typeof daily.data>) => (view.series === "harmonized" ? d.harmonized[method.key] ?? [] : view.series === "modis" ? d.modis : d.viirs);
  const fig = useMemo(() => {
    if (!stats) return null;
    if (period.grain === "year") return yearFigures(stats, year);
    if (period.grain === "month") return monthFigures(stats, ym);
    if (!daily.data || daily.data.region !== region.id) return null;
    return dayFigures(stats, ym, pickDaily(daily.data)[period.dayOfYear!] ?? null, daysInMonth(year, Number(ym.slice(5, 7))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, period.key, daily.data, view.series, method.key, region.id]);
  const unusual = useMemo(() => {
    if (!month.data || !world.data) return null;
    const wv = months.reduce((a, m) => a + (world.data!.harmonized[method.key]?.[world.data!.months.indexOf(m)] ?? 0), 0);
    return unusualCountries(month.data, method.key, manifest.regions, Math.max(500 * months.length, wv * 0.001));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month.data, world.data, method.key, manifest.regions]);

  const [csv, setCsv] = useState("#");
  useEffect(() => {
    if (!series.data) return;
    const url = csvFor(series.data, region, method);
    setCsv(url);
    return () => URL.revokeObjectURL(url);
  }, [series.data, region, method]);

  // "]" toggles the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "]" || (e.target as HTMLElement).closest("input, textarea")) return;
      setSize((s) => (s === "closed" ? "normal" : "closed"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSize]);

  const src = `${region.id === "world" ? "World" : region.name} · ${view.series === "harmonized" ? `${method.key}` : `${view.series} raw`}`;
  const selectRegion = useCallback((id: string) => set({ region: id }), [set]);
  const onReady = useCallback((h: GlobeHandle) => (globe.current = h), []);

  // Satellite that carried the series on a day of the selected month (for the point card).
  const sourceOf = useCallback(
    (d: number) => {
      if (!daily.data || daily.data.region !== region.id || daily.data.year !== year) return undefined;
      const doy = Math.round((Date.UTC(year, Number(ym.slice(5, 7)) - 1, d) - Date.UTC(year, 0, 1)) / 864e5);
      return daily.data.source[doy];
    },
    [daily.data, region.id, year, ym],
  );

  if (series.status === "error") return <ErrorBox error={series.error} />;

  const anomaly = view.metric === "anomaly";
  // Point size on the ground: 0.5° blocks for the world (see FireGlobe), the file's grid for a country.
  const km = Math.round((region.kind === "world" ? 0.5 : period.grain === "year" ? 0.1 : 0.05) * 111);

  return (
    <div className={`explorer panel-${size}`}>
      <div className="map-area">
        <FireGlobe points={points.data ?? null} exact={exact.data ?? null} day={period.grain === "day" ? Number(period.key.slice(8, 10)) : null} periodKey={period.grain === "year" ? String(year) : ym} sourceOf={sourceOf} cellKm={km} cells={cells.data ?? null} countries={month.data ?? null} method={method.key} metric={view.metric} region={region} regions={manifest.regions} dark={dark} satellites={satellites} onSelectRegion={selectRegion} onReady={onReady} onScale={onScale} />

        <div className="toolbar-row">
          <div className="toolbar glass" role="toolbar" aria-label={t("ctx.label")}>
            <RegionPicker regions={manifest.regions} value={region} onChange={(id) => set({ region: id })} />
            <span className="tool-sep" />
            <PeriodPicker period={period} first={manifest.firstMonth} last={manifest.lastMonth} onChange={(date) => set({ date })} />
            <span className="tool-sep" />
            <Segmented label={t("cal.metric")} value={view.metric} onChange={(m) => set({ metric: m })} items={[{ value: "count", label: t("cal.count") }, { value: "anomaly", label: t("cal.anomaly") }]} />
            {!simple && <MoreMenu manifest={manifest} method={method} series={view.series} onChange={set} />}
          </div>
          {region.kind !== "world" && <button type="button" className="glass-chip" onClick={() => set({ region: "world" })}>← {t("map.backToWorld")}</button>}
        </div>

        <div className="legend glass">
          <div className="legend-title"><span>{anomaly ? t("map.legendAnomaly") : t("map.legendCount")}</span><b>VIIRS-eq.</b></div>
          <span className="legend-ramp" style={{ background: anomaly ? ANOMALY_GRADIENT : COUNT_GRADIENT }} />
          <div className="legend-labels num">
            {anomaly ? (<><span>÷4 {t("legend.quieter")}</span><span>{t("cal.normal").toLowerCase()}</span><span>×4</span></>) : (<><span>1</span><span>{fmtCompact(scale.top)}+</span></>)}
          </div>
          <p>{scale.exact ? t("legend.exact", { n: fmtCompact(scale.n) }) : t("legend.point", { km: String(km), n: fmtCompact(scale.n) })}</p>
          <div className="legend-sats">
            {satellites.map((s) => (
              <span key={s.id}><i style={{ background: `rgb(${s.color.join(",")})` }} />{s.name} <small>{s.sensor}</small></span>
            ))}
          </div>
        </div>

        <div className="globe-controls glass">
          <button type="button" aria-label={t("globe.zoomIn")} onClick={() => globe.current?.zoomIn()}><Icon name="plus" /></button>
          <button type="button" aria-label={t("globe.zoomOut")} onClick={() => globe.current?.zoomOut()}><Icon name="minus" /></button>
          <button type="button" aria-label={t("globe.reset")} onClick={() => globe.current?.reset()}><Icon name="reset" /></button>
        </div>

        {stats && <TimeBar stats={stats} selected={period.prefix} onSelect={(v) => set({ date: v })} metric={view.metric} />}
      </div>

      <aside className={`inspector ${size}`} aria-label={t("insp.label")}>
        <button
          type="button"
          className="inspector-handle"
          aria-label={size === "closed" ? t("insp.open") : t("insp.close")}
          title={`${size === "closed" ? t("insp.open") : t("insp.close")}  ]`}
          onClick={() => setSize(size === "closed" ? "normal" : "closed")}
        >
          <Icon name={size === "closed" ? "chevronLeft" : "chevronRight"} size={16} />
        </button>
        {size !== "closed" && (
          <>
            <div className="inspector-head">
              <div className="inspector-kicker">
                <button type="button" className="tool-btn" onClick={() => setSize(size === "wide" ? "normal" : "wide")} aria-label={size === "wide" ? t("insp.narrow") : t("insp.wide")} title={size === "wide" ? t("insp.narrow") : t("insp.wide")}>
                  <Icon name={size === "wide" ? "collapse" : "expand"} size={15} />
                </button>
              </div>
              {series.data && stats ? (
                <AnswerStrip region={region} method={method} period={period} kind={view.series} series={series.data} fig={fig} daySource={period.grain === "day" && daily.data?.region === region.id ? daily.data.source[period.dayOfYear!] : undefined} bands={unc.data?.error_bands_country_month ?? []} unusual={unusual} simple={simple} />
              ) : (
                <Skeleton h={110} />
              )}
              {view.series !== "harmonized" && <div role="note" className="raw-note">{t("warn.raw")}</div>}
            </div>
            <div className="tabs" role="tablist">
              {(["calendar", "trends", "hotspots", "about"] as Tab[]).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{t(`tab.${k}`)}</button>
              ))}
            </div>
            <div className="tab-content" role="tabpanel">
              {tab === "calendar" && (
                <>
                  {stats ? <CalendarHeatmap stats={stats} selected={period.prefix} onSelect={(v) => set({ date: v })} metric={view.metric} onMetric={(m) => set({ metric: m })} regionName={region.name} footer={t("cal.footer", { src })} simple={simple} /> : <Skeleton h={520} />}
                  <DailyChart daily={daily.data ?? null} period={period} values={pickDaily} />
                </>
              )}
              {tab === "trends" && (
                <>
                  {stats && series.data ? <Timeline stats={stats} raw={series.data.modis} selected={period.prefix} onSelect={(v) => set({ date: v })} regionName={region.name} footer={t("tl.footer", { src })} showRaw={view.series === "harmonized"} simple={simple} /> : <Skeleton h={260} />}
                  {stats ? <SeasonChart key={`${region.id}-${year}`} stats={stats} year={year} normalYears={manifest.normalYears} /> : <Skeleton h={260} />}
                </>
              )}
              {tab === "hotspots" && (
                <section className="panel flex flex-col gap-2 p-5">
                  <p className="m-0 muted" style={{ fontSize: 12 }}>{t("hot.countryNote", { period: fmtPeriod(period, "long") })}</p>
                  {unusual ? <UnusualCountries list={unusual} max={12} onSelect={(id) => set({ region: id })} /> : <Skeleton h={300} />}
                </section>
              )}
              {tab === "about" && (
                <>
                  {simple && (
                    <section className="panel flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                      <p className="m-0" style={{ color: "var(--text-2)" }}>{t("simple.method")}</p>
                      <button type="button" className="btn" onClick={onExpert}>{t("simple.more")} <span aria-hidden="true">→</span></button>
                    </section>
                  )}
                  <MethodCard method={method} manifest={manifest} region={region} onNavigate={onNavigate} csvHref={csv} />
                </>
              )}
              <p className="src m-0">{t("map.credit")}</p>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
