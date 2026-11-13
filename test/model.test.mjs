import { rotFromEuler, mulMV, altAzFromVec, axisFrom, fitAlignment, MOUNTINGS, wrap360, wrap180, tangentOffset, guidance, fitDeviation, PointingModel } from '../docs/js/model.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// Euler sanity
let R = rotFromEuler(0, 0, 0); let e = altAzFromVec(mulMV(R, [0,1,0])); ok(near(e.alt,0,1e-9)&&near(e.az,0,1e-9), 'flat, top north -> alt0 az0');
R = rotFromEuler(0, 30, 0); e = altAzFromVec(mulMV(R, [0,1,0])); ok(near(e.alt,30,1e-9)&&near(e.az,0,1e-9), 'beta 30 -> alt 30');
R = rotFromEuler(90, 0, 0); e = altAzFromVec(mulMV(R, [0,1,0])); ok(near(e.az,270,1e-9), 'alpha 90 -> top points west (az 270)');
R = rotFromEuler(0, 0, 0); e = altAzFromVec(mulMV(R, [0,0,-1])); ok(near(e.alt,-90,1e-9), 'flat: camera looks down');
// orthonormal
R = rotFromEuler(123, 45, -30); const cols=[0,1,2].map(j=>[R[0][j],R[1][j],R[2][j]]);
ok(cols.every(c=>near(Math.hypot(...c),1,1e-12)), 'R columns unit length');

// Alignment recovery with synthetic data
function rng(seed){ return ()=>{ seed=(seed*16807)%2147483647; return (seed-1)/2147483646; }; }
const r = rng(42); const gauss=()=>{ let u=0,v=0; while(!u)u=r(); v=r(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };
function synth(theta, p, q, n, noiseDeg, mounting='top-sky'){
  const d0 = MOUNTINGS[mounting].d, dT = axisFrom(d0, p, q), obs=[];
  for (let i=0;i<n;i++){
    // a telescope pose: random azimuth (alpha), altitude 15..75 via beta, small random roll gamma (phone not level on tube)
    const Rm = rotFromEuler(r()*360, 15+r()*60, (r()-0.5)*20);
    const s = altAzFromVec(mulMV(Rm, dT));
    obs.push({ R: Rm, alt: s.alt + gauss()*noiseDeg, az: wrap360(s.az + theta + gauss()*noiseDeg) });
  }
  return obs;
}
for (const [th,p,q] of [[37,1.5,-2],[ -120, -3, 0.5],[5,0,0]]) {
  const obs = synth(th,p,q,4,0);
  const f = fitAlignment(obs, MOUNTINGS['top-sky'].d, {p:0,q:0}, {priorWeight:0});
  ok(near(f.theta,th,1e-3)&&near(f.p,p,1e-3)&&near(f.q,q,1e-3)&&f.rms<1e-3, `4-star exact fit th=${th} p=${p} q=${q} -> ${f.theta.toFixed(4)} ${f.p.toFixed(4)} ${f.q.toFixed(4)}`);
}
{ const obs = synth(80,2,-1,1,0); const f = fitAlignment(obs, MOUNTINGS['top-sky'].d, {p:2,q:-1});
  ok(near(f.theta,80,1e-6)&&!f.solvedAxis, '1-star with known calibration recovers theta exactly'); }
{ const obs = synth(80,2,-1,1,0); const f = fitAlignment(obs, MOUNTINGS['top-sky'].d, {p:0,q:0});
  ok(f.rms>0.5, `1-star without calibration: uncorrected 2.2° tilt shows as ${f.rms.toFixed(2)}° residual (theta ${f.theta.toFixed(2)})`); }
{ // noisy: 0.3 deg sensor-ish noise, 6 stars
  const obs = synth(-45,1,1,6,0.3); const f = fitAlignment(obs, MOUNTINGS['top-sky'].d);
  ok(near(f.theta,-45,0.6)&&near(f.p,1,0.8)&&near(f.q,1,0.8), `6 stars, 0.3° noise: th ${f.theta.toFixed(2)} p ${f.p.toFixed(2)} q ${f.q.toFixed(2)} rms ${f.rms.toFixed(2)}`); }
for (const m of ['top-mirror','camera']) { const obs = synth(10,-1,2,4,0,m); const f = fitAlignment(obs, MOUNTINGS[m].d, {p:0,q:0},{priorWeight:0});
  ok(near(f.theta,10,1e-3)&&near(f.p,-1,1e-3)&&near(f.q,2,1e-3), `mounting ${m} exact fit`); }

// Model pointing after fit equals truth
{ const obs = synth(33,1,-1,3,0); const f = fitAlignment(obs, MOUNTINGS['top-sky'].d,{p:0,q:0},{priorWeight:0});
  const M = new PointingModel('top-sky'); Object.assign(M,{theta:f.theta,p:f.p,q:f.q});
  const t = synth(33,1,-1,5,0); const worst = Math.max(...t.map(o=>{ const pt=M.pointing(o.R); return Math.hypot(pt.alt-o.alt, wrap180(pt.az-o.az)*Math.cos(o.alt*Math.PI/180)); }));
  ok(worst<1e-3, `fitted model predicts unseen poses (worst ${worst.toExponential(1)}°)`); }

// Guidance & tangent
{ const g = guidance({alt:20,az:350},{alt:30,az:10}); ok(near(g.dAz,20,1e-9)&&near(g.dAlt,10,1e-9), 'guidance wraps across north'); }
{ const t = tangentOffset({alt:0,az:0},{alt:0,az:1}); ok(t.x>0.99&&t.x<1.01&&near(t.y,0,1e-9), 'tangent: +az is right'); 
  const u = tangentOffset({alt:40,az:100},{alt:41,az:100}); ok(near(u.x,0,1e-9)&&u.y>0.99&&u.y<1.01, 'tangent: +alt is up'); }
// Deviation fit
{ const az=[0,45,90,135,180,225,270,315]; const e=az.map(a=>-10+3*Math.sin((a+20)*Math.PI/180));
  const d=fitDeviation(az,e); ok(near(d.offset,-10,1e-6)&&near(d.amplitude,3,1e-6), `compass deviation fit offset ${d.offset.toFixed(3)} amp ${d.amplitude.toFixed(3)}`); }
console.log(fails? `${fails} FAILED`:'all passed'); process.exit(fails?1:0);
