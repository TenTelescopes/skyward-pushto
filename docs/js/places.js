// Saved places (a spot + its blocked-sky map) and automatic names for places and plans.
// Pure functions, unit-tested in Node.

const R_KM = 6371, D2R = Math.PI / 180;
export function distKm(a, b) {
  const dLat = (b.lat - a.lat) * D2R, dLon = (b.lon - a.lon) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const NEAR_KM = 0.5;                       // a front yard and a back yard are "the same spot" to GPS; a park down the road is not
export const PLACE_IDEAS = ['Backyard', 'Front yard', 'Cottage', 'Park', 'Dark site'];
export const nearPlaces = (places, lat, lon, km = NEAR_KM) => (places || []).filter((p) => distKm(p, { lat, lon }) <= km).sort((a, b) => distKm(a, { lat, lon }) - distKm(b, { lat, lon }));
export const coordText = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
/** "Backyard", then "Backyard 2", "Backyard 3"… so two places never share a name. */
export function uniqueName(taken, base) {
  const have = new Set((taken || []).map((s) => s.trim().toLowerCase())); base = (base || '').trim() || 'My spot';
  if (!have.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!have.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}
/**
 * The observer's position changed (GPS fix or typed in). Which saved place are they at now?
 * Returns { id, why }: 'stay' (still at the current place), 'switch' (exactly one other saved place is here),
 * 'choose' (several saved places are here: keep none selected and let them pick), 'left' (nowhere saved).
 */
export function relocate(places, currentId, lat, lon) {
  const here = nearPlaces(places, lat, lon);
  if (here.some((p) => p.id === currentId)) return { id: currentId, why: 'stay' };
  if (here.length === 1) return { id: here[0].id, why: 'switch' };
  if (here.length > 1) return { id: null, why: 'choose', choices: here };
  return { id: null, why: 'left' };
}
export function partOfDay(d) { const h = d.getHours(); return h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; }
/** "Tue Nov 17 evening · Backyard". A session that starts after midnight belongs to the night before. */
export function planAutoName(start, where, locale) {
  const d = new Date(start), night = d.getHours() < 5 ? new Date(d.getTime() - 86400000) : d;
  const day = night.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  return `${day} ${partOfDay(d)}${where ? ` · ${where}` : ''}`;
}
