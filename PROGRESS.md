# PROGRESS.md - Suivi de l'avancement Nabu

## 🟢 PHASE 0 : Préparation du Terrain (DX & Socle)

*   [x] **0.1. Validation JSDoc :** Configurer `jsconfig.json` pour un check strict des types JSDoc. (Validé)
*   [x] **0.2. Installation de la Source de Vérité :** `loro-crdt` + Vite WASM. (Terminé)
*   [x] **0.3. Le Contrat de Bloc :** Définition des classes `Nabu`, `Block` et `MegaBlock` (Registry/Map plate). (Terminé)

---

## 🟠 PHASE 1 : Architecture de Rendu & Premier Affichage

*   [ ] **1.1. Paragraph.svelte (Le Bloc de base) :** Implémenter le premier bloc "Leaf" passif.
*   [ ] **1.2. NabuEditor.svelte (L'Hôte) :** Le composant racine avec l'unique `contenteditable="true"`.
*   [ ] **1.3. Recursive Renderer :** Créer un composant qui parcourt l'arbre d'instances et affiche les bons composants via le Registry.
*   [ ] **1.4. Test de Rendu :** Initialiser Nabu avec des données de test et vérifier l'affichage.

---

## 🗒️ Zone de Réflexion
1.  **Réconciliation :** Utilisation fine des Runes pour éviter les re-renders globaux.
2.  **Mapping de Sélection :** Transformation DOM Range <-> Loro Path.
3.  **OOP vs Functional :** Avantages des classes Svelte 5 pour l'encapsulation de l'état Loro.
