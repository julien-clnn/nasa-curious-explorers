import { t } from "@/i18n";
import type { Method, Region, Series, SeriesKind, Source, Band } from "@/lib/types";
import { interval, type PeriodFigures } from "@/lib/analytics";
import { fmtCompact, fmtInt, fmtPctDelta, fmtRatio, monthName } from "@/lib/format";
import { fmtPeriod, type Period } from "@/lib/period";
import { SOURCE_COLOR } from "@/lib/colors";
import type { Unusual } from "./UnusualCountries";
import { Skeleton } from "./ui";

const SOURCES: Source[] = ["snpp", "n20", "modis", "terra", "aqua", "none"];

function Divider() {
  return <div aria-hidden="true" style={{ width: 1, alignSelf: "stretch", background: "var(--line)" }} />;
}

function Figure({ label, value, detail, color }: { label: string; value: React.ReactNode; detail?: React.ReactNode; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="eyebrow">{label}</span>
      <span className="flex flex-wrap items-baseline gap-2">
        <span className="num display" style={{ fontWeight: 600, fontSize: 34, lineHeight: 1.1, color }}>{value}</span>
        {detail && <span className="muted" style={{ fontSize: 12 }}>{detail}</span>}
      </span>
    </div>
  );
}

export function AnswerStrip(props: {
  region: Region;
  method: Method;
  period: Period;
  kind: SeriesKind;
  series: Series;
  fig: PeriodFigures | null;
  /** Satellite used on the selected day (day periods only). */
  daySource?: Source;
  bands: Band[];
  unusual: Unusual[] | null;
  simple?: boolean;
}) {
  const { region, method, period, kind, series, fig, daySource, bands, unusual, simple } = props;
  if (!fig) return <Skeleton h={120} />;

  // Days per satellite over the period (a day period has exactly one source).
  const days = period.grain === "day" ? 1 : fig.idx.reduce((a, i) => a + series.days[i], 0);
  const gaps = period.grain === "day" ? (daySource === "none" ? 1 : 0) : fig.idx.reduce((a, i) => a + series.gapDays[i], 0);
  const used =
    period.grain === "day"
      ? daySource ? [{ src: daySource, n: 1 }] : []
      : SOURCES.map((src) => ({ src, n: fig.idx.reduce((a, i) => a + (series.sourceDays[src]?.[i] ?? 0), 0) })).filter((x) => x.n > 0);
  const converted = used.filter((x) => x.src !== "snpp" && x.src !== "none").reduce((a, b) => a + b.n, 0);
  // Error bands were measured on country-months, so the interval is only shown for a month.
  const iv = kind === "harmonized" && period.grain === "month" && fig.value != null ? interval(fig.value, converted / Math.max(1, days - gaps), bands) : null;
  const hot = fig.ratio != null && fig.ratio >= 1.5;
  const monthLong = monthName(Number(period.ym.slice(5, 7)), "long");
  const normalKey = period.grain === "year" ? "answer.vsNormalYear" : period.grain === "day" ? "answer.vsNormalDay" : "answer.vsNormal";
  const rankDetail = !fig.rank
    ? ""
    : period.grain === "year"
      ? fig.rank.rank === 1 ? t("answer.rankTopYear") : t("answer.rankDetailYear", { year: fig.rank.topLabel, v: fmtCompact(fig.rank.topValue) })
      : fig.rank.rank === 1 ? t("answer.rankTop", { month: monthLong }) : t("answer.rankDetail", { month: monthLong, year: fig.rank.topLabel, v: fmtCompact(fig.rank.topValue) });

  return (
    <section className="panel flex flex-wrap items-center gap-x-7 gap-y-3 px-5 py-3.5" aria-live="polite" aria-label={t("answer.label")}>
      <Figure
        label={`${region.name} · ${fmtPeriod(period, "long")}`}
        value={fig.value == null ? t("state.noData") : fmtCompact(fig.value)}
        detail={!simple && iv && !iv.exact ? t("answer.interval", { lo: fmtCompact(iv.lo), hi: fmtCompact(iv.hi) }) : t(`answer.unit.${kind}`)}
      />
      <Divider />
      <Figure
        label={t(normalKey)}
        value={fig.state === "none" ? t("answer.noFires") : fig.state === "few" ? t("answer.tooFew") : fmtPctDelta(fig.ratio)}
        color={hot ? "var(--hot)" : undefined}
        detail={
          <>
            {t("answer.normal", { v: fmtCompact(fig.normal) })}
            {!simple && fig.aboveP90 && ` · ${t("answer.aboveP90")}`}
            {!simple && fig.belowP10 && ` · ${t("answer.belowP10")}`}
            {fig.klass && (
              <span className="chip" style={{ marginLeft: 8, padding: "1px 8px", fontWeight: 600, color: hot ? "var(--hot)" : undefined }}>
                {t(`class.${fig.klass}`)}
              </span>
            )}
          </>
        }
      />
      {!simple && fig.rank && (
        <>
          <Divider />
          <Figure
            label={t("answer.rank")}
            value={
              <>
                {fig.rank.rank}
                <span className="muted" style={{ fontSize: 18 }}>/{fig.rank.of}</span>
              </>
            }
            detail={rankDetail}
          />
        </>
      )}
      {region.kind === "world" && (
        <>
          <Divider />
          <div className="flex flex-col gap-1" style={{ flex: "1 1 260px" }}>
            <span className="eyebrow">{t("answer.drivenBy")}</span>
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>
              {unusual && unusual.length
                ? unusual.slice(0, 2).map((u, k) => (
                    <span key={u.id}>
                      {k > 0 && ` ${t("answer.and")} `}
                      <strong>{u.name} {fmtRatio(u.ratio)}</strong>
                    </span>
                  ))
                : "—"}
              {unusual && unusual.length > 0 && ` ${period.grain === "year" ? t("answer.theirNormalYear") : t("answer.theirNormal", { month: monthLong })}`}
            </span>
          </div>
        </>
      )}

      {!simple && (
        <div className="flex flex-wrap items-center gap-1.5" style={{ flexBasis: "100%", borderTop: "1px dashed var(--line)", paddingTop: 10 }}>
          <span className="eyebrow" style={{ marginRight: 4 }}>{t("prov.computedFor")}</span>
          <span className="chip"><b>{t("ctx.region")}</b> {region.name}</span>
          {kind === "harmonized" ? (
            <span className="chip"><b>{t("prov.method")}</b> {method.name} <span className="mono" style={{ color: "var(--accent)" }}>v{method.version}</span></span>
          ) : (
            <span className="chip" style={{ color: "var(--hot)" }}><b>{t("prov.series")}</b> {t(`series.${kind}`)} · {t("prov.notHarmonized")}</span>
          )}
          <span className="chip"><b>{t("ctx.period")}</b> {fmtPeriod(period)}</span>
          <span className="chip">
            <b>{t("prov.source")}</b>
            {used.map((u) => (
              <span key={u.src} className="inline-flex items-center gap-1">
                <span className="dot" style={{ background: SOURCE_COLOR[u.src] }} />
                {t(`source.${u.src}`)} {period.grain === "day" ? "" : `${u.n}/${days}`}
              </span>
            ))}
          </span>
          <span className="chip">
            <b>{t("prov.uncertainty")}</b>
            {kind !== "harmonized" ? t("prov.raw") : period.grain !== "month" ? t("prov.monthOnly") : iv?.exact ? t("prov.none") : t("prov.band", { lo: fmtInt(iv?.lo), hi: fmtInt(iv?.hi) })}
          </span>
        </div>
      )}
    </section>
  );
}
