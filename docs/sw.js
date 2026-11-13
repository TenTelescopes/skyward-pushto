// Offline cache for the browser/PWA build. The native (Capacitor) apps ship these files inside the app instead.
const CACHE = 'skyward-pushto-v7';
const FILES = ['./', 'index.html', 'css/app.css', 'js/main.js', 'js/model.js', 'js/astro.js', 'js/sensors.js', 'js/tests.js', 'js/check.js', 'js/assist.js', 'js/dome.js', 'js/locate.js', 'data/bounds.js', 'js/game.js', 'js/wixscores.js', 'vendor/qrcode.mjs', 'vendor/jsQR.js',
  'data/catalog.js', 'vendor/astronomy.mjs', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request))));
