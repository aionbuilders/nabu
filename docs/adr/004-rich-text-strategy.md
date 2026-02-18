# ADR 004 : Stratégie Rich Text (LoroText vs Blocs imbriqués)

## Statut
Accepté

## Contexte
Une question critique s'est posée : doit-on découper un paragraphe en plusieurs blocs enfants pour gérer le gras, l'italique ou les liens (approche MegaBlock) ou traiter le paragraphe comme une seule unité de texte ?

## Décision
Utilisation exclusive de **`LoroText` et des `marks`** pour tout ce qui est enrichissement de texte "inline". Un paragraphe est un `Block` (Leaf), jamais un `MegaBlock`.

## Raisons techniques (Rationnel)
1.  **Stabilité du curseur :** Évite les frontières de composants Svelte lors du déplacement du curseur. Le navigateur gère beaucoup mieux un seul nœud de texte.
2.  **Robustesse CRDT :** Les algorithmes de texte de Loro sont optimisés pour les conflits de caractères. Utiliser des blocs pour du texte créerait des suppressions/réinsertions massives de blocs lors d'un simple changement de style, rendant la collaboration instable.
3.  **Performance de rendu :** Réduit drastiquement le nombre d'instances de classes et de composants Svelte.
4.  **Simplicité du Mapping :** Traduire une position DOM vers une position Loro est linéaire et ne nécessite pas de calculs de décalages entre plusieurs sous-blocs.

## Conséquences
*   Le rendu des styles (gras, etc.) se fera via une logique de "Mark Renderer" au sein du composant de texte, et non par l'arborescence des blocs.
