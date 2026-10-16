/* TCA Tours — Holmfirth NYC tour app service worker (v7)
   1. Offline: keeps a copy of the app, the itinerary and the fonts/icons so the app opens with no signal
      (e.g. underground on the subway). Pages and data are "network first": with signal you always get the
      latest; without it you get the last saved copy.
   2. Push: shows staff alerts as phone notifications, even when the app is closed.
   Staff-only data (requests carrying the staff password) is never stored here. */
var VERSION = 'hny-v8';
var SHELL = ['./', 'index.html', 'manifest.json', 'js/tour-default.js', 'js/expenses.js',
  'img/tca-logo-horizontal-white.png', 'img/icon-192.png', 'img/icon-512.png', 'img/favicon-64.png', 'img/apple-touch-icon.png'];
var CDN = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)\//;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(req, cacheKey) {
  return fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(cacheKey || req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(cacheKey || req, { ignoreSearch: false }).then(function (hit) {
      return hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error());
    });
  });
}
function cacheFirst(req) {
  return caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res && (res.ok || res.type === 'opaque')) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
      return res;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;                                  // posts go straight to the network
  if (req.headers.has('x-staff-key')) return;                        // never store staff-only data
  if (CDN.test(req.url)) { e.respondWith(cacheFirst(req)); return; } // fonts and icons
  if (url.origin !== self.location.origin) return;                   // weather etc: live only
  if (url.pathname.indexOf('/admin') === 0 || url.pathname.indexOf('/vendor/') === 0) return;
  if (url.pathname === '/.netlify/functions/tour') {
    var t = url.searchParams.get('type') || '';
    if (t === '' || t === 'alerts' || t === 'subway') { e.respondWith(networkFirst(req)); }
    return;
  }
  e.respondWith(networkFirst(req, req.mode === 'navigate' ? 'index.html' : req));
});

/* ---------- push notifications ---------- */
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'New alert', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Holmfirth NYC — new alert', {
    body: d.body || 'Open the app to read it.',
    icon: 'img/icon-192.png',
    badge: 'img/favicon-64.png',
    tag: d.id || 'alert',
    renotify: true,
    data: { url: './' }
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) { if ('focus' in cs[i]) return cs[i].focus(); }
    return self.clients.openWindow('./');
  }));
});
