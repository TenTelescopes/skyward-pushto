import { GC_VHB } from './globulars.js';
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
/** Magnitudes lost to the air at an altitude, relative to overhead (for the eyepiece pictures). */
export const extinctionAt = (alt) => K_EXT * (airmass(alt) - 1);

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

/** The inverse: naked-eye limiting magnitude for a sky brightness (mag/arcsec²). */
export function nelmFromSky(sb) { return 5 * (1.586 - Math.log10(1 + 10 ** ((21.58 - sb) / 5))); }

/**
 * A sky darkness check made with the Moon up or in twilight measures light pollution + moonlight + twilight together.
 * Take away the modelled moonlight and twilight in the direction looked at (the Little Dipper) to get the moonless sky
 * (light pollution only), which is what the ratings start from; they add the Moon back for each target and time.
 * Returns { nelm, share } (share = the part of the measured sky that is light pollution), or null when the Moon and
 * twilight make up nearly all of what was seen, so the light pollution underneath can't be told.
 */
export function moonlessNelm({ nelm, moonAlt = -90, moonFrac = 0, sepDeg = 180, targetAlt = 45, sunAlt = -30 }) {
  const Btot = cdFromSB(skyFromNelm(nelm));
  const Bextra = moonlight({ moonAlt, moonFrac, sepDeg, targetAlt }) + twilight(sunAlt);
  const Bbase = Btot - Bextra, share = Bbase / Btot;
  if (share < 0.15) return null;
  return { nelm: nelmFromSky(sbFromCd(Bbase)), share };
}

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

/** How steady the air is: 'poor', 'average' (the default) or 'good'. Southern Ontario's jet stream keeps most nights
 *  "average", when the air rather than the mirror sets the useful power: about 150× (see planetEp). */
let SEEING = 'average';
export function setSeeing(s) { SEEING = ['poor', 'average', 'good'].includes(s) ? s : 'average'; }
export const seeing = () => SEEING;
/** Closest pair a telescope can split tonight, in arcseconds: the Dawes limit (116″ ÷ aperture in mm) or what the air
 *  allows, whichever is bigger. */
export const splitLimit = (aperture) => Math.max(116 / aperture, SEEING_SPLIT[SEEING]);
/** Most power the air supports tonight, and the smallest gap (″) it lets the eye split. */
// Even good nights here rarely hold more than about 300×.
const SEEING_CAP = { poor: 100, average: 150, good: 300 }, SEEING_SPLIT = { poor: 2.5, average: 1.5, good: 1.0 };
const powerCap = (scope) => Math.min(1.3 * scope.aperture, SEEING_CAP[SEEING]);
/** Eyepiece to suggest for a solar-system object: the whole Moon in view; for planets, as much power as the aperture
 *  and tonight's air support. epSteady: a higher power worth trying when the air settles (null if none). */
function planetEp(o, scope) {
  const list = mags(scope).sort((a, b) => a.M - b.M);                            // low power first
  if (o.id === 'Moon') return (list.filter((x) => x.ep.afov / x.M >= 0.6).pop() || list[0]).ep;
  return (list.filter((x) => x.M <= powerCap(scope)).pop() || list[0]).ep;
}
function planetSteady(o, scope) {
  if (!o.planet || o.id === 'Moon') return null;
  const top = mags(scope).filter((x) => x.M <= Math.min(1.3 * scope.aperture, SEEING_CAP.good)).sort((a, b) => b.M - a.M)[0], ep = planetEp(o, scope);
  return top && top.ep !== ep ? top.ep : null;
}
/**
 * Eyepiece that gives the best VIEW of an extended object, as long as it stays at the same rating as the easiest one.
 * The threshold model alone favours whatever makes an object easiest to detect, which put every globular at 33× and
 * faint galaxies at 188×. Instead: frame the object to a sensible share of the field (globulars a third, so they break
 * into stars; small planetaries big enough to show their shape), and never dimmer than a useful exit pupil (2 mm for
 * galaxies and nebulae, which fade into the background beyond that).
 */
