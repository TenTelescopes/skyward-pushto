// Visibility model — "how well will I see it tonight, in this scope?"
// A general guide, not a precise prediction. Built from published models:
//   • eye contrast threshold: Crumey (2014, MNRAS 442, 2600), scotopic model, fitted to Blackwell's data
//   • eyepiece background and magnification: the standard exit-pupil treatment (as in Clark / Torres)
//   • moonlight: Krisciunas & Schaefer (1991, PASP 103, 1033)
// The observer's own sky comes from the Little Dipper check (naked-eye limiting magnitude). The sky brightness
// is solved from that with the SAME eye model, so the observer's eyes and sky are folded in together.

const D2R = Math.PI / 180;
const Q = 0.6, R1 = 6.505e-4, R2 = -8.461e-4, K1 = 7.633e-3, K2 = -7.174e-3;
export const F_EYE = 1.4;          // observer field factor (Crumey's examples span ~0.5–2.7; with the eyepiece factor below the total is ~2)
const F_TEL = Math.SQRT2;          // extra factor at the eyepiece (Crumey)
const T = 0.72;                    // light reaching the eye in a Newtonian: two mirrors + obstruction + eyepiece
const EYE_PUPIL = 7;               // mm, dark-adapted
const K_EXT = 0.25;                // V-band extinction, mag per airmass (typical inland site)
const ARCMIN2_SR = (Math.PI / 10800) ** 2;
export const DEFAULT_NELM = 5.0;   // assumed suburban sky until the observer checks

// ---- photometric helpers
export const cdFromSB = (mu) => 10 ** ((12.58 - mu) / 2.5);                 // mag/arcsec² → cd/m²
export const sbFromCd = (b) => 12.58 - 2.5 * Math.log10(b);
const luxFromMag = (m) => 10 ** (-0.4 * (m + 13.99));                       // star of V mag → illuminance
const nLtoCd = (nl) => nl * 3.183e-6;
const airmass = (alt) => 1 / Math.sqrt(1 - 0.96 * Math.cos(Math.max(1, alt) * D2R) ** 2);

/** Crumey scotopic threshold contrast for a uniform target of solid angle A (sr) on background B (cd/m²). */
export function threshold(B, A) {
  const b = Math.max(B, 1e-6) ** -0.25;
  const R = (R1 * b + R2) ** 2, Cinf = Math.max(1e-6, K1 * b + K2);
  return ((R / A) ** Q + Cinf ** Q) ** (1 / Q);
}
/** Faintest star visible on background B: threshold illuminance = R·B. */
export function starLimit(B, F = F_EYE) {
  const b = Math.max(B, 1e-6) ** -0.25, R = (R1 * b + R2) ** 2;
  return -2.5 * Math.log10(F * R * B) - 13.99;
}
/** Sky brightness (mag/arcsec²) for a naked-eye limiting magnitude — the widely used empirical conversion. */
export function skyFromNelm(nelm) { return 21.58 - 5 * Math.log10(Math.max(1e-3, 10 ** (1.586 - nelm / 5) - 1)); }

/** Moonlight at the target, cd/m² (Krisciunas & Schaefer 1991). */
export function moonlight({ moonAlt, moonFrac, sepDeg, targetAlt }) {
  if (moonAlt <= 0 || targetAlt <= 0) return 0;
  const alpha = Math.acos(Math.max(-1, Math.min(1, 2 * moonFrac - 1))) / D2R;              // phase angle, deg
  const I = 10 ** (-0.4 * (3.84 + 0.026 * alpha + 4e-9 * alpha ** 4));
  const rho = Math.max(1, sepDeg);
  const f = 10 ** 5.36 * (1.06 + Math.cos(rho * D2R) ** 2) + 10 ** (6.15 - rho / 40);
  const k = 0.172;
  const nl = f * I * 10 ** (-0.4 * k * airmass(moonAlt)) * (1 - 10 ** (-0.4 * k * airmass(targetAlt)));
  return nLtoCd(nl);
}
/** Rough twilight sky glow, cd/m², from the Sun's altitude (0 when the Sun is 18° down). */
export function twilight(sunAlt) {
  if (sunAlt <= -18) return 0;
  return cdFromSB(21.6 - 0.75 * (Math.min(sunAlt, 0) + 18));
}

/** Telescope from the active profile: aperture, focal length, eyepieces. */
const mags = (scope) => scope.eyepieces.map((e) => ({ ep: e, M: scope.fl / e.fl }));

/**
 * Margin (in magnitudes) by which an extended object beats the eye's threshold in each eyepiece.
 * sb: object surface brightness (mag/arcsec², after extinction); areaArcmin2: its size; Bsky: cd/m².
 */
