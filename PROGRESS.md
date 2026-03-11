# PROGRESS.md - Suivi de l'avancement Nabu

---

## 🟢 PHASE 0 : Préparation du Terrain (DX & Socle) — TERMINÉE

- [x] **0.1** Configurer `jsconfig.json` pour un check strict des types JSDoc
- [x] **0.2** Installation `loro-crdt` + Vite WASM
- [x] **0.3** Définition des classes `Nabu`, `Block`, `MegaBlock` (Registry + Map plate)

---

## 🟢 PHASE 1 : Moteur "Single CE" — TERMINÉE

- [x] **1.1** Setup & rendu récursif via Svelte 5 + LoroTree
- [x] **1.2** Selection Engine : mapping DOM ↔ Modèle via `getDOMPoint` / `calculateOffset`, restauration curseur, Sync-on-Mutation
- [x] **1.3** Input Handler : interception `beforeinput`, mutations LoroText, réconciliation réactive
- [x] **1.4** Structural Input : Split (Entrée) + Merge (Backspace) via hooks d'extensions + Loro Deltas

---

## 🟢 PHASE 2 : Structure, Types & Rich Text — TERMINÉE (fonctionnel) / PARTIELLE (UX)

### 2.1 Écosystème de Blocs Textuels ✅
- [x] **2.1.1** `TextBehavior` : extraction de la logique textuelle universelle (LoroText + DOM Sync)
- [x] **2.1.2** Moteur "Type Swap" : ré-instanciation d'un bloc dont le type change dans Loro
- [x] **2.1.3** Signaux de Hook : `Nabu.BREAK` / `Nabu.CONTINUE` pour le contrôle de flux

### 2.2 Headings ✅
- [x] **2.2.1** Extension Heading : h1-h6 réactifs + mapping Loro
- [x] **2.2.2** Markdown shortcuts : `# + Espace` → transformation automatique
- [x] **2.2.3** Backspace au début d'un Heading → transformation en Paragraph
- [x] **2.2.4** Entrée dans un titre → crée toujours un Paragraph à la suite

### 2.3 Listes Imbriquées ✅
- [x] **2.3.1** Architecture MegaBlock : `List` (ul/ol) + `ListItem`
- [x] **2.3.2** Hiérarchie LoroTree : manipulation du parentage pour l'imbrication
- [x] **2.3.3** Tab → indent (hoist), Shift+Tab → unindent (carry), Entrée sur item vide → exit liste + Paragraph
- [x] **2.3.4** Fusion automatique des listes adjacentes via hook `onBeforeTransaction`

Détail des cas limites : voir `PROGRESS_LISTS.md`

### 2.4 Undo/Redo ✅
- [x] **2.4.1** `UndoManager` Loro : 100 steps max, merge 1s
- [x] **2.4.2** Raccourcis Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
- [x] **2.4.3** Restauration automatique du curseur via callbacks `onPush`/`onPop`

### 2.5 Rich Text & Marks (Inline Formatting) ✅ infra / ⬜ UX
- [x] **2.5.1** `applyMark`, `removeMark`, `toggleMark`, `isMarkActive` sur `TextBehavior`
- [x] **2.5.2** Rendu des spans via `RichText.svelte` : bold, italic, underline, code, strikethrough
- [x] **2.5.3** `RichTextExtension` : Ctrl+B/I/U/E + Ctrl+Shift+X
- [x] **2.5.4** **Comportement global de toggle** : si la mark est entièrement active sur toute la sélection → retrait global ; sinon → application globale. Fonctionne sur sélection multi-blocs. (ADR 009)
- [ ] **2.5.5** Toolbar visuelle flottante (appliquer marks via click)
- [ ] **2.5.6** Support des liens (`<a>` avec `href`) — marks Loro déjà compatibles
- [ ] **2.5.7** Raccourcis Markdown inline (`**texte**` → gras, `_texte_` → italique)

