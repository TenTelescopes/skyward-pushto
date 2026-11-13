"""Build the app's offline catalog (docs/data/catalog.js) from source files.
Sources (see ATTRIBUTION in the app):
  OpenNGC (CC-BY-SA-4.0)            positions, mags, sizes, types, Messier IDs
  PiFinder astro_data (GPL-3.0 repo) object lists: Caldwell, Herschel 400, RASC doubles, bright stars
"""
import csv, json, re, sys, os
D = sys.argv[1]; OUT = sys.argv[2]
ONGC = f"{D}/OpenNGC/database_files"; PF = f"{D}/PiFinder/astro_data"

def hms(s):
    h, m, sec = s.split(':'); return 15 * (int(h) + int(m) / 60 + float(sec) / 3600)
def dms(s):
    sg = -1 if s.startswith('-') else 1; d, m, sec = s.lstrip('+-').split(':')
    return sg * (int(d) + int(m) / 60 + float(sec) / 3600)
def f(x):
    try: return float(x)
    except: return None

rows = {}
for fn in ('NGC.csv', 'addendum.csv'):
    with open(f"{ONGC}/{fn}", newline='') as fh:
        for r in csv.DictReader(fh, delimiter=';'):
            rows[r['Name']] = r

def resolve(name):
    r = rows.get(name)
    hops = 0
    while r and r['Type'] == 'Dup' and hops < 3:
        tgt = ('NGC%04d' % int(r['NGC'])) if r['NGC'] else ('IC%04d' % int(r['IC'])) if r['IC'] else None
        r = rows.get(tgt); hops += 1
    return r

TYPES = {'*':'Star','**':'Double star','*Ass':'Asterism','OCl':'Open cluster','GCl':'Globular cluster','Cl+N':'Cluster + nebula',
 'G':'Galaxy','GPair':'Galaxy pair','GTrpl':'Galaxy triplet','GGroup':'Galaxy group','PN':'Planetary nebula','HII':'Emission nebula',
 'DrkN':'Dark nebula','EmN':'Emission nebula','Neb':'Nebula','RfN':'Reflection nebula','SNR':'Supernova remnant','Nova':'Nova','NonEx':'Nonexistent','Other':'Other'}
TCODE = {'Open cluster':'OC','Globular cluster':'GC','Cluster + nebula':'CN','Galaxy':'GX','Galaxy pair':'GX','Galaxy triplet':'GX','Galaxy group':'GX',
 'Planetary nebula':'PN','Emission nebula':'NB','Reflection nebula':'NB','Nebula':'NB','Dark nebula':'DN','Supernova remnant':'NB','Asterism':'AS','Double star':'DS','Star':'ST'}

def pretty(name):
    m = re.match(r'([A-Za-z]+)(\d+)(.*)', name)
    if not m: return name
    pre = {'C': 'Caldwell', 'Mel': 'Mel', 'M': 'M'}.get(m.group(1), m.group(1))
    return f"{pre}{'' if pre=='M' else ' '}{int(m.group(2))}{m.group(3)}"

objs = {}  # key -> dict
def add_ongc(r, key=None):
    key = key or r['Name']
    if key in objs: return objs[key]
    t = TYPES.get(r['Type'], r['Type'])
    mag = f(r['V-Mag']) if f(r['V-Mag']) is not None else f(r['B-Mag'])
    o = dict(id=pretty(r['Name']), ra=round(hms(r['RA']),4), dec=round(dms(r['Dec']),4), t=TCODE.get(t,'OT'), type=t,
             con=r['Const'], mag=mag, sb=f(r['SurfBr']), maj=f(r['MajAx']), min=f(r['MinAx']), pa=f(r['PosAng']),
             name=(r['Common names'].split(',')[0] if r['Common names'] else ''), cats=[])
    objs[key] = o; return o

missing = []
# Messier
for r in list(rows.values()):
    if r['M'] and r['Type'] != 'Dup':
        o = add_ongc(r); m = int(r['M']); o['m'] = m
        if f'M{m}' not in o['cats']: o['cats'].append(f'M{m}')
# NGC Dup entries that carry an M number (e.g. M102 debates) -> resolve
mset = {o['m'] for o in objs.values() if 'm' in o}
for r in rows.values():
    if r['M'] and int(r['M']) not in mset:
        rr = resolve(r['Name'])
        if rr: o = add_ongc(rr); o['m'] = int(r['M']); o['cats'].append('M%d' % int(r['M'])); mset.add(int(r['M']))
