// Which constellation / asterism the telescope is pointing into — computed on-device.
// Constellations: official IAU boundaries (defined in B1875 coordinates), point-in-region by counting
// boundary parallels crossed by a ray due north (the classic Roman 1987 method); Ursa Minor contains
// the pole, so its parity is inverted.
import * as A from '../vendor/astronomy.mjs';
import { PARALLELS, CON_FULL } from '../data/bounds.js';

const B1875 = A.MakeTime(new Date((2405889.258550475 - 2440587.5) * 86400000));
const ROT_1875 = A.Rotation_EQJ_EQD(B1875);
const D = Math.PI / 180;

/** J2000 RA/Dec (deg) -> B1875 RA/Dec (deg). */
export function toB1875(ra, dec) {
  const v = A.VectorFromSphere(new A.Spherical(dec, ra, 1), A.MakeTime(new Date(Date.UTC(2000, 0, 1, 12))));
  const w = A.RotateVector(ROT_1875, v); const s = A.SphereFromVector(w);
  return { ra: (s.lon + 360) % 360, dec: s.lat };
}

const BY_CON = {};
for (const e of PARALLELS) for (const c of [e[3], e[4]]) (BY_CON[c] ||= []).push(e);

function inSpan(ra, a, b) { return a <= b ? ra >= a && ra < b : ra >= a || ra < b; }

/** IAU constellation abbreviation (e.g. 'CYG', 'SER1') for a J2000 position. */
export function constellationAt(raJ2000, decJ2000) {
  const p = toB1875(raJ2000, decJ2000);
  let best = null;
  for (const [con, edges] of Object.entries(BY_CON)) {
    let n = 0;
    for (const [a, b, dec] of edges) if (dec > p.dec && inSpan(p.ra, a, b)) n++;
    const inside = con === 'UMI' ? n % 2 === 0 : n % 2 === 1;
    if (inside) { best = con; break; }
  }
  return best;
}
export const conName = (abbr) => (abbr ? CON_FULL[abbr] || abbr : '');

/** Convert an apparent alt/az back to J2000 RA/Dec using the sky's current rotation (refraction ignored, < 0.5°). */
export function altAzToJ2000(sky, alt, az, date = new Date()) {
  const R = sky._rot(date).rot;
  const ca = Math.cos(alt * D), h = [ca * Math.cos(az * D), -ca * Math.sin(az * D), Math.sin(alt * D)];
  const c = [0, 1, 2].map((j) => R[j][0] * h[0] + R[j][1] * h[1] + R[j][2] * h[2]);
  return { ra: (Math.atan2(c[1], c[0]) / D + 360) % 360, dec: Math.asin(Math.max(-1, Math.min(1, c[2]))) / D };
}