### 2.6 Refactoring Architecture Multi-Blocs ✅
- [x] **2.6.1** Extraction de `handleContainerBeforeInput` dans `container.utils.js`
  - Logique "spine" partagée entre `Nabu` et `MegaBlock`
  - Suppression de l'ancienne logique naïve de `Nabu.beforeinput` (scan linéaire + API dépréciée)
  - ADR 008 documenté
- [x] **2.6.2** `MegaBlock.beforeinput` réduit à une délégation (100 lignes → 3 lignes)
- [x] **2.6.3** `Nabu.beforeinput` mis au même niveau de robustesse que MegaBlock

### 2.7 Bugs & Améliorations — EN COURS ⚠️
- [ ] **Bug Merging ListItem** : fusion de deux items de liste peut perdre les enfants (sous-listes) du second item — `adoptChildren` dans MegaBlock a un `if (false)` TODO non implémenté
- [ ] **Multi-block `insertParagraph`** dans structures très imbriquées — à stress-tester
- [ ] **`setTimeout` vs `tick()`** : quelques points utilisent `setTimeout(..., 0)` au lieu de `tick().then()` — timing-dépendant

---

## 🔴 PHASE 3 : Persistance — NON COMMENCÉE

- [ ] **3.1** Sauvegarde IndexedDB automatique (snapshot Loro binaire)
- [ ] **3.2** Chargement au démarrage depuis IndexedDB
- [ ] **3.3** Export Markdown / JSON
- [ ] **3.4** Import depuis Markdown / JSON

---

## 🟠 PHASE 4 : UX & Navigation — NON COMMENCÉE

- [ ] **4.1** Menu Slash (`/`) : insertion de blocs à la volée
- [ ] **4.2** Toolbar marks flottante (apparaît sur sélection non-collapsée)
- [ ] **4.3** Drag Handle au survol (overlay indépendant du `contenteditable`)
- [ ] **4.4** Déplacement de blocs via `LoroTree.move`
- [ ] **4.5** Placeholders sur blocs vides

---

## 📊 ÉTAT ACTUEL — 12 Mars 2026

### Progression globale : **75-80% vers MVP Bêta**

#### ✅ Points forts
- Architecture Single CE + Loro-CRDT + Extension System : solide
- Selection Bridge DOM ↔ Modèle : correct, spans-aware confirmé
- 4 types de blocs stables : Paragraph, Heading, List, ListItem
- Rich Text marks : infrastructure complète, toggle comportement standard
- Multi-blocs : logique spine correcte et unifiée
- Undo/Redo avec restauration curseur
- 9 ADRs documentés

#### 🔴 Bloquant MVP
1. **Persistence** — aucun stockage, données perdues au refresh
2. **Toolbar visuelle marks** — aucune UI pour appliquer le formatage

#### 🟡 Important mais non bloquant
- Bug merge ListItem avec enfants
- Nettoyage des `console.log` de debug (REFOCUS, "Committing transaction...", etc.)
- Stress-test des edge cases multi-blocs imbriqués profonds

#### ⬜ Nice-to-have
- Menu slash
- Drag handles
- Markdown inline shortcuts
- Tests E2E

---

## 🗒️ Décisions architecturales (ADRs)

| ADR | Sujet | Statut |
|-----|-------|--------|
| 001 | Single ContentEditable | ✅ Accepté |
| 002 | OOP via classes Svelte 5 | ✅ Accepté |
| 003 | Flat-Map + rendu récursif | ✅ Accepté |
| 004 | Rich Text via LoroText.mark | ✅ Accepté |
| 005 | JSDoc strict | ✅ Accepté |
| 006 | Selection Bridge (Range + TreeWalker) | ✅ Accepté |
| 007 | Event Ascension (Chain of Responsibility) | ✅ Accepté |
| 008 | Container beforeinput — logique spine partagée | ✅ Accepté |
| 009 | Rich Text toggle global multi-blocs | ✅ Accepté |
