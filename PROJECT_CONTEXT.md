# PROJET NABU : BLOCK EDITOR (Single ContentEditable)
*Dernière mise à jour : 12 Mars 2026*

---

## 1. MANIFESTE & OBJECTIFS

Création d'une librairie d'édition de texte "Rich Text Block-Based" (type Notion) avec une architecture DOM **Single ContentEditable** (type Google Docs/ProseMirror) pour garantir une sélection native parfaite.

L'objectif final est d'en faire un CMS modulaire interconnecté avec SurrealDB ("Metablocks"), mais la priorité actuelle est le moteur d'édition — local-first, robuste, modulaire.

---

## 2. TECH STACK (STRICTE)

- **Framework UI :** Svelte 5 (Runes obligatoires : `$state`, `$derived`, `$props`)
- **State / CRDT :** `loro-crdt` (WASM). `LoroTree` pour la hiérarchie, `LoroText` pour le texte inline
- **Typage :** JSDoc strict (`checkJs: true`) — pas de TypeScript
- **Build :** Vite + SvelteKit Package
- **Persistance (Future) :** IndexedDB (Local) → SurrealDB (Remote)

---

## 3. DIRECTIVES ARCHITECTURALES (DOGMES)

1. **Single ContentEditable :** Un seul `contenteditable="true"` à la racine. Jamais sur les blocs enfants.
2. **Loro-First :** La vérité est dans Loro. Svelte et le DOM ne sont que des reflets réactifs.
3. **Modularité Totale (Registry Pattern) :** Le moteur est agnostique. Les blocs sont des modules interchangeables enregistrés via `Extension`.
4. **Svelte-First (Runes) :** Performance maximale via `$state`, `$derived`. Pas de `export let`.
5. **JSDoc DX :** Chaque classe, méthode et composant documenté pour autocomplétion maximale.

Pour le détail des décisions architecturales : voir `docs/adr/`.

---

## 4. ARCHITECTURE ACTUELLE

### Hiérarchie des classes

```
Block (base — blocks/block.svelte.js)
├── Paragraph  (+ TextBehavior)
├── Heading    (+ TextBehavior, level 1-6)
└── MegaBlock  (blocks/megablock.svelte.js — a des enfants)
    ├── List       (type bullet | ordered)
    └── ListItem   (+ TextBehavior + enfants optionnels)
```

### Composants de rendu

```
Nabu.svelte             → racine contenteditable
  └── Block.svelte      → routeur dynamique vers le bon composant
        ├── Paragraph.svelte    → <div> + <RichText>
        ├── Heading.svelte      → <h1-h6> + <RichText>
        ├── List.svelte         → <ul>/<ol> + enfants
        └── ListItem.svelte     → <li> + <RichText> + enfants
              └── RichText.svelte → rendu delta avec <span> pour les marks
```

### Sélection

```
SvelteSelection (utils/selection.svelte.js)
  └── NabuSelection (blocks/selection.svelte.js)
        ├── anchorBlock / focusBlock / startBlock / endBlock
        ├── setCursor(block, offset)     → Modèle → DOM (via getDOMPoint)
        └── calculateOffset(node, offset) → DOM → Modèle (via Range.toString)
```

### Input multi-blocs

```
container.utils.js → handleContainerBeforeInput(container, nabu, event)
  ├── appelé par MegaBlock.beforeinput(event)
  └── appelé par Nabu.beforeinput(event)
```

### Extensions actives

| Extension | Bloc | Hooks |
|---|---|---|
| `ParagraphExtension` | `Paragraph` | `onInit`, `onSplit` |
| `HeadingExtension` | `Heading` | `onBeforeInput` (markdown `#`), `onSplit` |
| `ListExtension` | `List` | merge hook |
| `ListItemExtension` | `ListItem` | `keydown` (Tab/Shift+Tab) |
| `RichTextExtension` | — | `onKeyDown` (Ctrl+B/I/U/E, Ctrl+Shift+X) |

---

## 5. ROADMAP & PROGRESSION

### ✅ NIVEAU 1 : Moteur "Single CE" — COMPLET

- [x] **1.1** Setup Loro WASM + rendu de l'arbre via Svelte récursif dans un `contenteditable` racine
- [x] **1.2** Selection Engine : `calculateOffset()` (DOM → Modèle) + `getDOMPoint()` (Modèle → DOM) + `NabuSelection`
- [x] **1.3** Input Handler : interception `beforeinput`, mise à jour `LoroText`, réconciliation DOM/Svelte sans perte de curseur
- [x] **1.4** Structural Input : Enter (split) + Backspace (merge) via `LoroTree`
- [x] **1.5** Undo/Redo : `UndoManager` Loro avec restauration du curseur (100 steps, merge 1s)

