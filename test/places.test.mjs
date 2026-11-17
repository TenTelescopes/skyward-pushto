import assert from 'node:assert/strict';
import { distKm, nearPlaces, uniqueName, relocate, planAutoName, partOfDay, coordText } from '../docs/js/places.js';
const ok = (name, f) => { f(); console.log('ok  ', name); };
const home = { lat: 43.55, lon: -80.25 };
const P = [{ id: 'a', name: 'Backyard', ...home }, { id: 'b', name: 'Front yard', lat: 43.5502, lon: -80.2501 }, { id: 'c', name: 'Cottage', lat: 45.02, lon: -79.3 }, { id: 'd', name: 'Park', lat: 43.56, lon: -80.26 }];
ok('distances are sane', () => { assert.ok(distKm(home, home) < 1e-9); const d = distKm(home, { lat: 44.55, lon: -80.25 }); assert.ok(Math.abs(d - 111.2) < 0.5, String(d)); assert.ok(distKm(P[0], P[1]) < 0.05); assert.ok(distKm(P[0], P[3]) > 1); });
ok('places at the same address are both "here"; the park and the cottage are not', () => assert.deepEqual(nearPlaces(P, 43.55, -80.25).map((p) => p.id), ['a', 'b']));
ok('names never collide', () => { assert.equal(uniqueName([], 'Backyard'), 'Backyard'); assert.equal(uniqueName(['Backyard'], 'backyard'), 'backyard 2'); assert.equal(uniqueName(['Backyard', 'Backyard 2'], 'Backyard'), 'Backyard 3'); assert.equal(uniqueName([], '  '), 'My spot'); });
ok('a new position keeps, switches, asks or clears the place', () => {
  assert.deepEqual(relocate(P, 'b', 43.5501, -80.25), { id: 'b', why: 'stay' });
  assert.equal(relocate(P, 'a', 45.0201, -79.3).id, 'c'); assert.equal(relocate(P, 'a', 45.0201, -79.3).why, 'switch');
  const r = relocate(P, 'c', 43.55, -80.25); assert.equal(r.why, 'choose'); assert.equal(r.id, null); assert.equal(r.choices.length, 2);
  assert.deepEqual(relocate(P, 'a', 50, -100), { id: null, why: 'left' });
  assert.deepEqual(relocate([], null, 43.55, -80.25), { id: null, why: 'left' });
});
ok('plans name themselves from the date and the place', () => {
  assert.equal(planAutoName(new Date(2026, 10, 17, 19, 30), 'Backyard', 'en-CA'), 'Tue Nov 17 evening · Backyard');
  assert.equal(planAutoName(new Date(2026, 10, 18, 1, 0), 'Cottage', 'en-CA'), 'Tue Nov 17 night · Cottage');     // after midnight: still Tuesday's session
  assert.equal(planAutoName(new Date(2026, 10, 17, 6, 0), '', 'en-CA'), 'Tue Nov 17 morning');
  assert.equal(partOfDay(new Date(2026, 0, 1, 14)), 'afternoon'); assert.equal(coordText(43.551, -80.249), '43.55°N 80.25°W');
});
console.log('places tests passed');