if 102 not in mset:  # M102 is disputed; most modern lists use NGC 5866
    o = add_ongc(resolve('NGC5866')); o['m'] = 102; o['cats'].append('M102'); o['mnote'] = 'M102 identity is disputed; NGC 5866 is the usual choice.'; mset.add(102)
print('Messier found', len(mset), 'missing', sorted(set(range(1,111)) - mset))

# Caldwell
cald = 0
with open(f"{PF}/caldwell.dat") as fh:
    for line in fh:
        p = line.rstrip('\n').split('\t')
        if len(p) < 11: continue
        n = int(p[0]); nm = p[1].strip(); key = None
        mm = re.match(r'(NGC|IC)\s*(\d+)', nm)
        r = None
        if mm: r = resolve(f"{mm.group(1)}{int(mm.group(2)):04d}")
        if not r: r = rows.get('C%03d' % n)
        if r: o = add_ongc(r)
        else:
            ra = 15*(float(p[6]) + float(p[7])/60); dec = (1 if p[8].strip()=='+' else -1)*(float(p[9]) + float(p[10])/60)
            o = objs.setdefault('C%03d' % n, dict(id=nm, ra=round(ra,4), dec=round(dec,4), t=TCODE.get(p[2],'OT'), type=p[2], con=p[3],
                     mag=f(p[4]), sb=None, maj=None, min=None, name='', cats=[], src='caldwell.dat'))
            missing.append((n, nm))
        o['cats'].append(f'C{n}'); cald += 1
        if o.get('mag') is None and f(p[4]) is not None: o['mag'] = f(p[4])
        m2 = re.match(r'NGC\s*\d+/(\d+)', nm)   # e.g. C14 = NGC 869/884 (Double Cluster)
        if m2:
            r2 = resolve('NGC%04d' % int(m2.group(1)))
            if r2: add_ongc(r2)['cats'].append(f'C{n}')
print('Caldwell', cald, 'non-OpenNGC:', missing)

# Herschel 400
h = 0; hmiss = []
with open(f"{PF}/herschel400.tsv", newline='') as fh:
    for r0 in csv.DictReader(fh, delimiter='\t'):
        r = resolve('NGC%04d' % int(r0['NGC_#']))
        if not r: hmiss.append(r0['NGC_#']); continue
        o = add_ongc(r); o['cats'].append('H400'); h += 1  # prose notes deliberately not copied (third-party text)
print('H400', h, 'missing', hmiss)

out = [o for o in objs.values()]
for o in out:
    o['cats'] = sorted(set(o['cats']), key=lambda c: (c[0] != 'M', c[0] != 'C', len(c), c))
    for k in [k for k, v in o.items() if v in (None, '', [])]: del o[k]

# RASC doubles
dbl = []
with open(f"{PF}/RASC_DoubleStars/rasc_double_stars.csv", newline='') as fh:
    for r in csv.DictReader(fh, delimiter='\t'):
        rh, rm = r['RA2000'].split(); dd, dm = r['Dec2000'].split()
        dec = (-1 if dd.startswith('-') else 1) * (abs(int(dd)) + int(dm)/60)
        mags = [x for x in json.loads(r['Mag'])] if r['Mag'].startswith('[') else []
        note = r['Notes'].split('<NEWLINE>')
        o = dict(id=r['Target'], ra=round(15*(int(rh)+float(rm)/60),4), dec=round(dec,4), t='DS', type='Double star', con=r['Con'],
                 mag=mags[0] if mags else None, sep=f(r['MaxSepSec']), wds=r['WDS'].strip(), alt=r['AlternateID'],
                 cats=['RASC DS'], pairs=[dict(c=m.group(1), pa=int(m.group(2)), sep=float(m.group(3)), mags=m.group(4))
                  for m in re.finditer(r'(\w+)\([^)]*\) PA:(\d+) Sep:([\d.]+)<SECS> M:([\d./]+)', r['Notes'])])
        dbl.append({k:v for k,v in o.items() if v not in (None,'',[])})
print('RASC doubles', len(dbl))

# Alignment stars
stars = []
with open(f"{PF}/bright_stars.csv", newline='') as fh:
    for r in csv.DictReader(fh):
        dd = r['Dec Deg'].strip(); sg = -1 if dd.startswith('-') else 1
        stars.append(dict(id=r['NamedStar'], bayer=r['LatinDesignation'], ra=round(15*(int(r['RA Hr'])+float(r['RA Min'])/60),4),
                          dec=round(sg*(abs(int(dd))+float(r['Dec Min'])/60),4), mag=f(r['Magnitude']), con=r['Const'], t='ST'))
