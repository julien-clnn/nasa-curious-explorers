// The satellites behind the record, drawn in orbit around the globe.
// Orbits are simplified but to scale: sun-synchronous, ~98° inclination, real altitudes.
// Time is sped up (one orbit in ORBIT_SECONDS) so the motion is visible.

export type SatId = "terra" | "aqua" | "snpp" | "n20";

export interface Sat {
  id: SatId;
  name: string;
  sensor: "MODIS" | "VIIRS";
  /** First and last month of data used by the series ("YYYY-MM"); null = still flying. */
  from: string;
  to: string | null;
  altitudeKm: number;
  inclinationDeg: number;
  /** Equator crossing local time (h), sets the orbit plane relative to the others. */
  crossingHour: number;
  /** Position along the orbit at t = 0, in degrees (spreads satellites sharing a plane). */
  phaseDeg: number;
  /** Display colour, kept away from the fire scale. */
  color: [number, number, number];
}

export const SATELLITES: Sat[] = [
  { id: "terra", name: "Terra", sensor: "MODIS", from: "2000-11", to: null, altitudeKm: 705, inclinationDeg: 98.2, crossingHour: 10.5, phaseDeg: 0, color: [140, 200, 255] },
  { id: "aqua", name: "Aqua", sensor: "MODIS", from: "2002-07", to: null, altitudeKm: 705, inclinationDeg: 98.2, crossingHour: 13.5, phaseDeg: 140, color: [94, 234, 212] },
  { id: "snpp", name: "Suomi-NPP", sensor: "VIIRS", from: "2012-01", to: "2026-11", altitudeKm: 824, inclinationDeg: 98.7, crossingHour: 13.5, phaseDeg: 230, color: [196, 181, 253] },
  { id: "n20", name: "NOAA-20", sensor: "VIIRS", from: "2018-01", to: null, altitudeKm: 824, inclinationDeg: 98.7, crossingHour: 13.5, phaseDeg: 50, color: [240, 171, 252] },
];

/** Satellites that were delivering data at some point of the period (prefix "2020" or "2020-08"). */
export function activeSatellites(firstYm: string, lastYm: string): Sat[] {
  return SATELLITES.filter((s) => s.from <= lastYm && (s.to == null || s.to >= firstYm));
}

export const ORBIT_SECONDS = 50;

const rad = Math.PI / 180;

/** [lon, lat, altitude m] at orbital angle u (deg). */
function at(s: Sat, u: number): [number, number, number] {
  const i = s.inclinationDeg * rad;
  const raan = (s.crossingHour - 12) * 15 * rad; // plane turned by its local crossing time
  const a = u * rad;
  const x = Math.cos(raan) * Math.cos(a) - Math.sin(raan) * Math.sin(a) * Math.cos(i);
  const y = Math.sin(raan) * Math.cos(a) + Math.cos(raan) * Math.sin(a) * Math.cos(i);
  const z = Math.sin(a) * Math.sin(i);
  return [Math.atan2(y, x) / rad, Math.asin(z) / rad, s.altitudeKm * 1000];
}

/**
 * Longitudes made continuous (179 -> 181, not 179 -> -179): a path segment is drawn between
 * its two longitudes, so a jump across ±180° near the pole would draw a ring around it.
 */
function unwrap(path: [number, number, number][]) {
  for (let k = 1; k < path.length; k++) {
    const d = path[k][0] - path[k - 1][0];
    path[k][0] -= 360 * Math.round(d / 360);
  }
  return path;
}

/** The orbit as a closed path (in the globe's frame: the Earth's own rotation is left out). */
export function orbitPath(s: Sat, steps = 360): [number, number, number][] {
  return unwrap(Array.from({ length: steps + 1 }, (_, k) => at(s, (360 * k) / steps)));
}

/** Where the satellite is `seconds` after load, plus a short trail behind it. */
export function satPosition(s: Sat, seconds: number) {
  const u = s.phaseDeg + (360 * seconds) / ORBIT_SECONDS;
  return { pos: at(s, u), trail: unwrap(Array.from({ length: 16 }, (_, k) => at(s, u - k * 1.2)).reverse()) };
}

/** Great-circle angle (deg) between two lon/lat points: above ~85° from the view centre a satellite is behind the Earth. */
export function angleDeg(a: [number, number], b: [number, number]) {
  const [l1, p1, l2, p2] = [a[0] * rad, a[1] * rad, b[0] * rad, b[1] * rad];
  return Math.acos(Math.min(1, Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(l1 - l2))) / rad;
}
