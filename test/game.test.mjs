import { pickTargets, routeOrder, pathLength, encodeChallenge, decodeChallenge, encodeResult, decodeResult, challengeId, points, rank, dwell, tokenFor, buildTokenIndex, isCandidate } from '../docs/js/game.js';
import { Sky } from '../docs/js/astro.js';
import { sepDeg } from '../docs/js/model.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const sky = new Sky(); sky.setSite(43.65, -79.38, 100);
const night = new Date('2026-11-03T01:30:00Z'); sky.updateAll(night);
const T = pickTargets(sky.objects, { aperture: 150, sunAlt: sky.sunAlt(night) });
ok(T.length === 10, `10 targets picked tonight (${T.map(tokenFor).join(' ')})`);
ok(T.every((o) => o.alt >= 25 && o.alt <= 80), 'all between 25° and 80° altitude');
ok(T.every((o) => !(o.maj > 60) || o.cats.some((c) => /^M\d/.test(c))), 'no huge faint non-Messier targets');
ok(T.every((a, i) => T.every((b, j) => i === j || sepDeg(a.alt, a.az, b.alt, b.az) >= 6)), 'spread at least 6° apart');
const types = {}; T.forEach((o) => { const t = o.planet ? 'PL' : o.key.startsWith('ds:') ? 'DS' : o.t; types[t] = (types[t] || 0) + 1; });
ok(Object.values(types).every((n) => n <= 3), `variety: no type more than 3 (${JSON.stringify(types)})`);
ok(JSON.stringify(pickTargets(sky.objects, { aperture: 150, sunAlt: sky.sunAlt(night) }).map(tokenFor)) === JSON.stringify(T.map(tokenFor)), 'deterministic: same sky gives same 10');
const T200 = pickTargets(sky.objects, { aperture: 203, sunAlt: sky.sunAlt(night) });
ok(T200.length === 10, `200 mm also gets 10 (${T200.map(tokenFor).join(' ')})`);
// twilight: only bright things
for (const [iso, label, test] of [['2026-11-02T22:00:00Z', 'daylight', (o) => o.planet], ['2026-11-02T22:45:00Z', 'nautical twilight', (o) => o.planet || o.key.startsWith('ds:') || (o.mag != null && o.mag < 5)]]) {
  const dusk = new Date(iso); const sk2 = new Sky(); sk2.setSite(43.65, -79.38, 100); sk2.updateAll(dusk);
  const D = pickTargets(sk2.objects, { aperture: 150, sunAlt: sk2.sunAlt(dusk) });
  ok(D.every(test), `${label} (sun ${sk2.sunAlt(dusk).toFixed(1)}°): only suitable targets (${D.map(tokenFor).join(' ') || 'none'})`); }
// route
const R = routeOrder(T); const naive = pathLength(T), routed = pathLength(R);
ok(routed <= naive && new Set(R).size === T.length, `route shorter than pick order (${routed.toFixed(0)}° vs ${naive.toFixed(0)}°)`);
// brute force check on 7 points that 2-opt is near-optimal
{ const S = T.slice(0, 7); const perm = (a) => a.length < 2 ? [a] : a.flatMap((x, i) => perm([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
  const best = Math.min(...perm(S).map(pathLength)); const got = pathLength(routeOrder(S));
  ok(got <= best * 1.05, `route within 5% of optimal on 7 targets (${got.toFixed(1)}° vs best ${best.toFixed(1)}°)`); }
// codes
const code = encodeChallenge({ style: 'hop', tokens: R.map(tokenFor), created: night.getTime(), host: 'Bryan' });
const dc = decodeChallenge(code);
ok(dc.style === 'hop' && dc.tokens.join() === R.map(tokenFor).join() && dc.host === 'Bryan', `challenge round-trips (${code.length} chars)`);
const idx = buildTokenIndex(sky.objects); ok(dc.tokens.every((t) => idx.has(t)), 'every token resolves to a catalog object');
{ const all = sky.objects.filter((o) => !o.key.startsWith('st:') && !o.key.startsWith('as:')); const toks = all.map(tokenFor); const dup = toks.filter((t, i) => toks.indexOf(t) !== i);
  ok(dup.length === 0, `tokens are unique across the catalog (${all.length} objects${dup.length ? ', dupes: ' + [...new Set(dup)].join(' ') : ''})`); }
let threw = false; try { decodeChallenge(code.replace('hop', 'push')); } catch (e) { threw = true; } ok(threw, 'tampered challenge rejected');
const res = { challenge: challengeId(code), player: 'Bryan', style: 'hop', found: 9, targets: 10, totalSec: 754.3, penaltySec: 120, splits: [40, 61, null, 80] };
const rr = decodeResult(encodeResult(res)); ok(rr.found === 9 && rr.totalSec === 754 && rr.splits[2] === null && rr.player === 'Bryan', 'result round-trips');
threw = false; try { decodeResult(encodeResult(res).replace('|9|', '|10|')); } catch (e) { threw = true; } ok(threw, 'edited result (9→10 found) rejected');
// ranking: more found beats faster
const ranked = rank([{ found: 9, totalSec: 300 }, { found: 10, totalSec: 900 }, { found: 10, totalSec: 600 }]);
ok(ranked[0].totalSec === 600 && ranked[2].found === 9, 'ranking: found first, then time');
// dwell
const st = {}; ok(!dwell(st, 0.2, 0.5, 0) && !dwell(st, 0.2, 0.5, 1500) && dwell(st, 0.2, 0.5, 2100), 'dwell confirms after 2 s inside');
const st2 = {}; dwell(st2, 0.2, 0.5, 0); dwell(st2, 0.9, 0.5, 1000); ok(!dwell(st2, 0.2, 0.5, 2100), 'leaving the circle resets the dwell');
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
