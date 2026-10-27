// Cut Log service worker: app shell cached for offline use, fonts cached at runtime.
// V is bumped on every release (scripts/bump.sh), together with the ?v= on each file in index.html,
// so a new page can never run with an old script.
const V = '23';
const VERSION = 'cutlog-v' + V;
const SHELL = [
  './', './index.html', './manifest.webmanifest', './vendor/fflate.min.js', './health-import-worker.js',
  ...['config.js', 'store.js', 'food/foods.js', 'health.js', 'body.js', 'app.js'].map(f => './' + f + '?v=' + V),
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('cutlog-v') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never cache Supabase API traffic.
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;
  // The food model (Hugging Face) keeps its own cache; leave those downloads alone.
  if (/(^|\.)(huggingface\.co|hf\.co|xethub\.hf\.co)$/.test(url.hostname) || url.hostname.includes('cdn-lfs')) return;
  // The model runtime from jsDelivr is versioned and large: keep it in a cache that survives app updates.
  if (url.hostname === 'cdn.jsdelivr.net' && /@huggingface\/transformers@|onnxruntime/.test(url.pathname)) {
    e.respondWith(caches.open('ml-assets').then(c => c.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }))));
    return;
  }

  // Pages: network first so updates arrive, cache as fallback offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put('./index.html', copy)); return r; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  // The app's own files: network first (always the version that matches the page), cache when offline.
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return r; })
      .catch(() => caches.match(req).then(hit => hit || caches.match(req, { ignoreSearch: true }))));
    return;
  }
  // Versioned libraries and fonts: cache first, then network (and remember it).
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok && (url.hostname.includes('fonts.g') || url.hostname === 'cdn.jsdelivr.net')) {
      const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy));
    }
    return r;
  })));
});

// Push notifications (sent by the scheduled GitHub Action once Supabase is connected).
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Cut Log', { body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: d.url || './#log' }, tag: d.tag || undefined }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) { if ('focus' in c) { c.navigate(e.notification.data.url); return c.focus(); } }
    return self.clients.openWindow(e.notification.data.url);
  }));
});
