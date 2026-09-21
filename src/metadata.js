// Recuperation des metadonnees par ISBN.
//
// Ordre volontaire : Open Library (CC0, sans cle) d'abord, puis la BnF, bien
// meilleure sur le fonds francophone. La saisie manuelle reste toujours
// possible : beaucoup de livres anciens ou autoedites ne sont nulle part.

import { versIsbn13, versIsbn10 } from './isbn.js';

// Le catalogue de la BnF repond couramment en 3 secondes, parfois bien plus
// depuis un telephone. Sans plafond, l'ecran de recherche resterait fige sans
// que l'utilisateur puisse rien faire.
const DELAI_MAX = 8000;

/** Combine le delai maximal et l'annulation demandee par l'appelant. */
function fetchLimite(url, signal) {
  // Un signal deja declenche doit couper court : sans ce test, une annulation
  // survenue entre deux catalogues laisserait partir la requete suivante.
  if (signal?.aborted) return Promise.reject(signal.reason);

  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(new Error('Délai dépassé')), DELAI_MAX);
  const relais = () => controleur.abort(signal.reason);
  signal?.addEventListener('abort', relais, { once: true });

  return fetch(url, { signal: controleur.signal }).finally(() => {
    clearTimeout(minuteur);
    signal?.removeEventListener('abort', relais);
  });
}

