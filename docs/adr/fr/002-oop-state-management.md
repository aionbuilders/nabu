# ADR 002 : Gestion d'état via Classes Svelte 5 (OOP)

## Statut
Accepté

## Contexte
Svelte 5 introduit les Runes (`$state`, `$derived`). Bien que Svelte soit souvent utilisé de manière fonctionnelle, la complexité d'un moteur d'édition (synchronisation CRDT, hiérarchie, méthodes de transformation) nécessite une encapsulation forte.

## Décision
Utilisation systématique de **Classes Svelte (`.svelte.js`)** pour représenter les entités du moteur (`Nabu`, `Block`, `MegaBlock`).

## Conséquences
*   **Encapsulation :** Chaque bloc possède sa propre logique de synchronisation Loro et son état réactif.
*   **Extensibilité :** Utilisation de l'héritage (`MegaBlock extends Block`) pour partager la logique structurelle.
*   **Lisibilité :** Les méthodes de mutation (ex: `block.updateText()`) sont regroupées avec la donnée, facilitant la maintenance et la compréhension du flux.
*   **Performance :** Les Runes dans les classes permettent une réactivité "fine-grained" (seule la propriété modifiée déclenche un re-render, pas tout l'objet).
