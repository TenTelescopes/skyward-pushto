// Plate solving for a wide phone-camera frame: work out where the camera is pointing from the pattern of bright stars.
//
// The camera is treated as a pinhole (phone cameras hand over a straightened picture): a star at pixel (x, y) lies along the
// ray (x - cx, y - cy, f), where f is the focal length in pixels. f is NOT assumed: it is solved along with the pointing, so
// the same code serves any phone, any lens and any crop.
//
// Method: take pairs of the brightest stars in the picture and try them against pairs of bright catalogue stars. Each trial
// fixes f (from the pair's true separation) and a full orientation; a third star gives a cheap early rejection, and survivors
// are scored by how many picture stars land on catalogue stars. The winner is refined by least squares.
//
// Frames: sky vectors are J2000 equatorial unit vectors (x to RA 0, y to RA 90°, z to the north pole).
// Camera vectors are X right, Y down, Z out through the lens. R maps camera to sky.

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

/** Build the star index once from the app's FIELD array ([ra°, dec°, mag, ...]). */
export function makeIndex(FIELD, magLimit = 5.3) {
  const v = [], mag = [];
  for (let i = 0; i < FIELD.length; i += 3) {
    if (FIELD[i + 2] > magLimit) continue;
    const ra = FIELD[i] * D2R, dec = FIELD[i + 1] * D2R, c = Math.cos(dec);
    v.push(c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)); mag.push(FIELD[i + 2]);
  }
  const n = mag.length, order = [...Array(n).keys()].sort((a, b) => mag[a] - mag[b]);
  const V = new Float64Array(3 * n), M = new Float32Array(n);
  order.forEach((o, k) => { V[3 * k] = v[3 * o]; V[3 * k + 1] = v[3 * o + 1]; V[3 * k + 2] = v[3 * o + 2]; M[k] = mag[o]; });
  // Spatial hash on the unit cube so "is there a catalogue star near this direction?" is a handful of lookups.
  const CELL = 0.035, G = Math.ceil(2 / CELL) + 1, cells = new Map();
  const key = (x, y, z) => ((Math.floor((x + 1) / CELL) * G) + Math.floor((y + 1) / CELL)) * G + Math.floor((z + 1) / CELL);
  for (let k = 0; k < n; k++) { const q = key(V[3 * k], V[3 * k + 1], V[3 * k + 2]); let a = cells.get(q); if (!a) cells.set(q, a = []); a.push(k); }
  return { n, V, M, CELL, G, cells };
}

/** Nearest catalogue star to unit vector (x, y, z) within `tol` radians and no fainter than `magMax`. Returns index or -1. */
function nearest(ix, x, y, z, tol, magMax) {
  const { CELL, G, cells, V, M } = ix, cx = Math.floor((x + 1) / CELL), cy = Math.floor((y + 1) / CELL), cz = Math.floor((z + 1) / CELL);
  const r = Math.max(1, Math.ceil(tol / CELL)); let best = -1, bd = 2 - 2 * Math.cos(tol);
  for (let a = cx - r; a <= cx + r; a++) for (let b = cy - r; b <= cy + r; b++) for (let c = cz - r; c <= cz + r; c++) {
    const list = cells.get((a * G + b) * G + c); if (!list) continue;
    for (const k of list) { if (M[k] > magMax) continue; const dx = V[3 * k] - x, dy = V[3 * k + 1] - y, dz = V[3 * k + 2] - z, d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = k; } }
  }
  return best;
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** Rotation taking camera rays (r1, r2) onto sky vectors (v1, v2): the TRIAD construction. Returns 9 numbers, row-major. */
function triad(r1, r2, v1, v2) {
  const a2 = norm(cross(r1, r2)), a3 = cross(r1, a2), b2 = norm(cross(v1, v2)), b3 = cross(v1, b2);
  const R = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[3 * i + j] = v1[i] * r1[j] + b2[i] * a2[j] + b3[i] * a3[j];
  return R;
}
const ray = (x, y, f) => { const l = Math.hypot(x, y, f); return [x / l, y / l, f / l]; };

