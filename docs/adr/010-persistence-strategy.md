# ADR 010 : Stratégie de Persistance (IndexedDB + Snapshot Loro)

## Statut
Accepté

## Contexte
Nabu est un éditeur local-first. Le contenu édité doit survivre aux rechargements de page sans nécessiter de backend. Il faut choisir :
- **où** stocker l'état (localStorage, IndexedDB, fichier, serveur),
- **quoi** stocker (texte brut, JSON, état CRDT binaire),
- **quand** sauvegarder (à chaque frappe, à intervalles, sur `beforeunload`).

## Décision

### Stockage : IndexedDB
IndexedDB est utilisé plutôt que `localStorage` pour deux raisons :
- Il supporte les `Uint8Array` nativement (pas de sérialisation base64 coûteuse).
- Sa capacité est bien supérieure (~50 % du disque disponible vs ~5 Mo pour localStorage).

La base est nommée `nabu` (v1), avec un unique object store `snapshots` dont la clé est `docId`. Chaque entrée contient `{ docId, snapshot: Uint8Array, savedAt: number }`.

### Format : Snapshot binaire Loro
L'état est exporté via `doc.export({ mode: 'snapshot' })` — un format binaire compact produit par Loro qui encode l'intégralité du DAG CRDT (historique compris). À la restauration, `doc.import(snapshot)` recharge l'état en une seule opération, sans reconstruction manuelle.

Ce choix évite de maintenir un serializer/deserializer JSON custom et garantit la fidélité totale de l'état CRDT (y compris l'historique pour undo/redo).

### Déclenchement : Debounce sur `doc.subscribe()`
`doc.subscribe()` est le callback Loro déclenché après chaque `doc.commit()`. Une sauvegarde immédiate à chaque frappe serait trop agressive. Un `setTimeout` de 2 secondes (configurable) est réarmé à chaque nouvelle notification, ce qui produit un debounce naturel : la sauvegarde a lieu 2 s après la dernière modification.

### Interface : `createPersistedEditor()`
Une factory async miroir de `createEditor()` est exposée. Elle enrichit l'instance `Nabu` de trois méthodes supplémentaires (`saveNow`, `clearPersistence`, `isNew`) sans modifier la classe `Nabu` elle-même, pour conserver la séparation des préoccupations.

## Conséquences
- **Zéro backend requis** pour la persistance de base.
- **Restauration opaque** : le snapshot binaire n'est pas inspectable sans Loro. Pas de migration de données possible entre versions majeures de Loro sans stratégie dédiée.
- **Pas de multi-onglets** : deux onglets ouvrant le même `docId` écriront le snapshot indépendamment (le dernier qui sauvegarde gagne). Une coordination via `BroadcastChannel` ou un provider CRDT réseau sera nécessaire pour l'usage collaboratif.
- **Aucune gestion de version de schéma** : si la structure des blocs change de façon incompatible, les anciens snapshots peuvent produire des erreurs à l'import.
