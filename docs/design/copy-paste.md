# Design Document : Copy / Paste — Réflexion Pré-ADR

> **Statut** : Exploration — Mars 2026
> **Objectif** : Poser toute la réflexion architecturale avant de coder quoi que ce soit.
> Ce document deviendra la base d'un ou plusieurs ADRs formels.

---

## 1. Pourquoi c'est difficile dans Nabu

Le copy/paste semble trivial jusqu'à ce qu'on réalise que trois contraintes fondamentales se croisent :

**Contrainte 1 — Single ContentEditable.**
Le browser gère nativement la copie du DOM sélectionné et produit `text/plain` + `text/html`. Mais pour le paste, il faut *tout* intercepter : laisser le browser injecter du HTML directement dans le DOM est une catastrophe dans notre architecture (le DOM est une représentation *read-only* de Loro, jamais une source de vérité).

**Contrainte 2 — CRDT comme source de vérité.**
Toute mutation passe par Loro. Un paste n'échappe pas à cette règle. Ça implique de parser le contenu clipboardé *avant* de l'insérer via l'API Loro, et de gérer l'atomicité (un paste = une transaction = un seul step d'undo).

**Contrainte 3 — Modularité extrême.**
Nabu ne connaît pas les types de blocs à l'avance. Un `ParagraphExtension` n'est pas en dur dans le moteur. Comment le moteur peut-il savoir comment parser un `<h2>` entrant si `HeadingExtension` n'est pas chargé ? Comment parser du Markdown si `MarkdownPasteExtension` n'est pas installé ?

---

## 2. Décomposition du problème

Le copy/paste n'est pas un seul problème, c'est **cinq problèmes distincts** :

| # | Problème | Complexité |
|---|----------|-----------|
| A | **Capture** — Que met-on dans le clipboard à la copie ? | Moyenne |
| B | **Interprétation** — Que fait-on du contenu collé ? | Haute |
| C | **Stratégie texte** — Plain text = texte pur ou Markdown ? | Décision |
| D | **Insertion** — Comment splice-t-on les blocs parsés dans le document ? | Très haute |
| E | **Compatibilité structurelle** — Que fait-on quand les types ne matchent pas ? | Haute |

---

## 3. Problème A — Capture (Copy & Cut)

### 3.1 Ce que le browser fait nativement

Lors d'un `Ctrl+C` sur un Single CE, le browser écrit automatiquement dans le clipboard :
- `text/plain` : le texte visible, avec des sauts de ligne entre les block-level elements
- `text/html` : le HTML brut de la sélection DOM (contient les spans des marks, les data-attributes, etc.)

Le `text/plain` natif est souvent acceptable. Le `text/html` natif est trop verbeux (plein de classes CSS internes, data-block-id, etc.).

### 3.2 Notre stratégie : intercept + enrichissement

On intercepte l'événement `copy` (et `cut`) pour :
1. Laisser le browser calculer `text/plain` (ou le réécrire proprement)
2. **Ajouter** notre format custom `application/x-nabu+json` — un fragment sérialisé fidèle
3. **Réécrire** `text/html` avec une représentation propre (sans noise interne)

```
[copy event intercepté]
  ├── text/plain     → texte brut propre (sauts de ligne entre blocs)
  ├── text/html      → HTML sémantique propre (<h2>, <strong>, <ul>...)
  └── application/x-nabu+json → fragment JSON haute fidélité
```

On appelle `e.preventDefault()` pour contrôler tous les formats.

### 3.3 Le format `application/x-nabu+json` — Fragment

C'est le format interne. Il doit encoder :
- Le type de chaque bloc
- Les propriétés du bloc (ex: `level` pour heading)
- Le contenu riche (delta Loro)
- La structure imbriquée (pour les MegaBlocks)
- Si le bloc est **partiel** (premier/dernier d'une sélection) ou **complet**

```json
{
  "version": "1",
  "blocks": [
    {
      "type": "paragraph",
      "partial": "start",
      "delta": [{ "insert": "ello " }, { "insert": "World", "attributes": { "bold": true } }]
    },
    {
      "type": "heading",
      "partial": false,
      "props": { "level": 2 },
      "delta": [{ "insert": "Un titre complet" }]
    },
    {
      "type": "list",
      "partial": false,
      "children": [
        { "type": "list-item", "delta": [{ "insert": "Item 1" }] },
        { "type": "list-item", "delta": [{ "insert": "Item 2" }] }
      ]
    },
    {
      "type": "paragraph",
      "partial": "end",
      "delta": [{ "insert": "Wor" }]
    }
  ]
}
```

Le flag `partial` vaut `"start"`, `"end"`, `false` (complet) ou `"both"` (sélection dans un seul bloc).

### 3.4 Sérialisation de la sélection pour la capture

Pour construire ce fragment, on part de `nabu.selection` :
- `startBlock` + `startOffset` → premier bloc, on slice de `startOffset` à la fin
- Blocs intermédiaires → delta complet
- `endBlock` + `endOffset` → dernier bloc, on slice du début à `endOffset`
- Cas particulier : `startBlock === endBlock` → fragment à un seul bloc, partial = "both"

La sérialisation du delta partiel s'appuie sur `container.sliceDelta(from, to)` qui existe déjà dans `TextBehavior`.

### 3.5 Le Cut

Cut = Copy + Delete. La suppression est identique à un `deleteContentBackward` sur une sélection étendue — le mécanisme spine de `handleContainerBeforeInput` déjà existant s'en charge. Les deux opérations (copy + delete) doivent être atomiques pour Undo : une seule transaction Loro, un seul step.

---

## 4. Problème B — Interprétation (Paste)

### 4.1 Événement à intercepter

On intercepte l'événement `paste` (pas `beforeinput` avec `insertFromPaste`, qui ne donne pas accès à `ClipboardData` de façon fiable dans tous les browsers). On appelle `e.preventDefault()` systématiquement.

### 4.2 La chaîne d'interprétation — priorités

```
ClipboardData disponible
  │
  ├─ application/x-nabu+json ?  →  NabuInterpreter   (priorité max, fidélité totale)
  │
  ├─ text/html ?                →  HtmlInterpreter    (fidélité partielle)
  │
  └─ text/plain ?               →  PlainTextInterpreter | MarkdownInterpreter
                                    (selon configuration)
```

Chaque interpréteur reçoit la donnée brute et retourne un **PasteFragment** (tableau de `PasteBlock`) ou `null` s'il ne peut pas traiter ce format.

### 4.3 Les interpréteurs comme extensions

Chaque interpréteur est déclaré dans une extension, via une nouvelle propriété `pasteInterpreters` :

```js
new Extension('nabu-paste', {
    pasteInterpreters: [
        {
            format: 'application/x-nabu+json',
            priority: 100,
            interpret: (raw, nabu) => JSON.parse(raw)  // retourne PasteFragment
        }
    ]
});
```

La propriété `priority` (entier) permet d'ordonner les interpréteurs si plusieurs extensions veulent gérer le même format. Plus la valeur est haute, plus l'interpréteur est appelé en premier. Un interpréteur retournant `null` passe la main au suivant.

### 4.4 Interpréteur HTML

L'`HtmlInterpreter` parse le HTML via un DOMParser, puis mappe les éléments HTML vers les types de blocs Nabu **en interrogeant le registre** :

```
<h1>…<h6>  →  heading (HeadingExtension doit être chargé, sinon paragraph)
<p>         →  paragraph
<ul>/<ol>   →  list + list-items (ListExtension doit être chargé)
<li>        →  list-item
<blockquote>→  ? (extension custom si présente, sinon paragraph)
<strong>/<b>→  mark bold
<em>/<i>    →  mark italic
<u>         →  mark underline
<code>      →  mark code
<s>/<del>   →  mark strikethrough
<a href="">  →  mark link (si LinkExtension chargé, sinon texte brut)
```

Principe clé : si un type de bloc HTML n'a pas de correspondance dans le registre Nabu actuel, on **dégrade gracieusement** vers le type le plus proche (généralement `paragraph`). L'interpréteur n'a jamais de comportement catastrophique.

Problème de la sanitisation : le HTML entrant peut contenir des `<script>`, `<iframe>`, des `onclick=`, etc. On **sanitise obligatoirement** avant de parser (liste blanche d'éléments autorisés, pas de liste noire).

### 4.5 Interpréteur Plain Text

Comportement minimal :
- Splitter sur `\n\n` (double saut de ligne) → blocs séparés (paragraphes)
- Splitter sur `\n` simple → sauts de ligne dans le même bloc (soft break)
- Chaque fragment de texte → `{ type: 'paragraph', delta: [{ insert: texte }] }`
- Aucune interprétation des caractères spéciaux (`*`, `#`, `-`, etc.)

C'est le comportement par défaut, sûr et prévisible.

---

## 5. Problème C — Stratégie Plain Text : pur ou Markdown ?

### 5.1 La question

Quand on colle du `text/plain` qui ressemble à du Markdown :
```
# Mon titre

Du texte avec **gras** et *italique*

- Item 1
- Item 2
```

Doit-on le parser comme Markdown ou l'insérer comme texte littéral ?

### 5.2 Les camps

**Camp "texte pur" :**
- Prévisible. Un `*` reste un `*`. Un `#` reste un `#`.
- Pas de mauvaise surprise quand on colle du code ou des regex.
- Compatible avec le comportement standard des éditeurs de texte classiques.

**Camp "Markdown" :**
- Intuitif pour les auteurs qui copient depuis des fichiers `.md` ou des outils Markdown.
- Permet d'importer rapidement du contenu riche depuis l'extérieur.
- Risque : casser du contenu qui n'était pas du Markdown (`--help`, `_var_name_`, etc.)

### 5.3 Décision proposée : extensible, défaut plain

**Le moteur de base traite le `text/plain` comme texte pur.** C'est le comportement de secours.

Un `MarkdownPasteInterpreter` est disponible comme extension optionnelle. Quand il est chargé, il a une priorité plus haute que le `PlainTextInterpreter` pour le format `text/plain`.

```js
// Dans un preset riche :
const FullPreset = [
    ParagraphExtension,
    HeadingExtension,
    ListExtension,
    ...,
    MarkdownPasteExtension,  // opt-in
];
```

### 5.4 Option de configuration au niveau éditeur

On peut aussi exposer une option de configuration à la création :

```js
createEditor({
    preset: DocumentPreset,
    paste: {
        textStrategy: 'plain'    // 'plain' | 'markdown' | 'auto'
    }
});
```

L'option `'auto'` serait une heuristique : si le texte collé commence par `# ` ou contient des patterns Markdown reconnaissables ET que les extensions correspondantes sont chargées → parser en Markdown. Sinon → texte pur. Ce mode "auto" est complexe et risqué, **non prioritaire pour l'implémentation initiale**.

### 5.5 Le MarkdownPasteInterpreter comme extension séparée

L'avantage d'en faire une extension : il peut enregistrer ses propres règles de mapping Markdown → types de blocs, en cohérence avec les extensions chargées. Si `HeadingExtension` n'est pas chargé, il ne produit pas de blocs heading. Dépendance déclarative.

---

## 6. Problème D — Insertion (l'algorithme principal)

C'est la partie la plus complexe. On dispose d'un `PasteFragment` (tableau de `PasteBlock`) et d'une position dans le document. Comment l'insère-t-on ?

### 6.1 Pré-condition : suppression de la sélection

Si la sélection est étendue (range), on supprime le contenu sélectionné **avant** d'insérer. Cette suppression est identique à celle du `beforeinput` de type `deleteContentBackward` sur une sélection étendue — le mécanisme spine de `handleContainerBeforeInput` s'en charge. Après cette suppression, la sélection est collapsée à un curseur.

### 6.2 Classification des fragments

| Fragment | Description | Traitement |
|----------|-------------|-----------|
| **Inline** | 1 bloc, partial "both" | Insertion de texte pur + marks dans le bloc courant |
| **Single** | 1 bloc complet | Insertion inline du texte (type ignoré), marks préservées |
| **Multi** | N blocs | Algorithme split + merge |

### 6.3 Cas 1 : Fragment inline (un seul bloc, partiel)

Le cas le plus fréquent (copie d'un morceau de texte dans un même bloc, ou copie depuis l'extérieur d'une ligne de texte).

```
[Para: "Hello |World"]   cursor à position 5
paste fragment: { type: 'paragraph', partial: 'both', delta: [{insert: 'foo', attributes:{bold:true}}] }

→ Insérer le delta à l'offset courant dans le bloc courant
→ [Para: "Hello fooWorld"]  (avec "foo" en gras)
```

Logique : `textBehavior.applyDelta([{retain: offset}, ...fragment.blocks[0].delta])`. La transaction Loro est atomique.

Cas particulier : si le fragment inline ne contient que du texte sans marks, c'est un simple `textBehavior.insert(offset, text)`.

### 6.4 Cas 2 : Fragment à N blocs (N ≥ 2)

C'est l'algorithme central. On part d'un curseur dans `currentBlock` à `cursorOffset`.

```
Document :
  [Para: "Hello |World"]

Paste fragment :
  [Para: "A", H2: "Titre", Para: "B"]

Étapes :
  1. Sauvegarder le "right fragment" : sliceDelta(cursorOffset, end) de currentBlock
     → delta_right = [{insert: "World"}]

  2. Supprimer le right fragment du bloc courant (tronquer à cursorOffset)
     → currentBlock devient [Para: "Hello"]

  3. Merger le first pasted block dans currentBlock
     → currentBlock.textBehavior.applyDelta([{retain: cursorOffset}, ...delta_A])
     → currentBlock devient [Para: "HelloA"]

  4. Insérer les blocs intermédiaires en tant que nouveaux frères
     → Créer [H2: "Titre"] après currentBlock

  5. Créer le dernier bloc à partir du last pasted block,
     y appliquer le right fragment
     → Créer [Para: "B"], puis applyDelta([{retain: length("B")}, ...delta_right])
     → dernier bloc = [Para: "BWorld"]

  6. Placer le curseur à la fin du dernier bloc inséré (position = length("BWorld"))

Résultat :
  [Para: "HelloA"]
  [H2: "Titre"]
  [Para: "BWorld"]
```

**Règle des types aux bornes :**
- **Bord gauche** (fusion avec currentBlock) : le TYPE du currentBlock survit. Seul le delta du premier bloc collé est absorbé.
- **Bord droit** (dernier bloc collé + right fragment) : le TYPE du dernier bloc collé survit. Le right fragment y est appendé.

Cette règle est intuitive : je tape dans un Heading et je colle plusieurs paragraphes → mon Heading garde son niveau ; le dernier paragraphe collé absorbe ma suite de texte.

### 6.5 Cas du curseur en début ou fin de bloc

**Curseur au début du bloc (offset 0) :**
- Il n'y a pas de "left fragment" à préserver.
- Le premier bloc collé s'insère avant le bloc courant (ou le remplace si le premier bloc est inline).
- Le type du currentBlock passe au dernier bloc de la liste pasted.

Ou plus simplement : on considère que le right fragment est tout le texte du currentBlock, et le left fragment est vide. L'algorithme normal s'applique.

**Curseur à la fin du bloc (offset = length) :**
- Il n'y a pas de "right fragment" à récupérer.
- On insère tous les blocs après le currentBlock.
- Le dernier bloc collé reste intact (aucune fusion nécessaire).

### 6.6 Atomicité Undo

Toute la séquence (suppression de la sélection si range + insertion) doit être **une seule transaction Loro** → un seul step d'undo. On ne fait `nabu.commit()` qu'une seule fois à la fin de toute l'opération.

### 6.7 Restauration du curseur

Après le paste, le curseur se place **à la fin du dernier contenu inséré** :
- Fragment inline → après le texte inséré
- Fragment multi-blocs → fin du dernier bloc créé

---

## 7. Problème E — Compatibilité structurelle

### 7.1 Le problème

On colle un fragment contenant un `ListItem` dans un Paragraph au niveau racine. Un `ListItem` a un `requiredParent: { type: 'list' }`. Il n'a pas de List parent → `wrapOrphan` doit s'en charger.

On colle un fragment contenant des Paragraphes dans une `List` (entre deux `ListItems`). Les Paragraphes n'appartiennent pas à une List → `wrapOrphan` les wrappera en `ListItems`.

### 7.2 La bonne nouvelle

Le mécanisme `wrapOrphan` existe déjà dans `container.utils.js`. Il est appelé après chaque relocalisation de blocs. **L'insertion de blocs collés doit passer par le même mécanisme.**

Concrètement, quand on insère un bloc collé dans le document :
1. On crée le nœud Loro via `BlockClass.create()`
2. On le positionne via `node.moveAfter()`
3. On appelle `wrapOrphan(nabu, block)` immédiatement après

Aucun cas spécial à écrire — c'est le contrat déjà en place.

### 7.3 Blocs non enregistrés dans le fragment

Que fait-on si le fragment contient `{ type: 'heading' }` mais que `HeadingExtension` n'est pas chargé ?

**Règle de dégradation** : si le type n'est pas dans le registre, on tente de créer un `paragraph` à la place en préservant le contenu texte. Si `paragraph` non plus n'est pas enregistré → on ignore ce bloc.

C'est l'interpréteur qui doit appliquer cette règle *avant* de retourner le fragment — il peut consulter `nabu.registry` pour vérifier quels types sont disponibles.

### 7.4 Collage dans un bloc non-texte

Que se passe-t-il si le curseur est dans un bloc qui n'a pas de `TextBehavior` (ex: un futur bloc Image) ?

Comportement attendu : on insère le fragment *autour* du bloc courant (avant/après selon la position), pas *dans* le bloc. Les blocks sans TextBehavior ne peuvent pas absorber du texte.

---

## 8. Edge cases recensés

| # | Cas | Comportement attendu |
|---|-----|---------------------|
| 1 | Paste dans document vide | Créer les blocs normalement, pas de split |
| 2 | Paste en tout début du premier bloc (offset 0) | Blocs insérés avant, right fragment dans le dernier bloc collé |
| 3 | Paste en toute fin du dernier bloc | Blocs insérés après, pas de fusion de bord droit |
| 4 | Selection = tout le document | Supprimer tout, puis coller = remplacement total |
| 5 | Fragment d'un seul caractère | Inline insert pur, identique à `insertText` |
| 6 | Paste de HTML avec `<script>` ou `onclick` | Sanitisation stricte, élément ignoré silencieusement |
| 7 | Paste de HTML complexe (tableaux, formulaires) | Dégradation vers texte plat avec structure préservée si possible |
| 8 | Paste d'une liste dans une liste | ListItems collés deviennent frères des ListItems courants |
| 9 | Paste d'un ListItem orphelin au niveau racine | `wrapOrphan` crée une List wrapper automatiquement |
| 10 | Paste de texte multiligne dans un ListItem | Chaque ligne → nouveau ListItem |
| 11 | Fragment très large (1000+ blocs) | Pas de limite en théorie, mais pagination/virtualisation à prévoir si besoin |
| 12 | Paste depuis un autre tab du même éditeur | Format `application/x-nabu+json` capturé, fidélité totale |
| 13 | Paste depuis un autre éditeur Nabu (version différente) | Version-check dans le format, dégradation si incompatible |
| 14 | Ctrl+Z après paste | Un seul step d'undo → tout le paste est annulé |
| 15 | Paste avec sélection multi-blocs | Suppression sélection d'abord (spine), puis insertion |
| 16 | Cut + Paste (déplacement) | Cut = Copy + Delete (atomique), Paste = insertion normale |
| 17 | Paste dans un Dialogue | Contenu texte collé dans le bloc dialogue, structure blocks → ListItem-like comportement ? |
| 18 | Paste de texte avec retours à la ligne soft (`\n`) | `\n` seul → soft break dans le même bloc ; `\n\n` → nouveau bloc |
| 19 | `text/html` sans `application/x-nabu` (paste depuis Gmail, Notion, etc.) | HTML interpreter → blocs Nabu |
| 20 | `text/html` malformé | DOMParser tolère la plupart des malformations, dégradation silencieuse |

---

## 9. Architecture des composants

### 9.1 Nouveaux éléments dans le système d'extensions

**Propriété `pasteInterpreters` sur `Extension` :**
```js
/**
 * @typedef {Object} PasteInterpreter
 * @property {string} format - MIME type géré ('application/x-nabu+json', 'text/html', 'text/plain')
 * @property {number} priority - Plus haut = appelé en premier (default: 0)
 * @property {(raw: string, nabu: Nabu) => PasteFragment | null} interpret
 */
```

**Type `PasteFragment` :**
```js
/**
 * @typedef {Object} PasteFragment
 * @property {PasteBlock[]} blocks
 */

/**
 * @typedef {Object} PasteBlock
 * @property {string} type
 * @property {'start' | 'end' | 'both' | false} partial
 * @property {Record<string, any>} [props]
 * @property {import('loro-crdt').Delta<string>[]} [delta]
 * @property {PasteBlock[]} [children]
 */
```

### 9.2 Nouvelles méthodes sur Block / TextBehavior

**`block.copyFragment(from, to)` :**
Sérialise le bloc (ou un range) vers un `PasteBlock`. Appelle le serializer `'clipboard'` de l'extension.

**`textBehavior.insertFragment(fragment, offset)` :**
Applique le delta d'un `PasteBlock` à l'offset donné.

### 9.3 Gestion dans Nabu

Deux nouvelles méthodes sur `Nabu` :

**`nabu.handleCopy(clipboardEvent)` :**
Construit le fragment à partir de la sélection courante, sérialise dans les 3 formats, écrit dans `clipboardEvent.clipboardData`.

**`nabu.handlePaste(clipboardEvent)` :**
Lit les formats disponibles, itère les `pasteInterpreters` par priorité, obtient un `PasteFragment`, appelle l'algorithme d'insertion.

### 9.4 Nouvelles extensions built-in

| Extension | Responsabilité |
|-----------|---------------|
| `NabuPasteExtension` | Interprète `application/x-nabu+json` |
| `HtmlPasteExtension` | Interprète `text/html` (sanitisation + mapping) |
| `PlainTextPasteExtension` | Interprète `text/plain` (texte pur, \n\n → blocs) |
| `MarkdownPasteExtension` | Interprète `text/plain` comme Markdown (optionnel) |

Ces extensions s'ajoutent aux presets existants. Elles sont **optionnelles** mais toutes incluses dans `FullPreset`.

### 9.5 Intégration dans les événements Nabu

Dans `Nabu.svelte` (le composant racine), on ajoute des listeners sur le CE root :
```
on:copy   → nabu.handleCopy(e)
on:cut    → nabu.handleCopy(e) + delete selection
on:paste  → nabu.handlePaste(e)
```

---

## 10. Questions ouvertes à trancher avant l'implémentation

| # | Question | Options | Recommandation |
|---|----------|---------|----------------|
| Q1 | **Sérialiseur clipboard sur Block ou Extension ?** | Méthode sur Block / Propriété sur Extension | Propriété `serializers: { clipboard: fn }` sur Extension, cohérent avec le pattern existant |
| Q2 | **Paste via `beforeinput` ou `paste` event ?** | `beforeinput` (inputType: insertFromPaste) / `paste` | `paste` — accès fiable au clipboard dans tous les browsers |
| Q3 | **Config paste centralisée ou par extension ?** | `createEditor({ paste: {...} })` / Extension | Les deux : config globale + override par extension |
| Q4 | **Que faire si aucun interpréteur ne match ?** | Ignorer / Insérer texte brut | Insérer le texte brut (`text/plain`) en dernier recours |
| Q5 | **Paste d'images (data URLs dans HTML) ?** | Ignorer / Extension future | Ignorer pour l'instant, `ImageExtension` futur |
| Q6 | **`partial` flag dans le fragment interne utile pour l'insertion ?** | Oui / Non (l'insertion le déduit) | Oui, simplifie l'algorithme d'insertion |
| Q7 | **Le bord droit prend quel type : dernier bloc collé ou bloc courant ?** | Type du dernier bloc collé / Type du currentBlock | Type du dernier bloc collé (comportement Notion/Notion-like) |
| Q8 | **Version check sur le format `application/x-nabu+json` ?** | Oui strict / Oui avec dégradation / Non | Oui avec dégradation (champ `version` dans le fragment) |
| Q9 | **`MarkdownPasteExtension` dans `FullPreset` par défaut ?** | Oui / Non | Recommandation : oui dans FullPreset, non dans MinimalPreset/TextPreset |
| Q10 | **Paste au milieu d'un bloc non-texte (Image, etc.) ?** | Insérer avant / Insérer après / Bloquer | Insérer après le bloc courant |

---

## 11. Ordre d'implémentation recommandé

```
Sprint 1 — Foundation
  [1.1] Type PasteFragment + PasteBlock
  [1.2] Propriété pasteInterpreters sur Extension
  [1.3] nabu.handleCopy() — sérialisation du fragment interne
  [1.4] nabu.handlePaste() — dispatch vers interpréteurs
  [1.5] NabuPasteExtension — round-trip interne (copy/paste Nabu → Nabu)

Sprint 2 — Algorithme d'insertion
  [2.1] Cas inline (1 bloc partiel)
  [2.2] Cas multi-blocs (N blocs), logique split + merge
  [2.3] Atomicité Undo (1 transaction)
  [2.4] Restauration du curseur

Sprint 3 — Interpréteurs externes
  [3.1] PlainTextPasteExtension
  [3.2] HtmlPasteExtension (sanitisation + mapping)
  [3.3] Dégradation gracieuse des types non enregistrés

Sprint 4 — Markdown & Config
  [4.1] MarkdownPasteExtension (optionnel)
  [4.2] Option paste.textStrategy dans createEditor()
  [4.3] Intégration dans les presets

Sprint 5 — Edge cases & stress tests
  [5.1] Paste dans ListItem (wrapOrphan)
  [5.2] Paste avec sélection multi-blocs
  [5.3] Cut (copy + delete atomique)
  [5.4] Tests des 20 edge cases recensés
```

---

## 12. Ce que ce document ne couvre pas encore

- **Import de document** (`nabu.import('markdown', str)`) — problème similaire mais différent : importe tout un document depuis un format externe, pas un fragment à la position du curseur. Peut réutiliser les interpréteurs mais l'algorithme d'insertion est plus simple (replace all). À traiter séparément.
- **Drag & Drop** — utilise le même `DataTransfer` que le clipboard mais déclenché par un `drop` event. Peut réutiliser les interpréteurs, mais l'algorithme d'insertion doit cibler la position du drop (pas la sélection courante). À traiter séparément.
- **Images dans le presse-papier** — `image/png`, `image/jpeg` dans le `ClipboardEvent`. Nécessite une `ImageExtension` future.
- **Collaboration temps-réel** — le paste doit être CRDT-safe (il l'est automatiquement puisque tout passe par Loro), mais la question du broadcasting de l'opération vers d'autres peers n'est pas adressée ici.

---

*Ce document doit être validé et challengé avant de passer aux ADRs formels.*
*Prochaine étape : ADR 012 (Copy/Paste — Architecture Générale) + éventuellement ADR 013 (Interpréteurs) si la complexité le justifie.*
