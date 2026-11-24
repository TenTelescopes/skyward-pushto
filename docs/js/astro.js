// Sky positions, computed entirely on-device with Astronomy Engine (MIT, Don Cross).
import * as A from '../vendor/astronomy.mjs';
import { DSO, DOUBLES, STARS, FIELD, LINES, ASTERISMS } from '../data/catalog.js';
import { NAMES, STAR_NAMES, BLURBS, STAR_PAIRS } from '../data/blurbs.js';
import { orbitRaDec } from './transients.js';

export const PLANETS = ['Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];

const TYPE_LABEL = { CM: 'Comet', TR: 'Nova / transient', MS: 'Meteor shower', OC: 'Open cluster', GC: 'Globular cluster', PN: 'Planetary nebula', GX: 'Galaxy', NB: 'Nebula', DN: 'Dark nebula', CN: 'Cluster + nebula', AS: 'Asterism', DS: 'Double star', ST: 'Star', PL: 'Planet', OT: 'Other' };
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
    const name = NAMES[label] || NAMES[o.id] || o.name;
    out.push({ ...o, name, key: 'dso:' + o.id, label, sub: [label !== o.id ? o.id : null, name].filter(Boolean).join(' · '), v: j2000Vec(o.ra, o.dec) });
  }
  for (const o of DOUBLES) out.push({ ...o, key: 'ds:' + o.id, label: o.id, sub: [o.wds, o.sep ? `${o.sep}″` : null].filter(Boolean).join(' · '), v: j2000Vec(o.ra, o.dec) });
  for (const a of ASTERISMS) out.push({ ...a, key: 'as:' + a.id, label: a.id, sub: 'Asterism', v: j2000Vec(a.ra, a.dec) });
  for (const s of STARS) {
    const label = STAR_NAMES[s.id] || s.id;
    // A named star that is also a catalogued double (Mizar, Castor…) borrows the double's separation data.
    const sv = j2000Vec(s.ra, s.dec), near = (x) => { const v = j2000Vec(x.ra, x.dec); return sv.x * v.x + sv.y * v.y + sv.z * v.z > 0.999994; };   // within 0.2° (works at the pole too)
    const d = DOUBLES.find((x) => x.pairs && near(x));
    // Stars with a write-up are worth suggesting as targets in their own right; the rest are for alignment only.
    const own = STAR_PAIRS[label];
    out.push({ ...s, key: 'st:' + s.id, label, sub: s.bayer, cats: ['Star'], v: j2000Vec(s.ra, s.dec), show: !!BLURBS[label], ...(d ? { pairs: d.pairs, sep: d.sep } : own ? { pairs: [own], sep: own.sep } : {}) });
    // The same star is then in the list twice. Where the named star is a target in its own right, its catalogue twin is
    // kept for the catalogue listing but not suggested again (twin: true).
    if (d && BLURBS[label]) { const t = out.find((x) => x.key === 'ds:' + d.id); if (t) t.twin = true; }
  }
  // Two catalogue entries that share a number and a name (the two halves of the Double Cluster) are one stop at the
  // eyepiece: the second stays in catalogue lists but is not suggested again.
  { const seen = new Set(); for (const o of out) { if (!o.name || o.key.startsWith('st:') || o.key.startsWith('ds:')) continue; const k = o.label + '|' + o.name; if (seen.has(k)) o.twin = true; else seen.add(k); } }
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
export { LINES, j2000Vec };

/** Open clusters: the magnitude of the 5th-brightest member star (the 3rd or 4th when only 3–4 are in the star list,
 *  which goes to magnitude 8). A cluster of bright stars shows even under moonlight, which its averaged surface
 *  brightness hides: the Pleiades' members are 2.9–4.3, the Beehive's 6.3–6.7. Clusters of fainter stars get none. */
/** Bright cores worth judging on their own (size in arcminutes, V magnitude). Cited, not guessed:
 *  M31: the bulge holds about 23% of the galaxy's light (V 3.44 total, so about 5.0) and has an effective radius of
 *  1.0 kpc, about 4.4′ (Courteau et al. 2011, arXiv:1106.3564); half that light (about 5.8) lies inside 8.8′. Observers
 *  under light pollution see this core as "a slightly fuzzy star" (observing.skyhound.com, M31). */
