import assert from 'node:assert/strict';
import { Sky } from '../docs/js/astro.js';
import { planTargets, routePlan, nextDarkNight, openingSync, orderTargets, travelOf } from '../docs/js/plan.js';
import { rate, skyFromNelm, describe } from '../docs/js/vis.js';

const sky = new Sky(); sky.setSite(43.55, -80.25, 330);          // Guelph
const eps = [23, 10, 4].map((f) => ({ name: `${f} mm`, fl: f, afov: 62 }));
const S150 = { aperture: 150, fl: 750, eyepieces: eps }, S200 = { aperture: 200, fl: 800, eyepieces: eps };
const find = (label) => sky.objects.find((o) => o.label === label);
const R = (label, c = {}, sc = S150) => rate(find(label), { alt: 60, nelm: 5, ...c }, sc);
const ok = (name, f) => { f(); console.log('ok  ', name); };

ok('sky brightness from the Little Dipper count is sensible', () => {
  assert.ok(Math.abs(skyFromNelm(6) - 20.8) < 0.2); assert.ok(Math.abs(skyFromNelm(5) - 19.3) < 0.2); assert.ok(skyFromNelm(4) < skyFromNelm(5));
});
ok('suburban 150: showpieces are obvious or visible', () => { for (const m of ['M57', 'M13', 'M11', 'M45', 'M42', 'M31', 'M81']) assert.ok(R(m).level <= 1, m); });
ok('suburban 150: famous faint ones are challenging or not tonight', () => { for (const m of ['M74', 'M101']) assert.ok(R(m).level >= 2, m); });
ok('M81 beats M101 (the question that started this)', () => assert.ok(R('M81').margin > R('M101').margin + 1));
ok('darker sky never hurts, bigger scope never hurts', () => {
  for (const o of sky.objects.filter((x) => !x.key.startsWith('st:'))) {
    const a = rate(o, { alt: 50, nelm: 5 }, S150), b = rate(o, { alt: 50, nelm: 6.3 }, S150), c = rate(o, { alt: 50, nelm: 5 }, S200);
    if (!a) continue; assert.ok(b.margin >= a.margin - 1e-9, o.label); assert.ok(c.level <= a.level, o.label);
  }
});
ok('a bright Moon nearby hurts galaxies and says so', () => {
  const r = R('M51', { nelm: 5.5, moonAlt: 40, moonFrac: 1, moonSep: 30 }); assert.ok(r.margin < R('M51', { nelm: 5.5 }).margin - 1); assert.equal(r.cause, 'moon');
  assert.match(describe(find('M51'), r), /Moon/);
});
ok('big non-Messier nebulae are not tonight from the suburbs', () => assert.equal(R('Caldwell 33').level, 3));

