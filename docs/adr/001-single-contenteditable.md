# ADR 001 : Architecture Single ContentEditable

## Statut
Accepté

## Contexte
La majorité des éditeurs "block-based" (comme Notion) utilisent un `contenteditable` par bloc. Cela facilite la gestion du rendu mais brise la sélection native du navigateur (le curseur ne peut pas traverser naturellement les blocs, le copier-coller est complexe, et les performances se dégradent avec le nombre de blocs).

## Décision
Nabu utilisera un **unique attribut `contenteditable="true"`** à la racine de l'éditeur. Les blocs enfants seront des éléments DOM passifs (non-éditables par défaut du point de vue du navigateur).

## Conséquences
*   **Avantages :** 
    *   Sélection native parfaite (sélection de plusieurs blocs, glisser-déposer du curseur).
    *   Gestion du copier-coller simplifiée car le navigateur voit un seul flux.
    *   Performance de rendu supérieure (moins de zones éditables à gérer par le moteur du navigateur).
*   **Défis :**
    *   Nécessite un mapping complexe (Selection Bridge) pour traduire les coordonnées DOM (Node/Offset) vers les coordonnées Loro (BlockID/TextOffset).
    *   Interception obligatoire de tous les événements d'entrée (`beforeinput`) pour rediriger les modifications vers Loro au lieu de laisser le navigateur modifier le DOM.
