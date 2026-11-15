import { t } from "@/i18n";
import type { Manifest, Method, Region } from "@/lib/types";
import { fmtPct } from "@/lib/format";
import type { Page } from "@/lib/urlState";

export function MethodCard({ method, manifest, region, onNavigate, csvHref }: { method: Method; manifest: Manifest; region: Region; onNavigate: (p: Page) => void; csvHref: string }) {
  const baseline = manifest.methods.find((m) => m.status === "baseline" && m.key !== method.key);
  const p = method.params as { alpha?: number; cap?: number; calibration?: [number, number] };
  return (
    <section className="panel grid items-start gap-6 p-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))" }}>
      <div className="flex flex-col gap-2">
        <span className="eyebrow">{t("mcard.eyebrow")}</span>
        <h2 className="flex flex-wrap items-center gap-2.5" style={{ fontSize: 19, fontWeight: 600 }}>
          {method.name} <span className="ver">v{method.version}</span>
        </h2>
        <p className="m-0" style={{ color: "var(--text-2)" }}>{method.summary}</p>
        {p.alpha != null && (
          <code className="mono rounded-lg px-3 py-2.5" style={{ fontSize: 13, background: "var(--panel-2)", border: "1px solid var(--line)" }}>
            k = (V + α·k_parent) / (M + α) · α = {p.alpha} · cap ×{p.cap}
          </code>
        )}
      </div>
      <div className="flex flex-col gap-2.5">
        <span className="eyebrow">{t("mcard.tested")}</span>
        <div className="num grid gap-x-4 gap-y-2" style={{ gridTemplateColumns: "1fr auto auto", fontSize: 13 }}>
          <span className="muted">{t("mcard.medianError")}</span><span className="muted">{t("mcard.world")}</span><span className="muted">{t("mcard.country")}</span>
          {method.scores.junction && (<><span>{t("mcard.junction")}</span><span>{fmtPct(method.scores.junction.world)}</span><span>{fmtPct(method.scores.junction.country)}</span></>)}
          {method.scores.holdout && (<><span>{t("mcard.holdout")}</span><span>{fmtPct(method.scores.holdout.world)}</span><span>{fmtPct(method.scores.holdout.country)}</span></>)}
          {baseline?.scores.holdout && (<><span className="muted">{baseline.name} ({t("method.status.baseline")})</span><span className="muted">{fmtPct(baseline.scores.holdout.world)}</span><span className="muted">{fmtPct(baseline.scores.holdout.country)}</span></>)}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="eyebrow">{t("mcard.further")}</span>
        <button type="button" className="btn justify-between py-2.5" onClick={() => onNavigate("method")}>{t("mcard.read")} <span aria-hidden="true">→</span></button>
        <button type="button" className="btn justify-between py-2.5" onClick={() => onNavigate("benchmark")}>{t("mcard.compare")} <span aria-hidden="true">→</span></button>
        <a className="btn justify-between py-2.5 no-underline" href={csvHref} download={`${region.id}_${method.id}-${method.version}.csv`}>{t("mcard.download", { region: region.name, v: method.version })} <span aria-hidden="true">↓</span></a>
      </div>
    </section>
  );
}
