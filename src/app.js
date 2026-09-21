import * as db from './db.js';
import { chercherParIsbn } from './metadata.js';
import { estValide, versIsbn13, formater } from './isbn.js';
import { scanDisponible, demarrerScan } from './scanner.js';
import {
  STATUTS,
  GENRES,
  nouveauLivre,
  nouvelExemplaire,
  lectureSuivie,
  lectureHistorique,
  terminerLecture,
  abandonnerLecture,
} from './model.js';

const $ = (sel) => document.querySelector(sel);
const modale = $('#modale');

let etat = { livres: [], exemplaires: [], lectures: [], filtre: 'tous' };

// --- Rendu ---------------------------------------------------------------

const echapper = (valeur) =>
  String(valeur ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const etoiles = (note) => (note ? '★'.repeat(note) + '☆'.repeat(5 - note) : '');

const dateLongue = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const enDate = (iso) => (iso ? dateLongue.format(new Date(`${iso}T12:00:00`)) : '');

/** Une ligne d'historique lisible, adaptee a l'etat de la lecture. */
function resumerLecture(lecture) {
  const details = [];
  if (lecture.timesRead > 1) details.push(`lu ${lecture.timesRead} fois`);
  if (lecture.rating) details.push(etoiles(lecture.rating));

  let entete;
  if (lecture.kind === 'historical') entete = 'Lu avant BiblioTech';
  else if (lecture.abandonedAt)
    entete =
      `Abandonné le ${enDate(lecture.abandonedAt)}` +
      (lecture.stoppedAtPage ? `, page ${lecture.stoppedAtPage}` : '');
  else if (lecture.finishedAt)
    entete = `Lu du ${enDate(lecture.startedAt)} au ${enDate(lecture.finishedAt)}`;
  else entete = `Commencé le ${enDate(lecture.startedAt)}`;

  return [entete, ...details].join(' · ');
}

async function recharger() {
  const [livres, exemplaires, lectures] = await Promise.all([
    db.tout('books'),
    db.tout('copies'),
    db.tout('readings'),
  ]);
  etat = { ...etat, livres, exemplaires, lectures };
  dessiner();
}

function dessinerFiltres() {
  const compte = (statut) =>
    statut === 'tous'
      ? etat.exemplaires.length
      : etat.exemplaires.filter((e) => e.status === statut).length;

  const entrees = [['tous', 'Tout'], ...Object.entries(STATUTS).map(([k, v]) => [k, v.label])];
  $('#filtres').innerHTML = entrees
    .filter(([cle]) => cle === 'tous' || compte(cle) > 0 || etat.filtre === cle)
    .map(
      ([cle, label]) =>
        `<button class="puce" data-filtre="${cle}" aria-pressed="${etat.filtre === cle}">
           ${echapper(label)} ${compte(cle) ? `<span>${compte(cle)}</span>` : ''}
         </button>`,
    )
    .join('');
}

function dessiner() {
  dessinerFiltres();

  const visibles = etat.exemplaires
    .filter((e) => etat.filtre === 'tous' || e.status === etat.filtre)
    .map((e) => ({ exemplaire: e, livre: etat.livres.find((l) => l.id === e.bookId) }))
    .filter((x) => x.livre)
    .sort((a, b) => b.exemplaire.updatedAt.localeCompare(a.exemplaire.updatedAt));

  if (!visibles.length) {
    $('#vue').innerHTML = `<div class="vide">
      <strong>${etat.exemplaires.length ? 'Rien dans ce rayon' : 'Bibliothèque vide'}</strong>
      ${etat.exemplaires.length ? 'Essaie un autre filtre.' : 'Appuie sur + pour ajouter ton premier livre.'}
    </div>`;
    return;
  }

  $('#vue').innerHTML = `<div class="liste">${visibles
    .map(({ exemplaire, livre }) => {
      const derniere = etat.lectures
        .filter((l) => l.bookId === livre.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return `<button class="livre" data-copie="${exemplaire.id}">
        ${
          // Une couverture absente du fonds d'Open Library renvoie une 404 :
          // on remplace alors l'image par la vignette de repli.
          livre.coverUrl
            ? `<img class="couverture" src="${echapper(livre.coverUrl)}" alt="" loading="lazy"
                    onerror="this.replaceWith(Object.assign(document.createElement('div'),
                             { className: 'couverture', textContent: '📕' }))">`
            : '<div class="couverture">📕</div>'
        }
        <div>
          <h3>${echapper(livre.title)}</h3>
          <p>${echapper(livre.authors.join(', ') || 'Auteur inconnu')}</p>
          <div class="meta">
            <span class="etiquette">${STATUTS[exemplaire.status].label}</span>
            ${derniere?.rating ? `<span>${etoiles(derniere.rating)}</span>` : ''}
          </div>
        </div>
      </button>`;
    })
    .join('')}</div>`;
}

// --- Modale --------------------------------------------------------------

// apresRendu peut renvoyer une fonction de nettoyage (arreter la camera, par
// exemple) : elle sera appelee au remplacement du panneau comme a la fermeture,
// y compris par la touche Echap.
let nettoyage = null;

function ouvrirPanneau(html, apresRendu) {
  nettoyage?.();
  nettoyage = null;
  modale.innerHTML = `<div class="panneau">${html}</div>`;
  if (!modale.open) modale.showModal();
  nettoyage = apresRendu?.(modale) ?? null;
}

const fermer = () => modale.close();

modale.addEventListener('close', () => {
  nettoyage?.();
  nettoyage = null;
  // L'evenement « close » est asynchrone : si un autre panneau a deja ete
  // ouvert entre-temps, effacer ici le viderait de son contenu.
  if (!modale.open) modale.innerHTML = '';
});

// --- Ajout : identification ---------------------------------------------

function panneauAjout() {
  ouvrirPanneau(
    `<h2>Ajouter un livre</h2>
     <div class="choix">
       ${
         scanDisponible()
           ? `<button data-action="scanner"><strong>Scanner le code-barres</strong>
                <span>Le plus rapide pour cataloguer une étagère</span></button>`
           : ''
       }
       <button data-action="isbn"><strong>Saisir l'ISBN</strong>
         <span>Les 13 chiffres sous le code-barres</span></button>
       <button data-action="manuel"><strong>Saisir à la main</strong>
         <span>Livre ancien, autoédité ou sans ISBN</span></button>
     </div>
     <div class="actions"><button class="secondaire" data-action="annuler">Annuler</button></div>`,
    (panneau) => {
      panneau.querySelector('[data-action="scanner"]')?.addEventListener('click', panneauScan);
      panneau.querySelector('[data-action="isbn"]').addEventListener('click', panneauIsbn);
      panneau
        .querySelector('[data-action="manuel"]')
        .addEventListener('click', () => panneauFiche(nouveauLivre()));
      panneau.querySelector('[data-action="annuler"]').addEventListener('click', fermer);
    },
  );
}

function panneauScan() {
  ouvrirPanneau(
    `<h2>Scanner</h2>
     <video id="flux" playsinline muted></video>
     <p class="note">Vise le code-barres au dos du livre.</p>
     <p class="erreur" id="err" hidden></p>
     <div class="actions"><button class="secondaire" data-action="annuler">Annuler</button></div>`,
    (panneau) => {
      const arreter = demarrerScan(panneau.querySelector('#flux'), (code, err) => {
        if (err || !code) {
          const zone = panneau.querySelector('#err');
          zone.hidden = false;
          zone.textContent =
            err?.name === 'NotAllowedError'
              ? "Accès à la caméra refusé. Saisis l'ISBN à la main."
              : "La caméra n'est pas disponible. Saisis l'ISBN à la main.";
          return;
        }
        rechercher(code);
      });
      panneau.querySelector('[data-action="annuler"]').addEventListener('click', fermer);
      return arreter;
    },
  );
}

function panneauIsbn() {
  ouvrirPanneau(
    `<h2>Saisir l'ISBN</h2>
     <label for="isbn">ISBN (10 ou 13 chiffres)</label>
     <input id="isbn" inputmode="numeric" autocomplete="off" placeholder="978…">
     <p class="erreur" id="err" hidden></p>
     <div class="actions">
       <button class="secondaire" data-action="annuler">Annuler</button>
       <button class="primaire" data-action="chercher">Chercher</button>
     </div>`,
    (panneau) => {
      const champ = panneau.querySelector('#isbn');
      const erreur = panneau.querySelector('#err');
      const valider = () => {
        if (!estValide(champ.value)) {
          erreur.hidden = false;
          erreur.textContent = "Cet ISBN est incorrect — vérifie les chiffres.";
          return;
        }
        rechercher(champ.value);
      };
      champ.focus();
      champ.addEventListener('keydown', (e) => e.key === 'Enter' && valider());
      panneau.querySelector('[data-action="chercher"]').addEventListener('click', valider);
      panneau.querySelector('[data-action="annuler"]').addEventListener('click', fermer);
    },
  );
}

/**
 * Rescanner une etagere fait forcement repasser sur des livres deja saisis.
 * On le signale avant d'en creer un doublon, sans pour autant l'interdire :
 * posseder deux exemplaires du meme titre est legitime.
 */
function panneauDoublon(livre) {
  const exemplaire = etat.exemplaires.find((e) => e.bookId === livre.id);
  ouvrirPanneau(
    `<h2>Tu as déjà ce livre</h2>
     <p class="note">${echapper(livre.title)} — ${echapper(livre.authors.join(', '))}
       ${exemplaire ? ` · ${STATUTS[exemplaire.status].label}` : ''}</p>
     <div class="choix">
       <button data-action="ouvrir"><strong>Ouvrir sa fiche</strong>
         <span>Changer son statut ou ajouter une relecture</span></button>
       <button data-action="quand-meme"><strong>Ajouter quand même</strong>
         <span>J'en possède un second exemplaire</span></button>
     </div>
     <div class="actions"><button class="secondaire" data-action="annuler">Annuler</button></div>`,
    (panneau) => {
      panneau
        .querySelector('[data-action="ouvrir"]')
        .addEventListener('click', () => panneauLivre(exemplaire.id));
      panneau
        .querySelector('[data-action="quand-meme"]')
        // Meme edition : on reutilise la fiche du livre et on ne cree qu'un
        // second exemplaire, conformement au modele.
        .addEventListener('click', () => panneauParcours(livre));
      panneau.querySelector('[data-action="annuler"]').addEventListener('click', fermer);
    },
  );
}

async function rechercher(code) {
  const isbn13 = versIsbn13(code);
  const connu = etat.livres.find((l) => l.isbn13 && l.isbn13 === isbn13);
  if (connu) return panneauDoublon(connu);

  // Les catalogues mettent couramment plusieurs secondes a repondre. L'ecran
  // doit donc nommer celui qu'il interroge et rester quittable, sans quoi
  // l'attente passe pour une panne.
  const annulation = new AbortController();
  ouvrirPanneau(
    `<h2>Recherche…</h2>
     <p class="note">${echapper(formater(code))}</p>
     <p class="note" id="etape">Connexion aux catalogues…</p>
     <div class="actions">
       <button class="secondaire" data-action="annuler">Annuler</button>
       <button class="primaire" data-action="manuel">Saisir à la main</button>
     </div>`,
    (panneau) => {
      const abandonner = () =>
        annulation.abort(new DOMException('Recherche quittée', 'AbortError'));

      // L'annulation est explicite : se reposer sur l'evenement « close » du
      // dialogue, qui est asynchrone, laissait la recherche aboutir et rouvrir
      // une fiche apres coup.
      panneau.querySelector('[data-action="annuler"]').addEventListener('click', () => {
        abandonner();
        fermer();
      });
      panneau.querySelector('[data-action="manuel"]').addEventListener('click', () => {
        abandonner();
        panneauFiche(nouveauLivre({ isbn13: versIsbn13(code), source: 'manuel' }));
      });
      // Fermeture par la touche Echap.
      return abandonner;
    },
  );

  const afficherEtape = (nom) => {
    const zone = modale.querySelector('#etape');
    if (zone) zone.textContent = `Interrogation ${nom}…`;
  };

  let fiche;
  try {
    fiche = await chercherParIsbn(code, { signal: annulation.signal, onEtape: afficherEtape });
  } catch (err) {
    if (annulation.signal.aborted) return; // l'utilisateur est deja parti
    return panneauFiche(
      nouveauLivre({ isbn13: versIsbn13(code) }),
      {
        CATALOGUES_INJOIGNABLES:
          "Les catalogues sont injoignables — vérifie ta connexion. Tu peux quand même saisir la fiche, l'ISBN est conservé.",
        CATALOGUE_PARTIEL:
          "Un catalogue n'a pas répondu : impossible de dire si ce livre y figure. Réessaie plus tard ou complète la fiche à la main.",
      }[err.message] ?? `Recherche impossible : ${err.message}`,
    );
  }

  if (annulation.signal.aborted) return;
  panneauFiche(
    fiche ? nouveauLivre(fiche) : nouveauLivre({ isbn13: versIsbn13(code), source: 'manuel' }),
    fiche ? null : "Aucun catalogue ne connaît cet ISBN. Complète la fiche à la main.",
  );
}

// --- Ajout : fiche puis parcours ----------------------------------------

/**
 * Formulaire des metadonnees, partage entre l'ajout et la correction.
 * `suite` recoit le livre complete : enchainer sur le choix du parcours a
 * l'ajout, ou enregistrer directement lors d'une correction.
 */
function panneauFiche(livre, avertissement, { suite = panneauParcours, libelle, titre: entete } = {}) {
  ouvrirPanneau(
    `<h2>${entete ?? (livre.title ? 'Vérifier la fiche' : 'Nouveau livre')}</h2>
     ${avertissement ? `<p class="note">${echapper(avertissement)}</p>` : ''}
     <label for="titre">Titre</label>
     <input id="titre" value="${echapper(livre.title)}">
     <label for="auteurs">Auteurs (séparés par une virgule)</label>
     <input id="auteurs" value="${echapper(livre.authors.join(', '))}">
     <label for="pages">Nombre de pages</label>
     <input id="pages" inputmode="numeric" value="${livre.pageCount ?? ''}">
     <label for="genre">Genre</label>
     <select id="genre">
       <option value="">—</option>
       ${GENRES.map(
         (g) => `<option ${livre.genres[0] === g ? 'selected' : ''}>${echapper(g)}</option>`,
       ).join('')}
     </select>
     <p class="erreur" id="err" hidden></p>
     <div class="actions">
       <button class="secondaire" data-action="annuler">Annuler</button>
       <button class="primaire" data-action="suite">${libelle ?? 'Continuer'}</button>
     </div>`,
    (panneau) => {
      panneau.querySelector('[data-action="annuler"]').addEventListener('click', fermer);
      panneau.querySelector('[data-action="suite"]').addEventListener('click', () => {
        const titre = panneau.querySelector('#titre').value.trim();
        if (!titre) {
          const erreur = panneau.querySelector('#err');
          erreur.hidden = false;
          erreur.textContent = 'Le titre est obligatoire.';
          return;
        }
        const pages = parseInt(panneau.querySelector('#pages').value, 10);
        const genre = panneau.querySelector('#genre').value;
        suite({
          ...livre,
          title: titre,
          authors: panneau
            .querySelector('#auteurs')
            .value.split(',')
            .map((a) => a.trim())
            .filter(Boolean),
          pageCount: Number.isFinite(pages) && pages > 0 ? pages : null,
          genres: genre ? [genre] : [],
        });
      });
    },
  );
}

function panneauParcours(livre) {
  ouvrirPanneau(
    `<h2>${echapper(livre.title)}</h2>
     <div class="choix">
       <button data-parcours="en_cours"><strong>Je commence ce livre</strong>
         <span>La date de début est enregistrée automatiquement</span></button>
       <button data-parcours="historique"><strong>Je l'ai déjà lu</strong>
         <span>Note et commentaire, aucune date à saisir</span></button>
       <button data-parcours="a_lire"><strong>Je le mets de côté</strong>
         <span>Rejoint la pile à lire</span></button>
     </div>
     <div class="actions"><button class="secondaire" data-action="annuler">Annuler</button></div>`,
    (panneau) => {
      panneau.querySelector('[data-action="annuler"]').addEventListener('click', fermer);
      panneau.querySelectorAll('[data-parcours]').forEach((bouton) =>
        bouton.addEventListener('click', async () => {
          const parcours = bouton.dataset.parcours;
          if (parcours === 'historique') return panneauHistorique(livre);
          await db.enregistrerEnsemble({
            book: livre,
            copy: nouvelExemplaire(livre.id, parcours),
            reading: parcours === 'en_cours' ? lectureSuivie(livre.id) : null,
          });
          fermer();
          recharger();
        }),
      );
    },
  );
}

function panneauHistorique(livre) {
  let note = null;
  ouvrirPanneau(
    `<h2>${echapper(livre.title)}</h2>
     <label>Ta note</label>
     <div class="etoiles" id="etoiles">
       ${[1, 2, 3, 4, 5]
         .map((n) => `<button data-note="${n}" aria-pressed="false" aria-label="${n} sur 5">★</button>`)
         .join('')}
     </div>
     <label for="fois">Combien de fois l'as-tu lu ?</label>
     <input id="fois" inputmode="numeric" value="1">
     <label for="avis">Ton avis (facultatif)</label>
     <textarea id="avis" placeholder="Ce que tu en as pensé…"></textarea>
     <div class="actions">
       <button class="secondaire" data-action="annuler">Annuler</button>
       <button class="primaire" data-action="valider">Ajouter</button>
     </div>`,
    (panneau) => {
      panneau.querySelectorAll('[data-note]').forEach((bouton) =>
        bouton.addEventListener('click', () => {
          note = Number(bouton.dataset.note);
          panneau
            .querySelectorAll('[data-note]')
            .forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.note) <= note));
        }),
      );
      panneau.querySelector('[data-action="annuler"]').addEventListener('click', fermer);
      panneau.querySelector('[data-action="valider"]').addEventListener('click', async () => {
        const fois = parseInt(panneau.querySelector('#fois').value, 10);
        await db.enregistrerEnsemble({
          book: livre,
          copy: nouvelExemplaire(livre.id, 'lu'),
          reading: lectureHistorique(livre.id, {
            timesRead: Number.isFinite(fois) && fois > 0 ? fois : 1,
            rating: note,
            comment: panneau.querySelector('#avis').value.trim(),
          }),
        });
        fermer();
        recharger();
      });
    },
  );
}

