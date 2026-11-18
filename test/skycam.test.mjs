import assert from 'node:assert/strict';
import { FIELD } from '../docs/data/catalog.js';
import { makeIndex, solveField } from '../docs/js/solve.js';
import { skyMask, isSky, findStars, planIntegration, skyWord } from '../docs/js/skycam.js';
const ok = (name, f) => { const t = Date.now(); f(); console.log('ok  ', name, `(${Date.now() - t} ms)`); };
const D2R = Math.PI / 180;
let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(6.283185 * rnd());
const ix = makeIndex(FIELD);

// A fake night photograph with a real star field, a skyglow gradient, and a foreground: a tree line, a house with a lit
// window, and a street lamp. `truth` marks which pixels are genuinely sky.
function scene({ ra = 83.8, dec = -1.2, fovDiag = 75, w = 1280, h = 720, sky = 30, glow = 45, noise = 5, frames = 1, magLimit = 4.3, gainStar = 9000, foreground = true }) {
  const f = Math.hypot(w, h) / 2 / Math.tan(fovDiag / 2 * D2R), a = ra * D2R, d = dec * D2R;
  const z = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)], n = [-z[2] * z[0], -z[2] * z[1], 1 - z[2] * z[2]], nl = Math.hypot(...n), up = n.map((v) => v / nl);
  const east = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]], X = east.map((v) => -v), Y = up.map((v) => -v);
  const lum = new Float32Array(w * h), truth = new Uint8Array(w * h).fill(1), sig = noise / Math.sqrt(frames);
  const treeTop = (x) => h * 0.72 - 60 * Math.sin(x / 70) - 35 * Math.sin(x / 23 + 1) - (x < w * 0.45 ? 90 : 0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = sky + glow * Math.pow(y / h, 2) + 6 * (x / w);
    if (foreground) {
      if (y > treeTop(x)) { v = 5 + 4 * Math.abs(Math.sin(x / 3.1) * Math.cos(y / 2.7)) + (rnd() < 0.03 ? 25 : 0); truth[y * w + x] = 0; }             // dark, twiggy trees
      if (x > w * 0.68 && y > h * 0.45) { v = 60 + 20 * ((x >> 4) % 2); truth[y * w + x] = 0; if (x > w * 0.8 && x < w * 0.86 && y > h * 0.6 && y < h * 0.72) v = 740; }   // house wall and lit window
      const lamp = Math.hypot(x - w * 0.56, y - h * 0.5); if (lamp < 46) { v = Math.max(v, 760 - lamp * 6); truth[y * w + x] = 0; }                     // street lamp
    }
    lum[y * w + x] = v;
  }
  const placed = [];
  for (let i = 0; i < FIELD.length; i += 3) {
    const m = FIELD[i + 2]; if (m > magLimit) continue;
    const r1 = FIELD[i] * D2R, d1 = FIELD[i + 1] * D2R, v = [Math.cos(d1) * Math.cos(r1), Math.cos(d1) * Math.sin(r1), Math.sin(d1)], cz = v[0] * z[0] + v[1] * z[1] + v[2] * z[2]; if (cz < 0.2) continue;
    const x = w / 2 + f * (v[0] * X[0] + v[1] * X[1] + v[2] * X[2]) / cz, y = h / 2 + f * (v[0] * Y[0] + v[1] * Y[1] + v[2] * Y[2]) / cz;
    if (x < 6 || y < 6 || x > w - 6 || y > h - 6 || !truth[(y | 0) * w + (x | 0)]) continue;
    const amp = gainStar * Math.pow(10, -0.4 * m) / 12; placed.push({ x, y, m });
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const px = (x | 0) + dx, py = (y | 0) + dy; lum[py * w + px] += amp * Math.exp(-((px - x) ** 2 + (py - y) ** 2) / (2 * 1.3 * 1.3)); }
  }
  for (let i = 0; i < lum.length; i++) lum[i] = Math.min(765, Math.max(0, lum[i] + gauss() * sig));
  return { lum, w, h, truth, placed, ra, dec };
}

