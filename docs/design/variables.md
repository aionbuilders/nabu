# Design Document : Variables — Réflexion Pré-ADR

> **Statut** : Exploration — Mai 2026
> **Objectif** : Concevoir un système de variables inline scopées, natives à Nabu, avant toute implémentation.
> Ce document deviendra la base d'un ou plusieurs ADRs formels.

---

## 1. Le problème

Un auteur qui structure son document en zones — actes, chapitres, scènes — veut pouvoir écrire dans un heading :

```
# Chapitre {{index}} — {{title}}
```

…et que `{{index}}` affiche automatiquement la position de la zone parente, et `{{title}}` affiche son titre — de manière bidirectionnelle : modifier le texte `{{title}}` inline modifie le titre de la zone, et vice versa.

Ce n'est pas une feature de surface. C'est une conséquence logique du fait que Nabu unifie structure et contenu dans un seul arbre de blocs. Les variables sont le mécanisme qui rend cette unification *exploitable*.

---

## 2. Principes fondateurs

**P1 — Les variables sont des interfaces entre blocs, pas une feature de Nabu.**
Nabu est le bus. `ZoneExtension` déclare `title`, `index`, `wordCount`. Un heading qui utilise `{{title}}` ne sait pas qu'il parle à une zone — il parle à "l'ancêtre le plus proche qui expose une variable nommée `title`".

**P2 — La résolution est lexicalement scopée.**
Exactement comme les variables dans un langage de programmation. `{{title}}` se résout dans l'ancêtre le plus proche qui déclare ce nom, jusqu'aux globaux Nabu. Les zones imbriquées créent des scopes imbriqués.

**P3 — La résolution est à la render time, pas stockée.**
Le document stocke une *référence* (`{{title}}`), jamais la valeur résolue. L'export peut résoudre au moment de sérialiser.

**P4 — Toute variable writable est bidirectionnelle.**
Une variable `writable: true` n'est pas un "lien" vers la propriété — c'est la même donnée rendue à deux endroits. Taper dans `{{title}}` inline modifie `zone.title` en temps réel, sans notion de "sync".

**P5 — Agnosticité complète.**
Nabu ne connaît ni zones, ni chapitres, ni aucun type de bloc spécifique. N'importe quelle extension peut déclarer des variables. N'importe quel bloc peut les consommer.

---

## 3. Anatomie d'une variable

Une variable a :

| Champ | Type | Description |
|-------|------|-------------|
| `canonical` | `string` | Nom canonique (`title`, `index`, `wordCount`) |
| `aliases` | `Record<string, string[]>` | Alias par locale — permet d'écrire `{{titre}}` en FR |
| `type` | `'string' \| 'number' \| 'date' \| 'boolean'` | Type de la valeur résolue |
| `writable` | `boolean` | Si `true`, éditable inline dans le document |
| `resolve` | `(block) => value` | Calcule la valeur depuis le bloc déclarant |
| `write` | `(block, value) => void` | Applique une nouvelle valeur (writable uniquement) |

### Exemple — déclaration dans ZoneExtension

```js
variables: {
    'title': {
        aliases: { fr: ['titre', 'nom'], en: ['title', 'name'] },
        type: 'string',
        writable: true,
        resolve: (block) => block.title,
        write:   (block, value) => { block.title = value; }
    },
    'index': {
        aliases: { fr: ['numero', 'index'], en: ['index', 'number'] },
        type: 'number',
        writable: false,
        resolve: (block) => block.index + 1,  // 1-based
    },
    'wordCount': {
        aliases: { fr: ['mots'], en: ['words'] },
        type: 'number',
        writable: false,
        resolve: (block) => block.wordCount,
    },
    'status': {
        aliases: { fr: ['statut'], en: ['status'] },
        type: 'string',
        writable: true,
        resolve: (block) => block.status,
        write:   (block, value) => { block.status = value; }
    }
}
```

### Variables globales (déclarées par Nabu lui-même)

```js
// Nabu-level globals, resolved from root
variables: {
    'date':          { type: 'date',   writable: false, resolve: () => new Date() },
    'author':        { type: 'string', writable: true,  resolve: (nabu) => nabu.meta.author },
    'documentTitle': { type: 'string', writable: true,  resolve: (nabu) => nabu.meta.title },
}
```

---

## 4. Algorithme de résolution

