// Phone check: a 4-minute, no-stars test that grades this phone in this mount for push-to use.
// Every grade compares a measured number with the eyepiece's field radius r, because "good enough"
// depends on what has to land in the eyepiece. The cut-offs are design choices (not yet field-validated);
// the raw measurements are kept so the thresholds can be tuned against real observing reports.
import { sepDeg, wrap180, D2R, mean, std, unwrap } from './model.js';

export const GRADE = { good: 'Good', ok: 'OK', poor: 'Poor', fail: 'Missing', na: 'Not tested' };

/** Swing test: marks = [start, afterTurn1, afterTurn2], each {alt, az, caz, turned}. */
export function analyzeSwing(marks) {
  if (marks.length < 2) return null;
  const s = marks[0];
  const err = (m) => sepDeg(s.alt, s.az, m.alt, m.az) * 60;
  const cerr = (m) => (s.caz == null || m.caz == null) ? null : Math.abs(wrap180(m.caz - s.caz)) * 60 * Math.cos(s.alt * D2R);
  const turns = marks.slice(1).map((m) => ({ turned: m.turned, err: err(m), compassErr: cerr(m), dAlt: (m.alt - s.alt) * 60, dAz: wrap180(m.az - s.az) * 60 * Math.cos(s.alt * D2R) }));
  const worst = Math.max(...turns.map((t) => t.err));
  const cw = turns.map((t) => t.compassErr).filter((v) => v != null);
  return { turns, worst, per90: worst * 90 / 360, compassWorst: cw.length ? Math.max(...cw) : null };
}

/** Least squares y = Σ c_k·f_k(x). Returns {c, resid}. */
function lsq(rows, y) {
  const n = rows[0].length, A = Array.from({ length: n }, () => Array(n).fill(0)), b = Array(n).fill(0);
  rows.forEach((r, i) => { for (let a = 0; a < n; a++) { b[a] += r[a] * y[i]; for (let k = 0; k < n; k++) A[a][k] += r[a] * r[k]; } });
  for (let a = 0; a < n; a++) A[a][a] += 1e-9;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } }
  const c = M.map((r, i) => r[n] / r[i]);
  return { c, resid: y.map((v, i) => v - rows[i].reduce((s, f, k) => s + f * c[k], 0)) };
}

/**
 * Altitude sweep, horizon → zenith, moving only the altitude axis. On a Dob the azimuth must not change, so any
 * azimuth wander is error. Smooth wander of the form a + b·sin(alt) is geometry (phone not square to the tube),
 * which star alignment removes; what's left over is sensor error. Reports the altitude up to which it stays
 * within half the eyepiece field. `levelled`: the user levelled the tube with a bubble level at the start.
 */
export function analyzeAltSweep(samples, r, levelled = false) {
  if (!samples || samples.length < 20) return null;
  const alt = samples.map((x) => x.alt), az = unwrap(samples.map((x) => x.az));
  const lowN = Math.min(15, Math.max(3, Math.floor(samples.length * 0.05)));      // the stationary moment at Mark start
  const az0 = mean(az.slice(0, lowN)), startAlt = mean(alt.slice(0, lowN));
  const dev = az.map((v, i) => (v - az0) * Math.cos(alt[i] * D2R) * 60);           // signed, arcmin on sky
  // Fit the geometric part where the sensors are most trustworthy (below 60°), then judge every altitude against it.
  let idx = alt.map((a, i) => a <= 60 ? i : -1).filter((i) => i >= 0); if (idx.length < 10) idx = alt.map((_, i) => i);
  const fit = lsq(idx.map((i) => [1, Math.sin(alt[i] * D2R)]), idx.map((i) => dev[i]));
  const res = dev.map((d, i) => Math.abs(d - (fit.c[0] + fit.c[1] * Math.sin(alt[i] * D2R))));
  const bins = [];
  for (let lo = Math.floor(Math.min(...alt) / 5) * 5; lo < Math.max(...alt); lo += 5) {
    const v = res.filter((_, i) => alt[i] >= lo && alt[i] < lo + 5).sort((a, b) => a - b);
    if (v.length >= 3) bins.push({ lo, hi: lo + 5, p90: v[Math.floor(v.length * 0.9)], n: v.length });
  }
  let ceiling = null;
  for (const b of bins) { if (b.p90 > r / 2) break; ceiling = b.hi; }
  // Near the horizon phone sensors are at their best, so large wander there isn't sensor error: the base (or a
  // hand-held phone) turned. That makes the sweep invalid rather than the phone poor.
  const low = bins.filter((b) => b.lo < 30);
  const invalid = low.length > 0 && low.some((b) => b.p90 > r / 2);
  return { altMin: Math.min(...alt), altMax: Math.max(...alt), ceiling: ceiling == null ? Math.min(...alt) : Math.min(ceiling, Math.max(...alt)),
           geometric: Math.abs(fit.c[1]), sensorP90: res.slice().sort((a, b) => a - b)[Math.floor(res.length * 0.9)], bins,
           indexError: levelled ? startAlt * 60 : null, invalid };
}

