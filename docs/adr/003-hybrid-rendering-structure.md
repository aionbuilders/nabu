# ADR 003 : Structure Hybride (Flat-Map & Rendu Récursif)

## Statut
Accepté

## Contexte
Le moteur doit accéder aux blocs de deux façons : par ID pour les mises à jour (Input) et par hiérarchie pour l'affichage (UI). Parcourir un arbre récursif à chaque frappe de touche est inefficace.

## Décision
Maintenir une **Map plate** (`nabu.blocks`) pour le stockage et l'accès rapide, tout en utilisant la **récursion dans les composants Svelte** pour le rendu visuel.

## Conséquences
*   **Performance O(1) :** Accès instantané à n'importe quel bloc via son ID, peu importe sa profondeur.
*   **Modularité :** Les composants ne connaissent que leurs enfants directs via leurs IDs, ce qui limite la propagation des changements réactifs.
*   **Simplicité :** Le passage de Loro (liste plate de nœuds) vers Svelte est direct et ne nécessite pas de reconstruction d'arbre complexe en mémoire JS.