/** Least-squares polish of orientation and focal length from matched stars. Works in pixels. */
function refine(R, f, pts, ix, pairs) {
  let rms = 0;
  for (let it = 0; it < 6; it++) {
    const res = (Rm, ff) => {
      const out = []; for (const [i, k] of pairs) {
        const vx = ix.V[3 * k], vy = ix.V[3 * k + 1], vz = ix.V[3 * k + 2];
        const cx = Rm[0] * vx + Rm[3] * vy + Rm[6] * vz, cy = Rm[1] * vx + Rm[4] * vy + Rm[7] * vz, cz = Rm[2] * vx + Rm[5] * vy + Rm[8] * vz;
        out.push(ff * cx / cz - pts[i][0], ff * cy / cz - pts[i][1]);
      } return out;
    };
    const rot = (Rm, w) => {                      // Rm · exp([w]×), first order then re-orthonormalised
      const E = [1, -w[2], w[1], w[2], 1, -w[0], -w[1], w[0], 1], O = new Array(9);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) O[3 * i + j] = Rm[3 * i] * E[j] + Rm[3 * i + 1] * E[3 + j] + Rm[3 * i + 2] * E[6 + j];
      const c0 = norm([O[0], O[3], O[6]]); let c1 = [O[1], O[4], O[7]]; const d = c0[0] * c1[0] + c0[1] * c1[1] + c0[2] * c1[2];
      c1 = norm([c1[0] - d * c0[0], c1[1] - d * c0[1], c1[2] - d * c0[2]]); const c2 = cross(c0, c1);
      return [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]];
    };
    const r0 = res(R, f), eps = 1e-5, J = [];
    for (let p = 0; p < 4; p++) { const w = [0, 0, 0]; let ff = f; if (p < 3) w[p] = eps; else ff = f * (1 + eps); const r1 = res(p < 3 ? rot(R, w) : R, ff); J.push(r1.map((v, i) => (v - r0[i]) / eps)); }
    const A = Array.from({ length: 4 }, () => new Array(5).fill(0));
    for (let a = 0; a < 4; a++) { for (let b = 0; b < 4; b++) { let s = 0; for (let i = 0; i < r0.length; i++) s += J[a][i] * J[b][i]; A[a][b] = s; } let s = 0; for (let i = 0; i < r0.length; i++) s += J[a][i] * r0[i]; A[a][4] = -s; A[a][a] *= 1.0001; }
    for (let c = 0; c < 4; c++) {                 // Gauss–Jordan
      let pv = c; for (let r = c + 1; r < 4; r++) if (Math.abs(A[r][c]) > Math.abs(A[pv][c])) pv = r;
      if (Math.abs(A[pv][c]) < 1e-12) return { R, f, rms: Infinity };
      [A[c], A[pv]] = [A[pv], A[c]]; const d = A[c][c]; for (let j = c; j < 5; j++) A[c][j] /= d;
      for (let r = 0; r < 4; r++) if (r !== c) { const m = A[r][c]; if (m) for (let j = c; j < 5; j++) A[r][j] -= m * A[c][j]; }
    }
    R = rot(R, [A[0][4], A[1][4], A[2][4]]); f *= 1 + A[3][4];
    const r2 = res(R, f); rms = Math.sqrt(r2.reduce((s, v) => s + v * v, 0) / (r2.length / 2));
  }
  return { R, f, rms };
}

/** Match picture stars to the catalogue under a trial orientation. Returns [[pictureIndex, catalogueIndex], ...]. */
function matchAll(R, f, pts, ix, tol, magMax, limit) {
  const pairs = [], used = new Set();
  for (let i = 0; i < Math.min(pts.length, limit); i++) {
    const r = ray(pts[i][0], pts[i][1], f), x = R[0] * r[0] + R[1] * r[1] + R[2] * r[2], y = R[3] * r[0] + R[4] * r[1] + R[5] * r[2], z = R[6] * r[0] + R[7] * r[1] + R[8] * r[2];
    const k = nearest(ix, x, y, z, tol, magMax); if (k >= 0 && !used.has(k)) { used.add(k); pairs.push([i, k]); }
  }
  return pairs;
}

/**
 * Solve a field.
 * stars: [{x, y, flux?}] in pixels, any order (brightest are used first if flux/snr is present).
 * opts.prior: { ra, dec, radius } in degrees — roughly where the camera points (from the gyro); omit for a blind solve.
 * opts.fovMin / fovMax: limits on the diagonal field of view in degrees (default 35–110, which covers phone main cameras).
 * Returns null, or { ra, dec, roll, f, fovW, fovH, n, of, rms, rmsDeg, matches, R, confidence }.
 */
