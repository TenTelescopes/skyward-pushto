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
  const key = `fc2:${lat.toFixed(2)},${lon.toFixed(2)}:${hourISO(hours[0])}:${hours.length}`;   // fc2: rows now carry temperature, dew point and wind
  try { const c = storage && JSON.parse(storage.getItem(key) || 'null'); if (c && Date.now() - c.at < 90 * 60000) return c.rows.map((r) => ({ ...r, t: new Date(r.t) })); } catch (e) { /* ignore */ }
  const jobs = [];
  for (const t of hours) {
    jobs.push(async () => { const v = await point('HRDPS.CONTINENTAL_NT', lat, lon, t, fetchFn); return v != null ? v : point('RDPS_10km_TotalCloudCover', lat, lon, t, fetchFn); });
    jobs.push(() => point('RDPS_10km_SeeingIndex', lat, lon, t, fetchFn));
    jobs.push(() => point('RDPS_10km_SkyTransparencyIndex', lat, lon, t, fetchFn));
    // Build 114: the comfort side. Temperature and dew point at 2 m (°C) and wind at 10 m (m/s), HRDPS first, then RDPS.
    // Layer names checked against GeoMet on Nov 25, 2026.
    const two = (a, b) => async () => { const x = await point(a, lat, lon, t, fetchFn); return x != null ? x : point(b, lat, lon, t, fetchFn); };
    jobs.push(two('HRDPS.CONTINENTAL_TT', 'RDPS_10km_AirTemp_2m'));
    jobs.push(two('HRDPS.CONTINENTAL_TD', 'RDPS_10km_DewPoint_2m'));
    jobs.push(two('HRDPS.CONTINENTAL_WSPD', 'RDPS_10km_WindSpeed_10m'));
  }
  const v = await pool(jobs), N = 6;
  const rows = hours.map((t, k) => ({ t, cloud: v[N * k], seeing: v[N * k + 1], transp: v[N * k + 2], temp: v[N * k + 3], dew: v[N * k + 4], wind: v[N * k + 5] != null ? v[N * k + 5] * 3.6 : null }));
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

/**
 * Apple Weather hours from the iPhone app's SkyWeather plug-in, or null (web app, no WeatherKit, offline, refused).
 * Rows: { t, temp °C, dew °C, hum %, cloud %, low/mid/high % (iOS 18+), wind and gust km/h, vis km, pop % }.
 * Cached like the Environment Canada forecast (90 minutes per place and night), so a night costs a call or two.
 */
export async function appleHourly(plugin, lat, lon, from, to, { storage = (typeof localStorage !== 'undefined' ? localStorage : null) } = {}) {
  if (!plugin || !plugin.hourly || lat == null || lon == null) return null;
  const key = `wk:${lat.toFixed(2)},${lon.toFixed(2)}:${hourISO(from)}:${hourISO(to)}`;
  try { const c = storage && JSON.parse(storage.getItem(key) || 'null'); if (c && Date.now() - c.at < 90 * 60000) return { ...c.v, hours: c.v.hours.map((h) => ({ ...h, t: new Date(h.t) })) }; } catch (e) { /* ignore */ }
  try {
    const r = await plugin.hourly({ lat, lon, from: +from, to: +to });
    if (!r || !Array.isArray(r.hours) || !r.hours.length) return null;
    const v = { hours: r.hours.map((h) => ({ ...h, t: new Date(h.t) })), attribution: r.attribution || null };
    try { if (storage) storage.setItem(key, JSON.stringify({ at: Date.now(), v })); } catch (e) { /* full or blocked */ }
    return v;
  } catch (e) { return null; }
}

/**
 * Put Apple's hours beside Environment Canada's: same hour → extra fields on the row (`ap`), and Apple's total cloud
 * fills in where Environment Canada has none (outside its area). Without Environment Canada rows, Apple's hours become
 * the rows (no seeing or transparency then).
 */
export function mergeApple(rows, apple, hours) {
  if (!apple || !apple.hours) return rows;
  const byHour = new Map(apple.hours.map((h) => [Math.round(h.t / 3600000), h]));
  const base = rows || hours.map((t) => ({ t, cloud: null, seeing: null, transp: null }));
  const out = base.map((r) => { const h = byHour.get(Math.round(r.t / 3600000)); if (!h) return r;
    return { ...r, cloud: r.cloud != null ? r.cloud : h.cloud, cloudSrc: r.cloud != null ? 'eccc' : 'apple', ap: h }; });
  return out.some((r) => r.cloud != null || r.ap) ? out : rows;
}

