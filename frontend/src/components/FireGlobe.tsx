import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { t } from "@/i18n";
import type { Cells, ExactPoints, MonthAll, Points, Region, Source } from "@/lib/types";
import type { Metric } from "@/lib/urlState";
import { fmtInt, fmtPctDelta, fmtYm, monthName } from "@/lib/format";
import { compare } from "@/lib/analytics";
import { ANOMALY_STOPS, COUNT_STOPS, type Stop } from "@/lib/colors";
import { dataClient } from "@/lib/dataClient";
import { angleDeg, orbitPath, satPosition, type Sat } from "@/lib/satellites";

/**
 * The Earth seen from space: Blue Marble by day (light theme), Black Marble city lights by
 * night (dark theme), both NASA GIBS. Countries are an invisible, clickable layer with
 * borders. Fire points and satellites are drawn by deck.gl in the same WebGL context:
 * typed arrays go straight to the GPU, so 300k points need no tiling.
 */
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const DAY_TILES = `${GIBS}/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`;
const NIGHT_TILES = `${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`;
// Zoom 0-5 is served by the site itself (`uv run fetch-tiles`): no waiting on GIBS for the
// world view or a country. Closer zooms come from GIBS, drawn over the local tiles.
const LOCAL_MAX = 5;
const local = (layer: string) => new URL(`${import.meta.env.BASE_URL}data/tiles/${layer}/{z}/{y}/{x}.jpg`, location.href).href.replace(/%7B/g, "{").replace(/%7D/g, "}");
const GIBS_ATTR = 'Imagery: <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a> (Blue Marble, Black Marble)';

/**
 * Points float 4 km above the ground and face the camera: flat discs lying on the curved,
 * tiled globe surface would cut into it and flicker (z-fighting) as the Earth turns.
 */
const LIFT = 4000;

/** Cell anomalies reach the ends of the scale at ×4 / ÷4. */
const CELL_SPAN = 2;

type RGB = [number, number, number];
function rampRGB(stops: Stop[], v: number): RGB {
  const x = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], v));
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (x <= b) {
      const u = (x - a) / (b - a || 1);
      return [0, 1, 2].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * u)) as RGB;
    }
  }
  return stops[stops.length - 1][1];
}

