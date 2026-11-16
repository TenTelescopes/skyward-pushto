// Planning mode: what's worth looking at during a session that starts at `start` and lasts `hours`.
// Pure apart from the Sky instance it is handed (positions only), so it can be unit-tested in Node.

import { rate, describe, LEVEL_NAMES, DEFAULT_NELM } from './vis.js';
import { BLURBS } from '../data/blurbs.js';

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
export function planTargets(sky, { start, hours, scope, nelm = DEFAULT_NELM, minAlt = 20 } = {}) {
  const n = Math.max(1, Math.round(hours * 60 / STEP_MIN)), times = [];
  for (let i = 0; i <= n; i++) times.push(new Date(start.getTime() + i * STEP_MIN * 60000));
  const cond = times.map((t) => ({ sun: sky.sunAlt(t), moon: sky.moonInfo(t) }));
  const cands = sky.objects.filter((o) => (!o.key.startsWith('st:') || o.show) && !o.twin);
  const out = [];
  for (const o of cands) {
    let bestR = null, bi = -1, from = null, to = null, pos = null;
    times.forEach((t, i) => {
      const p = sky.altAz(o, t); if (p.alt < minAlt) return;
      const c = cond[i];
      const r = rate(o, { alt: p.alt, sunAlt: c.sun, moonAlt: c.moon.alt, moonFrac: c.moon.frac, moonSep: sepP(p.alt, p.az, c.moon.alt, c.moon.az), nelm }, scope);
      if (!r || r.level > 2) return;
      if (!from) from = t; to = t;
      if (!bestR || r.margin > bestR.margin + 0.05 || (Math.abs(r.margin - bestR.margin) <= 0.05 && p.alt > pos.alt)) { bestR = r; bi = i; pos = p; }
    });
    if (bestR) out.push({ o, key: o.key, level: bestR.level, margin: bestR.margin, ep: bestR.ep, cause: bestR.cause, desc: describe(o, bestR), best: times[bi], alt: pos.alt, az: pos.az, from, to });
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
export const SYNC_DIST = 40;     // add a sync star when the next target is farther than this from the last thing you synced on
export const SYNC_NEAR = 20;     // a sync star must be within this of the target it serves

/**
 * Suggest an observing order for `rows` (plan items with .o) starting at `start`:
 * nearest-next while each target is up, targets that are about to set go first, and a bright sync star
 * (mag ≤ 2.6) is inserted whenever the next target is more than SYNC_DIST from the last sync — the star
 * nearest that target, so you align there and make only a short push. Each target you find and Sync on becomes
 * the new reference, so a sync star is only added before a long jump.
 * Returns { steps: [{ kind: 'sync'|'target', o, at: Date, alt, az, dist }], notUp: [rows] }.
 */
export function routePlan(sky, rows, { start, hours, minAlt = 25, perTarget = null } = {}) {
  const end = start.getTime() + hours * 3600000;
  const each = (perTarget ?? Math.max(5, Math.min(20, hours * 60 / Math.max(1, rows.length)))) * 60000;
  const stars = sky.objects.filter((o) => o.key.startsWith('st:') && o.mag != null && o.mag <= 2.6);
  const steps = []; let rest = rows.slice(), t = start.getTime(), cur = null, sync = null;
  while (rest.length && t <= end) {
    const at = new Date(t);
    const up = rest.map((r) => ({ r, p: sky.altAz(r.o, at) })).filter((x) => x.p.alt >= minAlt);
    if (!up.length) { t += STEP_MIN * 60000; continue; }
    // About to drop below the limit: those go first, earliest deadline first. Otherwise the nearest one.
    const left = (x) => (x.r.to ? (x.r.to.getTime() - t) / 60000 : Infinity);
    const score = (x) => (left(x) < 45 ? -1000 + left(x) : cur ? sep_(cur, x.p) : -x.p.alt / 10);
    up.sort((a, b) => score(a) - score(b));
    const { r, p } = up[0];
    // Distance from the last thing you centred and synced on: the previous target, or a sync star.
    const syncPos = sync ? sky.altAz(sync, at) : null, dSync = syncPos ? sep_(syncPos, p) : Infinity;
    if (!r.o.key.startsWith('st:') && dSync > SYNC_DIST) {
      const best = stars.map((s) => ({ s, q: sky.altAz(s, at) })).filter((x) => x.q.alt > 20)
        .map((x) => ({ ...x, d: sep_(x.q, p) })).filter((x) => x.d < Math.min(SYNC_NEAR, dSync * 0.6))
        .sort((a, b) => (a.d + 3 * a.s.mag) - (b.d + 3 * b.s.mag))[0];
      const own = best && rest.find((x) => x.o === best.s);
      if (own) {                                                       // the sync star is itself on the list: visit it now, as a target
        steps.push({ kind: 'target', o: own.o, at, alt: best.q.alt, az: best.q.az, dist: null });
        sync = own.o; cur = best.q; rest = rest.filter((x) => x !== own); t += each; continue;
      }
      if (best) { steps.push({ kind: 'sync', o: best.s, at, alt: best.q.alt, az: best.q.az, dist: best.d, first: !sync }); sync = best.s; }
    }
    steps.push({ kind: 'target', o: r.o, at, alt: p.alt, az: p.az, dist: sync ? sep_(sky.altAz(sync, at), p) : null });
    sync = r.o; cur = p; rest = rest.filter((x) => x !== r); t += each;
  }
  return { steps, notUp: rest };
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
  if (key.startsWith('st:')) return k === 'DS' ? 4.5 : 2.5;          // showpiece stars: famous doubles rank with the good Messiers
  let s = isM(o) ? 3 : isC(o) ? 1.5 : (o.cats || []).includes('H400') ? 0.8 : 0;
  if (o.name) s += 1;                                                // has a common name: people have heard of it
  if ((BLURBS[o.label] || BLURBS[o.id]) && !COMPANIONS.has(o.label)) s += 1.5;   // one of the written-up showpieces
  if (k === 'DS') s += /^(HD|HR|BD|STF|\d)/.test(o.label || '') ? 1.3 : 2.3;      // a double with a real name is easier to care about
  if (k === 'AS') s += 0.6;
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
export function autoPlan(rows, { hours = 2 } = {}) {
  const n = Math.max(5, Math.min(14, Math.round(hours * 4)));
  const ranked = rows.map((r) => ({ ...r, s: pickScore(r.o, r, r.alt) })).sort((a, b) => b.s - a.s || (a.key < b.key ? -1 : 1));
  const roomy = (r) => !r.to || !r.from || r.to - r.from >= 30 * 60000;          // skip things only briefly above the limit
  const easy = ranked.filter((r) => r.level <= 1 && roomy(r)), hard = ranked.filter((r) => r.level === 2 && interest(r.o) >= 3 && roomy(r));
  const nHard = hours >= 2 ? Math.min(hard.length, hours >= 3 ? 2 : 1) : 0, want = n - nHard;
  const group = (r) => { const k = kindOf(r.o); return k === 'CN' || k === 'NB' ? 'NB' : k; };
  // One of each kind first (a planet, a double, a cluster, a globular, a nebula, a galaxy…), then the best of the rest.
  const pick = [];
  for (const g of ['PL', 'DS', 'OC', 'GC', 'PN', 'GX', 'NB']) { const r = easy.find((x) => group(x) === g); if (r && pick.length < want) pick.push(r); }
  const perKind = Math.max(2, Math.ceil(n / 4)), count = {};
  for (const r of pick) count[group(r)] = (count[group(r)] || 0) + 1;
  for (const r of easy) {
    if (pick.length >= want) break; if (pick.includes(r)) continue;
    const g = group(r); if ((count[g] || 0) >= perKind) continue;
    if (pick.some((p) => p.o.name && p.o.name === r.o.name)) continue;      // not both halves of the Double Cluster / Leo Triplet
    count[g] = (count[g] || 0) + 1; pick.push(r);
  }
  for (const h of hard.slice(0, nHard)) pick.push(h);
  return pick.sort((a, b) => b.s - a.s);
}