`nabu.resolveVariable(fromBlock, nameOrAlias)` :

1. Pour chaque ancêtre de `fromBlock` (de parent en parent) :
   - Récupère l'extension du type de ce bloc
   - Vérifie si elle déclare une variable dont le canonical ou un alias matche `nameOrAlias`
   - Si oui → appelle `descriptor.resolve(ancestorBlock)` → retourne la valeur
2. Si la racine est atteinte sans match → vérifie les globaux Nabu
3. Sinon → retourne `undefined` (variable non résolue)

L'algorithme matche sur le canonical ET sur tous les alias de toutes les locales déclarées. `{{titre}}` résout identiquement à `{{title}}` si `titre` est un alias FR.

### Résolution des disponibles (pour le picker)

`nabu.resolveAvailableVariables(fromBlock)` retourne la liste complète triée :

```js
[
    // depth: 1 — zone parente immédiate
    { canonical: 'title',     depth: 1, scope: nearestZone, writable: true  },
    { canonical: 'index',     depth: 1, scope: nearestZone, writable: false },
    { canonical: 'wordCount', depth: 1, scope: nearestZone, writable: false },
    { canonical: 'status',    depth: 1, scope: nearestZone, writable: true  },

    // depth: 2 — zone grand-parente (si imbriquée)
    { canonical: 'title',     depth: 2, scope: parentZone,  writable: true, shadowed: true },

    // depth: Infinity — globaux Nabu
    { canonical: 'date',          depth: Infinity, scope: 'global' },
    { canonical: 'author',        depth: Infinity, scope: 'global' },
    { canonical: 'documentTitle', depth: Infinity, scope: 'global' },
]
```

Tri : `depth` croissant, puis `canonical` alphabétique. Les variables shadowées (même nom à plusieurs niveaux) sont marquées `shadowed: true` et affichées différemment dans le picker.

---

## 5. Stockage dans Loro

Les références inline sont stockées dans le delta LoroText via des **attributs custom sur des spans**. Le texte stocké est le nom canonique de la variable (pas la valeur résolue).

```js
// Heading : "Chapitre {{index}} — {{title}}"
delta: [
    { insert: "Chapitre " },
    { insert: "index", attributes: { "nabu-var": "index" } },
    { insert: " — " },
    { insert: "title", attributes: { "nabu-var": "title" } },
]
```

Les `{{` et `}}` sont des artefacts visuels rendus par le composant variable, pas stockés dans le delta.

### Avantages de cette approche
- LoroText supporte les attributs nativement — CRDT-safe, pas de hack
- La valeur stockée est la clé de résolution, pas la valeur résolue → toujours fraîche
- Compatible avec les styles existants (bold, italic) sur les mêmes spans
- Sérialisable proprement : en export, on substitue avant de sérialiser

### Contrainte
Le renderer doit traiter les spans `nabu-var` comme des nœuds non-texte. L'implémentation du TextBehavior/RichText doit être étendue pour rendre des composants inline à ces positions.

---

## 6. Rendu et édition inline

### Variables read-only (`writable: false`)

- Rendu : `<span class="nabu-var nabu-var--readonly">3</span>` (valeur résolue)
- Caret : le normalizer de sélection les traite comme des éléments inerts — le caret saute par-dessus
- Hover : tooltip montrant le nom de la variable et sa source (`index depuis Zone "Partie II"`)

### Variables writable (`writable: true`)

- Rendu : `<span class="nabu-var nabu-var--writable" contenteditable="true">La forêt</span>` en mode display
- Activation : click ou caret qui entre dedans → mode édition
- Frappe : chaque caractère appelle `descriptor.write(ancestorBlock, newValue)` en temps réel
- `Enter` / `Tab` : sort du field, place le caret après
- `Escape` : sort du field sans changement supplémentaire (mais les changements déjà tapés sont committés — pas d'annulation atomique pour ne pas complexifier l'undo)
- Contrainte : interdit le retour à la ligne (`Enter` = sortie, pas insertion)

### Référence circulaire

Si `{{title}}` est utilisé à l'intérieur du title input d'une zone (`data-nabu-ui`), la résolution est blacklistée. Le normalizer de sélection exclut déjà les éléments `data-nabu-ui` — le même mécanisme protège contre la circularité.

---

## 7. Le picker — UX d'insertion

### Déclenchement

