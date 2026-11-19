// Camera-frame analysis for plate solving: which parts of the picture are sky, where the stars are, and how much more
// light to collect. Pure functions on brightness arrays so the same code runs in the web page, in tests and in a native app.
//
// Brightness ("lum") is a Float32Array of r + g + b per pixel, 0..765, averaged over however many frames were stacked.

const FULL = 765;

/**
 * Decide which parts of the picture are sky.
 *
 * The night sky is smooth: its brightness changes slowly across the frame (darker overhead, a glow toward the horizon) and
 * it has no texture beyond sensor noise and pin-point stars. Trees, roofs, lamps and lit windows break one of those rules:
 * they are much darker or brighter than the smooth trend around them, or they are textured, or they are burnt out.
 * The frame is cut into tiles; a smooth surface is fitted to the tiles that look most like sky; tiles that do not sit on
 * that surface are thrown out, together with a one-tile margin around them (branches and roof edges).
 *
 * Returns { T, tw, th, sky: Uint8Array (1 = sky), level, noise, fraction, grad }.
 * level and noise describe the SKY ONLY and are what the exposure decisions use.
 */
export function skyMask(lum, w, h, stars) {
  const T = Math.max(16, Math.round(Math.max(w, h) / 40)), tw = Math.ceil(w / T), th = Math.ceil(h / T), n = tw * th;
  const mean = new Float32Array(n), sd = new Float32Array(n), sat = new Float32Array(n);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const x0 = tx * T, x1 = Math.min(w, x0 + T), y0 = ty * T, y1 = Math.min(h, y0 + T); let m = 0, s = 0, c = 0, hot = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const v = lum[y * w + x]; m += v; s += v * v; c++; if (v > FULL * 0.94) hot++; }
    if (!c) continue; m /= c; let d = Math.sqrt(Math.max(0, s / c - m * m));
    for (let pass = 0; pass < 2; pass++) {                      // clip twice so a star in the tile does not count as texture
      const lim = m + 2.5 * d + 0.5; let m2 = 0, s2 = 0, c2 = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const v = lum[y * w + x]; if (v <= lim) { m2 += v; s2 += v * v; c2++; } }
      if (c2 > 8) { m = m2 / c2; d = Math.sqrt(Math.max(0, s2 / c2 - m * m)); }
    }
    const i = ty * tw + tx; mean[i] = m; sd[i] = d; sat[i] = hot / c;
  }
  const median = (a) => { const b = Array.from(a).sort((p, q) => p - q); return b.length ? b[b.length >> 1] : 0; };
  const sdMed = median(sd);
  // Start from the calmer half of the tiles, then fit / reject / refit.
  let inl = new Uint8Array(n); for (let i = 0; i < n; i++) inl[i] = sd[i] <= sdMed * 1.3 + 0.3 && sat[i] < 0.02 ? 1 : 0;
  let coef = [median(mean), 0, 0, 0, 0, 0], scale = 1;
  const model = (tx, ty, c) => { const x = tx / tw - 0.5, y = ty / th - 0.5; return c[0] + c[1] * x + c[2] * y + c[3] * x * x + c[4] * x * y + c[5] * y * y; };
  for (let it = 0; it < 6; it++) {
    const A = Array.from({ length: 6 }, () => new Array(7).fill(0)); let cnt = 0;
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      const i = ty * tw + tx; if (!inl[i]) continue; cnt++;
      const x = tx / tw - 0.5, y = ty / th - 0.5, b = [1, x, y, x * x, x * y, y * y];
      for (let p = 0; p < 6; p++) { for (let q = 0; q < 6; q++) A[p][q] += b[p] * b[q]; A[p][6] += b[p] * mean[i]; }
    }
    if (cnt < 12) break;
    let okFit = true;
    for (let c = 0; c < 6 && okFit; c++) {
      let pv = c; for (let r = c + 1; r < 6; r++) if (Math.abs(A[r][c]) > Math.abs(A[pv][c])) pv = r;
      if (Math.abs(A[pv][c]) < 1e-9) { okFit = false; break; }
      [A[c], A[pv]] = [A[pv], A[c]]; const d = A[c][c]; for (let j = c; j < 7; j++) A[c][j] /= d;
      for (let r = 0; r < 6; r++) if (r !== c) { const m = A[r][c]; if (m) for (let j = c; j < 7; j++) A[r][j] -= m * A[c][j]; }
    }
    if (okFit) coef = A.map((r) => r[6]);
    const res = []; for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) { const i = ty * tw + tx; if (inl[i]) res.push(Math.abs(mean[i] - model(tx, ty, coef))); }
    const lvl = Math.max(1, coef[0]);
    scale = Math.max(1.4826 * median(res), 0.02 * lvl, 0.6);
    const sdIn = []; for (let i = 0; i < n; i++) if (inl[i]) sdIn.push(sd[i]); const sdRef = median(sdIn);
    const next = new Uint8Array(n);
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      const i = ty * tw + tx, r = mean[i] - model(tx, ty, coef);
      next[i] = Math.abs(r) <= 3.5 * scale && sd[i] <= 2.2 * sdRef + 0.4 && sat[i] < 0.02 ? 1 : 0;
    }
    // An abrupt step between neighbouring tiles is an edge (roofline, wall, tree line), however ordinary each side looks.
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      const i = ty * tw + tx, r = mean[i] - model(tx, ty, coef);
      for (const [dx, dy] of [[1, 0], [0, 1]]) { const X = tx + dx, Y = ty + dy; if (X >= tw || Y >= th) continue; const j = Y * tw + X; if (Math.abs(r - (mean[j] - model(X, Y, coef))) > 2.5 * scale) { next[i] = 0; next[j] = 0; } }
    }
    inl = next;
  }
  // Grow the sky outward from what was accepted. The fitted surface is only trustworthy near the tiles it was fitted to
  // (often the upper sky), so sky lower down — brighter with horizon glow — is added tile by tile wherever it continues
  // smoothly from an accepted neighbour. A tree line, roof or wall is a step, and growth stops there.
  {
    const diffs = []; for (let ty = 0; ty < th; ty++) for (let tx = 0; tx + 1 < tw; tx++) { const i = ty * tw + tx; if (inl[i] && inl[i + 1]) diffs.push(Math.abs(mean[i] - mean[i + 1])); }
    const sdIn = []; for (let i = 0; i < n; i++) if (inl[i]) sdIn.push(sd[i]); const sdRef = median(sdIn), step = 2.5 * scale + 2 * median(diffs);
    const queue = []; for (let i = 0; i < n; i++) if (inl[i]) queue.push(i);
    while (queue.length) {
      const i = queue.pop(), x = i % tw, y = (i / tw) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= tw || Y >= th) continue; const j = Y * tw + X;
        if (inl[j] || sat[j] >= 0.02 || sd[j] > 2.2 * sdRef + 0.4 || Math.abs(mean[j] - mean[i]) > step) continue;
        inl[j] = 1; queue.push(j);
      }
    }
  }
  // One-tile margin around anything rejected, then drop scraps of "sky" too small to be worth trusting.
  const sky = new Uint8Array(n);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    let good = 1; for (let dy = -1; dy <= 1 && good; dy++) for (let dx = -1; dx <= 1; dx++) { const x = tx + dx, y = ty + dy; if (x < 0 || y < 0 || x >= tw || y >= th) continue; if (!inl[y * tw + x]) { good = 0; break; } }
    sky[ty * tw + tx] = good;
  }
  // Connected patches. The largest is the sky. A separate patch (sky seen through a gap, or a plain wall that happens to be
  // about as bright as the sky) is kept only if it is a fair size and, when star candidates are supplied, has stars in it
  // at something like the main sky's density — walls do not.
  const seen = new Int32Array(n).fill(-1), minPatch = Math.max(6, Math.round(n * 0.015)), patches = [];
  for (let s0 = 0; s0 < n; s0++) {
    if (!sky[s0] || seen[s0] >= 0) continue; const stack = [s0], patch = []; seen[s0] = s0;
    while (stack.length) { const i = stack.pop(); patch.push(i); const x = i % tw, y = (i / tw) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= tw || Y >= th) continue; const j = Y * tw + X; if (sky[j] && seen[j] < 0) { seen[j] = s0; stack.push(j); } } }
    patches.push(patch);
  }
  patches.sort((a, b) => b.length - a.length);
  const starsIn = (patch) => { if (!stars) return 0; const set = new Set(patch); let c = 0; for (const st of stars) { if (set.has(Math.min(th - 1, (st.y / T) | 0) * tw + Math.min(tw - 1, (st.x / T) | 0))) c++; } return c; };
  const mainDensity = patches.length && stars ? starsIn(patches[0]) / patches[0].length : 0;
  for (let k = 1; k < patches.length; k++) {
    const pt = patches[k]; let keep = pt.length >= minPatch;
    if (keep && stars && mainDensity > 0) keep = starsIn(pt) / pt.length >= 0.3 * mainDensity;
    else if (keep && !stars) keep = pt.length >= 0.5 * patches[0].length;          // no star evidence yet: only trust a patch comparable to the main one
    if (!keep) for (const i of pt) sky[i] = 0;
  }
  const lv = [], ns = []; let count = 0; for (let i = 0; i < n; i++) if (sky[i]) { lv.push(mean[i]); ns.push(sd[i]); count++; }
  // If almost nothing passed, the picture is not a sky picture; say so rather than pretending.
  return { T, tw, th, sky, fraction: count / n, level: lv.length ? median(lv) : median(mean), noise: ns.length ? median(ns) : sdMed, grad: lv.length ? Math.max(...lv) - Math.min(...lv) : 0, tileMean: mean, tileSd: sd };
}
export const isSky = (m, x, y) => m.sky[Math.min(m.th - 1, (y / m.T) | 0) * m.tw + Math.min(m.tw - 1, (x / m.T) | 0)] === 1;

