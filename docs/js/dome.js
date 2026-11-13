// Sky-consistency dome: confirmed points (truth) vs what the sensors said, after removing everything a correct
// model expects (azimuth offset, phone-on-tube tilt, gyro drift over time). What's left is distortion.
import { mulMV, altAzFromVec, axisFrom, wrap180, wrap360, sepDeg, D2R, R2D, mean } from './model.js';

/** Fit θ0 (+ drift rate, + phone tilt p,q when the data supports them). points: [{R, alt, az, t}] */
export function fitConsistency(points, d0, prior = { p: 0, q: 0 }, opts = {}) {
  const n = points.length; if (!n) return null;
  const t0 = points[0].t, span = (points[n - 1].t - t0) / 60000;
  const useAxis = n >= 2 && opts.calibrate !== false, useRate = n >= 3 && span >= 3;
  const res = (x) => {
    const out = [];
    for (const o of points) {
      const r = altAzFromVec(mulMV(o.R, axisFrom(d0, x[2], x[3])));
      const th = x[0] + x[1] * (o.t - t0) / 60000;
      out.push(o.alt - r.alt, wrap180(o.az - (r.az + th)) * Math.cos(o.alt * D2R));
    }
    return out;
  };
  // initial θ: circular mean
  let sx = 0, sy = 0; for (const o of points) { const r = altAzFromVec(mulMV(o.R, axisFrom(d0, prior.p || 0, prior.q || 0))); sx += Math.cos((o.az - r.az) * D2R); sy += Math.sin((o.az - r.az) * D2R); }
  let x = [Math.atan2(sy, sx) * R2D, 0, prior.p || 0, prior.q || 0];
  const free = [0, ...(useRate ? [1] : []), ...(useAxis ? [2, 3] : [])];
  for (let it = 0; it < 40; it++) {
    const r0 = res(x), J = r0.map(() => free.map(() => 0)), h = 1e-4;
    free.forEach((k, j) => { const xh = x.slice(); xh[k] += h; const rh = res(xh); for (let i = 0; i < r0.length; i++) J[i][j] = (rh[i] - r0[i]) / h; });
    const m = free.length, A = Array.from({ length: m }, () => Array(m).fill(0)), g = Array(m).fill(0);
    for (let i = 0; i < r0.length; i++) for (let a = 0; a < m; a++) { g[a] -= J[i][a] * r0[i]; for (let b = 0; b < m; b++) A[a][b] += J[i][a] * J[i][b]; }
    for (let a = 0; a < m; a++) A[a][a] += 1e-6 + (a > 0 ? 0.002 : 0);        // light damping keeps tilt/drift sane on thin data
    const dx = solve(A, g); free.forEach((k, j) => { x[k] += dx[j]; });
    if (Math.hypot(...dx) < 1e-8) break;
  }
  const r = res(x);
  const resid = points.map((o, i) => ({ dAlt: r[2 * i], dAzSky: r[2 * i + 1], err: Math.hypot(r[2 * i], r[2 * i + 1]) * 60 }));   // truth − sensed, arcmin
  const errs = resid.map((v) => v.err);
  return { theta0: x[0], rate: x[1], p: x[2], q: x[3], t0, useRate, useAxis, resid, rms: Math.sqrt(mean(errs.map((e) => e * e))), max: Math.max(...errs) };
}
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } }
  return M.map((r, i) => r[n] / r[i]);
}

/**
 * Rotation-free check: for every pair, the angle the scope moved between them (sensor frame) vs the true angle.
 * Needs no fitted model at all, so it can't be fooled by one. Returns worst mismatch (arcmin) and the pairs.
 */
export function pairConsistency(points, d0, p = 0, q = 0) {
  const ax = axisFrom(d0, p, q), pairs = [];
  const sv = points.map((o) => altAzFromVec(mulMV(o.R, ax)));
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const m = sepDeg(sv[i].alt, sv[i].az, sv[j].alt, sv[j].az), t = sepDeg(points[i].alt, points[i].az, points[j].alt, points[j].az);
    pairs.push({ i, j, measured: m, expected: t, diff: (m - t) * 60 });
  }
  return { pairs, worst: pairs.length ? Math.max(...pairs.map((x) => Math.abs(x.diff))) : null };
}