Dans un `beforeinput` hook, Nabu détecte la séquence `{` + `{` consécutive. Au deuxième `{`, le picker s'ouvre à la position du caret.

Alternative : détecter `{{` comme préfixe complet après la frappe (pattern plus robuste à la composition IME).

Escape pendant la saisie du nom : le picker se ferme et `{{` est inséré comme texte littéral.

### Affichage du picker

```
┌─────────────────────────────────────────────┐
│ 🔍  titre                                   │
├──────────────────────────────────────────────┤
│ ◈  title        Zone "Partie II"   writable │
│ ◈  title        Zone "Acte I"      · caché  │  ← shadowé
│ ○  wordCount    Zone "Partie II"            │
│ ─────────────────────────────────────────── │
│ ○  date         Global                      │
│ ○  documentTitle Global            writable │
└─────────────────────────────────────────────┘
```

- `◈` = writable, `○` = read-only
- Filtrage : fuzzy search sur canonical ET tous les alias
- Navigation : flèches + Enter pour sélectionner, Escape pour annuler
- Sélection → insère le span `nabu-var` dans le delta, ferme le picker

---

## 8. Sérialisation

| Format | Comportement |
|--------|-------------|
| `application/x-nabu+json` (interne) | Préserve la référence — `{ insert: "title", attributes: { "nabu-var": "title" } }` |
| `text/plain` / Markdown export | Substitue par la valeur résolue au moment de l'export — `Chapitre 3 — La forêt` |
| `text/html` export | Substitue par la valeur résolue, sans markup variable |
| Clipboard copy | Copie la référence en format interne, la valeur résolue en plain/html |

---

## 9. Copy-paste cross-contexte

Si l'utilisateur copie `# Chapitre {{index}} — {{title}}` depuis une zone et le colle dans une autre :

- La référence est copiée telle quelle (pas la valeur résolue)
- Dans le nouveau contexte, `{{index}}` se résout automatiquement sur la nouvelle zone parente
- `{{title}}` idem — la bidirectionnalité suit le nouveau scope

C'est le comportement *souhaité* : les références sont relatives, comme des variables locales en programmation. Ce n'est pas un bug à gérer — c'est une force architecturale à documenter.

Cas limite : coller dans un contexte sans aucune zone parente. La variable est "non résolue" → affichage d'un placeholder visuel distinctif (`{{title}}`), pas d'erreur.

---

## 10. Découpage d'implémentation

Le système complet se coupe en deux phases distinctes avec de la valeur indépendante.

### Phase 1 — Le registre et la résolution (sans UI inline)

- `NabuVariableRegistry` : classe gérant l'enregistrement et la résolution
- `Extension` : nouvel champ `variables` dans `ExtensionInit`
- `nabu.resolveVariable(block, name)` et `nabu.resolveAvailableVariables(block)`
- Globaux Nabu déclarés dans le core
- **Valeur immédiate** : utilisable programmatiquement par les composants (breadcrumb, compteurs, futures features)

### Phase 2 — Les variables inline dans le texte

- Extension du renderer RichText pour les spans `nabu-var`
- Composant `InlineVar.svelte` (read-only et writable)
- Gestion du caret autour des variables (normalizer)
- Le picker avec détection `{{` et autocomplete
- Sérialisation différenciée
- **Prérequis** : un concept d'"inline node" stable dans le RichText renderer

---

## 11. Questions ouvertes

- **Syntaxe de référence croisée** : comment référencer explicitement une zone spécifique (pas juste la plus proche) ? `{{zone:abc123.title}}` ? Ou laisser ça pour plus tard ?
- **Réactivité de `resolveAvailableVariables`** : doit être un `$derived` pour que le picker se mette à jour si le scope change pendant que le picker est ouvert. Coût de calcul à évaluer.
- **Undo/redo sur les variables writables** : taper dans `{{title}}` crée-t-il des steps d'undo dans l'historique de l'éditeur, ou sont-ils dans l'historique de la propriété de la zone ? Les deux ? Aucun ?
- **Types avancés** : `enum` pour `status` (afficher un select plutôt qu'un input texte) ? `date` avec un date-picker ?
- **Variables déclarées par des blocks non-extension** : est-ce qu'un bloc peut déclarer des variables dynamiquement (pas via son extension) ? Cas d'usage : un bloc "variable personnalisée" que l'utilisateur crée lui-même.