// --- Fiche d'un livre existant ------------------------------------------

function panneauLivre(copieId) {
  const exemplaire = etat.exemplaires.find((e) => e.id === copieId);
  const livre = etat.livres.find((l) => l.id === exemplaire.bookId);
  const lectures = etat.lectures
    .filter((l) => l.bookId === livre.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const enCours = lectures.find((l) => l.kind === 'tracked' && !l.finishedAt && !l.abandonedAt);

  ouvrirPanneau(
    `<h2>${echapper(livre.title)}</h2>
     <p class="note">${echapper(livre.authors.join(', ') || 'Auteur inconnu')}
       ${livre.pageCount ? ` · ${livre.pageCount} pages` : ''}
       ${livre.genres[0] ? ` · ${echapper(livre.genres[0])}` : ''}</p>

     <label for="statut">Statut</label>
     <select id="statut">
       ${Object.entries(STATUTS)
         .map(
           ([cle, v]) =>
             `<option value="${cle}" ${exemplaire.status === cle ? 'selected' : ''}>${v.label}</option>`,
         )
         .join('')}
     </select>

     ${
       enCours
         ? `<div class="actions">
              <button class="primaire" data-action="terminer">J'ai fini</button>
              <button class="secondaire" data-action="abandonner">J'abandonne</button>
            </div>`
         : ''
     }

     ${
       lectures.length
         ? `<label>Historique de lecture</label>${lectures
             .map(
               (l) => `<p class="note">${echapper(resumerLecture(l))}
                 ${l.comment ? `<br>${echapper(l.comment)}` : ''}</p>`,
             )
             .join('')}`
         : ''
     }

     <div class="actions">
       <button class="secondaire" data-action="modifier">Modifier la fiche</button>
       <button class="primaire" data-action="fermer">Fermer</button>
     </div>
     <div class="actions">
       <button class="secondaire" data-action="supprimer">Supprimer ce livre</button>
     </div>`,
    (panneau) => {
      panneau.querySelector('#statut').addEventListener('change', async (e) => {
        await db.enregistrer('copies', {
          ...exemplaire,
          status: e.target.value,
          updatedAt: new Date().toISOString(),
        });
        recharger();
      });

      panneau.querySelector('[data-action="terminer"]')?.addEventListener('click', async () => {
        await db.enregistrer('readings', terminerLecture(enCours));
        await db.enregistrer('copies', {
          ...exemplaire,
          status: 'lu',
          updatedAt: new Date().toISOString(),
        });
        await recharger();
        panneauNoter(enCours.id);
      });

      panneau.querySelector('[data-action="abandonner"]')?.addEventListener('click', async () => {
        await db.enregistrer('readings', abandonnerLecture(enCours));
        await db.enregistrer('copies', {
          ...exemplaire,
          status: 'abandonne',
          updatedAt: new Date().toISOString(),
        });
        fermer();
        recharger();
      });

      // Les notices de catalogue arrivent parfois mal formees : pouvoir les
      // corriger apres coup evite de devoir supprimer puis ressaisir le livre.
      panneau.querySelector('[data-action="modifier"]').addEventListener('click', () =>
        panneauFiche(livre, null, {
          titre: 'Modifier la fiche',
          libelle: 'Enregistrer',
          suite: async (modifie) => {
            await db.enregistrer('books', modifie);
            await recharger();
            panneauLivre(copieId);
          },
        }),
      );

      panneau.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
        if (!confirm(`Supprimer « ${livre.title} » et tout son historique ?`)) return;
        await db.supprimerLivre(livre.id);
        fermer();
        recharger();
      });

      panneau.querySelector('[data-action="fermer"]').addEventListener('click', fermer);
    },
  );
}

