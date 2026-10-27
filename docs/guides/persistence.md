---
title: Local persistence
description: Save and restore a document in IndexedDB with createPersistedEditor: options, multi-tab, history and recovery.
section: guides
order: 30
---

# Guide : Persistance locale

Nabu intègre une couche de persistance locale basée sur **IndexedDB** et les **snapshots binaires Loro**. Aucun backend n'est requis.

---

## Démarrage rapide

```js
import { createPersistedEditor } from '@aionbuilders/nabu';

const engine = await createPersistedEditor({ docId: 'my-document' });
```

`createPersistedEditor` est une factory **asynchrone** : elle charge d'abord le snapshot existant avant de créer l'instance. Si aucun snapshot n'existe, le document commence vide.

L'auto-save est actif dès la création — chaque modification est sauvegardée automatiquement 2 secondes après la dernière frappe (et au plus tard 3 secondes après le début d'une longue rafale de frappe, voir `maxWait`), **et immédiatement quand la page est masquée ou fermée**.

---

## Options

```js
const engine = await createPersistedEditor({
  docId,       // (requis) Identifiant unique du document dans IndexedDB
  preset,      // (optionnel) Tableau d'extensions — défaut : FullPreset
  extensions,  // (optionnel) Extensions supplémentaires à ajouter au preset
  debounce,    // (optionnel) Délai d'auto-save en ms — défaut : 2000
  maxWait,     // (optionnel) Attente maximale pendant une rafale, en ms — défaut : 3000
  sync,        // (optionnel) Synchro en direct entre onglets — défaut : true
  onSaveError, // (optionnel) (error) => void — une sauvegarde AUTOMATIQUE a échoué
  onRecover,   // (optionnel) (recovery) => void — le document stocké était illisible
});
```

| Option | Type | Défaut | Description |
|---|---|---|---|
| `docId` | `string` | — | Clé unique dans la base IndexedDB `nabu` |
| `preset` | `Extension[]` | `FullPreset` | Preset de base |
| `extensions` | `Extension[]` | `[]` | Extensions additionnelles |
| `debounce` | `number` | `2000` | Délai en ms entre la dernière modif et la sauvegarde |
| `maxWait` | `number` | `3000` | Pendant une rafale de modifications ininterrompue, une sauvegarde a lieu au moins toutes les `maxWait` ms (jamais plus court que `debounce` ; `0` ou `Infinity` : désactivé, on ne sauvegarde qu'après une pause) |
| `sync` | `boolean` | `true` | Synchronisation **en direct** entre les onglets qui éditent le même `docId` (`BroadcastChannel`). `false` la désactive ; sans `BroadcastChannel` elle est ignorée en silence. La fusion à la sauvegarde ne dépend pas de cette option (voir « Plusieurs onglets ») |
| `onSaveError` | `(error) => void` | — | Appelé quand une sauvegarde **automatique** échoue (quota dépassé…). `saveNow()` rejette pour celui qui l'attend, sans appeler ce hook |
| `onRecover` | `(recovery) => void` | — | Appelé au démarrage quand le document stocké était illisible (voir « Robustesse ») |
| `history` | `'full' \| { mode: 'compact', retain, onBeforeCompact }` | `'full'` | Mode d'historique (voir « Historique » plus bas) : par défaut **rien n'est jamais compacté** |

---

## Méthodes ajoutées à l'instance

`createPersistedEditor` enrichit l'instance `Nabu` retournée avec cinq membres supplémentaires (`isNew`, `persistence`, `saveNow()`, `compact()`, `clearPersistence()`).

### `nabu.isNew`

```js
if (engine.isNew) {
  console.log('Nouveau document, on peut afficher un message de bienvenue');
}
```

`boolean` — `true` si aucun snapshot n'existait au moment de la création (document frais), `false` si le contenu a été restauré depuis IndexedDB. Si le document stocké était illisible et qu'il n'y avait pas de secours, l'éditeur repart vide et `isNew` vaut `true` (`persistence.recovery.kind === 'empty'` dit pourquoi).

---

### `nabu.saveNow()`

```js
await engine.saveNow();
```

Force une sauvegarde **immédiate** sans attendre le debounce. Utile avant de naviguer vers une autre page, ou avant de fermer un dialogue critique.

Retourne une `Promise<void>` qui se résout quand l'écriture IndexedDB est terminée, et **rejette** si elle échoue (quota…) ou si la persistance est indisponible ou arrêtée. Il n'est plus nécessaire de l'appeler avant de quitter la page : Nabu sauvegarde de lui-même à `visibilitychange` (masquée) et `pagehide`.

---

### `nabu.persistence`

L'état de la persistance, **réactif** (`$state` Svelte 5 : lisible dans un template ou un `$effect`, par exemple pour un indicateur « Enregistré / Enregistrement… »).

```svelte
<span class="save-status" data-status={engine.persistence.status}>{engine.persistence.status}</span>
```

| Membre | Description |
|---|---|
| `status` | `'saved'` tout est stocké · `'pending'` des modifications attendent la sauvegarde · `'saving'` une sauvegarde est en cours · `'error'` la dernière sauvegarde a échoué (les modifications restent en mémoire ; **la modification suivante réessaie**) · `'unavailable'` IndexedDB inutilisable, l'éditeur travaille en mémoire seulement |
| `lastSavedAt` | `number \| null` — date (ms) de la dernière sauvegarde réussie de cette session |
| `lastError` | L'erreur de la dernière sauvegarde échouée, ou la raison pour laquelle le stockage est indisponible ; `null` après une sauvegarde réussie |
| `available` | `false` si IndexedDB n'a pas pu être ouvert au démarrage (absent, refusé, bloqué par un autre onglet…). L'éditeur démarre alors **en mémoire** (les fichiers aussi), un avertissement est écrit dans la console, `createPersistedEditor` ne rejette pas |
| `recovery` | `null`, ou `{ kind, error, quarantinedKey, quarantinedKeys, at }` si le document stocké était illisible (voir « Robustesse ») |
| `sync` | `true` tant que la synchro en direct avec les autres onglets tourne (option `sync`, `BroadcastChannel` disponible) |
| `dispose()` | Arrête la persistance de cet éditeur : annule l'auto-save, retire les écouteurs `visibilitychange` / `pagehide`, ferme le canal de synchro, arrête les relances d'envois, ferme la connexion IndexedDB. À appeler quand l'éditeur est détruit (par exemple dans le nettoyage du composant). L'éditeur continue de fonctionner en mémoire. Idempotent |

Les avertissements de persistance (`console.warn`, préfixe `[Nabu]`) sont toujours affichés, même quand `nabu.debugging` est désactivé : l'utilisateur peut être en train de perdre son travail.

---

### `nabu.clearPersistence()`

```js
await engine.clearPersistence();
```

Supprime le snapshot stocké pour ce `docId`, son secours et les enregistrements mis de côté, **et libère ses fichiers** : un fichier n'est supprimé du stockage partagé que si aucun autre document ne le référence ; en mode hôte, `files.onAssetReleased(url)` est appelé pour chaque fichier hébergé (Nabu ne supprime rien chez l'hôte). La prochaine instanciation avec le même `docId` repartira sur un document vide (`isNew === true`).

