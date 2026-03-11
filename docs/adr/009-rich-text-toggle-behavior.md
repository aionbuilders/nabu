# ADR 009 : Comportement Global du Toggle de Marks Rich Text

## Statut
Accepté — *Mars 2026*

## Contexte

Lorsqu'un raccourci clavier applique une mark (ex: Ctrl+B pour le gras) sur une sélection pouvant couvrir **plusieurs blocs**, le comportement attendu n'était pas défini. Deux approches étaient possibles :

**Option A — Toggle par bloc indépendant :** Chaque bloc décide seul de toggler en fonction de son propre état interne. Problème : un bloc entièrement gras retire le gras, pendant qu'un bloc partiellement gras l'applique → résultat incohérent.

**Option B — Toggle global (standard éditeur) :** On évalue l'état de la mark sur l'ensemble de la sélection, puis on applique ou retire uniformément.

## Décision

Adoption du **comportement standard des éditeurs** (Notion, Word, Google Docs, ProseMirror) :

> **Si la mark est entièrement active sur toute la sélection → la retirer partout.
> Sinon (partielle ou absente) → l'appliquer partout.**

Implémenté dans `RichTextExtension` (`src/behaviors/text/rich-text.extension.js`) via deux passes :

```javascript
// Passe 1 : collecte et évaluation globale
const targets = []; // { behavior, sel } pour chaque bloc sélectionné
const isFullyActive = targets.every(({ behavior, sel }) => behavior.isMarkActive(markName, sel));

// Passe 2 : action uniforme
for (const { behavior, sel } of targets) {
    if (isFullyActive) behavior.removeMark(markName, sel);
    else behavior.applyMark(markName, true, sel);
}
```

La méthode `isMarkActive(markName, sel)` sur `TextBehavior` retourne `true` uniquement si **chaque opération** du delta dans la plage sélectionnée possède la mark. Un seul segment sans la mark suffit à retourner `false`.

## Conséquences

- **Cohérence UX :** Comportement identique à tous les éditeurs grand public — aucune surprise utilisateur
- **Multi-blocs natif :** Fonctionne correctement sur une sélection traversant N blocs
- **Zéro duplication :** La logique de détection (`isMarkActive`) reste dans `TextBehavior`, seule la coordination multi-blocs est dans l'extension
