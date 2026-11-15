import { t } from "@/i18n";
import type { Daily, Source } from "@/lib/types";
import { fmtInt, monthName } from "@/lib/format";
import { daysInMonth, fmtPeriod, type Period } from "@/lib/period";
import { SOURCE_COLOR, countColor } from "@/lib/colors";
import { Panel, Skeleton } from "./ui";

const ORDER: Source[] = ["snpp", "n20", "modis", "terra", "aqua", "none"];

/** Day-by-day hotspots: the whole year for a year, the month for a month or a day (the day highlighted). */
export function DailyChart({ daily, period, values }: { daily: Daily | null; period: Period; values: (d: Daily) => (number | null)[] }) {
  const y = period.year;
  const m = Number(period.ym.slice(5, 7));
  const whole = period.grain === "year";
  const title = t("daily.title", { month: whole ? String(y) : fmtPeriod({ ...period, grain: "month" }, "long") });
  if (!daily) return <Panel eyebrow={t("daily.eyebrow")} title={title}><Skeleton h={180} /></Panel>;

  const first = whole ? 0 : Math.round((Date.UTC(y, m - 1, 1) - Date.UTC(y, 0, 1)) / 864e5);
  const n = whole ? daily.source.length : daysInMonth(y, m);
  const dateOf = (i: number) => new Date(Date.UTC(y, 0, 1 + first + i));
  const label = (i: number) => `${dateOf(i).getUTCDate()} ${monthName(dateOf(i).getUTCMonth() + 1)}`;
  const vals = values(daily).slice(first, first + n);
  const src = daily.source.slice(first, first + n);
  const vmax = Math.max(1, ...vals.map((v) => v ?? 0));
  const peak = vals.indexOf(vmax);
  const counts = ORDER.map((s) => ({ s, n: src.filter((x) => x === s).length }));
  const picked = period.grain === "day" ? period.dayOfYear! - first : -1;
  const gap = whole ? 0 : 3;

  return (
    <Panel
      eyebrow={t("daily.eyebrow")}
      title={title}
      actions={<span className="num muted" style={{ fontSize: 12 }}>{t("daily.peak", { day: label(peak), v: fmtInt(vmax) })}</span>}
      footer={t("daily.footer")}
    >
      <div className="flex h-[140px] items-end pt-2" style={{ gap, borderBottom: "1px solid var(--line-2)" }} role="img" aria-label={t("daily.alt", { month: title })}>
        {vals.map((v, i) => (
          <span
            key={i}
            title={`${label(i)} ${y} · ${v == null ? t("state.noData") : fmtInt(v)} · ${t(`source.${src[i]}`)}`}
            className={`block flex-1 ${whole ? "" : "rounded-t-[3px]"} ${v == null ? "hatch" : ""}`}
            style={{
              height: v == null ? "100%" : `${Math.max(2, (v / vmax) * 124)}px`,
              background: v == null ? undefined : i === picked ? "var(--accent)" : countColor(0.25 + 0.6 * (v / vmax)),
              opacity: v == null ? 0.6 : picked >= 0 && i !== picked ? 0.55 : 1,
            }}
          />
        ))}
      </div>
      {whole ? (
        <div className="grid" style={{ gridTemplateColumns: "repeat(12, minmax(0,1fr))" }}>
          {Array.from({ length: 12 }, (_, k) => <span key={k} className="muted" style={{ fontSize: 10 }}>{monthName(k + 1)}</span>)}
        </div>
      ) : (
        <div className="flex gap-[3px]">
          {vals.map((_, i) => (
            <span key={i} className="flex flex-1 flex-col items-center gap-[3px]">
              <span className="dot" style={{ width: 6, height: 6, background: SOURCE_COLOR[src[i]] }} />
              <span className="num h-3.5" style={{ fontSize: 10, color: i === picked ? "var(--text)" : "var(--muted)", fontWeight: i === picked ? 700 : 400 }}>{i === 0 || i === picked || (i + 1) % 5 === 0 ? i + 1 : ""}</span>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-3" style={{ fontSize: 11, color: "var(--text-2)" }}>
        {counts.filter((c) => c.n > 0 || c.s === "snpp" || c.s === "n20" || c.s === "none").map((c) => (
          <span key={c.s} className="flex items-center gap-1.5" style={{ color: c.n ? undefined : "var(--muted)" }}>
            <span className="dot" style={{ width: 7, height: 7, background: SOURCE_COLOR[c.s] }} />
            {t(`source.${c.s}`)} ({c.n})
          </span>
        ))}
      </div>
    </Panel>
  );
}
