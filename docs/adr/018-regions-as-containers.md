# ADR 018 — Regions : des boîtes dans Loro, des coutures à l'écran

**Statut** : accepté (2026-10-23, validé par le propriétaire ; les cinq questions du §6 tranchées selon la recommandation)
**Remplace** : le **modèle de données** de l'ADR 016 (§2, §3.1, la partie « modèle à repères » de §3.4, §3.6 markdown / HTML). Le reste de l'ADR 016 reste valable (types, champs, numérotation, registre, commandes, protection par maintien, messages).
**Liés** : ADR 016 (Regions), ADR 017 (commandes, clavier, confirmations), `src/lib/blocks/subthread.js` (règles de sous-fil du Toggle), canvas « Zones — exploration » (planche 8b).

---

## 1. Contexte : un malentendu sur le mot « repères »

Lors de l'idéation du 2026-10-22, la question « boîtes ou repères ? » portait, dans ma présentation, sur le **modèle de données**. Le propriétaire a répondu « repères » en pensant à l'**interface** : des frontières vécues comme des coutures, dans un texte qui coule. L'intention, confirmée le 2026-10-23 :

> Dans l'arbre Loro, une région est un **conteneur**, une sous-région un conteneur dans le conteneur. À l'écran et au clavier, ça se vit comme un **texte continu avec des coutures**.

L'ADR 016 a été implémenté en repères **dans le modèle** (un bloc vide à la racine, document plat, étendue calculée). Ce modèle perd des choses auxquelles le propriétaire tient : une **fin** explicite (sortir d'une région, du texte du chapitre après ses scènes), une région qui **possède** son contenu (un nœud à copier, déplacer, verrouiller, synchroniser), des métadonnées et un nombre de mots portés par un sous-arbre, un rendu paresseux par conteneur.

Rien n'est publié (0.1.0-beta.0 ne contient pas Regions) : on change maintenant, sans migration.

## 2. Décision

Une région est un **bloc conteneur** (MegaBlock) :

- son **en-tête** est son **titre** : un texte Loro, édité sur place, dans la couture (comme le titre d'un Toggle) ;
- son **corps** est un fil Nabu ordinaire : paragraphes, listes, images… et **sous-régions** ;
- ses **données** : `regionType` et `fields` (map Loro), comme aujourd'hui.

L'interface et le clavier traitent les frontières comme des **coutures** (rendu, flèches, protection du Backspace, coupure), pas comme des murs. Le modèle, lui, est un arbre.

## 3. Conception

### 3.1 Le bloc région

- Type `region`, MegaBlock, en-tête texte (marques inline autorisées : un titre en italique est courant), corps = enfants.
- Le titre **est** l'en-tête : `region.fields.title` le lit en texte brut (compatibilité de l'API du registre) ; il n'y a plus de champ `title` stocké à part.
- Titre vide permis : la couture affiche alors le libellé calculé (« Chapitre 2 ») comme espace réservé.
- **Où vit une région** : à la racine, ou dans le corps d'une autre région. Jamais dans une liste, un toggle, un callout : le normaliseur la remonte après le conteneur le plus haut qui la tient, **à l'intérieur de sa région englobante** s'il y en a une (même mécanique que la règle « racine seulement » d'aujourd'hui, `hoistTarget()`).

### 3.2 Niveaux et imbrication

