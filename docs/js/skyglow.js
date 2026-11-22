// Light-pollution estimate for a location, from a small map built into the app (Build 96).
//
// The map is made by tools/lightmap/build.py from NASA Black Marble yearly night lights (VNP46A4, a US government
// work): the light shining up from towns is spread over the surrounding sky with the usual fall-off with distance,
// then turned into sky brightness (SQM, magnitudes per square arcsecond) using a few places of known darkness.
// It is an estimate for planning only; the app's sky darkness check (or a camera fix) always wins.
//
// File format (data/skyglow.bin): "SKYG", version byte (1), header length (u32 little-endian), header JSON
// { north, west, dLat, dLon, rows, cols, year, source }, then rows × cols bytes, north row first, west column first:
// 0 = no data (outside the map), otherwise SQM = 16 + (byte - 1) / 40, i.e. 16.000 to 22.350 in steps of 0.025.

let grid = null, loading = null;

export async function loadSkyGlow(url = 'data/skyglow.bin') {
  if (grid) return grid;
  if (!loading) loading = (async () => {
    try {
      const r = await fetch(url); if (!r.ok) return null;
      grid = parseSkyGlow(new Uint8Array(await r.arrayBuffer()));
    } catch (e) { grid = null; }
    return grid;
  })();
  return loading;
}

export function parseSkyGlow(b) {
  if (b.length < 9 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'SKYG' || b[4] !== 1) return null;
  const n = b[5] | (b[6] << 8) | (b[7] << 16) | (b[8] << 24);
  const head = JSON.parse(new TextDecoder().decode(b.subarray(9, 9 + n)));
  const data = b.subarray(9 + n);
  if (data.length < head.rows * head.cols) return null;
  return { ...head, data };
}

/** SQM (mag/arcsec²) to naked-eye limiting magnitude (the usual Schaefer-style approximation). */
export function sqmToNelm(s) { return 7.93 - 5 * Math.log10(Math.pow(10, 4.316 - s / 5) + 1); }

/** Bortle class from SQM (the commonly used correspondence; approximate by nature). */
export function bortleOf(s) {
  return s >= 21.99 ? 1 : s >= 21.89 ? 2 : s >= 21.69 ? 3 : s >= 20.49 ? 4 : s >= 19.5 ? 5 : s >= 18.94 ? 6 : s >= 18.38 ? 7 : s >= 17.8 ? 8 : 9;
}

/** Naked-eye limiting magnitude back to SQM (the inverse of sqmToNelm). */
export function nelmToSqm(n) { const x = Math.pow(10, (7.93 - n) / 5) - 1; return x > 0 ? 5 * (4.316 - Math.log10(x)) : 22.5; }

/** Approximate Bortle class from a naked-eye limiting magnitude (e.g. the app's sky darkness check). */
export function bortleOfNelm(n) { return bortleOf(nelmToSqm(n)); }

/** Estimate at a place, or null when the map does not cover it (or has not loaded). Bilinear between cells. */
export function skyGlowAt(lat, lon, g = grid) {
  if (!g || lat == null || lon == null) return null;
  const fy = (g.north - lat) / g.dLat - 0.5, fx = (lon - g.west) / g.dLon - 0.5;
  if (fy < -0.5 || fx < -0.5 || fy > g.rows - 0.5 || fx > g.cols - 0.5) return null;
  const y0 = Math.max(0, Math.min(g.rows - 1, Math.floor(fy))), x0 = Math.max(0, Math.min(g.cols - 1, Math.floor(fx)));
  const y1 = Math.min(g.rows - 1, y0 + 1), x1 = Math.min(g.cols - 1, x0 + 1), ty = Math.max(0, Math.min(1, fy - y0)), tx = Math.max(0, Math.min(1, fx - x0));
  let sum = 0, w = 0;
  for (const [y, x, k] of [[y0, x0, (1 - ty) * (1 - tx)], [y0, x1, (1 - ty) * tx], [y1, x0, ty * (1 - tx)], [y1, x1, ty * tx]]) {
    const v = g.data[y * g.cols + x]; if (v && k > 0) { sum += k * (16 + (v - 1) / 40); w += k; }
  }
  if (w < 0.25) {                                   // a gap in the map: the average of the cells around it, if any
    const cy = Math.round(fy), cx = Math.round(fx); sum = 0; w = 0;
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      if (y < 0 || x < 0 || y >= g.rows || x >= g.cols) continue; const v = g.data[y * g.cols + x]; if (v) { sum += 16 + (v - 1) / 40; w++; }
    }
    if (!w) return null;
  }
  const sqm = sum / w;
  return { sqm, bortle: bortleOf(sqm), nelm: sqmToNelm(sqm), year: g.year, source: g.source };
}