function panneauNoter(lectureId) {
  const lecture = etat.lectures.find((l) => l.id === lectureId);
  let note = lecture.rating;
  ouvrirPanneau(
    `<h2>Terminé — qu'en as-tu pensé ?</h2>
     <div class="etoiles">
       ${[1, 2, 3, 4, 5]
         .map(
           (n) =>
             `<button data-note="${n}" aria-pressed="${note >= n}" aria-label="${n} sur 5">★</button>`,
         )
         .join('')}
     </div>
     <label for="avis">Ton avis (facultatif)</label>
     <textarea id="avis">${echapper(lecture.comment)}</textarea>
     <div class="actions">
       <button class="secondaire" data-action="plus-tard">Plus tard</button>
       <button class="primaire" data-action="valider">Enregistrer</button>
     </div>`,
    (panneau) => {
      panneau.querySelectorAll('[data-note]').forEach((bouton) =>
        bouton.addEventListener('click', () => {
          note = Number(bouton.dataset.note);
          panneau
            .querySelectorAll('[data-note]')
            .forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.note) <= note));
        }),
      );
      panneau.querySelector('[data-action="plus-tard"]').addEventListener('click', fermer);
      panneau.querySelector('[data-action="valider"]').addEventListener('click', async () => {
        await db.enregistrer('readings', {
          ...lecture,
          rating: note,
          comment: panneau.querySelector('#avis').value.trim(),
        });
        fermer();
        recharger();
      });
    },
  );
}

