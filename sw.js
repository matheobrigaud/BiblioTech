// Service worker : rend l'application utilisable hors ligne.
//
// Incrementer CACHE a chaque deploiement, sinon les telephones restent
// bloques sur l'ancienne version.

const CACHE = 'bibliotech-v1';

const COQUILLE = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/app.js',
  './src/db.js',
  './src/model.js',
  './src/isbn.js',
  './src/metadata.js',
  './src/scanner.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(COQUILLE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evt) => {
  const requete = evt.request;
  if (requete.method !== 'GET') return;

  const url = new URL(requete.url);

  // Catalogues et couvertures : le reseau d'abord, le cache en secours.
  if (url.origin !== self.location.origin) {
    evt.respondWith(
      fetch(requete)
        .then((reponse) => {
          if (reponse.ok && url.pathname.match(/\.(jpe?g|png|webp)$/i)) {
            const copie = reponse.clone();
            caches.open(CACHE).then((cache) => cache.put(requete, copie));
          }
          return reponse;
        })
        .catch(() => caches.match(requete)),
    );
    return;
  }

  // Application : le cache d'abord, pour un demarrage instantane hors ligne.
  evt.respondWith(
    caches.match(requete).then(
      (cache) =>
        cache ??
        fetch(requete).catch(() =>
          requete.mode === 'navigate' ? caches.match('./index.html') : Response.error(),
        ),
    ),
  );
});