/**
 * One full turn in azimuth near the horizon. Altitude is fitted as a + b·sin(az) + c·cos(az):
 * the sinusoid is the mount base being off level (real geometry, informational); the leftover is the tilt
 * sensor's error while moving. Compass − gyro over the same turn gives the compass deviation curve without stars.
 */
export function analyzeHorizonTurn(samples) {
  if (!samples || samples.length < 30) return null;
  const az = unwrap(samples.map((x) => x.az)), alt = samples.map((x) => x.alt);
  const span = Math.abs(az[az.length - 1] - az[0]);
  if (span < 300) return { span, incomplete: true };
  const rows = az.map((a) => [1, Math.sin(a * D2R), Math.cos(a * D2R)]);
  const fa = lsq(rows, alt);
  const out = { span, meanAlt: mean(alt), baseTilt: Math.hypot(fa.c[1], fa.c[2]), altDynamic: std(fa.resid) * 60 };
  const cs = samples.map((x, i) => x.caz == null ? null : [az[i], x.caz]).filter(Boolean);
  if (cs.length > 30) {
    const d = unwrap(cs.map(([a, c]) => wrap180(c - a)));
    const fc = lsq(cs.map(([a]) => [1, Math.sin(a * D2R), Math.cos(a * D2R)]), d);
    out.compassDeviation = Math.hypot(fc.c[1], fc.c[2]); out.compassResid = std(fc.resid);
  }
  return out;
}

/**
 * Grade everything. Inputs (any may be missing):
 *   sensors:  {gyro: true|false|null, rateHz, compass: bool}
 *   reversal: analyzeReversal() result
 *   still:    analyzeStillness() result
 *   swing:    analyzeSwing() result
 *   r:        eyepiece field radius in arcminutes
 */
