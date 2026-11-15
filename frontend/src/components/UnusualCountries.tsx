import { t } from "@/i18n";
import type { MonthAll, Region } from "@/lib/types";
import { fmtInt, fmtRatio } from "@/lib/format";

export interface Unusual {
  id: string;
  name: string;
  value: number;
  normal: number;
  ratio: number;
}

/** Countries furthest above their own normal this month, ignoring tiny counts. */
export function unusualCountries(month: MonthAll, method: string, regions: Region[], minValue: number): Unusual[] {
  const v = month.value[method] ?? [];
  const n = month.normal[method] ?? [];
  const byId = new Map(regions.map((r) => [r.id, r]));
  return month.regions
    .map((id, i) => ({ id, name: byId.get(id)?.name ?? id, value: v[i] ?? 0, normal: n[i] ?? 0, kind: byId.get(id)?.kind }))
    .filter((r) => r.kind === "country" && r.value >= minValue && r.normal > 0)
    .map(({ kind: _k, ...r }) => ({ ...r, ratio: r.value / r.normal }))
    .sort((a, b) => b.ratio - a.ratio);
}

export function UnusualCountries({ list, onSelect, max = 5 }: { list: Unusual[]; onSelect: (id: string) => void; max?: number }) {
  const top = list.slice(0, max);
  const maxLog = Math.log(Math.max(2, ...top.map((u) => u.ratio)));
  return (
    <div className="flex flex-col gap-1 pt-3" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">{t("unusual.title")}</span>
        <span className="muted" style={{ fontSize: 11 }}>{t("unusual.hint")}</span>
      </div>
      {top.map((u) => (
        <button key={u.id} type="button" className="rowbtn" onClick={() => onSelect(u.id)}>
          <span className="truncate font-medium">{u.name}</span>
          <span className="block h-2.5 overflow-hidden rounded-full" style={{ background: "var(--seg)" }}>
            <span className="block h-full rounded-full" style={{ width: `${Math.max(4, (Math.log(Math.max(1, u.ratio)) / maxLog) * 100)}%`, background: u.ratio >= 3 ? "#c2341f" : u.ratio >= 1.5 ? "#f08a3c" : "#f5b27a" }} />
          </span>
          <span className="num text-right" style={{ fontSize: 13 }}>
            <strong>{fmtRatio(u.ratio)}</strong> <span className="muted" style={{ fontSize: 11 }}>{fmtInt(u.value)}</span>
          </span>
        </button>
      ))}
      {!top.length && <span className="muted">—</span>}
    </div>
  );
}
