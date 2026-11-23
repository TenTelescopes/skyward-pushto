// Things that come and go: meteor showers (built in, every year), comets and novae (from the weekly highlights feed),
// and the northern lights (NOAA's live Kp forecast, when the phone is online). Build 103.
import * as A from '../vendor/astronomy.mjs';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// ---------------------------------------------------------------- meteor showers
// IMO 2026 Meteor Shower Calendar, Table 5 (working list of visual showers): activity, maximum as solar longitude
// (so it works every year), radiant at maximum, population index r and ZHR. η-Aquariids and S. δ-Aquariids are low
// from Canada but still show up.
export const SHOWERS = [
  { id: 'QUA', name: 'Quadrantids', from: [12, 28], to: [1, 12], peakL: 283.15, ra: 230, dec: 49, v: 41, r: 2.1, zhr: 80, sharp: 0.6 },
  { id: 'LYR', name: 'Lyrids', from: [4, 14], to: [4, 30], peakL: 32.32, ra: 271, dec: 34, v: 49, r: 2.1, zhr: 18, sharp: 1.5 },
  { id: 'ETA', name: 'Eta Aquariids', from: [4, 19], to: [5, 28], peakL: 45.5, ra: 338, dec: -1, v: 66, r: 2.4, zhr: 50, sharp: 5 },
  { id: 'SDA', name: 'Southern Delta Aquariids', from: [7, 12], to: [8, 23], peakL: 128, ra: 340, dec: -16, v: 41, r: 2.5, zhr: 25, sharp: 6 },
  { id: 'PER', name: 'Perseids', from: [7, 17], to: [8, 24], peakL: 140.0, ra: 48, dec: 58, v: 59, r: 2.2, zhr: 100, sharp: 3 },
  { id: 'DRA', name: 'Draconids', from: [10, 6], to: [10, 10], peakL: 195.4, ra: 262, dec: 54, v: 20, r: 2.6, zhr: 5, sharp: 1 },
  { id: 'ORI', name: 'Orionids', from: [10, 2], to: [11, 7], peakL: 208, ra: 95, dec: 16, v: 66, r: 2.5, zhr: 20, sharp: 4 },
  { id: 'STA', name: 'Southern Taurids', from: [9, 20], to: [11, 20], peakL: 223, ra: 52, dec: 15, v: 27, r: 2.3, zhr: 7, sharp: 15 },
  { id: 'NTA', name: 'Northern Taurids', from: [10, 20], to: [12, 10], peakL: 230, ra: 58, dec: 22, v: 29, r: 2.3, zhr: 5, sharp: 15 },
  { id: 'LEO', name: 'Leonids', from: [11, 6], to: [11, 30], peakL: 235.27, ra: 152, dec: 22, v: 71, r: 2.5, zhr: 15, sharp: 2 },
  { id: 'GEM', name: 'Geminids', from: [12, 4], to: [12, 20], peakL: 262.2, ra: 112, dec: 33, v: 35, r: 2.6, zhr: 150, sharp: 2 },
  { id: 'URS', name: 'Ursids', from: [12, 17], to: [12, 26], peakL: 270.7, ra: 217, dec: 76, v: 33, r: 2.8, zhr: 10, sharp: 1 },
];

const sunLon = (date) => A.SunPosition(A.MakeTime(date)).elon;          // apparent ecliptic longitude of the Sun, degrees
const inWindow = (date, from, to) => {
  const md = (date.getMonth() + 1) * 100 + date.getDate(), a = from[0] * 100 + from[1], b = to[0] * 100 + to[1];
  return a <= b ? md >= a && md <= b : md >= a || md <= b;               // windows can run over New Year (Quadrantids)
};

/** Showers active on the night of `date`: { ...shower, daysFromPeak, zhrNow } (ZHR falls off away from the peak). */
export function activeShowers(date = new Date()) {
  const L = sunLon(date), out = [];
  for (const s of SHOWERS) {
    if (!inWindow(date, s.from, s.to)) continue;
    let dL = L - s.peakL; dL = ((dL + 540) % 360) - 180;                  // degrees of solar longitude ≈ days
    const days = dL / 0.9856;
    // A simple two-sided exponential profile: full ZHR at the peak, about a tenth `sharp`·2.3 days away.
    const zhrNow = Math.max(1, s.zhr * Math.exp(-Math.abs(days) / s.sharp));
    out.push({ ...s, daysFromPeak: days, zhrNow });
  }
  return out;
}

