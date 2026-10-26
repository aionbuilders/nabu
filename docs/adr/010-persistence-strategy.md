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
- **Multi-onglets** : à l'origine, deux onglets sur le même `docId` s'écrasaient (le dernier qui sauvegarde gagnait). **Résolu (2026-10, thème 8, lot 2, P-94)** : fusion avant chaque sauvegarde + synchro en direct par `BroadcastChannel` (voir « Implementation notes — 2026-10 (theme 8, lot 2) »). Un provider CRDT réseau reste nécessaire pour la collaboration entre machines.
- **Aucune gestion de version de schéma** : si la structure des blocs change de façon incompatible, les anciens snapshots peuvent produire des erreurs à l'import.

## Implementation notes — 2026-10 (theme 8)

Robustesse de la persistance (audit 2026-10, P-91, P-92, P-93, P-95, P-96 ; le multi-onglets, P-94, est le lot suivant). Le comportement du chemin heureux (snapshot Loro dans `snapshots`, debounce sur `doc.subscribe()`) ne change pas ; l'API publique (`createPersistedEditor`, `isNew`, `saveNow`, `clearPersistence`, `history`) reste compatible.

- **Maximum d'attente (P-96)** : option `maxWait` (défaut 3000 ms, jamais plus court que `debounce`, `0`/`Infinity` pour l'ancien comportement). Le debounce est un planificateur pur (`persistence/autosave.js`, horloge injectable, testé en unit) : à chaque changement la minuterie vaut `min(debounce, maxWait - temps écoulé depuis le premier changement de la rafale)`.
- **Sauvegarde à la fermeture (P-91)** : écouteurs `visibilitychange` (→ `hidden`) et `pagehide`, ajoutés par l'éditeur persistant, retirés par `nabu.persistence.dispose()` (qui annule aussi l'auto-save et ferme la connexion). Sauvegarde immédiate s'il y a des modifications non stockées. *Limite constatée* : une transaction IndexedDB lancée pendant le déchargement n'aboutit pas lors d'un rechargement (Chromium ; elle aboutit lors d'une navigation si ses requêtes sont émises de façon synchrone et validées avec `tx.commit()`). Mesures : une connexion gardée ouverte depuis le démarrage (`IDBConnection`) ; la rotation du secours se fait sans lecture préalable (`previous` = dernier enregistrement écrit ou chargé par cette session) pour que toutes les requêtes soient émises dans la même tâche ; et un **tail** dans `localStorage` (`nabu:tail:<docId>`, `doc.export({ mode: 'update', from })` en base64, ≤ 256 Ko), écrit de façon synchrone, fusionné au démarrage suivant (import Loro idempotent ; document jamais sauvegardé : le tail est le document), supprimé par la première sauvegarde réussie, mis de côté sous `…:unapplied` s'il ne s'applique pas. Reste un effort raisonnable (plantage, processus tué : les dernières secondes sont perdues).
- **Document illisible (P-92)** : schéma de la base `nabu` passé en **version 4**, qui AJOUTE `backups` (même forme que `snapshots`) et `quarantine` (clé `<docId>@<horodatage>[-backup]`, index `docId`) ; les données d'une base plus ancienne ne sont pas touchées et un document sans secours se charge comme avant. Chaque sauvegarde (une seule transaction) fait du snapshot remplacé le secours, si c'est du binaire lisible (un enregistrement illisible ne remplace jamais un bon secours). Un compactage supprime le secours (l'historique supprimé ne doit pas survivre dans une copie). Au chargement, décision pure `resolveLoad` (`persistence/recovery.js`) : snapshot → secours → vide ; chaque enregistrement qui échoue est copié dans `quarantine` AVANT toute modification de l'enregistrement actif (restauré depuis le secours, ou supprimé s'il n'y a rien de lisible), dans une transaction. Si cette mise à l'écart échoue, rien n'est écrit (éditeur en mémoire). `clearPersistence()` supprime aussi le secours et la quarantaine du document.
- **IndexedDB indisponible (P-93)** : `indexedDB` absent, `open` en erreur, ou ouverture bloquée plus de 3 s par un autre onglet : l'éditeur démarre en mémoire (`MemoryAssetStore` et outbox mémoire pour les fichiers), `nabu.persistence.available === false`, statut `'unavailable'`, avertissement ; aucun rejet. `saveNow()` rejette (« unavailable »), `clearPersistence()` ne fait rien.
- **État et erreurs (P-95)** : `nabu.persistence` (`persistence/state.svelte.js`, `$state` : `status`, `lastSavedAt`, `lastError`, `available`, `recovery`) ; statuts `saved | pending | saving | error | unavailable`. Une sauvegarde automatique qui échoue : statut `error`, avertissement, `onSaveError(error)` ; la modification suivante réessaie ; `saveNow()` rejette pour celui qui l'attend (sans appeler le hook). Les avertissements de persistance utilisent `console.warn` directement : `nabu.warn` est silencieux hors `nabu.debugging`.
- **Tests** : `tests/unit/persistence-autosave.test.js` (planificateur, décision de chargement), `tests/unit/persistence-robustness.test.js` (fake-indexeddb : rotation, quarantaine, indisponibilité, statuts, fermeture, tail), `tests/e2e/persistence-audit.spec.ts` (2b, 2b′, 2b″, 2c, 6a–6e, 7a–7e, 7bis).

## Implementation notes — 2026-10 (theme 8, lot 2 : multi-onglets P-94, envois en attente P-97)

Décisions du propriétaire (2026-10-26) : fusion avant sauvegarde + synchro entre onglets en direct ; l'annulation ne survit pas au rechargement ; relance automatique des envois en attente à l'ouverture, avec espacement.

### Fusion avant sauvegarde (P-94, a)

- **Une transaction, lecture + écriture** (`saveMerged`, `indexeddb.js`) : la transaction `readwrite` (snapshots + backups + quarantine) lit l'enregistrement stocké, appelle SYNCHRONEMENT `prepare(stored)`, puis écrit le résultat. IndexedDB sérialise les transactions `readwrite` d'un même store entre onglets : deux sauvegardes simultanées ne peuvent pas s'écraser, la seconde lit ce que la première a écrit.
- **`prepare`** (`persistence.js`, `save()`) : si l'enregistrement n'est pas celui que cet éditeur a écrit ou chargé en dernier (`savedAt` + taille), `mergeStored(doc, bytes, nabu.importRemote)` (`merge.js`) lit le **vecteur de versions** de l'enregistrement dans son en-tête (`decodeImportBlobMeta`, sans décoder tout) et le compare à celui du document (`VersionVector.compare`) : il n'importe que si l'enregistrement est en avance ou concurrent. Puis le document est exporté (`snapshot`, ou `shallow-snapshot` après un compactage de la session) et écrit. **Si l'enregistrement contient déjà tout le document, rien n'est écrit** (le statut redevient `saved` ; l'enregistrement lu devient « le dernier stocké » pour la rotation du secours). L'enregistrement remplacé devient le secours, comme avant.
- **Enregistrement non fusionnable** (octets illisibles, ou snapshot *shallow* d'un autre onglet qui contient des changements que ce document ne peut pas recevoir : Loro n'importe pas un shallow-snapshot dans un document non vide) : copié dans `quarantine` sous `<docId>@<horodatage>-unmerged` AVANT d'être remplacé, avertissement. Jamais de perte silencieuse.
- **`Nabu#importRemote(bytes)`** (`nabu.svelte.js`) : `doc.import` + conservation du curseur. Le `UndoManager` de Loro n'enregistre que les commits LOCAUX : un import n'est **jamais une action annulable** (vérifié : `canUndo()` reste `false` après un import) et annuler ses propres modifications ensuite fonctionne (Loro transforme). Les blocs et le texte se mettent à jour par les événements Loro habituels (arbre, `LoroText.subscribe`).
- **Écriture « aveugle » à la fermeture** : à `pagehide`/`visibilitychange`, la sauvegarde reste émise sans lecture préalable (`previous` = dernier enregistrement connu : toutes les requêtes dans la même tâche, ce que la fermeture exige) **tant qu'aucun autre onglet n'a écrit depuis** : chaque sauvegarde laisse dans `localStorage` (`nabu:rev:<docId>`) le jeton (`savedAt:taille`) de l'enregistrement, lisible de façon synchrone par les autres onglets. Si le jeton diffère de celui que cet onglet connaît, la sauvegarde de fermeture **fusionne** (asynchrone : elle aboutit quand l'onglet passe seulement en arrière-plan ; pour une page qui part vraiment, le tail `localStorage` — écrit dans tous les cas — garde les changements). Pas de jeton (enregistrement écrit par une ancienne version) : comme avant (aveugle).