Utile pour implémenter un bouton "Réinitialiser le document". Le contenu encore en mémoire n'est volontairement pas resauvegardé à la fermeture de la page (seule la modification suivante relance l'auto-save).

---

## Robustesse (ADR 010, thème 8)

### Sauvegarde à la fermeture de la page

À `visibilitychange` (→ `hidden`) et à `pagehide`, s'il reste des modifications non stockées, Nabu sauvegarde **tout de suite** (sans attendre le debounce). Une écriture IndexedDB lancée pendant le déchargement d'une page est asynchrone : le navigateur peut finir de décharger avant qu'elle n'aboutisse (Chromium l'abandonne lors d'un rechargement). Nabu écrit donc en plus, de façon **synchrone**, les modifications depuis la dernière sauvegarde dans `localStorage` (clé `nabu:tail:<docId>`, Loro « update » en base64, jusqu'à 256 Ko) ; au démarrage suivant elles sont fusionnées dans le document (sans doublon si l'écriture IndexedDB a finalement abouti) et la première sauvegarde réussie supprime cette trace. Un tail qui ne se fusionne pas est gardé sous `nabu:tail:<docId>:unapplied`. Reste un effort raisonnable, pas une garantie : un plantage, un processus tué ou un navigateur mobile qui n'envoie jamais ces événements perdent les dernières secondes.

### Un document stocké illisible

