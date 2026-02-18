# ADR 007 : Ascension Événementielle (Chain of Responsibility)

## Statut
Accepté

## Contexte
Comment décider qui gère un événement d'entrée (`Enter`, `Backspace`) dans un éditeur modulaire ? Un bloc ne peut pas seul modifier la structure du document (créer/supprimer des frères), mais le moteur central ne doit pas connaître les détails de chaque bloc (ex: comment un `ListBlock` se divise).

## Décision
Utilisation d'un pattern de **Chaîne de Responsabilité** via la méthode `Block.ascend(eventName, event, data)`.

## Mécanisme
1.  **Réception Locale :** Le bloc focalisé reçoit l'événement. S'il peut le traiter localement (ex: `insertText`), il s'en charge.
2.  **Ascension au Parent :** S'il ne peut pas le traiter (ex: `Enter` à la fin d'une liste), il appelle `ascend()`. L'événement remonte vers le bloc parent.
3.  **Délégation aux Hooks :** Si personne n'a répondu en remontant, l'événement est capturé par `Nabu` qui délègue le traitement aux **Hooks d'Extensions** (ex: `onSplit`, `onDeleteBackward`).

## Conséquences
*   **Modularité Totale :** Chaque extension (Paragraphe, Liste, Tableau) définit sa propre logique de division ou de fusion.
*   **Encapsulation :** Le moteur central `Nabu` n'a pas besoin de `switch(type)` géant. Il est agnostique des types de blocs.
*   **Extensibilité :** On peut facilement ajouter un nouveau type de bloc sans modifier le code existant du moteur.
