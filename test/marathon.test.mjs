import assert from 'node:assert/strict';
import { Sky } from '../docs/js/astro.js';
import { marathonList, pick, nightOf, isMessier, PER_OBJECT_MIN } from '../docs/js/marathon.js';
import { emptyHorizon, setWedge, limitAt, blocked, wedgeLevel, newTrace, traceAdd, traceFinish, traceCoverage, hasHorizon, summary, LEVELS } from '../docs/js/horizon.js';

const sky = new Sky(); sky.setSite(43.55, -80.25, 330);          // Guelph
const eps = [23, 10, 4].map((f) => ({ name: `${f} mm`, fl: f, afov: 62 }));
const S150 = { aperture: 150, fl: 750, eyepieces: eps };
const ok = (name, f) => { f(); console.log('ok  ', name); };

// ---- horizon
ok('an empty horizon blocks nothing', () => { const H = emptyHorizon(); assert.equal(hasHorizon(H), false); assert.equal(blocked(H, 1, 123), false); assert.equal(limitAt(null, 10), 0); });
ok('tapping a wedge blocks that direction and leaves the rest clear', () => {
  const H = setWedge(emptyHorizon(), 0, 2);                       // north, tall (30°)
  assert.ok(Math.abs(limitAt(H, 0) - 30) < 1e-9); assert.ok(Math.abs(limitAt(H, 350) - 30) < 1e-9); assert.ok(Math.abs(limitAt(H, 15) - 30) < 1e-9);
  assert.equal(limitAt(H, 90), 0); assert.equal(limitAt(H, 180), 0); assert.equal(limitAt(H, 300), 0);
  assert.equal(blocked(H, 20, 5), true); assert.equal(blocked(H, 35, 5), false); assert.equal(blocked(H, 5, 180), false);
  assert.equal(wedgeLevel(H, 0), 2); assert.equal(wedgeLevel(H, 4), 0);
  assert.match(summary(H), /30° toward N/);
});
ok('every direction belongs to exactly one wedge', () => {
  let H = emptyHorizon(); for (let k = 0; k < 8; k++) H = setWedge(H, k, 1);
  for (let az = 0; az < 360; az += 1) assert.ok(Math.abs(limitAt(H, az) - LEVELS[1].alt) < 1e-9, String(az));
});
ok('a full trace reproduces the skyline that was swept', () => {
  const sk = (az) => 10 + 20 * Math.max(0, Math.cos((az - 200) * Math.PI / 180));    // a hill to the SSW
  const T = newTrace(); for (let az = 0; az < 360; az += 1.5) traceAdd(T, sk(az), az);
  assert.equal(traceCoverage(T), 1);
  const H = traceFinish(T); assert.equal(H.how, 'trace');
  for (let az = 0; az < 360; az += 7) assert.ok(Math.abs(limitAt(H, az) - sk(az)) < 1.5, `${az}: ${limitAt(H, az)} vs ${sk(az)}`);
});
ok('gaps in a trace are bridged from both sides, and readings below the horizon count as clear', () => {
  const T = newTrace(); for (let az = 0; az < 360; az += 2) if (az < 100 || az > 140) traceAdd(T, az < 100 ? 10 : 30, az);
  assert.ok(traceCoverage(T) < 1);
  const H = traceFinish(T); const mid = limitAt(H, 120); assert.ok(mid > 12 && mid < 28, String(mid));
  const T2 = newTrace(); traceAdd(T2, -5, 50); traceAdd(T2, NaN, 60); assert.equal(traceFinish(T2).h[10], 0);
});

