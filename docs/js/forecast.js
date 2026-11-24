// Tonight's weather for observing, from Environment and Climate Change Canada's forecast models (Build 107).
//
// Point values come from MSC GeoMet (WMS GetFeatureInfo, JSON), which browsers may call directly:
//   HRDPS.CONTINENTAL_NT            total cloud cover %, 2.5 km grid, about 48 h ahead
//   RDPS_10km_TotalCloudCover       total cloud cover %, 10 km grid, about 3.5 days ahead (used beyond the HRDPS)
//   RDPS_10km_SeeingIndex           seeing (steadiness), 0–5: 0 cloudy, 1 very bad, 2 poor, 3 average, 4 good, 5 excellent
//   RDPS_10km_SkyTransparencyIndex  transparency (haze, from the humidity of the whole air column), same 0–5 scale
// Scales from ECCC's "Seeing Forecast" and "Sky Transparency Forecast" pages. The seeing forecast was calibrated with
// 28–35 cm telescopes; ECCC notes it can read slightly pessimistic for smaller ones. Transparency ignores smoke, dust
// and other aerosols. Licence: ECCC Data Servers End-use Licence; the attribution below must be shown with the data.

export const ATTRIB = 'Data Source: Environment and Climate Change Canada';
export const LICENCE_URL = 'https://eccc-msc.github.io/open-data/licence/readme_en/';
const BASE = 'https://geo.weather.gc.ca/geomet?service=WMS&version=1.3.0&request=GetFeatureInfo&crs=EPSG:4326&width=11&height=11&i=5&j=5&info_format=application/json';
export const SCALE = ['cloudy', 'very bad', 'poor', 'average', 'good', 'excellent'];

const hourISO = (t) => new Date(Math.round(t / 3600000) * 3600000).toISOString().replace('.000', '');

/** One value at a point and hour, or null (no data, out of range, offline). */
async function point(layer, lat, lon, t, fetchFn = fetch) {
  const d = 0.05, url = `${BASE}&layers=${layer}&query_layers=${layer}&bbox=${lat - d},${lon - d},${lat + d},${lon + d}&time=${hourISO(t)}`;
  try {
    const r = await fetchFn(url); if (!r.ok) return null;
    const j = await r.json(), f = j && j.features && j.features[0];
    const v = f && f.properties ? f.properties.value : null;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch (e) { return null; }
}

/** Run promises a few at a time (be gentle with a free public service). */
async function pool(jobs, n = 6) {
  const out = new Array(jobs.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (i < jobs.length) { const k = i++; out[k] = await jobs[k](); } }));
  return out;
}

/**
 * Hourly forecast for the given hours (Dates) at a place: [{ t, cloud %, seeing 0–5, transp 0–5 }] (each may be null),
 * or null when nothing at all came back. Cached in localStorage for 90 minutes per place and night.
 */
export async function hourlyForecast(lat, lon, hours, { fetchFn = fetch, storage = (typeof localStorage !== 'undefined' ? localStorage : null) } = {}) {
  if (!hours.length || lat == null || lon == null) return null;
  const key = `fc:${lat.toFixed(2)},${lon.toFixed(2)}:${hourISO(hours[0])}:${hours.length}`;
  try { const c = storage && JSON.parse(storage.getItem(key) || 'null'); if (c && Date.now() - c.at < 90 * 60000) return c.rows.map((r) => ({ ...r, t: new Date(r.t) })); } catch (e) { /* ignore */ }
  const jobs = [];
  for (const t of hours) {
    jobs.push(async () => { const v = await point('HRDPS.CONTINENTAL_NT', lat, lon, t, fetchFn); return v != null ? v : point('RDPS_10km_TotalCloudCover', lat, lon, t, fetchFn); });
    jobs.push(() => point('RDPS_10km_SeeingIndex', lat, lon, t, fetchFn));
    jobs.push(() => point('RDPS_10km_SkyTransparencyIndex', lat, lon, t, fetchFn));
  }
  const v = await pool(jobs);
  const rows = hours.map((t, k) => ({ t, cloud: v[3 * k], seeing: v[3 * k + 1], transp: v[3 * k + 2] }));
  if (rows.every((r) => r.cloud == null && r.seeing == null && r.transp == null)) return null;
  try { if (storage) storage.setItem(key, JSON.stringify({ at: Date.now(), rows })); } catch (e) { /* full or blocked */ }
  return rows;
}

/** Whole hours from `from` to `to` (inclusive of the first). */
export function hoursBetween(from, to) {
  const out = []; let t = Math.ceil(from.getTime() / 3600000) * 3600000;
  for (; t <= to.getTime() && out.length < 16; t += 3600000) out.push(new Date(t));
  return out;
}