/**
 * Find stars. `mask` (from skyMask) is optional; with it, only sky is searched.
 * `K` is the detection threshold in units of the local noise (6 for stars to trust, 3.5 to see what is nearly there).
 * Returns { stars: [{x, y, snr, flux}], brightest first, noise, level }.
 */
export function findStars(lum, w, h, mask, K = 6) {
  // 3×3 box smooth: a real star covers several pixels, a hot pixel or a compression speck covers one.
  const sm = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    sm[i] = (lum[i - w - 1] + lum[i - w] + lum[i - w + 1] + lum[i - 1] + lum[i] + lum[i + 1] + lum[i + w - 1] + lum[i + w] + lum[i + w + 1]) / 9;
  }
  // Background level and noise in 64-pixel tiles, with one round of clipping so stars don't raise their own threshold.
  const T = 64, tw = Math.ceil(w / T), th = Math.ceil(h / T), bg = new Float32Array(tw * th), sd = new Float32Array(tw * th);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const x0 = Math.max(1, tx * T), x1 = Math.min(w - 1, x0 + T), y0 = Math.max(1, ty * T), y1 = Math.min(h - 1, y0 + T);
    let m = 0, s = 0, n = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const v = sm[y * w + x]; m += v; s += v * v; n++; }
    if (!n) continue;
    m /= n; let d = Math.sqrt(Math.max(0, s / n - m * m));
    let m2 = 0, s2 = 0, n2 = 0; const lim = m + 2.5 * d;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const v = sm[y * w + x]; if (v <= lim) { m2 += v; s2 += v * v; n2++; } }
    if (n2 > 8) { m = m2 / n2; d = Math.sqrt(Math.max(0, s2 / n2 - m * m)); }
    bg[ty * tw + tx] = m; sd[ty * tw + tx] = d;
  }
  // A camera that crushes black to exactly zero reports no noise at all; floor it so one grey pixel isn't called a star.
  const sds = Array.from(sd).filter((v) => v > 0).sort((a, b) => a - b), medSd = sds.length ? sds[sds.length >> 1] : 0;
  const floor = Math.max(0.35, medSd * 0.5), R = 3, stars = [];
  for (let y = R + 1; y < h - R - 1; y++) {
    const ty = Math.min(th - 1, (y / T) | 0);
    for (let x = R + 1; x < w - R - 1; x++) {
      const i = y * w + x, t = ty * tw + Math.min(tw - 1, (x / T) | 0), b = bg[t], s = Math.max(sd[t], floor), v = sm[i] - b;
      if (v < K * s) continue;
      if (mask && !isSky(mask, x, y)) continue;
      let peak = true;
      for (let dy = -R; dy <= R && peak; dy++) for (let dx = -R; dx <= R; dx++) { if ((dx || dy) && sm[i + dy * w + dx] > sm[i]) { peak = false; break; } }
      if (!peak) continue;
      // Size: how many pixels within 12 px are also well above the background. Stars are small; lamps, the Moon and windows are not.
      let big = 0; const y0 = Math.max(1, y - 12), y1 = Math.min(h - 2, y + 12), x0 = Math.max(1, x - 12), x1 = Math.min(w - 2, x + 12);
      for (let yy = y0; yy <= y1; yy += 2) for (let xx = x0; xx <= x1; xx += 2) if (sm[yy * w + xx] - b > 3 * s) big++;
      if (big > 60) continue;
      // A hot pixel is one bright pixel with nothing around it; even a sharp star spills into its neighbours.
      let ci = i; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (lum[i + dy * w + dx] > lum[ci]) ci = i + dy * w + dx;
      const centre = lum[ci] - b, ring = (lum[ci - w - 1] + lum[ci - w] + lum[ci - w + 1] + lum[ci - 1] + lum[ci + 1] + lum[ci + w - 1] + lum[ci + w] + lum[ci + w + 1]) / 8 - b;
      if (ring < 0.12 * centre) continue;
      // Brightness-weighted centre over 5×5, for sub-pixel positions (plate solving wants them).
      let sx = 0, sy = 0, sw = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const q = Math.max(0, lum[i + dy * w + dx] - b - s); sx += q * dx; sy += q * dy; sw += q; }
      stars.push({ x: x + (sw ? sx / sw : 0), y: y + (sw ? sy / sw : 0), snr: v / s, flux: sw || v });
    }
  }
  // Two peaks a few pixels apart are the same star.
  stars.sort((a, b) => b.snr - a.snr);
  const kept = [];
  for (const s of stars) { if (!kept.some((k) => Math.abs(k.x - s.x) < 8 && Math.abs(k.y - s.y) < 8)) kept.push(s); if (kept.length >= 400) break; }
  return { stars: kept, noise: medSd, level: bg.length ? Array.from(bg).sort((a, b) => a - b)[bg.length >> 1] : 0 };
}

