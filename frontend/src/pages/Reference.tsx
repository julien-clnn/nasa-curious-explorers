import { t } from "@/i18n";
import { dataClient } from "@/lib/dataClient";
import { useData } from "@/lib/useData";
import { fmtInt, fmtPct } from "@/lib/format";
import type { Manifest, Method, Outage } from "@/lib/types";
import { Panel, Skeleton } from "@/components/ui";

function Heading({ eyebrow, title, lead }: { eyebrow: string; title: string; lead: string }) {
  return (
    <div className="flex max-w-3xl flex-col gap-2 py-4">
      <span className="eyebrow">{eyebrow}</span>
      <h1 className="display" style={{ fontSize: 36, fontWeight: 600, lineHeight: 1.15 }}>{title}</h1>
      <p className="m-0" style={{ fontSize: 16, color: "var(--text-2)" }}>{lead}</p>
    </div>
  );
}

const SATS: Outage["satellite"][] = ["terra", "aqua", "snpp", "n20"];

function OutageTimeline({ outages, first, last }: { outages: Outage[]; first: string; last: string }) {
  const t0 = Date.parse(`${first}-01`);
  const t1 = Date.parse(`${last}-28`);
  const X = (d: string) => ((Date.parse(d) - t0) / (t1 - t0)) * 1000;
  return (
    <svg viewBox="-70 0 1080 150" className="block h-auto w-full" role="img" aria-label={t("method.outagesAlt")}>
      {SATS.map((s, i) => (
        <g key={s} transform={`translate(0 ${10 + i * 30})`}>
          <text x={-10} y={13} textAnchor="end" fontSize="12" fill="var(--text-2)">{t(`sat.${s}`)}</text>
          <rect x={0} y={4} width={1000} height={12} rx={3} fill="var(--seg)" />
          {outages.filter((o) => o.satellite === s).map((o, k) => (
            <rect key={k} x={X(o.from)} y={1} width={Math.max(2.5, X(o.to) - X(o.from))} height={18} fill="#c2341f">
              <title>{`${t(`sat.${s}`)}: ${o.from} → ${o.to}`}</title>
            </rect>
          ))}
        </g>
      ))}
      <g fontSize="11" fill="var(--muted)" textAnchor="middle">
        {[2001, 2005, 2010, 2015, 2020, 2025].map((y) => <text key={y} x={X(`${y}-01-01`)} y={142}>{y}</text>)}
      </g>
    </svg>
  );
}

