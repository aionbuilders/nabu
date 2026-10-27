# ADR 005 : Typage via JSDoc strict

## Statut
Accepté

## Contexte
Le projet vise une DX (Developer Experience) de haut niveau tout en gardant une base de code flexible et rapide à itérer.

## Décision
Utilisation de **JSDoc strict** au lieu de TypeScript (`.ts`).

## Conséquences
*   **Performance Build :** Pas d'étape de compilation TS vers JS nécessaire lors du développement.
*   **Typage Robuste :** Avec `checkJs: true` et un typage JSDoc rigoureux, on obtient la même sécurité et autocomplétion que TS dans l'IDE.
*   **Modularité :** Plus facile d'injecter des blocs dynamiques sans se battre avec des interfaces TS complexes.
*   **Standard :** Utilisation de `@typedef`, `@property`, et `@import` (syntaxe TS dans JSDoc) pour une documentation qui sert aussi de typage.