// ---- lining frames up before adding them --------------------------------------------------------------------------------
// A hand-held phone, or a telescope still settling after a push, moves between frames. Each frame's brightest stars are
// matched to the first frame's, which gives the shift and twist to undo before the frame is added to the stack.

/** Half-size brightness image straight from canvas RGBA data (each output pixel is the mean of a 2×2 block). */
export function halfLum(rgba, w, h) {
  const w2 = w >> 1, h2 = h >> 1, out = new Float32Array(w2 * h2);
  if (rgba.length === w * h) {                       // already brightness (a RAW frame from the native camera)
    for (let y = 0; y < h2; y++) { const i = 2 * y * w, j = i + w; for (let x = 0; x < w2; x++) out[y * w2 + x] = (rgba[i + 2 * x] + rgba[i + 2 * x + 1] + rgba[j + 2 * x] + rgba[j + 2 * x + 1]) / 4; }
    return { lum: out, w: w2, h: h2 };
  }
  for (let y = 0; y < h2; y++) { let i = (2 * y * w) * 4, j = i + w * 4; for (let x = 0; x < w2; x++, i += 8, j += 8) out[y * w2 + x] = (rgba[i] + rgba[i + 1] + rgba[i + 2] + rgba[i + 4] + rgba[i + 5] + rgba[i + 6] + rgba[j] + rgba[j + 1] + rgba[j + 2] + rgba[j + 4] + rgba[j + 5] + rgba[j + 6]) / 4; }
  return { lum: out, w: w2, h: h2 };
}
/**
 * How frame `cur` must be moved to sit on frame `ref`, from their star lists ([{x, y}], brightest first, same pixel scale).
 * Returns { dx, dy, rot (radians, about the picture centre), n } meaning ref = centre + Rot·(cur − centre) + (dx, dy),
 * or null when the stars cannot be matched (too few, or the frame is smeared).
 */