const texte = (valeur) => (typeof valeur === 'string' ? valeur.trim() : '');
const entier = (valeur) => {
  const n = parseInt(valeur, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function depuisOpenLibrary(isbn13, signal) {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&format=json&jscmd=data`;
  const reponse = await fetchLimite(url, signal);
  if (!reponse.ok) return null;
  const fiche = (await reponse.json())[`ISBN:${isbn13}`];
  if (!fiche) return null;
  return {
    title: texte(fiche.title),
    subtitle: texte(fiche.subtitle),
    authors: (fiche.authors ?? []).map((a) => texte(a.name)).filter(Boolean),
    publisher: texte(fiche.publishers?.[0]?.name),
    publishedYear: entier(String(fiche.publish_date ?? '').match(/\d{4}/)?.[0]),
    pageCount: entier(fiche.number_of_pages),
    coverUrl: fiche.cover?.medium ?? null,
    source: 'openlibrary',
  };
}

// Les notices BnF sont en ISBD brut. Trois nettoyages sont necessaires avant
// de les montrer a quelqu'un ; l'ecran « Verifier la fiche » reste le filet de
// securite quand une heuristique se trompe.

const ROLES =
  'Auteur|Traducteur|Illustrateur|Éditeur|Editeur|Préfacier|Directeur|Compositeur|Photographe|Adaptateur|Narrateur|Annotateur|Collaborateur|Autre';

// Les dates de vie prennent des formes tres libres — "(1892-1973)",
// "(1963-....)", "(0551?-0478? av. J.-C.)" — qu'aucun motif chiffre precis ne
// couvre. On retire donc toute parenthese contenant un chiffre : dans une
// vedette d'autorite, il ne s'y trouve rien d'autre que des dates.
const sansDates = (texte) => texte.replace(/\s*\([^)]*\d[^)]*\)/g, '');

/** "Sun Tzu (0551?-0478? av. J.-C.). Auteur du texte" -> "Sun Tzu" */
const sansDatesNiRole = (vedette) =>
  sansDates(vedette)
    .replace(new RegExp(`\\.\\s*(${ROLES})\\b.*$`, 'i'), '')
    .trim()
    .replace(/[.,;]$/, '');

/** "Tolkien, John Ronald Reuel (1892-1973). Auteur du texte" -> "John Ronald Reuel Tolkien" */
function nettoyerAuteurBnf(vedette) {
  const nomComplet = sansDatesNiRole(vedette);
  const [nom, prenom] = nomComplet.split(/,\s*/);
  return prenom ? `${prenom} ${nom}` : nomComplet;
}

/** Element de classement de la vedette, seul repere fiable dans le titre. */
const patronymeBnf = (vedette) => sansDatesNiRole(vedette).split(',')[0].trim();

/**
 * Le dc:title de la BnF agglomere le titre, la mention d'edition et la mention
 * de responsabilite :
 *   "La communauté de l'anneau (Nouv. présentation) J. R. R. Tolkien ; trad…"
 * On coupe a la mention de responsabilite, reperee par le separateur ISBD "/"
 * ou, a defaut, par le nom de l'auteur.
 */
function nettoyerTitreBnf(titre, vedettes) {
  let propre = titre.split(' / ')[0];
  let coupe = propre !== titre;

  if (!coupe) {
    for (const vedette of vedettes) {
      // Le nom complet d'abord : couper au seul patronyme laisserait le prenom
      // dans le titre ("Vernon Subutex. 1 (Nouv. éd.) Virginie").
      for (const repere of [nettoyerAuteurBnf(vedette), patronymeBnf(vedette)]) {
        const position = repere.length > 2 ? propre.indexOf(repere) : -1;
        // Une coupe en tete de chaine signifierait que le repere est le titre.
        if (position > 2) {
          propre = propre.slice(0, position);
          coupe = true;
          break;
        }
      }
    }
  }

  // Dernier recours : la BnF romanise parfois l'auteur autrement que la page de
  // titre ("Sun zi" en vedette, "Sun Tzu" dans le titre). Le point-virgule
  // separe les mentions de responsabilite entre elles, et ce qui suit la
  // mention d'edition entre parentheses en fait partie.
  if (!coupe && propre.includes(' ; ')) {
    propre = propre.split(' ; ')[0].replace(/(\([^)]*\))\s+\S.*$/, '$1');
    coupe = true;
  }

  // La coupe laisse derriere elle les initiales de l'auteur et la mention
  // d'edition : "… de l'anneau (Nouv. présentation) J. R. R. ". Ce rabotage ne
  // s'applique qu'aux titres effectivement coupes : sur un titre intact, une
  // parenthese finale porte une information ("Les Misérables (tome 1)").
  let precedent = null;
  while (coupe && propre !== precedent) {
    precedent = propre;
    propre = propre
      .trim()
      .replace(/[\s;:,/]+$/, '')
      .replace(/(\s+\p{Lu}\.)+$/u, '')
      .replace(/\s*\([^)]*\)$/, '');
  }
  return propre.trim().replace(/[\s;:,/]+$/, '');
}

/** "Gallimard-Jeunesse (Paris)" -> "Gallimard-Jeunesse" */
const nettoyerEditeurBnf = (editeur) => editeur.replace(/\s*\([^)]*\)\s*$/, '').trim();

async function depuisBnf(isbn13, signal) {
  // API SRU du catalogue general, sans cle d'acces. Reponse en XML.
  const requete = encodeURIComponent(`bib.isbn any "${isbn13} ${versIsbn10(isbn13) ?? ''}"`);
  const url =
    'https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve' +
    `&query=${requete}&recordSchema=dublincore&maximumRecords=1`;
  const reponse = await fetchLimite(url, signal);
  if (!reponse.ok) return null;

  const xml = new DOMParser().parseFromString(await reponse.text(), 'application/xml');
  if (xml.querySelector('parsererror')) return null;
  const champ = (nom) =>
    [...xml.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', nom)].map((n) =>
      texte(n.textContent),
    );

  const titre = champ('title')[0];
  if (!titre) return null;
  const vedettes = champ('creator').filter(Boolean);
  const description = champ('format').join(' ');
  return {
    title: nettoyerTitreBnf(titre, vedettes),
    subtitle: '',
    authors: vedettes.map(nettoyerAuteurBnf),
    publisher: nettoyerEditeurBnf(champ('publisher')[0] ?? ''),
    publishedYear: entier(champ('date')[0]?.match(/\d{4}/)?.[0]),
    pageCount: entier(description.match(/(\d+)\s*p/i)?.[1]),
    coverUrl: null,
    source: 'bnf',
  };
}

/**
 * Cherche un ISBN chez les fournisseurs successifs.
 * Renvoie null si aucun ne repond : l'appelant bascule alors en saisie manuelle.
 */
export async function chercherParIsbn(saisie, { signal, onEtape } = {}) {
  const isbn13 = versIsbn13(saisie);
  if (!isbn13) throw new Error("Cet ISBN n'est pas valide.");

  // Le libelle porte son elision : il est insere tel quel dans « Interrogation … ».
  const fournisseurs = [
    ["d'Open Library", depuisOpenLibrary],
    ['de la BnF', depuisBnf],
  ];

  // « Aucun catalogue ne connaît ce livre » et « les catalogues sont
  // injoignables » demandent des messages opposes : hors ligne, annoncer que
  // le livre est inconnu serait un mensonge.
  let echecs = 0;

  for (const [nom, fournisseur] of fournisseurs) {
    if (signal?.aborted) throw signal.reason;
    onEtape?.(nom);
    try {
      const fiche = await fournisseur(isbn13, signal);
      if (fiche?.title) {
        return {
          ...fiche,
          isbn13,
          isbn10: versIsbn10(isbn13),
          // La BnF ne fournit pas de couverture : on retombe sur la
          // photothèque d'Open Library, qui repond par ISBN. « default=false »
          // renvoie une 404 plutot qu'une image blanche quand elle n'a rien,
          // ce qui laisse l'interface afficher sa propre vignette.
          coverUrl: fiche.coverUrl ?? `https://covers.openlibrary.org/b/isbn/${isbn13}-M.jpg?default=false`,
        };
      }
    } catch (err) {
      // Une annulation demandee par l'utilisateur arrete tout ; un simple
      // depassement de delai ne doit pas empecher d'essayer le suivant.
      if (signal?.aborted) throw err;
      echecs += 1;
      console.warn(`Catalogue ${nom} indisponible`, err);
    }
  }

  // Un catalogue muet ne permet pas d'affirmer que le livre est inconnu : la
  // BnF est la seule a couvrir serieusement le fonds francophone.
  if (echecs === fournisseurs.length) throw new Error('CATALOGUES_INJOIGNABLES');
  if (echecs > 0) throw new Error('CATALOGUE_PARTIEL');
  return null;
}