print('stars', len(stars))

# Naked-eye star field (Hipparcos, ESA 1997) + constellation stick figures (Stellarium 'modern' via PiFinder)
lines = []
with open(f"{PF}/constellationship.fab") as fh:
    for ln in fh:
        p = ln.split()
        if len(p) < 3: continue
        hips = [int(x) for x in p[2:]]; lines.append((p[0], hips))
need = {h for _, hs in lines for h in hs}
hip = {}
MAGLIM = 8.0
with open(f"{PF}/hip_main.dat") as fh:
    for ln in fh:
        f_ = ln.split('|')
        try: n = int(f_[1]); vm = float(f_[5]); ra = float(f_[8]); de = float(f_[9])
        except ValueError: continue
        if vm > MAGLIM and n not in need: continue
        try: pmra = float(f_[12]); pmde = float(f_[13])
        except ValueError: pmra = pmde = 0.0
        dt = 2000.0 - 1991.25   # propagate catalogue epoch J1991.25 -> J2000 (pmRA already includes cos dec)
        import math
        de2 = de + pmde * dt / 3.6e6; ra2 = ra + pmra * dt / 3.6e6 / max(1e-6, math.cos(math.radians(de)))
        hip[n] = (round(ra2 % 360, 3), round(de2, 3), round(vm, 1))
order = sorted(hip, key=lambda n: hip[n][2]); idx = {n: i for i, n in enumerate(order)}
flat = []
for n in order: flat += list(hip[n])
LINES = []
miss = 0
for con, hs in lines:
    seg = []
    for a, b in zip(hs[0::2], hs[1::2]):
        if a in idx and b in idx: seg += [idx[a], idx[b]]
        else: miss += 1
    LINES.append([con, seg])
print('field stars', len(order), 'constellations', len(LINES), 'missing segments', miss)

# Named asterisms (Saguaro Astronomy Club asterism list v3.2): name, position, size, magnitude only
ast = []
def sacsize(sz):
    m = re.match(r"\s*([\d.]+)\s*(d|')?", sz or '')
    if not m: return None
    v = float(m.group(1)); return v * 60 if m.group(2) == 'd' else v
with open(f"{PF}/SAC_Asterisms_Ver32_Fence.txt") as fh:
    for ln in fh:
        c = [x.strip() for x in ln.split('|')]
        if len(c) < 8 or not c[3] or c[1] == 'Name' or not re.match(r'\d', c[3]): continue
        rh, rm = c[3].split(); dd, dm = c[4].split(); sg = -1 if dd.startswith('-') else 1
        o = dict(id=c[1], ra=round(15 * (int(rh) + float(rm) / 60), 4), dec=round(sg * (abs(int(dd)) + int(dm) / 60), 4),
                 t='AS', type='Asterism', con=c[2].title()[:3], mag=f(c[5]), maj=sacsize(c[6]), cats=['Asterism'])
        ast.append({k: v for k, v in o.items() if v not in (None, '', [])})
print('asterisms', len(ast))

js = '// Generated by tools/build_catalog.py — do not edit by hand.\n// Sources: OpenNGC (CC-BY-SA-4.0); object lists, Hipparcos extract, constellation lines and SAC asterisms via PiFinder astro_data.\n'
js += 'export const DSO = ' + json.dumps(out, separators=(',',':')) + ';\n'
js += 'export const DOUBLES = ' + json.dumps(dbl, separators=(',',':')) + ';\n'
js += 'export const STARS = ' + json.dumps(stars, separators=(',',':')) + ';\n'
js += '// Field stars: flat [raDeg, decDeg, Vmag, ...] (J2000), brightest first. Hipparcos main catalogue (ESA 1997).\n'
js += 'export const FIELD = ' + json.dumps(flat, separators=(',',':')) + ';\n'
js += '// Constellation lines as index pairs into FIELD (Stellarium modern sky culture, via PiFinder).\n'
js += 'export const LINES = ' + json.dumps(LINES, separators=(',',':')) + ';\n'
js += '// Named asterisms: Saguaro Astronomy Club asterism list v3.2 (no descriptive text).\n'
js += 'export const ASTERISMS = ' + json.dumps(ast, separators=(',',':')) + ';\n'
os.makedirs(os.path.dirname(OUT), exist_ok=True); open(OUT,'w').write(js)
print('DSO total', len(out), 'bytes', len(js))
