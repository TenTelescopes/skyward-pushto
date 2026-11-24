// Planning mode: what's worth looking at during a session that starts at `start` and lasts `hours`.
// Pure apart from the Sky instance it is handed (positions only), so it can be unit-tested in Node.

import { rate, describe, LEVEL_NAMES, DEFAULT_NELM } from './vis.js';
import { BLURBS, PAIR_CLASS } from '../data/blurbs.js';
import { blocked } from './horizon.js';

export const LEVELS = LEVEL_NAMES.slice(0, 3);       // Obvious, Visible, Challenging ("Not tonight" is left out)
export const STEP_MIN = 15;
const D2Rp = Math.PI / 180;
const sepP = (a1, z1, a2, z2) => Math.acos(Math.max(-1, Math.min(1, Math.sin(a1 * D2Rp) * Math.sin(a2 * D2Rp) + Math.cos(a1 * D2Rp) * Math.cos(a2 * D2Rp) * Math.cos((z1 - z2) * D2Rp)))) / D2Rp;

/**
 * Targets for a session. Every STEP_MIN minutes, each object is rated with the visibility model for the
 * conditions then (its altitude, twilight, the Moon); the best moment is kept. Objects that never reach
 * "Challenging" are left out. Rows (sorted by best time):
 *   { o, key, level, margin, ep, cause, desc, best: Date, alt, az, from: Date, to: Date }
 */
export function planTargets(sky, { start, hours, scope, nelm = DEFAULT_NELM, minAlt = 20, horizon = null } = {}) {
  const n = Math.max(1, Math.round(hours * 60 / STEP_MIN)), times = [];
  for (let i = 0; i <= n; i++) times.push(new Date(start.getTime() + i * STEP_MIN * 60000));
  const cond = times.map((t) => ({ sun: sky.sunAlt(t), moon: sky.moonInfo(t) }));
  const cands = sky.objects.filter((o) => (!o.key.startsWith('st:') || o.show) && !o.twin);
  const out = [];
  for (const o of cands) {
    let bestR = null, bi = -1, from = null, to = null, pos = null;
    times.forEach((t, i) => {
      const p = sky.altAz(o, t); if (p.alt < minAlt || blocked(horizon, p.alt, p.az, 2)) return;
      const c = cond[i];
      const r = rate(o, { alt: p.alt, sunAlt: c.sun, moonAlt: c.moon.alt, moonFrac: c.moon.frac, moonSep: sepP(p.alt, p.az, c.moon.alt, c.moon.az), nelm }, scope);
      if (!r || r.level > 2) return;
      if (!from) from = t; to = t;
      if (!bestR || r.margin > bestR.margin + 0.05 || (Math.abs(r.margin - bestR.margin) <= 0.05 && p.alt > pos.alt)) { bestR = r; bi = i; pos = p; }
    });
    if (bestR) { const cm = cond[bi].moon;
      out.push({ o, key: o.key, level: bestR.level, margin: bestR.margin, ep: bestR.ep, epSteady: bestR.epSteady || null, cause: bestR.cause, desc: describe(o, bestR), best: times[bi], alt: pos.alt, az: pos.az, from, to,
        moonSep: cm.alt > 0 ? sepP(pos.alt, pos.az, cm.alt, cm.az) : 180, moonFrac: cm.frac, setting: pos.az > 180 && bi === 0 }); }
  }
  return out.sort((a, b) => a.best - b.best || a.level - b.level);
}

/** First night (from `day`, up to 30 nights ahead) when the Moon is down or under 25% lit two hours after dark. */
export function nextDarkNight(sky, day = new Date()) {
  for (let d = 1; d <= 30; d++) {
    const date = new Date(day.getFullYear(), day.getMonth(), day.getDate() + d, 12), nt = sky.night(date);
    const at = new Date(((nt.astro || nt.naut || nt.set) ?? date).getTime() + 2 * 3600000), m = sky.moonInfo(at);
    if (m.alt < 0 || m.frac < 0.25) return date;
  }
  return null;
}

/** Order plan items by best time (what most observers want as a starting point). */
export const byBestTime = (rows) => rows.slice().sort((a, b) => a.best - b.best);

