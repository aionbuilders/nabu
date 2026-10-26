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

La base est nommée `nabu`, avec un object store `snapshots` dont la clé est `docId` (la version actuelle du schéma et les autres stores sont décrits plus bas). Chaque entrée contient `{ docId, snapshot: Uint8Array, savedAt: number }`.

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
- **Pas de multi-onglets** (lot suivant du thème 8) : deux onglets ouvrant le même `docId` écriront le snapshot indépendamment (le dernier qui sauvegarde gagne). Une coordination via `BroadcastChannel` ou un provider CRDT réseau sera nécessaire pour l'usage collaboratif.
- **Aucune gestion de version de schéma** : si la structure des blocs change de façon incompatible, les anciens snapshots peuvent produire des erreurs à l'import.

## Implementation notes — 2026-10 (theme 8)

Robustesse de la persistance (audit 2026-10, P-91, P-92, P-93, P-95, P-96 ; le multi-onglets, P-94, est le lot suivant). Le comportement du chemin heureux (snapshot Loro dans `snapshots`, debounce sur `doc.subscribe()`) ne change pas ; l'API publique (`createPersistedEditor`, `isNew`, `saveNow`, `clearPersistence`, `history`) reste compatible.

- **Maximum d'attente (P-96)** : option `maxWait` (défaut 3000 ms, jamais plus court que `debounce`, `0`/`Infinity` pour l'ancien comportement). Le debounce est un planificateur pur (`persistence/autosave.js`, horloge injectable, testé en unit) : à chaque changement la minuterie vaut `min(debounce, maxWait - temps écoulé depuis le premier changement de la rafale)`.
- **Sauvegarde à la fermeture (P-91)** : écouteurs `visibilitychange` (→ `hidden`) et `pagehide`, ajoutés par l'éditeur persistant, retirés par `nabu.persistence.dispose()` (qui annule aussi l'auto-save et ferme la connexion). Sauvegarde immédiate s'il y a des modifications non stockées. *Limite constatée* : une transaction IndexedDB lancée pendant le déchargement n'aboutit pas lors d'un rechargement (Chromium ; elle aboutit lors d'une navigation si ses requêtes sont émises de façon synchrone et validées avec `tx.commit()`). Mesures : une connexion gardée ouverte depuis le démarrage (`IDBConnection`) ; la rotation du secours se fait sans lecture préalable (`previous` = dernier enregistrement écrit ou chargé par cette session) pour que toutes les requêtes soient émises dans la même tâche ; et un **tail** dans `localStorage` (`nabu:tail:<docId>`, `doc.export({ mode: 'update', from })` en base64, ≤ 256 Ko), écrit de façon synchrone, fusionné au démarrage suivant (import Loro idempotent ; document jamais sauvegardé : le tail est le document), supprimé par la première sauvegarde réussie, mis de côté sous `…:unapplied` s'il ne s'applique pas. Reste un effort raisonnable (plantage, processus tué : les dernières secondes sont perdues).
- **Document illisible (P-92)** : schéma de la base `nabu` passé en **version 4**, qui AJOUTE `backups` (même forme que `snapshots`) et `quarantine` (clé `<docId>@<horodatage>[-backup]`, index `docId`) ; les données d'une base plus ancienne ne sont pas touchées et un document sans secours se charge comme avant. Chaque sauvegarde (une seule transaction) fait du snapshot remplacé le secours, si c'est du binaire lisible (un enregistrement illisible ne remplace jamais un bon secours). Un compactage supprime le secours (l'historique supprimé ne doit pas survivre dans une copie). Au chargement, décision pure `resolveLoad` (`persistence/recovery.js`) : snapshot → secours → vide ; chaque enregistrement qui échoue est copié dans `quarantine` AVANT toute modification de l'enregistrement actif (restauré depuis le secours, ou supprimé s'il n'y a rien de lisible), dans une transaction. Si cette mise à l'écart échoue, rien n'est écrit (éditeur en mémoire). `clearPersistence()` supprime aussi le secours et la quarantaine du document.
- **IndexedDB indisponible (P-93)** : `indexedDB` absent, `open` en erreur, ou ouverture bloquée plus de 3 s par un autre onglet : l'éditeur démarre en mémoire (`MemoryAssetStore` et outbox mémoire pour les fichiers), `nabu.persistence.available === false`, statut `'unavailable'`, avertissement ; aucun rejet. `saveNow()` rejette (« unavailable »), `clearPersistence()` ne fait rien.
- **État et erreurs (P-95)** : `nabu.persistence` (`persistence/state.svelte.js`, `$state` : `status`, `lastSavedAt`, `lastError`, `available`, `recovery`) ; statuts `saved | pending | saving | error | unavailable`. Une sauvegarde automatique qui échoue : statut `error`, avertissement, `onSaveError(error)` ; la modification suivante réessaie ; `saveNow()` rejette pour celui qui l'attend (sans appeler le hook). Les avertissements de persistance utilisent `console.warn` directement : `nabu.warn` est silencieux hors `nabu.debugging`.
- **Tests** : `tests/unit/persistence-autosave.test.js` (planificateur, décision de chargement), `tests/unit/persistence-robustness.test.js` (fake-indexeddb : rotation, quarantaine, indisponibilité, statuts, fermeture, tail), `tests/e2e/persistence-audit.spec.ts` (2b, 2b′, 2b″, 2c, 6a–6e, 7a–7e, 7bis).
