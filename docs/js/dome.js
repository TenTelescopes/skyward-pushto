// Sky-consistency dome: confirmed points (truth) vs what the sensors said, after removing everything a correct
// model expects (azimuth offset, phone-on-tube tilt, gyro drift over time). What's left is distortion.
import { mulMV, altAzFromVec, axisFrom, wrap180, wrap360, sepDeg, D2R, R2D, mean } from './model.js';

/**
 * Fit the azimuth offset (+ drift rate, + phone tilt p,q when the data supports them). points: [{R, alt, az, t, ep?}]
 *
 * The gyro heading can jump when the sensors are interrupted (the app goes to the background, the phone is knocked),
 * so each stretch between jumps — an "epoch", `ep` on the point or opts.epochs — gets its own offset. Drift and tilt
 * are shared by all of them.
 */
export function fitConsistency(points, d0, prior = { p: 0, q: 0 }, opts = {}) {
  const n = points.length; if (!n) return null;
  const t0 = points[0].t, span = (points[n - 1].t - t0) / 60000;
  const eps = opts.epochs || points.map((o) => o.ep || 0), ids = [...new Set(eps)], E = ids.length, ei = eps.map((e) => ids.indexOf(e));
  const useAxis = n >= 2 && opts.calibrate !== false, useRate = n - E >= 2 && span >= 3;
  const res = (x) => {
    const out = [], ax = axisFrom(d0, x[E + 1], x[E + 2]);
    points.forEach((o, i) => {
      const r = altAzFromVec(mulMV(o.R, ax));
      const th = x[ei[i]] + x[E] * (o.t - t0) / 60000;
      out.push(o.alt - r.alt, wrap180(o.az - (r.az + th)) * Math.cos(o.alt * D2R));
    });
    return out;
  };
  // initial offsets: circular mean within each epoch
  const ax0 = axisFrom(d0, prior.p || 0, prior.q || 0), sx = Array(E).fill(0), sy = Array(E).fill(0);
  points.forEach((o, i) => { const r = altAzFromVec(mulMV(o.R, ax0)); sx[ei[i]] += Math.cos((o.az - r.az) * D2R); sy[ei[i]] += Math.sin((o.az - r.az) * D2R); });
  let x = [...sx.map((v, e) => Math.atan2(sy[e], v) * R2D), 0, prior.p || 0, prior.q || 0];
  const free = [...sx.map((_, e) => e), ...(useRate ? [E] : []), ...(useAxis ? [E + 1, E + 2] : [])];
  for (let it = 0; it < 40; it++) {
    const r0 = res(x), J = r0.map(() => free.map(() => 0)), h = 1e-4;
    free.forEach((k, j) => { const xh = x.slice(); xh[k] += h; const rh = res(xh); for (let i = 0; i < r0.length; i++) J[i][j] = (rh[i] - r0[i]) / h; });
    const m = free.length, A = Array.from({ length: m }, () => Array(m).fill(0)), g = Array(m).fill(0);
    for (let i = 0; i < r0.length; i++) for (let a = 0; a < m; a++) { g[a] -= J[i][a] * r0[i]; for (let b = 0; b < m; b++) A[a][b] += J[i][a] * J[i][b]; }
    for (let a = 0; a < m; a++) A[a][a] += 1e-6 + (free[a] >= E ? 0.002 : 0);  // light damping keeps tilt/drift sane on thin data
    const dx = solve(A, g); free.forEach((k, j) => { x[k] += dx[j]; });
    if (Math.hypot(...dx) < 1e-8) break;
  }
  const r = res(x);
  const resid = points.map((o, i) => ({ dAlt: r[2 * i], dAzSky: r[2 * i + 1], err: Math.hypot(r[2 * i], r[2 * i + 1]) * 60 }));   // truth − sensed, arcmin
  const errs = resid.map((v) => v.err);
  // theta0 is the offset of the newest epoch (the one in force now); thetas has each point's own.
  return { theta0: x[ei[n - 1]], thetas: ei.map((e) => x[e]), epochs: E, rate: x[E], p: x[E + 1], q: x[E + 2], t0, useRate, useAxis, resid, rms: Math.sqrt(mean(errs.map((e) => e * e))), max: Math.max(...errs) };
}
/**
 * A heading jump nobody flagged (a knock, a sensor hiccup): if cutting the session in two at some moment, with a
 * separate offset on each side, explains the leftovers far better than one offset does, treat it as a jump.
 * Needs three objects on each side of the cut. Returns the epoch label for every point.
 */