ok('night events in order (Guelph, Nov 13 2026)', () => {
  const n = sky.night(new Date(2026, 10, 13));
  assert.ok(n.set < n.naut && n.naut < n.astro && n.astro < n.astroAm && n.astroAm < n.rise);
});
const n = sky.night(new Date(2026, 10, 13));
const rows = planTargets(sky, { start: n.astro, hours: 2, scope: S150, nelm: 5 });
ok('a 2-hour suburban plan has a sensible mix', () => {
  const by = [0, 1, 2].map((l) => rows.filter((r) => r.level === l).length);
  assert.ok(rows.length > 60 && by.every((c) => c > 5), by.join('/'));
  assert.ok(rows.every((r) => r.alt >= 20 && r.from <= r.best && r.best <= r.to && r.desc));
  assert.ok(rows.some((r) => r.o.label === 'M31' && r.level <= 1));
});
ok('a darker sky offers more targets', () => assert.ok(planTargets(sky, { start: n.astro, hours: 2, scope: S150, nelm: 6.3 }).length > rows.length));
ok('daylight session only offers the daylight planets', () => {
  const d = planTargets(sky, { start: new Date(Date.UTC(2026, 10, 13, 16)), hours: 1, scope: S150 });
  assert.ok(d.length && d.every((r) => r.o.planet), d.map((r) => r.o.label).join());
});
ok('next dark night is within a month', () => { const d = nextDarkNight(sky, new Date(2026, 10, 13)); assert.ok(d && d - new Date(2026, 10, 13) <= 31 * 864e5); });
import { autoPlan, interest, kindOf } from '../docs/js/plan.js';
{
  const pick = autoPlan(rows, { hours: 2 });
  ok('auto plan: about four targets an hour, varied, mostly easy', () => {
    assert.ok(pick.length >= 6 && pick.length <= 9, pick.length);
    const kinds = new Set(pick.map((r) => kindOf(r.o)));
    assert.ok(kinds.size >= 4, [...kinds].join());
    assert.ok(pick.filter((r) => r.level === 2).length <= 1);
    assert.ok(pick.every((r) => r.to - r.from >= 30 * 60000), 'nothing that is only briefly up');
    assert.equal(new Set(pick.map((r) => r.key)).size, pick.length);
  });
  ok('auto plan includes a planet when one is up, and a double star', () => {
    assert.ok(pick.some((r) => r.o.planet), pick.map((r) => r.o.label).join());
    assert.ok(pick.some((r) => kindOf(r.o) === 'DS'), pick.map((r) => r.o.label).join());
  });
  ok('famous things outrank obscure ones', () => {
    assert.ok(interest(find('M13')) > interest(find('NGC 7686')));
    assert.ok(interest(find('Saturn')) > interest(find('M13')));
    assert.ok(interest(find('Albireo')) > interest(sky.objects.find((o) => o.key.startsWith('ds:') && /^HD/.test(o.label))));
  });
  const { steps, notUp } = routePlan(sky, pick, { start: n.astro, hours: 2, minAlt: 20 });
  const tg = steps.filter((x) => x.kind === 'target'), sy = steps.filter((x) => x.kind === 'sync');
  ok('route visits every target once', () => { assert.equal(tg.length + notUp.length, pick.length); assert.equal(new Set(tg.map((x) => x.o.key)).size, tg.length); });
  ok('route adds only a few sync stars', () => assert.ok(sy.length <= Math.ceil(tg.length / 2), `${sy.length} sync stars for ${tg.length} targets`));
  ok('a sync star is never also a later target', () => { for (const x of sy) assert.ok(!tg.some((t) => t.o.key === x.o.key)); });
  ok('things about to set come first', () => {
    const urgent = pick.filter((r) => r.to - n.astro < 45 * 60000).map((r) => r.key);
    const firstK = tg.slice(0, Math.max(1, urgent.length)).map((x) => x.o.key);
    for (const k of urgent.slice(0, 1)) assert.ok(firstK.includes(k), k);
  });
  console.log('    route:', steps.map((x) => (x.kind === 'sync' ? '★' : '') + x.o.label).join(' → '));
}
ok('showpiece stars are targets; alignment stars are not', () => {
  assert.ok(rate(find('Albireo'), { alt: 50, nelm: 5 }, S150));
  assert.equal(rate(find('Markab'), { alt: 50, nelm: 5 }, S150), null);
  assert.ok(find('Albireo').pairs && find('Mizar').pairs, 'famous doubles carry pair data');
});
ok('corrected star names keep their ids', () => { const m = sky.objects.find((o) => o.key === 'st:Merck'); assert.equal(m.label, 'Merak'); });
ok('every routed plan opens with a sync star (or a bright star that serves as one)', () => {
  for (const date of ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15', '2026-11-16']) {
    const day = new Date(date + 'T12:00:00-05:00'), n = sky.night(day), start = n.astro || n.naut;
    for (const scope of [S150, S200]) {
      const rows = planTargets(sky, { start, hours: 2, scope });
      for (const pick of [autoPlan(rows, { hours: 2 }), rows.filter((r) => r.o.planet).slice(0, 2), rows.filter((r) => r.o.t === 'GX').slice(0, 3)]) {
        if (!pick.length) continue;
        const { steps } = routePlan(sky, pick, { start, hours: 2, minAlt: 20 });
        if (!steps.length) continue;
        const f = steps[0], bright = f.o.key.startsWith('st:') && f.o.mag <= 2.6;
        assert.ok(f.kind === 'sync' || bright, `${date}: plan opens with ${f.o.label} (${f.kind})`);
      }
    }
  }
});
ok('the opening sync star is bright, well placed, and not needed when the first target is a bright star', () => {
  const at = new Date('2026-11-16T21:00:00-05:00'), m57 = sky.objects.find((o) => o.label === 'M57'), vega = sky.objects.find((o) => o.key === 'st:Vega');
  const s = openingSync(sky, m57, at);
  assert.ok(s && s.o.mag <= 2.6 && s.alt > 20 && s.alt < 75, 'a bright star at a comfortable height');
  assert.equal(openingSync(sky, vega, at), null);
});
const sepOf = (a, b) => Math.acos(Math.max(-1, Math.min(1, Math.sin(a.alt * Math.PI / 180) * Math.sin(b.alt * Math.PI / 180) + Math.cos(a.alt * Math.PI / 180) * Math.cos(b.alt * Math.PI / 180) * Math.cos((a.az - b.az) * Math.PI / 180)))) * 180 / Math.PI;
ok('close neighbours are visited together and the route beats nearest-next', () => {
  const want = ['M81', 'M82', 'M31', 'M32', 'M110', 'M13', 'M57', 'M27', 'M15', 'M2', 'M45', 'M33', 'M103', 'M52', 'Albireo', 'Saturn', 'M11', 'M34'];
  for (const [when, hours] of [['2026-11-17T18:33:00-05:00', 2], ['2026-11-17T20:00:00-05:00', 3], ['2027-03-10T20:30:00-05:00', 3], ['2027-07-10T22:30:00-04:00', 2]]) {
    const start = new Date(when), rows = planTargets(sky, { start, hours, scope: S150, nelm: 5, minAlt: 20 });
    const pick = want.map((l) => rows.find((r) => r.o.label === l)).filter(Boolean); if (pick.length < 6) continue;
    const each = Math.max(5, Math.min(20, hours * 60 / pick.length)) * 60000;
    const ord = orderTargets(sky, pick, { start, each, minAlt: 20 }), lab = ord.map((r) => r.o.label), at = (l) => lab.indexOf(l);
    assert.equal(new Set(lab).size, pick.length);
    if (at('M81') >= 0 && at('M82') >= 0) assert.equal(Math.abs(at('M81') - at('M82')), 1, `${when}: ${lab.join(' ')}`);
    if (at('M31') >= 0 && at('M32') >= 0) assert.equal(Math.abs(at('M31') - at('M32')) <= 2, true, `${when}: ${lab.join(' ')}`);
    // nearest-next, the old way, for comparison
    const nn = [], pool = pick.slice(); let cur = null, i = 0;
    while (pool.length) { const tt = new Date(start.getTime() + i * each); pool.sort((a, b) => (cur ? sepOf(cur, sky.altAz(a.o, tt)) - sepOf(cur, sky.altAz(b.o, tt)) : sky.altAz(b.o, tt).alt - sky.altAz(a.o, tt).alt)); const r = pool.shift(); nn.push(r); cur = sky.altAz(r.o, tt); i++; }
    const a = travelOf(sky, ord, { start, each }), b = travelOf(sky, nn, { start, each });
    console.log(`     ${when.slice(0, 16)}: ${pick.length} targets, ${a.toFixed(0)}° of travel (nearest-next: ${b.toFixed(0)}°)`);
    assert.ok(a <= b * 1.25, `${when}: ${a} vs ${b}`);      // nearest-next ignores rise and set times, so it can be a little shorter when those bind
    // every target is visited inside its window and above the limit
    ord.forEach((r, k) => { const tt = new Date(start.getTime() + k * each); if (r.to && r.to - start < 45 * 60000) return; assert.ok(sky.altAz(r.o, tt).alt >= 17, `${when}: ${r.o.label} at ${sky.altAz(r.o, tt).alt.toFixed(1)}°`); if (r.to && r.to - start >= 45 * 60000) assert.ok(tt <= r.to, `${when}: ${r.o.label} after its window`); });     // (several things setting at once cannot all be caught)
  }
});
ok('a pair is not split when one of them is a hair under the height limit', () => {
  const start = new Date('2026-11-17T18:33:00-05:00'), find2 = (l) => ({ o: sky.objects.find((o) => o.label === l), key: l });
  const a81 = sky.altAz(find2('M81').o, start).alt, a82 = sky.altAz(find2('M82').o, start).alt, lim = Math.max(a81, a82) - 0.2;      // one above, one just below
  const pick = ['M81', 'M82', 'M31', 'M57', 'M45', 'M13', 'M15'].map(find2);
  const lab = orderTargets(sky, pick, { start, each: 8 * 60000, minAlt: lim }).map((r) => r.key);
  assert.equal(Math.abs(lab.indexOf('M81') - lab.indexOf('M82')), 1, lab.join(' '));
});
console.log('plan tests passed');

