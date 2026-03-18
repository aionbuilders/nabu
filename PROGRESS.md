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

### 2.7 Bloc Dialogue ✅
- [x] **2.7.1** Extension `DialogueBlock` : bloc texte avec em-dash préfixé (CSS `::before`, non-DOM)
- [x] **2.7.2** Markdown shortcut : `-- ` en début de paragraphe → transformation automatique en dialogue
- [x] **2.7.3** Backspace au début d'un dialogue → transformation en Paragraph
- [x] **2.7.4** Entrée dans un dialogue non-vide → crée un nouveau bloc dialogue à la suite
- [x] **2.7.5** Entrée dans un dialogue vide → sortie du mode dialogue, crée un Paragraph
- [x] **2.7.6** Rich Text marks fonctionnels dans les blocs dialogue (héritage `TextBehavior`)
- [x] **2.7.7** Sérialisation Markdown : `— texte` (em-dash unicode, différencié des listes `- item`)
- [x] **2.7.8** Sérialisation JSON : `{ type: 'dialogue', content: [...] }`
- [x] **2.7.9** Substitution typographique globale : `--` + espace → `—` dans tout bloc texte
- [ ] **2.7.10** Speaker/locuteur optionnel (roadmap Phase 4.6 — use cases théâtre, scénario, transcription)

### 2.8 Action Bus (`nabu.exec`) ✅

- [x] **2.8.1** `nabu.exec(topic, data?)` comme unique point d'entrée public pour déclencher des actions — Pulse caché en interne (`#pulse` private field)
- [x] **2.8.2** Propriété `actions` sur `Extension` — même pattern déclaratif que `hooks` et `serializers`
- [x] **2.8.3** `RichTextExtension` : actions `mark:toggle`, `mark:apply`, `mark:remove` + aliases `bold`, `italic`, `underline`, `code`, `strikethrough`
- [x] **2.8.4** `BlockExtension` : action `block:transform` + restauration curseur via `tick()`
- [x] **2.8.5** `HeadingExtension` : aliases `heading:1`…`heading:6` → délèguent à `block:transform`
- [x] **2.8.6** `ParagraphExtension` : alias `paragraph` → délègue à `block:transform`
- [x] **2.8.7** `ListItemExtension` : actions `list:indent` / `list:unindent` (logique extraite de `keydown()`)
- [x] **2.8.8** Core actions `undo` / `redo` toujours disponibles (enregistrées directement sur `#pulse`)

### 2.9 Bugs & Améliorations — EN COURS ⚠️
- [ ] **Bug Merging ListItem** : fusion de deux items de liste peut perdre les enfants (sous-listes) du second item — `adoptChildren` dans MegaBlock a un `if (false)` TODO non implémenté
- [ ] **Multi-block `insertParagraph`** dans structures très imbriquées — à stress-tester
- [ ] **`setTimeout` vs `tick()`** : quelques points utilisent `setTimeout(..., 0)` au lieu de `tick().then()` — timing-dépendant

---

## 🟢 PHASE 3 : Persistance — TERMINÉE

- [x] **3.1** Sauvegarde IndexedDB automatique (snapshot Loro binaire)
  - Auto-save debounced 2s via `doc.subscribe()` après chaque changement committed
  - `nabu.saveNow()` pour forcer une sauvegarde immédiate
- [x] **3.2** Chargement au démarrage depuis IndexedDB
  - `createPersistedEditor({ docId })` : restore le snapshot Loro au démarrage
  - `nabu.isNew` : `true` si aucun snapshot existant (nouveau document)
  - `nabu.clearPersistence()` : supprime le snapshot stocké
- [x] **3.3** Export Markdown / JSON
  - `nabu.serialize('markdown')` → string Markdown
  - `nabu.serialize('json')` → `{version, blocks[]}` format Slate-like
  - `deltaToMarkdown()` : util inline (bold, italic, code, strikethrough, underline)
  - `TextBehavior.toMarkdown()` / `.toJSON()` : briques réutilisables
  - Bindings réactifs Svelte 5 natifs via `$derived(nabu.serialize(...))`
  - Architecture extensible : `Extension.serializers` pour formats custom
- [ ] **3.4** Import depuis Markdown / JSON

---

## 🔴 PHASE 3.5 : Copy / Paste — EN CONCEPTION

> Réflexion complète documentée dans `docs/design/copy-paste.md`.
> ADR 012 à rédiger avant implémentation.

### Architecture décidée
- **3 formats clipboard** : `application/x-nabu+json` (fidélité totale) + `text/html` (interop) + `text/plain` (fallback)
- **Chaîne d'interpréteurs** : propriété `pasteInterpreters` sur `Extension`, priorité numérique, retour `PasteFragment | null`
- **Plain text = texte pur par défaut** ; `MarkdownPasteExtension` en opt-in
- **Algorithme d'insertion** : règle des bornes (type currentBlock survit à gauche, type dernier bloc collé survit à droite) + `wrapOrphan` pour la compatibilité structurelle
- **Atomicité** : paste = une transaction Loro = un seul step d'undo

### Tâches