export function MethodPage({ manifest, method }: { manifest: Manifest; method: Method }) {
  const status = useData(() => dataClient.status(), []);
  const unc = useData(() => dataClient.uncertainty(), []);
  const steps = ["aggregate", "outages", "fit", "validate", "publish"];
  return (
    <div className="flex flex-col gap-4">
      <Heading eyebrow={t("method.eyebrow")} title={t("method.h1")} lead={t("method.lead")} />
      <ol className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        {steps.map((s, i) => (
          <li key={s} className="panel flex flex-col gap-1 p-4">
            <span className="num mono muted">0{i + 1}</span>
            <strong>{t(`method.step.${s}`)}</strong>
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>{t(`method.step.${s}.d`)}</span>
          </li>
        ))}
      </ol>
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 460px), 1fr))" }}>
        <Panel eyebrow={t("method.factorEyebrow")} title={t("method.factorTitle")}>
          <code className="mono rounded-lg px-3 py-3" style={{ fontSize: 15, background: "var(--panel-2)", border: "1px solid var(--line)" }}>k = (V + α · k_parent) / (M + α)</code>
          <p className="m-0" style={{ color: "var(--text-2)" }}>{t("method.factorText")}</p>
        </Panel>
        <Panel eyebrow={t("method.sourceEyebrow")} title={t("method.sourceTitle")}>
          <ol className="m-0 flex list-decimal flex-col gap-1 pl-5" style={{ color: "var(--text-2)" }}>
            <li>{t("method.src1")}</li><li>{t("method.src2")}</li><li>{t("method.src3")}</li><li>{t("method.src4")}</li>
          </ol>
        </Panel>
      </div>
      <Panel eyebrow={t("method.outagesEyebrow")} title={t("method.outagesTitle")} footer="status.json">
        {status.data ? <OutageTimeline outages={status.data.outages} first={manifest.firstMonth} last={manifest.lastMonth} /> : <Skeleton h={150} />}
      </Panel>
      <Panel eyebrow={t("method.validEyebrow")} title={t("method.validTitle")}>
        <table className="num w-full text-left text-sm">
          <thead className="muted"><tr><th>{t("bench.method")}</th><th>{t("bench.testSet")}</th><th>{t("mcard.world")}</th><th>{t("mcard.country")}</th><th>{t("bench.cell")}</th></tr></thead>
          <tbody>
            {manifest.methods.flatMap((m) =>
              (["junction", "holdout"] as const).filter((k) => m.scores[k]).map((k) => (
                <tr key={m.key + k} style={{ borderTop: "1px solid var(--line)", fontWeight: m.key === method.key ? 600 : 400 }}>
                  <td>{m.name} v{m.version}</td><td>{t(`bench.${k}`)}</td><td>{fmtPct(m.scores[k]!.world)}</td><td>{fmtPct(m.scores[k]!.country)}</td><td>{fmtPct(m.scores[k]!.cell)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        {unc.data && (
          <p className="m-0" style={{ color: "var(--text-2)" }}>
            {t("method.bands")}{" "}
            {unc.data.error_bands_country_month.map((b) => `≥${fmtInt(b.predicted_from)}: ${Math.round((b.p10 - 1) * 100)}% … +${Math.round((b.p90 - 1) * 100)}%`).join(" · ")}
          </p>
        )}
      </Panel>
      <Panel eyebrow={t("method.limitsEyebrow")} title={t("method.limitsTitle")}>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5" style={{ color: "var(--text-2)" }}>
          <li>{t("method.limit1")}</li><li>{t("method.limit2")}</li><li>{t("method.limit3")}</li><li>{t("method.limit4")}</li>
        </ul>
      </Panel>
    </div>
  );
}

export function BenchmarkPage({ manifest }: { manifest: Manifest }) {
  const cols = [["holdout", "world"], ["holdout", "country"], ["holdout", "cell"], ["junction", "world"], ["junction", "country"], ["junction", "cell"]] as const;
  const best = cols.map(([set, scale]) => Math.min(...manifest.methods.map((m) => m.scores[set]?.[scale] ?? Infinity)));
  return (
    <div className="flex flex-col gap-4">
      <Heading eyebrow={t("bench.eyebrow")} title={t("bench.h1")} lead={t("bench.lead")} />
      <Panel eyebrow={t("bench.protocolEyebrow")} title={t("bench.leaderboard")} footer={t("bench.footer")}>
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[720px] text-left text-sm">
            <thead className="muted">
              <tr><th>{t("bench.method")}</th><th>{t("bench.status")}</th>{cols.map(([s, c]) => <th key={s + c}>{t(`bench.${s}`)} · {t(`bench.${c}`)}</th>)}</tr>
            </thead>
            <tbody>
              {manifest.methods.map((m) => (
                <tr key={m.key} style={{ borderTop: "1px solid var(--line)" }}>
                  <td><strong>{m.name}</strong> <span className="ver">v{m.version}</span></td>
                  <td>{t(`method.status.${m.status}`)}</td>
                  {cols.map(([s, c], k) => {
                    const v = m.scores[s]?.[c];
                    return <td key={s + c} style={{ fontWeight: v === best[k] ? 700 : 400 }}>{fmtPct(v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export function DataPage({ manifest }: { manifest: Manifest }) {
  const files = [
    ["manifest.json", t("data.manifest")],
    ["series/world.json", t("data.series")],
    ["daily/world/2024.json", t("data.daily")],
    [`cells/${manifest.lastMonth}.json`, t("data.cells")],
    [`months/${manifest.lastMonth}.json`, t("data.months")],
    ["status.json", t("data.status")],
    ["uncertainty.json", t("data.uncertainty")],
  ];
  return (
    <div className="flex flex-col gap-4">
      <Heading eyebrow={t("data.eyebrow")} title={t("data.h1")} lead={t("data.lead", { date: manifest.generatedAt.slice(0, 10) })} />
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {files.map(([path, desc]) => (
          <article key={path} className="panel flex flex-col gap-2 p-4">
            <span className="mono" style={{ fontSize: 13 }}>{path}</span>
            <p className="m-0 flex-1" style={{ color: "var(--text-2)", fontSize: 13 }}>{desc}</p>
            <a className="btn self-start no-underline" href={`${import.meta.env.BASE_URL}data/${path}`} download>{t("data.download")}</a>
          </article>
        ))}
      </div>
      <Panel eyebrow={t("data.citeEyebrow")} title={t("data.citeTitle")}>
        <p className="m-0" style={{ color: "var(--text-2)" }}>{t("data.cite")}</p>
      </Panel>
    </div>
  );
}
