// Pointing model: phone orientation -> telescope alt/az, plus star-alignment fitting.
// Frames
//   Device (W3C): x = right edge of screen, y = top edge, z = out of the screen.
//   Sensor-earth: x = East, y = North, z = Up (only true-north-referenced in compass mode;
//                 in gyro mode the horizontal axes are arbitrary, so azimuth needs an offset θ).
// Altitude comes from gravity in both modes, so it is absolute; only azimuth needs alignment.

export const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export function wrap360(a) { a %= 360; return a < 0 ? a + 360 : a; }
export function wrap180(a) { a = wrap360(a); return a > 180 ? a - 360 : a; }

/** W3C DeviceOrientation (alpha, beta, gamma in degrees) -> 3x3 rotation, device -> earth. R = Rz(a)·Rx(b)·Ry(g) */
export function rotFromEuler(alpha, beta, gamma) {
  const a = alpha * D2R, b = beta * D2R, g = gamma * D2R;
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  return [
    [cA * cG - sA * sB * sG, -cB * sA, cA * sG + cG * sA * sB],
    [cG * sA + cA * sB * sG, cA * cB, sA * sG - cA * cG * sB],
    [-cB * sG, sB, cB * cG],
  ];
}

export function mulMV(M, v) {
  return [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
          M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
          M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
}
export function norm(v) { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; }
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

/** ENU unit vector -> {alt, az}; az clockwise from north. */
export function altAzFromVec(e) {
  return { alt: Math.asin(Math.max(-1, Math.min(1, e[2]))) * R2D, az: wrap360(Math.atan2(e[0], e[1]) * R2D) };
}
export function vecFromAltAz(alt, az) {
  const ca = Math.cos(alt * D2R);
  return [ca * Math.sin(az * D2R), ca * Math.cos(az * D2R), Math.sin(alt * D2R)];
}
/** Great-circle separation in degrees. */
export function sepDeg(alt1, az1, alt2, az2) {
  const d = dot(vecFromAltAz(alt1, az1), vecFromAltAz(alt2, az2));
  return Math.acos(Math.max(-1, Math.min(1, d))) * R2D;
}

/** Nominal optical-axis direction in the device frame for each supported phone mounting. */
export const MOUNTINGS = {
  'top-sky':    { label: 'Screen up, top edge toward sky end', d: [0, 1, 0] },
  'top-mirror': { label: 'Screen up, top edge toward mirror end', d: [0, -1, 0] },
  'camera':     { label: 'Camera (back of phone) looking along the tube', d: [0, 0, -1] },
};

function basisFor(d0) {
  const ref = Math.abs(d0[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = norm(cross(d0, ref)); const e2 = norm(cross(d0, e1));
  return [e1, e2];
}
/** Optical axis in device frame from nominal axis and two small tilts (degrees). */
export function axisFrom(d0, p, q) {
  const [e1, e2] = basisFor(d0);
  const tp = Math.tan(p * D2R), tq = Math.tan(q * D2R);
  return norm([d0[0] + tp * e1[0] + tq * e2[0], d0[1] + tp * e1[1] + tq * e2[1], d0[2] + tp * e1[2] + tq * e2[2]]);
}

/**
 * Pointing model.
 *   theta: azimuth offset (deg) added to sensor azimuth.
 *   p, q : phone-to-tube misalignment (deg) — a property of the mount, saved per scope.
 *   rate : optional azimuth drift (deg/min) measured from successive syncs.
 */
export class PointingModel {
  constructor(mounting = 'top-sky') { this.setMounting(mounting); this.theta = 0; this.p = 0; this.q = 0; this.rate = 0; this.t0 = Date.now(); this.useRate = false; }
  setMounting(m) { this.mounting = m; this.d0 = (MOUNTINGS[m] || MOUNTINGS['top-sky']).d; }
  axis() { return axisFrom(this.d0, this.p, this.q); }
  thetaAt(t = Date.now()) { return this.theta + (this.useRate ? this.rate * (t - this.t0) / 60000 : 0); }
  /** Sensor-frame pointing (no azimuth offset). */
  rawPointing(R) { return altAzFromVec(mulMV(R, this.axis())); }
  pointing(R, t = Date.now()) { const r = this.rawPointing(R); return { alt: r.alt, az: wrap360(r.az + this.thetaAt(t)) }; }
}

/** Residual (deg) for one observation under parameters [theta, p, q]. Returns [dAltLike, dAzLike] tangent components. */
function residual(obs, d0, th, p, q) {
  const r = altAzFromVec(mulMV(obs.R, axisFrom(d0, p, q)));
  const dAlt = obs.alt - r.alt;
  const dAz = wrap180(obs.az - (r.az + th)) * Math.cos(obs.alt * D2R);
  return [dAlt, dAz];
}

/**
 * Fit alignment from observations [{R, alt, az, t}], where alt/az is the object's true apparent
 * position at the moment the user confirmed it was centred.
 *   - 1 star: solves theta only (p, q kept from prior calibration).
 *   - 2+ stars: solves theta, p, q by damped Gauss-Newton, with a weak prior on p, q.
 * Returns {theta, p, q, rms, resid:[deg per star], solvedAxis}.
 */
export function fitAlignment(obs, d0, prior = { p: 0, q: 0 }, opts = {}) {
  if (!obs.length) throw new Error('No alignment stars');
  let p = prior.p || 0, q = prior.q || 0;
  // theta initial guess: circular mean of per-star offsets
  let sx = 0, sy = 0;
  for (const o of obs) { const r = altAzFromVec(mulMV(o.R, axisFrom(d0, p, q))); const d = (o.az - r.az) * D2R; sx += Math.cos(d); sy += Math.sin(d); }
  let th = Math.atan2(sy, sx) * R2D;
  const solveAxis = obs.length >= 2 && !opts.thetaOnly;
  if (solveAxis) {
    const lambdaPrior = opts.priorWeight ?? 0.02; // weak pull toward prior (per deg^2)
    let x = [th, p, q];
    for (let it = 0; it < 30; it++) {
      const f = (xx) => { const out = []; for (const o of obs) out.push(...residual(o, d0, xx[0], xx[1], xx[2]));
        out.push(Math.sqrt(lambdaPrior) * (xx[1] - (prior.p || 0)), Math.sqrt(lambdaPrior) * (xx[2] - (prior.q || 0))); return out; };
      const r0 = f(x); const J = r0.map(() => [0, 0, 0]); const h = 1e-4;
      for (let k = 0; k < 3; k++) { const xh = x.slice(); xh[k] += h; const rh = f(xh); for (let i = 0; i < r0.length; i++) J[i][k] = (rh[i] - r0[i]) / h; }
      // Solve (JᵀJ + μI) dx = -Jᵀr
      const A = [[0,0,0],[0,0,0],[0,0,0]], g = [0,0,0];
      for (let i = 0; i < r0.length; i++) for (let a = 0; a < 3; a++) { g[a] += J[i][a] * r0[i]; for (let b = 0; b < 3; b++) A[a][b] += J[i][a] * J[i][b]; }
      for (let a = 0; a < 3; a++) A[a][a] += 1e-6;
      const dx = solve3(A, g.map((v) => -v));
      x = [x[0] + dx[0], x[1] + dx[1], x[2] + dx[2]];
      if (Math.hypot(...dx) < 1e-7) break;
    }
    [th, p, q] = x;
    // Guard against nonsense from near-degenerate star pairs
    if (Math.hypot(p, q) > 15) { p = prior.p || 0; q = prior.q || 0; return fitAlignment(obs, d0, { p, q }, { thetaOnly: true }); }
  } else {
    // theta only: least-squares (weighted by cos alt) = circular mean computed above, refine once
    let s = 0, w = 0;
    for (const o of obs) { const r = altAzFromVec(mulMV(o.R, axisFrom(d0, p, q))); const c = Math.cos(o.alt * D2R); s += wrap180(o.az - r.az - th) * c * c; w += c * c; }
    if (w > 0) th += s / w;
  }
  const resid = obs.map((o) => { const [a, b] = residual(o, d0, th, p, q); return Math.hypot(a, b); });
  const rms = Math.sqrt(resid.reduce((s, v) => s + v * v, 0) / resid.length);
  return { theta: wrap180(th), p, q, rms, resid, solvedAxis: solveAxis };
}

function solve3(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < 3; r++) if (r !== c) { const f = M[r][c] / d; for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]; }
  }
  return [M[0][3] / (M[0][0] || 1e-12), M[1][3] / (M[1][1] || 1e-12), M[2][3] / (M[2][2] || 1e-12)];
}

