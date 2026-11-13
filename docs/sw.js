// Offline cache for the browser/PWA build. The native (Capacitor) apps ship these files inside the app instead.
const CACHE = 'skyward-pushto-v23';
const FILES = ['./', 'index.html', 'css/app.css', 'js/main.js', 'js/model.js', 'js/astro.js', 'js/sensors.js', 'js/tests.js', 'js/check.js', 'js/assist.js', 'js/eyeview.js', 'js/theme.js', 'js/plan.js', 'js/vis.js', 'js/dome.js', 'js/locate.js', 'data/bounds.js', 'js/game.js', 'js/wixscores.js', 'vendor/qrcode.mjs', 'vendor/jsQR.js',
  'data/catalog.js', 'vendor/astronomy.mjs', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
// cache:'reload' bypasses the browser's HTTP cache, so a new version is never filled with stale files.
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
// Network first: with signal you always get the newest version; offline (or after 3 s of weak signal) the saved copy.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;   // Wix API calls etc. go straight to the network
  e.respondWith((async () => {
    const cached = () => caches.match(e.request, { ignoreSearch: true });
    try {
      const net = fetch(e.request, { cache: 'no-cache' });
      const timeout = new Promise((_, no) => setTimeout(() => no(new Error('slow')), 3000));
      const r = await Promise.race([net, timeout]);
      if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }
      return (await cached()) || r;
    } catch (err) { return (await cached()) || Response.error(); }
  })());
});
