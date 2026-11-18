import assert from 'node:assert/strict';
import { FIELD } from '../docs/data/catalog.js';
import { makeIndex, solveField, project } from '../docs/js/solve.js';
const ok = (name, f) => { const t = Date.now(); f(); console.log('ok  ', name, `(${Date.now() - t} ms)`); };
const D2R = Math.PI / 180;
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(6.283185 * rnd());
const ix = makeIndex(FIELD);

// A fake photograph: project the real catalogue through a pinhole pointed at (ra, dec) with a roll and field of view.
function shoot({ ra, dec, roll, fovDiag, w = 1920, h = 1080, magLimit = 4.6, jitter = 0.7, drop = 0.15, junk = 2, keep = 30 }) {
  const f = Math.hypot(w, h) / 2 / Math.tan(fovDiag / 2 * D2R), a = ra * D2R, d = dec * D2R, r = roll * D2R;
  const z = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const n = [-z[2] * z[0], -z[2] * z[1], 1 - z[2] * z[2]], nl = Math.hypot(...n), up = n.map((v) => v / nl);       // north in the picture plane
  const east = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];            // up × z = east... sign fixed below
  const right0 = east.map((v) => -v), down0 = up.map((v) => -v);                                                    // north up: right is west
  const X = right0.map((v, i) => v * Math.cos(r) + down0[i] * Math.sin(r)), Y = down0.map((v, i) => -right0[i] * Math.sin(r) + v * Math.cos(r));
  const stars = [];
  for (let i = 0; i < FIELD.length; i += 3) {
    const m = FIELD[i + 2]; if (m > magLimit) continue;
    const ra1 = FIELD[i] * D2R, de1 = FIELD[i + 1] * D2R, v = [Math.cos(de1) * Math.cos(ra1), Math.cos(de1) * Math.sin(ra1), Math.sin(de1)];
    const cz = v[0] * z[0] + v[1] * z[1] + v[2] * z[2]; if (cz < 0.2) continue;
    const x = w / 2 + f * (v[0] * X[0] + v[1] * X[1] + v[2] * X[2]) / cz, y = h / 2 + f * (v[0] * Y[0] + v[1] * Y[1] + v[2] * Y[2]) / cz;
    if (x < 8 || y < 8 || x > w - 8 || y > h - 8 || rnd() < drop) continue;
    stars.push({ x: x + gauss() * jitter, y: y + gauss() * jitter, flux: Math.pow(10, -0.4 * m) * (0.8 + 0.4 * rnd()) });
  }
  stars.sort((p, q) => q.flux - p.flux); stars.length = Math.min(stars.length, keep);
  for (let k = 0; k < junk; k++) stars.push({ x: rnd() * w, y: rnd() * h, flux: stars[Math.floor(rnd() * Math.min(6, stars.length))].flux * 1.2 });   // a plane, a planet, a hot pixel
  return { stars, w, h, f };
}
const sepDeg = (r1, d1, r2, d2) => { const a = Math.sin(d1 * D2R) * Math.sin(d2 * D2R) + Math.cos(d1 * D2R) * Math.cos(d2 * D2R) * Math.cos((r1 - r2) * D2R); return Math.acos(Math.min(1, a)) / D2R; };

ok('the catalogue index holds the naked-eye stars', () => { assert.ok(ix.n > 1500 && ix.n < 2600, String(ix.n)); assert.ok(ix.M[0] < -1); });

const FIELDS = [
  { name: 'Orion', ra: 83.8, dec: -1.2, roll: 20, fovDiag: 75 },
  { name: 'Cassiopeia, sideways', ra: 14, dec: 60, roll: 95, fovDiag: 70 },
  { name: 'Cygnus, narrow video crop', ra: 305, dec: 40, roll: -140, fovDiag: 50 },
  { name: 'Big Dipper, wide', ra: 185, dec: 55, roll: 200, fovDiag: 95 },
  { name: 'a dull patch in Camelopardalis', ra: 90, dec: 70, roll: 10, fovDiag: 72 },
  { name: 'Scorpius, upside down', ra: 250, dec: -28, roll: 180, fovDiag: 68 },
];
ok('solves known fields with a rough idea of where the scope points', () => {
  for (const F of FIELDS) {
    const im = shoot(F), sol = solveField(im.stars, im.w, im.h, ix, { prior: { ra: F.ra + 9, dec: F.dec - 7, radius: 25 } });
    assert.ok(sol, `${F.name}: no solution from ${im.stars.length} stars`);
    const err = sepDeg(sol.ra, sol.dec, F.ra, F.dec);
    assert.ok(err < 0.15, `${F.name}: centre off by ${err.toFixed(3)}°`);
    assert.ok(Math.abs(sol.f / im.f - 1) < 0.01, `${F.name}: focal length ${sol.f} vs ${im.f}`);
    console.log(`      ${F.name}: ${sol.n}/${sol.of} stars, off ${(err * 60).toFixed(1)}′, field ${sol.fovW.toFixed(0)}°×${sol.fovH.toFixed(0)}°, ${sol.confidence}`);
  }
});
ok('solves blind, with no idea where it is pointing', () => {
  for (const F of FIELDS.slice(0, 4)) {
    const im = shoot(F), sol = solveField(im.stars, im.w, im.h, ix);
    assert.ok(sol, `${F.name}: no blind solution`); assert.ok(sepDeg(sol.ra, sol.dec, F.ra, F.dec) < 0.15, F.name);
  }
});
ok('a picture of nothing in particular is refused, not guessed', () => {
  for (let t = 0; t < 4; t++) {
    const stars = Array.from({ length: 14 }, () => ({ x: rnd() * 1920, y: rnd() * 1080, flux: rnd() }));
    assert.equal(solveField(stars, 1920, 1080, ix, { prior: { ra: 100, dec: 20, radius: 30 } }), null);
  }
});
ok('still solves a thin, light-polluted frame (eight stars, one of them a planet)', () => {
  const F = FIELDS[0], im = shoot({ ...F, magLimit: 3.0, drop: 0, junk: 1, keep: 8 });
  const sol = solveField(im.stars, im.w, im.h, ix, { prior: { ra: F.ra, dec: F.dec, radius: 20 } });
  assert.ok(sol && sepDeg(sol.ra, sol.dec, F.ra, F.dec) < 0.2, sol ? 'wrong place' : `no solution from ${im.stars.length}`);
});
ok('project() puts a matched star back on its own pixel', () => {
  const F = FIELDS[0], im = shoot({ ...F, jitter: 0, drop: 0, junk: 0 }), sol = solveField(im.stars, im.w, im.h, ix, { prior: { ra: F.ra, dec: F.dec, radius: 20 } });
  const m = sol.matches[0], p = project(sol, im.w, im.h, m.ra, m.dec); assert.ok(Math.hypot(p.x - m.x, p.y - m.y) < 1.5);
});
