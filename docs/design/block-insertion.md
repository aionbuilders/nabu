# Design Document : Insertion inter-blocs & sélection de bloc entier

> **Statut** : Exploration — Juin 2026 (encore flou, à mûrir)
> **Origine** : remplaçant du système `BlockGap` (désactivé car instable — injectait un div inerte entre chaque bloc, cas-limites curseur/sélection).
> **Objectif** : noter l'idée avant qu'elle ne s'évapore. Ne pas coder tant que ce n'est pas mûr.

---

## 1. Le problème concret

Quand deux blocs sont **collés** (aucun espace entre eux — typiquement deux `Zone` empilées, ou un bloc void comme `Divider`/`Image` suivi d'un autre), il n'y a **aucun endroit où poser le curseur pour insérer un bloc neutre entre les deux**. Le `BlockGap` (le `+` au survol) répondait à ça mais au prix d'un div inerte omniprésent dans le contenteditable → instabilité.

Cas d'usage type : « j'ai Zone A directement au-dessus de Zone B, je veux un paragraphe **entre** les deux, hors des deux zones ».

---

## 2. L'intuition : ce n'est pas un "gap", c'est une **sélection de bloc entier**

Le vrai primitive manquant, c'est la capacité de **sélectionner un bloc en tant qu'objet** (pas son texte) — un "block selection" distinct de la sélection de texte. Une fois ce primitive posé, il sert plusieurs besoins d'un coup :

- **Insérer après** (le besoin actuel) : bloc sélectionné → Entrée → paragraphe neutre juste après.
- **Drag & reorder** : la feature "drag handles" de la roadmap a *exactement* besoin du même primitive (saisir un bloc entier). → **à concevoir ensemble.**
- **Supprimer un bloc** entier (Backspace/Delete sur un bloc void sélectionné).
- Navigation : flèches qui "montent d'un cran" du texte vers le bloc-objet.

> Conclusion provisoire : ne pas refaire un "gap", mais introduire un **état de sélection de bloc** (`nabu.selection.selectedBlock` ?) que plusieurs features consomment. C'est l'investissement structurant.

---

## 3. Pistes d'interaction (à départager plus tard)

### Souris
- **Clic sur les "edges" non-éditables du bloc** (padding, marges, bordures — les zones `data-nabu-ui`/`data-nabu-inert`) → sélectionne le bloc entier (au lieu de placer un curseur texte).
- Un **handle** au survol (rejoint les drag handles) qui, cliqué, sélectionne le bloc.

### Clavier
- **Entrée** (ou **Cmd/Ctrl+Entrée**, ou **Entrée + modifier**) quand un bloc entier est sélectionné → crée un **bloc neutre (paragraph) juste après** et y place le curseur. Marche même quand les blocs sont collés.
- Échap depuis le texte → "remonte" à la sélection du bloc parent ; Échap encore → bloc grand-parent. (Façon ProseMirror node-selection.)
- Une fois un bloc sélectionné : Backspace = supprime, flèches = navigue entre blocs.

### Geste dédié
- À la limite d'un bloc void (Divider/Image), une **flèche bas/haut** ou **Entrée** insère un paragraphe avant/après (déjà esquissé pour le Divider via son keydown).

---

## 4. Contraintes Nabu à respecter

- **Loro-first** : l'état de sélection de bloc est dérivé/réactif, jamais une 2e source de vérité.
- **Single CE** : le primitive ne doit PAS réintroduire des nœuds inertes partout (l'erreur de `BlockGap`). Idéalement, la sélection de bloc est un **état overlay** (comme Zone UI / drag handles) hors du flux éditable, pas du DOM injecté entre les blocs.
- **Extension-first** : l'insertion "neutre" par défaut = paragraph, mais un conteneur (Zone) pourrait vouloir un comportement custom via un hook (`onInsertSibling` ?).

---

## 5. Prochaines étapes (quand on s'y attaquera)

1. Concevoir le **block-selection primitive** d'abord (état + rendu overlay), **conjointement avec les drag handles** (même base).
2. Décider l'interaction clavier canonique (Échap pour remonter ? Cmd+Entrée pour insérer après ?).
3. Décider l'interaction souris (clic sur edges vs handle).
4. Gérer les conteneurs (insérer *entre* deux zones = insérer dans leur parent commun à la bonne position).

> Pour l'instant : **noté, pas planifié.** À reprendre avec la feature drag handles, dont c'est le jumeau architectural.
