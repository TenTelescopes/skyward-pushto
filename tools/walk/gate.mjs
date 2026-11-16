import { correctionTable } from '../../docs/js/dome.js';
import { rotFromEuler, mulMV, altAzFromVec, axisFrom, MOUNTINGS, wrap360, wrap180, sepDeg } from '../../docs/js/model.js';
const d0 = MOUNTINGS['top-sky'].d, r = 61.7, D = Math.PI / 180;
let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) * Math.SQRT2; };
const TILT = { p: 1, q: -1.5 }, LIVE = { p: 1.3, q: -1.1 };       // true tilt, and what a 2-star alignment typically gets (a bit off)
const sense = (R, t) => altAzFromVec(mulMV(R, axisFrom(d0, t.p, t.q)));
const shapes = {
  clean: (alt, az) => ({ alt, az }),
  warp: (alt, az) => ({ alt: alt + 0.5 * Math.cos(az * D), az: wrap360(az + 0.6 * Math.sin(az * D) / Math.max(0.3, Math.cos(alt * D))) }),
  bend: (alt, az) => ({ alt, az: wrap360(az + 2 * (alt / 90) ** 2) }),
  scale1pc: (alt, az) => ({ alt, az: wrap360(az + 0.01 * (az - 180)) }),
  accel: (alt, az) => ({ alt: alt + 0.4 * Math.sin(2 * alt * D), az }),
};
function run(shape, { n = 8, walk = 0, lin = 0, step = 0, noise = 0, gap = 4, tag = false } = {}) {
  const t0 = Date.UTC(2026, 10, 3, 1); let head = 25; const P = [];
  const truth = (R, h) => { const s = sense(R, TILT); return shapes[shape](s.alt, wrap360(s.az + h)); };
  for (let i = 0; i < n; i++) {
    const t = t0 + i * gap * 60000; head += walk * gauss() + lin * gap + (step && i === Math.floor(n / 2) ? step : 0);
    const R = rotFromEuler(rnd() * 360, 15 + rnd() * 60, (rnd() - 0.5) * 10), tr = truth(R, head);
    P.push({ R, alt: tr.alt + noise * gauss() / 60, az: wrap360(tr.az + noise * gauss() / 60 / Math.cos(tr.alt * D)), t, label: 'S' + i, ep: tag && step && i >= Math.floor(n / 2) ? 1 : 0 });
  }
  const s = P[n - 1], now = s.t, T = correctionTable(P, d0, LIVE, { r, minChecks: +(process.env.MC || 2), gain: +(process.env.GAIN || 0.85) });
  const b = sense(s.R, LIVE), thetaLive = wrap180(s.az - b.az);
  let raw = 0, fixed = 0; const m = 30;
  for (let k = 0; k < m; k++) {
    const R = rotFromEuler(rnd() * 360, 20 + rnd() * 50, (rnd() - 0.5) * 10), tr = truth(R, head), a = sense(R, LIVE);
    raw += sepDeg(a.alt, wrap360(a.az + thetaLive), tr.alt, tr.az) * 60 / m;
    if (T) { const c = T.point(R, now, { tSet: now, anchor: T.anchorFor(s, now) }); fixed += sepDeg(c.alt, c.az, tr.alt, tr.az) * 60 / m; }
  }
  return { raw, fixed: T ? fixed : raw, helps: !!(T && T.check.helps), table: !!T, chk: T && T.check };
}
const cases = [
  ['clean', {}], ['clean', { noise: 4 }], ['warp', {}], ['warp', { noise: 4 }], ['bend', {}], ['scale1pc', {}], ['accel', {}],
  ['clean', { walk: 0.3 }], ['clean', { lin: 0.05 }], ['clean', { lin: 0.15 }], ['clean', { step: 4 }], ['clean', { step: 15 }],
  ['warp', { walk: 0.3 }], ['warp', { lin: 0.05 }], ['bend', { walk: 0.3, noise: 4 }], ['warp', { step: 6 }],
  ['clean', { noise: 15 }], ['warp', { noise: 15 }], ['bend', { noise: 15, walk: 0.5 }], ['clean', { walk: 1 }], ['warp', { walk: 1 }],
  ['clean', { step: 4, tag: true }], ['clean', { step: 40, tag: true }], ['warp', { step: 6, tag: true }], ['clean', { step: 0.7 }], ['clean', { step: 2 }],
];
console.log('case'.padEnd(34), 'n', ' raw′', ' always-on′', ' gated′', ' used%', ' worse-when-used%');
for (const n of (process.env.NS || '5,8,14').split(',').map(Number)) for (const [shape, o] of cases) {
  let raw = 0, fx = 0, gated = 0, used = 0, worse = 0; const N = 150;
  for (let k = 0; k < N; k++) { const x = run(shape, { ...o, n }); raw += x.raw / N; fx += x.fixed / N; gated += (x.helps ? x.fixed : x.raw) / N; if (x.helps) { used++; if (x.fixed > x.raw * 1.1 + 1) worse++; } }
  console.log(`${shape} ${JSON.stringify(o)}`.padEnd(34), String(n).padStart(2), raw.toFixed(1).padStart(6), fx.toFixed(1).padStart(8), gated.toFixed(1).padStart(8), (100 * used / N).toFixed(0).padStart(6), used ? (100 * worse / used).toFixed(0).padStart(6) : '     -');
}