Chaque sauvegarde réussie garde le snapshot qu'elle remplace comme **secours** (object store `backups`). Au chargement, si le snapshot ne s'importe pas (octets invalides, tronqué, valeur qui n'est pas du binaire…) :

1. l'enregistrement illisible n'est **jamais supprimé** : il est copié dans l'object store `quarantine` (clé `<docId>@<horodatage>`, avec la valeur d'origine, la date et l'erreur) ;
2. le secours est essayé (`recovery.kind === 'backup'` : le document revient à l'avant-dernière sauvegarde) ;
3. sinon l'éditeur démarre **vide** (`recovery.kind === 'empty'`, `isNew === true`) ;
4. un avertissement est écrit, `nabu.persistence.recovery` est renseigné et `onRecover(recovery)` est appelé : c'est à l'hôte de prévenir l'utilisateur. L'éditeur démarre dans tous les cas.

```js
const engine = await createPersistedEditor({
  docId,
  onRecover: ({ kind, error, quarantinedKey }) => showBanner(
    kind === 'backup' ? 'Document restauré depuis la sauvegarde précédente.' : 'Le document était illisible ; il a été conservé à part.',
  ),
});
```

Si la copie de mise à l'écart échoue, l'éditeur démarre en mémoire seulement (`available === false`) pour ne rien écraser. Un compactage (`history: 'compact'`) supprime le secours, pour qu'un historique supprimé ne survive pas dans une copie ; le suivant est recréé par la sauvegarde d'après.

### Plusieurs onglets sur le même document (P-94)

Deux onglets qui éditent le même `docId` ne s'écrasent plus :

- **Fusion avant chaque sauvegarde.** La sauvegarde lit l'enregistrement stocké et l'écrit dans **une seule transaction IndexedDB** : ce qu'un autre onglet y a enregistré et que ce document n'a pas est **importé** dans le document vivant (le DOM se met à jour comme pour tout changement distant), puis le document est exporté et écrit. Si l'enregistrement contient déjà tout, rien n'est écrit. Ces changements importés **ne sont pas des actions annulables** : Ctrl+Z n'annule que vos propres modifications. Un enregistrement qui ne peut pas être fusionné (octets illisibles, copie compactée par un autre onglet) est copié dans `quarantine` (`<docId>@<date>-unmerged`) avant d'être remplacé, avec un avertissement.
- **Synchro en direct** (option `sync`, défaut `true`). Chaque commit local est diffusé aux autres onglets par un `BroadcastChannel` nommé `nabu:<docId>` : ce que vous tapez dans un onglet apparaît dans l'autre dans la seconde, sans sauvegarde ni rechargement. Un onglet ouvert plus tard demande aux autres ce qui lui manque (leurs changements pas encore sauvegardés) ; un onglet qui a raté un message le redemande. Le curseur de l'utilisateur reste sur le même caractère quand un changement distant arrive (même dans son bloc) ; rien n'est annulable de ce qui vient d'ailleurs ; une composition IME en cours n'est jamais interrompue (les changements attendent sa fin). Les envois de fichiers vers l'hôte restent à l'onglet qui a collé le fichier.
- **À la fermeture**, la sauvegarde reste « aveugle » (instantanée, sans lecture) tant qu'aucun autre onglet n'a écrit depuis ; sinon elle fusionne, et le tail `localStorage` couvre le cas où la page part avant la fin.

```js
const engine = await createPersistedEditor({ docId: 'note', sync: false }); // pas de synchro en direct ; la fusion à la sauvegarde reste active
engine.persistence.sync; // true tant que la synchro tourne
```

### Envois en attente (P-97)

Avec un hôte de fichiers (`files.onBeforePersist`), les envois qui attendent dans l'outbox à l'ouverture du document (interrompus, ou qui avaient échoué) sont **relancés automatiquement** en arrière-plan : tout de suite pour un envoi en erreur, puis après 2 s, 4 s, 8 s… (60 s au plus) à chaque nouvel échec, 8 tentatives par fichier et par session ; l'événement `online` du navigateur donne une série neuve (hors ligne, aucune tentative n'est consommée). Les blocs passent `error` → `pending` → `ready` / `error` ; `block.retry()` reste disponible. Un envoi annulé par l'utilisateur n'est pas relancé. Réglage : `files: { autoRetry: false | { initialDelay, maxDelay, maxAttempts } }`.

### Sauvegarde qui échoue

Une sauvegarde automatique qui échoue (quota…) passe `persistence.status` à `'error'`, écrit un avertissement et appelle `onSaveError(error)`. Aucune exception non rattrapée ; l'éditeur continue ; la modification suivante (ou la fermeture de la page) réessaie.

---

## Historique : `full` (défaut) ou `compact` (opt-in)

Loro garde **tout** l'historique d'un document : c'est ce qui permet de suivre toute son évolution (un romancier qui relit un livre version après version) mais aussi ce qui le fait grossir. Nabu ne choisit jamais à votre place.

```js
// Défaut : historique complet. Rien n'est jamais compacté, élagué ni supprimé.
await createPersistedEditor({ docId: 'book' });                 // = history: 'full'

// Opt-in : compactage à l'ouverture, en gardant 30 jours d'historique
await createPersistedEditor({
  docId: 'notes',
  history: {
    mode: 'compact',
    retain: '30d',                       // ms, '12h', '30d', '2w'... ou 0 = aucun historique passé
    onBeforeCompact: async (fullSnapshot) => {   // Uint8Array : le snapshot COMPLET
      await archive(fullSnapshot);       // si ça jette une erreur, le compactage est ANNULÉ
    },
  },
});
```

| | `full` (défaut) | `compact` |
|---|---|---|
| Historique du texte | conservé intégralement, sans limite | conservé sur la fenêtre `retain` (rien si `retain: 0`) |
| Fichiers du stockage | **jamais supprimés** (aucun ménage pour ce document) | libérés quand ni l'état courant ni l'historique conservé ne les référencent |
| Quand | jamais | **à l'ouverture** (après chargement, migration et reprise des envois), jamais en cours de session |

`retain` est strict : un nombre de millisecondes, `0`, ou `'<nombre><s|m|h|d|w>'` (`'30d'`, `'12h'`). Obligatoire en mode `compact` (aucune valeur par défaut qui détruirait des données). Les versions plus récentes que le point de rétention restent atteignables (`doc.checkout(...)`) ; les plus anciennes disparaissent. Un document dont l'historique n'a pas de dates (écrit avant l'enregistrement des horodatages) n'est jamais élagué par fenêtre : seul `retain: 0` le compacte.

### `nabu.compact({ retain, onBeforeCompact })`

```js
await engine.saveNow();                                   // sinon : refus « unsaved-changes »
const result = await engine.compact({ retain: '90d', onBeforeCompact: (snap) => upload(snap) });
// { compacted: true, bytesBefore, bytesAfter, released: ['sha256-…'], deleted: [...], snapshot }
// { compacted: false, reason: 'pending-uploads' | 'unsaved-changes' | 'archive-failed' | 'detached' | 'busy' | 'nothing-to-compact' | ... }
```

Pour les intégrateurs qui synchronisent et veulent choisir le moment. Il ne **lève jamais** pour un refus (seulement pour un argument invalide) : un refus signifie que **rien n'a été supprimé**.

**Garde-fous** (tous testés) :

1. jamais sans opt-in (`history: { mode: 'compact' }`) ni appel explicite ;
2. `onBeforeCompact(fullSnapshot)` est attendu **avant** que quoi que ce soit soit modifié ou écrit ; une erreur l'annule (`archive-failed`) ;
3. refus (pas d'exception) si un envoi de fichier est en attente ou en cours (`pending-uploads` : la copie locale est alors la seule), s'il y a des modifications non sauvegardées ou non validées (`unsaved-changes`), ou si le document est « checkout » sur une ancienne version (`detached`) ;
4. la rétention est respectée ; le snapshot compacté est vérifié (réimporté et comparé à l'état courant) avant d'être écrit ;
5. la pile d'annulation (undo) est **vidée** après un compactage (ses pas pourraient ressusciter des blocs dont le fichier est libéré) ; elle repart normalement ensuite.

**Comment ça marche** : un snapshot Loro *shallow* est écrit à la version de rétention. À l'ouverture, une nouvelle instance est construite depuis ce snapshot (l'historique disparaît aussi de la mémoire). Avec `nabu.compact()` sur un éditeur déjà ouvert, le snapshot sauvegardé est compacté immédiatement et toutes les sauvegardes suivantes le restent, mais le document **en mémoire** garde son historique jusqu'à la prochaine ouverture. Un pair de synchronisation resté sur une version antérieure ne peut plus fusionner par mises à jour incrémentales.

### Ménage des fichiers

- Mode `full` : aucun fichier du document n'est jamais supprimé.
- Mode `compact` : après le compactage, les fichiers que plus aucune version conservée ne référence sont retirés de `assetIndex` et de la liste `docRefs` du document ; ils ne sont supprimés du stockage IndexedDB (partagé entre les documents de l'origine) que si **aucun** document ne les référence. Un `files.store` personnalisé sans l'API `docRefs` n'est jamais vidé par Nabu.
- **Délai de grâce multi-onglets** : `files.releaseGraceMs` (défaut **10 minutes**, `0` pour le désactiver). Un autre onglet peut venir d'ajouter un fichier (ou de réutiliser un fichier déjà stocké) sans avoir encore sauvegardé ses références ; un ménage ne supprime donc jamais du stockage partagé un fichier dont l'enregistrement date de moins de ce délai, ni un fichier dont l'âge est inconnu (ancien enregistrement sans `savedAt`). Il est simplement ignoré (`result.skipped`), garde sa place dans les `docRefs` du document et sera réexaminé au prochain compactage (ou au prochain `clearPersistence()` du même `docId`). Un `files.store` personnalisé doit offrir `savedAt(hash)` (et idéalement `touch(hash)`) pour que ses fichiers puissent être supprimés.
- Mode hôte : Nabu ne supprime **jamais** rien chez l'hôte. Il appelle `files.onAssetReleased(url)` (attendu ; une erreur est ignorée avec un `nabu.warn`) pour chaque fichier hébergé libéré, et vous décidez :

```js
await createPersistedEditor({
  docId,
  history: { mode: 'compact', retain: '30d' },
  files: {
    onBeforePersist: async (file) => ({ ref: await uploadToMyServer(file) }),
    onAssetReleased: async (url) => { await deleteFromMyServer(url); },
  },
});
```

Les horodatages des modifications sont enregistrés (`doc.setRecordTimestamp(true)`) pour que la fenêtre puisse être honorée ; une fenêtre a la granularité d'un « changement » Loro (les commits à moins de 1000 s sont regroupés), une marge de 1000 s joue en faveur de la conservation.

Détails : [ADR 014](../adr/014-asset-storage.md) §3.6 et §7.

---

## Comment fonctionne l'auto-save

```
[Utilisateur tape]
      │
      ▼
[nabu.commit()]  ──►  [doc.subscribe() déclenché par Loro]
                                │
                                ▼
                       persistence.status = 'pending'
                       minuterie = min(debounce, maxWait restant)
                                │
                         (2 s sans frappe, ou 3 s après la première
                          frappe d'une rafale — ou tout de suite à pagehide)
                                │
                                ▼
                    UNE transaction IndexedDB (saveMerged) :
                      lit l'enregistrement stocké ; ce que ce document n'a pas
                      est importé (mergeStored) ; doc.export({ mode: 'snapshot' })
                      → écrit (l'ancien snapshot devient le secours) —
                      ou rien si l'enregistrement contient déjà tout
```

Le snapshot est le **format binaire natif de Loro** : il encode l'intégralité du document, y compris l'historique CRDT (ce qui permet de conserver l'undo/redo après rechargement). Avec `history: 'full'` (défaut) c'est toujours un snapshot complet ; après un compactage, un snapshot *shallow* (voir plus haut). Les octets des fichiers n'y sont pas : ils vivent dans le stockage de fichiers (ADR 014).

---

## Utilisation avec un preset personnalisé

```js
import { createPersistedEditor, DocumentPreset } from '@aionbuilders/nabu';
import { MyCustomExtension } from './my-extension.js';

const engine = await createPersistedEditor({
  docId: 'article-draft',
  preset: DocumentPreset,
  extensions: [MyCustomExtension],
  debounce: 5000, // sauvegarde 5 secondes après la dernière frappe
});
```

---

## Accès direct à la couche IndexedDB

Les fonctions bas niveau (`loadSnapshot`, `saveSnapshot`, `deleteSnapshot`, `loadRecords`, `listQuarantined`) sont **internes** : elles ne font partie d'aucun des trois points d'entrée publics (`@aionbuilders/nabu`, `/ui`, `/extend`). Passez par `createPersistedEditor` et `engine.persistence` ; le format de stockage ci-dessous est documenté à titre de référence (export, outillage de diagnostic).

> **Note :** Elles opèrent sur la base `nabu` (version 4), object store `snapshots`. Le record stocké a la forme `{ docId: string, snapshot: Uint8Array, savedAt: number }`. `saveSnapshot` fait aussi tourner le secours (object store `backups`, même forme). `loadRecords(docId)` renvoie `{ current, backup }` bruts, `listQuarantined(docId)` les enregistrements mis de côté. La version 4 de la base AJOUTE les object stores `backups` et `quarantine` ; une base plus ancienne se charge comme avant (sans secours).

---

## Limitations connues

- **Multi-onglets** : fusion à la sauvegarde + synchro en direct (voir « Plusieurs onglets »). Limites : deux onglets qui créent en même temps le même document **neuf** gardent chacun leur paragraphe vide initial (deux après la synchro) ; une copie compactée par un autre onglet en cours de session n'est pas fusionnable (mise en quarantaine) ; la synchro ne traverse pas les navigateurs / machines (un provider réseau serait nécessaire).
- **Migration de schéma** : si la structure interne des blocs change de façon incompatible entre versions, les anciens snapshots peuvent échouer à l'import. Pas de stratégie de migration automatique pour l'instant.
- **Opacité** : le format binaire Loro n'est pas lisible sans Loro. Pour exporter vers un format portable (JSON, Markdown), utiliser `nabu.serialize('json')` ou `nabu.serialize('markdown')`.