// ---------------------------------------------------------------- hop order with sync stars
const D2R_ = Math.PI / 180;
const sep_ = (a, b) => Math.acos(Math.max(-1, Math.min(1, Math.sin(a.alt * D2R_) * Math.sin(b.alt * D2R_) + Math.cos(a.alt * D2R_) * Math.cos(b.alt * D2R_) * Math.cos((a.az - b.az) * D2R_)))) / D2R_;
export const SYNC_DIST = 50;     // add a sync star when the next target is farther than this from the last thing you synced on
export const SYNC_NEAR = 20;     // a sync star must be within this of the target it serves

/**
 * Suggest an observing order for `rows` (plan items with .o) starting at `start`:
 * nearest-next while each target is up, targets that are about to set go first, and a bright sync star
 * (mag ≤ 2.6) opens the plan and is inserted again whenever the next target is more than SYNC_DIST from the last sync — the star
 * nearest that target, so you align there and make only a short push. Each target you find and Sync on becomes
 * the new reference, so a sync star is only added before a long jump.
 * Returns { steps: [{ kind: 'sync'|'target', o, at: Date, alt, az, dist }], notUp: [rows] }.
 */
/**
 * The star to sync on before the first target of a session: bright (mag ≤ 2.6), comfortably placed (20°–75° up) and as
 * close to that target as such a star gets. There is no distance limit here — a plan should always open with a fresh
 * sync, even if the nearest good star is a fair swing away. Null when the first target is itself such a star.
 */
export function openingSync(sky, first, at) {
  if (!first) return null;
  if ((first.key || '').startsWith('st:') && first.mag != null && first.mag <= 2.6) return null;
  const p = sky.altAz(first, at);
  const best = sky.objects.filter((o) => o.key.startsWith('st:') && o.mag != null && o.mag <= 2.6)
    .map((s) => ({ s, q: sky.altAz(s, at) })).filter((x) => x.q.alt > 20 && x.q.alt < 75)
    .map((x) => ({ ...x, d: sep_(x.q, p) })).sort((a, b) => (a.d + 3 * a.s.mag) - (b.d + 3 * b.s.mag))[0];
  return best ? { o: best.s, alt: best.q.alt, az: best.q.az, dist: best.d } : null;
}
/**
 * The order to visit `rows` in: slot i is at start + i × each.
 *  1. Anything with under 45 minutes left at the start goes first, soonest to set first.
 *  2. The rest starts as nearest-next, then is improved by trying every move of one target to another place, every swap
 *     and every reversal of a stretch, keeping a change when it shortens the total travel across the sky.
 * Travel is measured between where each target will be at its own slot. A target that is sinking is charged a little for
 * every degree of height it has lost by the time it is visited, so western objects tend to come early. A target visited below `minAlt`, before it
 * has risen into its window or after it has left it, is charged far more than any detour, so those cases are avoided
 * whenever an order exists that avoids them. Close neighbours (M81 and M82) end up side by side because that is shortest.
 */
