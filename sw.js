/* Kept service worker: offline app shell + cached OCR engine files. */
const VERSION = 'kept-20261021130434';
const SHELL = ['./', './index.html', './styles.css', './core.js', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './cancel-directory.js', './statement.js', './config.js', './demo-bank.js', './bank.js', './oauth.html', './samples/sample-statement.csv'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'kept-ocr').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // network-first so updates show up, fall back to cache when offline
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
  } else if (/jsdelivr|tessdata|unpkg/.test(url.host)) {
    e.respondWith(caches.open('kept-ocr').then(c => c.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }))));
  }
});
