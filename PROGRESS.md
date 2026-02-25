# PROGRESS.md - Suivi de l'avancement Nabu

## 🟢 PHASE 0 : Préparation du Terrain (DX & Socle)

*   [x] **0.1. Validation JSDoc :** Configurer `jsconfig.json` pour un check strict des types JSDoc. (Validé)
*   [x] **0.2. Installation de la Source de Vérité :** `loro-crdt` + Vite WASM. (Terminé)
*   [x] **0.3. Le Contrat de Bloc :** Définition des classes `Nabu`, `Block` et `MegaBlock` (Registry/Map plate). (Terminé)

---

## 🟠 PHASE 1 : Le Moteur "Single CE" (TERMINÉE)

*   [x] **1.1. Setup & Rendu :** Affichage récursif via Svelte 5 et LoroTree. (Validé)
*   [x] **1.2. Selection Engine :** Mapping DOM ↔ Modèle via Virtual Range et restauration du curseur (`getDOMPoint`). Stabilisation "Sync-on-Mutation" pour les frappes rapides. (Validé)
*   [x] **1.3. Input Handler (Text) :** Interception `beforeinput`, mutations Loro et réconciliation réactive. (Validé)
*   [x] **1.4. Structural Input :** Split (Entrée) et Merge (Backspace/Suppr) via hooks d'extensions et Loro Deltas. (Validé)

---

## 🟡 PHASE 2 : Structure & Types (EN COURS)

### 2.1. Écosystème de Blocs Textuels
*   [x] **2.1.1. TextBehavior :** Extraction de la logique textuelle universelle (LoroText + DOM Sync).
*   [x] **2.1.2. Moteur "Type Swap" :** Capacité du moteur Nabu à ré-instancier un bloc dont le type change dans Loro.
*   [x] **2.1.3. Signaux de Hook :** Introduction de `Nabu.BREAK` et `Nabu.CONTINUE` pour le contrôle de flux.

### 2.2. Perfectionnement des Titres (Headings)
*   [x] **2.2.1. Extension Heading :** Support des tags h1-h6 réactifs et mapping Loro. (Terminé)
*   [x] **2.2.2. Markdown Shortcuts :** Conversion automatique via `# + Espace`. (Terminé)
*   [x] **2.2.3. UX de Dé-transformation :**
    *   [x] **Backspace au début :** Si curseur à l'offset 0 d'un Heading -> Transformer en Paragraph. (Terminé)
*   [x] **2.2.4. Orchestration du Split :**
    *   [x] **Entrée systématique :** Appuyer sur Entrée dans un titre doit toujours créer un Paragraph à la suite. (Terminé)

### 2.3. Gestion des Listes Imbriquées (MegaBlocks)
*   [ ] **2.3.1. Architecture MegaBlock :** Implémentation du conteneur `List` (ul/ol) et des items `ListItem`.
*   [ ] **2.3.2. Hiérarchie LoroTree :** Manipulation du parentage Loro pour l'imbrication.
*   [ ] **2.3.3. Raccourcis Clavier :**
    *   [ ] **Tab :** Indenter l'item (le faire devenir enfant du précédent).
    *   [ ] **Shift+Tab :** Désindenter l'item (remonter d'un niveau).
    *   [ ] **Entrée sur item vide :** Sortir de la liste (transformer en paragraphe).

### 2.4. Rich Text & Marks (Inline Formatting)
*   [ ] **2.4.1. Loro Marks :** Gestion des deltas avec attributs (bold, italic, code, link).
*   [ ] **2.4.2. Input Interception :** Détection des patterns Markdown inline (ex: `**gras**`).
*   [ ] **2.4.3. UI de Sélection :** Toolbar flottante pour appliquer des styles sur une plage de texte.

---

## 🗒️ Zone de Réflexion
1.  **Réconciliation :** Utilisation fine des Runes pour éviter les re-renders globaux.
2.  **Mapping de Sélection :** Transformation DOM Range <-> Loro Path.
3.  **OOP vs Functional :** Avantages des classes Svelte 5 pour l'encapsulation de l'état Loro.
