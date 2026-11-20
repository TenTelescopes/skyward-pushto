// Plate solving off the screen-drawing thread, so the app keeps responding while it searches the sky.
import { FIELD } from '../data/catalog.js';
import { solve } from './camera.js';
self.onmessage = (e) => {
  const { id, stars, w, h, prior, scale, budget } = e.data;
  try { const r = solve(stars, w, h, FIELD, prior, scale, budget); self.postMessage({ id, ok: true, r: { ...r, sol: r.sol && { ...r.sol, matches: r.sol.matches } } }); }
  catch (err) { self.postMessage({ id, ok: false, error: String(err && err.message || err) }); }
};
