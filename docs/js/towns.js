// Town names for the light-pollution map: every place of 500+ people in the map's area (GeoNames cities500, CC BY 4.0),
// largest first, built by tools/towns/build.py into data/towns.txt. Plus known dark-sky sites, which are always shown.

let towns = null, loading = null;

/** Loads data/towns.txt once. Resolves { name[], lat Float32Array, lon Float32Array, pop Uint32Array, region[] } or null. */
export function loadTowns(url = 'data/towns.txt') {
  if (towns) return Promise.resolve(towns);
  if (!loading) loading = fetch(url).then((r) => (r.ok ? r.text() : null)).then((t) => (towns = t ? parseTowns(t) : null)).catch(() => null);
  return loading;
}
export const townsLoaded = () => towns;

export function parseTowns(text) {
  const lines = text.split('\n').filter(Boolean), n = lines.length;
  const T = { name: new Array(n), region: new Array(n), lat: new Float32Array(n), lon: new Float32Array(n), pop: new Uint32Array(n), n };
  lines.forEach((l, i) => { const f = l.split('|'); T.name[i] = f[0]; T.lat[i] = +f[1] / 1000; T.lon[i] = +f[2] / 1000; T.pop[i] = +f[3]; T.region[i] = f[4] || ''; });
  return T;
}

/** Dark-sky preserves and parks in the map's area (RASC and DarkSky International designations), with coordinates
 *  from Wikipedia and go-astronomy.com (Nov 2026). */
export const DARK_SITES = [
  ['Torrance Barrens', 44.9517, -79.5031], ['Killarney', 46.1167, -81.4167], ['Bruce Peninsula', 45.2389, -81.6142],
  ['Lake Superior Park', 47.5967, -84.7414], ['Point Pelee', 41.9642, -82.5178], ['Manitoulin Eco Park', 45.6613, -81.9705],
  ['North Frontenac', 44.9176, -76.9388], ['Mont-Mégantic', 45.4569, -71.1625], ['Cherry Springs', 41.6638, -77.8232],
  ['Headlands', 45.783, -84.783],
];

const D2R = Math.PI / 180;
const km = (la1, lo1, la2, lo2) => { const x = (lo2 - lo1) * Math.cos((la1 + la2) / 2 * D2R), y = la2 - la1; return Math.hypot(x, y) * 111.2; };

/** A name for a spot: a dark-sky site it's in, the town it's in or near (bigger towns win at a distance), else null. */
export function nearestName(lat, lon, T = towns) {
  for (const [nm, la, lo] of DARK_SITES) if (km(lat, lon, la, lo) < 6) return nm;
  if (!T) return null;
  let best = null;
  for (let i = 0; i < T.n; i++) {
    if (Math.abs(T.lat[i] - lat) > 0.4) continue;
    const d = km(lat, lon, T.lat[i], T.lon[i]); if (d > 30) continue;
    const score = d / (1 + Math.log10(T.pop[i] / 500) * 0.5);           // a little preference for larger places
    if (!best || score < best.score) best = { i, d, score };
  }
  if (!best) return null;
  const nm = `${T.name[best.i]}${T.region[best.i] ? ', ' + T.region[best.i] : ''}`;
  return best.d < 3 ? nm : `near ${nm}`;
}