export function splitJumps(points, d0, prior = { p: 0, q: 0 }, opts = {}) {
  const n = points.length, r = opts.r ?? 60; let eps = points.map((o) => o.ep || 0);
  for (let round = 0; round < 2 && n >= 6; round++) {
    const base = fitConsistency(points, d0, prior, { ...opts, epochs: eps });
    if (!base || base.rms < Math.max(6, r / 6)) break;                          // already consistent: nothing to explain
    let best = null;
    for (let k = 3; k <= n - 3; k++) {
      const e = eps[k]; if (eps[k - 1] !== e) continue;
      let a = 0, b = 0; eps.forEach((v, i) => { if (v === e) { if (i < k) a++; else b++; } });
      if (a < 3 || b < 3) continue;
      const cut = eps.map((v, i) => (v === e && i >= k ? e + 0.5 ** (round + 1) : v));
      const f = fitConsistency(points, d0, prior, { ...opts, epochs: cut });
      if (f && (!best || f.rms < best.f.rms)) best = { f, cut, k };
    }
    if (!best || best.f.rms > 0.5 * base.rms || Math.abs(wrap180(best.f.thetas[best.k] - best.f.thetas[best.k - 1])) < 1) break;
    eps = best.cut;
  }
  return eps;
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
 * Pairs from either side of a heading jump (different epochs) are skipped.
 */
export function pairConsistency(points, d0, p = 0, q = 0, eps = null) {
  const ax = axisFrom(d0, p, q), pairs = [], ep = eps || points.map((o) => o.ep || 0);
  const sv = points.map((o) => altAzFromVec(mulMV(o.R, ax)));
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (ep[i] !== ep[j]) continue;                                   // the heading jumped between these two: nothing to compare
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

// ------------------------------------------------------------------ sky correction: the dome as a lookup table
/**
 * Corrected pointing from everything that has been confirmed on the sky (alignment stars, syncs, test stars).
 *
 * Two layers, the same two the dome shows:
 *  1. the best overall fit to ALL confirmed objects — offset, drift when the data supports it, and how the phone
 *     sits on the tube (unless `calibrate` is false);
 *  2. a lookup table of what is left over at each object, blended smoothly across the sky, so that
 *     "in this part of the sky the sensors read off by this much" is added back in.
 *
 * Safeguards, because a correction built on bad data is worse than none:
 *  - needs `minPoints` good objects;
 *  - leaves out objects that disagree with the rest, or are off by more than `maxErr`° (a wrong star, a bumped scope);
 *  - if the fitted phone tilt strays more than `maxTilt`° from the live one, the live tilt is kept;
 *  - older objects count for less in the table (half weight after `halfLife` minutes);
 *  - the table fades to nothing away from the data and is capped at `cap`° on the sky.
 *
 *  - a heading jump (sensors interrupted, phone knocked) starts a new stretch with its own offset — flagged by the
 *    app with `ep` on the points, or found here when the objects fall into a clear "before" and "after";
 *  - and it has to earn its place: `check` replays the session (see replayCheck) and says whether the correction
 *    would actually have put the last few objects closer to the middle of the field. Callers apply the correction
 *    only when `check.helps` is true, which also needs `minUse` objects in the table.
 *
 * Returns null when there isn't enough to go on, otherwise
 *   { n, dropped, used, eps, jumps, fit, maxSky, check: { n, raw, fixed, helps, short },
 *     point(R, now, { tSet, drift, anchor }) -> { alt, az, table }   corrected pointing for a sensor rotation R
 *     anchorFor(sync, now) -> degrees                                keeps a fresh Sync exact where it was made
 *     field(alt, az, now) -> { dAlt, dAzSky, dAz, sky, c } }         the lookup table itself
 */
function buildTable(points, d0, tilt = { p: 0, q: 0 }, opts = {}) {
  const { minPoints = 3, maxErr = 3, sigma = 25, halfLife = 60, cap = 2, r = 60, shrink = 0.25, calibrate = true, maxTilt = 3 } = opts;
  if (!points || points.length < minPoints) return null;
  const eps = opts.jumps === false ? points.map((o) => o.ep || 0) : splitJumps(points, d0, tilt, { calibrate: calibrate !== false, r });
  const solve = (cal) => {
    let keep = points.map((_, i) => i), fit = null;
    for (let pass = 0; pass < 4; pass++) {
      fit = fitConsistency(keep.map((i) => points[i]), d0, tilt, { calibrate: cal, epochs: keep.map((i) => eps[i]) });
      if (!fit) return null;
      const bad = new Set(outliers(fit, r));
      fit.resid.forEach((v, j) => { if (v.err > maxErr * 60) bad.add(j); });
      if (!bad.size) break;
      keep = keep.filter((_, j) => !bad.has(j));
      if (keep.length < minPoints) return null;
    }
    return { keep, fit };
  };
  let sol = solve(calibrate !== false);
  if (sol && (Math.abs(sol.fit.p - (tilt.p || 0)) > maxTilt || Math.abs(sol.fit.q - (tilt.q || 0)) > maxTilt)) sol = solve(false);
  if (!sol) return null;
  const { keep, fit } = sol, pts = keep.map((i) => points[i]), res = fit.resid, axis = axisFrom(d0, fit.p, fit.q);
  const sense = (R) => altAzFromVec(mulMV(R, axis));
  const thetaFit = (t) => fit.theta0 + (fit.useRate ? fit.rate * (t - fit.t0) / 60000 : 0);
  const field = (alt, az, now = Date.now()) => {
    let wS = 0, a = 0, x = 0;
    pts.forEach((p, i) => {
      const d = sepDeg(alt, az, p.alt, p.az);
      const w = Math.exp(-((d / sigma) ** 2)) * 0.5 ** (Math.max(0, now - p.t) / 60000 / halfLife);
      wS += w; a += w * res[i].dAlt; x += w * res[i].dAzSky;
    });
    let dAlt = a / (wS + shrink), dAzSky = x / (wS + shrink);
    const m = Math.hypot(dAlt, dAzSky); if (m > cap) { dAlt *= cap / m; dAzSky *= cap / m; }
    return { dAlt, dAzSky, dAz: dAzSky / Math.max(0.17, Math.cos(alt * D2R)), sky: Math.min(m, cap), c: wS / (wS + shrink) };
  };
  /**
   * `tSet` is when the live offset was last set (a Sync or an alignment); `drift` is whatever the live model has
   * added since then (0 unless the user applies measured drift); `anchor` comes from anchorFor().
   */
  const point = (R, now = Date.now(), { tSet = now, drift = 0, anchor = 0 } = {}) => {
    const q = sense(R), az0 = wrap360(q.az + thetaFit(tSet) + drift + anchor), c = field(q.alt, az0, now);
    return { alt: Math.max(-90, Math.min(90, q.alt + c.dAlt)), az: wrap360(az0 + c.dAz), table: c.sky, c: c.c };
  };
  /** After a Sync on one object the user expects that object to be exact: return the azimuth that makes it so. */
  const anchorFor = (sync, now = Date.now()) => {
    if (!sync || !sync.R) return 0;
    const q = sense(sync.R), az0 = wrap360(q.az + thetaFit(sync.t));
    return wrap180(sync.az - az0) - field(q.alt, wrap360(az0 + wrap180(sync.az - az0)), now).dAz;
  };
  return { n: pts.length, dropped: points.length - pts.length, used: keep, eps: keep.map((i) => eps[i]), jumps: new Set(keep.map((i) => eps[i])).size - 1, fit, field, point, anchorFor, thetaFit, maxSky: Math.max(...res.map((v) => v.err)) / 60 };
}

export function correctionTable(points, d0, tilt = { p: 0, q: 0 }, opts = {}) {
  const P = (points || []).slice().sort((a, b) => a.t - b.t), T = buildTable(P, d0, tilt, opts);
  if (!T) return null;
  if (opts.validate !== false) {
    const minUse = opts.minUse ?? 6;                                    // too few objects to tell a real pattern from a fluke
    T.check = replayCheck(T.used.map((i, j) => ({ ...P[i], ep: T.eps[j] })), d0, tilt, opts);
    T.check.short = Math.max(0, minUse - T.n);
    T.check.helps = T.check.helps && !T.check.short;
  }
  return T;
}

/**
 * Has the correction earned its place? Replay the session the way it was observed: for each of the last `checks`
 * confirmed objects, build the correction from only the objects confirmed BEFORE it, sync on the one just before
 * it, and see how far off the arrows would have been on arriving — with the correction and without (arcmin).
 * It "helps" only when it has at least `minChecks` such trials and beats the plain model by a clear margin.
 * Gyro drift, a heading jump or a noisy phone all show up here as "no gain", and the arrows are then left alone.
 */
export function replayCheck(points, d0, tilt = { p: 0, q: 0 }, opts = {}) {
  const { checks = 8, minChecks = 2, gain = 0.85, minPoints = 3 } = opts;
  const ax = axisFrom(d0, tilt.p || 0, tilt.q || 0), rows = [];
  for (let i = points.length - 1; i >= minPoints && rows.length < checks; i--) {
    const s = points[i - 1], o = points[i];
    if ((s.ep || 0) !== (o.ep || 0)) continue;                 // the heading jumped between these two: neither model could have known
    const T = buildTable(points.slice(0, i), d0, tilt, { ...opts, jumps: false }); if (!T) continue;
    const a = altAzFromVec(mulMV(o.R, ax)), b = altAzFromVec(mulMV(s.R, ax));
    const c = T.point(o.R, o.t, { tSet: s.t, anchor: T.anchorFor(s, o.t) });
    rows.push({ raw: sepDeg(a.alt, wrap360(a.az + wrap180(s.az - b.az)), o.alt, o.az) * 60, fixed: sepDeg(c.alt, c.az, o.alt, o.az) * 60 });
  }
  const n = rows.length, raw = n ? mean(rows.map((x) => x.raw)) : null, fixed = n ? mean(rows.map((x) => x.fixed)) : null;
  return { n, raw, fixed, helps: n >= minChecks && fixed < gain * raw && raw - fixed > 1 };
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