function baseStyle(dark: boolean): StyleSpecification {
  return {
    version: 8,
    projection: { type: "globe" },
    sky: { "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 0.8, 7, 0] },
    sources: {
      day: { type: "raster", tiles: [local("day")], tileSize: 256, maxzoom: LOCAL_MAX, attribution: GIBS_ATTR },
      night: { type: "raster", tiles: [local("night")], tileSize: 256, maxzoom: LOCAL_MAX, attribution: GIBS_ATTR },
      dayHi: { type: "raster", tiles: [DAY_TILES], tileSize: 256, minzoom: LOCAL_MAX + 1, maxzoom: 8 },
      nightHi: { type: "raster", tiles: [NIGHT_TILES], tileSize: 256, minzoom: LOCAL_MAX + 1, maxzoom: 8 },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": dark ? "#04070d" : "#0d2a4a" } },
      // Both stay in the style; only visibility changes (no setStyle, which drops added sources).
      ...(["day", "dayHi"] as const).map((id) => ({ id, type: "raster" as const, source: id, minzoom: id === "dayHi" ? LOCAL_MAX + 1 : 0, layout: { visibility: dark ? ("none" as const) : ("visible" as const) }, paint: { "raster-saturation": -0.15, "raster-fade-duration": 0 } })),
      ...(["night", "nightHi"] as const).map((id) => ({ id, type: "raster" as const, source: id, minzoom: id === "nightHi" ? LOCAL_MAX + 1 : 0, layout: { visibility: dark ? ("visible" as const) : ("none" as const) }, paint: { "raster-brightness-max": 0.3, "raster-saturation": -1, "raster-contrast": -0.25, "raster-fade-duration": 0 } })),
    ],
  };
}

interface Drawn {
  n: number;
  positions: Float32Array;
  colors: Uint8Array;
  radii: Float32Array;
  glow: { n: number; positions: Float32Array; colors: Uint8Array; radii: Float32Array };
  top: number;
  exact: boolean;
  /** Per drawn point (same order as positions), for the click card. */
  info: { lon: Float32Array; lat: Float32Array; own: Float32Array; dens: Float32Array; lr: Float32Array; day: Uint8Array | null };
}

/** Bilinear read of the 1° log-ratio grid at a point (cell centres sit at x.5°). */
function logRatioAt(lr: Float32Array, lon: number, lat: number) {
  const x = lon + 180 - 0.5;
  const y = lat + 90 - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.max(0, Math.min(178, Math.floor(y)));
  const fx = x - x0;
  const fy = Math.max(0, Math.min(1, y - y0));
  const c = (cx: number, cy: number) => lr[cy * 360 + ((cx + 360) % 360)];
  return (c(x0, y0) * (1 - fx) + c(x0 + 1, y0) * fx) * (1 - fy) + (c(x0, y0 + 1) * (1 - fx) + c(x0 + 1, y0 + 1) * fx) * fy;
}

/** World view: points merged into 0.5° blocks (~3 px on the globe), so ~10× fewer to draw. */
const WORLD_DEG = 0.5;

/**
 * Typed arrays for deck.gl, built without per-point objects or strings so a 300k-point month
 * takes a few tens of ms. World view aggregates; a country keeps full resolution, clipped to
 * its bounding box.
 */
function buildPoints(p: Points, region: Region, cells: Cells | null, method: string, metric: Metric, dark: boolean, exact: ExactPoints | null, day: number | null): Drawn {
  let lon: Float32Array;
  let lat: Float32Array;
  let w: Float32Array;
  let own: Float32Array | null = null; // a detection's own weight, when w is its neighbourhood
  let days: Uint8Array | null = null;
  let deg = p.deg;
  if (region.kind === "world") {
    deg = Math.max(p.deg, WORLD_DEG);
    const nx = Math.round(360 / deg);
    const grid = new Float32Array(nx * Math.round(180 / deg));
    for (let i = 0; i < p.w.length; i++) grid[Math.floor((p.lat[i] + 90) / deg) * nx + Math.floor((p.lon[i] + 180) / deg)] += p.w[i];
    let n = 0;
    for (let k = 0; k < grid.length; k++) if (grid[k] > 0) n++;
    lon = new Float32Array(n);
    lat = new Float32Array(n);
    w = new Float32Array(n);
    for (let k = 0, j = 0; k < grid.length; k++) {
      if (grid[k] <= 0) continue;
      // A fixed pseudo-random offset inside the block, so the world view does not read as a grid.
      const h = Math.imul(k, 2654435761) >>> 0;
      lon[j] = ((k % nx) + 0.2 + 0.6 * ((h & 0xffff) / 0xffff)) * deg - 180;
      lat[j] = (Math.floor(k / nx) + 0.2 + 0.6 * ((h >>> 16) / 0xffff)) * deg - 90;
      w[j++] = grid[k];
    }
  } else if (exact) {
    // Each detection at its own position. Its colour and size come from the hotspots of its
    // 0.05° grid cell (local density): a single detection weighs 1, which says little.
    const dens = new Map<number, number>();
    const nx = Math.round(360 / p.deg);
    const cell = (x: number, y: number) => Math.floor((y + 90) / p.deg) * nx + Math.floor((x + 180) / p.deg);
    for (let i = 0; i < p.w.length; i++) dens.set(cell(p.lon[i], p.lat[i]), p.w[i]);
    const keep = new Uint32Array(exact.w.length);
    let n = 0;
    for (let i = 0; i < exact.w.length; i++) if (day == null || exact.day[i] === day) keep[n++] = i;
    lon = new Float32Array(n);
    lat = new Float32Array(n);
    w = new Float32Array(n);
    own = new Float32Array(n);
    days = new Uint8Array(n);
    for (let j = 0; j < n; j++) {
      const i = keep[j];
      lon[j] = exact.lon[i];
      lat[j] = exact.lat[i];
      own[j] = exact.w[i];
      days[j] = exact.day[i];
      w[j] = dens.get(cell(lon[j], lat[j])) ?? exact.w[i];
    }
  } else {
    const [W, S, E, N] = region.bbox;
    const wrap = E - W > 180;
    const keep = new Uint32Array(p.w.length);
    let n = 0;
    for (let i = 0; i < p.w.length; i++) {
      const x = p.lon[i];
      const y = p.lat[i];
      if (y < S - 1 || y > N + 1) continue;
      if (wrap ? x > E + 1 && x < W - 1 : x < W - 1 || x > E + 1) continue;
      keep[n++] = i;
    }
    lon = new Float32Array(n);
    lat = new Float32Array(n);
    w = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      lon[j] = p.lon[keep[j]];
      lat[j] = p.lat[keep[j]];
      w[j] = p.w[keep[j]];
    }
  }
  const n = w.length;
  // Brightest last so they sit on top.
  const order = new Uint32Array(n).map((_, i) => i).sort((a, b) => w[a] - w[b]);

  // Per 1° cell log2 ratio to the usual, as a dense grid (index = row * 360 + col). Read with
  // bilinear interpolation between cell centres, so colours blend instead of showing 1° squares.
  const lr = new Float32Array(360 * 180);
  if (cells) {
    const h = cells.harmonized[method] ?? [];
    const nn = cells.normal[method] ?? [];
    cells.lat.forEach((la, i) => {
      const r = compare(h[i] ?? 0, nn[i] ?? 0).ratio;
      lr[(Math.floor(la) + 90) * 360 + Math.floor(cells.lon[i]) + 180] = Math.log2(Math.max(r ?? 1, 1e-3));
    });
  }
  const top = n ? w[order[Math.min(n - 1, Math.floor(n * 0.999))]] : 1;
  const ltop = Math.log10(top + 1) || 1;
  const positions = new Float32Array(n * 3);
  const colors = new Uint8Array(n * 4);
  const radii = new Float32Array(n);
  const g: number[] = [];
  const world = region.kind === "world";
  const info = { lon: new Float32Array(n), lat: new Float32Array(n), own: new Float32Array(n), dens: new Float32Array(n), lr: new Float32Array(n), day: days ? new Uint8Array(n) : null };
  for (let j = 0; j < n; j++) {
    const i = order[j];
    const tt = Math.min(1, Math.log10(w[i] + 1) / ltop);
    positions[3 * j] = lon[i];
    positions[3 * j + 1] = lat[i];
    positions[3 * j + 2] = LIFT;
    const l2 = logRatioAt(lr, lon[i], lat[i]);
    info.lon[j] = lon[i];
    info.lat[j] = lat[i];
    info.own[j] = own ? own[i] : w[i];
    info.dens[j] = w[i];
    info.lr[j] = l2;
    if (info.day && days) info.day[j] = days[i];
    let c: RGB;
    let alpha = 255 * (0.6 + 0.4 * tt);
    if (metric === "anomaly") {
      const a = Math.max(-1, Math.min(1, l2 / CELL_SPAN));
      c = rampRGB(ANOMALY_STOPS, a);
      // Near-usual (grey) points stay discreet; clearly quieter (blue) or busier (red) ones stand out.
      alpha *= 0.55 + 0.45 * Math.abs(a);
    } else {
      // On the night side the pale end of the scale glows; by day it needs the darker steps.
      c = rampRGB(COUNT_STOPS, dark ? 0.15 + 0.85 * tt : 0.35 + 0.65 * tt);
    }
    colors[4 * j] = c[0];
    colors[4 * j + 1] = c[1];
    colors[4 * j + 2] = c[2];
    colors[4 * j + 3] = Math.round(alpha);
    // Radius in screen pixels, so a country's points stay visible whatever the zoom.
    radii[j] = world ? 0.6 + 1.7 * tt : exact ? 0.7 + 1.5 * tt : 0.9 + 2.4 * tt;
    if (!exact && tt > (world ? 0.75 : 0.5)) g.push(j); // no halo on single detections: they are dense
  }
  const glow = { n: g.length, positions: new Float32Array(g.length * 3), colors: new Uint8Array(g.length * 4), radii: new Float32Array(g.length) };
  g.forEach((i, k) => {
    glow.positions.set(positions.subarray(3 * i, 3 * i + 3), 3 * k);
    glow.colors.set([colors[4 * i], colors[4 * i + 1], colors[4 * i + 2], Math.round(colors[4 * i + 3] * 0.28)], 4 * k);
    glow.radii[k] = radii[i] * 2.6;
  });
  return { n, positions, colors, radii, glow, top, exact: !!exact, info };
}

