import { useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";
import { dataClient } from "@/lib/dataClient";
import { useData } from "@/lib/useData";
import { useViewState, type Page } from "@/lib/urlState";
import { fmtYm } from "@/lib/format";
import { fmtPeriod, parsePeriod } from "@/lib/period";
import { ErrorBox, Icon, Logo, Segmented, Skeleton } from "@/components/ui";
import { Explorer } from "@/pages/Explorer";
import { BenchmarkPage, DataPage, MethodPage } from "@/pages/Reference";

const PAGES: Page[] = ["explorer", "method", "benchmark", "data"];

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("theme") !== "light"; // night globe by default
    } catch {
      return true;
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      /* private mode */
    }
  }, [dark]);
  return [dark, setDark] as const;
}

export default function App() {
  const [rawView, set] = useViewState();
  const simple = rawView.mode === "simple";
  // Simple mode always shows the explorer with the default method and the harmonized series (Count / vs usual stays free).
  const view = simple ? { ...rawView, page: "explorer" as const, method: "", series: "harmonized" as const } : rawView;
  const [dark, setDark] = useTheme();
  const manifest = useData(() => dataClient.manifest(), []);
  const m = manifest.data;

  const method = m ? m.methods.find((x) => x.key === view.method) ?? m.methods.find((x) => x.key === m.defaultMethod)! : null;
  const region = m ? m.regions.find((r) => r.id === view.region) ?? m.regions[0] : null;
  const period = useMemo(() => (m ? parsePeriod(view.date, m.firstMonth, m.lastMonth) : null), [m, view.date]);

  useEffect(() => {
    if (region && period) document.title = `${region.name} · ${fmtPeriod(period)} — ${t("app.name")}`;
  }, [region, period]);

  return (
    <div className="min-h-screen">
      <header className="app-header" style={{ borderBottom: "1px solid var(--line)", background: "var(--panel)" }}>
        <div className={`${view.page === "explorer" ? "px-4" : "wrap"} flex flex-wrap items-center justify-between gap-4 py-2`}>
          <div className="flex flex-wrap items-center gap-7">
            <button type="button" className="flex items-center gap-2.5 border-0 bg-transparent p-0" style={{ color: "var(--text)" }} onClick={() => set({ page: "explorer" })}>
              <Logo />
              <span className="display" style={{ fontWeight: 600, fontSize: 17 }}>{t("app.name")}</span>
            </button>
            {!simple && (
              <nav aria-label={t("nav.label")} className="flex flex-wrap gap-0.5">
                {PAGES.map((p) => (
                  <button key={p} type="button" className="navb" aria-current={view.page === p ? "page" : undefined} onClick={() => set({ page: p })}>{t(`nav.${p}`)}</button>
                ))}
              </nav>
            )}
          </div>
          <div className="flex items-center gap-3.5">
            {m && !simple && <span className="src">{t("app.coverage", { from: fmtYm(m.firstMonth), to: fmtYm(m.lastMonth) })}</span>}
            <Segmented
              label={t("mode.label")}
              value={rawView.mode}
              onChange={(v) => set({ mode: v })}
              items={[
                { value: "simple", label: t("mode.simple") },
                { value: "expert", label: t("mode.expert") },
              ]}
            />
            <button type="button" className="icon-btn" aria-label={dark ? t("app.light") : t("app.dark")} onClick={() => setDark(!dark)}>
              <Icon name={dark ? "sun" : "moon"} stroke={1.8} />
            </button>
          </div>
        </div>
      </header>

      {m && method && region && period && view.page === "explorer" ? (
        <main>
          <Explorer
            manifest={m} view={view} set={set} method={method} region={region} period={period} dark={dark} simple={simple}
            onNavigate={(p) => set({ page: p })} onExpert={() => set({ mode: "expert" })}
          />
        </main>
      ) : (
        <main className="wrap flex flex-col gap-4 pt-4 pb-16">
          {manifest.status === "error" && <ErrorBox error={manifest.error} />}
          {!m && manifest.status === "loading" && <Skeleton h={600} />}
          {m && method && region && period && (
            <>
              {view.page === "method" && <MethodPage manifest={m} method={method} />}
              {view.page === "benchmark" && <BenchmarkPage manifest={m} />}
              {view.page === "data" && <DataPage manifest={m} />}
            </>
          )}
          <footer className="src pt-2 text-center">{t("app.footer")}</footer>
        </main>
      )}
    </div>
  );
}