const VIEW = { GX: [2.0, 0.35], NB: [2.0, 0.6], CN: [2.0, 0.6], OC: [1.5, 0.6], GC: [0.9, 0.3], PN: [0.7, 0.12], CM: [2.0, 0.3], AS: [2.0, 0.8] };
function viewEp(o, list, bestOne, scope) {
  const [pupil, frac] = VIEW[o.t] || [1.5, 0.5], lv = levelOf(bestOne.margin), size = o.maj || 5;
  const L = list.map((x) => ({ ...x, tf: (x.ep.afov || 62) / x.M * 60 }));
  const widest = L.reduce((a, b) => (b.tf > a.tf ? b : a));
  // Globulars and planetaries are about detail, so a step down from Obvious to Visible is worth it for a view that shows it.
  const floor = ['GC', 'PN'].includes(o.t) ? Math.max(lv, 1) : lv;
  let ok = L.filter((x) => levelOf(x.margin) <= floor && scope.aperture / x.M >= pupil && x.M <= powerCap(scope) * 1.25);
  if (!ok.length) return bestOne;
  const want = size / frac;                                                    // field width that frames it nicely
  const score = (x) => Math.abs(Math.log(x.tf / want)) + (x.tf < size * 1.05 && x !== widest ? 3 : 0);
  return ok.sort((a, b) => score(a) - score(b))[0];
}
/** A pair looks comfortably split when the eyepiece shows it this far apart: 4 arcminutes (2′ is only just separable). */
export const SPLIT_ARCSEC = 240;
/** Apparent gap (arcseconds, as seen in the eyepiece) for a comfortable split. 4′ is plenty for a matched pair, but a
 *  faint companion next to a bright star hides in its glare and needs more room: up to 15′ at 6 magnitudes' difference.
 *  Polaris (18″, 2.0 and 9.1) then wants about 50×; observers report it at 37–74× in small scopes (Astronomy, Apr 2019). */
export const splitArcsec = (dm = 0) => SPLIT_ARCSEC + Math.max(0, Math.min(4, dm - 2)) * 165;
export const LEVEL_NAMES = ['Obvious', 'Visible', 'Challenging', 'Not now'];
export const DOTS = ['●●●', '●●○', '●○○', '○○○'];
const levelOf = (m) => (m >= 1.5 ? 0 : m >= 0.6 ? 1 : m >= -0.2 ? 2 : 3);
const DAY_PLANETS = ['Moon', 'Venus', 'Jupiter', 'Saturn', 'Mars'];