/** A point that disagrees with the rest: residual > max(3× median, field radius). */
export function outliers(fit, r) {
  if (!fit || fit.resid.length < 3) return [];
  const e = fit.resid.map((v) => v.err).slice().sort((a, b) => a - b), med = e[Math.floor(e.length / 2)];
  return fit.resid.map((v, i) => (v.err > Math.max(3 * med, r) ? i : -1)).filter((i) => i >= 0);
}

/** Verdict against the eyepiece field radius r (arcmin). */
export function verdict(fit, pairs, r) {
  if (!fit || fit.resid.length < 2) return { level: 'na', text: 'Confirm at least 2 objects (alignment stars or syncs) to check consistency.' };
  const worst = Math.max(fit.max, pairs.worst ?? 0);
  if (worst <= r / 2) return { level: 'good', text: 'Consistent — the sensed sky has the same shape as the real one.' };
  if (worst <= r) return { level: 'ok', text: 'Some distortion — objects may land near the edge of the field.' };
  return { level: 'bad', text: 'Inconsistent — the sensors disagree with the sky by more than your field. Check for a wrong star, a bumped scope or phone, or magnets near the phone.' };
}

// ------------------------------------------------------------------ drawing
/** Polar dome as seen looking up: zenith centre, horizon rim, north up, east left. */
function proj(alt, az, cx, cy, R) { const r = (90 - alt) / 90 * R; return [cx - Math.sin(az * D2R) * r, cy - Math.cos(az * D2R) * r]; }

/** Smoothly interpolated residual field at (alt, az) from the confirmed points; c = how much data is nearby (0..1). */
function field(alt, az, pts, resid, sigma = 25) {
  let wS = 0, a = 0, z = 0;
  pts.forEach((p, i) => { const d = sepDeg(alt, az, p.alt, p.az); const w = Math.exp(-((d / sigma) ** 2)); wS += w; a += w * resid[i].dAlt; z += w * resid[i].dAzSky; });
  if (wS < 1e-6) return { dAlt: 0, dAzSky: 0, c: 0 };
  return { dAlt: a / wS, dAzSky: z / wS, c: Math.min(1, wS) };
}

/** Colour grade for a local mismatch e (arcmin) against field radius r: green perfect, blue good, yellow, red. */
export function gradeColour(e, r) {
  if (e <= r / 10) return { name: 'perfect', rgb: [60, 220, 90] };
  if (e <= r / 4) return { name: 'good', rgb: [70, 140, 255] };
  if (e <= r / 2) return { name: 'fair', rgb: [240, 210, 40] };
  return { name: 'poor', rgb: [255, 50, 30] };
}