function extendedMargins(sb, areaArcmin2, Bsky, scope) {
  const C = cdFromSB(sb) / Bsky;                                   // object contrast against the sky (telescope can't change it)
  return mags(scope).map(({ ep, M }) => {
    const p = scope.aperture / M;
    const Ba = Bsky * T * Math.min(1, (p / EYE_PUPIL) ** 2);          // sky as seen in the eyepiece
    const Aa = areaArcmin2 * ARCMIN2_SR * M * M;                       // object's apparent size
    const Cth = F_TEL * F_EYE * threshold(Ba, Aa);
    return { ep, M, margin: 2.5 * Math.log10(C / Cth) };
  });
}
/** Margin for a star of magnitude m (after extinction) at the eyepiece giving the darkest background. */
function starMargins(m, Bsky, scope) {
  return mags(scope).map(({ ep, M }) => {
    const p = scope.aperture / M, Ba = Bsky * T * Math.min(1, (p / EYE_PUPIL) ** 2);
    const gain = T * Math.min(scope.aperture, EYE_PUPIL * M) ** 2 / EYE_PUPIL ** 2;   // light grasp vs the eye
    const lim = starLimit(Ba, F_TEL * F_EYE) + 2.5 * Math.log10(gain);
    return { ep, M, margin: lim - m };
  });
}

export const LEVEL_NAMES = ['Obvious', 'Visible', 'Challenging', 'Not now'];
export const DOTS = ['●●●', '●●○', '●○○', '○○○'];
const levelOf = (m) => (m >= 1.5 ? 0 : m >= 0.6 ? 1 : m >= -0.2 ? 2 : 3);
const DAY_PLANETS = ['Moon', 'Venus', 'Jupiter', 'Saturn', 'Mars'];

function objectGeometry(o) {
  if (o.mag == null || !o.maj) return null;
  let area = Math.PI / 4 * o.maj * (o.min || o.maj), mag = o.mag;
  // Galaxies and bright nebulae: the eye sees the bright inner part, not the catalogue's faint outer edge.
  // Use the inner quarter of the size, holding roughly a quarter of the light.
  if (['GX', 'NB', 'CN'].includes(o.t)) { area /= 16; mag += 1.4; }
  // Nebula magnitudes in catalogues often measure the embedded stars, not the glow. Trust the famous (Messier)
  // ones; treat the rest as about 2 mag fainter than listed — big faint ones (Veil, North America) want a filter.
  if (['NB', 'CN'].includes(o.t) && !(o.cats || []).some((c) => /^M\d/.test(c))) mag += 2;
  // Clusters and asterisms: resolved stars stand out better than an even glow of the same total light.
  if (['OC', 'AS', 'GC'].includes(o.t) || (o.key || '').startsWith('as:')) mag -= 1.0;
  return { area: Math.max(area, 0.01), sb: mag + 2.5 * Math.log10(Math.max(area, 0.01)) + 8.89 };
}

/**
 * Rate one object for given conditions.
 * cond: { alt, sunAlt, moonAlt, moonFrac, moonSep, nelm }
 * Returns { level 0..3, margin, ep (best eyepiece), cause } or null when the model has nothing to go on.
 */
