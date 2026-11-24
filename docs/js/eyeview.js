// "What you should see": the target centred in a chosen eyepiece, drawn to scale.
// Stars come from the Hipparcos field (to mag 8); deep-sky shapes use OpenNGC size and position angle;
// planet discs use their real radius and current distance. Brightness is NOT to scale — the label says so.
import { tangentOffset, D2R, vecFromAltAz, cross, norm, dot } from './model.js';
import { tint, starTint, theme } from './theme.js';
import { PAIR_CLASS, STAR_CLASS } from '../data/blurbs.js';
import { splitArcsec } from './vis.js';

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
  const date = opts.date || new Date();
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
  // Every star is drawn the same way: a bright centre melting into a soft veil, with no hard edge. Size and strength both
  // scale with brightness, so a faint star is a small dim glow and a bright one a larger, stronger glow. Veils add where
  // they overlap, so close stars blend at the edges while their centres stay distinct. `paint(alpha)` gives the colour.
  const u = Math.max(1, W / 300);
  const starR = (m) => Math.max(2.6, Math.min(13, 4 + 1.25 * (7 - m))) * u;      // radius of a star's drawn glow
  const star = (x, y, m, paint) => {
    const lum = Math.max(0.42, Math.min(1, 1 - (m - 2.5) * 0.085));
    const R = starR(m);
    const g = c.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, paint(lum)); g.addColorStop(0.16, paint(lum * 0.95)); g.addColorStop(0.36, paint(lum * 0.42)); g.addColorStop(0.65, paint(lum * 0.12)); g.addColorStop(1, paint(0));
    c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = g; c.beginPath(); c.arc(x, y, R, 0, 7); c.fill();
    if (m < 3.2) { const w = c.createRadialGradient(x, y, 0, x, y, R * 0.2); w.addColorStop(0, `rgba(255,255,255,${(0.6 * (1 - theme.shade)).toFixed(2)})`); w.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = w; c.beginPath(); c.arc(x, y, R * 0.2, 0, 7); c.fill(); }   // white-hot centre on the brightest, toward Day
    c.restore();
  };
  const plain = (al) => col(255, 90, 50, al);
  // A cluster's own stars are mostly fainter than the star catalogue here (mag 8), so they are sketched: a sprinkle of
  // faint points inside the catalogued size, thicker toward the middle, the same every time for the same object.
  // Brighter (richer) clusters get more. It shows the look and the size, not the real star positions.
  const sprinkle = (majArcmin, m) => {
    c.restore(); c.save(); c.beginPath(); c.arc(cx, cy, Rpx, 0, 7); c.clip();
    let sd = 7; for (const ch of String(o.id || o.label)) sd = (sd * 31 + ch.charCodeAt(0)) % 2147483647;
    const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    const a = (majArcmin / 120) * s, n = Math.round(Math.max(24, Math.min(140, 30 + (9 - m) * 22)));
    for (let i = 0; i < n; i++) {
      const rr = a * rnd() ** 0.75, th = rnd() * 6.2832, b = rnd();
      star(cx + rr * Math.cos(th), cy + rr * Math.sin(th), 10.5 - 3.5 * b * b, plain);
    }
  };
  const t = o.planet ? 'PL' : o.key.startsWith('ds:') ? 'DS' : o.t;
  let note = '', enlarged = 0, widened = false;
  if (t === 'GX') ell(o.maj || 3, o.min, o.pa, (a, b) => { glow(a, b, 0.55); c.scale(1, a / b); glow(a * 0.12, b * 0.12, 0.9); });
  else if (t === 'GC') ell(o.maj || 5, o.maj || 5, 0, (a) => { glow(a, a, 0.85); c.globalAlpha = 1; /* member stars are points: they don't dim, so a globular resolves better at high power */ let sd = 12345; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647); for (let i = 0; i < 90; i++) { const r = a * Math.sqrt(rnd()) * 0.9, th = rnd() * 7; star(Math.cos(th) * r, Math.sin(th) * r, 10.5, plain); } c.globalAlpha = shown; });
  else if (t === 'PN') ell(o.maj || 1, o.min, o.pa, (a, b) => { c.fillStyle = col(200, 60, 40, 0.75); c.beginPath(); c.ellipse(0, 0, a, b, 0, 0, 7); c.fill(); if (/^M57$|Ring/.test(o.label + o.name)) { c.fillStyle = col(10, 0, 0); c.beginPath(); c.ellipse(0, 0, a * 0.45, b * 0.45, 0, 0, 7); c.fill(); } });
  else if (t === 'NB' || t === 'CN') { ell(o.maj || 10, o.min, o.pa, (a, b) => glow(a, b, 0.35, 0.05)); if (t === 'CN') sprinkle((o.maj || 10) * 0.7, (o.mag ?? 7) + 1); }
  else if (t === 'DN') { ell(o.maj || 10, o.min, o.pa, (a, b) => { c.fillStyle = 'rgba(0,0,0,0.6)'; c.beginPath(); c.ellipse(0, 0, a, b, 0, 0, 7); c.fill(); }); note = 'A dark cloud: look for a patch with fewer stars, not a glow'; }
  else if (t === 'OC') { sprinkle(o.maj || 8, o.mag ?? 7); note = 'Faint cluster stars are sketched to show the look and size, not plotted one by one'; }
  else if (t === 'OC' || t === 'AS') { if (o.maj) { c.restore(); c.save(); c.beginPath(); c.arc(cx, cy, Rpx, 0, 7); c.clip(); c.strokeStyle = col(90, 10, 0, 0.6); c.setLineDash([4, 8]); c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, Math.min(Rpx * 1.5, (o.maj / 120) * s), 0, 7); c.stroke(); c.setLineDash([]); } }

  c.globalAlpha = 1;
  // field stars — point sources: not dimmed by magnification
  const isPair = t === 'DS' && o.pairs && o.pairs.length;
  const pairFaint = isPair ? Math.max(...String(o.pairs[0].mags || '').split('/').map(Number).filter((x) => !Number.isNaN(x)), o.mag ?? 6) : 0;
  // A big cluster overflows a narrow field, and its catalogue centre can fall between the bright stars. Then aim at its
  // brightest star instead, as an observer would, so a high-power view is never an empty patch of sky.
  if ((t === 'OC' || t === 'CN' || t === 'AS') && o.maj && o.maj / 60 > tfov) {
    let best = null;
    for (const [, v] of sky.fieldNear(tgt.alt, tgt.az, Math.min(o.maj / 120, 5), 8, date)) if (!best || v.mag < best.mag) best = v;
    const off = best && tangentOffset(tgt, best);
    if (off && Math.hypot(off.x, off.y) > rad * 0.45) { tgt = { alt: best.alt, az: best.az }; note = 'Wider than this eyepiece: centred on its brightest star'; }
  }
  const field = sky.fieldNear(tgt.alt, tgt.az, rad * 1.3, 8, date);
  for (const [, v] of field) {
    if (v.mag > 8) continue;
    const off = tangentOffset(tgt, v); if (!off) continue;
    // The pair itself is drawn below. Catalogue positions are rounded, so its own stars can sit a few arcminutes off centre.
    if (isPair && Math.hypot(off.x, off.y) < Math.max(0.07, (o.pairs[0].sep || 0) / 3600 * 1.5) && v.mag <= pairFaint + 0.8) continue;
    const q = P(off.x, off.y);
    star(q.x, q.y, v.mag, plain);
  }

  // planets / Moon / double stars at the centre
  if (t === 'PL') {
    const d = sky.diameter(o.id, date);
    // In the small previews a planet drawn to scale is a pixel or two, so it is drawn 4x larger there (the caption says so).
    const boost = opts.thumb && d && d < 2 ? 4 : 1;
    const r = d ? (d / 60 / 2) * s * boost : 3;
    if (r > 3) c.globalAlpha = Math.max(0.35, shown);  // a resolved disc is an extended object too
    const pc = col(255, 110, 60);
    c.fillStyle = pc; c.beginPath(); c.arc(cx, cy, Math.max(1.5, r), 0, 7); c.fill();
    if (o.id === 'Saturn' && r > 1.2) { c.strokeStyle = pc; c.lineWidth = Math.max(1, r * 0.22); c.beginPath(); c.ellipse(cx, cy, r * 2.25, r * 0.7, -0.3, 0, 7); c.stroke(); }
    if (o.id === 'Jupiter' && r > 4) { c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = Math.max(1, r * 0.13); for (const y of [-0.3, 0.3]) { const w = r * Math.sqrt(1 - y * y); c.beginPath(); c.moveTo(cx - w, cy + y * r); c.lineTo(cx + w, cy + y * r); c.stroke(); } }
    c.globalAlpha = 1;
    note = d ? `${o.id} disc ${d >= 1 ? d.toFixed(1) + '′' : (d * 60).toFixed(0) + '″'} across` : '';
    if (boost > 1) enlarged = boost;
  } else if (t === 'DS' && o.pairs && o.pairs.length) {
    const pr = o.pairs[0], sepDeg = pr.sep / 3600, mags = String(pr.mags).split('/').map(Number);
    let dx = 0, dy = sepDeg;
    if (ax) { dx = (Math.cos(pr.pa * D2R) * ax.n.x + Math.sin(pr.pa * D2R) * ax.e.x) * sepDeg; dy = (Math.cos(pr.pa * D2R) * ax.n.y + Math.sin(pr.pa * D2R) * ax.e.y) * sepDeg; }
    // Split: separation above the Dawes limit (116/D″) and magnified enough for the eye: 4′ apparent for a matched pair,
    // more when the companion is much fainter and sits in the bright star's glare (splitArcsec, the same rule as the ratings).
    const dm = mags.length > 1 && !Number.isNaN(mags[1]) ? Math.abs(mags[1] - mags[0]) : 0;
    const dawes = 116 / scope.aperture, resolved = pr.sep >= dawes, split = resolved && mag * pr.sep >= splitArcsec(dm);
    // The eye resolves far finer detail than this picture has pixels, so a pair drawn strictly to scale would merge even
    // when the eyepiece splits it cleanly. Draw what the eye would make of it instead: clearly apart when split, just
    // touching when tight, one star when below the telescope's limit. Wider pairs keep their true spacing.
    const L = Math.hypot(dx, dy) || 1, truePx = L * s, app = mag * pr.sep / 60;                                   // how far apart the pair looks to the eye, arcminutes
    let want = !resolved ? 0 : split ? Math.min(18, 7 + 3 * Math.log2(app / 4)) * u : 4.5 * u, px = truePx >= want ? truePx : truePx + 0.4 * (want - truePx);   // wider at higher power; only 40% of the way from true scale to that spacing
    // A faint companion must sit clear of the bright star's soft veil, or the picture hides what the eye can see.
    const rA = starR(mags[0] || 4), rB = starR(mags[1] || 6);
    if (split && px < rA * 0.85 + rB + 2 * u) px = rA * 0.85 + rB + 2 * u;
    else if (resolved && !split && dm >= 2 && px < rA * 0.6 + rB) px = rA * 0.6 + rB;
    const hx = (dx / L) * px / 2 / s, hy = (dy / L) * px / 2 / s;
    const A = P(-hx, -hy), B = P(hx, hy);
    const pc = PAIR_CLASS[o.label] || '';
    const paintOf = (cls) => (starTint(cls, 1, k) ? (al) => starTint(cls, al, k) : (al) => col(255, 120, 70, al));
    star(B.x, B.y, mags[1] || 6, paintOf(pc[1])); star(A.x, A.y, mags[0] || 4, paintOf(pc[0]));
    if (px > truePx * 1.3 && resolved) widened = true;
    // Name each star of the pair (A, B… as in the double-star catalogues), out beyond each star along the line joining
    // them; one label when the scope can't split them. The full-size view adds the name and magnitudes.
    const [la, lb] = String(pr.c || 'AB').length >= 2 ? [pr.c[0], pr.c[1]] : ['A', 'B'];
    const nm = opts.thumb ? '' : `${o.label} `, fs = Math.round((opts.thumb ? 15 : 9) * u);
    c.font = `bold ${fs}px system-ui`; c.textBaseline = 'middle'; c.fillStyle = col(255, 160, 110);
    const ux = (B.x - A.x) / (Math.hypot(B.x - A.x, B.y - A.y) || 1), uy = (B.y - A.y) / (Math.hypot(B.x - A.x, B.y - A.y) || 1);
    const put = (x, y, dir, txt, r) => {                                     // just past the star's glow, on the far side from its partner
      const vx = dir * ux, vy = dir * uy, d = r + 4 * u;
      c.textAlign = vx > 0.35 ? 'left' : vx < -0.35 ? 'right' : 'center'; c.textBaseline = vy > 0.35 ? 'top' : vy < -0.35 ? 'bottom' : 'middle';
      c.fillText(txt, x + vx * d, y + vy * d);
    };
    if (resolved && px >= rA * 0.6 + rB) {
      put(A.x, A.y, -1, `${nm}${la}${opts.thumb ? '' : ` (mag ${(+mags[0]).toFixed(1)})`}`, rA);
      put(B.x, B.y, 1, `${nm}${lb}${opts.thumb ? '' : ` (mag ${(+mags[1]).toFixed(1)})`}`, rB);
    } else { c.textAlign = 'left'; c.fillText(`${nm}${la}+${lb}`, A.x + rA + 6 * u, A.y - rA); }
    c.textBaseline = 'alphabetic';
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
  mark(0, 1, '↑Z', true);
  return { mag, tfov, note, enlarged, widened, exit, rel };
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
