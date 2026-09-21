// Vocabulaire et structures du domaine.
// Trois entites distinctes : Book (l'edition), Copy (mon exemplaire), Reading (une lecture).

export const STATUTS = {
  souhaite: { label: 'Souhaité', ordre: 0 },
  a_lire: { label: 'À lire', ordre: 1 },
  en_cours: { label: 'En cours', ordre: 2 },
  lu: { label: 'Lu', ordre: 3 },
  abandonne: { label: 'Abandonné', ordre: 4 },
  prete: { label: 'Prêté', ordre: 5 },
};

// Liste fermee : elle rend calculables les statistiques par genre.
// Les tags libres vivent a cote, dans Book.tags.
export const GENRES = [
  'Roman',
  'Policier / Thriller',
  'Science-fiction',
  'Fantasy',
  'Fantastique',
  'Horreur',
  'Romance',
  'Classique',
  'Poésie',
  'Théâtre',
  'BD / Comics',
  'Manga',
  'Jeunesse',
  'Biographie',
  'Histoire',
  'Sciences',
  'Philosophie',
  'Essai',
  'Art',
  'Voyage',
  'Autre',
];

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

const aujourdhui = () => new Date().toISOString().slice(0, 10);

/**
 * Une lecture suivie par l'application : les dates sont relevees
 * automatiquement, l'utilisateur n'en saisit jamais.
 */
export function lectureSuivie(bookId) {
  return {
    id: uid(),
    bookId,
    kind: 'tracked',
    startedAt: aujourdhui(),
    finishedAt: null,
    abandonedAt: null,
    stoppedAtPage: null,
    timesRead: 1,
    rating: null,
    comment: '',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Une lecture anterieure a l'application. Aucune date n'est inventee :
 * l'absence de finishedAt l'exclut d'office des recapitulatifs mensuels.
 */
export function lectureHistorique(bookId, { timesRead = 1, rating = null, comment = '' } = {}) {
  return {
    id: uid(),
    bookId,
    kind: 'historical',
    startedAt: null,
    finishedAt: null,
    abandonedAt: null,
    stoppedAtPage: null,
    timesRead,
    rating,
    comment,
    createdAt: new Date().toISOString(),
  };
}

export function nouvelExemplaire(bookId, statut = 'a_lire') {
  return {
    id: uid(),
    bookId,
    status: statut,
    location: '',
    acquiredAt: null,
    lentTo: null,
    lentAt: null,
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function nouveauLivre(champs = {}) {
  return {
    id: uid(),
    isbn13: null,
    isbn10: null,
    title: '',
    subtitle: '',
    authors: [],
    publisher: '',
    publishedYear: null,
    pageCount: null,
    language: 'fr',
    coverUrl: null,
    genres: [],
    tags: [],
    source: 'manuel',
    createdAt: new Date().toISOString(),
    ...champs,
  };
}

export const terminerLecture = (lecture) => ({
  ...lecture,
  finishedAt: aujourdhui(),
});

export const abandonnerLecture = (lecture, page = null) => ({
  ...lecture,
  abandonedAt: aujourdhui(),
  stoppedAtPage: page,
});
