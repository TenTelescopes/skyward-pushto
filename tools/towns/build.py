#!/usr/bin/env python3
"""Town names for the light-pollution map (docs/data/towns.txt).

Source: GeoNames cities500 (all places with population > 500), https://download.geonames.org/export/dump/cities500.zip,
CC BY 4.0 (credited in the app's About). Input is cities500.txt, or the same rows already cut to the map's area as
name|lat|lon|population|country|admin1|featurecode (that is how the Nov 2026 copy was taken, in a browser).
Output, largest first, one place per line: name|lat×1000|lon×1000|population|region (ON, QC, MI, NY ...).
Usage: python3 build.py INPUT docs/data/towns.txt
"""
import sys
CA = {'01': 'AB', '02': 'BC', '03': 'MB', '04': 'NB', '05': 'NL', '07': 'NS', '08': 'ON', '09': 'PE', '10': 'QC', '11': 'SK', '12': 'YT', '13': 'NT', '14': 'NU'}
N, S, W, E = 50.5, 29.5, -100.5, -69.5           # the light-pollution map's area, with a little margin

def rows(path):
    for line in open(path, encoding='utf-8'):
        f = line.rstrip('\n').split('\t' if '\t' in line else '|')
        if len(f) >= 15:                         # cities500.txt
            yield f[1], float(f[4]), float(f[5]), int(f[14] or 0), f[8], f[10], f[7]
        elif len(f) >= 7:
            yield f[0], float(f[1]), float(f[2]), int(f[3] or 0), f[4], f[5], f[6]

out = []
SKIP = {'PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLS'}  # parts of towns (neighbourhoods), historical, abandoned, destroyed, groups
for name, lat, lon, pop, cc, a1, fc in rows(sys.argv[1]):
    if fc in SKIP: continue
    if not (S <= lat <= N and W <= lon <= E) or pop < 500 or cc not in ('CA', 'US'): continue
    out.append((pop, name.replace('|', ' '), round(lat * 1000), round(lon * 1000), CA.get(a1, a1) if cc == 'CA' else a1))
out.sort(key=lambda r: -r[0])
with open(sys.argv[2], 'w', encoding='utf-8') as f:
    f.write('\n'.join(f'{n}|{la}|{lo}|{p}|{r}' for p, n, la, lo, r in out) + '\n')
print(f'{len(out)} places → {sys.argv[2]}')
