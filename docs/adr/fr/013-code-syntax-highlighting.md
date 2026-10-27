# ADR 013 : Coloration syntaxique des Code blocks — highlighter pluggable

## Statut
Proposé — **différé** (post chemin critique béta). Le `CodeBlock` v1 rend du texte brut monospace ; le seam décrit ici n'est pas encore implémenté.

## Contexte

Le `CodeBlock` (livré en v1, sans dépendance) stocke uniquement du texte (`LoroText` multi-ligne). On veut, à terme, une coloration syntaxique de qualité éditeur.

Intuition de départ (validée) : la coloration, c'est le même principe de rendu que nos marks `bold`/`italic` — transformer une string en une suite de segments stylés, puis rendre des `<span>` colorés. Et comme le mapping curseur (`getDOMPoint` / `calculateOffset`) parcourt les **text nodes** en comptant les caractères, il fonctionne **gratuitement** à travers ces spans — exactement comme RichText aujourd'hui.

### Correction conceptuelle clé : dérivé, pas stocké

Différence fondamentale avec les marks :
- Les marks bold/italic sont **stockées dans Loro** (donnée CRDT, appliquées par l'utilisateur, persistées).
- Les tokens de coloration sont une **fonction pure de `(texte, langage)`**, **recalculée au rendu**, **jamais persistée**. Les stocker serait redondant et source de désync.

→ Le `CodeBlock` garde son `LoroText` brut. La coloration est une couche **purement présentationnelle** : `segments = $derived(highlighter(text, language))`.

### Contrat invariant

Le rendu coloré doit préserver le texte **verbatim** :

```
tokens.map(t => t.text).join('') === texteSource
```

Aucun caractère ajouté/retiré, pas de reflow d'espaces, pas d'élément block injecté, pas de zero-width. Sinon le mapping curseur casse. La plupart des tokenizers respectent ça (Prism, TextMate, tree-sitter), à valider lib par lib.

## Options de tokenizer évaluées

### Prism (retenu pour la v1)
Pur JS, **synchrone**, `Prism.tokenize(text, grammar)` retourne directement un `Array<string | {type, content}>`. Se branche dans un `$derived`. Léger. Précision correcte. → meilleur match pour une intégration synchrone simple.

### Shiki (= tokenizer de VSCode)
Grammaires TextMate + oniguruma (WASM), thèmes VSCode. Fidélité maximale. Mais **async + WASM + lourd**, conçu pour du highlighting one-shot (build/serveur), peu adapté au recalcul par frappe. → option "fidélité VSCode" pour plus tard, en highlighter alternatif.

### tree-sitter / Lezer (CodeMirror)
Parsers **incrémentaux** (re-parse uniquement la région changée), niveau éditeur. Puissant mais intégration engageante. → réservé au cas "très gros blocs de code", endgame.

## Décision

**Highlighter pluggable, opt-in, le core reste sans dépendance.**

> Le `CodeBlock` reste *dumb* : il expose `segments = $derived(highlighter(text, language))`. Le `highlighter` est une **fonction injectable** `(text: string, language: string | null) => Array<{ text: string, scope?: string }>`, dont le **défaut est l'identité** (un seul segment, sans couleur — rendu brut actuel). Un `PrismHighlightExtension` **opt-in** fournit le highlighter + le CSS des scopes (branché sur les tokens `--nb-*`). Quiconque veut Shiki branche le sien.

Cohérent avec l'invariant opt-in de la béta et le dogme extension-first : la coloration est un add-on, jamais dans le core.

## Architecture (à implémenter)

1. **Seam de rendu** — `Code.svelte` rend depuis `block.segments` (et non plus `{block.text}`), chaque segment en `<span class="nabu-tok-{scope}">`. L'invariant verbatim garantit que le curseur retombe juste.
2. **Injection du highlighter** — résolu via un registre (ex. `nabu.codeHighlighter`) alimenté par l'extension opt-in ; défaut = identité. Le `CodeBlock.segments` lit ce highlighter.
3. **`PrismHighlightExtension`** — opt-in (jamais dans MinimalPreset). Charge Prism + la grammaire du langage à la demande, fournit le highlighter, embarque le CSS de scopes thémé.
4. **Garde IME** — ne PAS re-tokenizer/re-rendre pendant une composition active (`#composing`, cf. ADR/issue #6) pour ne pas casser la frappe CJK.
5. **Curseur** — aucune machinerie nouvelle : le `tick().then(() => setCursor(block, offset))` post-mutation existant repositionne le caret par offset modèle sur les nouveaux spans.
6. **Performance** — v1 : full re-tokenize au changement (négligeable pour des blocs normaux). Parsing incrémental (tree-sitter/Lezer) réservé aux très gros blocs, plus tard. Debounce possible si besoin (rendu brut instantané, couleurs un tick après).

## Conséquences

✅ Core `CodeBlock` sans dépendance ; la coloration est un choix de l'intégrateur (Prism / Shiki / aucune).
✅ Réutilise intégralement le mapping curseur span-aware existant — zéro nouvelle logique de sélection.
✅ Rien dans Loro : pas de pollution CRDT, pas de désync possible.
✅ Candidat "wow" idéal pour la démo de lancement béta.
⚠️ L'invariant `join === source` doit être vérifié pour chaque lib de tokenization adoptée.
⚠️ Re-tokenize par frappe = coût O(n) par bloc ; acceptable en v1, à surveiller sur très gros blocs.
⚠️ Doit cohabiter avec le garde IME pour ne pas perturber la composition.