export function registerStars(ref, cur, w, h, tol = 2.5) {
  const A = ref.slice(0, 14), B = cur.slice(0, 14); if (A.length < 2 || B.length < 2) return null;
  // Vote on the shift: every pairing of a reference star with a current star proposes one; the true shift is proposed by many.
  let best = null;
  for (const a of A) for (const b of B) {
    const dx = a.x - b.x, dy = a.y - b.y; let votes = 0;
    for (const p of A) for (const q of B) if (Math.abs(p.x - q.x - dx) < tol * 1.6 && Math.abs(p.y - q.y - dy) < tol * 1.6) { votes++; break; }
    if (!best || votes > best.votes) best = { dx, dy, votes };
  }
  if (!best || best.votes < 2) return null;
  const cx = w / 2, cy = h / 2;
  // Fit twist-about-the-centre plus shift to a set of matched stars.
  const fit = (pairs, allowRot) => {
    let rot = 0;
    if (allowRot && pairs.length >= 2) {
      let ax = 0, ay = 0, bx = 0, by = 0; for (const [p, q] of pairs) { ax += p.x; ay += p.y; bx += q.x; by += q.y; } ax /= pairs.length; ay /= pairs.length; bx /= pairs.length; by /= pairs.length;
      let sc = 0, ss = 0; for (const [p, q] of pairs) { const px = p.x - ax, py = p.y - ay, qx = q.x - bx, qy = q.y - by; sc += qx * px + qy * py; ss += qx * py - qy * px; }
      rot = Math.atan2(ss, sc);
    }
    const c = Math.cos(rot), sn = Math.sin(rot); let dx = 0, dy = 0;
    for (const [p, q] of pairs) { dx += p.x - (cx + c * (q.x - cx) - sn * (q.y - cy)); dy += p.y - (cy + sn * (q.x - cx) + c * (q.y - cy)); }
    return { dx: dx / pairs.length, dy: dy / pairs.length, rot, c, sn };
  };
  const at = (t, q) => [cx + t.c * (q.x - cx) - t.sn * (q.y - cy) + t.dx, cy + t.sn * (q.x - cx) + t.c * (q.y - cy) + t.dy];
  const match = (t, lim) => { const pairs = []; for (const p of A) { let m = null, md = lim; for (const q of B) { const [x, y] = at(t, q), d = Math.hypot(p.x - x, p.y - y); if (d < md) { md = d; m = q; } } if (m) pairs.push([p, m]); } return pairs; };
  // Start from the voted shift with a loose tolerance (a twist spreads the stars' shifts), then fit and re-match to tighten.
  let t = { dx: best.dx, dy: best.dy, rot: 0, c: 1, sn: 0 }, pairs = match(t, tol * 3);
  for (let it = 0; it < 4 && pairs.length >= 2; it++) { t = fit(pairs, true); pairs = match(t, it < 2 ? tol * 2 : tol); }
  if (pairs.length < 2) return null;
  // With only two stars the twist rests on a single line between them: too shaky, so keep the shift alone.
  t = fit(pairs, pairs.length >= 3);
  if (Math.abs(t.rot) > 0.2) return null;                    // more than ~11° between frames is not a stack
  let err = 0; for (const [p, q] of pairs) { const [x, y] = at(t, q); err += Math.hypot(p.x - x, p.y - y); }
  if (err / pairs.length > tol) return null;
  return { dx: t.dx, dy: t.dy, rot: t.rot, n: pairs.length };
}
/**
 * Add one RGBA frame into the stack, moved by `tf` (from registerStars, in full-size pixels) or as it is when tf is null.
 * `sum` collects brightness, `cnt` how many frames reached each pixel (the edges get fewer once frames are shifted).
 */
