import { fitConsistency, pairConsistency, outliers, verdict } from '../docs/js/dome.js';
import { rotFromEuler, mulMV, altAzFromVec, axisFrom, MOUNTINGS, wrap360 } from '../docs/js/model.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const d0 = MOUNTINGS['top-sky'].d, r = 61.7;
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
function make(n, { theta = 25, p = 1, q = -1.5, rate = 0, distort = null, bad = -1 } = {}) {
  const pts = [], t0 = Date.UTC(2026, 10, 3, 1);
  for (let i = 0; i < n; i++) {
    const R = rotFromEuler(rnd() * 360, 15 + rnd() * 60, (rnd() - 0.5) * 10), t = t0 + i * 90000;
    const s = altAzFromVec(mulMV(R, axisFrom(d0, p, q)));
    let alt = s.alt, az = wrap360(s.az + theta + rate * (t - t0) / 60000);
    if (distort) ({ alt, az } = distort(alt, az));
    if (i === bad) az = wrap360(az + 6);
    pts.push({ R, alt, az, t, label: 'S' + i });
  }
  return pts;
}
let P = make(6, { rate: 0.05 }); let f = fitConsistency(P, d0);
ok(f.max < 0.5 && Math.abs(f.rate - 0.05) < 1e-3, `clean data incl. 0.05°/min drift: no distortion left (max ${f.max.toFixed(2)}′, rate ${f.rate.toFixed(4)})`);
ok(verdict(f, pairConsistency(P, d0, f.p, f.q), r).level === 'good', 'clean data -> consistent');
// a bent sky: azimuth error growing with altitude (e.g. sensor fusion trouble high up) — not a rotation, can't be fitted away
P = make(8, { distort: (alt, az) => ({ alt, az: wrap360(az + 0.04 * alt * alt / 30) }) }); f = fitConsistency(P, d0);
const pc = pairConsistency(P, d0, f.p, f.q);
ok(f.max > r / 4, `altitude-dependent distortion survives the fit (part is absorbed by tilt/offset) (max ${f.max.toFixed(1)}′)`);
ok(verdict(f, pc, r).level !== 'good', `distorted sky is flagged (${verdict(f, pc, r).level})`);
// one wrong star among good ones
P = make(7, { bad: 4 }); f = fitConsistency(P, d0); const o = outliers(f, r);
ok(o.length === 1 && o[0] === 4, `wrong star singled out (${o})`);
// pair check needs no model
P = make(4); const pc2 = pairConsistency(P, d0, 1, -1.5);
ok(pc2.worst < 0.01, `pair distances match on a clean sky (${pc2.worst.toExponential(1)}′)`);
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
