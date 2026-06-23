// TS port of demo_data.py: the seeded synthetic series + the asset geometries.
// Numpy's RNG can't be reproduced bit-for-bit, so we use a small seeded PRNG;
// the *shapes* (lulls/gusts, daily solar bell, battery cycle, forecast fan-out)
// match. 72 hourly points from 2026-01-01. Timestamps are naive-UTC ISO strings
// ("YYYY-MM-DDTHH:MM:SS"), matching the strftime format the read queries emit.

export const PERIODS = 72;
const START_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

export interface Point {
  t: string; // valid_time, ISO naive-UTC
  v: number; // value
}

export function isoHour(i: number): string {
  return new Date(START_MS + i * 3_600_000).toISOString().slice(0, 19);
}

// --- seeded PRNG (mulberry32) + gaussian -----------------------------------
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r: () => number, mu = 0, sigma = 1): number {
  const u = Math.max(r(), 1e-12);
  const v = r();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clip = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const hod = (i: number) => i % 24;
const frame = (vals: number[]): Point[] => vals.map((v, i) => ({ t: isoHour(i), v: round3(v) }));

// --- capacity-factor random walk (lulls + gusts) ---------------------------
function windCf(seed = 2): number[] {
  const r = rng(seed);
  const cf = new Array<number>(PERIODS);
  cf[0] = 0.5;
  for (let i = 1; i < PERIODS; i++) {
    cf[i] = clip(0.92 * cf[i - 1] + 0.08 * 0.5 + gauss(r, 0, 0.025), 0, 1);
  }
  return cf;
}

export const windPower = (capacity = 3.5, seed = 2): Point[] =>
  frame(windCf(seed).map((c) => capacity * c));

export const windSpeed = (seed = 2): Point[] =>
  frame(windCf(seed).map((c) => 3.0 + 9.0 * Math.cbrt(c)));

export function solarPower(capacity = 10, seed = 1): Point[] {
  const r = rng(seed);
  return frame(
    Array.from({ length: PERIODS }, (_, i) => {
      const bell = clip(Math.sin((Math.PI * (hod(i) - 6)) / 12), 0, Infinity);
      const clouds = 0.8 + 0.2 * r();
      return clip(capacity * bell * clouds, 0, capacity);
    }),
  );
}

function batterySocVals(seed = 3): number[] {
  const r = rng(seed);
  return Array.from({ length: PERIODS }, (_, i) => {
    const soc = 55 + 30 * Math.sin((2 * Math.PI * (hod(i) - 15)) / 24);
    return clip(soc + gauss(r, 0, 1.5), 5, 99);
  });
}
export const batterySoc = (seed = 3): Point[] => frame(batterySocVals(seed));

export function batteryPower(seed = 3): Point[] {
  const soc = batterySocVals(seed);
  return frame(soc.map((s, i) => (i === 0 ? 0 : (s - soc[i - 1]) * 5.0)));
}

// --- forecast revisions: bounded windows that start + end inside the timeline
export const FORECAST_HORIZON_H = 36;
export const FORECAST_REVISIONS: [number, number][] = [
  [0, 0.34],
  [8, 0.27],
  [16, 0.2],
  [24, 0.14],
  [32, 0.09],
  [40, 0.05],
];

export function windPowerForecast(
  capacity = 3.5,
  issuedAtH = 0,
  error = 0.15,
  horizonH = FORECAST_HORIZON_H,
  seed = 2,
): Point[] {
  const truth = windCf(seed).map((c) => capacity * c);
  const end = Math.min(issuedAtH + horizonH, PERIODS);
  const r = rng(200 + issuedAtH);
  const phase = r() * 2 * Math.PI;
  const sign = r() < 0.5 ? 1 : -1;
  const out: Point[] = [];
  for (let idx = issuedAtH; idx < end; idx++) {
    const lead = idx - issuedAtH;
    const growth = lead / Math.max(horizonH, 1);
    const wave = Math.sin((2 * Math.PI * lead) / 52.0 + phase);
    const dev = sign * error * growth * wave;
    out.push({ t: isoHour(idx), v: round3(clip(truth[idx] + capacity * dev, 0, capacity)) });
  }
  return out;
}

// --- geometries (GeoJSON), from demo_data.py -------------------------------
type GeoJSON = Record<string, unknown>;
const poly = (ring: [number, number][]): GeoJSON => ({
  type: "Polygon",
  coordinates: [[...ring, ring[0]]],
});
const line = (pts: [number, number][]): GeoJSON => ({ type: "LineString", coordinates: pts });

export const OFFSHORE_AREA = poly([
  [12.893, 55.783], [12.92, 55.783], [12.92, 55.792], [12.893, 55.792],
]);
// DC link from the PV system (PV01) to the battery (B01) at Solar-Farm-1.
export const SOLAR_CABLE = line([
  [12.94151, 55.77887], [12.9435, 55.7805],
]);
export const OFFSHORE2_AREA = poly([
  [12.892, 55.8], [12.919, 55.8], [12.919, 55.81], [12.892, 55.81],
]);
export const SOLAR_FARM_AREA = poly([
  [12.937, 55.7765], [12.946, 55.7765], [12.946, 55.7815], [12.937, 55.7815],
]);
export const PV_ARRAY_AREA = poly([
  [12.9405, 55.7783], [12.9445, 55.7783], [12.9445, 55.7798], [12.9405, 55.7798],
]);