export function addFrame(sum, cnt, rgba, w, h, tf) {
  if (rgba.length === sum.length) return addLum(sum, cnt, rgba, w, h, tf);      // a brightness frame, not RGBA
  if (!tf || (Math.abs(tf.dx) < 0.25 && Math.abs(tf.dy) < 0.25 && Math.abs(tf.rot) < 1e-4)) {
    for (let i = 0, j = 0; i < sum.length; i++, j += 4) { sum[i] += rgba[j] + rgba[j + 1] + rgba[j + 2]; cnt[i]++; }
    return;
  }
  // For each stack pixel, find the frame pixel that belongs there: cur = centre + Rot⁻¹·(ref − centre − shift).
  const c = Math.cos(tf.rot), s = Math.sin(tf.rot), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) {
    const ry = y - cy - tf.dy; let sx = cx + c * (0 - cx - tf.dx) + s * ry + 0.5, sy = cy - s * (0 - cx - tf.dx) + c * ry + 0.5;
    for (let x = 0, i = y * w; x < w; x++, i++, sx += c, sy -= s) {
      const u = sx | 0, v = sy | 0; if (sx < 0 || sy < 0 || u >= w || v >= h) continue;
      const j = (v * w + u) * 4; sum[i] += rgba[j] + rgba[j + 1] + rgba[j + 2]; cnt[i]++;
    }
  }
}