export function drawDome(cv, pts, fit, opts = {}) {
  const c = cv.getContext('2d'), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2 - 14, R = Math.min(W, H) * 0.41, k = opts.bright ?? 1;
  const mag = opts.mag ?? 10, r = opts.r ?? 60, redOnly = !!opts.redOnly;
  // Night-safe mode maps every colour onto red brightness; otherwise the requested colour scale is used.
  const paint = (rgb, a = 1) => redOnly ? `rgba(${(90 + (rgb === WHITE ? 60 : 165 * (1 - grades.indexOf(rgb) / 4))) * k | 0},${(rgb === WHITE ? 15 : 10) * k | 0},0,${a})` : `rgba(${rgb[0] * k | 0},${rgb[1] * k | 0},${rgb[2] * k | 0},${a})`;
  const WHITE = [235, 235, 235];
  const grades = [[60, 220, 90], [70, 140, 255], [240, 210, 40], [255, 50, 30]];
  const colFor = (e) => { const g = gradeColour(e, r).rgb; return grades.find((x) => x[0] === g[0] && x[1] === g[1]); };
  c.clearRect(0, 0, W, H);
  // reference grid: the perfect sky (white)
  c.strokeStyle = paint(WHITE, 0.45); c.lineWidth = 1.5; c.setLineDash([3, 5]);
  for (let alt = 0; alt < 90; alt += 15) { c.beginPath(); c.arc(cx, cy, (90 - alt) / 90 * R, 0, 7); c.stroke(); }
  for (let az = 0; az < 360; az += 30) { const [x, y] = proj(0, az, cx, cy, R); c.beginPath(); c.moveTo(cx, cy); c.lineTo(x, y); c.stroke(); }
  c.setLineDash([]);
  c.fillStyle = paint(WHITE, 0.8); c.font = 'bold 24px system-ui'; c.textAlign = 'center';
  for (const [l, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) { const [x, y] = proj(-7, az, cx, cy, R); c.fillText(l, x, y + 8); }
  // legend
  const leg = [['perfect', `≤${(r / 10).toFixed(0)}′`], ['good', `≤${(r / 4).toFixed(0)}′`], ['fair', `≤${(r / 2).toFixed(0)}′`], ['poor', `>${(r / 2).toFixed(0)}′`]];
  c.font = '19px system-ui'; c.textAlign = 'left'; let lx = 14; const ly = H - 18;
  c.fillStyle = paint(WHITE, 0.8); c.fillText('true sky', lx + 26, ly); c.fillRect(lx, ly - 7, 20, 3); lx += 110;
  leg.forEach(([n, t], i) => { c.fillStyle = paint(grades[i]); c.fillRect(lx, ly - 9, 20, 6); c.fillText(`${n} ${t}`, lx + 26, ly); lx += 128; });
  if (!fit || !pts.length) return;
  // sensed mesh: same rings and spokes, displaced by the interpolated residual (× mag), coloured by local mismatch
  const node = (alt, az) => {
    const f = field(alt, az, pts, fit.resid);
    const sAlt = alt - mag * f.dAlt, sAz = az - mag * f.dAzSky / Math.max(0.05, Math.cos(alt * D2R));
    return [...proj(Math.min(89.9, sAlt), wrap360(sAz), cx, cy, R), f.c, Math.hypot(f.dAlt, f.dAzSky) * 60];
  };
  c.lineWidth = 3;
  const seg = (a, b) => { const conf = Math.min(a[2], b[2]); if (conf < 0.05) return; c.strokeStyle = paint(colFor((a[3] + b[3]) / 2), 0.2 + 0.8 * conf); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); };
  for (let alt = 0; alt < 90; alt += 15) { let prev = null; for (let az = 0; az <= 360; az += 6) { const n = node(alt, az); if (prev) seg(prev, n); prev = n; } }
  for (let az = 0; az < 360; az += 30) { let prev = null; for (let alt = 0; alt <= 88; alt += 4) { const n = node(alt, az); if (prev) seg(prev, n); prev = n; } }
  // confirmed points: dot at the true position, arrow to where the sensors put it (× mag), coloured by that point's error
  const bad = new Set(opts.outliers || []);
  pts.forEach((p, i) => {
    const rr = fit.resid[i]; const [x0, y0] = proj(p.alt, p.az, cx, cy, R);
    const [x1, y1] = proj(Math.min(89.9, p.alt - mag * rr.dAlt), wrap360(p.az - mag * rr.dAzSky / Math.max(0.05, Math.cos(p.alt * D2R))), cx, cy, R);
    c.strokeStyle = c.fillStyle = paint(colFor(rr.err)); c.lineWidth = 3;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    const a = Math.atan2(y1 - y0, x1 - x0); c.beginPath(); c.moveTo(x1, y1); c.lineTo(x1 - 14 * Math.cos(a - 0.4), y1 - 14 * Math.sin(a - 0.4)); c.lineTo(x1 - 14 * Math.cos(a + 0.4), y1 - 14 * Math.sin(a + 0.4)); c.fill();
    c.beginPath(); c.arc(x0, y0, bad.has(i) ? 10 : 7, 0, 7); c.fill();
    c.fillStyle = paint(WHITE, 0.9); c.font = '20px system-ui'; c.textAlign = 'left'; c.fillText(p.label || '', x0 + 10, y0 - 10);
  });
  c.fillStyle = paint(WHITE, 0.7); c.font = '19px system-ui'; c.textAlign = 'left'; c.fillText(`errors drawn ×${mag}`, 10, 24);
}