const SAT_OF: Partial<Record<Source, string>> = { snpp: "Suomi-NPP · VIIRS", n20: "NOAA-20 · VIIRS", modis: "Terra or Aqua · MODIS", terra: "Terra · MODIS", aqua: "Aqua · MODIS" };
const fmt1 = (v: number) => (v >= 10 ? fmtInt(v) : v.toFixed(1).replace(/\.0$/, ""));
const fmtDeg = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(3)}° ${v >= 0 ? pos : neg}`;

/** What a clicked point stands for: one detection (when, which satellite, its weight) or a grid cell. */
function PointCard({ ref, drawn, i, periodKey, sourceOf, cellKm, onClose }: { ref: React.Ref<HTMLDivElement>; drawn: Drawn; i: number; periodKey: string; sourceOf?: (day: number) => Source | undefined; cellKm: number; onClose: () => void }) {
  const { lon, lat, own, dens, lr, day } = drawn.info;
  const d = day?.[i];
  const src = d ? sourceOf?.(d) : undefined;
  const ratio = 2 ** lr[i];
  const when = d ? `${d} ${monthName(Number(periodKey.slice(5, 7)), "long")} ${periodKey.slice(0, 4)}` : periodKey.length === 4 ? periodKey : fmtYm(periodKey, "long");
  return (
    <div ref={ref} className="point-card" role="dialog" aria-label={t(drawn.exact ? "pt.detection" : "pt.cell")}>
      <div className="point-card-in">
        <div className="point-card-head">
          <span className="eyebrow">{t(drawn.exact ? "pt.detection" : "pt.cell", { km: String(cellKm) })}</span>
          <button type="button" aria-label={t("pt.close")} onClick={onClose}>×</button>
        </div>
        <strong>{when}</strong>
        {src && SAT_OF[src] && <div>{t("pt.seenBy", { sat: SAT_OF[src]! })}</div>}
        <div className="muted num">{fmtDeg(lat[i], "N", "S")}, {fmtDeg(lon[i], "E", "W")}</div>
        <dl className="num">
          {drawn.exact ? (
            <>
              <dt>{t("pt.weight")}</dt>
              <dd>{src === "snpp" || (!src && own[i] === 1) ? t("pt.weightOne") : t(src === "n20" ? "pt.weightN20" : "pt.weightK", { k: fmt1(own[i]) })}</dd>
              <dt>{t("pt.near")}</dt>
              <dd>{fmt1(dens[i])}</dd>
            </>
          ) : (
            <>
              <dt>{t("pt.inCell")}</dt>
              <dd>{fmt1(own[i])}</dd>
            </>
          )}
          <dt>{t("pt.area")}</dt>
          <dd>{lr[i] === 0 ? "—" : `${fmtPctDelta(ratio)} ${t("cal.vsNormal")}`}</dd>
        </dl>
      </div>
    </div>
  );
}

const WORLD_CENTER: [number, number] = [15, 12];
/** Zoom at which the globe's radius (512·2^z / 2π px) fills ~38 % of the smaller side. */
const worldZoom = (m: maplibregl.Map) => {
  const c = m.getContainer();
  return Math.log2((0.38 * Math.min(c.clientWidth, c.clientHeight - 120) * 2 * Math.PI) / 512);
};

export interface GlobeHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

/** A slowly rotating Earth with the period's hotspots and the satellites that recorded them. */
export function FireGlobe(props: {
  points: Points | null;
  /** Detections at their own position (country view, month or day); replaces `points` when set. */
  exact: ExactPoints | null;
  /** Day of month to keep from `exact`, or null for the whole month. */
  day: number | null;
  /** The period's month ("2020-08") or year ("2020"), for the click card. */
  periodKey: string;
  /** Satellite that carried the series on a day of that month, for the click card. */
  sourceOf?: (day: number) => Source | undefined;
  /** Ground size of a grid point, in km, for the click card. */
  cellKm: number;
  cells: Cells | null;
  countries: MonthAll | null;
  method: string;
  metric: Metric;
  region: Region;
  regions: Region[];
  dark: boolean;
  satellites: Sat[];
  onSelectRegion: (id: string) => void;
  onReady?: (h: GlobeHandle) => void;
  /** Called with the 99.9th percentile weight, the number of points and whether they are single detections, for the legend. */
  onScale?: (top: number, n: number, exact: boolean) => void;
}) {
  const { points, exact, day, periodKey, sourceOf, cellKm, cells, countries, method, metric, region, regions, dark, satellites, onSelectRegion, onReady, onScale } = props;
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const overlay = useRef<MapboxOverlay | null>(null);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; id: string } | null>(null);
  const spin = useRef({ on: true, paused: false });
  const labels = useRef<Record<string, HTMLDivElement | null>>({});
  // The point whose card is open (index into drawn.info), and the card element it moves.
  const [pick, setPick] = useState<number | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const pickRef = useRef<{ lon: number; lat: number } | null>(null);
  const byId = useMemo(() => new Map(regions.map((r) => [r.id, r])), [regions]);
  // The last loaded points stay on screen until the next ones arrive (no blank globe while loading).
  const kept = useRef<{ points: Points | null; cells: Cells | null }>({ points: null, cells: null });
  if (points) kept.current.points = points;
  if (cells) kept.current.cells = cells;
  const shownPoints = kept.current.points;
  const shownCells = kept.current.cells;
  const drawn = useMemo(
    () => (shownPoints ? buildPoints(shownPoints, region, shownCells, method, metric, dark, region.kind === "country" ? exact : null, day) : null),
    [shownPoints, region, shownCells, method, metric, dark, exact, day],
  );

  useEffect(() => {
    if (drawn) onScale?.(drawn.top, drawn.n, drawn.exact);
    if (import.meta.env.DEV) Object.assign(window, { __drawn: drawn });
    setPick(null);
    pickRef.current = null;
  }, [drawn, onScale]);
  useEffect(() => {
    if (pick == null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPick(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pick]);

  const countryValue = useMemo(() => {
    const out = new Map<string, { v: number | null; r: number | null; state: string }>();
    if (!countries) return out;
    const v = countries.value[method] ?? [];
    const n = countries.normal[method] ?? [];
    countries.regions.forEach((id, i) => {
      const c = compare(v[i] ?? null, n[i] ?? 0);
      out.set(id, { v: v[i] ?? null, r: c.ratio, state: c.state });
    });
    return out;
  }, [countries, method]);

  // Create the map once.
  useEffect(() => {
    if (!el.current) return;
    setReady(false);
    const m = new maplibregl.Map({
      container: el.current,
      style: baseStyle(dark),
      center: WORLD_CENTER,
      zoom: 1.6,
      minZoom: 0.8,
      maxZoom: 9,
      attributionControl: { compact: true },
    });
    const ov = new MapboxOverlay({ interleaved: true, layers: [], onError: (e) => console.error("deck", e) });
    m.addControl(ov);
    overlay.current = ov;
    // "style.load", not "load": with imagery and a rotating camera there is always a tile
    // in flight, so "load" (which waits for every tile) can take very long to fire.
    let started = false;
    m.once("style.load", async () => {
      const geo = await dataClient.countries();
      m.addSource("countries", { type: "geojson", data: geo, promoteId: "id", attribution: "Hotspots: NASA FIRMS · Boundaries: Natural Earth" });
      // Invisible fill: only there to know which country is under the pointer.
      m.addLayer({ id: "hit", type: "fill", source: "countries", paint: { "fill-color": "#000", "fill-opacity": 0 } });
      m.addLayer({ id: "border", type: "line", source: "countries", paint: { "line-color": "#ffffff", "line-opacity": 0.18, "line-width": 0.5 } });
      m.addLayer({ id: "sel", type: "line", source: "countries", filter: ["==", ["get", "id"], ""], paint: { "line-color": "#ffffff", "line-width": 1.8 } });
      m.jumpTo({ zoom: worldZoom(m) });
      started = true;
      setReady(true);
    });
    map.current = m;
    if (import.meta.env.DEV) Object.assign(window, { __globe: m, __overlay: ov });
    onReady?.({
      zoomIn: () => m.zoomIn(),
      zoomOut: () => m.zoomOut(),
      reset: () => {
        spin.current.on = true;
        m.easeTo({ center: WORLD_CENTER, zoom: worldZoom(m), duration: 900 });
      },
    });

    // Slow rotation: stops for good on drag or zoom, pauses under the pointer.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (started && !reduce && spin.current.on && !spin.current.paused && !m.isMoving()) {
        const c = m.getCenter();
        m.jumpTo({ center: [c.lng + dt * 0.0025, c.lat] });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const stop = () => (spin.current.on = false);
    m.on("dragstart", stop);
    m.on("wheel", stop);
    m.on("touchstart", stop);
    // The container changes size when the side panel opens or widens.
    const ro = new ResizeObserver(() => {
      m.resize();
      if (started && spin.current.on) m.jumpTo({ zoom: worldZoom(m) }); // world view: keep the globe fitted
    });
    ro.observe(el.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      m.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Day / night imagery follows the theme.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    for (const id of ["day", "dayHi"]) m.setLayoutProperty(id, "visibility", dark ? "none" : "visible");
    for (const id of ["night", "nightHi"]) m.setLayoutProperty(id, "visibility", dark ? "visible" : "none");
    m.setPaintProperty("bg", "background-color", dark ? "#04070d" : "#0d2a4a");
  }, [ready, dark]);

  // deck.gl layers: fire points (static) + satellites (animated).
  useEffect(() => {
    const ov = overlay.current;
    if (!ov || !ready) return;
    const fireLayers = drawn
      ? [
          new ScatterplotLayer({
            id: "fire-glow",
            data: { length: drawn.glow.n, attributes: { getPosition: { value: drawn.glow.positions, size: 3 }, getFillColor: { value: drawn.glow.colors, size: 4 }, getRadius: { value: drawn.glow.radii, size: 1 } } },
            radiusUnits: "pixels",
            billboard: true,
            antialiasing: true,
            parameters: { depthWriteEnabled: false },
          }),
          new ScatterplotLayer({
            id: "fires",
            pickable: true,
            data: { length: drawn.n, attributes: { getPosition: { value: drawn.positions, size: 3 }, getFillColor: { value: drawn.colors, size: 4 }, getRadius: { value: drawn.radii, size: 1 } } },
            radiusUnits: "pixels",
            billboard: true,
            antialiasing: true,
            parameters: { depthWriteEnabled: false },
          }),
        ]
      : [];
    const orbits = satellites.map((s) => ({ s, path: orbitPath(s) }));
    type Now = { s: Sat; pos: [number, number, number]; trail: [number, number, number][] };
    const satColor = (s: Sat) => s.color;
    const m = map.current!;
    const t0 = performance.now();
    let raf = 0;
    const frame = () => {
      const sec = (performance.now() - t0) / 1000;
      const now: Now[] = satellites.map((s) => ({ s, ...satPosition(s, sec) }));
      ov.setProps({
        layers: [
          ...fireLayers,
          new PathLayer<(typeof orbits)[number]>({
            id: "orbits",
            data: orbits,
            getPath: (d) => d.path,
            getColor: (d) => [...satColor(d.s), 120],
            getWidth: 1.4,
            widthUnits: "pixels",
          }),
          new PathLayer<Now>({
            id: "trails",
            data: now,
            getPath: (d) => d.trail,
            getColor: (d) => [...satColor(d.s), 200],
            getWidth: 2.5,
            widthUnits: "pixels",
          }),
          new ScatterplotLayer<Now>({
            id: "sats",
            data: now,
            getPosition: (d) => d.pos,
            getFillColor: (d) => [...satColor(d.s), 255],
            getLineColor: [255, 255, 255, 230],
            stroked: true,
            lineWidthMinPixels: 1.5,
            getRadius: 5,
            radiusUnits: "pixels",
            billboard: true,
          }),
        ],
      });
      // Labels are HTML (deck's text is not kept facing the camera on the globe), placed over
      // the point under the satellite; the ~700 km altitude only shifts it by a few pixels.
      const c = m.getCenter();
      now.forEach((d) => {
        const lab = labels.current[d.s.id];
        if (!lab) return;
        const hidden = angleDeg([c.lng, c.lat], [d.pos[0], d.pos[1]]) > 80;
        lab.style.opacity = hidden ? "0" : "1";
        if (!hidden) {
          const p = m.project([d.pos[0], d.pos[1]]);
          lab.style.transform = `translate(${p.x + 12}px, ${p.y - 26}px)`;
        }
      });
      // The open card follows its point as the globe moves.
      const pk = pickRef.current;
      const el2 = card.current;
      if (pk && el2) {
        const p = m.project([pk.lon, pk.lat]);
        el2.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
        el2.style.visibility = angleDeg([c.lng, c.lat], [pk.lon, pk.lat]) > 85 ? "hidden" : "visible";
      }
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [ready, drawn, satellites]);

  // Region: outline and camera.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setFilter("sel", ["==", ["get", "id"], region.kind === "country" ? region.id : ""]);
    const padding = { top: 90, bottom: 110, left: 40, right: 40 };
    if (region.kind === "world") {
      spin.current.on = true;
      m.easeTo({ zoom: worldZoom(m), center: [m.getCenter().lng, WORLD_CENTER[1]], duration: 900 });
    } else {
      spin.current.on = false;
      const [w, s, e, n] = region.bbox;
      if (e - w > 180) m.flyTo({ center: [(w + e) / 2 + 180, (s + n) / 2], zoom: 2.2, duration: 1200 });
      else m.fitBounds([[w, s], [e, n]], { padding, maxZoom: 6, duration: 1200 });
    }
  }, [ready, region]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const at = (e: maplibregl.MapMouseEvent) => m.queryRenderedFeatures(e.point, { layers: ["hit"] })[0]?.properties?.id as string | undefined;
    const move = (e: maplibregl.MapMouseEvent) => {
      // Zoomed on a country, the only cards are those of detections (on click): no country tooltip.
      if (region.kind === "country") {
        setHover(null);
        m.getCanvas().style.cursor = "";
        return;
      }
      const id = at(e);
      m.getCanvas().style.cursor = id && byId.has(id) ? "pointer" : "";
      setHover(id ? { x: e.point.x, y: e.point.y, id } : null);
    };
    const click = (e: maplibregl.MapMouseEvent) => {
      // Zoomed on a country with single detections shown, a click on one opens its card;
      // elsewhere a click picks a country.
      const hit = region.kind === "country" && drawn?.exact ? overlay.current?.pickObject({ x: e.point.x, y: e.point.y, radius: 5, layerIds: ["fires"] }) : null;
      if (hit && hit.index >= 0 && drawn) {
        pickRef.current = { lon: drawn.info.lon[hit.index], lat: drawn.info.lat[hit.index] };
        setPick(hit.index);
        return;
      }
      if (pick != null) {
        setPick(null);
        pickRef.current = null;
        return;
      }
      const id = at(e);
      if (id && byId.has(id) && id !== region.id) onSelectRegion(id);
    };
    const enter = () => (spin.current.paused = true);
    const leave = () => {
      spin.current.paused = false;
      setHover(null);
    };
    m.on("mousemove", move);
    m.on("click", click);
    m.on("mouseover", enter);
    m.on("mouseout", leave);
    return () => {
      m.off("mousemove", move);
      m.off("click", click);
      m.off("mouseover", enter);
      m.off("mouseout", leave);
    };
  }, [ready, byId, onSelectRegion, region, drawn, pick]);

  const h = hover && countryValue.get(hover.id);
  return (
    <div className="globe-wrap absolute inset-0">
      {/* Inline position: maplibre's own .maplibregl-map class would override a utility class. */}
      <div ref={el} style={{ position: "absolute", inset: 0 }} role="img" aria-label={t("map.alt", { region: region.name })} />
      {satellites.map((s) => (
        <div key={s.id} ref={(e) => void (labels.current[s.id] = e)} className="sat-label" style={{ opacity: 0, ["--sat" as string]: `rgb(${s.color.join(",")})` }}>
          <b>{s.name}</b> <span>{s.sensor}</span>
        </div>
      ))}
      {hover && (
        <div className="tooltip num" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{byId.get(hover.id)?.name ?? hover.id}</strong>
          <div>
            {!h || h.v == null
              ? t("state.noData")
              : `${fmtInt(h.v)} · ${h.state === "ok" ? `${fmtPctDelta(h.r)} ${t("cal.vsNormal")}` : h.state === "none" ? t("cal.noneUsual") : t("cal.tooFew")}`}
          </div>
          <div className="muted">{t("map.clickToSelect")}</div>
        </div>
      )}
      {pick != null && drawn?.exact && <PointCard ref={card} drawn={drawn} i={pick} periodKey={periodKey} sourceOf={sourceOf} cellKm={cellKm} onClose={() => { setPick(null); pickRef.current = null; }} />}
      {!points && <div className="globe-loading"><span className="spinner" />{t("state.loading")}</div>}
    </div>
  );
}
