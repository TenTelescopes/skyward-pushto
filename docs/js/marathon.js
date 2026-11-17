// Messier Marathon: how many Messier objects can you bag tonight?
// The order is "setting soonest first, then the shortest hop": anything about to drop into the west (or behind a marked
// obstruction) is taken while it can still be seen; otherwise the nearest object to where the scope already points.
// Pure apart from the Sky instance it is handed, so it can be unit-tested in Node.

import { rate, DEFAULT_NELM } from './vis.js';
import { blocked } from './horizon.js';

const D2R = Math.PI / 180;
const sep = (a1, z1, a2, z2) => Math.acos(Math.max(-1, Math.min(1, Math.sin(a1 * D2R) * Math.sin(a2 * D2R) + Math.cos(a1 * D2R) * Math.cos(a2 * D2R) * Math.cos((z1 - z2) * D2R)))) / D2R;
export const isMessier = (o) => !!(o.cats && o.cats.some((c) => /^M\d/.test(c)));
export const STEP_MIN = 10;
export const MIN_ALT = 12;          // lower than this is haze and rooftops for most people
export const PER_OBJECT_MIN = 4;    // rough time to push to, find and confirm one object
export const PAD = 2;               // stay this far above a marked obstruction

/** The night a moment belongs to: from this evening's sunset to the next sunrise (before noon it is still last night). */
export function nightOf(sky, now = new Date()) {
  const day = now.getHours() < 12 ? new Date(now.getTime() - 12 * 3600000) : now;
  const n = sky.night(day);
  return { ...n, id: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}` };
}

/**
 * Every Messier object that can be seen at some point between `start` and `end`, with the times it is in reach:
 *   { o, key, from: Date, to: Date, best: level }   (sorted by `to`)
 * "In reach" at a moment = above MIN_ALT, clear of the marked horizon, and rated Challenging or better by the visibility model.
 */
export function marathonList(sky, { start, end, scope, nelm = DEFAULT_NELM, horizon = null, minAlt = MIN_ALT } = {}) {
  const times = []; for (let t = start.getTime(); t <= end.getTime(); t += STEP_MIN * 60000) times.push(new Date(t));
  if (!times.length) return [];
  const cond = times.map((t) => ({ sun: sky.sunAlt(t), moon: sky.moonInfo(t) }));
  const out = [];
  for (const o of sky.objects) {
    if (!isMessier(o) || o.twin) continue;
    let from = null, to = null, best = 9;
    times.forEach((t, i) => {
      const p = sky.altAz(o, t); if (p.alt < minAlt || blocked(horizon, p.alt, p.az, PAD)) return;
      const c = cond[i];
      const r = rate(o, { alt: p.alt, sunAlt: c.sun, moonAlt: c.moon.alt, moonFrac: c.moon.frac, moonSep: sep(p.alt, p.az, c.moon.alt, c.moon.az), nelm }, scope);
      if (!r || r.level > 2) return;
      if (!from) from = t; to = t; best = Math.min(best, r.level);
    });
    if (from) out.push({ o, key: o.key, from, to: new Date(to.getTime() + STEP_MIN * 60000), best });
  }
  return out.sort((a, b) => a.to - b.to);
}

/**
 * What to go for now. `rows` = marathonList(); `done` = Set of keys already found; `later` = Map key -> time (ms) until
 * which a skipped object waits at the back; `cur` = {alt, az} where the scope points (or null).
 * Returns { next, why: 'setting' | 'near' | 'skipped', minsLeft, waiting, upNext: [rows], left, missed }.
 *  - waiting: nothing is in reach right now; `waiting` is the row that comes into reach first.
 */
export function pick(sky, rows, { now = new Date(), done = new Set(), later = new Map(), cur = null, horizon = null, minAlt = MIN_ALT } = {}) {
  const t = now.getTime();
  const open = rows.filter((r) => !done.has(r.key));
  const missed = open.filter((r) => r.to.getTime() <= t);
  const live = open.filter((r) => r.to.getTime() > t);
  const pos = new Map(live.map((r) => [r.key, sky.altAz(r.o, now)]));
  const inReach = (r) => { const p = pos.get(r.key); return r.from.getTime() <= t && p.alt >= minAlt && !blocked(horizon, p.alt, p.az, PAD); };
  const up = live.filter(inReach);
  const fresh = up.filter((r) => !(later.get(r.key) > t));
  const pool = fresh.length ? fresh : up;                       // only skipped ones left: offer them again
  const res = { next: null, why: null, minsLeft: null, waiting: null, upNext: [], left: live.length, missed: missed.length };
  if (!pool.length) { res.waiting = live.slice().sort((a, b) => a.from - b.from)[0] || null; return res; }
  const order = [], rest = pool.slice(); let at = cur, clock = t;
  while (rest.length && order.length < 6) {
    const byDeadline = rest.slice().sort((a, b) => a.to - b.to);
    // An object is urgent when the ones due before it, at a few minutes each, would use up the time it has left.
    const urgent = byDeadline.find((r, k) => (r.to.getTime() - clock) / 60000 < (k + 1) * PER_OBJECT_MIN + 20);
    let choice, why;
    if (urgent) { choice = urgent; why = 'setting'; }
    else {
      const cost = (r) => { const p = pos.get(r.key); return (at ? sep(at.alt, at.az, p.alt, p.az) : 0) + (r.to.getTime() - clock) / 60000 / 4; };
      choice = rest.slice().sort((a, b) => cost(a) - cost(b))[0]; why = 'near';
    }
    if (!fresh.length) why = 'skipped';
    order.push({ r: choice, why }); rest.splice(rest.indexOf(choice), 1); at = pos.get(choice.key); clock += PER_OBJECT_MIN * 60000;
  }
  res.next = order[0].r; res.why = order[0].why; res.minsLeft = Math.max(0, Math.round((res.next.to.getTime() - t) / 60000));
  res.upNext = order.slice(1).map((x) => x.r);
  return res;
}

export const SYNC_DIST = 40;     // offer a sync star when the next object is farther than this from the last thing you synced on
export const SYNC_NEAR = 25;     // and only a star within this of the object: a short, accurate final push
/**
 * A bright star to centre and Sync on before a long hop to `target`, or null when none is needed or none is suitable.
 * `from` = {alt, az} of the last thing synced on (where the pointing is freshest). The star must be bright (mag ≤ 2.6),
 * 15°–78° up, clear of the marked horizon, within SYNC_NEAR of the target and closer to it than `from` is.
 */
export function syncStarFor(sky, target, { now = new Date(), from = null, horizon = null } = {}) {
  const p = sky.altAz(target, now);
  const far = from ? sep(from.alt, from.az, p.alt, p.az) : Infinity;
  if (far <= SYNC_DIST) return null;
  const best = sky.objects.filter((o) => (o.key || '').startsWith('st:') && o.mag != null && o.mag <= 2.6)
    .map((o) => { const q = sky.altAz(o, now); return { o, q, d: sep(q.alt, q.az, p.alt, p.az) }; })
    .filter((x) => x.q.alt > 15 && x.q.alt < 78 && !blocked(horizon, x.q.alt, x.q.az, PAD) && x.d <= SYNC_NEAR && x.d < far)
    .sort((a, b) => (a.d + 3 * a.o.mag) - (b.d + 3 * b.o.mag))[0];
  return best ? { o: best.o, alt: best.q.alt, az: best.q.az, dist: best.d, hop: far } : null;
}
