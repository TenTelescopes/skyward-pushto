import { fitConsistency, pairConsistency, outliers, verdict, correctionTable, splitJumps } from '../docs/js/dome.js';
import { rotFromEuler, mulMV, altAzFromVec, axisFrom, MOUNTINGS, wrap360, wrap180, sepDeg } from '../docs/js/model.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const d0 = MOUNTINGS['top-sky'].d, r = 61.7;
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
function make(n, { theta = 25, p = 1, q = -1.5, rate = 0, distort = null, bad = -1, jump = null, tag = false, walk = 0 } = {}) {
  const pts = [], t0 = Date.UTC(2026, 10, 3, 1); let wander = 0;
  for (let i = 0; i < n; i++) {
    const R = rotFromEuler(rnd() * 360, 15 + rnd() * 60, (rnd() - 0.5) * 10), t = t0 + i * 90000;
    const s = altAzFromVec(mulMV(R, axisFrom(d0, p, q)));
    let alt = s.alt, az = wrap360(s.az + theta + rate * (t - t0) / 60000);
    if (jump && i >= jump.at) az = wrap360(az + jump.by);            // the gyro heading jumped (app in the background, a knock)
    if (walk) { wander += walk * (rnd() - 0.5) * 2; az = wrap360(az + wander); }
    if (distort) ({ alt, az } = distort(alt, az));
    if (i === bad) az = wrap360(az + 6);
    pts.push({ R, alt, az, t, label: 'S' + i, ep: tag && jump && i >= jump.at ? 1 : 0 });
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

// ---- sky correction: overall fit to every confirmed object + a lookup table of what is left over
const tilt = { p: 1, q: -1.5 }, TH = 25;
// A smooth, direction-dependent error of the kind a slightly unlevel base or a bent sensor response gives.
const warp = (alt, az) => ({ alt: alt + 0.5 * Math.cos(az * Math.PI / 180), az: wrap360(az + 0.6 * Math.sin(az * Math.PI / 180) / Math.max(0.3, Math.cos(alt * Math.PI / 180))) });
// Azimuth error that grows with altitude (what the simulator's "bend" does).
const bend = (alt, az) => ({ alt, az: wrap360(az + 2 * (alt / 90) ** 2) });
const live = (R, theta, p = tilt.p, q = tilt.q) => { const s = altAzFromVec(mulMV(R, axisFrom(d0, p, q))); return { alt: s.alt, az: wrap360(s.az + theta) }; };
const truthOf = (R, distort) => { const s = live(R, TH); return distort ? distort(s.alt, s.az) : s; };
/**
 * Mean pointing error (arcmin) at fresh directions: the live model (offset set by a Sync on the last point, tilt as
 * aligned) against the same thing with sky correction.
 */
function trial(P, T, distort, { n = 40, liveTilt = tilt, head = 0 } = {}) {
  const s = P[P.length - 1], now = s.t;
  const thetaLive = wrap180(s.az - live(s.R, 0, liveTilt.p, liveTilt.q).az), anchor = T.anchorFor(s, now);
  let raw = 0, fixed = 0, worstRaw = 0, worstFixed = 0;
  for (let i = 0; i < n; i++) {
    const R = rotFromEuler(rnd() * 360, 20 + rnd() * 50, (rnd() - 0.5) * 10), tr0 = truthOf(R, distort), tr = { alt: tr0.alt, az: wrap360(tr0.az + head) };
    const a = live(R, thetaLive, liveTilt.p, liveTilt.q), c = T.point(R, now, { tSet: now, anchor });
    const e0 = sepDeg(a.alt, a.az, tr.alt, tr.az) * 60, e1 = sepDeg(c.alt, c.az, tr.alt, tr.az) * 60;
    raw += e0; fixed += e1; worstRaw = Math.max(worstRaw, e0); worstFixed = Math.max(worstFixed, e1);
  }
  const sync = T.point(s.R, now, { tSet: now, anchor });
  return { raw: raw / n, fixed: fixed / n, worstRaw, worstFixed, atSync: Math.abs(wrap180(sync.az - s.az)) * 60 };
}
ok(correctionTable(make(2), d0, tilt, { r }) === null, 'fewer than 3 objects: no correction at all');
P = make(8); let T = correctionTable(P, d0, tilt, { r });
ok(T && T.n === 8 && T.maxSky * 60 < 1, `clean sky: nothing left to correct (largest leftover ${(T.maxSky * 60).toFixed(2)}′)`);
let tr = trial(P, T, null);
ok(tr.fixed < 1 && tr.raw < 1, `clean sky: correction leaves good pointing alone (${tr.raw.toFixed(2)}′ -> ${tr.fixed.toFixed(2)}′)`);
P = make(12, { distort: warp }); T = correctionTable(P, d0, tilt, { r }); tr = trial(P, T, warp);
ok(T && tr.fixed < 0.6 * tr.raw, `warped sky, 12 objects: mean error ${tr.raw.toFixed(0)}′ -> ${tr.fixed.toFixed(0)}′`);
ok(tr.atSync < 1, `...and the object just synced on stays exact (${tr.atSync.toFixed(2)}′)`);
P = make(5, { distort: warp }); T = correctionTable(P, d0, tilt, { r }); tr = trial(P, T, warp);
ok(T && tr.fixed < tr.raw * 1.05, `warped sky, only 5 objects: no worse than uncorrected (${tr.raw.toFixed(0)}′ -> ${tr.fixed.toFixed(0)}′)`);
P = make(10, { distort: bend }); T = correctionTable(P, d0, tilt, { r }); tr = trial(P, T, bend);
ok(T && tr.fixed < 0.6 * tr.raw, `error growing with altitude, 10 objects: ${tr.raw.toFixed(0)}′ -> ${tr.fixed.toFixed(0)}′`);
{ // the phone was aligned with a slightly wrong tilt (two stars only): every later sync should repair it
  P = make(9); T = correctionTable(P, d0, { p: 1.6, q: -0.7 }, { r }); tr = trial(P, T, null, { liveTilt: { p: 1.6, q: -0.7 } });
  ok(T && tr.fixed < 0.3 * tr.raw && tr.fixed < 3, `tilt mis-set by ~1°: ${tr.raw.toFixed(0)}′ -> ${tr.fixed.toFixed(1)}′ once 9 objects are in`);
  const Tfixed = correctionTable(P, d0, { p: 1.6, q: -0.7 }, { r, calibrate: false });
  ok(Tfixed && Math.abs(Tfixed.fit.p - 1.6) < 1e-9, 'with tilt solving switched off, the live tilt is kept');
}
P = make(9, { bad: 4 }); T = correctionTable(P, d0, tilt, { r });
ok(T && T.dropped === 1 && !T.used.includes(4), `a wrong star is left out (dropped ${T && T.dropped})`);
tr = trial(P, T, null);
ok(tr.fixed < 3, `...and doesn't drag the correction with it (${tr.fixed.toFixed(1)}′ on a clean sky)`);
{ // cap, fade and ageing of the lookup table
  const big = make(10, { distort: (alt, az) => ({ alt: alt + 2.5 * Math.sin(az * Math.PI / 90), az }) });
  const Tb = correctionTable(big, d0, tilt, { r, maxErr: 10, calibrate: false });
  let worst = 0; for (let az = 0; az < 360; az += 20) for (let alt = 10; alt < 80; alt += 15) worst = Math.max(worst, Tb.field(alt, az, big[9].t).sky);
  ok(worst <= 2 + 1e-9, `the table never moves the arrows more than 2° (worst ${worst.toFixed(2)}°)`);
  const lone = make(4), Tl = correctionTable(lone, d0, tilt, { r });
  let minC = 1; for (let az = 0; az < 360; az += 10) for (let alt = 5; alt < 90; alt += 10) minC = Math.min(minC, Tl.field(alt, az, lone[3].t).c);
  ok(minC < 0.6, `away from the data the table's say fades (down to ${minC.toFixed(2)})`);
  const old = make(6, { distort: warp }), Tn = correctionTable(old, d0, tilt, { r }), p0 = old[0];
  const fresh = Tn.field(p0.alt, p0.az, p0.t), later = Tn.field(p0.alt, p0.az, p0.t + 4 * 3600000);
  ok(later.c < fresh.c * 0.5, `four hours on, an old object has much less say (${fresh.c.toFixed(2)} -> ${later.c.toFixed(2)})`);
  ok(Tn.anchorFor(null) === 0, 'no sync to anchor on: no anchor');
}

// ---- heading jumps: each stretch between jumps gets its own offset
P = make(10, { jump: { at: 5, by: 40 }, tag: true }); f = fitConsistency(P, d0);
ok(f.epochs === 2 && f.max < 1 && Math.abs(wrap180(f.thetas[9] - f.thetas[0]) - 40) < 0.05, `flagged 40° heading jump: no distortion left (max ${f.max.toFixed(2)}′, jump ${wrap180(f.thetas[9] - f.thetas[0]).toFixed(2)}°)`);
ok(Math.abs(f.theta0 - f.thetas[9]) < 1e-9, 'the offset reported is the one in force now');
P = make(10, { jump: { at: 5, by: 5 } }); f = fitConsistency(P, d0);
ok(f.max > 60, `the same jump unflagged shows up as inconsistency (max ${f.max.toFixed(0)}′)`);
let E = splitJumps(P, d0, tilt, { r });
ok(new Set(E).size === 2 && E[4] !== E[5] && E[0] === E[4] && E[5] === E[9], `...and is found from the data: cut between objects 5 and 6 (${E.join(' ')})`);
T = correctionTable(P, d0, tilt, { r }); tr = trial(P, T, null, { head: 5 });
ok(T && T.jumps === 1 && T.dropped === 0 && tr.fixed < 2, `...so the table keeps all 10 objects and stays accurate (${tr.fixed.toFixed(1)}′)`);
E = splitJumps(make(12, { distort: warp }), d0, tilt, { r });
ok(new Set(E).size === 1, 'a warped sky is not mistaken for a jump');
E = splitJumps(make(12, { rate: 0.1 }), d0, tilt, { r });
ok(new Set(E).size === 1, 'steady drift is not mistaken for a jump');

// ---- the replay check: the correction is only used when it would have helped on the objects already confirmed
P = make(12, { distort: warp }); T = correctionTable(P, d0, tilt, { r });
ok(T.check.helps && T.check.n >= 2 && T.check.fixed < T.check.raw, `warped sky: replay says it helps (${T.check.raw.toFixed(0)}′ -> ${T.check.fixed.toFixed(0)}′ over ${T.check.n} objects)`);
P = make(12); T = correctionTable(P, d0, tilt, { r });
ok(T && !T.check.helps, `clean sky, phone tilt already right: nothing to gain, so it stands by (${T.check.raw.toFixed(1)}′ vs ${T.check.fixed.toFixed(1)}′)`);
P = make(5, { distort: bend }); T = correctionTable(P, d0, tilt, { r });
ok(T && !T.check.helps && T.check.short === 1, 'five objects: not used yet, one short of the six it wants');
P = make(6, { distort: bend }); T = correctionTable(P, d0, tilt, { r });
ok(T && T.check.helps, `six objects on a bent sky: in use (${T.check.raw.toFixed(0)}′ -> ${T.check.fixed.toFixed(0)}′)`);
P = make(12, { walk: 1.5 }); T = correctionTable(P, d0, tilt, { r });
ok(!T || !T.check.helps, `a heading that wanders at random: no pattern to learn, so it stands by${T ? ` (${T.check.raw.toFixed(0)}′ vs ${T.check.fixed.toFixed(0)}′)` : ''}`);
ok(correctionTable(make(8, { distort: warp }), d0, tilt, { r, validate: false }).check === undefined, 'the check can be skipped');
{ // objects handed over out of order are sorted by time first
  const A = make(9, { distort: bend }), B = [A[3], A[8], A[0], A[5], A[1], A[7], A[2], A[6], A[4]];
  const Ta = correctionTable(A, d0, tilt, { r }), Tb = correctionTable(B, d0, tilt, { r });
  ok(Math.abs(Ta.check.fixed - Tb.check.fixed) < 1e-9 && Ta.n === Tb.n, 'order of the list does not matter');
}
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