- [x] **3.5.0** Câblage événements `copy` / `cut` / `paste` sur le CE root (`Nabu.svelte`) + `preventDefault()` sur paste
- [x] **3.5.1** Infrastructure : propriété `pasteInterpreters` sur `Extension`, types JSDoc `PasteFragment` + `PasteBlock` + `PasteInterpreter`, stubs `handleCopy` / `handleCut` / `handlePaste` avec dispatch vers interpréteurs
- [x] **3.5.2** `PlainTextPasteExtension` + insertion **inline** (1 bloc, curseur collapsé)
- [x] **3.5.3** Algorithme d'insertion **multi-blocs** : split au curseur, fusion aux bornes, blocs intermédiaires
- [x] **3.5.4** `nabu.handleCopy()` : sérialisation de la sélection vers `application/x-nabu+json` + `text/plain` (markdown) + `text/html` via dispatch registry (`BlockClass.toMarkdown` / `.toHtml`)
- [x] **3.5.5** `NabuPasteExtension` : lecture du format interne → round-trip fidèle (marks + types de blocs)
- [x] **3.5.6** Cut atomique : `handleCopy()` + suppression sélection (spine) en une seule transaction
- [x] **3.5.7** `HtmlPasteExtension` : architecture décentralisée (`htmlRules` + `fromHTML` sur chaque BlockClass), `parseInline` avec styles inline (Google Docs), expansion des containers inconnus à bloc-enfants (wrapper `<b>` Google Docs)
- [x] **3.5.8** `MarkdownPasteExtension` (opt-in, `DocumentPreset`+`FullPreset`) : pipeline consume-based (`markdownRules.detect/consume` sur chaque BlockClass), inline parser récursif leftmost-match
  - `loroTextStyles` : nouvelle propriété `Extension` — déclare les styles Loro nécessaires ; `configTextStyle()` appelé à l'init pour corriger les erreurs `applyDelta` (strikethrough)
- [ ] **3.5.9** Edge cases : sélection range avant paste, début/fin de doc, paste dans ListItem (wrapOrphan), paste dans document vide

> **Known limitation** : paste depuis Microsoft Word — HTML Word (`MsoListParagraph`, `<o:p>`) nécessite un parseur dédié non encore implémenté. Texte brut fonctionne, formatage et listes perdus.

---

## 🟠 PHASE 4 : UX & Navigation — NON COMMENCÉE

- [ ] **4.1** Menu Slash (`/`) : insertion de blocs à la volée
- [ ] **4.2** Toolbar marks flottante (apparaît sur sélection non-collapsée)
- [ ] **4.3** Drag Handle au survol (overlay indépendant du `contenteditable`)
- [ ] **4.4** Déplacement de blocs via `LoroTree.move`
- [ ] **4.5** Placeholders sur blocs vides
- [ ] **4.6** DialogueBlock — champ `speaker` optionnel (théâtre, scénario, transcription)
  - Metadata Loro sur le nœud dialogue
  - Mécanisme d'accès à définir (label cliquable au-dessus du bloc, raccourci dédié, etc.)
  - Sérialisation : `Jean — Tu viens ce soir ?`
  - Use cases : pièces de théâtre, scénarios, interviews

---

## 📊 ÉTAT ACTUEL — 18 Mars 2026

### Progression globale : **97% vers MVP Bêta**

#### ✅ Points forts
- Architecture Single CE + Loro-CRDT + Extension System : solide
- Selection Bridge DOM ↔ Modèle : correct, spans-aware confirmé
- 5 types de blocs stables : Paragraph, Heading, List, ListItem, **Dialogue**
- Rich Text marks : infrastructure complète, toggle comportement standard
- Multi-blocs : logique spine correcte et unifiée
- Undo/Redo avec restauration curseur
- **Persistence IndexedDB : auto-save + restore au démarrage, `createPersistedEditor`**
- **Serializer system : export Markdown + JSON opérationnels, réactifs Svelte 5**
- **Substitution typographique : `--` + espace → `—` (em-dash) dans tout bloc texte**
- **Action Bus `nabu.exec()` : toutes les actions editor accessibles depuis UI externe**
- 11 ADRs documentés
- **Copy/Paste : implémentation complète (3.5.0–3.5.8)**
  - Round-trip interne fidèle (marks, types, listes imbriquées)
  - Paste HTML décentralisé : Notion ✅, Google Docs ✅ (texte + marks), Word ⚠️ (texte seulement)
  - Paste Markdown : pipeline consume-based, inline marks récursif

#### 🔴 Bloquant MVP
1. **Toolbar visuelle** — infrastructure exec prête, manque l'UI Svelte + `nabu.isMarkActive()` pour les états actifs des boutons

#### 🟡 Important mais non bloquant
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
| 010 | Serializer pattern : Map sur Block/Nabu, TextBehavior comme brique, format Slate-like | ✅ Accepté |
| 011 | Action Bus : `nabu.exec()` wrappant Pulse, `actions` déclaratif sur Extension | ✅ Accepté |
| 012 | Copy/Paste — Architecture (interpréteurs, fragment, insertion) | 🔲 À rédiger |