export function rate(o, cond, scope) {
  const { alt, sunAlt = -30, moonAlt = -90, moonFrac = 0, moonSep = 180, nelm = DEFAULT_NELM } = cond;
  if (alt <= 0) return { level: 3, margin: -9, ep: null, cause: 'below' };
  if ((o.key || '').startsWith('st:')) return null;
  if (o.planet && DAY_PLANETS.includes(o.id)) return { level: 0, margin: 5, ep: null, cause: null };
  if (sunAlt > 0) return { level: 3, margin: -9, ep: null, cause: 'daylight' };   // with the Sun up: Moon, Venus, Jupiter, Saturn, Mars only
  if (o.planet) {
    if (o.id === 'Mercury') return { level: sunAlt < -3 ? 1 : 2, margin: 1, ep: null, cause: 'twilight' };
  }
  const skySB = skyFromNelm(nelm);
  const Bbase = cdFromSB(skySB), Bmoon = moonlight({ moonAlt, moonFrac, sepDeg: moonSep, targetAlt: alt }), Btw = twilight(sunAlt);
  const Bsky = Bbase + Bmoon + Btw, ext = K_EXT * (airmass(alt) - 1);
  const best = (list) => list.reduce((a, b) => (b.margin > a.margin ? b : a));
  let one;
  if (o.planet || (o.key || '').startsWith('ds:')) {
    const mm = o.planet ? (o.mag ?? 6) : (() => { const p = (o.pairs && o.pairs[0]) || {}; const ms = String(p.mags || '').split('/').map(Number).filter((x) => !Number.isNaN(x)); return ms.length ? Math.max(...ms) : (o.mag ?? 7); })();
    const calc = (B) => best(starMargins(mm + ext, B, scope));
    one = calc(Bsky);
    if ((o.key || '').startsWith('ds:')) {                                     // also needs splitting
      const p = (o.pairs && o.pairs[0]) || {}, sep = p.sep ?? o.sep;
      if (!sep) return null;
      const limit = Math.max(116 / scope.aperture, 1.5), maxM = Math.max(...mags(scope).map((x) => x.M));
      const split = sep / limit, needM = 120 / sep;
      const ms = String(p.mags || '').split('/').map(Number).filter((x) => !Number.isNaN(x)), dm = ms.length > 1 ? Math.abs(ms[1] - ms[0]) : 0;
      let lv = levelOf(one.margin);
      if (split < 1 || needM > maxM * 1.3) lv = 3;
      else { if (split < 1.5 || needM > maxM) lv = Math.max(lv, 2); else if (split < 3) lv = Math.max(lv, 1); if (dm >= 3 && sep < 6) lv = Math.min(3, lv + 1); }
      const epSplit = mags(scope).filter((x) => x.M >= needM).sort((a, b) => a.M - b.M)[0] || mags(scope).sort((a, b) => b.M - a.M)[0];
      return { level: lv, margin: one.margin, ep: epSplit.ep, cause: split < 3 ? 'close' : cause(o, cond, scope, lv) };
    }
  } else {
    const g = objectGeometry(o); if (!g) return null;
    const calc = (B) => best(extendedMargins(g.sb + ext, g.area, B, scope));
    one = calc(Bsky);
    const lv = levelOf(one.margin);
    if (lv === 0) return { level: 0, margin: one.margin, ep: one.ep, cause: null };
    // What is holding it back most?
    const gains = {
      moon: Bmoon > 0 ? calc(Bbase + Btw).margin - one.margin : 0,
      twilight: Btw > 0 ? calc(Bbase + Bmoon).margin - one.margin : 0,
      low: alt < 35 ? best(extendedMargins(g.sb, g.area, Bsky, scope)).margin - one.margin : 0,
      sky: nelm < 6.2 ? calc(cdFromSB(skyFromNelm(6.3)) + Bmoon + Btw).margin - one.margin : 0,
    };
    const top = Object.entries(gains).sort((a, b) => b[1] - a[1])[0];
    return { level: lv, margin: one.margin, ep: one.ep, cause: top[1] >= 0.4 ? top[0] : 'faint' };
  }
  const lv = levelOf(one.margin);
  return { level: lv, margin: one.margin, ep: one.ep, cause: lv ? cause(o, cond, scope, lv) : null };
}
function cause(o, cond, scope, lv) { return cond.alt < 25 ? 'low' : 'faint'; }

/** One plain-language line on what they'll see and why. */
export function describe(o, r) {
  if (!r) return '';
  const t = o.planet ? 'PL' : (o.key || '').startsWith('ds:') ? 'DS' : (o.key || '').startsWith('as:') ? 'AS' : o.t;
  const see = {
    GX: ['Bright oval glow with a brighter centre', 'Faint grey smudge — look slightly to one side of it', 'Barely there — you may only catch it from the corner of your eye'],
    NB: ['Clear glowing cloud', 'Soft faint glow — averted vision helps', 'Very faint — a nebula filter helps a lot'],
    CN: ['Stars wrapped in a glowing cloud', 'Stars with a faint glow around them', 'The stars show; the glow is very hard'],
    PN: ['Small, clear disc or ring', 'Small faint disc — try the 10 mm', 'Very faint — sweep slowly'],
    GC: ['Bright ball of stars, edges sparkle', 'Round fuzzy glow, brighter centre', 'Faint round smudge'],
    OC: ['Rich, sparkling group of stars', 'A loose group of fainter stars', 'A few faint stars — hard to pick out from the background'],
    AS: ['Easy star pattern', 'Faint star pattern', 'Hard to make out'],
    DS: ['Splits cleanly — look for colour', 'Splits with the higher power', 'A tough split — needs steady air'],
    PL: ['Bright and easy', 'Visible', 'Hard to spot'],
  }[t] || ['Easy', 'Visible', 'Hard'];
  const why = { moon: 'Moon washes it out', twilight: 'Sky not dark yet', low: 'Low in the haze', sky: 'Light pollution', close: 'Close pair', faint: 'Faint', below: 'Below the horizon', daylight: 'Daylight' }[r.cause] || '';
  if (r.level === 3) return why ? `Not now — ${why === 'Moon washes it out' ? 'the Moon washes it out' : why.toLowerCase()}` : 'Not now';
  return `${see[Math.min(2, r.level)]}${r.level > 0 && why && r.cause !== 'faint' ? ` · ${why}` : ''}`;
}
