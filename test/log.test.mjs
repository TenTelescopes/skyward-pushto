import assert from 'node:assert/strict';
import { Sky } from '../docs/js/astro.js';
import { seenKeys, lastEntry, logStats, MILESTONES, achieved, newlyAchieved, logCSV } from '../docs/js/log.js';
import { tickInterval } from '../docs/js/sound.js';
import { blurbFor, BLURBS, NAMES } from '../docs/data/blurbs.js';

const sky = new Sky();
const key = (label) => sky.objects.find((o) => o.label === label).key;
const ok = (name, f) => { f(); console.log('ok  ', name); };
const E = (label, seen = 'yes', t = Date.UTC(2026, 10, 15, 2)) => ({ key: key(label), label, t, seen, scope: 'Skyward 150 Compact', ep: '23 mm' });

ok('only "yes" entries count as seen', () => {
  const log = [E('M13'), E('M31', 'maybe'), E('M57', 'no')];
  assert.deepEqual([...seenKeys(log)], [key('M13')]);
  assert.equal(lastEntry(log, key('M31')).seen, 'maybe'); assert.equal(lastEntry(log, key('M1')), null);
});
ok('stats count each object once, by kind', () => {
  const log = [E('M13'), E('M13'), E('M31'), E('M45'), E('M42'), E('Albireo'), E('Saturn'), E('Moon'), E('M57')];
  const s = logStats(log, sky.objects);
  assert.equal(s.total, 8); assert.equal(s.messier, 5); assert.equal(s.messierTotal, 110);
  assert.deepEqual([s.types.GC, s.types.GX, s.types.OC, s.types.NEB, s.types.DS, s.types.PL], [1, 1, 1, 2, 1, 1]);
  assert.equal(s.moon, true); assert.equal(s.nights, 1);
});
ok('an evening and the small hours after it are one night out', () => {
  const s = logStats([E('M13', 'yes', new Date(2026, 10, 14, 22).getTime()), E('M31', 'yes', new Date(2026, 10, 15, 1).getTime()), E('M45', 'yes', new Date(2026, 10, 15, 22).getTime())], sky.objects);
  assert.equal(s.nights, 2);
});
ok('milestones arrive in order and only once', () => {
  const none = logStats([], sky.objects), one = logStats([E('M13')], sky.objects);
  assert.deepEqual(achieved(none), []);
  assert.deepEqual(newlyAchieved(none, one).map((m) => m.id), ['first']);
  assert.deepEqual(newlyAchieved(one, logStats([E('M13'), E('M13')], sky.objects)), []);
  const kinds = logStats([E('M13'), E('M31'), E('M45'), E('M42'), E('Albireo')], sky.objects);
  assert.ok(achieved(kinds).includes('kinds') && achieved(kinds).includes('five'));
  assert.equal(new Set(MILESTONES.map((m) => m.id)).size, MILESTONES.length);
});
ok('CSV export has a header and one row per entry', () => {
  const csv = logCSV([E('M13'), E('M31', 'maybe')], sky.objects).split('\n');
  assert.equal(csv.length, 3); assert.match(csv[0], /object/); assert.match(csv[1], /Great Hercules Cluster/); assert.match(csv[2], /not sure/);
});
ok('approach ticks speed up toward the target and stop inside the field', () => {
  assert.equal(tickInterval(30, 1), null); assert.equal(tickInterval(0.5, 1), null);
  const far = tickInterval(20, 1), mid = tickInterval(5, 1), near = tickInterval(1.2, 1);
  assert.ok(far > mid && mid > near && near >= 140 && far <= 900, `${far} ${mid} ${near}`);
});
ok('every write-up and friendly name belongs to a real object', () => {
  const labels = new Set(sky.objects.flatMap((o) => [o.label, o.id]));
  for (const k of [...Object.keys(BLURBS), ...Object.keys(NAMES)]) assert.ok(labels.has(k), `no object called ${k}`);
  assert.ok(blurbFor(sky.objects.find((o) => o.label === 'M13')).includes('Hercules') || blurbFor(sky.objects.find((o) => o.label === 'M13')).length > 20);
  assert.equal(blurbFor(null), null);
});
console.log('log tests passed');
