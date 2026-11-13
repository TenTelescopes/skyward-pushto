// Night (red) / Day colour handling for canvases. The drawing code is written in night-red terms
// (r is the brightness, g/b add warmth); in day mode the same call becomes white for ordinary marks
// and amber for highlights, on a dark-blue chart, so it stays readable in daylight.
export const theme = { day: false };
export function tint(r, g = 0, b = 0, a = 1, k = 1) {
  if (!theme.day) return `rgba(${r * k | 0},${g * k | 0},${b * k | 0},${a})`;
  const top = Math.max(r, g, b, 1), L = Math.min(1, (0.25 + 0.75 * top / 255));
  const warm = g >= 0.2 * r;
  const [R, G, B] = warm ? [255, 185, 70] : [225, 232, 255];
  return `rgba(${R * L | 0},${G * L | 0},${B * L | 0},${a})`;
}
