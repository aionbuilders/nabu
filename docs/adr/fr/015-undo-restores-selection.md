# ADR 015 — Undo restores the selection with Loro stable cursors

**Statut** : accepté (2026-10-21, décision du propriétaire)
**Liés** : ADR 006 (selection bridge), ADR 010 (persistance), `nabu.shortcut()` (undo des raccourcis markdown), P-07 (étapes d'undo structurelles), P-11 (bloc recréé par l'undo)

---

## 1. Contexte

L'`UndoManager` de Loro ne restaurait qu'un **caret** (bloc + offset) après un undo / redo : « bold sur *important*, Ctrl+Z » enlevait le gras mais laissait le curseur au début de la sélection. Les attentes d'un éditeur moderne :

- **Ctrl+Z** rend la sélection (pas seulement un caret) telle qu'elle était juste AVANT l'action annulée : plage dans un bloc, plage multi-blocs (ancre et focus dans des blocs différents), **direction** (sélection « à l'envers »).
- **Ctrl+Y / Ctrl+Shift+Z** rend la sélection là où l'action s'est TERMINÉE (caret à la fin du texte retapé, texte sélectionné après un re-bold).
- La sélection restaurée est amenée à l'écran sans saut inutile.
- **Collaboration** : des offsets stockés deviennent faux dès qu'un pair distant édite. L'undo de Loro n'annule que les changements locaux ; la sélection restaurée doit suivre les éditions distantes.

## 2. Ce que Loro nous donne (vérifié expérimentalement, loro-crdt 1.10.6)

- `onPush(isUndo, counterRange, event)` est appelé à **chaque commit**, APRÈS le commit (un commit fusionné par `mergeInterval` appelle aussi `onPush`, mais l'élément gardé est le premier : sa valeur reste celle du premier commit du groupe). Il l'est aussi pour la pile *redo* : un `undo()` appelle `onPop(true, …)` puis `onPush(false, …)`.
- La valeur renvoyée par `onPush` est **sérialisée** : un objet `Cursor` vivant ressortirait de `onPop` comme un objet nu inutilisable. On y stocke donc `cursor.encode()` (`Uint8Array`) et on recrée avec `Cursor.decode`.
- Le mécanisme `cursors` de l'`UndoManager` (transformation des positions par Loro) donne des positions qui ne suivent pas les ids de caractères dans tous les cas (positions absolues recalculées). On ne l'utilise pas : `cursors: []`.
- Un `Cursor` Loro est lié à UN caractère (celui juste après la position ; fin du texte = sentinelle). `doc.getCursorPos` renvoie `{ offset, side, update? }` ; `update` est présent quand le caractère visé est supprimé. Un undo qui annule une suppression ré-insère des caractères NEUFS : un curseur lié à un caractère supprimé ne retombe pas au bon endroit.

## 3. Décision

### 3.1 Capture : la sélection d'AVANT le changement

`onPush` arrive après le commit, et un curseur Loro doit être créé sur le texte tel qu'il était AVANT la modification. On ne peut donc pas capturer dans `onPush`. `Nabu#captureUndoSelection()` garde en permanence la dernière sélection (`#undoSel`), rafraîchie tant que le modèle et le DOM concordent :

- `selectionchange`, `keydown` (phase capture, après `sync()`), et chaque `setBaseAndExtent` que l'éditeur fait lui-même ;
- jamais pendant une composition IME, pendant qu'un commit / un undo est en cours de rendu (`#busy`), ni avec une transaction Loro en attente (`getPendingTxnLength() > 0`) : le DOM retarde alors sur le modèle.

`onPush` n'a plus qu'à ranger `#undoSel` (celle d'avant l'action) dans la valeur de l'étape. Un caret décidé par l'appelant (`nabu.shortcut()` : juste après le trigger tapé) l'emporte pour cette étape, sans curseurs (le texte visé n'est pas celui sur lequel le changement s'applique).

### 3.2 Forme stockée (`undo-selection.js`)

`{ anchor, focus }` ; chaque extrémité : `blockId`, `path` (index d'enfant à chaque niveau), `offset`, id du conteneur de texte, `role` (`start` / `end`), et DEUX curseurs encodés : `next` (lié au caractère APRÈS la position) et `prev` (lié au caractère AVANT, lu +1). Pourquoi deux : si l'action supprime le caractère suivant (Delete, début d'une plage supprimée), `next` est mort ; si elle supprime le précédent (Backspace), `prev` l'est. À la résolution, celui dont le caractère est vivant (`update` absent) gagne ; deux vivants : le début d'une plage suit `prev`, le reste `next`. Les deux morts : la position (tombstone) de `next`. Anchor / focus distincts → direction et sélections multi-blocs gratuites.

### 3.3 Redo : où l'action s'est terminée

L'étape redo est poussée par l'`undo()` lui-même, à un moment où la sélection courante est celle d'après l'action, mais l'utilisateur a pu cliquer ailleurs entre-temps. On note donc, par fin de `counterRange` de l'étape d'undo, la sélection « posée » après l'action (`'settle'` : fin du commit une fois rendu, ou caret replacé par l'éditeur) ; l'`onPop` de l'undo mémorise la fin de l'étape défaite, et `onPush(false)` stocke cette sélection (repli : la sélection courante). Un `mousedown` fige cette note (`sealUndoEnd`).

### 3.4 Restauration

`onPop` → `restoreSelection` après `tick()` (les blocs recréés sont rendus), avec les nouvelles tentatives existantes si un bloc n'a pas encore d'élément. Résolution d'une extrémité : le bloc par id s'il est vivant ; sinon par chemin d'arbre (parcouru aussi loin qu'il existe, puis le bloc texte le plus proche) ; l'offset vient des curseurs si leur conteneur est celui du bloc courant, sinon l'offset stocké borné au texte. Placement par le pont de sélection (`setCursor` pour un caret, `setBaseAndExtent` pour une plage). Ensuite `revealFocus` : la fin mobile de la sélection est amenée à l'écran en `scrollIntoView({ block: 'nearest' })`, seulement si elle est hors de la zone visible (fenêtre et ancêtres scrollables).

## 4. Comportement collaboratif

- L'undo ne défait que les changements locaux (comportement Loro, inchangé).
- Une édition distante insérée avant la sélection la décale ; insérée à l'intérieur, elle l'étire ; les extrémités suivent les ids de caractères, pas des offsets. Test : deux `LoroDoc` synchronisés par `export` / `import` d'updates (`tests/unit/undo-selection.test.js`).
- Texte visé supprimé à distance : les deux extrémités se rejoignent, caret replié à la position la plus proche. Voisins supprimés aussi : tombstones, caret borné au texte.

## 5. Replis (rien ne lève, jamais de caret mort)

1. Bloc recréé par l'undo sous un NOUVEL id (Loro, depuis P-11) : le conteneur de texte a changé, les curseurs sont ignorés ; chemin d'arbre + offset stocké.
2. Chemin invalide / bloc disparu : le premier bloc texte du document.
3. Aucune sélection DOM capturable (éditeur sans focus, tests sans DOM) : le caret de l'état de sélection (`anchorBlock` + `startOffset`), comme avant.
4. Bloc sans texte (void, média) : bloc + chemin sans curseurs ; le bloc texte le plus proche reçoit le caret.

## 6. Conséquences

- Le cœur reste agnostique : `undo-selection.js` ne connaît que le comportement `text` (conteneur, `getDOMPoint`) ; il est dans la liste du test de garde.
- Coût : 4 `getCursor` par capture (une par `selectionchange` / `keydown`), à comparer à un rendu.
- Limite connue : un caret posé par l'application (`nabu.focus()`) après une action, sans `mousedown`, remplace la « fin d'action » mémorisée pour le redo.
