# ADR 006 : Stratégie de Bridge de Sélection (DOM ↔ Modèle)

## Statut
Accepté

## Contexte
Dans une architecture "Single ContentEditable", le navigateur gère une sélection DOM brute (`Node`, `Offset`) qui n'a aucun sens pour le CRDT (Loro), lequel attend des offsets textuels linéaires (`blockId`, `index`). De plus, le rendu réactif de Svelte risque de détruire le nœud de texte focalisé par le curseur à chaque changement d'état.

## Décision
1.  **Mapping DOM → Modèle :** Utilisation d'un `Range` virtuel (`range.toString().length`) pour calculer l'offset réel, en ignorant les balises HTML intermédiaires.
2.  **Mapping Modèle → DOM :** Utilisation d'un `TreeWalker` pour retrouver le point d'insertion exact après un rendu Svelte.
3.  **Mise à jour Différentielle :** Seuls les blocs entrant ou sortant de la sélection voient leur propriété réactive `selected` modifiée (O(M)).

## Conséquences
*   **Performance :** Le calcul de sélection est quasi-instantané et ne dépend pas de la taille totale du document.
*   **Stabilité :** Le curseur est restauré après chaque mutation Loro (`await tick()`), offrant une sensation de frappe "native".
*   **Précision :** On gère nativement le texte plat et on anticipe déjà les éléments riches (images, liens).
