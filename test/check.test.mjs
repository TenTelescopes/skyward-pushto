import { gradeCheck, analyzeSwing, analyzeAltSweep, analyzeHorizonTurn } from '../docs/js/check.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const r = 61.7; // 23 mm / 67° on the 150 Compact: field radius in arcmin
const rev = (std) => ({ pairs: [{}, {}], pitchBias: 5, rollBias: 5, pitchBiasStd: std, rollBiasStd: std });
const still = (n, drift) => ({ altNoise: n, azNoise: n, azDrift: drift });
const sw = (perTurn) => ({ worst: perTurn, per90: perTurn / 4, compassWorst: null });
const base = { sensors: { gyro: true, rateHz: 60 }, reversal: rev(1), still: still(1, 0.005), swing: sw(20),
  sweep: { altMax: 89, ceiling: 85, geometric: 10, indexError: null }, turns: [{ altDynamic: 2, baseTilt: 0.5 }] };
let g = gradeCheck(base, r); ok(g.verdict === 'solid', `good numbers -> solid (${g.verdict})`);
g = gradeCheck({ ...base, sensors: { gyro: false, rateHz: 60 } }, r); ok(g.verdict === 'unsuitable', 'no gyro -> not suitable');
g = gradeCheck({ ...base, still: still(1, 0.2) }, r); ok(g.verdict === 'poor', `0.2°/min drift (half-field in ~2.6 min) -> poor (${g.verdict})`);
g = gradeCheck({ ...base, still: still(1, 0.05) }, r); ok(g.verdict === 'usable', `0.05°/min drift (~10 min) -> usable (${g.verdict})`);
g = gradeCheck({ ...base, still: still(8, 0.005) }, r); ok(g.verdict === 'usable', `11′ jitter -> usable (${g.verdict})`);
g = gradeCheck({ ...base, still: still(15, 0.005) }, r); ok(g.verdict === 'poor', `21′ jitter -> poor (${g.verdict})`);
g = gradeCheck({ ...base, swing: sw(300) }, r); ok(g.verdict === 'poor', `5° per full turn (75′ per 90° push) -> poor (${g.verdict})`);
g = gradeCheck({ ...base, swing: null }, r); ok(g.verdict === 'incomplete', 'skipped step -> incomplete');
g = gradeCheck(base, 15); ok(g.verdict !== 'solid', `same phone, high-power eyepiece (15′ radius) is graded stricter (${g.verdict})`);
g = gradeCheck({ ...base, still: { ...still(1, 0.005), compassNoise: 200 } }, r); ok(g.verdict === 'solid' && g.compass === 'poor', 'bad compass alone does not fail a good gyro phone');
const s = analyzeSwing([{ alt: 30, az: 100, caz: 50 }, { alt: 30.1, az: 100.2, caz: 50.5, turned: 361 }, { alt: 30, az: 99.9, caz: 49.8, turned: -360 }]);
ok(Math.abs(s.worst - Math.hypot(6, 12 * Math.cos(30 * Math.PI / 180))) < 0.2, `swing error computed on sky (${s.worst.toFixed(2)}′)`);
// --- horizon → zenith sweep: geometry (phone not square) must be separated from sensor wander
{ const S=[]; for (let k=0;k<15;k++) S.push({alt:0, az:120}); for (let i=0;i<=300;i++){ const alt=i*0.3; const geo=0.5*Math.sin(alt*Math.PI/180); // 0.5° geometric skew on sky
    const noise = alt>70 ? (Math.sin(i*1.7))*2.5 : (Math.sin(i*1.7))*0.05;                 // sensor wander grows above 70°
    const onsky=geo+noise; S.push({alt, az: 120 + onsky/Math.max(0.02,Math.cos(alt*Math.PI/180))}); }
  const w = analyzeAltSweep(S, r, true);
  ok(Math.abs(w.geometric*1 - 30) < 3, `sweep separates 0.5° geometric skew (${w.geometric.toFixed(1)}′)`);
  ok(w.ceiling >= 65 && w.ceiling <= 75, `sweep finds the altitude where the wander starts (${w.ceiling}°)`);
  ok(Math.abs(w.indexError) < 0.01, 'levelled start gives altitude zero offset'); }
// --- full turn at the horizon: base tilt + dynamic alt error + compass deviation
{ const S=[]; for (let i=0;i<=720;i++){ const az=i*0.5; const alt=3+1.2*Math.sin((az+40)*Math.PI/180)+0.05*Math.sin(i*2.3);
    S.push({az:az%360, alt, caz:(az+10+4*Math.sin((az+70)*Math.PI/180))%360}); }
  const t = analyzeHorizonTurn(S);
  ok(Math.abs(t.baseTilt-1.2)<0.05, `turn: base tilt ${t.baseTilt.toFixed(2)}° (1.2° simulated)`);
  ok(t.altDynamic<4, `turn: dynamic alt error ${t.altDynamic.toFixed(1)}′ (≈2.1′ simulated)`);
  ok(Math.abs(t.compassDeviation-4)<0.1, `turn: compass deviation ±${t.compassDeviation.toFixed(2)}° (±4° simulated)`);
  ok(analyzeHorizonTurn(S.slice(0,300)).incomplete, 'partial turn is flagged incomplete'); }
{ const g = gradeCheck({ ...base, sweep:{altMax:89,ceiling:85,geometric:10,indexError:null}, turns:[{altDynamic:2,baseTilt:0.5,compassDeviation:1}] }, r);
  ok(g.verdict==='solid', `full good check -> solid (${g.verdict})`);
  const g2 = gradeCheck({ ...base, sweep:{altMax:89,ceiling:55,geometric:10}, turns:[{altDynamic:2,baseTilt:0.5}] }, r);
  ok(g2.verdict==='poor', 'reliable only to 55° -> poor');
  const g3 = gradeCheck({ ...base, sweep:{altMax:60,ceiling:60,geometric:10}, turns:[{altDynamic:2,baseTilt:0.5}] }, r);
  ok(g3.verdict==='incomplete', 'sweep that never got near zenith -> incomplete, not poor'); }
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
