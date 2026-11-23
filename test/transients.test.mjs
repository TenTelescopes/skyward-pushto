// Build 103: meteor showers, comet orbits, aurora outlook.
import * as A from '../docs/vendor/astronomy.mjs';
import { activeShowers, orbitRaDec, auroraView, geomagLat, feedObjects } from '../docs/js/transients.js';
const ok = (c, m) => { if (!c) throw new Error('FAIL ' + m); console.log('ok  ', m); };

// Orbit maths against Astronomy Engine: Mars from JPL's approximate Keplerian elements (Standish), 2026-11-23.
const date = new Date('2026-11-23T05:00:00Z'), JD = date.getTime() / 864e5 + 2440587.5, T = (JD - 2451545) / 36525;
const v = [1.52371034, 0.00001847, 0.09339410, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343];
const a = v[0] + v[1] * T, e = v[2] + v[3] * T, I = v[4] + v[5] * T, L = v[6] + v[7] * T, w = v[8] + v[9] * T, N = v[10] + v[11] * T;
const M = ((L - w) % 360 + 540) % 360 - 180, n = 0.9856076686 / a ** 1.5;
const c = orbitRaDec({ q: a * (1 - e), e, i: I, node: N, peri: w - N, tpJd: JD - M / n, H: null }, date);
const eq = A.EquatorFromVector(A.GeoVector('Mars', A.MakeTime(date), false));
const err = Math.hypot((c.ra - eq.ra * 15) * Math.cos(eq.dec * Math.PI / 180), c.dec - eq.dec) * 60;
ok(err < 1, `Mars from its orbit within 1′ of Astronomy Engine (${err.toFixed(2)}′)`);
// Parabola, ellipse and hyperbola agree where they meet (e → 1).
const base = { q: 0.5, i: 40, node: 100, peri: 60, tpJd: JD - 30, H: 6, k: 10 };
const p0 = orbitRaDec({ ...base, e: 0.9999999 }, date), p1 = orbitRaDec({ ...base, e: 1 }, date), p2 = orbitRaDec({ ...base, e: 1.0000001 }, date);
ok(Math.abs(p0.ra - p1.ra) < 1e-3 && Math.abs(p2.ra - p1.ra) < 1e-3 && Math.abs(p0.dec - p2.dec) < 1e-3, 'ellipse, parabola and hyperbola meet at e = 1');

// Showers by date (solar longitude), across New Year too.
const ids = (d) => activeShowers(new Date(d)).map((s) => s.id);
ok(ids('2026-12-14T07:00:00Z').includes('GEM') && Math.abs(activeShowers(new Date('2026-12-14T07:00:00Z')).find((s) => s.id === 'GEM').daysFromPeak) < 1, 'Geminids active and at peak on Dec 14');
ok(ids('2027-01-03T12:00:00Z').includes('QUA') && ids('2026-12-30T12:00:00Z').includes('QUA'), 'Quadrantids span New Year');
ok(!ids('2026-06-15T12:00:00Z').length, 'nothing in the list mid-June');

// Aurora: southern Ontario needs about Kp 5 for the northern horizon.
const g = geomagLat(43.65, -79.38);
ok(g > 51 && g < 55, `Toronto geomagnetic latitude ${g.toFixed(1)}°`);
ok(!auroraView(4, 43.65, -79.38) && auroraView(5, 43.65, -79.38) && auroraView(7, 43.65, -79.38).height > auroraView(5, 43.65, -79.38).height, 'aurora from Toronto at Kp 5, higher at Kp 7, not at Kp 4');

// Feed parsing.
const F = feedObjects({ comets: [{ id: 'C/2099 X1', name: 'Test', tp: '2026-12-01.5', q: 0.6, e: 1.0002, i: 50, node: 120, peri: 80, H: 7, k: 10 }], fixed: [{ id: 'N Test 2026', ra: 280, dec: 20, mag: 6.5, kind: 'Nova' }] });
ok(F.length === 2 && F[0].key === 'cm:C/2099 X1' && F[0].orbit.tpJd > 2461000 && F[1].t === 'TR', 'feed comets and novae become objects');