function addLum(sum, cnt, lum, w, h, tf) {
  if (!tf || (Math.abs(tf.dx) < 0.25 && Math.abs(tf.dy) < 0.25 && Math.abs(tf.rot) < 1e-4)) { for (let i = 0; i < sum.length; i++) { sum[i] += lum[i]; cnt[i]++; } return; }
  const c = Math.cos(tf.rot), s = Math.sin(tf.rot), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) {
    const ry = y - cy - tf.dy; let sx = cx + c * (0 - cx - tf.dx) + s * ry + 0.5, sy = cy - s * (0 - cx - tf.dx) + c * ry + 0.5;
    for (let x = 0, i = y * w; x < w; x++, i++, sx += c, sy -= s) { const u = sx | 0, v = sy | 0; if (sx < 0 || sy < 0 || u >= w || v >= h) continue; sum[i] += lum[v * w + u]; cnt[i]++; }
  }
}

/** Words for how bright the sky background is, as a share of the camera's full range. */
export function skyWord(level) {
  const f = level / FULL;
  return f < 0.03 ? 'very dark' : f < 0.10 ? 'dark' : f < 0.22 ? 'bright (light pollution or moonlight)' : f < 0.5 ? 'very bright' : 'daylight or a lit room';
}

/**
 * Decide the exposure plan from the SKY ONLY.
 *
 *   level, noise   sky background and its noise in the current stack (from skyMask)
 *   frameTime      seconds of exposure per frame now; collected: seconds of light in the stack so far
 *   snrs           signal-to-noise of every candidate star found in the sky at a low threshold, brightest first
 *   canSetExposure true when the camera will take an exposure time (native, some Android browsers)
 *   maxFrameTime   longest single frame the camera allows; need: stars wanted for a confident solve; maxTotal: patience limit
 *
 * Two separate decisions:
 * 1. Length of each frame. The sky itself is the yardstick: its background should sit clearly above black (so faint stars are
 *    not crushed to zero by the camera's processing) and far below white. Under light pollution or a bright Moon the sky
 *    reaches that level quickly, so frames must be SHORT; under a dark sky they should be as long as the camera allows.
 * 2. How long to keep stacking. Stacking N frames improves faint stars by √N. From the faintest star we still need, work out
 *    how much more light makes it trustworthy. A bright sky is noisier, so the same stars take longer — up to the limit.
 */