- Les types gardent leur `level` (déclaration de l'ADR 016 inchangée). Règle d'imbrication : **une sous-région a un niveau strictement plus profond que sa région parente**. Une violation (collage d'une partie dans une scène) est corrigée par le normaliseur : la région remonte jusqu'à un parent valide, son contenu avec elle.
- Le niveau n'est plus ce qui **calcule** l'étendue : c'est l'arbre. Il reste ce qui **valide** l'arbre et choisit le type lors d'une promotion / rétrogradation.
- Type inconnu (document venu d'ailleurs) : accepté n'importe où sous une région, non numéroté (comme aujourd'hui).

### 3.3 Corps mixtes et préambule

- Le corps d'une région peut mêler texte propre et sous-régions **dans n'importe quel ordre** (texte du chapitre, scène 1, transition, scène 2…). *Question 2.*
- À la racine, du texte avant, entre ou après les régions est permis (le préambule de l'ADR 016 devient un cas particulier).
- **Repère de fin** : quand du contenu suit une sous-région au niveau du parent, l'interface doit le rendre lisible (une couture de fin discrète). Son dessin est un sujet de la séance de design ; le modèle, lui, n'en a pas besoin.

### 3.4 Registre `nabu.regions`

API de l'ADR 016 conservée, calculée depuis l'arbre au lieu des repères :

- `list`, `tree`, `at(block)` (le plus proche ancêtre région), `of(block)`, `next` / `prev` / `parentOf`, `index` / `path` / `label` (numérotation `parent` / `document` / `none` inchangée) ;
- `blocks` = le sous-arbre ; `ownBlocks` = les enfants qui ne sont pas des régions ; `wordCount` / `ownWordCount` en conséquence ;
- `first` / `last` / `start` / `end` (indices racine des repères) disparaissent au profit du **nœud** de la région.

### 3.5 Gestes : ce qui change

Les identifiants de commandes de l'ADR 016 restent ; leur effet devient structurel. Chaque geste = un commit = une étape d'undo (ADR 015 inchangé).

| Commande | Effet dans le modèle à boîtes |
|---|---|
| `region:split` (Mod+Entrée) | coupe le bloc au curseur si besoin ; crée une région sœur du même type **juste après** la région courante et y **déplace** la suite du corps (blocs après le curseur) |
| `region:insert` | crée une région (type donné) avant / après la courante, ou au curseur |
| `region:merge-previous` / `-next` (maintien ⌫ / Suppr, 700 ms) | le corps de la région rejoint la fin de la précédente (resp. le corps de la suivante rejoint celle-ci), le conteneur vidé disparaît, son titre aussi |
| `region:move` (+ `-up` / `-down`) | déplace le nœud avant / après sa sœur de même niveau (plus de calcul de plage) |
| `region:promote` / `demote` | **structurel**, comme l'indentation d'une liste : rétrograder = devenir la dernière sous-région de la sœur précédente ; promouvoir = sortir juste après le parent. *Question 4* |
| `region:unwrap` (nouveau) | dissout la région : le titre devient un paragraphe, le corps reste en place (règle `dissolveToParagraph` du Toggle) |
| `region:next` / `prev` / `parent` | inchangés |

Clavier décidé en séance (2026-10-23, propriétaire) — détail en §3.9 :

- **Entrée dans le titre** → début du corps (premier paragraphe créé s'il manque). Le titre n'est jamais coupé.
- **Entrée sur un paragraphe vide** reste une Entrée ordinaire : un paragraphe vide est un choix d'auteur (respiration, silence), **pas** un signal de sortie (différence assumée avec le Toggle et les listes).
- **Sortir** = commande explicite `region:exit`, **Mod+Shift+Entrée** : un paragraphe se crée juste après la région, au niveau du parent ; répétée, elle remonte d'un niveau (scène → chapitre → partie → racine). Aussi dans le menu slash.
- **Mod+Entrée** = couper ici (`region:split`).
- **Tab / Shift+Tab** = `region:demote` / `region:promote`, **seulement dans le titre**. Dans le corps, Tab garde son sens (listes, imbrication).
- **Début de région = une seule position logique** : un Backspace au tout début du titre **ou** au tout début du premier élément du corps (quel que soit son type) déclenche la protection ; le **maintien** fusionne avec la région précédente (`region:merge-previous`). Symétrique : maintien de Suppr à la fin de la région précédente.
- **Créer une région** : `:::` + espace dans un paragraphe vide ouvre un sélecteur (stratégie `choose`, ADR 017) des types **valides à cet endroit** ; le curseur arrive dans le titre. Une entrée de menu slash par type déclaré. `#` reste un titre simple.

La **protection** de l'ADR 016 (question 1) reste : aucune fusion silencieuse de texte à travers une frontière (veto `onBeforeMerge`, par ancêtre région).

### 3.6 Rendu

- La couture actuelle (planche 8b : libellé, filet, indice ambre, filet qui se vide) devient l'**en-tête** du conteneur, avec le titre éditable sur place ; `role="heading"`, `aria-level` = niveau, inchangés.
- Le corps ne porte **aucune** bordure, marge ou fond par défaut : à l'œil, le texte coule d'une région à l'autre.
- Rendu paresseux (chantier à part) : le conteneur est l'unité naturelle.

### 3.7 Sérialisation

- **JSON** : un bloc à enfants, `{ type: 'region', props: { regionType, fields }, delta: <titre>, children: [...] }` — aller-retour exact.
- **HTML** : `<section data-nabu-region="<type>" data-nabu-fields="…"><hN>titre</hN>…corps…</section>`. Relu exactement ; un `<section>` sans ces attributs reste ce qu'il est aujourd'hui.
- **Markdown** : le commentaire porteur de l'ADR 016 ouvre la région (`<!-- region:chapter {json} -->` suivi du titre `## …`, qui est cette fois le **vrai titre** et non un écho). La fin est **déduite** à la lecture (prochaine ouverture de même niveau ou plus haut, fin du parent, fin du document) ; un commentaire de fin `<!-- /region -->` n'est écrit **que** lorsque du contenu suit au niveau du parent. *Question 5.*
- **Presse-papiers** : une sélection de **texte** ne copie que du texte (§3.9) ; la structure voyage par les gestes de structure (couture, future sélection de bloc). Coller une région dans une liste / un toggle → règle de §3.1.

### 3.8 Collaboration

- Les déplacements d'arbre Loro sont sûrs en concurrence (pas de cycles, dernier écrivain gagnant par nœud). Deux auteurs qui coupent au même endroit : les blocs déplacés aboutissent dans l'une des deux nouvelles régions, l'autre reste vide et visible — pas de perte, pas de conflit structurel.
- Une région = un sous-arbre : la base de futures permissions, synchronisation ou chargement par chapitre (Orduin).

### 3.9 Le titre est un champ ; une sélection de texte ne touche jamais la structure

Décidé le 2026-10-23 (propriétaire). **Stockage** et **comportement** sont distincts : le titre est stocké comme un texte Loro dans la région (collaboration, undo, marques inline), mais il **se comporte comme un champ verrouillé**.

- **Traversable par le curseur simple** : ↓ / → à la fin du bloc au-dessus d'une région → début du titre ; ↑ / ← au début du premier élément du corps → fin du titre ; ↓ / → à la fin du titre → début du corps. Le **libellé** calculé (« Chapitre 2 ») n'est jamais un arrêt du curseur.
- **Jamais fusionné, coupé ni converti** : rien n'entre dans le titre ni n'en sort par ⌫ / Suppr ; Entrée ne le coupe pas ; les raccourcis de blocs (`# `, `- `, `> `…) et « transformer en… » ne s'y appliquent pas ; un collage multi-blocs y arrive **à plat**, sur une ligne.
- **Exclu des sélections étendues** qui ne sont pas entièrement en lui :
  - le modèle de sélection de Nabu exclut les titres de toute plage qui commence ou finit hors d'eux : suppression, frappe par-dessus, copie, marques les ignorent ;
  - ils ne sont pas surlignés pendant une telle sélection (CSS, piloté par l'état de sélection ; le DOM du titre ne change pas pendant un glisser, pour ne pas perturber la sélection native) ;
  - une extrémité qui s'étend (Shift+flèches, glisser) et tomberait dans un titre le **saute** ;
  - une sélection qui **commence** dans un titre y reste **bornée** (comme un champ de formulaire) ;
  - **Ctrl+A** dans un titre sélectionne le titre ; ailleurs, tout le texte du document **sans** les titres.
- **Conséquences assumées** : une suppression à cheval sur deux régions efface le texte des deux côtés mais **ne les fusionne pas** (titre intact) ; **Ctrl+A puis Suppr** vide le texte et **garde le squelette** (régions et titres) ; supprimer, fusionner ou déplacer une région se fait par un geste de structure explicite (maintien, couture, future sélection de bloc). Principe : *une sélection de texte ne touche que du texte*.

## 4. Ce qui est réutilisé, ce qui est réécrit

**Gardé tel quel** : `types.js` (déclaration, validation des champs), la numérotation et les gabarits (`format.js` en partie), `messages.js`, la stratégie `hold` et son rendu (`Region.svelte`, indice et filet), le moteur de commandes (ADR 017), le crochet générique `onBeforeMerge`, les helpers de sous-fil.

**Réécrit** : `region.svelte.js` (bloc vide → MegaBlock à en-tête), `regions.svelte.js` (registre depuis l'arbre), `normalize.js` (règle d'imbrication), `actions.js` / `insert.js` / `facts.js` (opérations structurelles), sérialiseurs markdown / HTML, et les tests Regions (unitaires et e2e), réécrits avec les nouvelles sémantiques.

**Supprimé** : la surcharge de `Block#dragRange()` par la région (le crochet générique reste : un conteneur se déplace déjà avec son sous-arbre).

## 5. Découpage

0. **Séance de design** : clavier décidé (§3.5, §3.9). Restent à dessiner sur le canvas : le **repère de fin** (pistes A toujours visible / B seulement si nécessaire / C rail de marge selon le curseur ; préférence B + C), la sortie Mod+Shift+Entrée, le sélecteur `:::`.
1. **Lot A — modèle** : bloc conteneur, titre en en-tête, imbrication + normaliseur, registre, numérotation, rendu de la couture actuelle avec titre éditable, JSON. Les commandes existantes réécrites sur la structure sans changer leurs raccourcis.
2. **Lot B — clavier et sélection** : titre-champ (§3.9 : flèches, verrouillage, exclusion des sélections, Ctrl+A), protection du début de région, `exit`, promote / demote structurels dans le titre, `unwrap`, `:::` et menu slash.
3. **Lot C — échanges** : markdown, HTML, presse-papiers, collages.

## 6. Questions — toutes décidées le 2026-10-23 (propriétaire) selon la recommandation en gras

1. **Titre** = en-tête texte du conteneur (édité sur place, collaboratif, marques inline) **ou** un champ `title` texte brut édité ailleurs ? → **en-tête**.
2. **Corps mixtes** : texte du parent permis entre et après les sous-régions ? → **oui**, avec une couture de fin dessinée en séance de design.
3. **Niveaux** : garder `level` comme règle d'imbrication (sous-région strictement plus profonde, normaliseur correcteur) ? → **oui**.
4. **Promouvoir** une scène au rang de chapitre : les scènes qui la suivent dans le même chapitre **la suivent** (deviennent ses sous-régions, comme dans le modèle à repères) ou **restent** dans l'ancien chapitre ? → **elles la suivent** (le découpage visible du texte ne change pas).
5. **Markdown** : commentaire de fin seulement quand il est nécessaire ? → **oui**.