export function gradeCheck({ sensors, reversal, still, swing, sweep, turns }, r) {
  const M = [];
  const add = (key, name, value, grade, note, critical = true) => M.push({ key, name, value, grade, note, critical });
  const by = (v, good, ok) => v == null || isNaN(v) ? 'na' : v <= good ? 'good' : v <= ok ? 'ok' : 'poor';
  const am = (v) => v == null || isNaN(v) ? '—' : v >= 60 ? `${(v / 60).toFixed(2)}°` : `${v.toFixed(1)}′`;

  // 1. Gyroscope — without one, the phone fakes rotation from the compass and accelerometer.
  if (sensors.gyro === false) add('gyro', 'Gyroscope', 'not found', 'fail', 'This phone reports no gyroscope. Readings will swing and drift with every nearby magnet; push-to will not be reliable.');
  else add('gyro', 'Gyroscope', sensors.gyro ? 'present' : 'could not confirm', sensors.gyro ? 'good' : 'na', sensors.gyro ? '' : 'The phone did not report rotation rates, so the gyro could not be confirmed.');
  // 2. Update rate
  add('rate', 'Sensor update rate', sensors.rateHz ? `${sensors.rateHz.toFixed(0)} Hz` : '—', sensors.rateHz ? (sensors.rateHz >= 50 ? 'good' : sensors.rateHz >= 20 ? 'ok' : 'poor') : 'na',
    sensors.rateHz && sensors.rateHz < 20 ? 'Slow updates make the display lag behind the scope.' : '', false);
  // 3. Tilt consistency (reversal repeatability). Bias itself is absorbed by alignment, so it is informational.
  if (reversal) {
    const rep = reversal.pairs.length > 1 ? Math.max(reversal.pitchBiasStd, reversal.rollBiasStd) : null;
    add('tilt', 'Tilt sensor consistency', rep == null ? 'needs 2 pairs' : am(rep), by(rep, r / 20, r / 6), 'Tilt readings differed between identical placements. Put the phone against the same edge each time on a firm table, then rerun; if it stays high, the tilt sensor itself is inconsistent.');
    const b = Math.hypot(reversal.pitchBias, reversal.rollBias);
    add('bias', 'Tilt sensor offset', am(b), b <= 60 ? 'good' : b <= 180 ? 'ok' : 'poor', b > 60 ? 'Large but fixed — a 2-star alignment calibrates it out.' : 'Calibrated out by alignment either way.', false);
  } else add('tilt', 'Tilt sensor consistency', '—', 'na', '');
  // 4. Noise: jitter while still, both axes combined, vs the field.
  if (still) {
    const n = Math.hypot(still.altNoise, still.azNoise);
    add('noise', 'Jitter while still (1σ)', am(n), by(n, r / 10, r / 4), n > r / 4 ? 'The pointer will wander noticeably; raise Smoothing in Setup.' : '');
    // 5. Drift: minutes until gyro azimuth drift uses up half the field.
    const rate = Math.abs(still.azDrift) * 60; // arcmin per minute
    const mins = rate > 0 ? (r / 2) / rate : Infinity;
    add('drift', 'Gyro drift', `${(still.azDrift).toFixed(3)}°/min`, mins >= 20 ? 'good' : mins >= 5 ? 'ok' : 'poor',
      isFinite(mins) ? `Re-sync about every ${mins >= 60 ? 'hour or more' : Math.max(1, Math.floor(mins)) + ' min'} to stay within half a field.` : '');
    if (still.compassNoise != null) add('cnoise', 'Compass jitter (1σ)', am(still.compassNoise), by(still.compassNoise, r / 4, r), 'Only matters if you use Compass mode.', false);
  } else { add('noise', 'Jitter while still (1σ)', '—', 'na', ''); add('drift', 'Gyro drift', '—', 'na', ''); }
  // 6. Swing: return error after full turns, scaled to a typical 90° push.
  if (swing) {
    add('swing', 'Return after slewing', `${am(swing.worst)} per full turn`, by(swing.per90, r / 3, r),
      `≈ ${am(swing.per90)} for a typical 90° push. ${swing.per90 > r / 3 ? 'Sync on a nearby star before long pushes.' : ''}`);
    if (swing.compassWorst != null) add('cswing', 'Compass return after slewing', am(swing.compassWorst), by(swing.compassWorst, r / 2, 2 * r), 'Only matters if you use Compass mode.', false);
  } else add('swing', 'Return after slewing', '—', 'na', '');
  // 7. Horizon → zenith sweep
  if (sweep && sweep.invalid) {
    add('ceiling', 'Reliable up to altitude', 'not valid — base turned', 'na', 'During the horizon-to-zenith step the direction changed even near the horizon, so the scope base (or the phone) turned. Hold the rocker box still and redo the Phone check on the telescope.');
  } else if (sweep) {
    const reached = sweep.altMax >= 75;
    add('ceiling', 'Reliable up to altitude', reached ? `${sweep.ceiling.toFixed(0)}°` : `only reached ${sweep.altMax.toFixed(0)}°`,
      !reached ? 'na' : sweep.ceiling >= 80 ? 'good' : sweep.ceiling >= 65 ? 'ok' : 'poor',
      reached && sweep.ceiling < 80 ? `Above about ${sweep.ceiling.toFixed(0)}° the azimuth reading wanders more than half a field — sync near the target there.` : (reached ? '' : 'Raise the scope all the way to straight up for this step.'));
    add('geo', 'Phone squareness on tube', am(sweep.geometric), sweep.geometric <= r ? 'good' : 'ok', 'Removed by a 2-star alignment.', false);
    if (sweep.indexError != null) add('index', 'Altitude zero offset (tube level)', am(Math.abs(sweep.indexError)), Math.abs(sweep.indexError) <= r ? 'good' : 'ok', 'Removed by a 2-star alignment.', false);
  } else add('ceiling', 'Reliable up to altitude', '—', 'na', '');
  // 8. Full turns at the horizon
  const T = (turns || []).filter((t) => t && !t.incomplete);
  if (T.length) {
    const dyn = Math.max(...T.map((t) => t.altDynamic));
    add('dyn', 'Altitude error while moving', am(dyn), by(dyn, r / 10, r / 4), dyn > r / 4 ? 'The tilt sensor lags or wobbles during pushes; pause a moment before reading the numbers.' : '');
    const tilt = mean(T.map((t) => t.baseTilt));
    add('base', 'Mount base level', `${tilt.toFixed(2)}° off`, tilt <= 1 ? 'good' : 'ok', tilt > 1 ? 'Doesn\'t affect accuracy, but levelling the tripod makes azimuth pushes feel cleaner.' : '', false);
    const dv = T.map((t) => t.compassDeviation).filter((v) => v != null);
    if (dv.length) add('cdev', 'Compass distortion around the circle', `±${Math.max(...dv).toFixed(1)}°`, by(Math.max(...dv) * 60, r / 2, 2 * r),
      Math.max(...dv) > 2 ? 'Something magnetic near the phone (steel screws, D-cell counterweights) bends the compass.' : 'Only matters if you use Compass mode.', false);
  } else add('dyn', 'Altitude error while moving', '—', 'na', '');

  const crit = M.filter((m) => m.critical);
  let verdict, summary;
  if (crit.some((m) => m.grade === 'fail')) { verdict = 'unsuitable'; summary = 'Not suitable — this phone is missing a sensor push-to needs.'; }
  else if (crit.some((m) => m.grade === 'poor')) { verdict = 'poor'; summary = 'Expect frustration — at least one measurement is too large for your eyepiece field.'; }
  else if (crit.some((m) => m.grade === 'na')) { verdict = 'incomplete'; summary = 'Incomplete — finish every step for a verdict.'; }
  else if (crit.some((m) => m.grade === 'ok')) { verdict = 'usable'; summary = 'Usable — targets should land in or near the field; sync often.'; }
  else { verdict = 'solid'; summary = 'Solid — this phone is well matched to your eyepiece.'; }
  const advice = M.filter((m) => m.critical && (m.grade === 'poor' || m.grade === 'ok' || m.grade === 'fail') && m.note).map((m) => m.note);
  // Compass-mode suitability is reported separately so a bad compass never fails a good gyro phone.
  const cm = M.filter((m) => m.key === 'cnoise' || m.key === 'cswing' || m.key === 'cdev');
  const compass = !cm.length ? null : cm.some((m) => m.grade === 'poor') ? 'poor' : cm.some((m) => m.grade === 'ok') ? 'ok' : 'good';
  return { metrics: M, verdict, summary, advice, compass, fieldRadius: r };
}

/** Best-effort phone name from the user agent (Chrome reduces Android models to "K"; iOS only says "iPhone"). */
export function guessModel(ua = navigator.userAgent) {
  const a = /Android [\d.]+; ([^;)]+)\)/.exec(ua);
  if (a && a[1].trim() !== 'K') return a[1].trim();
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android phone';
  return '';
}
