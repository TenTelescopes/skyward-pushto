// Observing log: what you've seen, and the small rewards for seeing more. Pure functions — the screens are in main.js.

/** Keys of objects logged as seen at least once. */
export const seenKeys = (log) => new Set((log || []).filter((e) => e.seen === 'yes').map((e) => e.key));
/** Most recent entry for an object, or null. */
export const lastEntry = (log, key) => { for (let i = (log || []).length - 1; i >= 0; i--) if (log[i].key === key) return log[i]; return null; };

const kind = (o) => (o.planet ? 'PL' : o.key.startsWith('ds:') || (o.key.startsWith('st:') && o.pairs) ? 'DS' : o.key.startsWith('as:') ? 'AS' : o.key.startsWith('st:') ? 'ST' : o.t);
const messierNo = (o) => { const c = (o.cats || []).find((x) => /^M\d+$/.test(x)); return c ? +c.slice(1) : null; };

/** Totals for the log screen. `objects` is the app's unified object list. */
export function logStats(log, objects) {
  const seen = seenKeys(log), byKey = new Map(objects.map((o) => [o.key, o]));
  const all = new Set(objects.map(messierNo).filter(Boolean)), got = new Set();
  const types = { GX: 0, GC: 0, OC: 0, NEB: 0, DS: 0, PL: 0, AS: 0 }; let moon = false;
  for (const k of seen) {
    const o = byKey.get(k); if (!o) continue;
    const m = messierNo(o); if (m) got.add(m);
    const t = kind(o);
    if (o.id === 'Moon') moon = true; else if (t === 'PL') types.PL++;
    else if (['NB', 'CN', 'PN'].includes(t)) types.NEB++;
    else if (t in types) types[t]++;
  }
  const nights = new Set((log || []).filter((e) => e.seen === 'yes').map((e) => { const d = new Date(e.t - 12 * 3600000); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }));
  return { total: seen.size, messier: got.size, messierTotal: all.size, types, moon, planetTotal: 7, nights: nights.size };
}

/** Milestones, in the order they're usually reached. `have`/`need` drive the "3 to go" text. */
export const MILESTONES = [
  { id: 'first', name: 'First light', what: 'Log your first object', have: (s) => s.total, need: 1 },
  { id: 'five', name: 'Getting the hang of it', what: 'Log 5 objects', have: (s) => s.total, need: 5 },
  { id: 'moon', name: 'Moonwalker', what: 'Log the Moon', have: (s) => (s.moon ? 1 : 0), need: 1 },
  { id: 'planets3', name: 'Planet spotter', what: 'Log 3 planets', have: (s) => s.types.PL, need: 3 },
  { id: 'kinds', name: 'One of everything', what: 'A galaxy, a globular, an open cluster, a nebula and a double star', have: (s) => ['GX', 'GC', 'OC', 'NEB', 'DS'].filter((k) => s.types[k] > 0).length, need: 5 },
  { id: 'm10', name: 'Messier 10', what: 'Log 10 Messier objects', have: (s) => s.messier, need: 10 },
  { id: 'gx5', name: 'Galaxy hunter', what: 'Log 5 galaxies', have: (s) => s.types.GX, need: 5 },
  { id: 'ds10', name: 'Splitter', what: 'Log 10 double stars', have: (s) => s.types.DS, need: 10 },
  { id: 'm25', name: 'Messier 25', what: 'Log 25 Messier objects', have: (s) => s.messier, need: 25 },
  { id: 'planets7', name: 'Grand tour', what: 'Log all 7 planets', have: (s) => s.types.PL, need: 7 },
  { id: 'm50', name: 'Messier 50', what: 'Log 50 Messier objects', have: (s) => s.messier, need: 50 },
  { id: 'm110', name: 'Messier marathoner', what: 'Log all 110 Messier objects', have: (s) => s.messier, need: 110 },
];
export const achieved = (stats) => MILESTONES.filter((m) => m.have(stats) >= m.need).map((m) => m.id);
/** Milestones reached by going from `before` to `after` stats. */
export function newlyAchieved(before, after) { const b = new Set(achieved(before)); return MILESTONES.filter((m) => !b.has(m.id) && m.have(after) >= m.need); }

export function logCSV(log, objects) {
  const byKey = new Map(objects.map((o) => [o.key, o]));
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['date', 'time', 'object', 'name', 'type', 'result', 'scope', 'eyepiece', 'sky', 'note']];
  for (const e of log || []) {
    const o = byKey.get(e.key) || {}, d = new Date(e.t);
    rows.push([d.toLocaleDateString(), d.toLocaleTimeString(), e.label || o.label, o.name || '', o.type || '', ({ yes: 'seen', maybe: 'not sure', no: 'not seen' })[e.seen] || e.seen, e.scope, e.ep, e.sky, e.note]);
  }
  return rows.map((r) => r.map(q).join(',')).join('\n');
}
