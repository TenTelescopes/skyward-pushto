// Game mode: pick the best 10 targets for this sky and scope, route them, encode challenges and results.
// Pure functions (no DOM) so they can be unit-tested; the screens live in main.js.
import { sepDeg } from './model.js';

export const GAME_VERSION = 1;
export const STYLES = {
  push: { name: 'Push race', desc: 'Arrows on. Fastest to all 10 wins.' },
  hop: { name: 'Star-hop', desc: 'No arrows — find each target from the chart. The app confirms when you\'re on it.' },
  hybrid: { name: 'Hybrid', desc: 'Star-hop, but a Hint shows the arrows for 10 s at a +30 s penalty.' },
};
export const PENALTY = { skip: 120, hint: 30 };

// ---------------------------------------------------------------- target tokens (stable, human-readable)
/** Short token for an object, stable across app versions as long as catalog designations don't change. */
export function tokenFor(o) {
  if (o.planet) return 'P' + o.id;
  if (o.key.startsWith('ds:')) return 'D' + o.id.replace(/\s+/g, '_');
  const m = o.cats && o.cats.find((c) => /^M\d+$/.test(c)); if (m) return m;
  return o.id.replace(/\s+/g, '');   // NGC/IC numbers are unique; Caldwell numbers aren't (C14 is two clusters)
}
export function buildTokenIndex(objects) {
  const idx = new Map(); for (const o of objects) { const t = tokenFor(o); if (!idx.has(t)) idx.set(t, o); } return idx;
}

// ---------------------------------------------------------------- choosing the best 10
/** Visual limits by type for a given aperture (mm), suburban-ish skies. Conservative so targets are findable. */
function magLimitFor(t, aperture) {
  const k = aperture >= 190 ? 0.7 : 0;
  return { GX: 10.0, PN: 11.0, GC: 9.5, OC: 8.5, NB: 9.0, CN: 9.0, DS: 7.5, PL: 99 }[t] + k;
}
export function isCandidate(o, { aperture = 150, sunAlt = -18, maxAlt = 80 }) {
  if (o.alt == null || o.alt < 25 || o.alt > maxAlt) return false;
  if (o.key.startsWith('st:') || o.key.startsWith('as:') || o.id === 'Moon') return false;
  const dso = o.key.startsWith('dso:'), ds = o.key.startsWith('ds:');
  if (!(o.planet || ds || dso)) return false;
  if (dso && !(o.cats || []).some((c) => /^M\d/.test(c) || /^C\d/.test(c) || c === 'H400')) return false;
  if (ds && !(o.sep >= 2)) return false;                                   // must split in a small scope
  const lim = magLimitFor(o.planet ? 'PL' : ds ? 'DS' : o.t, aperture);
  if (o.mag == null) { if (!(o.cats || []).some((c) => /^M\d/.test(c))) return false; } else if (o.mag > (lim ?? 9)) return false;
  if (o.maj && o.maj > 180) return false;                                  // bigger than ~3°: not a pointing target
  if (o.maj && o.maj > 60 && !(o.cats || []).some((c) => /^M\d/.test(c))) return false; // big, faint non-Messier nebulae can't be 'centred'
  if (sunAlt > -6 && !o.planet) return false;                                       // daylight / civil twilight: planets only
  if (sunAlt > -12 && !(o.planet || ds || (o.mag != null && o.mag < 5))) return false; // nautical twilight: bright things only
  return true;
}
function showScore(o, aperture) {
  const cats = o.cats || [];
  let s = cats.some((c) => /^M\d/.test(c)) ? 3 : cats.some((c) => /^C\d/.test(c)) ? 2 : cats.includes('H400') ? 1 : 0;
  if (o.key.startsWith('ds:')) s += 1.5; if (o.planet) s += 3;
  const lim = magLimitFor(o.planet ? 'PL' : o.key.startsWith('ds:') ? 'DS' : o.t, aperture) ?? 9;
  if (o.mag != null && !o.planet) s += Math.min(3, (lim - o.mag) * 0.5);
  s += 1 - Math.abs(o.alt - 50) / 40;                                       // comfortable height
  return s;
}
const typeOf = (o) => (o.planet ? 'PL' : o.key.startsWith('ds:') ? 'DS' : o.t);

/** Pick n targets: best show-pieces, at most 3 of a type (2 doubles/planets), spread ≥ 6° apart. Deterministic. */
export function pickTargets(objects, opts = {}) {
  const n = opts.n ?? 10, aperture = opts.aperture ?? 150;
  const cands = objects.filter((o) => isCandidate(o, opts)).map((o) => ({ o, s: showScore(o, aperture) }))
    .sort((a, b) => b.s - a.s || (tokenFor(a.o) < tokenFor(b.o) ? -1 : 1));
  for (const minSep of [6, 3, 1]) {
    const out = [], count = {};
    for (const { o } of cands) {
      const t = typeOf(o), cap = t === 'DS' || t === 'PL' ? 2 : 3;
      if ((count[t] || 0) >= cap) continue;
      if (out.some((p) => sepDeg(p.alt, p.az, o.alt, o.az) < minSep)) continue;
      out.push(o); count[t] = (count[t] || 0) + 1; if (out.length === n) return out;
    }
    if (minSep === 1 || out.length >= n) return out;
  }
  return [];
}

