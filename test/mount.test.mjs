import assert from 'node:assert/strict';
import { MOUNTINGS, PointingModel, eulerForMounting, rotFromEuler, fitAlignment, wrap180 } from '../docs/js/model.js';
const ok = (name, f) => { f(); console.log('ok  ', name); };
const keys = Object.keys(MOUNTINGS);
ok('every phone position has a picture caption and a unit axis', () => {
  assert.ok(keys.length >= 7);
  for (const k of keys) { const m = MOUNTINGS[k]; assert.ok(m.where && m.edge && m.label, k); assert.ok(Math.abs(Math.hypot(...m.d) - 1) < 1e-12, k); }
});
ok('each position reads the same sky direction as the dock does', () => {
  const ref = new PointingModel('top-sky');
  for (const alt of [5, 30, 62, 85]) for (const a0 of [0, 77, 200, 341]) {
    const want = ref.rawPointing(rotFromEuler(a0, alt, 0));
    assert.ok(Math.abs(want.alt - alt) < 1e-9);
    for (const k of keys) {
      const e = eulerForMounting(k, alt, a0), got = new PointingModel(k).rawPointing(rotFromEuler(e.alpha, e.beta, e.gamma));
      assert.ok(Math.abs(got.alt - alt) < 1e-6, `${k} alt ${got.alt} vs ${alt}`);
      assert.ok(Math.abs(wrap180(got.az - want.az)) * Math.cos(alt * Math.PI / 180) < 1e-6, `${k} az ${got.az} vs ${want.az} at alt ${alt}`);
    }
  }
});
ok('rolling a side-mounted phone around the tube does not move the pointing', () => {
  const m = new PointingModel('side-sky'); const a = m.rawPointing(rotFromEuler(120, 40, 0));
  for (const g of [-80, -30, 45, 80]) { const b = m.rawPointing(rotFromEuler(120, 40, g)); assert.ok(Math.abs(a.alt - b.alt) < 1e-9 && Math.abs(wrap180(a.az - b.az)) < 1e-9, String(g)); }
});
ok('two stars still solve a crooked phone in the new positions', () => {
  for (const k of ['top-sky', 'across-left', 'across-right', 'side-sky', 'camera']) {
    const truth = new PointingModel(k); truth.p = 2.5; truth.q = -1.8; const theta = 37;
    // find, for each star, a phone attitude whose TRUE (crooked) pointing is the star: start from the nominal attitude and read back what it really points at
    const obs = [[35, 80], [58, 205], [22, 300]].map(([alt, a0]) => { const e = eulerForMounting(k, alt, a0), R = rotFromEuler(e.alpha, e.beta, e.gamma), r = truth.rawPointing(R); return { R, alt: r.alt, az: r.az + theta }; });
    const f = fitAlignment(obs, MOUNTINGS[k].d);
    assert.ok(Math.abs(f.p - 2.5) < 0.3 && Math.abs(f.q + 1.8) < 0.3, `${k}: p ${f.p} q ${f.q}`);
    assert.ok(Math.abs(wrap180(f.theta - theta)) < 0.6, `${k}: theta ${f.theta}`); assert.ok(f.rms < 0.3, `${k}: rms ${f.rms}`);
    console.log('     ', k, 'p', f.p.toFixed(2), 'q', f.q.toFixed(2), 'theta', f.theta.toFixed(2), 'rms', f.rms.toFixed(3));
  }
});
