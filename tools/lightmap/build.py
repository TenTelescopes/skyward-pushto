#!/usr/bin/env python3
"""Build the app's light-pollution map (docs/data/skyglow.bin) from NASA Black Marble yearly night lights.

Input: VNP46A4 tiles (HDF5, 10° × 10°, 2400 × 2400 cells of 15 arc-seconds, tile hXXvYY covers longitudes
-180 + 10·XX to +10° and latitudes 90 - 10·YY down 10°). Downloaded by hand from NASA LAADS (free Earthdata login).

Method (an estimate, good enough to tell city / suburban / rural / dark skies apart):
 1. Upward radiance (snow-free, all angles composite) is summed into 0.025° cells (light per cell = radiance × area).
 2. Sky glow at each place = Σ light × (d² + 5²)^-1.25 × exp(-d / 150 km) over sources within 250 km (Walker's law,
    levelled off within a few km, with a gentle extinction term).
 3. Sky brightness: SQM = NATURAL - 2.5·log10(1 + glow / G0), with G0 fitted to places of known brightness
    (anchors.json). With no glow the sky is the natural ~21.9 mag/arcsec².
 4. Written on a 0.05° grid (about 5 km), one byte per cell; see docs/js/skyglow.js for the format.

Needs: python3 with numpy and scipy, and h5py to read the tiles.
Usage: python3 build.py TILE_DIR OUT.bin [--anchors anchors.json]      |  python3 build.py --selftest
"""
import json, math, os, re, struct, sys
import numpy as np

NATURAL = 21.9            # natural zenith sky brightness, mag/arcsec² (typical dark site, no Moon)
SRC_DEG = 0.025           # source cell size, degrees (6 × 6 Black Marble cells)
OUT_DEG = 0.05            # output cell size, degrees
RMAX_KM = 250.0
EXT_KM = 150.0
D0_KM = 5.0              # softening distance
KM_PER_DEG = 111.195


def read_tile(path):
    """Radiance (nW·cm⁻²·sr⁻¹) of one tile as a 2400 × 2400 float array, 0 where there is no data."""
    import h5py
    with h5py.File(path, 'r') as f:
        found = []
        f.visititems(lambda n, o: found.append(n) if isinstance(o, h5py.Dataset) and 'AllAngle_Composite_Snow_Free' in n
                     and 'Num' not in n and 'Std' not in n and 'Quality' not in n else None)
        if not found:
            names = []; f.visititems(lambda n, o: names.append(n) if isinstance(o, h5py.Dataset) else None)
            raise SystemExit(f'{path}: no AllAngle_Composite_Snow_Free layer. Layers: {names}')
        d = f[found[0]]
        a = d[()].astype(np.float64)
        fill = d.attrs.get('_FillValue'); scale = d.attrs.get('scale_factor', 1.0); off = d.attrs.get('add_offset', 0.0)
        fill = None if fill is None else float(np.array(fill).ravel()[0])
        bad = ~np.isfinite(a) | ((a == fill) if fill is not None else False)
        a = a * float(np.array(scale).ravel()[0]) + float(np.array(off).ravel()[0])
        a[bad | (a < 0)] = 0.0
        return a


def mosaic(tile_dir):
    files = [f for f in os.listdir(tile_dir) if re.search(r'VNP46A4\..*\.h(\d\d)v(\d\d)\..*\.h5$', f)]
    if not files: raise SystemExit(f'No VNP46A4 .h5 tiles in {tile_dir}')
    tiles = {}
    for f in files:
        h, v = map(int, re.search(r'\.h(\d\d)v(\d\d)\.', f).groups()); tiles[(h, v)] = os.path.join(tile_dir, f)
    hs, vs = sorted({h for h, _ in tiles}), sorted({v for _, v in tiles})
    k = int(round(SRC_DEG * 240))                                   # 15″ cells per source cell (6)
    n = 2400 // k
    grid = np.zeros((len(vs) * n, len(hs) * n))
    for (h, v), p in tiles.items():
        a = read_tile(p)
        b = a.reshape(n, k, n, k).mean(axis=(1, 3))
        grid[vs.index(v) * n:(vs.index(v) + 1) * n, hs.index(h) * n:(hs.index(h) + 1) * n] = b
        print(f'  read {os.path.basename(p)}: max {a.max():.0f}, mean {a.mean():.2f}')
    north, west = 90 - 10 * vs[0], -180 + 10 * hs[0]
    # Tiles that were not downloaded inside the rectangle stay dark (zero), which is right over oceans and wrong over land.
    missing = [(h, v) for h in range(hs[0], hs[-1] + 1) for v in range(vs[0], vs[-1] + 1) if (h, v) not in tiles]
    if missing: print('  note: no tile for', ', '.join(f'h{h:02d}v{v:02d}' for h, v in missing), '- treated as dark')
    return grid, north, west