/** Meteors per hour one observer might see: ZHR × sin(radiant altitude) ÷ r^(6.5 − limiting magnitude). */
export function hourlyRate(zhr, radiantAlt, r, nelm) {
  if (radiantAlt <= 0) return 0;
  return zhr * Math.sin(radiantAlt * D2R) / r ** Math.max(0, 6.5 - nelm);
}

// ---------------------------------------------------------------- comets (and other moving things) from orbits
const K_GAUSS = 0.01720209895;                       // radians per day
const OBL = 23.4392911 * D2R;                        // J2000 obliquity: ecliptic → equatorial

/** Julian date (TT ≈ UTC here; the difference is about a minute of comet motion at most). */
const jd = (date) => date.getTime() / 864e5 + 2440587.5;
/** "2026-02-13.25", an ISO time, or a Julian date number → Julian date. */
export function toJd(t) {
  if (typeof t === 'number') return t > 1e6 ? t : null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(\.\d+)?$/.exec(String(t || ''));
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 + 2440587.5 + (m[4] ? parseFloat(m[4]) : 0);
  const ms = Date.parse(t); return Number.isNaN(ms) ? null : ms / 864e5 + 2440587.5;
}

/** Heliocentric position (AU, ecliptic J2000) and distance r from perihelion elements, at Julian date `t`. */
export function orbitPos(el, t) {
  const q = el.q, e = el.e, dt = t - el.tpJd;
  let x, y, r;
  if (Math.abs(e - 1) < 1e-8) {                                        // parabola: Barker's equation
    const W = 3 * K_GAUSS / Math.sqrt(2 * q ** 3) * dt, Y = Math.cbrt(W / 2 + Math.sqrt(W * W / 4 + 1));
    const s = Y - 1 / Y; x = q * (1 - s * s); y = 2 * q * s; r = q * (1 + s * s);
  } else if (e < 1) {                                                    // ellipse: Kepler's equation
    const a = q / (1 - e), M = K_GAUSS / Math.pow(a, 1.5) * dt;
    let Mm = M % (2 * Math.PI); if (Mm > Math.PI) Mm -= 2 * Math.PI; if (Mm < -Math.PI) Mm += 2 * Math.PI;
    let E = e > 0.8 ? Math.sign(Mm) * Math.PI * 0.85 || 0.1 : Mm;
    for (let i = 0; i < 60; i++) { const f = E - e * Math.sin(E) - Mm, d = f / (1 - e * Math.cos(E)); E -= Math.max(-0.5, Math.min(0.5, d)); if (Math.abs(d) < 1e-13) break; }
    x = a * (Math.cos(E) - e); y = a * Math.sqrt(1 - e * e) * Math.sin(E); r = a * (1 - e * Math.cos(E));
  } else {                                                               // hyperbola
    const a = q / (e - 1), M = K_GAUSS / Math.pow(a, 1.5) * dt;
    let H = Math.asinh(M / e);
    for (let i = 0; i < 80; i++) { const f = e * Math.sinh(H) - H - M, d = f / (e * Math.cosh(H) - 1); H -= Math.max(-1, Math.min(1, d)); if (Math.abs(d) < 1e-13) break; }
    x = a * (e - Math.cosh(H)); y = a * Math.sqrt(e * e - 1) * Math.sinh(H); r = a * (e * Math.cosh(H) - 1);
  }
  // orbital plane → ecliptic: rotate by ω (argument of perihelion), i, Ω
  const w = el.peri * D2R, I = el.i * D2R, N = el.node * D2R;
  const cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(I), si = Math.sin(I), cN = Math.cos(N), sN = Math.sin(N);
  const X = (cN * cw - sN * sw * ci) * x + (-cN * sw - sN * cw * ci) * y;
  const Y = (sN * cw + cN * sw * ci) * x + (-sN * sw + cN * cw * ci) * y;
  const Z = (sw * si) * x + (cw * si) * y;
  return { x: X, y: Y, z: Z, r };
}

/** Geocentric J2000 RA/Dec (degrees), distances and magnitude of an orbit at `date`. */
export function orbitRaDec(el, date = new Date()) {
  const t = jd(date);
  const ev = A.HelioVector(A.Body.Earth, A.MakeTime(date));              // Earth, AU, J2000 equatorial
  let p, gx, gy, gz, delta = 1;
  for (let k = 0; k < 2; k++) {                                          // one light-time iteration
    p = orbitPos(el, t - delta / 173.1446);
    const ex = p.x, ey = p.y * Math.cos(OBL) - p.z * Math.sin(OBL), ez = p.y * Math.sin(OBL) + p.z * Math.cos(OBL);
    gx = ex - ev.x; gy = ey - ev.y; gz = ez - ev.z; delta = Math.hypot(gx, gy, gz);
  }
  const ra = (Math.atan2(gy, gx) * R2D + 360) % 360, dec = Math.asin(gz / delta) * R2D;
  const mag = el.H != null ? el.H + 5 * Math.log10(delta) + (el.k ?? 10) * Math.log10(p.r) : null;
  return { ra, dec, r: p.r, delta, mag };
}

