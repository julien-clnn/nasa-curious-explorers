// The only module that fetches. Every file is fetched once and cached.
import type { Cells, ExactPoints, Points, Daily, Land, Manifest, MonthAll, Outage, Series, Uncertainty } from "./types";

const BASE = `${import.meta.env.BASE_URL}data`;
const cache = new Map<string, Promise<unknown>>();

function get<T>(path: string, base = BASE): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(`${base}/${path}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json() as Promise<T>;
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

const pointCache = new Map<string, Promise<Points>>();
/** A month ("2020-08", 0.05°) or a year ("2020", 0.1°) of points; see export_points.py for the layout. */
function points(key: string): Promise<Points> {
  let p = pointCache.get(key);
  if (!p) {
    p = fetch(`${BASE}/points/${key}.bin`).then(async (r) => {
      if (!r.ok) throw new Error(`points/${key}.bin: HTTP ${r.status}`);
      const buf = new Uint16Array(await r.arrayBuffer());
      const n = buf.length / 3;
      const deg = key.length === 4 ? 0.1 : 0.05;
      const lon = new Float32Array(n);
      const lat = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        lon[i] = (buf[i] + 0.5) * deg - 180;
        lat[i] = (buf[n + i] + 0.5) * deg - 90;
      }
      return { key, deg, lon, lat, w: buf.slice(2 * n) };
    });
    p.catch(() => pointCache.delete(key));
    pointCache.set(key, p);
  }
  return p;
}

const tileCache = new Map<string, Promise<ArrayBuffer>>();
function tile(path: string) {
  let p = tileCache.get(path);
  if (!p) {
    p = fetch(`${BASE}/${path}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    p.catch(() => tileCache.delete(path));
    tileCache.set(path, p);
  }
  return p;
}

/**
 * Every detection of month `ym` inside `bbox` (west, south, east, north; east < west wraps
 * the antimeridian), from the 10° tiles that overlap it. See export_points.py for the layout.
 */
async function exact(ym: string, bbox: [number, number, number, number]): Promise<ExactPoints> {
  const idx = await get<{ tileDeg: number; tiles: Record<string, number> }>(`exact/${ym}/index.json`);
  const D = idx.tileDeg;
  const [W, S, E, N] = bbox;
  const wrap = E - W > 180; // countries spanning ±180° (Russia, Fiji...) are given as -180..180
  const xs: number[] = [];
  const nx = 360 / D;
  for (let tx = 0; tx < nx; tx++) {
    const lo = tx * D - 180;
    if (wrap || (lo + D >= W - 1 && lo <= E + 1)) xs.push(tx);
  }
  const keys: string[] = [];
  for (let ty = Math.floor((S - 1 + 90) / D); ty <= Math.floor((N + 1 + 90) / D); ty++) for (const tx of xs) if (idx.tiles[`${tx}_${ty}`]) keys.push(`${tx}_${ty}`);
  const bufs = await Promise.all(keys.map((k) => tile(`exact/${ym}/${k}.bin`)));
  const total = keys.reduce((a, k) => a + idx.tiles[k], 0);
  const out: ExactPoints = { key: `${ym}|${bbox.join()}`, lon: new Float32Array(total), lat: new Float32Array(total), w: new Float32Array(total), day: new Uint8Array(total) };
  let o = 0;
  keys.forEach((k, j) => {
    const n = idx.tiles[k];
    const [tx, ty] = k.split("_").map(Number);
    const u16 = new Uint16Array(bufs[j], 0, 3 * n);
    const days = new Uint8Array(bufs[j], 6 * n, n);
    for (let i = 0; i < n; i++) {
      out.lon[o + i] = tx * D - 180 + (u16[i] / 65535) * D;
      out.lat[o + i] = ty * D - 90 + (u16[n + i] / 65535) * D;
      out.w[o + i] = u16[2 * n + i] / 100;
    }
    out.day.set(days, o);
    o += n;
  });
  return out;
}

export const dataClient = {
  points,
  exact,
  manifest: () => get<Manifest>("manifest.json"),
  series: (region: string) => get<Series>(`series/${region}.json`),
  daily: (region: string, year: number) => get<Daily>(`daily/${region}/${year}.json`),
  cells: (ym: string) => get<Cells>(`cells/${ym}.json`),
  month: (ym: string) => get<MonthAll>(`months/${ym}.json`),
  land: () => get<Land>("cells/land.json"),
  status: () => get<{ outages: Outage[] }>("status.json"),
  uncertainty: () => get<Uncertainty>("uncertainty.json"),
  /** Country outlines keyed by region id (static, built by `uv run country-shapes`). */
  countries: () => get<GeoJSON.FeatureCollection>("countries.json", `${import.meta.env.BASE_URL}geo`),
  /** 1° cells summed over several months (a year): harmonized values and normals add up per cell. */
  cellsSum: async (yms: string[]): Promise<Cells> => {
    const all = await Promise.all(yms.map((m) => get<Cells>(`cells/${m}.json`)));
    if (all.length === 1) return all[0];
    const keys = Object.keys(all[0].harmonized);
    const idx = new Map<string, number>();
    const out: Cells = { ym: yms.join(","), deg: all[0].deg, lat: [], lon: [], harmonized: {}, normal: {} };
    for (const k of keys) { out.harmonized[k] = []; out.normal[k] = []; }
    for (const c of all) {
      c.lat.forEach((lat, i) => {
        const key = `${lat},${c.lon[i]}`;
        let j = idx.get(key);
        if (j === undefined) {
          j = out.lat.length;
          idx.set(key, j);
          out.lat.push(lat);
          out.lon.push(c.lon[i]);
          for (const k of keys) { out.harmonized[k].push(0); out.normal[k].push(0); }
        }
        for (const k of keys) {
          out.harmonized[k][j] += c.harmonized[k]?.[i] ?? 0;
          out.normal[k][j] += c.normal[k]?.[i] ?? 0;
        }
      });
    }
    return out;
  },
  /** Every region summed over several months (a year): values and normals add up. */
  months: async (yms: string[]): Promise<MonthAll> => {
    const all = await Promise.all(yms.map((m) => get<MonthAll>(`months/${m}.json`)));
    if (all.length === 1) return all[0];
    const sum = (pick: (m: MonthAll) => Record<string, (number | null)[]>) => {
      const out: Record<string, (number | null)[]> = {};
      for (const key of Object.keys(pick(all[0]))) {
        out[key] = all[0].regions.map((_, i) => {
          const xs = all.map((m) => pick(m)[key]?.[i] ?? null);
          return xs.some((x) => x != null) ? xs.reduce<number>((a, b) => a + (b ?? 0), 0) : null;
        });
      }
      return out;
    };
    return { ym: yms.join(","), regions: all[0].regions, value: sum((m) => m.value), normal: sum((m) => m.normal) };
  },
};
