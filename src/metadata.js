// Recuperation des metadonnees par ISBN.
//
// Ordre volontaire : Open Library (CC0, sans cle) d'abord, puis la BnF, bien
// meilleure sur le fonds francophone. La saisie manuelle reste toujours
// possible : beaucoup de livres anciens ou autoedites ne sont nulle part.

import { versIsbn13, versIsbn10 } from './isbn.js';

const texte = (valeur) => (typeof valeur === 'string' ? valeur.trim() : '');
const entier = (valeur) => {
  const n = parseInt(valeur, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function depuisOpenLibrary(isbn13, signal) {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&format=json&jscmd=data`;
  const reponse = await fetch(url, { signal });
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

/** "Tolkien, John Ronald Reuel (1892-1973). Auteur du texte" -> "John Ronald Reuel Tolkien" */
function nettoyerAuteurBnf(vedette) {
  const sansRole = vedette
    .replace(/\s*\(\d{4}-?\d{0,4}\.{0,4}\??\)/g, '')
    .replace(new RegExp(`\\.\\s*(${ROLES})\\b.*$`, 'i'), '')
    .trim()
    .replace(/[.,;]$/, '');

  const [nom, prenom] = sansRole.split(/,\s*/);
  return prenom ? `${prenom} ${nom}` : sansRole;
}

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
      const patronyme = vedette.split(',')[0].trim();
      const position = patronyme.length > 2 ? propre.indexOf(patronyme) : -1;
      // Une coupe en tete de chaine signifierait que le patronyme est le titre.
      if (position > 2) {
        propre = propre.slice(0, position);
        coupe = true;
      }
    }
  }

  // La coupe laisse derriere elle le prenom de l'auteur et la mention
  // d'edition : "… de l'anneau (Nouv. présentation) J. R. R. "
  let precedent = null;
  while (propre !== precedent) {
    precedent = propre;
    propre = propre.trim().replace(/[\s;:,/]+$/, '');
    if (coupe) propre = propre.replace(/(\s+\p{Lu}\.)+$/u, '');
    propre = propre.replace(/\s*\([^)]*\)$/, '');
  }
  return propre;
}

/** "Gallimard-Jeunesse (Paris)" -> "Gallimard-Jeunesse" */
const nettoyerEditeurBnf = (editeur) => editeur.replace(/\s*\([^)]*\)\s*$/, '').trim();

async function depuisBnf(isbn13, signal) {
  // API SRU du catalogue general, sans cle d'acces. Reponse en XML.
  const requete = encodeURIComponent(`bib.isbn any "${isbn13} ${versIsbn10(isbn13) ?? ''}"`);
  const url =
    'https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve' +
    `&query=${requete}&recordSchema=dublincore&maximumRecords=1`;
  const reponse = await fetch(url, { signal });
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
export async function chercherParIsbn(saisie, { signal } = {}) {
  const isbn13 = versIsbn13(saisie);
  if (!isbn13) throw new Error("Cet ISBN n'est pas valide.");

  for (const fournisseur of [depuisOpenLibrary, depuisBnf]) {
    try {
      const fiche = await fournisseur(isbn13, signal);
      if (fiche?.title) return { ...fiche, isbn13, isbn10: versIsbn10(isbn13) };
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      // Un fournisseur injoignable ne doit pas empecher d'essayer le suivant.
      console.warn('Fournisseur indisponible', err);
    }
  }
  return null;
}
