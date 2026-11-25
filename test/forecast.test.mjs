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
    const v = { 'HRDPS.CONTINENTAL_NT': null, RDPS_10km_TotalCloudCover: 20, RDPS_10km_SeeingIndex: 3, RDPS_10km_SkyTransparencyIndex: 4, 'HRDPS.CONTINENTAL_TT': null, RDPS_10km_AirTemp_2m: -12, 'HRDPS.CONTINENTAL_TD': -13, 'HRDPS.CONTINENTAL_WSPD': 5 }[L];
    return { ok: true, json: async () => ({ features: v == null ? [] : [{ properties: { value: v } }] }) }; };
  const r = await hourlyForecast(43.5, -80.2, hoursBetween(H(23), H(25)), { fetchFn: fake, storage: null });
  assert.equal(r.length, 3); assert.equal(r[0].cloud, 20); assert.equal(r[0].seeing, 3); assert.equal(r[0].transp, 4);
  assert.equal(r[0].temp, -12); assert.equal(r[0].dew, -13); assert.equal(r[0].wind, 18);   // RDPS temperature when HRDPS has none; wind m/s → km/h
  assert.ok(seen.some((u) => u.includes('HRDPS.CONTINENTAL_NT')) && seen.some((u) => u.includes('RDPS_10km_TotalCloudCover')));
  const none = await hourlyForecast(43.5, -80.2, hoursBetween(H(23), H(24)), { fetchFn: async () => { throw new Error('offline'); }, storage: null });
  assert.equal(none, null);
});

// Build 111: Apple Weather extras (iPhone app)
import { mergeApple } from '../docs/js/forecast.js';
await ok('Apple Weather: merged by hour, fills missing cloud, warns of dew, gusts and high cloud', () => {
  const base = rows([[23, null, 3, 3], [24, 5, 3, 3], [25, 0, 3, 3]]);
  const ap = { hours: [23, 24, 25].map((h, i) => ({ t: H(h), temp: 4 - i * 2, dew: 1, cloud: 10, wind: 10, gust: i === 2 ? 32 : 15, high: 50 })) };
  const m = mergeApple(base, ap, base.map((r) => r.t));
  assert.equal(m[0].cloud, 10); assert.equal(m[0].cloudSrc, 'apple'); assert.equal(m[1].cloud, 5); assert.equal(m[1].cloudSrc, 'eccc');
  const o = outlook(m, { moonUp: noMoon, nelm: 6 });
  assert.equal(o.kind, 'clear'); assert.equal(o.extra.wind, 32); assert.ok(o.extra.dew && o.extra.dew.from.getTime() === H(24).getTime());
  assert.equal(o.extra.highCloud, 50); assert.equal(o.extra.warn.length, 4);   // dew, cold (3.7 °C, feels lower), gusts, high cloud
});
await ok('Apple Weather alone (outside Canada): rows from Apple, no seeing', () => {
  const hrs = [H(23), H(24), H(25)];
  const m = mergeApple(null, { hours: hrs.map((t) => ({ t, temp: 10, dew: 2, cloud: 20, wind: 5 })) }, hrs);
  const o = outlook(m, { moonUp: noMoon, nelm: 6 });
  assert.equal(o.kind, 'clear'); assert.equal(o.seeing, null); assert.equal(o.extra.warn.length, 0);
});

import { feelsLike, coldWord, comfort } from '../docs/js/forecast.js';
await ok('cold: Environment Canada wind chill, warnings and dressing advice', () => {
  assert.equal(Math.round(feelsLike(-20, 30)), -33); assert.equal(feelsLike(-5, 3), -5); assert.equal(feelsLike(15, 30), 15);
  assert.match(coldWord(-30), /freeze/); assert.equal(coldWord(8), null);
  const R = [23, 24, 25].map((h, i) => ({ t: H(h), cloud: 5, seeing: 3, transp: 3, temp: -15 - i, dew: -25, wind: 20 }));
  const o = outlook(R, { moonUp: noMoon, nelm: 6 });
  assert.equal(o.extra.cold.temp, -17); assert.ok(o.extra.cold.feels < -25); assert.equal(o.extra.cold.dressFor, Math.round(o.extra.cold.feels - 10));
  assert.ok(o.extra.warn.some((w) => /Dress for about -3\d°C/.test(w)), o.extra.warn.join(' / '));
  assert.ok(!o.extra.dew);                                           // 8–10° above the dew point: dry
  assert.equal(comfort({ ap: { temp: 2, dew: 1, wind: 4 } }).gap, 1);   // Apple Weather fills in
});
