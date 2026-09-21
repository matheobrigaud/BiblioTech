# BiblioTech

Suivi de bibliothèque personnelle. Application web installable sur téléphone,
sans compte, sans serveur, sans frais.

## Principes

**Local-first.** Les données ne quittent jamais l'appareil : elles vivent dans
IndexedDB, dans le navigateur. Aucun compte à créer, rien à héberger, et
l'application fonctionne hors ligne — devant une étagère en librairie, dans le
métro. La contrepartie est qu'on ne peut rien réparer à distance : l'export est
le seul filet de sécurité de l'utilisateur, et le schéma doit être migré
proprement à chaque évolution (voir `src/db.js`).

**Aucune dépendance, aucune compilation.** Du JavaScript natif servi tel quel.
Le déploiement se résume à `git push`, et le projet fonctionnera encore dans dix
ans sans avoir à réanimer une chaîne d'outils.

**Trois entités, pas une.** Le livre (l'édition), l'exemplaire (le mien) et la
lecture sont distincts. La note et le commentaire appartiennent à la *lecture* :
relire un livre à quinze ans et à trente-cinq ne donne pas le même avis, et
écraser le premier serait une perte.

**On n'invente jamais une date.** Pour les lectures à venir, l'application
relève les dates toute seule ; l'utilisateur n'en saisit jamais. Pour les livres
déjà lus avant l'installation, on ne demande ni date de début ni date de fin —
personne ne s'en souvient — seulement la note, l'avis et le nombre de lectures.
Ces lectures « historiques » n'ont pas de date, donc elles sortent d'elles-mêmes
des récapitulatifs mensuels.

## Structure

| Fichier | Rôle |
|---|---|
| `src/model.js` | Vocabulaire du domaine : statuts, genres, fabriques d'objets |
| `src/db.js` | IndexedDB, migrations de schéma, export et import |
| `src/isbn.js` | Validation et conversion ISBN-10 / ISBN-13 |
| `src/metadata.js` | Recherche par ISBN : Open Library, puis BnF |
| `src/scanner.js` | Lecture du code-barres par la caméra |
| `src/app.js` | Interface et enchaînement des écrans |
| `sw.js` | Cache hors ligne |

## Essayer en local

Le projet n'a pas besoin de Node, mais les modules ES imposent un vrai serveur
HTTP — ouvrir `index.html` par double-clic ne marchera pas. Avec Python :

```bash
python -m http.server 8000
```

Puis <http://localhost:8000>. La caméra exige HTTPS, sauf sur `localhost` où
elle est autorisée.

L'application démarre vide. Pour voir à quoi elle ressemble remplie, ouvrir
*Réglages → Importer* et choisir `demo/bibliotheque-exemple.json` : six livres
couvrant tous les statuts, dont deux lectures antérieures sans date et une
lecture abandonnée page 96. L'import fusionne sur les identifiants, il n'écrase
donc pas une bibliothèque existante.

## Déployer sur GitHub Pages

1. Créer un dépôt **public** (Pages n'est gratuit que sur les dépôts publics).
2. `git push` sur `main`.
3. Dans *Settings → Pages*, choisir la source **Deploy from a branch**, branche
   `main`, dossier `/ (root)`.

Aucune action de build n'est nécessaire. Le site est servi en HTTPS, ce qui est
requis pour le service worker et l'accès à la caméra.

Pour installer sur Android : ouvrir l'URL dans Chrome, puis « Installer
l'application ». Sur iPhone : Partager → « Sur l'écran d'accueil ».

Le service worker interroge le réseau avant le cache pour les fichiers de
l'application : un téléphone connecté reçoit donc toujours la dernière version,
et le cache ne sert que hors ligne. Incrémenter `CACHE` dans `sw.js` reste utile
pour purger l'ancien cache d'un coup, mais ce n'est plus ce qui empêche de
rester bloqué sur du code périmé.

## Feuille de route

- Récapitulatif mensuel et bilan annuel, partagés en image via `navigator.share`
  (aucun serveur nécessaire : c'est une image, pas des données)
- Suivi des prêts : qui a le livre, depuis quand
- Séries et tomaisons
- Export CSV compatible Goodreads et Babelio