const CORES = { 'NGC 224': { size: 8.8, mag: 5.8 } };
function clusterMembers(objs) {
  for (const o of objs) if (CORES[o.id]) o.core = CORES[o.id];
  const cosR = (deg) => Math.cos(deg * Math.PI / 180);
  for (const o of objs) {
    if (o.t !== 'OC' || !o.maj || o.ra == null) continue;
    const r = o.maj / 120, c = cosR(r), ra = o.ra * Math.PI / 180, de = o.dec * Math.PI / 180;
    const x = Math.cos(de) * Math.cos(ra), y = Math.cos(de) * Math.sin(ra), z = Math.sin(de), ms = [];
    for (let i = 0; i < FIELD_N; i++) {
      if (Math.abs(FIELD[3 * i + 1] - o.dec) > r) continue;
      if (FV[3 * i] * x + FV[3 * i + 1] * y + FV[3 * i + 2] * z >= c) ms.push(FIELD[3 * i + 2]);
    }
    if (ms.length >= 3) { ms.sort((a, b) => a - b); o.members = { n: ms.length, m5: ms[Math.min(4, ms.length - 1)] }; }
  }
}

export class Sky {
  constructor() { this.lat = 43.65; this.lon = -79.38; this.elev = 100; this.objects = buildObjects(); clusterMembers(this.objects); this.stars = this.objects.filter((o) => o.key.startsWith('st:')); }
  setSite(lat, lon, elev = 0) { this.lat = lat; this.lon = lon; this.elev = elev; this.rotT = 0; }
  observer() { return new A.Observer(this.lat, this.lon, this.elev); }
  _rot(date) {
    const ms = date.getTime();
    if (!this.rot || Math.abs(ms - this.rotT) > 500) { this.rot = A.Rotation_EQJ_HOR(A.MakeTime(date), this.observer()); this.rotT = ms; }
    return this.rot;
  }
  /** Apparent (refracted) alt/az of an object at `date`. */
  altAz(o, date = new Date()) {
    if (o.orbit) {                                     // a comet: position from its orbit for this moment
      const c = orbitRaDec(o.orbit, date); o.mag = c.mag; o.ra = c.ra; o.dec = c.dec; o.r = c.r; o.delta = c.delta; o.v = j2000Vec(c.ra, c.dec);
      return this.altAzRaDec(c.ra, c.dec, date);
    }
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
    // `alt` is the apparent height, lifted by the air's bending of light: over half a degree at the horizon. Take that
    // out before turning back to the star catalogue's frame, or a narrow search near (or below) the horizon looks in the
    // wrong place and comes back without the very stars it was aimed at.
    const ag = alt + A.InverseRefraction('normal', alt);
    const ca = Math.cos(ag * D), h = [ca * Math.cos(az * D), -ca * Math.sin(az * D), Math.sin(ag * D)]; // AE horizon frame: x=N, y=W, z=up
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
  /**
   * The night that `when` belongs to: last night until the Sun has risen, tonight after that.
   * (night(day) is keyed to a calendar date, so a time after midnight or in the morning needs this to pick the right one.)
   */
  nightAt(when = new Date()) {
    const prev = this.night(new Date(when.getTime() - 864e5)), end = prev.rise || prev.astroAm || prev.nautAm;
    return end && when < end ? prev : this.night(when);
  }
  /** J2000 RA (degrees) and Dec of a planet or the Moon as seen from here (for labelling a camera picture). */
  raDecJ2000(body, date = new Date()) { const eq = A.Equator(body, A.MakeTime(date), this.observer(), false, true); return { ra: eq.ra * 15, dec: eq.dec }; }
  sunAltAz(date = new Date()) { const t = A.MakeTime(date), obs = this.observer(); const eq = A.Equator('Sun', t, obs, true, true); const h = A.Horizon(t, obs, eq.ra, eq.dec, 'normal'); return { alt: h.altitude, az: h.azimuth }; }
  sunAlt(date = new Date()) { const t = A.MakeTime(date), obs = this.observer(); const eq = A.Equator('Sun', t, obs, true, true); return A.Horizon(t, obs, eq.ra, eq.dec, 'normal').altitude; }
}

/** 16-point compass name for an azimuth. */
export function compassName(az) { return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(az / 22.5) % 16]; }
