// Blocked sky: how high the trees, roofs and hills reach in each direction at the observing spot.
// A horizon is { h: [72 heights in degrees, one per 5° of azimuth], lat, lon, when, how: 'taps' | 'trace' }.
// Pure functions only, so they can be unit-tested in Node.

export const BINS = 72, BIN = 360 / BINS;
export const WEDGES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Tap levels for the quick method: clear, low things, tall things, nothing usable. */
export const LEVELS = [
  { alt: 0, name: 'Clear' },
  { alt: 15, name: 'Low — below 15°' },
  { alt: 30, name: 'Tall — below 30°' },
  { alt: 50, name: 'Very tall — below 50°' },
  { alt: 90, name: 'Blocked' },
];
const w360 = (a) => ((a % 360) + 360) % 360;
const clampAlt = (a) => Math.max(0, Math.min(90, a));
const binOf = (az) => Math.floor(w360(az) / BIN) % BINS;
const centre = (i) => (i + 0.5) * BIN;
const wedgeOfBin = (i) => Math.round(centre(i) / 45) % 8;

export const emptyHorizon = () => ({ h: new Array(BINS).fill(0), how: 'taps' });
export const hasHorizon = (H) => !!(H && H.h && H.h.some((v) => v > 0));

/** Lowest usable altitude toward `az`, interpolated between bins. 0 when nothing is marked. */
export function limitAt(H, az) {
  if (!H || !H.h) return 0;
  const x = w360(az) / BIN - 0.5, i = Math.floor(x), f = x - i;
  const a = H.h[((i % BINS) + BINS) % BINS], b = H.h[(((i + 1) % BINS) + BINS) % BINS];
  return a + (b - a) * f;
}
/** Is a point at (alt, az) hidden? `pad` degrees of margin keeps targets from grazing the treetops. */
export const blocked = (H, alt, az, pad = 0) => hasHorizon(H) && alt < Math.min(90, limitAt(H, az) + pad);

/** Quick method: set one of the eight compass wedges to a tap level. */
export function setWedge(H, k, level) {
  const h = H.h.slice();
  for (let i = 0; i < BINS; i++) if (wedgeOfBin(i) === k) h[i] = LEVELS[level].alt;
  return { ...H, h, how: H.how === 'trace' ? 'trace' : 'taps' };
}
/** Tap level a wedge currently shows (nearest level to its typical height). */
export function wedgeLevel(H, k) {
  const v = []; for (let i = 0; i < BINS; i++) if (wedgeOfBin(i) === k) v.push(H.h[i]);
  v.sort((a, b) => a - b); const med = v[Math.floor(v.length / 2)];
  let best = 0; LEVELS.forEach((L, i) => { if (Math.abs(L.alt - med) < Math.abs(LEVELS[best].alt - med)) best = i; });
  return best;
}
export const wedgeHeight = (H, k) => { const v = []; for (let i = 0; i < BINS; i++) if (wedgeOfBin(i) === k) v.push(H.h[i]); return v.reduce((a, b) => a + b, 0) / v.length; };

/** Trace method: follow the skyline with the scope (or the phone); each sample is where the sky starts in that direction. */
export const newTrace = () => ({ sum: new Array(BINS).fill(0), n: new Array(BINS).fill(0) });
export function traceAdd(T, alt, az) {
  if (alt == null || az == null || isNaN(alt) || isNaN(az)) return T;
  const i = binOf(az); T.sum[i] += clampAlt(alt); T.n[i]++; return T;
}
export const traceCoverage = (T) => T.n.filter((n) => n > 0).length / BINS;
/**
 * Turn a trace into a horizon. Directions that were swept get their average height; gaps are bridged from the swept
 * directions on either side (straight line), and anything not swept keeps what `prev` had when nothing at all was traced.
 */
export function traceFinish(T, prev = null) {
  const got = T.n.map((n, i) => (n > 0 ? T.sum[i] / n : null));
  if (!got.some((v) => v != null)) return prev || emptyHorizon();
  const h = got.slice();
  for (let i = 0; i < BINS; i++) {
    if (h[i] != null) continue;
    let a = 1, b = 1; while (got[(i - a + BINS) % BINS] == null) a++; while (got[(i + b) % BINS] == null) b++;
    const va = got[(i - a + BINS) % BINS], vb = got[(i + b) % BINS];
    h[i] = va + (vb - va) * a / (a + b);
  }
  return { h: h.map((v) => Math.round(clampAlt(v) * 10) / 10), how: 'trace' };
}
/** One short line for menus: "Blocked below 30° to the N and NE". */
export function summary(H) {
  if (!hasHorizon(H)) return '';
  const all = WEDGES.map((w, k) => ({ w, k, a: wedgeHeight(H, k) })), max = Math.max(...all.map((x) => x.a));
  if (max < 8) return 'Only low obstructions marked';
  const tall = all.filter((x) => x.a >= Math.max(8, max * 0.6));
  const names = tall.length > 4 ? `${tall.length} directions` : tall.map((x) => x.w).join(', ');
  return `Blocked up to ${Math.round(max)}° toward ${names}`;
}
