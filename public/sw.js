/* vamshidharm service worker — v2 (live dashboard) */
const CACHE = 'vamshidharm-v2';
const CORE = [
  '/',
  '/about.html',
  '/blog.html',
  '/contact.html',
  '/experience.html',
  '/faq.html',
  '/projects.html',
  '/skills.html',
  '/resume.html',
  '/manifest.webmanifest',
  '/og.png',
  '/llms.txt',
  '/robots.txt',
  '/sitemap.xml'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const url = new URL(e.request.url);
  // never cache API or cross-origin
  if (url.origin !== location.origin) return;
  if (url.pathname.indexOf('/api/') === 0) return;

  // navigation requests: network-first, fall back to cache (offline)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () {
        return caches.match(e.request).then(function (hit) {
          return hit || caches.match('/');
        });
      })
    );
    return;
  }

  // static assets: cache-first with background update
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (res) {
        if (res.ok && (res.type === 'basic')) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      });
    })
  );
});