### ✅ NIVEAU 2 : Structure & Types — COMPLET

- [x] **2.1** Types de blocs : Paragraph, Heading (h1-h6), List (bullet/ordered), ListItem
- [x] **2.2** Markdown shortcuts : `# ` → Heading h1, `## ` → h2..., Backspace en début de Heading → Paragraph
- [x] **2.3** Listes imbriquées : Tab (indent), Shift+Tab (unindent/hoist), Enter sur item vide → exit liste

### ✅ NIVEAU 3 : Rich Text — COMPLET (infra) / PARTIEL (UX)

- [x] **3.1** `LoroText.mark` / `unmark` — `applyMark`, `removeMark`, `toggleMark`, `isMarkActive`
- [x] **3.2** Rendu des spans via `RichText.svelte` (bold, italic, underline, code, strikethrough)
- [x] **3.3** Raccourcis clavier : Ctrl+B/I/U/E + Ctrl+Shift+X avec comportement global (retire si tout actif, applique sinon)
- [ ] **3.4** Toolbar visuelle flottante (marks + liens) — **non commencé**
- [ ] **3.5** Support des liens (`<a>`) — **non commencé**

### ⬜ NIVEAU 4 : UX & Navigation

- [ ] **4.1** Menu Slash (`/`) contextuel — insertion de blocs à la volée
- [ ] **4.2** Drag Handle au survol (overlay indépendant du `contenteditable`)
- [ ] **4.3** Déplacement de blocs via `LoroTree.move`
- [ ] **4.4** Placeholders sur blocs vides

### ⬜ NIVEAU 5 : Persistance & Export

- [ ] **5.1** Sauvegarde IndexedDB automatique (auto-save + snapshot Loro)
- [ ] **5.2** Export Markdown / JSON
- [ ] **5.3** Import depuis Markdown / JSON

---

## 6. ÉTAT COURANT — POINTS D'ATTENTION

### Fonctionnel et stable ✅
- Frappe, suppression, split, merge — single et multi-blocs
- Sélection cross-blocs (bridge DOM ↔ Modèle)
- Rich text marks via clavier
- Undo/Redo
- Listes imbriquées (Tab/Shift+Tab)
- Markdown shortcuts au clavier

### À valider / edge cases connus ⚠️
- Multi-block `insertParagraph` dans structures très imbriquées (list → list-item → sublist)
- `adoptChildren` dans `MegaBlock` : guard `if (false)` non implémenté (TODO ligne 49 megablock.svelte.js)
- Quelques `setTimeout(..., 0)` au lieu de `tick().then(...)` (timing-dépendant)

### Bloquant MVP ❌
- **Persistence** : zéro stockage, données perdues au refresh
- **Toolbar marks** : aucune UI visuelle pour appliquer le formatage

### Code à nettoyer (non bloquant)
- `console.log("REFOCUS")` dans block.svelte.js
- `console.warn("Committing transaction...")` dans nabu.svelte.js
- `console.log(...)` dans rich-text.extension.js
- Nombreux `console.warn("Not implemented")` dans la classe base Block (stubs)

---

## 7. STRUCTURE DES FICHIERS SOURCE

```
src/
├── lib/index.js                    → exports publics (RichTextExtension, RichText)
├── blocks/
│   ├── block.svelte.js             → Block (classe base)
│   ├── nabu.svelte.js              → Nabu (moteur + orchestration)
│   ├── megablock.svelte.js         → MegaBlock (container avec enfants)
│   ├── selection.svelte.js         → NabuSelection
│   ├── container.utils.js          → handleContainerBeforeInput (logique spine partagée)
│   ├── Block.svelte                → routeur de composants
│   ├── Nabu.svelte                 → racine contenteditable
│   ├── paragraph/                  → Paragraph + ParagraphExtension
│   ├── heading/                    → Heading + HeadingExtension + hooks
│   ├── list/                       → List + ListItem + ListBehavior + extensions
│   └── index.js
├── behaviors/
│   └── text/
│       ├── text.behavior.svelte.js → TextBehavior (logique texte universelle)
│       ├── rich-text.extension.js  → RichTextExtension (raccourcis marks)
│       ├── RichText.svelte         → rendu delta avec marks
│       └── index.js
└── utils/
    ├── extensions.js               → classe Extension + système de hooks
    └── selection.svelte.js         → SvelteSelection (wrapper DOM réactif)
```