export function planIntegration({ level, noise, frameTime, collected, snrs = [], canSetExposure = false, maxFrameTime = 1, need = 12, snrNeed = 6, maxTotal = 12 }) {
  const frac = level / FULL, LOW = 0.06, HIGH = 0.20, AIM = 0.11;
  let nextFrame = frameTime, frameWhy = 'frame length is right for this sky';
  if (frac > HIGH) { nextFrame = Math.max(1 / 1000, frameTime * AIM / frac); frameWhy = 'the sky is bright, so each frame should be shorter'; }
  else if (frac < LOW && frameTime < maxFrameTime) { nextFrame = Math.min(maxFrameTime, frameTime * Math.min(8, AIM / Math.max(frac, 0.004))); frameWhy = 'the sky is dark, so each frame can be longer'; }
  if (!canSetExposure && nextFrame !== frameTime) frameWhy += ' (this camera will not take the instruction, so stacking makes up the difference)';
  const good = snrs.filter((s) => s >= snrNeed).length;
  let total = collected, why;
  if (good >= need) why = `${good} clear stars: enough`;
  else {
    const kth = snrs.length >= need ? snrs[need - 1] : (snrs.length ? Math.min(snrs[snrs.length - 1], 3) * 0.8 : 1.5);
    total = collected * Math.pow(snrNeed / Math.max(kth, 0.8), 2);
    why = snrs.length >= need ? `star ${need} is at ${kth.toFixed(1)}× the noise and needs ${snrNeed}×` : `only ${snrs.length} possible stars so far`;
  }
  const capped = total > maxTotal; total = Math.min(Math.max(total, collected), maxTotal);
  return { sky: skyWord(level), frameTime: canSetExposure ? nextFrame : frameTime, wantedFrameTime: nextFrame, frameWhy, total, more: Math.max(0, total - collected), done: good >= need, good, capped, why };
}

/** Grey stripes over everything the mask rejected, so it is obvious what was ignored. ctx is a 2D canvas context of w×h. */
export function drawRejected(ctx, mask, w, h) {
  const pat = document.createElement('canvas'); pat.width = pat.height = 16; const p = pat.getContext('2d');
  p.fillStyle = 'rgba(120,124,140,0.55)'; p.fillRect(0, 0, 16, 16); p.strokeStyle = 'rgba(225,228,240,0.85)'; p.lineWidth = 3;
  for (const o of [-16, 0, 16]) { p.beginPath(); p.moveTo(o, 16); p.lineTo(o + 16, 0); p.stroke(); }
  const k = Math.max(1, w / 520); ctx.save(); const fill = ctx.createPattern(pat, 'repeat'); if (fill.setTransform) fill.setTransform(new DOMMatrix().scale(k)); ctx.fillStyle = fill;
  for (let ty = 0; ty < mask.th; ty++) for (let tx = 0; tx < mask.tw; tx++) if (!mask.sky[ty * mask.tw + tx]) ctx.fillRect(tx * mask.T, ty * mask.T, mask.T + 0.5, mask.T + 0.5);
  ctx.restore();
}
