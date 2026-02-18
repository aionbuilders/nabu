# PROJET : NEXT-GEN BLOCK EDITOR (Single ContentEditable)

## 1. MANIFESTE & OBJECTIFS
Création d'une librairie d'édition de texte "Rich Text Block-Based" (type Notion) mais avec une architecture DOM **Single ContentEditable** (type Google Docs/ProseMirror) pour garantir une sélection native parfaite.
L'objectif final est d'en faire un CMS modulaire interconnecté avec SurrealDB ("Metablocks"), mais la priorité actuelle est le moteur d'édition de roman "Local-First".

## 2. TECH STACK (STRICTE)
* **Framework UI :** Svelte 5 (Runes obligatoires : `$state`, `$derived`, `$props`).
* **State / CRDT :** `loro-crdt` (WASM). Utilisation de `LoroTree` pour la hiérarchie.
* **Build :** Vite + TypeScript.
* **Persistance (Future) :** IndexedDB (Local) -> SurrealDB (Remote).

## 3. ARCHITECTURE DE DONNÉES (LORO)
Le modèle de données est "Agnostique" et "Générique". Ne jamais présumer qu'un bloc est seulement du texte.

### Structure d'un Bloc (Schema Loro)
Chaque nœud de l'arbre Loro contient :
* `id`: string (UUID).
* `type`: string ('paragraph', 'heading', 'image', 'code', etc.).
* `props`: LoroMap (Record<string, any>).
    * Pour du texte : `{ text: "Contenu..." }` (ou LoroText).
    * Pour une image : `{ src: "...", caption: "..." }`.
* `children`: LoroTree (Liste ordonnée d'enfants).

## 4. ARCHITECTURE DOM (SINGLE CONTENTEDITABLE)
**⚠️ RÈGLE D'OR :** Il n'y a qu'un seul attribut `contenteditable="true"` à la racine de l'éditeur.
Les blocs individuels (`<div data-block-id="...">`) NE DOIVENT PAS être editables.

* **Rendu :** Svelte affiche la liste des blocs en lisant le state Loro.
* **Events :** On écoute `beforeinput`, `keydown`, `compositionstart` sur la racine.
* **Selection Mapping :** On doit traduire la `window.getSelection()` (DOM Node + Offset) vers une position Loro (Block ID + Text Offset) pour appliquer les changements.

## 5. ROADMAP & PROGRESSION

### 🔴 NIVEAU 1 : Le Moteur "Single CE" (CURRENT FOCUS)
L'objectif est d'avoir un rendu fluide et une frappe qui met à jour Loro sans casser le curseur.
* [ ] **1.1. Setup & Rendu Read-Only :** Initialiser Loro WASM + Afficher l'arbre via Svelte récursif dans un `contenteditable` racine.
* [ ] **1.2. Selection Engine :** Créer l'utilitaire `getCursorPosition()` qui retourne `{ blockId, offset }` depuis le DOM.
* [ ] **1.3. Input Handler (Text) :** Intercepter `beforeinput`. Si type `insertText`, mettre à jour le `LoroText` du bloc ciblé. Gérer la réconciliation DOM/Svelte pour ne pas perdre le focus.
* [ ] **1.4. Structural Input :** Gérer "Enter" (Split block / New block) et "Backspace" (Merge block) via `LoroTree`.

### 🟠 NIVEAU 2 : Structure & Types
* [ ] 2.1. Transformer les blocs (H1, H2, List) via le Store.
* [ ] 2.2. Markdown Shortcuts (`# `, `- `) déclenchés à la frappe.
* [ ] 2.3. Gestion des listes imbriquées (Tab / Shift+Tab).

### 🟡 NIVEAU 3 : Rich Text (Spans)
* [ ] 3.1. Gestion des `LoroText.mark` (Bold, Italic).
* [ ] 3.2. Rendu des spans dans Svelte.
* [ ] 3.3. Raccourcis clavier (Ctrl+B/I) et détection de liens.

### 🟢 NIVEAU 4 : UX & Drag-and-Drop
* [ ] 4.1. Menu Slash (/) contextuel.
* [ ] 4.2. Drag Handle au survol (Overlay indépendant du contenteditable).
* [ ] 4.3. Déplacement de blocs via `LoroTree.move` (Movable Tree).

### 🔵 NIVEAU 5 : Persistance & Export
* [ ] 5.1. Sauvegarde IndexedDB automatique.
* [ ] 5.2. Export Markdown/JSON.

## 6. DIRECTIVES POUR L'IA
1.  **Code Svelte 5 :** Utilise toujours la syntaxe Runes. Pas de `export let`.
2.  **Loro First :** La vérité est dans Loro. Svelte n'est qu'une vue.
3.  **Single CE :** Si tu proposes de mettre `contenteditable` sur un bloc enfant, tu as tort. Corrige-toi.
4.  **Performance :** Attention aux re-renders inutiles lors de la frappe.