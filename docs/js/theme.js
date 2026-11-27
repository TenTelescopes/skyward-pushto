// Colour handling for the whole app, on one fader: shade 0 = Day (an evening-sky look: deep blue, pale text, gold accents),
// shade 1 = Night (red on black only, for dark-adapted eyes). Everything in between is a straight blend.
// The drawing code for canvases is written in night-red terms (r is the brightness, g/b add warmth); tint() turns the
// same call into pale blue for ordinary marks and gold for highlights at the Day end.
export const theme = { shade: 1 };
const mix = (a, b, t) => a + (b - a) * t;
export function tint(r, g = 0, b = 0, a = 1, k = 1) {
  const t = theme.shade;
  let R = r * k, G = g * k, B = b * k;
  if (t < 1) {
    const top = Math.max(r, g, b, 1), L = Math.min(1, 0.25 + 0.75 * top / 255), warm = g >= 0.2 * r;
    const [dr, dg, db] = warm ? [255, 200, 95] : [222, 230, 255];
    R = mix(dr * L, R, t); G = mix(dg * L, G, t); B = mix(db * L, B, t);
  }
  return `rgba(${R | 0},${G | 0},${B | 0},${a})`;
}
// Star colours by spectral class, somewhat exaggerated so the difference shows on a phone: blue for the hottest stars,
// through white and yellow, to orange-red for the coolest. Used toward the Day end only; at Night everything is red.
const STAR_RGB = { O: [130, 170, 255], B: [150, 185, 255], A: [215, 228, 255], F: [255, 246, 214], G: [255, 222, 120], K: [255, 172, 88], M: [255, 112, 80] };
/** Colour for a star of spectral class cls ('B', 'K'…), blended toward the Night red as the fader moves. Null if unknown. */
export function starTint(cls, a = 1, k = 1) {
  const d = STAR_RGB[cls]; if (!d) return null;
  const t = theme.shade, n = [255 * k, 70 * k, 40 * k];
  return `rgba(${mix(d[0], n[0], t) | 0},${mix(d[1], n[1], t) | 0},${mix(d[2], n[2], t) | 0},${a})`;
}
// token: [day r,g,b,a], [night r,g,b,a] — night values are scaled by the brightness setting k (not alpha).
const TOKENS = {
  // The sky behind everything: zenith, mid-sky and the horizon. Build 125: a blue dusk (the purple horizon is gone).
  '--bg': [[4, 8, 26, 1], [0, 0, 0, 1], 0], '--bgm': [[11, 22, 58, 1], [0, 0, 0, 1], 0], '--bg2': [[24, 46, 92, 1], [0, 0, 0, 1], 0],
  // The one main button on a screen (Build 125): solid gold with dark lettering by day; at Night it stays a dark red
  // panel with bright lettering, so it adds no light.
  '--pfill': [[255, 214, 128, 1], [44, 0, 0, 1], 0], '--ptext': [[22, 20, 44, 1], [255, 45, 25, 1], 1], '--pline': [[255, 214, 128, 1], [210, 20, 10, 1], 1],
  '--panel': [[20, 28, 66, 0.78], [13, 0, 0, 1], 0], '--line': [[76, 90, 150, 1], [95, 0, 0, 1], 1], '--dim': [[160, 171, 212, 1], [145, 0, 0, 1], 1],
  '--fg': [[233, 237, 255, 1], [210, 20, 10, 1], 1], '--hi': [[255, 214, 128, 1], [255, 45, 25, 1], 1], '--good': [[126, 231, 170, 1], [255, 95, 45, 1], 1],
  '--press': [[40, 50, 104, 1], [28, 0, 0, 1], 0], '--row': [[33, 42, 88, 1], [23, 0, 0, 1], 0], '--sel': [[44, 56, 118, 1], [23, 0, 0, 1], 0],
  '--chart': [[4, 8, 24, 1], [5, 0, 0, 1], 0], '--veil': [[4, 7, 22, 0.9], [0, 0, 0, 0.94], 0], '--bar': [[24, 31, 72, 0.96], [26, 0, 0, 1], 0],
  '--glow': [[255, 214, 128, 0.16], [255, 45, 25, 0.16], 0],
  '--ghost': [[92, 104, 160, 1], [78, 78, 78, 1], 1],
  // Sky quality by hour (the forecast bar): go, OK, poor, unusable. Green to grey by day; shades of red at Night.
  '--q0': [[46, 170, 80, 1], [255, 45, 25, 1], 1], '--q1': [[150, 205, 160, 1], [150, 25, 15, 1], 1],
  '--q2': [[190, 194, 204, 1], [70, 10, 5, 1], 1], '--q3': [[70, 74, 86, 1], [24, 0, 0, 1], 1],          // "you can't see this one" stars: dark grey at Night, dim enough to keep night vision
};
let starsDone = false;
/** A sprinkling of stars as one SVG tile (same every time), set once. */
function starTile() {
  let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  let c = '';
  for (let i = 0; i < 120; i++) {
    const big = rnd() < 0.12, r = big ? 1 + rnd() * 0.7 : 0.35 + rnd() * 0.55, y = 900 * rnd() ** 1.35;      // thicker toward the top, where the sky is darker
    c += `<circle cx="${(rnd() * 420).toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${big && rnd() < 0.4 ? '#ffe3a8' : '#fff'}" opacity="${(big ? 0.8 : 0.3 + rnd() * 0.45).toFixed(2)}"/>`;
  }
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="900">${c}</svg>`)}")`;
}
/** Set every colour token for shade t (0 day … 1 night) and night brightness k. */
export function applyShade(t, k = 1) {
  theme.shade = t;
  const st = document.documentElement.style;
  for (const [name, [d, n, scale]] of Object.entries(TOKENS)) {
    const f = scale ? k : 1, v = [0, 1, 2].map((i) => Math.round(mix(d[i], n[i] * f, t)));
    st.setProperty(name, `rgba(${v[0]},${v[1]},${v[2]},${mix(d[3], n[3], t).toFixed(3)})`);
  }
  st.setProperty('--stars', (1 - t).toFixed(3));
  if (!starsDone) { st.setProperty('--starsimg', starTile()); starsDone = true; }
  return `rgb(${Math.round(mix(5, 0, t))},${Math.round(mix(9, 0, t))},${Math.round(mix(30, 0, t))})`;     // for the browser's theme-color
}
