// Shapes of the static files in /data/ — see docs/web-data-contract.md.

export type MethodKey = string; // "<id>@<version>"
export type Source = "snpp" | "n20" | "modis" | "terra" | "aqua" | "none";

export interface Scores {
  world: number;
  country: number;
  cell: number;
}

export interface Method {
  key: MethodKey;
  id: string;
  version: string;
  name: string;
  status: "shipped" | "baseline" | "experimental";
  summary: string;
  params: Record<string, unknown>;
  scores: { holdout: Scores | null; junction: Scores | null };
}

export interface Region {
  id: string;
  name: string;
  kind: "world" | "country";
  bbox: [number, number, number, number];
}

export interface Manifest {
  generatedAt: string;
  firstMonth: string;
  lastMonth: string;
  normalYears: [number, number];
  defaultMethod: MethodKey;
  methods: Method[];
  regions: Region[];
}

export interface Series {
  region: string;
  months: string[];
  days: number[];
  gapDays: number[];
  modis: (number | null)[];
  viirs: (number | null)[];
  n20: (number | null)[];
  harmonized: Record<MethodKey, (number | null)[]>;
  sourceDays: Record<Source, number[]>;
}

export interface Daily {
  region: string;
  year: number;
  start: string;
  source: Source[];
  modis: (number | null)[];
  viirs: (number | null)[];
  harmonized: Record<MethodKey, (number | null)[]>;
}

export interface Cells {
  ym: string;
  deg: number;
  lat: number[];
  lon: number[];
  harmonized: Record<MethodKey, number[]>;
  normal: Record<MethodKey, number[]>;
}

export interface MonthAll {
  ym: string;
  regions: string[];
  value: Record<MethodKey, (number | null)[]>;
  normal: Record<MethodKey, (number | null)[]>;
}

export interface Land {
  deg: number;
  lat: number[];
  lon: number[];
  region: number[];
}

export interface Band {
  predicted_from: number;
  n: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface Uncertainty {
  error_bands_country_month: Band[];
  anomaly_agreement?: { spearman: number; same_class_pct: number };
}

export interface Outage {
  satellite: "terra" | "aqua" | "snpp" | "n20";
  from: string;
  to: string;
}

/** Which raw or harmonized series the user is looking at. */
export type SeriesKind = "harmonized" | "modis" | "viirs";

/** Hotspots summed on a fine grid (points/{YYYY-MM}.bin or points/{YYYY}.bin), VIIRS-equivalent weights. */
export interface Points {
  key: string;
  deg: number;
  lon: Float32Array;
  lat: Float32Array;
  w: Uint16Array;
}

/** Every detection of a month inside a box, at its own position (pixel centre). */
export interface ExactPoints {
  key: string;
  lon: Float32Array;
  lat: Float32Array;
  /** VIIRS-equivalent weight of the detection: 1 for Suomi-NPP, the 1° cell factor otherwise. */
  w: Float32Array;
  /** Day of month, 1..31. */
  day: Uint8Array;
}