export function orderTargets(sky, rows, { start, each, minAlt = 25 } = {}) {
  const t0 = start.getTime(), n = rows.length; if (n < 2) return rows.slice();
  const memo = new Map();
  const pos = (r, i) => { const k = r.key + '|' + i; let v = memo.get(k); if (!v) { v = sky.altAz(r.o, new Date(t0 + i * each)); memo.set(k, v); } return v; };
  const fine = (r, i) => {                               // 0 when the visit is comfortably inside the target's window
    const t = t0 + i * each, p = pos(r, i); let f = 0;
    if (p.alt < minAlt) f += 60 + 40 * (minAlt - p.alt);
    if (r.to) { const left = (r.to.getTime() - t) / 60000; if (left < 0) f += 200 - left; else if (left < 10) f += 3 * (10 - left); }
    if (r.from && t < r.from.getTime() - 5 * 60000) f += 60 + (r.from.getTime() - t) / 60000;
    f += 1.5 * Math.max(0, pos(r, 0).alt - p.alt);        // sinking targets are better caught early, while they are higher
    return f;
  };
  const cost = (ord, from = 0) => { let c = 0; for (let i = from; i < ord.length; i++) { c += fine(ord[i], i); if (i > from) c += sep_(pos(ord[i - 1], i - 1), pos(ord[i], i)); else if (from > 0) c += sep_(pos(ord[i - 1], i - 1), pos(ord[i], i)); } return c; };
  const left0 = (r) => (r.to ? (r.to.getTime() - t0) / 60000 : Infinity);
  const head = rows.filter((r) => left0(r) < 45).sort((a, b) => left0(a) - left0(b));          // fixed: about to set
  let rest = rows.filter((r) => !head.includes(r));
  // nearest-next start
  const ord = head.slice(); let pool = rest.slice();
  while (pool.length) {
    const i = ord.length, prev = i ? pos(ord[i - 1], i - 1) : null;
    pool.sort((a, b) => (fine(a, i) + (prev ? sep_(prev, pos(a, i)) : -pos(a, i).alt / 10)) - (fine(b, i) + (prev ? sep_(prev, pos(b, i)) : -pos(b, i).alt / 10)));
    ord.push(pool.shift());
  }
  // improve everything after the fixed head
  const h = head.length; let best = cost(ord, h), better = true, guard = 0;
  const tryOrd = (cand) => { const c = cost(cand, h); if (c < best - 1e-6) { best = c; ord.splice(0, ord.length, ...cand); return true; } return false; };
  while (better && guard++ < 40) {
    better = false;
    for (let i = h; i < n; i++) for (let j = h; j < n; j++) {
      if (i === j) continue;
      const mv = ord.slice(); const [x] = mv.splice(i, 1); mv.splice(j, 0, x); if (tryOrd(mv)) { better = true; continue; }                 // move one
      if (j > i) { const rv = ord.slice(0, i).concat(ord.slice(i, j + 1).reverse(), ord.slice(j + 1)); if (tryOrd(rv)) { better = true; continue; } // reverse a stretch
        const sw = ord.slice(); [sw[i], sw[j]] = [sw[j], sw[i]]; if (tryOrd(sw)) better = true; }                                              // swap two
    }
  }
  return ord;
}
/** Total sky travel (degrees) of an order, each target taken at its own slot. For tests and comparisons. */
export function travelOf(sky, ord, { start, each }) {
  let c = 0; for (let i = 1; i < ord.length; i++) c += sep_(sky.altAz(ord[i - 1].o, new Date(start.getTime() + (i - 1) * each)), sky.altAz(ord[i].o, new Date(start.getTime() + i * each))); return c;
}
export function routePlan(sky, rows, { start, hours, minAlt = 25, perTarget = null } = {}) {
  const each = (perTarget ?? Math.max(5, Math.min(20, hours * 60 / Math.max(1, rows.length)))) * 60000;
  const listed = new Set(rows.map((r) => r.o));
  const stars = sky.objects.filter((o) => o.key.startsWith('st:') && o.mag != null && o.mag <= 2.6 && !listed.has(o));      // a sync star is never also a target
  let order = orderTargets(sky, rows, { start, each, minAlt });
  // Every plan opens on a bright star. If the best one is itself on the list, it becomes the first stop.
  if (order.length) {
    const open = openingSync(sky, order[0].o, start), own = open && order.find((x) => x.o === open.o);
    if (own && own !== order[0]) order = [own].concat(orderTargets(sky, order.filter((x) => x !== own), { start: new Date(start.getTime() + each), each, minAlt }));
  }
  const steps = [], notUp = []; let sync = null, i = 0;
  for (const r of order) {
    const at = new Date(start.getTime() + i * each), p = sky.altAz(r.o, at);
    if (p.alt < minAlt - 3) { notUp.push(r); continue; }                // never gets high enough in its slot: listed at the end, unrouted
    const isStar = r.o.key.startsWith('st:');
    if (!steps.length && !(isStar && r.o.mag != null && r.o.mag <= 2.6)) {
      const open = openingSync(sky, r.o, at), usable = open && !listed.has(open.o) ? open : null;
      const alt2 = usable || stars.map((s) => ({ s, q: sky.altAz(s, at) })).filter((x) => x.q.alt > 20 && x.q.alt < 75).map((x) => ({ o: x.s, alt: x.q.alt, az: x.q.az, dist: sep_(x.q, p), w: sep_(x.q, p) + 3 * x.s.mag })).sort((a, b) => a.w - b.w)[0];
      if (alt2) { steps.push({ kind: 'sync', o: alt2.o, at, alt: alt2.alt, az: alt2.az, dist: alt2.dist, first: true }); sync = alt2.o; }
    } else if (!isStar) {
      // Distance from the last thing you centred and synced on: the previous target, or a sync star.
      const syncPos = sync ? sky.altAz(sync, at) : null, dSync = syncPos ? sep_(syncPos, p) : Infinity;
      if (dSync > SYNC_DIST) {
        const best = stars.map((s) => ({ s, q: sky.altAz(s, at) })).filter((x) => x.q.alt > 20)
          .map((x) => ({ ...x, d: sep_(x.q, p) })).filter((x) => x.d < Math.min(SYNC_NEAR, dSync * 0.6))
          .sort((a, b) => (a.d + 3 * a.s.mag) - (b.d + 3 * b.s.mag))[0];
        if (best) { steps.push({ kind: 'sync', o: best.s, at, alt: best.q.alt, az: best.q.az, dist: best.d, first: false }); sync = best.s; }
      }
    }
    steps.push({ kind: 'target', o: r.o, at, alt: p.alt, az: p.az, dist: sync && sync !== r.o ? sep_(sky.altAz(sync, at), p) : null });
    sync = r.o; i++;
  }
  return { steps, notUp };
}