// ---- marathon
const N = nightOf(sky, new Date('2026-11-16T19:00:00-05:00'));
ok('before noon still counts as last night', () => {
  assert.equal(N.id, '2026-11-16'); assert.equal(nightOf(sky, new Date('2026-11-17T03:00:00-05:00')).id, '2026-11-16');
  assert.ok(N.naut < N.nautAm);
});
const start = new Date('2026-11-16T18:30:00-05:00'), end = N.nautAm;
const rows = marathonList(sky, { start, end, scope: S150, nelm: 5.5 });
console.log(`     mid-November, Guelph, 150 mm, good suburban sky: ${rows.length} of 110 Messier objects in reach tonight; first to go: ${rows.slice(0, 6).map((r) => r.o.label).join(' ')}`);
ok('the list is Messier only, each with a window inside the night', () => {
  assert.ok(rows.length > 40 && rows.length <= 110, String(rows.length));
  for (const r of rows) { assert.ok(isMessier(r.o)); assert.ok(r.from >= start && r.to > r.from, r.o.label); }
  const lab = new Set(rows.map((r) => r.o.label)); for (const m of ['M31', 'M45', 'M42', 'M13', 'M57']) assert.ok(lab.has(m), m);
});
ok('a darker sky never shrinks the list', () => assert.ok(marathonList(sky, { start, end, scope: S150, nelm: 6.3 }).length >= rows.length));
ok('it starts with something that is about to set', () => {
  const p = pick(sky, rows, { now: start });
  assert.ok(p.next); assert.equal(p.why, 'setting');
  const early = rows.slice(0, 8).map((r) => r.key); assert.ok(early.includes(p.next.key), p.next.o.label);
  const pos = sky.altAz(p.next.o, start); assert.ok(pos.az > 180 && pos.az < 330, `${p.next.o.label} az ${pos.az}`);      // in the west
});
ok('with nothing urgent it takes the nearest one', () => {
  const now = new Date('2026-11-16T23:00:00-05:00');
  const calm = rows.filter((r) => r.from <= now && (r.to - now) / 60000 > 300);
  const at = sky.altAz(calm[3].o, now);
  const p = pick(sky, calm, { now, cur: at, done: new Set([calm[3].key]) });
  assert.equal(p.why, 'near');
  const d = (r) => { const q = sky.altAz(r.o, now); return Math.acos(Math.min(1, Math.sin(at.alt * Math.PI / 180) * Math.sin(q.alt * Math.PI / 180) + Math.cos(at.alt * Math.PI / 180) * Math.cos(q.alt * Math.PI / 180) * Math.cos((at.az - q.az) * Math.PI / 180))) * 180 / Math.PI; };
  const nearest = Math.min(...calm.filter((r) => r !== calm[3]).map(d));
  assert.ok(d(p.next) < nearest + 20, `${d(p.next)} vs ${nearest}`);
});
ok('a skipped object goes to the back, and comes back when it is all that is left', () => {
  const p = pick(sky, rows, { now: start });
  const later = new Map([[p.next.key, start.getTime() + 20 * 60000]]);
  const q = pick(sky, rows, { now: start, later }); assert.notEqual(q.next.key, p.next.key);
  const only = pick(sky, [p.next], { now: start, later }); assert.equal(only.next.key, p.next.key); assert.equal(only.why, 'skipped');
});
ok('objects that have set are counted as missed, not offered', () => {
  const now = new Date('2026-11-17T02:00:00-05:00'); const p = pick(sky, rows, { now });
  assert.ok(p.missed > 0); assert.ok(p.next.to > now); assert.equal(p.left + p.missed, rows.length);
});
ok('playing the whole night at a few minutes each bags nearly everything in reach', () => {
  const done = new Set(); let now = new Date(start), cur = null, guard = 0, waits = 0;
  while (now < end && guard++ < 2000) {
    const p = pick(sky, rows, { now, done, cur });
    if (!p.next) { if (!p.waiting) break; now = new Date(Math.max(now.getTime() + 60000, p.waiting.from.getTime())); waits++; continue; }
    const pos = sky.altAz(p.next.o, now); assert.ok(pos.alt >= 11.5, `${p.next.o.label} at ${pos.alt}`);
    done.add(p.next.key); cur = pos; now = new Date(now.getTime() + PER_OBJECT_MIN * 60000);
  }
  console.log(`     simulated night: ${done.size} of ${rows.length} found`);
  assert.ok(done.size >= rows.length - 3, `${done.size} of ${rows.length}`);
});
ok('a marked obstruction removes what is only ever behind it and never sends you there', () => {
  let H = emptyHorizon(); for (const k of [5, 6, 7]) H = setWedge(H, k, 3);       // SW, W, NW blocked below 50°
  const r2 = marathonList(sky, { start, end, scope: S150, nelm: 5.5, horizon: H });
  assert.ok(r2.length < rows.length, `${r2.length} vs ${rows.length}`);
  let now = new Date(start); const done = new Set();
  for (let i = 0; i < 40; i++) {
    const p = pick(sky, r2, { now, done, horizon: H }); if (!p.next) break;
    const pos = sky.altAz(p.next.o, now); assert.equal(blocked(H, pos.alt, pos.az), false, p.next.o.label);
    done.add(p.next.key); now = new Date(now.getTime() + PER_OBJECT_MIN * 60000);
  }
});
console.log('marathon + horizon tests passed');