/** Push-to guidance from current pointing to target. */
export function guidance(cur, tgt) {
  const dAz = wrap180(tgt.az - cur.az), dAlt = tgt.alt - cur.alt;
  return { dAz, dAlt, sep: sepDeg(cur.alt, cur.az, tgt.alt, tgt.az) };
}

/**
 * Gnomonic projection of target around current pointing, in the alt-az frame.
 * Returns x (deg, +right = increasing azimuth), y (deg, +up = increasing altitude) — what you see
 * standing behind the scope, not the eyepiece image (which a Newtonian rotates).
 */
export function tangentOffset(cur, tgt) {
  const c = vecFromAltAz(cur.alt, cur.az), t = vecFromAltAz(tgt.alt, tgt.az);
  const up = [0, 0, 1];
  let right = cross(c, up); // for az clockwise, c×up points toward increasing azimuth
  if (Math.hypot(...right) < 1e-6) right = [1, 0, 0];
  right = norm(right); const upL = norm(cross(right, c));
  const cosd = dot(t, c); if (cosd <= 0.05) return null;
  return { x: dot(t, right) / cosd * R2D, y: dot(t, upL) / cosd * R2D };
}

// ---------- statistics helpers used by the sensor tests ----------
export function mean(a) { return a.reduce((s, v) => s + v, 0) / (a.length || 1); }
export function std(a) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); }
/** Least-squares slope of y over x. */
export function slope(x, y) { const mx = mean(x), my = mean(y); let n = 0, d = 0; for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); d += (x[i] - mx) ** 2; } return d ? n / d : 0; }
/** Circular mean of angles in degrees. */
export function circMean(a) { let s = 0, c = 0; for (const v of a) { s += Math.sin(v * D2R); c += Math.cos(v * D2R); } return wrap360(Math.atan2(s, c) * R2D); }
/** Unwrap an angle series (deg) so it is continuous. */
export function unwrap(a) { const o = []; let off = 0; for (let i = 0; i < a.length; i++) { if (i) { const d = a[i] - a[i - 1]; if (d > 180) off -= 360; else if (d < -180) off += 360; } o.push(a[i] + off); } return o; }
/** Fit e(az) = c0 + c1·sin(az) + c2·cos(az) — compass deviation curve. */
export function fitDeviation(az, e) {
  const n = az.length; if (n < 3) return null;
  const A = [[0,0,0],[0,0,0],[0,0,0]], b = [0,0,0];
  for (let i = 0; i < n; i++) { const r = [1, Math.sin(az[i] * D2R), Math.cos(az[i] * D2R)]; for (let a = 0; a < 3; a++) { b[a] += r[a] * e[i]; for (let k = 0; k < 3; k++) A[a][k] += r[a] * r[k]; } }
  for (let a = 0; a < 3; a++) A[a][a] += 1e-9;
  const [c0, c1, c2] = solve3(A, b);
  const fitted = az.map((v) => c0 + c1 * Math.sin(v * D2R) + c2 * Math.cos(v * D2R));
  const res = e.map((v, i) => v - fitted[i]);
  return { offset: c0, amplitude: Math.hypot(c1, c2), phase: wrap360(Math.atan2(c1, c2) * R2D), residualStd: std(res) };
}
