// The automatic plan's choices, checked against what experienced observers would suggest (Nov 2026 audit).
import assert from 'node:assert/strict';
import { Sky } from '../docs/js/astro.js';
import { planTargets, autoPlan, doubleInterest } from '../docs/js/plan.js';
import { rate, setSeeing } from '../docs/js/vis.js';

const sky = new Sky(); sky.setSite(43.55, -80.25, 330);
const eps = [23, 10, 4].map((f) => ({ name: `${f} mm`, fl: f, afov: 62 }));
const S150 = { aperture: 150, fl: 750, eyepieces: eps };
const find = (l) => sky.objects.find((o) => o.label === l || (o.cats || []).includes(l));
const ep = (l, c = {}) => { const r = rate(find(l), { alt: 60, nelm: 6.3, ...c }, S150); return r && r.ep && r.ep.name; };
const ok = (name, f) => { f(); console.log('ok  ', name); };

ok('M40 (two dim stars) ranks below the showpiece doubles', () => {
  for (const d of ['Albireo', 'Almach', 'Castor', 'Mizar']) assert.ok(doubleInterest(find(d)) > doubleInterest(find('M40')) + 2, d);
});
ok('globulars get enough power to start resolving them', () => { assert.equal(ep('M13'), '10 mm'); assert.equal(ep('M15'), '10 mm'); });
ok('faint galaxies are never pushed to a sub-2 mm exit pupil', () => {
  for (const g of ['M65', 'M91', 'M98', 'M51', 'M81']) assert.notEqual(ep(g), '4 mm', g);
});
ok('big objects get the widest field', () => { assert.equal(ep('M31'), '23 mm'); assert.equal(ep('M45'), '23 mm'); assert.equal(ep('M42'), '23 mm'); });
ok('planets: 75× on an average night, more when the air is steady', () => {
  const sat = find('Saturn'); sky.altAz(sat, new Date('2026-12-10T00:00:00Z'));
  let r = rate(sat, { alt: 40, nelm: 5, sunAlt: -20 }, S150); assert.equal(r.ep.name, '10 mm'); assert.equal(r.epSteady.name, '4 mm');
  setSeeing('good'); r = rate(sat, { alt: 40, nelm: 5, sunAlt: -20 }, S150); assert.equal(r.ep.name, '4 mm'); setSeeing('average');
});
ok('M31 shows from the city by its bright core', () => {
  const r = rate(find('M31'), { alt: 60, nelm: 4.3 }, S150); assert.ok(r.level <= 1, `level ${r.level}`);
});
ok('a year of automatic plans: no M40, no M32/M43 beside their hosts, nothing deep-sky beside a bright Moon', () => {
  for (let m = 0; m < 12; m++) {
    const start = new Date(Date.UTC(2027, m, 10, 1, 0));
    const rows = planTargets(sky, { start, hours: 3, scope: S150, nelm: 5.5, minAlt: 20 });
    const pick = autoPlan(rows, { hours: 3 }), labels = pick.map((r) => r.o.label);
    assert.ok(!labels.includes('M40'), `M40 in ${m + 1}`);
    if (labels.includes('M31')) assert.ok(!labels.includes('M32') && !labels.includes('M110'));
    if (labels.includes('M42')) assert.ok(!labels.includes('M43'));
    for (const r of pick) if (!r.o.planet) assert.ok(!(r.moonSep < 15 && r.moonFrac > 0.3), `${r.o.label} by the Moon`);
  }
});