function objectGeometry(o) {
  if (o.mag == null || !o.maj) return null;
  let area = Math.PI / 4 * o.maj * (o.min || o.maj), mag = o.mag;
  // Galaxies and bright nebulae: the eye sees the bright inner part, not the catalogue's faint outer edge.
  // Use the inner quarter of the size, holding roughly a quarter of the light.
  if (['GX', 'NB', 'CN', 'CM'].includes(o.t)) { area /= 16; mag += 1.4; }        // comets too: a brighter, condensed head in a faint coma
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
/** True when an object is more than 1.5 times wider than the widest eyepiece's true field. */
export function tooWide(o, scope) {
  if (!o.maj || !scope || !scope.eyepieces || !scope.eyepieces.length) return false;
  const widest = Math.max(...scope.eyepieces.map((e) => (e.afov || 62) / (scope.fl / e.fl)));      // degrees
  return o.maj / 60 > widest * 1.5;
}
export function rate(o, cond, scope) {
  const { alt, sunAlt = -30, moonAlt = -90, moonFrac = 0, moonSep = 180, nelm = DEFAULT_NELM } = cond;
  if (alt <= 0) return { level: 3, margin: -9, ep: null, cause: 'below' };
  const key = o.key || '', isStar = key.startsWith('st:'), isDouble = key.startsWith('ds:') || (isStar && !!o.pairs) || o.t === 'DS';       // M40 is a double filed among the deep-sky objects
  if (isStar && !o.show) return null;                                // alignment stars aren't targets
  // Star patterns far bigger than the widest eyepiece field are naked-eye or binocular sights, not telescope targets.
  if (o.t === 'AS' && o.maj && tooWide(o, scope)) return null;
  if (o.shower) {                                                    // a meteor shower: how many an hour one person might see now
    if (sunAlt > -12) return { level: 3, margin: -9, ep: null, cause: sunAlt > 0 ? 'daylight' : 'twilight', hr: 0 };
    const Bm = moonlight({ moonAlt, moonFrac, sepDeg: moonSep, targetAlt: Math.max(alt, 30) });
    const lm = nelmFromSky(sbFromCd(cdFromSB(skyFromNelm(nelm)) + Bm + twilight(sunAlt)));
    const sh = o.shower, hr = sh.zhrNow * Math.sin(alt * D2R) / sh.r ** Math.max(0, 6.5 - lm);
    const level = hr >= 15 ? 0 : hr >= 5 ? 1 : hr >= 1 ? 2 : 3;
    return { level, margin: Math.log10(hr + 0.01), ep: null, cause: level === 3 ? 'few' : Bm > 0 && level > 0 ? 'moon' : null, hr };
  }
  if (o.planet && DAY_PLANETS.includes(o.id)) return { level: 0, margin: 5, ep: planetEp(o, scope), epSteady: planetSteady(o, scope), cause: null };
  if (sunAlt > 0) return { level: 3, margin: -9, ep: null, cause: 'daylight' };   // with the Sun up: Moon, Venus, Jupiter, Saturn, Mars only
  if (o.planet) {
    if (o.id === 'Mercury') return { level: sunAlt < -3 ? 1 : 2, margin: 1, ep: null, cause: 'twilight' };
  }
  const skySB = skyFromNelm(nelm);
  const Bbase = cdFromSB(skySB), Bmoon = moonlight({ moonAlt, moonFrac, sepDeg: moonSep, targetAlt: alt }), Btw = twilight(sunAlt);
  const Bsky = Bbase + Bmoon + Btw, ext = K_EXT * (airmass(alt) - 1);
  const best = (list) => list.reduce((a, b) => (b.margin > a.margin ? b : a));
  let one;
  if (o.planet || isDouble || isStar || o.t === 'TR') {             // TR: a nova or supernova, a point of light
    const mm = o.planet || o.t === 'TR' ? (o.mag ?? 6) : (() => { const p = (o.pairs && o.pairs[0]) || {}; const ms = String(p.mags || '').split('/').map(Number).filter((x) => !Number.isNaN(x)); return ms.length ? Math.max(...ms) : (o.mag ?? 7); })();
    const calc = (B) => best(starMargins(mm + ext, B, scope));
    one = calc(Bsky);
    if (isDouble) {                                                            // also needs splitting
      const p = (o.pairs && o.pairs[0]) || {}, sep = p.sep ?? o.sep;
      if (!sep) return null;
      const limit = Math.max(116 / scope.aperture, SEEING_SPLIT[SEEING]), maxM = Math.min(Math.max(...mags(scope).map((x) => x.M)), powerCap(scope) * 1.3);
      const ms = String(p.mags || '').split('/').map(Number).filter((x) => !Number.isNaN(x)), dm = ms.length > 1 ? Math.abs(ms[1] - ms[0]) : 0;
      const split = sep / limit, needM = splitArcsec(dm) / sep;     // enough power for a comfortable split
      let lv = levelOf(one.margin);
      if (split < 1 || needM > maxM * 1.3) lv = 3;
      else { if (split < 1.5 || needM > maxM) lv = Math.max(lv, 2); else if (split < 3) lv = Math.max(lv, 1); if (dm >= 3 && sep < 6) lv = Math.min(3, lv + 1); }
      if (lv === 0 && ms.length && Math.min(...ms) > 8.5) lv = 1;          // a pair of faint stars is easy to see but nothing jumps out: never "Obvious"
      const epSplit = mags(scope).filter((x) => x.M >= needM).sort((a, b) => a.M - b.M)[0] || mags(scope).sort((a, b) => b.M - a.M)[0];
      return { level: lv, margin: one.margin, ep: epSplit.ep, cause: lv === 0 ? null : split < 3 ? 'close' : cause(o, cond, scope, lv) };
    }
  } else {
    const g = objectGeometry(o); if (!g) return null;
    // An open cluster of bright stars: judged by its brighter members too (needing to beat the star limit by 2 magnitudes
    // to stand out as a group), in the highest-power eyepiece that still frames it (else the widest). Whichever judgement is better wins.
    const frame = () => { const L = mags(scope).map((x) => ({ ...x, tf: (x.ep.afov || 62) / x.M * 60 })).sort((a, b) => a.M - b.M);
      return (L.filter((x) => x.tf >= o.maj * 1.2).pop() || L[0]); };
    // Big galaxies with a bright core (M31): also judged by the core alone, so the city observer's "fuzzy star" counts.
    const gc = o.core ? { sb: o.core.mag + 2.5 * Math.log10(Math.PI / 4 * o.core.size ** 2) + 8.89, area: Math.PI / 4 * o.core.size ** 2 } : null;
    const each = (B) => {                                                     // margin in every eyepiece, by the better judgement
      const sb = extendedMargins(g.sb + ext, g.area, B, scope), co = gc ? extendedMargins(gc.sb + ext, gc.area, B, scope) : null;
      const st = o.members ? starMargins(o.members.m5 + ext, B, scope) : null, f = o.members ? frame() : null;
      return sb.map((x, i) => {
        let m = x.margin; if (co) m = Math.max(m, co[i].margin);
        if (st && st[i].ep === f.ep) m = Math.max(m, st[i].margin - 2);
        return { ep: x.ep, M: x.M, margin: m };
      });
    };
    const calc = (B) => best(each(B));
    one = calc(Bsky);
    one = { ...one, ep: viewEp(o, each(Bsky), one, scope).ep };
    const lv = levelOf(one.margin), res = o.t === 'GC' ? gcResolve(o, Bsky, ext, scope) : null;
    if (lv === 0) return { level: 0, margin: one.margin, ep: one.ep, cause: null, res };
    // What is holding it back most?
    const gains = {
      moon: Bmoon > 0 ? calc(Bbase + Btw).margin - one.margin : 0,
      twilight: Btw > 0 ? calc(Bbase + Bmoon).margin - one.margin : 0,
      low: alt < 35 ? best(extendedMargins(g.sb, g.area, Bsky, scope)).margin - one.margin : 0,
      sky: nelm < 6.2 ? calc(cdFromSB(skyFromNelm(6.3)) + Bmoon + Btw).margin - one.margin : 0,
    };
    const top = Object.entries(gains).sort((a, b) => b[1] - a[1])[0];
    return { level: lv, margin: one.margin, ep: one.ep, cause: top[1] >= 0.4 ? top[0] : 'faint', res };
  }
  let lv = levelOf(one.margin);
  if (o.planet && lv < 1) lv = 1;                                               // Uranus and Neptune: there, but tiny and star-like — not a showpiece
  const ep = o.planet ? planetEp(o, scope) : mags(scope).sort((a, b) => a.M - b.M)[0].ep;   // a single star looks best, and is easiest to find, at low power
  return { level: lv, margin: one.margin, ep, epSteady: planetSteady(o, scope), cause: lv ? cause(o, cond, scope, lv) : null };
}
/**
 * Can this telescope break a globular cluster into stars tonight? From the cluster's horizontal branch (V_HB, Harris
 * 2010): its brightest red giants are about 3 magnitudes brighter than that, and stars become numerous at it. A star
 * counts as seen when the faintest-star limit in the best eyepiece beats it by half a magnitude (the cluster's own glow
 * brightens the background). A rule of thumb, not a published method. (Build 120)
 * Returns 3 resolved across the face, 2 edges break into stars, 1 grainy with a few stars at the edges, 0 a glow;
 * null without V_HB.
 */
function gcResolve(o, Bsky, ext, scope) {
  const vhb = GC_VHB[o.id]; if (vhb == null) return null;
  const lim = Math.max(...starMargins(0, Bsky, scope).map((x) => x.margin)) - ext - 0.5;   // faintest star seen, magnitude
  return lim >= vhb + 0.3 ? 3 : lim >= vhb - 1.5 ? 2 : lim >= vhb - 2.7 ? 1 : 0;
}
function cause(o, cond, scope, lv) { return cond.alt < 25 ? 'low' : 'faint'; }

/** One plain-language line on what they'll see and why. */
export function describe(o, r) {
  if (!r) return '';
  const k = o.key || '';
  const t = o.planet ? 'PL' : k.startsWith('ds:') || (k.startsWith('st:') && o.pairs) ? 'DS' : k.startsWith('st:') ? 'ST' : k.startsWith('as:') ? 'AS' : o.t;
  const see = {
    GX: ['Bright oval glow with a brighter centre', 'Faint grey smudge — look slightly to one side of it', 'Barely there — you may only catch it from the corner of your eye'],
    NB: ['Clear glowing cloud', 'Soft faint glow — averted vision helps', 'Very faint — a nebula filter helps a lot'],
    CN: ['Stars wrapped in a glowing cloud', 'Stars with a faint glow around them', 'The stars show; the glow is very hard'],
    PN: ['Small, clear disc or ring', 'Small faint disc — find it at low power, then add magnification', 'Very faint — sweep slowly'],
    GC: ['Bright ball of stars, edges sparkle', 'Round fuzzy glow, brighter centre', 'Faint round smudge'],
    OC: ['Rich, sparkling group of stars', 'A loose group of fainter stars', 'A few faint stars — hard to pick out from the background'],
    AS: ['Easy star pattern', 'Faint star pattern', 'Hard to make out'],
    DS: ['Splits cleanly — look for colour', 'Splits with the higher power', 'A tough split — needs steady air (good seeing)'],
    PL: ['Bright and easy', 'Visible', 'Hard to spot'],
    ST: ['Bright star — look at its colour', 'Easy star', 'Faint star'],
    CM: ['Bright fuzzy head — look for a tail', 'Soft round glow with a brighter middle', 'Faint smudge — averted vision helps'],
    TR: ['Easy to pick out — compare it with the stars around it', 'A faint new star — check the chart closely', 'Very faint — at the limit'],
    MS: ['Plenty of meteors — look anywhere, not at the radiant', 'Some meteors — lie back and give it 20 minutes', 'Only the odd meteor'],
  }[t] || ['Easy', 'Visible', 'Hard'];
  // Globulars with Harris data: say how far the scope breaks it into stars, not just how bright the glow is.
  if (t === 'GC' && r.res != null && r.level < 3) {
    const glow = r.level === 2 ? 'Faint round glow' : r.level === 1 ? 'Round glow' : 'Bright round glow';
    const lines = [`${glow} with a brighter centre`, `${glow}, grainy — a few stars at the edges with averted vision`, 'Ball of stars: the edges break into stars, the centre stays a glow', 'Ball of stars, resolved right across its face'];
    const why = { moon: 'Moon washes it out', twilight: 'Sky not dark yet', low: 'Low in the haze', sky: 'Light pollution' }[r.cause];
    return `${lines[r.res]}${why && r.res < 3 ? ` · ${why}` : ''}`;
  }
  if (o.planet && (o.id === 'Uranus' || o.id === 'Neptune') && r.level < 3) return r.level === 1 ? 'A tiny disc, almost star-like — high power shows it is not a star' : 'Tiny and faint — hard to tell from a star';
  const why = { moon: 'Moon washes it out', twilight: 'Sky not dark yet', low: 'Low in the haze', sky: 'Light pollution', close: 'Close pair', faint: 'Faint', below: 'Below the horizon', daylight: 'Daylight', blocked: 'Behind the trees or buildings you marked' }[r.cause] || '';
  if (o.shower) return r.level === 3 ? (r.cause === 'daylight' || r.cause === 'twilight' ? 'Not now — wait for full dark' : 'Not now — too few to be worth the wait') : `${['Plenty of meteors — look anywhere, not at the radiant', 'Some meteors — lie back and give it 20 minutes', 'Only the odd meteor'][Math.min(2, r.level)]} · about ${Math.max(1, Math.round(r.hr))} an hour${r.cause === 'moon' ? ' · the Moon hides the fainter ones' : ''}`;
  if (r.level === 3) return why ? `Not now — ${why === 'Moon washes it out' ? 'the Moon washes it out' : why.toLowerCase()}` : 'Not now';
  return `${see[Math.min(2, r.level)]}${r.level > 0 && why && r.cause !== 'faint' ? ` · ${why}` : ''}`;
}