/** Turn the feed's comets and novae into app objects (the same shape as catalogue objects). */
export function feedObjects(feed) {
  const out = [];
  for (const c of (feed && feed.comets) || []) {
    const tpJd = toJd(c.tp); if (!tpJd || !(c.q > 0) || c.e == null) continue;
    out.push({ id: c.id, key: 'cm:' + c.id, label: c.name || c.id, name: c.name || c.id, sub: c.name && c.name !== c.id ? c.id : 'Comet', t: 'CM', type: 'Comet', cats: ['Comets'], comet: true,
      orbit: { q: +c.q, e: +c.e, i: +c.i, node: +c.node, peri: +c.peri, tpJd, H: c.H != null ? +c.H : null, k: c.k != null ? +c.k : 10 },
      maj: c.coma || 5, min: c.coma || 5, note: c.note || '', source: c.source || '' });
  }
  for (const n of (feed && feed.fixed) || []) {
    if (n.ra == null || n.dec == null) continue;
    const ra = +n.ra, dec = +n.dec;
    out.push({ id: n.id, key: 'tr:' + n.id, label: n.name || n.id, name: n.name || n.id, sub: n.kind || 'Transient', t: 'TR', type: n.kind || 'Transient', cats: ['Transients'],
      ra, dec, mag: n.mag != null ? +n.mag : null, note: n.note || '', source: n.source || '' });   // the app adds its sky vector
  }
  return out;
}

// ---------------------------------------------------------------- northern lights
// NOAA SWPC planetary K-index forecast (3-hour blocks, about 3 days). Online only; null when unreachable.
let kpCache = null, kpAt = 0;
export async function loadKp() {
  if (kpCache && Date.now() - kpAt < 30 * 60e3) return kpCache;
  try {
    const r = await fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json', { cache: 'no-cache' });
    if (!r.ok) return kpCache;
    const rows = await r.json(), list = [];
    for (const row of rows) {
      if (Array.isArray(row)) { if (row[0] === 'time_tag') continue; list.push({ t: Date.parse(row[0].replace(' ', 'T') + 'Z'), kp: +row[1], kind: row[2] }); }
      else if (row && row.time_tag) list.push({ t: Date.parse(String(row.time_tag).replace(' ', 'T') + (/Z$/.test(row.time_tag) ? '' : 'Z')), kp: +row.kp, kind: row.observed });
    }
    kpCache = list.filter((x) => !Number.isNaN(x.t) && !Number.isNaN(x.kp)); kpAt = Date.now();
  } catch (e) { /* offline, or NOAA unreachable */ }
  return kpCache;
}
/** Kp for the 3-hour block containing `date` (null when unknown). */
export function kpAt3h(list, date = new Date()) {
  if (!list) return null; const t = date.getTime();
  const row = list.find((x) => t >= x.t && t < x.t + 3 * 3600e3); return row ? row.kp : null;
}
/** Geomagnetic latitude (dipole; north geomagnetic pole near 80.8° N, 72.6° W in 2025). */
export function geomagLat(lat, lon) {
  const pl = 80.8 * D2R, pn = -72.6 * D2R, a = lat * D2R, b = lon * D2R;
  return Math.asin(Math.sin(a) * Math.sin(pl) + Math.cos(a) * Math.cos(pl) * Math.cos(b - pn)) * R2D;
}
/**
 * Can aurora be seen from here at this Kp? The auroral oval's equatorward edge at local midnight sits near
 * 66.5° − 2.05·Kp geomagnetic latitude (the usual table: Kp 5 → 56.3°, Kp 7 → 52.2°), and NOAA's viewing tips say it
 * is easily seen when that edge is 4–5° poleward of you. Returns null, or { kp, height }: roughly how high up the
 * northern sky it may reach, in degrees (a guide, not a forecast of the display).
 */
export function auroraView(kp, lat, lon) {
  if (kp == null) return null;
  const g = geomagLat(lat, lon), edge = 66.5 - 2.05 * kp;
  if (g < edge - 5) return null;
  return { kp, height: Math.min(80, 5 + (g - (edge - 5)) * 9) };
}
