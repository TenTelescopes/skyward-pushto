// "What you should see": the target centred in a chosen eyepiece, drawn to scale.
// Stars come from the Hipparcos field (to mag 8); deep-sky shapes use OpenNGC size and position angle;
// planet discs use their real radius and current distance. Brightness is NOT to scale — the label says so.
import { tangentOffset, D2R, vecFromAltAz, cross, norm, dot } from './model.js';
import { tint } from './theme.js';

/** Unit direction (in the alt-az tangent plane, x right / y up) of celestial north and east at a target. */
function skyAxes(sky, o, date) {
  if (o.ra == null) return null;
  const c = sky.altAzRaDec(o.ra, o.dec, date);
  const n = tangentOffset(c, sky.altAzRaDec(o.ra, Math.min(89.99, o.dec + 0.2), date));
  const e = tangentOffset(c, sky.altAzRaDec(o.ra + 0.2 / Math.max(0.05, Math.cos(o.dec * D2R)), o.dec, date));
  if (!n || !e) return null;
  const nl = Math.hypot(n.x, n.y), el = Math.hypot(e.x, e.y);
  return { n: { x: n.x / nl, y: n.y / nl }, e: { x: e.x / el, y: e.y / el } };
}

/**
 * Draw the eyepiece view.
 *   o: target object; tgt: its current {alt, az}; ep: {name, fl, afov}; scope: {fl, aperture}
 *   opts.rotate180: show as a Newtonian does (rotated 180° from the naked-eye view)
 */
