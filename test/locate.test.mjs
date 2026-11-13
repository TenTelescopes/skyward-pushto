import { constellationAt, conName } from '../docs/js/locate.js';
import { DSO, DOUBLES } from '../docs/data/catalog.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
// Independent answer key: OpenNGC's constellation for each deep-sky object, and the RASC list's for each double.
const norm = (c) => { c = (c || '').toUpperCase(); return /^SE(R|1|2)/.test(c) ? 'SER' : c; };
let n = 0, bad = [];
for (const o of [...DSO, ...DOUBLES]) {
  if (!o.con || o.cats.includes('Asterism')) continue;
  const got = norm(constellationAt(o.ra, o.dec)); n++;
  if (got !== norm(o.con)) bad.push(`${o.id} ${o.con}→${got}`);
}
ok(bad.length <= 3, `${n - bad.length}/${n} catalog objects land in their listed constellation${bad.length ? ' (disagree: ' + bad.join(', ') + ')' : ''}`);
ok(constellationAt(37.95, 89.26) === 'UMI', 'Polaris is in Ursa Minor (pole-containing region)');
ok(constellationAt(83.82, -5.39) === 'ORI', 'M42 in Orion');
ok(conName('BOO') === 'Boötes', 'Latin names');
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