/** Temperature, dew point, wind (km/h) and gust for a row: Environment Canada's, or Apple Weather's where it has none. */
export const comfort = (r) => {
  const ap = r.ap || {};
  const temp = r.temp != null ? r.temp : ap.temp ?? null, dew = r.dew != null ? r.dew : ap.dew ?? null;
  const wind = r.wind != null ? r.wind : ap.wind ?? null, gust = ap.gust ?? null;
  return { temp, dew, wind, gust, gap: temp != null && dew != null ? Math.max(0, temp - dew) : null, feels: feelsLike(temp, wind) };
};
/** Environment Canada's wind chill (°C), for 10 °C or colder with wind of 5 km/h or more; otherwise the air temperature. */
export function feelsLike(T, V) {
  if (T == null) return null;
  if (V == null || T > 10 || V < 5) return T;
  const v = V ** 0.16; return 13.12 + 0.6215 * T - 11.37 * v + 0.3965 * T * v;
}
/** How cold it feels, in words, using Environment Canada's wind-chill bands. */
export function coldWord(f) {
  if (f == null || f > 5) return null;
  return f <= -40 ? 'dangerously cold: exposed skin freezes in minutes' : f <= -28 ? 'severely cold: exposed skin can freeze in 10 to 30 minutes' : f <= -10 ? 'very cold' : f <= 0 ? 'cold' : 'chilly';
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
  // Apple Weather extras (iPhone app): dew, wind, thin high cloud.
  const ap = win.map((r) => r.ap).filter(Boolean), extra = { warn: [] };
  // Dew and cold: Environment Canada's temperature and dew point (or Apple Weather's in the iPhone app).
  const cf = win.map((r) => ({ r, c: comfort(r) }));
  const dewHour = cf.find((x) => x.c.gap != null && x.c.gap <= 2.5);
  if (dewHour) {
    const frost = dewHour.c.temp <= 0.5;
    extra.dew = { from: dewHour.r.t, frost };
    extra.warn.push(`${frost ? 'Frost' : 'Dew'} likely from about ${hhmm(dewHour.r.t)}: keep the finder and eyepieces capped until you use them.`);
    hints.push(`${frost ? 'Frost' : 'Dew'} forecast: the air is within ${dewHour.c.gap.toFixed(0)}° of its dew point by ${hhmm(dewHour.r.t)}. On a clear night a telescope cools below the air, so the finder, the eyepieces and the small mirror fog first. Keep caps on until you use them, and a dew shield (a tube of foam or card past the end) or a little warmth from a hair dryer on low clears it.`);
  }
  const coldest = cf.filter((x) => x.c.feels != null).sort((a, b) => a.c.feels - b.c.feels)[0];
  if (coldest) {
    const f = coldest.c.feels, T = coldest.c.temp;
    extra.cold = { feels: f, temp: T, at: coldest.r.t, dressFor: Math.round(f - 10) };
    const w = coldWord(f);
    if (f <= 5) extra.warn.push(`${w ? w[0].toUpperCase() + w.slice(1) : 'Cold'}: down to ${Math.round(T)}°C${Math.round(f) < Math.round(T) ? `, feeling like ${Math.round(f)}°C in the wind` : ''} by ${hhmm(coldest.r.t)}. Dress for about ${Math.round(f - 10)}°C: you stand still at a telescope.`);
  }
  if (ap.length) {
    const gust = Math.max(...ap.map((h) => Math.max(h.gust || 0, h.wind || 0)));
    if (gust >= 25) {
      extra.wind = Math.round(gust);
      extra.warn.push(`Gusts to ${Math.round(gust)} km/h: the view will shake at high power.`);
      hints.push(`Gusty (up to ${Math.round(gust)} km/h): a light telescope shakes at high power. Use low power, set up in the lee of the house or the car, and lower the scope a little so the tube catches less wind.`);
    }
    const highs = ap.map((h) => h.high).filter((x) => x != null);
    const hi = median(highs);
    if (hi != null && hi >= 40) {
      extra.highCloud = Math.round(hi);
      extra.warn.push('Possible thin high cloud: faint galaxies may fade.');
      hints.push('Thin high cloud in Apple\'s forecast: it can look clear to the eye but dims faint galaxies and nebulae and puts haloes round bright stars. Good for the Moon, planets, doubles and bright clusters.');
    }
  }
  if (tr != null && tr <= 2) hints.push('Hazy air dims faint things before it bothers bright ones: a night for clusters, doubles and planets.');
  if (seeingWord(see) === 'poor') hints.push('Unsteady air blurs planets at high power. Stay at medium power, or wait: the air often settles later in the night.');
  if (seeingWord(see) === 'good' && tr != null && tr <= 3) hints.push('Steady air often comes with a little haze — the same calm, moist air. Good news for planets and doubles.');
  hints.push('Transparency is how clear the air is, which matters for faint galaxies and nebulae. Seeing is how steady it is, which matters for detail on planets and close doubles. The two rarely peak together: crisp nights after a cold front are often unsteady, and calm, slightly hazy nights are often the steadiest.');
  return { kind, from: best.from, to: new Date(best.to.getTime() + 3600000), seeing: see, transp: tr, brightMoon, effNelm, extra,
    text: `${window}${bits.length ? ', with ' + bits.join(', ') : ''}.`, best: out, hints };
}