export function drawEyepiece(cv, sky, o, tgt, ep, scope, opts = {}) {
  const c = cv.getContext('2d'), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, Rpx = W * 0.47, k = opts.bright ?? 1;
  const col = (r, g = 0, b = 0, a = 1) => tint(r, g, b, a, k);
  const date = new Date();
  const mag = scope.fl / ep.fl, tfov = ep.afov / mag, rad = tfov / 2, s = Rpx / rad;   // px per degree
  // Surface brightness of extended things (and of the sky background) scales with exit pupil², capped at the eye's
  // pupil (~7 mm). Stars are points and stay as bright. `refExit` is the longest eyepiece's exit pupil, so its view = 1.
  const eye = 7, exit = Math.min(eye, scope.aperture / mag), refExit = Math.min(eye, opts.refExit || exit);
  const rel = (exit / refExit) ** 2;                 // true relative surface brightness
  const shown = Math.sqrt(rel);                      // compressed for display (an actual 33× drop would be black on a phone)
  // M maps a naked-eye offset (x toward increasing azimuth, y toward zenith) to the eyepiece view; identity = naked-eye.
  const M = opts.matrix || [[1, 0], [0, 1]];
  const P = (dx, dy) => { const [X, Y] = applyM(M, dx, dy); return { x: cx + X * s, y: cy - Y * s }; };
  const screenAngle = (dx, dy) => { const [X, Y] = applyM(M, dx, dy); return Math.atan2(-Y, X); };
  c.clearRect(0, 0, W, H);
  c.save(); c.beginPath(); c.arc(cx, cy, Rpx, 0, 7); c.clip();
  c.fillStyle = col(4 + 10 * shown, 0, 0); c.fillRect(0, 0, W, H);   // sky glow darkens with magnification

  // deep-sky shape (drawn first, stars on top) — dimmed by surface brightness
  c.globalAlpha = shown;
  const ax = skyAxes(sky, o, date);
  const ell = (maj, min, pa, draw) => {               // maj/min in arcmin; PA from north through east
    const a = (maj / 60 / 2) * s, b = ((min || maj) / 60 / 2) * s;
    let ang = 0;
    if (ax && pa != null) { const dx = Math.cos(pa * D2R) * ax.n.x + Math.sin(pa * D2R) * ax.e.x, dy = Math.cos(pa * D2R) * ax.n.y + Math.sin(pa * D2R) * ax.e.y; ang = screenAngle(dx, dy); }
    c.save(); c.translate(cx, cy); c.rotate(ang); draw(Math.max(2, a), Math.max(2, b)); c.restore();
  };
  const glow = (a, b, peak, edge = 0) => { const g = c.createRadialGradient(0, 0, 0, 0, 0, Math.max(a, b)); g.addColorStop(0, col(220, 40, 20, peak)); g.addColorStop(1, col(120, 0, 0, edge)); c.scale(1, b / a); c.fillStyle = g; c.beginPath(); c.arc(0, 0, a, 0, 7); c.fill(); };
  const t = o.planet ? 'PL' : o.key.startsWith('ds:') ? 'DS' : o.t;
  let note = '';
  if (t === 'GX') ell(o.maj || 3, o.min, o.pa, (a, b) => { glow(a, b, 0.55); c.scale(1, a / b); glow(a * 0.12, b * 0.12, 0.9); });
  else if (t === 'GC') ell(o.maj || 5, o.maj || 5, 0, (a) => { glow(a, a, 0.85); c.globalAlpha = 1; /* member stars are points: they don't dim, so a globular resolves better at high power */ let sd = 12345; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647); for (let i = 0; i < 90; i++) { const r = a * Math.sqrt(rnd()) * 0.9, th = rnd() * 7; c.fillStyle = col(255, 90, 50, 0.75); c.fillRect(Math.cos(th) * r, Math.sin(th) * r, 2, 2); } c.globalAlpha = shown; });
  else if (t === 'PN') ell(o.maj || 1, o.min, o.pa, (a, b) => { c.fillStyle = col(200, 60, 40, 0.75); c.beginPath(); c.ellipse(0, 0, a, b, 0, 0, 7); c.fill(); if (/^M57$|Ring/.test(o.label + o.name)) { c.fillStyle = col(10, 0, 0); c.beginPath(); c.ellipse(0, 0, a * 0.45, b * 0.45, 0, 0, 7); c.fill(); } });
  else if (t === 'NB' || t === 'CN' || t === 'DN') ell(o.maj || 10, o.min, o.pa, (a, b) => glow(a, b, 0.35, 0.05));
  else if (t === 'OC' || t === 'AS') { if (o.maj) { c.restore(); c.save(); c.beginPath(); c.arc(cx, cy, Rpx, 0, 7); c.clip(); c.strokeStyle = col(90, 10, 0, 0.6); c.setLineDash([4, 8]); c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, Math.min(Rpx * 1.5, (o.maj / 120) * s), 0, 7); c.stroke(); c.setLineDash([]); } }

  c.globalAlpha = 1;
  // field stars — point sources: not dimmed by magnification
  const field = sky.fieldNear(tgt.alt, tgt.az, rad * 1.3, 8, date);
  for (const [, v] of field) {
    if (v.mag > 8) continue;
    const off = tangentOffset(tgt, v); if (!off) continue;
    const q = P(off.x, off.y), r = Math.max(1.4, (8.6 - v.mag) * 1.7);
    c.fillStyle = col(255, 70, 40); c.beginPath(); c.arc(q.x, q.y, r, 0, 7); c.fill();
  }

  // planets / Moon / double stars at the centre
  if (t === 'PL') {
    const d = sky.diameter(o.id, date);
    const r = d ? (d / 60 / 2) * s : 3;
    if (r > 3) c.globalAlpha = Math.max(0.35, shown);  // a resolved disc is an extended object too
    c.fillStyle = col(255, 110, 60); c.beginPath(); c.arc(cx, cy, Math.max(2, r), 0, 7); c.fill();
    if (o.id === 'Saturn' && r > 3) { c.strokeStyle = col(255, 110, 60); c.lineWidth = Math.max(1, r * 0.18); c.beginPath(); c.ellipse(cx, cy, r * 2.25, r * 0.7, -0.3, 0, 7); c.stroke(); }
    c.globalAlpha = 1;
    note = d ? `${o.id} disc ${d >= 1 ? d.toFixed(1) + '′' : (d * 60).toFixed(0) + '″'} across` : '';
  } else if (t === 'DS' && o.pairs && o.pairs.length) {
    const pr = o.pairs[0], sepDeg = pr.sep / 3600, mags = String(pr.mags).split('/').map(Number);
    let dx = 0, dy = sepDeg;
    if (ax) { dx = (Math.cos(pr.pa * D2R) * ax.n.x + Math.sin(pr.pa * D2R) * ax.e.x) * sepDeg; dy = (Math.cos(pr.pa * D2R) * ax.n.y + Math.sin(pr.pa * D2R) * ax.e.y) * sepDeg; }
    const A = P(-dx / 2, -dy / 2), B = P(dx / 2, dy / 2), rA = Math.max(2.5, (9 - (mags[0] || 4)) * 1.8), rB = Math.max(2, (9 - (mags[1] || 6)) * 1.8);
    // Resolvable: separation above the Dawes limit (116/D″) and magnified to ≥ 2′ apparent, a comfortable eye separation.
    const dawes = 116 / scope.aperture, split = pr.sep >= dawes && mag * pr.sep >= 120;
    c.fillStyle = col(255, 120, 70); c.beginPath(); c.arc(A.x, A.y, rA, 0, 7); c.fill(); c.beginPath(); c.arc(B.x, B.y, rB, 0, 7); c.fill();
    note = `${pr.c}: ${pr.sep}″ — ${pr.sep < dawes ? `below this scope's ${dawes.toFixed(2)}″ resolution limit` : split ? 'split at this power' : 'tight at this power; try a shorter eyepiece'}`;
  }
  c.restore();

  // field edge and direction markers: celestial N and E, and the way to the zenith
  c.strokeStyle = col(160, 20, 10); c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, Rpx, 0, 7); c.stroke();
  const mark = (dx, dy, label, strong) => {
    const a = screenAngle(dx, dy), x = cx + Math.cos(a) * (Rpx - 26), y = cy + Math.sin(a) * (Rpx - 26);
    c.fillStyle = col(strong ? 255 : 200, strong ? 80 : 40, strong ? 40 : 20); c.font = `bold ${strong ? 26 : 24}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, x, y);
    c.strokeStyle = c.fillStyle; c.lineWidth = 2; c.beginPath(); c.moveTo(cx + Math.cos(a) * (Rpx - 4), cy + Math.sin(a) * (Rpx - 4)); c.lineTo(cx + Math.cos(a) * (Rpx - 12), cy + Math.sin(a) * (Rpx - 12)); c.stroke();
    c.textBaseline = 'alphabetic';
  };
  if (ax) { mark(ax.n.x, ax.n.y, 'N'); mark(ax.e.x, ax.e.y, 'E'); }
  mark(0, 1, '⬆Z', true);
  return { mag, tfov, note, exit, rel };
}

// ---------------------------------------------------------------- Newtonian image orientation
// Ray model (unit magnification): sky offset ε from the target (⊥ T) → the primary+eyepiece act like an inverting
// afocal system along the tube; primary reflection (normal T) and 45° secondary (normal ∝ F−T) fold the beam out
// through the focuser along F. Result: apparent offset η = −(ε·F)T − (ε·S)S with S = T×F.
// The observer looks into the focuser (along −F) with head upright: up = zenith projected ⊥ F.
/**
 * 2×2 matrix mapping a naked-eye offset (x = toward increasing azimuth, y = toward zenith) to what the eye sees in a
 * Newtonian eyepiece (x right, y up). focuserDeg: focuser position around the tube, seen from behind the scope:
 * 0 = top, +90 = right side, −90 = left side.
 */
export function newtonianMatrix(tgt, focuserDeg) {
  const T = vecFromAltAz(tgt.alt, tgt.az), Z = [0, 0, 1];
  let Eaz = cross(T, Z); Eaz = Math.hypot(...Eaz) < 1e-6 ? [1, 0, 0] : norm(Eaz);
  const Ealt = norm(cross(Eaz, T));
  const f = focuserDeg * Math.PI / 180;
  const F = norm([0, 1, 2].map((i) => Math.cos(f) * Ealt[i] + Math.sin(f) * Eaz[i]));
  const S = cross(T, F);
  const zf = dot(Z, F);
  let U = Math.abs(zf) > 0.97 ? T.slice() : norm([0, 1, 2].map((i) => Z[i] - zf * F[i]));   // looking straight down: tube's sky end is "up"
  const L = F.map((v) => -v), R = cross(L, U);
  const map = (e) => { const a = dot(e, F), b = dot(e, S); const eta = [0, 1, 2].map((i) => -(a * T[i] + b * S[i])); return [dot(eta, R), dot(eta, U)]; };
  const [x1, y1] = map(Eaz), [x2, y2] = map(Ealt);
  return [[x1, x2], [y1, y2]];
}
export const applyM = (M, x, y) => [M[0][0] * x + M[0][1] * y, M[1][0] * x + M[1][1] * y];
