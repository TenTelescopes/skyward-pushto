// Alignment assistant and long-push waypoints — pure functions, unit-tested in test/assist.test.mjs.
import { sepDeg, wrap180 } from './model.js';

export const CON_NAMES = {
  And: 'Andromeda', Aql: 'Aquila', Aqr: 'Aquarius', Ari: 'Aries', Aur: 'Auriga', Boo: 'Boötes', CMa: 'Canis Major', CMi: 'Canis Minor',
  CVn: 'Canes Venatici', Cap: 'Capricornus', Car: 'Carina', Cas: 'Cassiopeia', Cen: 'Centaurus', Cep: 'Cepheus', Cet: 'Cetus',
  CrB: 'Corona Borealis', Cru: 'Crux', Crv: 'Corvus', Cyg: 'Cygnus', Del: 'Delphinus', Dra: 'Draco', Eri: 'Eridanus', Gem: 'Gemini',
  Gru: 'Grus', Her: 'Hercules', Hya: 'Hydra', Hyd: 'Hydra', Leo: 'Leo', Lep: 'Lepus', Lib: 'Libra', Lyr: 'Lyra', Oph: 'Ophiuchus',
  Ori: 'Orion', Peg: 'Pegasus', Per: 'Perseus', Phe: 'Phoenix', PsA: 'Piscis Austrinus', Psc: 'Pisces', Sag: 'Sagittarius', Sgr: 'Sagittarius',
  Sco: 'Scorpius', Ser: 'Serpens', Tau: 'Taurus', UMa: 'Ursa Major', UMi: 'Ursa Minor', Vir: 'Virgo', Vel: 'Vela',
};
const DIRS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast',
  'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];
export const dirWords = (az) => DIRS[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];

/** "about 4 fists up (41°) in the west" — a fist at arm's length is about 10°. */
export function whereWords(alt, az) {
  const f = Math.max(1, Math.round(alt / 10));
  const height = alt < 15 ? `low, about ${f} fist above the horizon` : alt > 75 ? 'nearly overhead' : `about ${f} fists up`;
  return `${height} (${alt.toFixed(0)}°) in the ${dirWords(az)}`;
}

/**
 * How to recognise a named star. `stars`: all named stars with {id, con, mag}; `brighterNearby`: count of field stars
 * brighter than this one within 20° (from the Hipparcos field), or null if unknown.
 */
export function recogniseWords(star, stars, brighterNearby) {
  if (star.planet) return `${star.id} — a bright planet, steady (doesn't twinkle like stars)`;
  if (brighterNearby === 0) return 'the brightest star in that part of the sky';
  const same = stars.filter((s) => s.con === star.con && s.mag != null).sort((a, b) => a.mag - b.mag);
  const rank = same.findIndex((s) => s.id === star.id);
  const con = CON_NAMES[star.con] || star.con;
  return rank === 0 ? `the brightest star in ${con}` : rank === 1 ? `the second-brightest star in ${con}` : `a bright star in ${con}`;
}

/** Score for a first alignment star: bright, comfortable height. Lower is better. */
export function firstScore(s) {
  const altPen = s.alt < 20 ? (20 - s.alt) / 5 : s.alt > 70 ? (s.alt - 70) / 4 : 0;
  return (s.mag ?? 3) + altPen;
}
/** Score for a second star given the first: needs real separation in altitude and azimuth to solve the phone tilt. */
export function secondScore(s, first) {
  const dAlt = Math.abs(s.alt - first.alt), dAz = Math.abs(wrap180(s.az - first.az));
  if (dAlt < 15 || dAz < 40) return Infinity;
  return firstScore(s) - Math.min(dAlt, 40) / 20 - Math.min(dAz, 90) / 60;
}
export function pickStars(cands, first = null) {
  const L = cands.filter((s) => s.alt > 15 && s.alt < 80);
  if (!first) return L.slice().sort((a, b) => firstScore(a) - firstScore(b));
  return L.filter((s) => s.key !== first.key).map((s) => [s, secondScore(s, first)]).filter(([, v]) => isFinite(v)).sort((a, b) => a[1] - b[1]).map(([s]) => s);
}

/**
 * Altitude comes from gravity, so it's known before alignment. If the scope's altitude doesn't match the star the
 * user says they centred, they're on the wrong star. tol in degrees.
 */
export function checkAltitude(measuredAlt, expectedAlt, tol = 3.5) {
  const d = measuredAlt - expectedAlt;
  return { ok: Math.abs(d) <= tol, diff: d };
}
/**
 * Two stars: the angle the scope moved between them must match the catalogue angle between them (both in the
 * Earth-fixed frame at their respective times). Catches a wrong second star even when its altitude happens to match.
 */
export function checkPair(measured1, measured2, truth1, truth2, tol = 3) {
  const m = sepDeg(measured1.alt, measured1.az, measured2.alt, measured2.az);
  const t = sepDeg(truth1.alt, truth1.az, truth2.alt, truth2.az);
  return { ok: Math.abs(m - t) <= tol, measured: m, expected: t };
}

/**
 * Waypoint for a long push. Pick a bright, nameable star near the target so the final leg is short.
 *   tgt: {alt, az}; from: {alt, az} (last sync position); cands: [{key,label,alt,az,mag}]
 *   errAt(distDeg) -> estimated error (arcmin) for a push of that length right after a sync (null = unknown)
 *   r: eyepiece field radius (arcmin)
 * Returns null when no waypoint is needed or none helps.
 */
export function chooseWaypoint(tgt, from, cands, errAt, r, errNow) {
  const dFrom = sepDeg(from.alt, from.az, tgt.alt, tgt.az);
  const need = errNow != null ? errNow > r : dFrom > 45;          // without a Phone check, fall back to a distance rule
  if (!need) return null;
  const opts = cands.filter((c) => c.alt > 15 && (c.mag ?? 9) <= 2.6).map((c) => ({ ...c, d: sepDeg(c.alt, c.az, tgt.alt, tgt.az) }))
    .filter((c) => c.d > 0.5 && c.d < dFrom * 0.6);              // must actually shorten the final leg
  if (!opts.length) return null;
  opts.sort((a, b) => (a.d + 2 * (a.mag ?? 2)) - (b.d + 2 * (b.mag ?? 2)));
  const best = opts[0];
  return { ...best, distFromLast: dFrom, errAfter: errAt ? errAt(best.d) : null };
}