// ---------------------------------------------------------------- what to suggest first
const isM = (o) => (o.cats || []).some((c) => /^M\d/.test(c));
const isC = (o) => (o.cats || []).some((c) => /^C\d/.test(c));
export const kindOf = (o) => { const k = o.key || ''; return o.planet ? 'PL' : k.startsWith('ds:') || (k.startsWith('st:') && o.pairs) ? 'DS' : k.startsWith('as:') ? 'AS' : k.startsWith('st:') ? 'ST' : o.t; };
const COMPANIONS = new Set(['M32', 'M110', 'M43']);     // seen in the same view as something bigger; not targets in their own right
/** How much of a crowd-pleaser an object is, before tonight's conditions: planets, then the famous showpieces. */
export function interest(o) {
  if (o.planet) return ({ Moon: 6.5, Saturn: 6.5, Jupiter: 6.5, Mars: 5, Venus: 4.5, Mercury: 3, Uranus: 2.5, Neptune: 2 })[o.id] ?? 2;
  const k = kindOf(o), key = o.key || '';
  if (k === 'DS') return doubleInterest(o);
  if (key.startsWith('st:')) return 2.5;
  let s = isM(o) ? 3 : isC(o) ? 1.5 : (o.cats || []).includes('H400') ? 0.8 : 0;
  if (o.name) s += 1;                                                // has a common name: people have heard of it
  if ((BLURBS[o.label] || BLURBS[o.id]) && !COMPANIONS.has(o.label)) s += 1.5;   // one of the written-up showpieces
  if (k === 'AS') s += 0.6;
  return s;
}
/** Spectral classes in order of colour, blue to red, for judging how much two stars' colours differ. */
const SPEC = 'OBAFGKM';
/**
 * How much of a crowd-pleaser a double star is: both stars bright enough to see at a glance, colours that differ, and
 * fame. Being in the Messier list counts for nothing here: M40 is two dim stars (9.7 and 10.1), famously disappointing.
 */
export function doubleInterest(o) {
  const p = (o.pairs && o.pairs[0]) || {}, ms = String(p.mags || '').split('/').map(Number).filter((x) => !Number.isNaN(x));
  const faint = ms.length ? Math.max(...ms) : (o.mag ?? 8) + 1;
  let s = 2 + (faint <= 6 ? 2 : faint <= 7.5 ? 1 : faint <= 9 ? 0 : -1.5);    // the companion easy, fair, hard, or a struggle
  const cl = PAIR_CLASS[o.label] || PAIR_CLASS[o.id];
  if (cl && Math.abs(SPEC.indexOf(cl[0]) - SPEC.indexOf(cl[1])) >= 2) s += 1;   // gold-and-blue kind of contrast
  if (faint <= 8 && (cl || BLURBS[o.label] || BLURBS[o.id])) s += 1.5;            // a famous, written-up showpiece
  if (/^(HD|HR|BD|STF|\d)/.test(o.label || '')) s -= 1;                            // only a catalogue number
  return s;
}
/** Tonight's ranking: fame first, then how far above the visibility limit it is, and a comfortable height. */
export function pickScore(o, r, alt) {
  return interest(o) + Math.min(3, Math.max(-1, r.margin)) * 0.5 - r.level * 1.0 + (1 - Math.abs((alt ?? 50) - 50) / 40) * 0.8;
}
/** Take the best of a ranked list while keeping variety: at most `perKind` of each kind. */
export function varied(ranked, n, perKind = 2) {
  const out = [], count = {};
  for (const x of ranked) { const k = kindOf(x.o); if ((count[k] || 0) >= perKind) continue; count[k] = (count[k] || 0) + 1; out.push(x); if (out.length >= n) break; }
  return out;
}