// Build 119: globulars break into stars by aperture and sky (Harris 2010 horizontal-branch magnitudes)
ok('M13: an 80 mm shows a glow, a 16-inch under a dark sky resolves it across the face', () => {
  const S80 = { aperture: 80, fl: 600, eyepieces: eps }, S400 = { aperture: 406, fl: 1624, eyepieces: eps };
  const m13 = find('M13'); assert.equal(m13.id, 'NGC 6205');
  assert.ok(R('M13', { nelm: 5 }, S80).res <= 1);
  assert.equal(R('M13', { nelm: 6.3 }, S400).res, 3);
  assert.ok(R('M13', { nelm: 6.3 }, S150).res > R('M13', { alt: 25, moonAlt: 40, moonFrac: 0.97, moonSep: 90 }, S150).res);   // a dark night shows more than a moonlit one
  assert.match(describe(m13, R('M13', { nelm: 6.3 }, S400)), /resolved/);
});

// Build 123: race codes can carry a shared start time; codes without one are unchanged
import { encodeChallenge as encC, decodeChallenge as decC } from '../docs/js/game.js';
ok('race code: shared start time round-trips, and a plain code still reads', () => {
  const t0 = Date.UTC(2026, 10, 26, 2, 0, 0), start = t0 + 60000;
  const plain = encC({ style: 'push', tokens: ['M13', 'M57'], created: t0, host: 'Bryan' });
  assert.equal(plain.split('|').length, 6); assert.equal(decC(plain).start, null);
  const timed = encC({ style: 'push', tokens: ['M13', 'M57'], created: t0, host: 'Bryan', start });
  const d = decC(timed); assert.equal(d.start, start); assert.deepEqual(d.tokens, ['M13', 'M57']); assert.equal(d.host, 'Bryan');
  assert.throws(() => decC(timed.replace('M57', 'M58')), /damaged/);
});