export function solveField(stars, w, h, ix, opts = {}) {
  const fovMin = opts.fovMin || 35, fovMax = opts.fovMax || 110, diag = Math.hypot(w, h);
  const fMin = (diag / 2) / Math.tan(fovMax / 2 * D2R), fMax = (diag / 2) / Math.tan(fovMin / 2 * D2R);
  const s = [...stars].sort((a, b) => (b.flux ?? b.snr ?? 0) - (a.flux ?? a.snr ?? 0));
  const pts = s.map((p) => [p.x - w / 2, p.y - h / 2]);
  if (pts.length < 4) return null;
  const USE = Math.min(pts.length, 24), TOP = Math.min(pts.length, 6), magPair = opts.magPair ?? 3.6, magAll = opts.magAll ?? 5.3;
  // Catalogue stars allowed to form the trial pair: bright ones, inside the prior cone if there is one.
  let pv = null, cosR = -2;
  if (opts.prior) { const ra = opts.prior.ra * D2R, dec = opts.prior.dec * D2R; pv = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]; cosR = Math.cos(Math.min(180, opts.prior.radius + fovMax / 2) * D2R); }
  const cand = [];
  for (let k = 0; k < ix.n && ix.M[k] <= magPair; k++) { if (pv && ix.V[3 * k] * pv[0] + ix.V[3 * k + 1] * pv[1] + ix.V[3 * k + 2] * pv[2] < cosR) continue; cand.push(k); }
  const sepAt = (p, q, f) => { const a = ray(p[0], p[1], f), b = ray(q[0], q[1], f); return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
  const tol0 = (opts.tol || 0.8) * D2R, tol1 = (opts.tolFine || 0.4) * D2R;
  let best = null, second = 0;
  let done = false;
  for (let i = 0; i < TOP && !done; i++) for (let j = i + 1; j < TOP && !done; j++) {
    const p = pts[i], q = pts[j], pix = Math.hypot(p[0] - q[0], p[1] - q[1]); if (pix < diag * 0.06) continue;      // too close to fix the scale
    const cLo = sepAt(p, q, fMin), cHi = sepAt(p, q, fMax);                                                           // cos(separation) at the two focal limits
    const cMin = Math.min(cLo, cHi) - 1e-4, cMax = Math.max(cLo, cHi) + 1e-4;
    // a few more picture stars for early rejection: two of them must land on catalogue stars (the rest may be planets, planes, junk)
    const others = []; for (let t = 0; t < Math.min(pts.length, 10) && others.length < 5; t++) if (t !== i && t !== j) others.push(t);
    for (let a = 0; a < cand.length && !done; a++) {
      const ka = cand[a], ax = ix.V[3 * ka], ay = ix.V[3 * ka + 1], az = ix.V[3 * ka + 2];
      for (let b = 0; b < cand.length; b++) {
        if (a === b) continue; const kb = cand[b], c = ax * ix.V[3 * kb] + ay * ix.V[3 * kb + 1] + az * ix.V[3 * kb + 2];
        if (c < cMin || c > cMax) continue;
        // focal length that makes the picture pair subtend the true separation (monotonic in f, so bisect)
        let lo = fMin, hi = fMax; const inc = cHi > cLo;
        for (let it = 0; it < 18; it++) { const m = (lo + hi) / 2, cm = sepAt(p, q, m); if ((cm < c) === inc) lo = m; else hi = m; }
        const f = (lo + hi) / 2, R = triad(ray(p[0], p[1], f), ray(q[0], q[1], f), [ax, ay, az], [ix.V[3 * kb], ix.V[3 * kb + 1], ix.V[3 * kb + 2]]);
        // Only catalogue stars about as bright as the ones in the picture may be matched: a frame showing nine stars is showing
        // the nine-ish brightest in that patch, and letting it match thousands of faint ones only invites coincidences.
        const share = Math.min(1, (4 * Math.atan(w / 2 / f) * Math.atan(h / 2 / f)) / (4 * Math.PI)), magHyp = Math.min(magAll, ix.M[Math.min(ix.n - 1, Math.ceil(3 * USE / share))]);
        let hit = 0;
        for (const t of others) { const r = ray(pts[t][0], pts[t][1], f); if (nearest(ix, R[0] * r[0] + R[1] * r[1] + R[2] * r[2], R[3] * r[0] + R[4] * r[1] + R[5] * r[2], R[6] * r[0] + R[7] * r[1] + R[8] * r[2], tol0, magHyp) >= 0) hit++; }
        if (hit < Math.min(2, others.length)) continue;
        let pairs = matchAll(R, f, pts, ix, tol0, magHyp, USE); if (pairs.length < 5) continue;
        let fit = refine(R, f, pts, ix, pairs); if (!isFinite(fit.rms)) continue;
        pairs = matchAll(fit.R, fit.f, pts, ix, tol1, magHyp, USE); if (pairs.length < 5) continue;
        fit = refine(fit.R, fit.f, pts, ix, pairs);
        if (!isFinite(fit.rms) || fit.f < fMin * 0.9 || fit.f > fMax * 1.1) continue;
        const score = pairs.length - fit.rms / (diag * 0.01);
        if (!best || score > best.score) {
          const same = best && best.R[2] * fit.R[2] + best.R[5] * fit.R[5] + best.R[8] * fit.R[8] > 0.9995;   // same pointing (within ~1.8°) is not a rival
          if (best && !same) second = Math.max(second, best.n);
          best = { score, n: pairs.length, pairs, R: fit.R, f: fit.f, rms: fit.rms };
          if (USE >= 12 && best.n >= Math.max(9, 0.7 * USE) && best.rms < diag * 0.004) { done = true; break; }   // overwhelming: stop searching
        } else { const same = best.R[2] * fit.R[2] + best.R[5] * fit.R[5] + best.R[8] * fit.R[8] > 0.9995; if (!same) second = Math.max(second, pairs.length); }
      }
    }
  }
  if (!best) return null;
  const need = opts.prior ? 5 : 6, frac = best.n / USE;
  // A real solution matches most of the picture's stars and clearly beats the runner-up.
  if (opts.debug) console.log('best', best && best.n, 'of', USE, 'second', second, 'rms', best.rms.toFixed(2), 'cand', cand.length);
  if (best.n < need || frac < 0.35 || best.n < second + 2) return null;
  const R = best.R, zx = R[2], zy = R[5], zz = R[8];
  let ra = Math.atan2(zy, zx) * R2D; if (ra < 0) ra += 360;
  // Roll: direction of celestial north in the picture, clockwise from "up".
  const n = [-zz * zx, -zz * zy, 1 - zz * zz], nx = R[0] * n[0] + R[3] * n[1] + R[6] * n[2], ny = R[1] * n[0] + R[4] * n[1] + R[7] * n[2];
  return {
    ra, dec: Math.asin(Math.max(-1, Math.min(1, zz))) * R2D, roll: Math.atan2(nx, -ny) * R2D, f: best.f,
    fovW: 2 * Math.atan(w / 2 / best.f) * R2D, fovH: 2 * Math.atan(h / 2 / best.f) * R2D,
    n: best.n, of: USE, rms: best.rms, rmsDeg: Math.atan(best.rms / best.f) * R2D, R,
    matches: best.pairs.map(([i, k]) => ({ x: s[i].x, y: s[i].y, cat: k, mag: ix.M[k], ra: (Math.atan2(ix.V[3 * k + 1], ix.V[3 * k]) * R2D + 360) % 360, dec: Math.asin(ix.V[3 * k + 2]) * R2D })),
    confidence: best.n >= second + 4 && frac >= 0.5 ? 'high' : 'fair',
  };
}

/** Where a sky position falls in the picture under a solution (pixels), or null if behind the camera. */
export function project(sol, w, h, raDeg, decDeg) {
  const ra = raDeg * D2R, dec = decDeg * D2R, v = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)], R = sol.R;
  const cx = R[0] * v[0] + R[3] * v[1] + R[6] * v[2], cy = R[1] * v[0] + R[4] * v[1] + R[7] * v[2], cz = R[2] * v[0] + R[5] * v[1] + R[8] * v[2];
  return cz > 0.05 ? { x: w / 2 + sol.f * cx / cz, y: h / 2 + sol.f * cy / cz } : null;
}