/** Order targets to keep total slewing short: nearest-neighbour from `start`, then 2-opt on the open path. */
export function routeOrder(targets, start = null) {
  if (targets.length < 3) return targets.slice();
  const d = (a, b) => sepDeg(a.alt, a.az, b.alt, b.az);
  const build = (first) => {
    const rest = targets.filter((t) => t !== first); let cur = first; const path = [first];
    while (rest.length) { rest.sort((a, b) => d(cur, a) - d(cur, b)); cur = rest.shift(); path.push(cur); }
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = -1; i < path.length - 2; i++) for (let k = i + 2; k < path.length; k++) {
        // i = -1 lets the first leg (from the scope's start position, if any) take part in the improvement
        const a = i < 0 ? start : path[i], b = path[i + 1], c = path[k], e = path[k + 1];
        if (i < 0 && !a) continue;
        const before = (a ? d(a, b) : 0) + (e ? d(c, e) : 0), after = (a ? d(a, c) : 0) + (e ? d(b, e) : 0);
        if (after < before - 1e-9) { path.splice(i + 1, k - i, ...path.slice(i + 1, k + 1).reverse()); improved = true; }
      }
    }
    return path;
  };
  const cost = (p) => pathLength(p) + (start ? d(start, p[0]) : 0);
  let best = null;
  for (const first of targets) { const p = build(first); if (!best || cost(p) < cost(best) - 1e-9) best = p; }
  return best;
}
export function pathLength(path) { let s = 0; for (let i = 1; i < path.length; i++) s += sepDeg(path[i - 1].alt, path[i - 1].az, path[i].alt, path[i].az); return s; }

// ---------------------------------------------------------------- codes
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
const B32 = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function short(h, len) { let s = ''; for (let i = 0; i < len; i++) { s += B32[h % 32]; h = Math.floor(h / 32); } return s; }

/** Challenge: who plays what. Same code = same targets, same style, same order. */
export function encodeChallenge({ style, tokens, created = Date.now(), host = '' }) {
  const body = ['SKYG' + GAME_VERSION, style, Math.floor(created / 60000).toString(36), tokens.join(','), host.replace(/[|,]/g, ' ').slice(0, 24)].join('|');
  return body + '|' + short(hash(body), 4);
}
export function decodeChallenge(code) {
  const p = String(code).trim().split('|');
  if (p.length !== 6 || !/^SKYG\d+$/.test(p[0])) throw new Error('Not a Skyward challenge code');
  const body = p.slice(0, 5).join('|');
  if (short(hash(body), 4) !== p[5]) throw new Error('Challenge code is damaged — scan or paste it again');
  if (!STYLES[p[1]]) throw new Error('Unknown game style in code');
  return { version: +p[0].slice(4), style: p[1], created: parseInt(p[2], 36) * 60000, tokens: p[3].split(',').filter(Boolean), host: p[4], id: challengeId(code) };
}
/** Short, typeable id used to group results on the leaderboard. */
export function challengeId(code) { return short(hash(String(code).trim()), 6); }

export function encodeResult(r) {
  const body = ['SKYR' + GAME_VERSION, r.challenge, (r.player || 'Player').replace(/[|]/g, ' ').slice(0, 24), r.style, r.found, r.targets,
    Math.round(r.totalSec), Math.round(r.penaltySec || 0), (r.splits || []).map((s) => (s == null ? 'x' : Math.round(s))).join(',')].join('|');
  return body + '|' + short(hash(body), 4);
}
export function decodeResult(code) {
  const p = String(code).trim().split('|');
  if (p.length !== 10 || !/^SKYR\d+$/.test(p[0])) throw new Error('Not a Skyward result code');
  if (short(hash(p.slice(0, 9).join('|')), 4) !== p[9]) throw new Error('Result code is damaged');
  return { challenge: p[1], player: p[2], style: p[3], found: +p[4], targets: +p[5], totalSec: +p[6], penaltySec: +p[7],
    splits: p[8].split(',').map((v) => (v === 'x' ? null : +v)) };
}

// ---------------------------------------------------------------- scoring
/** Higher is better: every found target outranks any time difference; then faster wins. */
export function points(r) { return r.found * 100000 - Math.round(r.totalSec * 10); }
export function rank(results) { return results.slice().sort((a, b) => points(b) - points(a)); }
export function fmtTime(sec) { if (sec == null || isNaN(sec)) return '—'; const m = Math.floor(sec / 60), s = Math.round(sec % 60); return `${m}:${String(s).padStart(2, '0')}`; }

/**
 * Has the scope found the target? It must stay within `radius` (deg) for `holdMs`.
 * state is mutated: {since}. Returns true once satisfied.
 */
export function dwell(state, sepDegNow, radius, now, holdMs = 2000) {
  if (sepDegNow <= radius) { if (state.since == null) state.since = now; return now - state.since >= holdMs; }
  state.since = null; return false;
}