ok('the mask keeps the sky and stripes out trees, house and lamp', () => {
  const s = scene({}), m = skyMask(s.lum, s.w, s.h); let skyKept = 0, skyAll = 0, fgKept = 0, fgAll = 0;
  for (let ty = 0; ty < m.th; ty++) for (let tx = 0; tx < m.tw; tx++) {
    let t = 0, c = 0; for (let y = ty * m.T; y < Math.min(s.h, (ty + 1) * m.T); y += 4) for (let x = tx * m.T; x < Math.min(s.w, (tx + 1) * m.T); x += 4) { t += s.truth[y * s.w + x]; c++; }
    const pure = t === c, none = t === 0;
    if (pure) { skyAll++; skyKept += m.sky[ty * m.tw + tx]; } else if (none) { fgAll++; fgKept += m.sky[ty * m.tw + tx]; }
  }
  console.log(`      kept ${skyKept}/${skyAll} sky tiles, let through ${fgKept}/${fgAll} foreground tiles; sky level ${m.level.toFixed(1)}, noise ${m.noise.toFixed(2)}`);
  assert.ok(skyKept / skyAll > 0.75, 'too much sky thrown away'); assert.ok(fgKept / fgAll < 0.05, 'foreground counted as sky');
});
ok('sky brightness comes from the sky alone, not the lamp or the black trees', () => {
  const withFg = scene({}), clean = scene({ foreground: false }), a = skyMask(withFg.lum, withFg.w, withFg.h), b = skyMask(clean.lum, clean.w, clean.h);
  assert.ok(b.fraction > 0.9, `an all-sky frame should be nearly all sky (${b.fraction})`);
  let whole = 0; for (let i = 0; i < withFg.lum.length; i += 7) whole += withFg.lum[i]; whole /= withFg.lum.length / 7;
  console.log(`      sky-only level ${a.level.toFixed(1)} (true upper sky ≈ ${b.level.toFixed(1)}, whole-frame average ${whole.toFixed(1)})`);
  assert.ok(Math.abs(a.level - b.level) < 14, 'sky level disturbed by the foreground');
});
ok('no "stars" are found in the foreground, and the real ones solve', () => {
  const s = scene({ frames: 8 }), m = skyMask(s.lum, s.w, s.h), found = findStars(s.lum, s.w, s.h, m).stars;
  for (const st of found) assert.ok(s.truth[(st.y | 0) * s.w + (st.x | 0)], `star reported in the foreground at ${st.x | 0},${st.y | 0}`);
  const real = found.filter((st) => s.placed.some((p) => Math.hypot(p.x - st.x, p.y - st.y) < 3)).length;
  assert.ok(found.length >= 10 && real / found.length > 0.9, `${real} real of ${found.length}`);
  const sol = solveField(found, s.w, s.h, ix, { prior: { ra: s.ra + 6, dec: s.dec + 5, radius: 25 } });
  assert.ok(sol, 'no solution'); const c = Math.sin(sol.dec * D2R) * Math.sin(s.dec * D2R) + Math.cos(sol.dec * D2R) * Math.cos(s.dec * D2R) * Math.cos((sol.ra - s.ra) * D2R), err = Math.acos(Math.min(1, c)) / D2R;
  console.log(`      ${found.length} stars found, ${sol.n} matched, centre off ${(err * 60).toFixed(1)}′`);
  assert.ok(err < 0.2, `centre off ${err}°`);
});
ok('without the mask the same picture throws up false stars (so the mask is doing real work)', () => {
  const s = scene({ frames: 8 }), found = findStars(s.lum, s.w, s.h).stars, junk = found.filter((st) => !s.truth[(st.y | 0) * s.w + (st.x | 0)]).length;
  assert.ok(junk >= 3, `only ${junk} false stars without the mask`);
});
ok('stacking plan: asks for more light when stars are marginal, stops when there are enough', () => {
  const few = planIntegration({ level: 40, noise: 3, frameTime: 1 / 30, collected: 0.5, snrs: [20, 14, 9, 7, 6.5, 5, 4.6, 4.4, 4.2, 4, 3.9, 3.8, 3.6] });
  assert.ok(!few.done && few.total > 0.9 && few.total < 1.6, JSON.stringify(few));        // star 12 at 3.8× needs (6/3.8)² ≈ 2.5× the light
  const plenty = planIntegration({ level: 40, noise: 3, frameTime: 1 / 30, collected: 0.5, snrs: Array.from({ length: 20 }, (_, i) => 30 - i) });
  assert.ok(plenty.done && plenty.more === 0);
  const hopeless = planIntegration({ level: 40, noise: 3, frameTime: 1 / 30, collected: 2, snrs: [4], maxTotal: 12 });
  assert.ok(hopeless.capped && hopeless.total === 12);
});
ok('frame length follows the sky: shorter under light pollution, longer under a dark sky', () => {
  const bright = planIntegration({ level: 765 * 0.4, noise: 8, frameTime: 0.5, collected: 0.5, canSetExposure: true, maxFrameTime: 1 });
  assert.ok(bright.frameTime < 0.2, String(bright.frameTime)); assert.match(bright.frameWhy, /bright/);
  const dark = planIntegration({ level: 765 * 0.01, noise: 1, frameTime: 1 / 30, collected: 0.1, canSetExposure: true, maxFrameTime: 1 });
  assert.ok(dark.frameTime > 0.2, String(dark.frameTime)); assert.match(dark.frameWhy, /dark/);
  const fixed = planIntegration({ level: 765 * 0.01, noise: 1, frameTime: 1 / 30, collected: 0.1, canSetExposure: false });
  assert.equal(fixed.frameTime, 1 / 30); assert.match(fixed.frameWhy, /will not take/);
  assert.equal(skyWord(765 * 0.3), 'very bright'); assert.equal(skyWord(10), 'very dark');
});
