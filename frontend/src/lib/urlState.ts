// All view state lives in the query string so any view can be shared.
import { useCallback, useEffect, useState } from "react";
import type { SeriesKind } from "./types";

export type Page = "explorer" | "method" | "benchmark" | "data";
export type Metric = "anomaly" | "count";
export type Mode = "simple" | "expert";

export interface ViewState {
  page: Page;
  region: string;
  method: string; // "" = manifest default
  date: string; // "2025" | "2025-12" | "2025-12-14"; "" = last month
  series: SeriesKind;
  metric: Metric;
  mode: Mode;
}

const DEFAULTS: ViewState = { page: "explorer", region: "world", method: "", date: "", series: "harmonized", metric: "anomaly", mode: "simple" };

/** Last mode the visitor chose, so the site reopens the way they left it. */
function storedMode(): Mode | null {
  try {
    const v = localStorage.getItem("mode");
    return v === "simple" || v === "expert" ? v : null;
  } catch {
    return null;
  }
}

function read(): ViewState {
  const q = new URLSearchParams(location.search);
  const pick = <K extends keyof ViewState>(k: K, allowed?: readonly string[]) => {
    const v = q.get(k);
    return (v != null && (!allowed || allowed.includes(v)) ? v : DEFAULTS[k]) as ViewState[K];
  };
  return {
    page: pick("page", ["explorer", "method", "benchmark", "data"]),
    region: pick("region"),
    method: pick("method"),
    date: pick("date") || (q.get("ym") ?? ""), // "ym" = links made before day/year periods
    series: pick("series", ["harmonized", "modis", "viirs"]),
    metric: pick("metric", ["anomaly", "count"]),
    mode: (q.get("mode") === "expert" || q.get("mode") === "simple" ? q.get("mode") : storedMode() ?? DEFAULTS.mode) as Mode,
  };
}

function write(s: ViewState) {
  const q = new URLSearchParams();
  (Object.keys(s) as (keyof ViewState)[]).forEach((k) => {
    if (s[k] !== DEFAULTS[k]) q.set(k, s[k]);
  });
  const qs = q.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

export function useViewState() {
  const [state, setState] = useState<ViewState>(read);
  useEffect(() => {
    write(state);
    try {
      localStorage.setItem("mode", state.mode);
    } catch {
      /* private mode */
    }
  }, [state]);
  const set = useCallback((patch: Partial<ViewState>) => setState((s) => ({ ...s, ...patch })), []);
  return [state, set] as const;
}
