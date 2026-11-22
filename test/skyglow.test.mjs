import assert from 'node:assert/strict';
import { parseSkyGlow, skyGlowAt, sqmToNelm, bortleOf } from '../docs/js/skyglow.js';
const ok = (name, f) => { f(); console.log('ok  ', name); };

// A 4 × 4 grid over 43–45 N, 81–79 W at 0.5°: a bright corner (SQM 17.0), a dark corner (21.8), one cell with no data.
function make() {
  const head = new TextEncoder().encode(JSON.stringify({ north: 45, west: -81, dLat: 0.5, dLon: 0.5, rows: 4, cols: 4, year: 2024, source: 'test' }));
  const q = (s) => Math.round((s - 16) * 40) + 1, cells = new Uint8Array(16).fill(q(20));
  cells[0] = q(21.8); cells[15] = q(17.0); cells[5] = 0;
  const b = new Uint8Array(9 + head.length + 16); b.set([83, 75, 89, 71, 1]); new DataView(b.buffer).setUint32(5, head.length, true);
  b.set(head, 9); b.set(cells, 9 + head.length); return parseSkyGlow(b);
}
const g = make();
ok('reads the file', () => { assert.equal(g.rows, 4); assert.equal(g.cols, 4); assert.equal(g.year, 2024); });
ok('looks up a cell centre', () => { const r = skyGlowAt(44.75, -80.75, g); assert.ok(Math.abs(r.sqm - 21.8) < 0.03); assert.equal(r.bortle, 3); });
ok('bright corner', () => { const r = skyGlowAt(43.25, -79.25, g); assert.ok(Math.abs(r.sqm - 17.0) < 0.03); assert.equal(r.bortle, 9); });
ok('outside the map is null', () => { assert.equal(skyGlowAt(50, -80, g), null); assert.equal(skyGlowAt(44, -70, g), null); });
ok('skips cells without data', () => { const r = skyGlowAt(44.25, -80.25, g); assert.ok(r && Math.abs(r.sqm - 20) < 0.3); });
ok('SQM to naked-eye limit', () => { assert.ok(Math.abs(sqmToNelm(21.5) - 6.4) < 0.1); assert.ok(Math.abs(sqmToNelm(19) - 4.8) < 0.1); assert.ok(sqmToNelm(18) < 4.1); });
ok('Bortle classes', () => { assert.equal(bortleOf(22.0), 1); assert.equal(bortleOf(21.0), 4); assert.equal(bortleOf(19.2), 6); assert.equal(bortleOf(17.5), 9); });

// Build 98: Bortle from a sky darkness check (limiting magnitude)
{
  const { nelmToSqm, sqmToNelm, bortleOfNelm } = await import('../docs/js/skyglow.js');
  for (const s of [17.5, 19, 20.5, 21.5]) if (Math.abs(nelmToSqm(sqmToNelm(s)) - s) > 1e-6) throw new Error('nelmToSqm is not the inverse of sqmToNelm at ' + s);
  if (bortleOfNelm(4) !== 8 || bortleOfNelm(6.5) !== 3 || bortleOfNelm(5) !== 6) throw new Error('bortleOfNelm out of family');
  console.log('ok bortleOfNelm');
}
