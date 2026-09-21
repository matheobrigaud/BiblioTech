// Couche IndexedDB, sans dependance externe.
//
// Les donnees vivent uniquement sur l'appareil de l'utilisateur : on ne peut
// donc rien reparer a distance. Chaque evolution du schema DOIT passer par une
// migration ajoutee ci-dessous, jamais par une modification d'une migration
// deja publiee.

const DB_NOM = 'bibliotech';
const DB_VERSION = 1;

const MIGRATIONS = [
  // v1 : schema initial
  (db) => {
    const livres = db.createObjectStore('books', { keyPath: 'id' });
    livres.createIndex('isbn13', 'isbn13', { unique: false });
    livres.createIndex('title', 'title', { unique: false });

    const exemplaires = db.createObjectStore('copies', { keyPath: 'id' });
    exemplaires.createIndex('bookId', 'bookId', { unique: false });
    exemplaires.createIndex('status', 'status', { unique: false });

    const lectures = db.createObjectStore('readings', { keyPath: 'id' });
    lectures.createIndex('bookId', 'bookId', { unique: false });
    lectures.createIndex('finishedAt', 'finishedAt', { unique: false });
    lectures.createIndex('kind', 'kind', { unique: false });
  },
];

let instance = null;

export function ouvrir() {
  if (instance) return instance;
  instance = new Promise((resolve, reject) => {
    const requete = indexedDB.open(DB_NOM, DB_VERSION);
    requete.onupgradeneeded = (evt) => {
      const db = requete.result;
      for (let v = evt.oldVersion; v < evt.newVersion; v++) {
        MIGRATIONS[v](db, requete.transaction);
      }
    };
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
    requete.onblocked = () =>
      reject(new Error('Une autre fenêtre de BiblioTech empêche la mise à jour.'));
  });
  return instance;
}

async function transaction(stores, mode, action) {
  const db = await ouvrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let resultat;
    tx.oncomplete = () => resolve(resultat);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    Promise.resolve(action(tx))
      .then((r) => {
        resultat = r;
      })
      .catch((err) => {
        try {
          tx.abort();
        } catch {
          /* la transaction est deja terminee */
        }
        reject(err);
      });
  });
}

const promesse = (requete) =>
  new Promise((resolve, reject) => {
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });

export const tout = (store) =>
  transaction([store], 'readonly', (tx) => promesse(tx.objectStore(store).getAll()));

export const lire = (store, id) =>
  transaction([store], 'readonly', (tx) => promesse(tx.objectStore(store).get(id)));

export const parIndex = (store, index, valeur) =>
  transaction([store], 'readonly', (tx) =>
    promesse(tx.objectStore(store).index(index).getAll(valeur)),
  );

export const enregistrer = (store, objet) =>
  transaction([store], 'readwrite', (tx) =>
    promesse(tx.objectStore(store).put(objet)).then(() => objet),
  );

export const supprimer = (store, id) =>
  transaction([store], 'readwrite', (tx) => promesse(tx.objectStore(store).delete(id)));

/** Ecrit un livre, son exemplaire et sa lecture d'un seul tenant. */
export const enregistrerEnsemble = ({ book, copy, reading }) =>
  transaction(['books', 'copies', 'readings'], 'readwrite', async (tx) => {
    if (book) await promesse(tx.objectStore('books').put(book));
    if (copy) await promesse(tx.objectStore('copies').put(copy));
    if (reading) await promesse(tx.objectStore('readings').put(reading));
  });

/** Supprime un livre et tout ce qui s'y rattache. */
export const supprimerLivre = (bookId) =>
  transaction(['books', 'copies', 'readings'], 'readwrite', async (tx) => {
    await promesse(tx.objectStore('books').delete(bookId));
    for (const store of ['copies', 'readings']) {
      const lies = await promesse(tx.objectStore(store).index('bookId').getAll(bookId));
      for (const item of lies) await promesse(tx.objectStore(store).delete(item.id));
    }
  });

// --- Sauvegarde ---------------------------------------------------------
// Les donnees n'existent qu'ici. L'export n'est pas un confort, c'est le
// seul filet de securite de l'utilisateur.

export async function exporter() {
  const [books, copies, readings] = await Promise.all([
    tout('books'),
    tout('copies'),
    tout('readings'),
  ]);
  return {
    format: 'bibliotech',
    version: DB_VERSION,
    exporteLe: new Date().toISOString(),
    books,
    copies,
    readings,
  };
}

export async function importer(donnees, { remplacer = false } = {}) {
  if (donnees?.format !== 'bibliotech') {
    throw new Error("Ce fichier n'est pas une sauvegarde BiblioTech.");
  }
  return transaction(['books', 'copies', 'readings'], 'readwrite', async (tx) => {
    for (const store of ['books', 'copies', 'readings']) {
      const objectStore = tx.objectStore(store);
      if (remplacer) await promesse(objectStore.clear());
      for (const item of donnees[store] ?? []) await promesse(objectStore.put(item));
    }
  });
}