/**
 * Build a plan automatically from planTargets() rows: mostly Obvious and Visible showpieces of different kinds,
 * plus one or two Challenging ones for longer sessions. About four targets an hour. Returns rows (unordered).
 */
/** Objects seen in the same eyepiece view as a bigger neighbour: left out of an automatic plan when the neighbour is up. */
const HOST = { M32: 'M31', M110: 'M31', M43: 'M42' };
const mLabel = (o) => (o.cats || []).find((c) => /^M\d+$/.test(c)) || o.label;
export function autoPlan(rows, { hours = 2, seen = null } = {}) {
  const n = Math.max(5, Math.min(14, Math.round(hours * 4)));
  const up = new Set(rows.map((r) => mLabel(r.o)));
  rows = rows.filter((r) => {
    const h = HOST[mLabel(r.o)]; if (h && up.has(h)) return false;                     // M32 goes with M31, M43 with M42
    // Glare: a bright Moon within 15° fills an open-tube telescope with scattered light (planets and the Moon itself excepted).
    if (!r.o.planet && r.moonSep != null && r.moonSep < 15 && r.moonFrac > 0.3) return false;
    return true;
  });
  const score = (r) => pickScore(r.o, r, r.alt)
    - (seen && seen.has(r.key) && !r.o.planet ? 0.8 : 0)                              // something new beats a repeat
    + (r.setting ? 0.4 : 0);                                                           // low in the west at dark: catch it before it's gone for the season
  const ranked = rows.map((r) => ({ ...r, s: score(r) })).sort((a, b) => b.s - a.s || (a.key < b.key ? -1 : 1));
  const roomy = (r) => !r.to || !r.from || r.to - r.from >= 30 * 60000;          // skip things only briefly above the limit
  const easy = ranked.filter((r) => r.level <= 1 && roomy(r)), hard = ranked.filter((r) => r.level === 2 && r.margin >= 0.1 && interest(r.o) >= 3 && roomy(r));   // a real chance, not a coin toss
  const nHard = hours >= 2 ? Math.min(hard.length, hours >= 3 ? 2 : 1) : 0, want = n - nHard;
  const group = (r) => { const k = kindOf(r.o); return k === 'CN' || k === 'NB' ? 'NB' : k; };
  // One of each kind first (a planet, a double, a cluster, a globular, a nebula, a galaxy…), then the best of the rest.
  const pick = [];
  for (const g of ['PL', 'DS', 'OC', 'GC', 'PN', 'GX', 'NB']) { const r = easy.find((x) => group(x) === g); if (r && pick.length < want) pick.push(r); }
  // Doubles: two at most on a dark night (the faint stuff deserves the time), three when a bright Moon is up.
  const brightMoon = rows.some((r) => r.moonSep < 180 && r.moonFrac > 0.5);
  const perKind = Math.max(2, Math.ceil(n / 4)), count = {}, cap = (g) => (g === 'DS' && !brightMoon ? 2 : perKind);
  for (const r of pick) count[group(r)] = (count[group(r)] || 0) + 1;
  for (const r of easy) {
    if (pick.length >= want) break; if (pick.includes(r)) continue;
    const g = group(r); if ((count[g] || 0) >= cap(g)) continue;
    if (pick.some((p) => p.o.name && p.o.name === r.o.name)) continue;      // not both halves of the Double Cluster / Leo Triplet
    count[g] = (count[g] || 0) + 1; pick.push(r);
  }
  let nh = 0;
  for (const h of hard) { if (nh >= nHard) break; if (pick.some((p) => p.o.name && p.o.name === h.o.name)) continue; pick.push(h); nh++; }
  return pick.sort((a, b) => b.s - a.s);
}
