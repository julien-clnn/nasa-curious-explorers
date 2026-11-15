import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/i18n";
import type { Manifest, Method, Region, SeriesKind } from "@/lib/types";
import { fmtPct } from "@/lib/format";
import type { Period } from "@/lib/period";
import { PeriodPicker } from "./PeriodPicker";
import { Icon, Segmented } from "./ui";

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

export function RegionPicker({ regions, value, onChange, style }: { regions: Region[]; value: Region; onChange: (id: string) => void; style?: React.CSSProperties }) {
  const { open, setOpen, ref } = usePopover();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = [...regions].sort((a, b) => (a.kind === "world" ? -1 : b.kind === "world" ? 1 : a.name.localeCompare(b.name)));
    return s ? all.filter((r) => r.name.toLowerCase().includes(s)) : all;
  }, [regions, q]);
  return (
    <div ref={ref} className="relative flex" style={style}>
      <button type="button" className="ctl w-full" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="eyebrow">{t("ctx.region")}</span>
        <span className="ctl-value">
          {value.kind === "world" && <Icon name="globe" size={15} stroke={1.8} />}
          {value.name}
          <Icon name="chevron" size={14} />
          {value.kind === "world" && <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{t("ctx.regionHint")}</span>}
        </span>
      </button>
      {open && (
        <div className="popover" style={{ width: 320 }}>
          <label className="flex items-center gap-2 rounded-lg px-2" style={{ border: "1px solid var(--line-2)" }}>
            <Icon name="search" size={15} />
            <span className="sr-only">{t("ctx.regionSearch")}</span>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ctx.regionSearch")} className="w-full bg-transparent py-2 outline-none" />
          </label>
          <ul role="listbox" aria-label={t("ctx.region")} className="mt-2 max-h-80 overflow-auto">
            {list.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={r.id === value.id}
                  className="opt"
                  style={{ gridTemplateColumns: "20px 1fr", padding: "8px 10px" }}
                  onClick={() => {
                    onChange(r.id);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <span style={{ color: "var(--accent)" }}>{r.id === value.id && <Icon name="check" size={16} />}</span>
                  <span>{r.name}</span>
                </button>
              </li>
            ))}
            {!list.length && <li className="muted p-3">{t("ctx.noRegion")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export function MethodBadge({ m }: { m: Method }) {
  return (
    <>
      {m.name} <span className="ver">v{m.version}</span>
    </>
  );
}

export function MethodPicker({ methods, value, onChange }: { methods: Method[]; value: Method; onChange: (key: string) => void }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div ref={ref} className="relative" style={{ flex: "2 1 320px" }}>
      <button type="button" className="ctl w-full" style={{ borderColor: open ? "var(--accent)" : undefined }} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="eyebrow">{t("ctx.method")}</span>
        <span className="ctl-value">
          <MethodBadge m={value} />
          <span style={{ fontSize: 12, fontWeight: 500, color: value.status === "shipped" ? "var(--ok)" : "var(--muted)" }}>● {t(`method.status.${value.status}`)}</span>
          <Icon name={open ? "up" : "chevron"} size={14} />
        </span>
      </button>
      {open && (
        <div className="popover" role="listbox" aria-label={t("ctx.method")} style={{ width: "min(520px, 92vw)" }}>
          {methods.map((m) => (
            <button
              key={m.key}
              type="button"
              role="option"
              aria-selected={m.key === value.key}
              className="opt"
              onClick={() => {
                onChange(m.key);
                setOpen(false);
              }}
            >
              <span style={{ color: "var(--accent)" }}>{m.key === value.key && <Icon name="check" size={18} />}</span>
              <span className="flex flex-col gap-1">
                <span className="flex items-center gap-2 font-semibold">
                  <MethodBadge m={m} />
                </span>
                <span style={{ fontSize: 12, color: "var(--text-2)" }}>{m.summary}</span>
                <span style={{ fontSize: 12, color: m.status === "shipped" ? "var(--ok)" : "var(--muted)" }}>● {t(`method.status.${m.status}`)}</span>
              </span>
              <span className="flex flex-col items-end">
                <span className="num" style={{ fontSize: 18, fontWeight: 600 }}>{fmtPct(m.scores.holdout?.country)}</span>
                <span className="muted" style={{ fontSize: 11 }}>{t("method.errorCountry")}</span>
              </span>
            </button>
          ))}
          <div className="muted mt-1 flex justify-between gap-3 px-3 pt-3 text-xs" style={{ borderTop: "1px solid var(--line)" }}>
            <span>{t("method.errorNote")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function ContextBar(props: {
  manifest: Manifest;
  region: Region;
  method: Method;
  period: Period;
  series: SeriesKind;
  simple?: boolean;
  onChange: (patch: { region?: string; method?: string; date?: string; series?: SeriesKind }) => void;
}) {
  const { manifest, region, method, period, series, simple, onChange } = props;
  const [copied, setCopied] = useState(false);
  // Region and period share one width so the bar reads as a single row of equal controls.
  const half: React.CSSProperties = { flex: "1 1 260px", minWidth: 0 };
  return (
    <section aria-label={t("ctx.label")} className="panel flex flex-wrap items-stretch gap-2.5 p-2.5">
      <RegionPicker regions={manifest.regions} value={region} onChange={(id) => onChange({ region: id })} style={half} />
      {!simple && <MethodPicker methods={manifest.methods} value={method} onChange={(key) => onChange({ method: key })} />}
      <PeriodPicker period={period} first={manifest.firstMonth} last={manifest.lastMonth} onChange={(date) => onChange({ date })} style={half} />
      {!simple && (
        <>
          <div className="ctl" style={{ flex: "2 1 300px" }}>
            <span className="eyebrow">{t("ctx.series")}</span>
            <Segmented
              label={t("ctx.series")}
              value={series}
              onChange={(v) => onChange({ series: v })}
              items={[
                { value: "harmonized", label: t("series.harmonized") },
                { value: "modis", label: t("series.modis") },
                { value: "viirs", label: t("series.viirs") },
              ]}
            />
          </div>
          <button
            type="button"
            className="ctl"
            style={{ flex: "0 1 auto", justifyContent: "center" }}
            onClick={() => {
              navigator.clipboard?.writeText(location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            <span className="eyebrow">{t("ctx.share")}</span>
            <span className="flex items-center gap-2" style={{ fontSize: 13, color: "var(--text-2)" }}>
              <Icon name={copied ? "check" : "link"} size={14} />
              {copied ? t("ctx.copied") : t("ctx.copy")}
            </span>
          </button>
        </>
      )}
    </section>
  );
}