def glow(rad, north, west):
    """Sky glow for every source cell (arbitrary units), by FFT convolution in latitude strips."""
    from scipy.signal import fftconvolve
    rows, cols = rad.shape
    out = np.zeros_like(rad)
    lat_c = north - (np.arange(rows) + 0.5) * SRC_DEG
    area = (SRC_DEG * KM_PER_DEG) ** 2 * np.cos(np.radians(lat_c))[:, None]       # km² per cell
    light = rad * area
    strip = int(round(2.5 / SRC_DEG))
    ry = int(math.ceil(RMAX_KM / (SRC_DEG * KM_PER_DEG)))
    for r0 in range(0, rows, strip):
        r1 = min(rows, r0 + strip); c = math.cos(math.radians(north - (r0 + r1) / 2 * SRC_DEG))
        rx = int(math.ceil(RMAX_KM / (SRC_DEG * KM_PER_DEG * c)))
        yy, xx = np.mgrid[-ry:ry + 1, -rx:rx + 1]
        d = np.hypot(yy * SRC_DEG * KM_PER_DEG, xx * SRC_DEG * KM_PER_DEG * c)
        de = np.sqrt(d ** 2 + D0_KM ** 2)            # Walker's law holds beyond ~10 km; nearer, the glow levels off
        ker = np.where(d <= RMAX_KM, de ** -2.5 * np.exp(-d / EXT_KM), 0.0)
        a0, a1 = max(0, r0 - ry), min(rows, r1 + ry)
        part = fftconvolve(light[a0:a1], ker, mode='same')
        out[r0:r1] = part[r0 - a0:r1 - a0]
    return np.maximum(out, 0)


def sample(arr, north, west, deg, lat, lon):
    y, x = int((north - lat) / deg), int((lon - west) / deg)
    if 0 <= y < arr.shape[0] and 0 <= x < arr.shape[1]: return float(arr[y, x])
    return None


def fit_g0(G, north, west, anchors):
    """G0 so that SQM matches the anchors (least squares in magnitudes, by a simple 1-D search)."""
    pts = [(a, sample(G, north, west, SRC_DEG, a['lat'], a['lon'])) for a in anchors]
    pts = [(a, g) for a, g in pts if g is not None and g > 0]
    if not pts: raise SystemExit('No anchor falls inside the map: add one in anchors.json')
    best = None
    for lg in np.linspace(-6, 8, 2801):
        g0 = 10 ** lg
        err = sum((NATURAL - 2.5 * math.log10(1 + g / g0) - a['sqm']) ** 2 for a, g in pts)
        if best is None or err < best[0]: best = (err, g0)
    g0 = best[1]
    for a, g in pts:
        print(f"  anchor {a['name']}: measured {a['sqm']:.2f}, model {NATURAL - 2.5 * math.log10(1 + g / g0):.2f}")
    return g0


def write_bin(path, sqm, north, west, year, source):
    rows, cols = sqm.shape
    q = np.clip(np.round((sqm - 16) * 40) + 1, 1, 255).astype(np.uint8)
    q[~np.isfinite(sqm)] = 0
    head = json.dumps({'north': north, 'west': west, 'dLat': OUT_DEG, 'dLon': OUT_DEG, 'rows': rows, 'cols': cols,
                       'year': year, 'source': source}, separators=(',', ':')).encode()
    with open(path, 'wb') as f:
        f.write(b'SKYG' + bytes([1]) + struct.pack('<I', len(head)) + head + q.tobytes())
    print(f'  wrote {path}: {rows} × {cols} cells, {os.path.getsize(path) / 1024:.0f} kB')


def build(rad, north, west, anchors, year, source, out):
    G = glow(rad, north, west)
    g0 = fit_g0(G, north, west, anchors)
    f = int(round(OUT_DEG / SRC_DEG))
    rows, cols = (G.shape[0] // f) * f, (G.shape[1] // f) * f
    Gc = G[:rows, :cols].reshape(rows // f, f, cols // f, f).mean(axis=(1, 3))
    sqm = NATURAL - 2.5 * np.log10(1 + Gc / g0)
    write_bin(out, sqm, north, west, year, source)
    return sqm


def selftest():
    """A made-up city of known brightness: the model must put the anchor right and fall off with distance."""
    rows, cols = 800, 800                                   # 20° × 20° at 0.025°
    rad = np.zeros((rows, cols)); rad[390:410, 390:410] = 60.0; rad[200:204, 600:604] = 20.0
    north, west = 50.0, -90.0
    city_lat, city_lon = north - 400 * SRC_DEG, west + 400 * SRC_DEG
    out = '/tmp/skyglow-selftest.bin'
    sqm = build(rad, north, west, [{'name': 'test city', 'lat': city_lat, 'lon': city_lon, 'sqm': 17.0}], 2024, 'selftest', out)
    s = lambda lat, lon: sqm[int((north - lat) / OUT_DEG), int((lon - west) / OUT_DEG)]
    c, a50, a150, far = s(city_lat, city_lon), s(city_lat, city_lon + 50 / (KM_PER_DEG * math.cos(math.radians(city_lat)))), \
        s(city_lat - 150 / KM_PER_DEG, city_lon), s(north - 0.2, west + 0.2)
    print(f'  city {c:.2f}, 50 km {a50:.2f}, 150 km {a150:.2f}, far corner {far:.2f}')
    assert abs(c - 17.0) < 0.3 and c < a50 < a150 <= far + 0.01 and far > 21.0, 'model does not behave'
    print('selftest passed')


if __name__ == '__main__':
    if '--selftest' in sys.argv: selftest(); sys.exit(0)
    if len(sys.argv) < 3: print(__doc__); sys.exit(1)
    tile_dir, out = sys.argv[1], sys.argv[2]
    anc = sys.argv[sys.argv.index('--anchors') + 1] if '--anchors' in sys.argv else os.path.join(os.path.dirname(__file__), 'anchors.json')
    anchors = json.load(open(anc))
    rad, north, west = mosaic(tile_dir)
    yr = re.search(r'VNP46A4\.A(\d{4})', ' '.join(os.listdir(tile_dir)))
    build(rad, north, west, anchors, int(yr.group(1)) if yr else None, 'NASA Black Marble VNP46A4 night lights, modelled sky glow', out)