// --- Reglages et sauvegarde ---------------------------------------------

function panneauReglages() {
  ouvrirPanneau(
    `<h2>Réglages</h2>
     <p class="note">${etat.livres.length} livres · ${etat.lectures.length} lectures</p>
     <p class="note">Tes données ne sont stockées que sur cet appareil. Si tu vides
       les données du navigateur ou changes de téléphone, elles disparaissent —
       exporte-les régulièrement.</p>
     <div class="actions">
       <button class="primaire" data-action="exporter">Exporter</button>
       <button class="secondaire" data-action="importer">Importer</button>
     </div>
     <input type="file" id="fichier" accept="application/json" hidden>
     <p class="erreur" id="err" hidden></p>
     <div class="actions"><button class="secondaire" data-action="fermer">Fermer</button></div>`,
    (panneau) => {
      panneau.querySelector('[data-action="exporter"]').addEventListener('click', async () => {
        const donnees = await db.exporter();
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(donnees, null, 2)], { type: 'application/json' }),
        );
        const lien = document.createElement('a');
        lien.href = url;
        lien.download = `bibliotech-${new Date().toISOString().slice(0, 10)}.json`;
        lien.click();
        URL.revokeObjectURL(url);
      });

      const fichier = panneau.querySelector('#fichier');
      panneau.querySelector('[data-action="importer"]').addEventListener('click', () =>
        fichier.click(),
      );
      fichier.addEventListener('change', async () => {
        const erreur = panneau.querySelector('#err');
        try {
          const donnees = JSON.parse(await fichier.files[0].text());
          await db.importer(donnees);
          fermer();
          recharger();
        } catch (err) {
          erreur.hidden = false;
          erreur.textContent = err.message;
        }
      });

      panneau.querySelector('[data-action="fermer"]').addEventListener('click', fermer);
    },
  );
}

// --- Branchements --------------------------------------------------------

$('#btn-ajouter').addEventListener('click', panneauAjout);
$('#btn-reglages').addEventListener('click', panneauReglages);

$('#filtres').addEventListener('click', (e) => {
  const puce = e.target.closest('[data-filtre]');
  if (!puce) return;
  etat.filtre = puce.dataset.filtre;
  dessiner();
});

$('#vue').addEventListener('click', (e) => {
  const carte = e.target.closest('[data-copie]');
  if (carte) panneauLivre(carte.dataset.copie);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    /* hors ligne indisponible : l'application fonctionne quand meme */
  });
}

recharger();
