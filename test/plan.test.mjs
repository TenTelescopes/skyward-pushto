import assert from 'node:assert/strict';
import { Sky } from '../docs/js/astro.js';
import { planTargets, routePlan, nextDarkNight } from '../docs/js/plan.js';
import { rate, skyFromNelm, describe } from '../docs/js/vis.js';

const sky = new Sky(); sky.setSite(43.55, -80.25, 330);          // Guelph
const eps = [23, 10, 4].map((f) => ({ name: `${f} mm`, fl: f, afov: 62 }));
const S150 = { aperture: 150, fl: 750, eyepieces: eps }, S200 = { aperture: 203, fl: 812, eyepieces: eps };
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
{
  const pick = rows.filter((r) => r.level === 0).slice(0, 12);
  const { steps, notUp } = routePlan(sky, pick, { start: n.astro, hours: 3 });
  const tg = steps.filter((s) => s.kind === 'target'), sy = steps.filter((s) => s.kind === 'sync');
  ok('route visits every target once', () => { assert.equal(tg.length + notUp.length, pick.length); assert.equal(new Set(tg.map((s) => s.o.key)).size, tg.length); });
  ok('route adds sync stars, but not before every target', () => { assert.ok(sy.length >= 1 && sy.length < tg.length); });
  console.log('    route:', steps.map((s) => (s.kind === 'sync' ? '★' : '') + s.o.label).join(' → '));
}
console.log('plan tests passed');
