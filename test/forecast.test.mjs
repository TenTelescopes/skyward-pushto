import assert from 'node:assert/strict';
import { hourlyForecast, hoursBetween, outlook, seeingWord, transpAdj } from '../docs/js/forecast.js';
const ok = (name, f) => Promise.resolve(f()).then(() => console.log('ok  ', name));
const H = (h) => new Date(Date.UTC(2026, 11, 1, h));
const rows = (spec) => spec.map(([h, cloud, seeing, transp]) => ({ t: H(h), cloud, seeing, transp }));
const noMoon = () => ({ up: false, frac: 0 }), fullMoon = () => ({ up: true, frac: 0.98 });

await ok('scales: seeing words and haze adjustment', () => {
  assert.equal(seeingWord(2), 'poor'); assert.equal(seeingWord(3), 'average'); assert.equal(seeingWord(5), 'good'); assert.equal(seeingWord(0), null);
  assert.ok(transpAdj(1) < transpAdj(3) && transpAdj(3) === 0 && transpAdj(5) > 0);
});
await ok('clouded out', () => { const o = outlook(rows([[23, 95, 0, 0], [24, 90, 0, 0], [25, 100, 0, 0]]), { moonUp: noMoon, nelm: 6 }); assert.equal(o.kind, 'cloudy'); });
await ok('clear, dark, steady: everything', () => {
  const o = outlook(rows([[23, 5, 4, 4], [24, 0, 4, 4], [25, 10, 5, 4], [26, 0, 4, 5]]), { moonUp: noMoon, nelm: 6.3 });
  assert.equal(o.kind, 'clear'); assert.ok(o.best.some((b) => /galaxies/.test(b))); assert.ok(o.best.some((b) => /planets/.test(b)));
});
await ok('clearing later, bright Moon: no galaxies, start at the clear spell', () => {
  const o = outlook(rows([[23, 90, 0, 0], [24, 80, 0, 0], [25, 10, 3, 3], [26, 5, 3, 3], [27, 0, 3, 3]]), { moonUp: fullMoon, nelm: 6.3 });
  assert.equal(o.kind, 'partly'); assert.equal(o.from.getTime(), H(25).getTime()); assert.ok(!o.best.some((b) => /galaxies/.test(b)));
});
await ok('city sky with haze: no galaxies', () => {
  const o = outlook(rows([[23, 0, 3, 2], [24, 0, 3, 2], [25, 0, 3, 2]]), { moonUp: noMoon, nelm: 5.0 }); assert.ok(!o.best.some((b) => /galaxies/.test(b)));
});
await ok('fetching: HRDPS first, RDPS cloud when HRDPS has no value, nulls survive', async () => {
  const seen = [];
  const fake = async (url) => { seen.push(url); const L = /layers=([^&]+)/.exec(url)[1];
    const v = { 'HRDPS.CONTINENTAL_NT': null, RDPS_10km_TotalCloudCover: 20, RDPS_10km_SeeingIndex: 3, RDPS_10km_SkyTransparencyIndex: 4 }[L];
    return { ok: true, json: async () => ({ features: v == null ? [] : [{ properties: { value: v } }] }) }; };
  const r = await hourlyForecast(43.5, -80.2, hoursBetween(H(23), H(25)), { fetchFn: fake, storage: null });
  assert.equal(r.length, 3); assert.equal(r[0].cloud, 20); assert.equal(r[0].seeing, 3); assert.equal(r[0].transp, 4);
  assert.ok(seen.some((u) => u.includes('HRDPS.CONTINENTAL_NT')) && seen.some((u) => u.includes('RDPS_10km_TotalCloudCover')));
  const none = await hourlyForecast(43.5, -80.2, hoursBetween(H(23), H(24)), { fetchFn: async () => { throw new Error('offline'); }, storage: null });
  assert.equal(none, null);
});
