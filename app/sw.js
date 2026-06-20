// Service worker de DeadBall Manager PRO.
// - Cachea el "shell" de la app (para abrir sin conexión).
// - Cachea las imágenes remotas (escudos/fotos) tras la primera carga -> offline.
const CACHE = 'dbm-pro-v30';
const IMG_CACHE = 'dbm-pro-img-v1';
const SHELL = [
  'index.html',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'react.production.min.js',
  'react-dom.production.min.js',
  'dexie.min.js',
  'firebase-app-compat.js',
  'firebase-auth-compat.js',
  'firebase-firestore-compat.js',
  'bc-400.woff2',
  'bc-600.woff2',
  'bc-700.woff2',
  'jbm-500.woff2',
  'jbm-700.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== IMG_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isImage(req) {
  if (req.destination === 'image') return true;
  return /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(req.url);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Analítica (PostHog): dejar pasar sin interceptar ni cachear.
  if (/posthog\.com/i.test(req.url)) return;

  // Imágenes (incluidas las remotas de jugadores/escudos): cache-first.
  // Se sirven al instante desde caché y, si no están, se descargan y se guardan.
  if (isImage(req)) {
    e.respondWith(
      caches.open(IMG_CACHE).then((c) =>
        c.match(req).then((hit) => {
          if (hit) return hit;
          return fetch(req).then((res) => {
            // Guarda copia (también respuestas opaque de otros dominios).
            if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
            return res;
          }).catch(() => hit);
        })
      )
    );
    return;
  }

  // Resto (shell, scripts): red primero con respaldo en caché.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
  );
});