### Synchro en direct (P-94, b, c)

- **Option `sync`** (défaut `true`) ; `nabu.persistence.sync` (réactif) dit si elle tourne. Pas de `BroadcastChannel` (ou IndexedDB indisponible) : ignorée en silence. `nabu.persistence.dispose()` ferme le canal.
- **Protocole** (`sync.js`, canal `nabu:<docId>`, messages `{ t, from, to?, … }`, `from` = identifiant aléatoire de l'éditeur) : `update { bytes }` — mise à jour Loro (`export({ mode: 'update', from: <dernière version diffusée> })`), diffusée après chaque commit LOCAL (`doc.subscribe`, `by !== 'import'`), ou envoyée à un pair en réponse à un `hello`. `hello { vv, reply? }` — « voici ma version, envoie-moi ce qui me manque » : envoyé à l'ouverture et quand une mise à jour arrive avec un trou (`status.pending` non vide) ; le destinataire répond par un `update` de ce qui manque à l'émetteur et, si l'émetteur a quelque chose qui lui manque (et que ce n'est pas déjà une réponse), par son propre `hello` (`reply: true`) : deux onglets qui ont divergé (gelé, hors ligne) convergent dans les deux sens.
- **Sans écho** : `sent` (la version déjà diffusée) saute par-dessus chaque import ; les imports n'émettent rien. Une mise à jour reçue pendant une composition IME attend sa fin (relecture toutes les 120 ms).
- **Fichiers** : un import ne déclenche jamais d'envoi vers l'hôte (`Uploads#onDocEvent` ignore `event.by === 'import'`) : l'onglet qui a collé le fichier possède l'envoi, deux onglets n'envoient pas le même fichier. S'il disparaît avant la fin, l'ouverture suivante reprend (P-97).
- **Curseur (c)** : avant tout import distant, la sélection du DOM est capturée comme curseurs Loro (le mécanisme d'annulation de l'ADR 015, `captureSelection`), puis remise après le rendu (`restoreSelection(…, reveal = false)` : pas de défilement). Le texte d'un nœud réécrit par Svelte enverrait sinon le curseur au début du bloc.
- **Limites connues** : (1) deux onglets qui créent le même document NEUF en même temps ont chacun leur paragraphe vide initial : après la synchro il y en a deux (Loro fusionne deux créations indépendantes). (2) Le tail `localStorage` est partagé entre les onglets d'un `docId` : la sauvegarde d'un onglet l'efface, avec la synchro les autres onglets ont déjà ces changements en mémoire. (3) Un compactage fait par un autre onglet en cours de session n'est pas fusionnable (voir plus haut : mise en quarantaine).

### Relance des envois à l'ouverture (P-97)

`Uploads` (ADR 014) relance seul, en arrière-plan, les envois que l'outbox liste à l'ouverture : un fichier `error` tout de suite (tentative 1), puis, à chaque échec, après 2 s, 4 s, 8 s… (plafond 60 s) ; 8 tentatives par fichier et par session ; l'événement `online` donne une série neuve ; hors ligne (`navigator.onLine === false`) aucune tentative n'est consommée. Un envoi annulé par l'utilisateur (`cancelled`) n'est pas relancé ; les échecs de la session courante restent à `block.retry()`. Option `files.autoRetry` (`false` ou `{ initialDelay, maxDelay, maxAttempts }`). Passe par `Uploads#retry` (`error` → `pending` → `ready` / `error`), donc le même chemin que `block.retry()` ; `persistence.dispose()` arrête les minuteries.

### Tests

`tests/unit/persistence-multitab.test.js` (fusion, protocole, écho, hello, trou, composition, quarantaine, jeton, fermeture), `tests/unit/asset-uploads.test.js` (relance, espacement, plafond, `online`, hors ligne, annulation, `autoRetry: false`, import), `tests/e2e/persistence-audit.spec.ts` sections 4 (4a–4j) et 9 (9, 9b).