const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

/** Steady-air word from the forecast's seeing index (1–2 poor, 3 average, 4–5 good). */
export const seeingWord = (i) => (i == null || i === 0 ? null : i <= 2 ? 'poor' : i === 3 ? 'average' : 'good');
/**
 * How much haze takes off the naked-eye limit, by transparency index. ECCC's page gives about 6.5–7.2 for very dry
 * skies against 5.5–6.5 for humid ones: roughly a magnitude across the scale. Our light-pollution map is an average
 * night, so "medium" counts as no change.
 */
export const transpAdj = (i) => (i == null || i === 0 ? 0 : [0, -0.8, -0.4, 0, 0.15, 0.3][i]);

/**
 * The night in plain words.
 * rows: hourlyForecast rows. moonUp(t) → { up, frac }. nelm: the sky's moonless naked-eye limit (map or check).
 * Returns { kind: 'clear'|'partly'|'cloudy', from, to, seeing, transp, text, best: [..], hints: [..] }.
 */
export function outlook(rows, { moonUp, nelm, fromCheck = false, restOfNight = false } = {}) {
  const ok = rows.filter((r) => r.cloud != null);
  if (!ok.length) return null;
  const clear = (r) => r.cloud < 35;
  // Longest run of clear hours.
  let best = null, cur = null;
  for (const r of ok) { if (clear(r)) { cur = cur ? { ...cur, to: r.t, n: cur.n + 1 } : { from: r.t, to: r.t, n: 1 }; if (!best || cur.n > best.n) best = cur; } else cur = null; }
  const nClear = ok.filter(clear).length;
  if (!best || best.n < 2 && nClear < 2) {
    const someGaps = ok.some((r) => r.cloud < 60);
    return { kind: 'cloudy', text: someGaps ? 'Mostly cloudy, with only short breaks in the forecast.' : 'Clouded out: the forecast has cloud all night.', best: [], hints: ['Cloud forecasts are least sure about thin high cloud and the exact timing of clearing; it can be worth a look outside.'] };
  }
  const win = ok.filter((r) => r.t >= best.from && r.t <= best.to);
  const pos = (x) => (x > 0 ? x : null);                                     // 0 means "cloudy here", not a rating
  const see = median(win.map((r) => pos(r.seeing))), tr = median(win.map((r) => pos(r.transp)));
  const moonHours = win.filter((r) => { const m = moonUp(r.t); return m.up && m.frac > 0.4; }).length;
  const brightMoon = moonHours >= win.length / 2;
  const effNelm = nelm + (fromCheck ? 0 : transpAdj(tr));
  const out = [];
  if (seeingWord(see) === 'good') out.push('planets and close doubles at high power');
  if (!brightMoon && effNelm >= 5.3 && (tr == null || tr >= 3)) out.push('galaxies and nebulae');
  if (!out.length || brightMoon || effNelm < 4.8) out.push(brightMoon ? 'the Moon, planets, doubles and bright clusters' : 'planets, doubles, clusters and the brighter showpieces');
  const kind = best.n >= Math.max(2, ok.length * 0.75) ? 'clear' : 'partly';
  const hhmm = (t) => t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const window = kind === 'clear' && best.n === ok.length ? (restOfNight ? 'Clear for the rest of the night' : 'Clear all night') : `Clear from about ${hhmm(best.from)} to ${hhmm(new Date(best.to.getTime() + 3600000))}`;
  const bits = [];
  if (see != null && see > 0) bits.push(`${SCALE[see]} steadiness`);
  if (tr != null && tr > 0) bits.push(`${SCALE[tr] === 'average' ? 'medium' : SCALE[tr]} transparency`);
  if (brightMoon) bits.push('a bright Moon up');
  const hints = [];
  if (tr != null && tr <= 2) hints.push('Hazy air dims faint things before it bothers bright ones: a night for clusters, doubles and planets.');
  if (seeingWord(see) === 'poor') hints.push('Unsteady air blurs planets at high power. Stay at medium power, or wait: the air often settles later in the night.');
  if (seeingWord(see) === 'good' && tr != null && tr <= 3) hints.push('Steady air often comes with a little haze — the same calm, moist air. Good news for planets and doubles.');
  hints.push('Transparency is how clear the air is, which matters for faint galaxies and nebulae. Seeing is how steady it is, which matters for detail on planets and close doubles. The two rarely peak together: crisp nights after a cold front are often unsteady, and calm, slightly hazy nights are often the steadiest.');
  return { kind, from: best.from, to: new Date(best.to.getTime() + 3600000), seeing: see, transp: tr, brightMoon, effNelm,
    text: `${window}${bits.length ? ', with ' + bits.join(', ') : ''}.`, best: out, hints };
}
