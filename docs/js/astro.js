// Sky positions, computed entirely on-device with Astronomy Engine (MIT, Don Cross).
import * as A from '../vendor/astronomy.mjs';
import { DSO, DOUBLES, STARS, FIELD, LINES, ASTERISMS } from '../data/catalog.js';

export const PLANETS = ['Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];

const TYPE_LABEL = { OC: 'Open cluster', GC: 'Globular', PN: 'Planetary', GX: 'Galaxy', NB: 'Nebula', DN: 'Dark nebula', CN: 'Cluster+neb', AS: 'Asterism', DS: 'Double', ST: 'Star', PL: 'Planet', OT: 'Other' };
export const typeLabel = (t) => TYPE_LABEL[t] || t;

function j2000Vec(raDeg, decDeg) {
  return A.VectorFromSphere(new A.Spherical(decDeg, raDeg, 1), A.MakeTime(new Date(Date.UTC(2000, 0, 1, 12))));
}

/** Build the unified, searchable object list. */
export function buildObjects() {
  const out = [];
  for (const o of DSO) {
    const primary = o.cats.find((c) => /^M\d/.test(c)) || o.cats.find((c) => /^C\d/.test(c)) || o.id;
    const label = primary.startsWith('C') && /^C\d/.test(primary) ? `Caldwell ${primary.slice(1)}` : primary;
    out.push({ ...o, key: 'dso:' + o.id, label, sub: [label !== o.id ? o.id : null, o.name].filter(Boolean).join(' · '), v: j2000Vec(o.ra, o.dec) });
  }
  for (const o of DOUBLES) out.push({ ...o, key: 'ds:' + o.id, label: o.id, sub: [o.wds, o.sep ? `${o.sep}″` : null].filter(Boolean).join(' · '), v: j2000Vec(o.ra, o.dec) });
  for (const a of ASTERISMS) out.push({ ...a, key: 'as:' + a.id, label: a.id, sub: 'Asterism', v: j2000Vec(a.ra, a.dec) });
  for (const s of STARS) out.push({ ...s, key: 'st:' + s.id, label: s.id, sub: s.bayer, cats: ['Star'], v: j2000Vec(s.ra, s.dec) });
  for (const p of PLANETS) out.push({ id: p, key: 'pl:' + p, label: p, sub: p === 'Moon' ? 'Moon' : 'Planet', t: 'PL', type: 'Planet', cats: ['Planets'], planet: true });
  return out;
}

// Precomputed J2000 unit vectors for the field stars
const FIELD_N = FIELD.length / 3, FV = new Float64Array(FIELD.length);
for (let i = 0; i < FIELD_N; i++) {
  const ra = FIELD[3 * i] * Math.PI / 180, de = FIELD[3 * i + 1] * Math.PI / 180;
  FV[3 * i] = Math.cos(de) * Math.cos(ra); FV[3 * i + 1] = Math.cos(de) * Math.sin(ra); FV[3 * i + 2] = Math.sin(de);
}
const LINE_STARS = new Set(LINES.flatMap(([, seg]) => seg));
export { LINES };

export class Sky {
  constructor() { this.lat = 43.65; this.lon = -79.38; this.elev = 100; this.objects = buildObjects(); this.stars = this.objects.filter((o) => o.key.startsWith('st:')); }
  setSite(lat, lon, elev = 0) { this.lat = lat; this.lon = lon; this.elev = elev; this.rotT = 0; }
  observer() { return new A.Observer(this.lat, this.lon, this.elev); }
  _rot(date) {
    const ms = date.getTime();
    if (!this.rot || Math.abs(ms - this.rotT) > 500) { this.rot = A.Rotation_EQJ_HOR(A.MakeTime(date), this.observer()); this.rotT = ms; }
    return this.rot;
  }
  /** Apparent (refracted) alt/az of an object at `date`. */
  altAz(o, date = new Date()) {
    if (o.planet) {
      const t = A.MakeTime(date), obs = this.observer();
      const eq = A.Equator(o.id, t, obs, true, true);
      const h = A.Horizon(t, obs, eq.ra, eq.dec, 'normal');
      let mag = null; try { mag = A.Illumination(o.id, t).mag; } catch (e) { /* Moon mag available too */ }
      o.mag = mag;
      return { alt: h.altitude, az: h.azimuth };
    }
    const v = A.RotateVector(this._rot(date), o.v);
    const s = A.HorizonFromVector(v, 'normal');
    return { alt: s.lat, az: s.lon };
  }
  /**
   * Field stars and constellation-line stars within `radius` degrees of an apparent alt/az.
   * Returns Map(index -> {alt, az, mag}). Line stars are included regardless of magLim so figures stay whole.
   */
  fieldNear(alt, az, radius, magLim, date = new Date()) {
    const R = this._rot(date).rot, D = Math.PI / 180;
    const ca = Math.cos(alt * D), h = [ca * Math.cos(az * D), -ca * Math.sin(az * D), Math.sin(alt * D)]; // AE horizon frame: x=N, y=W, z=up
    const c = [0, 1, 2].map((j) => R[j][0] * h[0] + R[j][1] * h[1] + R[j][2] * h[2]);                    // back to J2000 equatorial
    const cosLim = Math.cos(Math.min(89, radius) * D), out = new Map();
    for (let i = 0; i < FIELD_N; i++) {
      const mag = FIELD[3 * i + 2];
      if (mag > magLim && !LINE_STARS.has(i)) continue;
      const x = FV[3 * i], y = FV[3 * i + 1], z = FV[3 * i + 2];
      if (x * c[0] + y * c[1] + z * c[2] < cosLim) continue;
      const hx = R[0][0] * x + R[1][0] * y + R[2][0] * z, hy = R[0][1] * x + R[1][1] * y + R[2][1] * z, hz = R[0][2] * x + R[1][2] * y + R[2][2] * z;
      let a = Math.asin(Math.max(-1, Math.min(1, hz))) / D; a += A.Refraction('normal', a);
      out.set(i, { alt: a, az: (Math.atan2(-hy, hx) / D + 360) % 360, mag });
    }
    return out;
  }
  /** Current position for every object (used for lists). */
  updateAll(date = new Date()) { for (const o of this.objects) { const p = this.altAz(o, date); o.alt = p.alt; o.az = p.az; } }
  /** Apparent alt/az of an arbitrary J2000 RA/Dec (degrees). */
  altAzRaDec(ra, dec, date = new Date()) { const s = A.HorizonFromVector(A.RotateVector(this._rot(date), j2000Vec(ra, dec)), 'normal'); return { alt: s.lat, az: s.lon }; }
  /** Apparent angular diameter (arcmin) of a planet or the Moon, from its equatorial radius and current distance. */
  diameter(body, date = new Date()) {
    const R = { Moon: 1737.4, Mercury: 2439.7, Venus: 6051.8, Mars: 3396.2, Jupiter: 71492, Saturn: 60268, Uranus: 25559, Neptune: 24764 }[body]; if (!R) return null;
    const t = A.MakeTime(date), obs = this.observer(); const eq = A.Equator(body, t, obs, true, true);
    return 2 * Math.atan(R / (eq.dist * 149597870.7)) * 180 / Math.PI * 60;
  }
  /** Moon altitude (deg) and illuminated fraction (0–1). */
  moonInfo(date = new Date()) {
    const t = A.MakeTime(date), obs = this.observer(); const eq = A.Equator('Moon', t, obs, true, true);
    const h = A.Horizon(t, obs, eq.ra, eq.dec, 'normal'); return { alt: h.altitude, az: h.azimuth, frac: A.Illumination('Moon', t).phase_fraction };
  }
  /**
   * Evening/morning Sun events for the night that starts on the local calendar day of `day`:
   * sunset, end of nautical (−12°) and astronomical (−18°) twilight, and the morning equivalents. Null where they don't happen.
   */
  night(day = new Date()) {
    const noon = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12), obs = this.observer(), t0 = A.MakeTime(noon);
    const d = (x) => (x ? x.date : null);
    const set = d(A.SearchRiseSet('Sun', obs, -1, t0, 1));
    const naut = d(A.SearchAltitude('Sun', obs, -1, t0, 1, -12)), astro = d(A.SearchAltitude('Sun', obs, -1, t0, 1, -18));
    const astroAm = d(A.SearchAltitude('Sun', obs, +1, t0, 1.5, -18)), nautAm = d(A.SearchAltitude('Sun', obs, +1, t0, 1.5, -12));
    const rise = d(A.SearchRiseSet('Sun', obs, +1, t0, 1.5));
    const mrise = d(A.SearchRiseSet('Moon', obs, +1, t0, 1)), mset = d(A.SearchRiseSet('Moon', obs, -1, t0, 1));
    return { set, naut, astro, astroAm, nautAm, rise, moonRise: mrise, moonSet: mset, moonFrac: A.Illumination('Moon', A.MakeTime(astro || naut || set || noon)).phase_fraction };
  }
  sunAltAz(date = new Date()) { const t = A.MakeTime(date), obs = this.observer(); const eq = A.Equator('Sun', t, obs, true, true); const h = A.Horizon(t, obs, eq.ra, eq.dec, 'normal'); return { alt: h.altitude, az: h.azimuth }; }
  sunAlt(date = new Date()) { const t = A.MakeTime(date), obs = this.observer(); const eq = A.Equator('Sun', t, obs, true, true); return A.Horizon(t, obs, eq.ra, eq.dec, 'normal').altitude; }
}

/** 16-point compass name for an azimuth. */
export function compassName(az) { return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(az / 22.5) % 16]; }
