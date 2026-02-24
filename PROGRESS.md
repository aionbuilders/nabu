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

*   [x] **2.1. Transformer les blocs :** Pouvoir changer un paragraphe en Titre (H1, H2). Implémentation du bloc `Heading` et du `TextBehavior`. (Terminé)
*   [ ] **2.2. Markdown Shortcuts :** Déclenchement automatique (`# `, `- `) lors de la frappe.
*   [ ] **2.3. Gestion des listes imbriquées :** Implémentation du `MegaBlock` Liste et gestion du Tab / Shift+Tab.
*   [ ] **2.4. Rich Text (Spans) :** Rendu et édition des `marks` (Gras, Italique).

---

## 🗒️ Zone de Réflexion
1.  **Réconciliation :** Utilisation fine des Runes pour éviter les re-renders globaux.
2.  **Mapping de Sélection :** Transformation DOM Range <-> Loro Path.
3.  **OOP vs Functional :** Avantages des classes Svelte 5 pour l'encapsulation de l'état Loro.
