// Service worker : rend l'application utilisable hors ligne.
//
// Le reseau passe avant le cache pour les fichiers de l'application. C'est un
// peu moins rapide au demarrage, mais ca rend impossible le scenario ou un
// telephone reste bloque sur une ancienne version : on ne peut rien reparer a
// distance, donc mieux vaut ne jamais servir de code perime tant qu'il y a du
// reseau. Le cache reste la reserve hors ligne.

const CACHE = 'bibliotech-v2';

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

  // Application : le reseau d'abord, le cache en secours hors ligne.
  evt.respondWith(
    fetch(requete)
      .then((reponse) => {
        if (reponse.ok) {
          const copie = reponse.clone();
          caches.open(CACHE).then((cache) => cache.put(requete, copie));
        }
        return reponse;
      })
      .catch(async () => {
        const cache = await caches.match(requete);
        if (cache) return cache;
        if (requete.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }),
  );
});
