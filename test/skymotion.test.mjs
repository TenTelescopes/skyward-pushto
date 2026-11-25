// Build 113: compass offset from the native Core Motion axes (SkyMotion) must match the true heading for any tilt.
import assert from 'node:assert/strict';
import { Sensors } from '../docs/js/sensors.js';
import { rotFromEuler, mulMV, altAzFromVec, wrap180 } from '../docs/js/model.js';
const rotZ = (d) => { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
const mm = (A, B) => A.map((r, i) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
let n = 0;
for (const [al, be, ga] of [[30, 60, 0], [200, 85, 10], [120, 10, -40], [300, 120, 5], [10, -30, 70]]) for (const off of [0, 37, -128, 179]) {
  const Rtrue = rotFromEuler(al, be, ga);                       // phone axes → (east, north, up)
  const Rrel = mm(rotZ(-off), Rtrue);                           // the web's frame: same, turned by an unknown amount
  const s = new Sensors(); s.R = Rrel;
  s._onNative({ E: Rtrue[0], N: Rtrue[1], U: Rtrue[2], frame: 'true', acc: 2 });
  // pointing of the back of the phone (camera), true azimuth vs relative + offset
  const back = [0, 0, -1], t = altAzFromVec(mulMV(Rtrue, back)), r = altAzFromVec(mulMV(Rrel, back));
  if (Math.abs(t.alt) > 85) continue;
  assert.ok(Math.abs(wrap180(r.az + s.compassOffset() - t.az)) < 1e-6, `tilt ${al},${be},${ga} offset ${off}: ${r.az + s.compassOffset()} vs ${t.az}`);
  n++;
}
// magnetic frame plus declination
{ const Rtrue = rotFromEuler(80, 70, 0), Rrel = mm(rotZ(-20), Rtrue), decl = -9.6;
  const Rmag = mm(rotZ(decl), Rtrue);                            // magnetic frame: turned by the declination (west negative)
  const s = new Sensors(); s.R = Rrel; s._onNative({ E: Rmag[0], N: Rmag[1], U: Rmag[2], frame: 'magnetic', decl, acc: 1 });
  const t = altAzFromVec(mulMV(Rtrue, [0, 0, -1])), r = altAzFromVec(mulMV(Rrel, [0, 0, -1]));
  assert.ok(Math.abs(wrap180(r.az + s.compassOffset() - t.az)) < 1e-6, 'declination'); n++; }
console.log(`✓ native compass offset correct in ${n} orientations`);
