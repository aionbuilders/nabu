# Guide : Persistance locale

Nabu intègre une couche de persistance locale basée sur **IndexedDB** et les **snapshots binaires Loro**. Aucun backend n'est requis.

---

## Démarrage rapide

```js
import { createPersistedEditor } from '@aionbuilders/nabu';

const engine = await createPersistedEditor({ docId: 'my-document' });
```

`createPersistedEditor` est une factory **asynchrone** : elle charge d'abord le snapshot existant avant de créer l'instance. Si aucun snapshot n'existe, le document commence vide.

L'auto-save est actif dès la création — chaque modification est sauvegardée automatiquement 2 secondes après la dernière frappe.

---

## Options

```js
const engine = await createPersistedEditor({
  docId,       // (requis) Identifiant unique du document dans IndexedDB
  preset,      // (optionnel) Tableau d'extensions — défaut : FullPreset
  extensions,  // (optionnel) Extensions supplémentaires à ajouter au preset
  debounce,    // (optionnel) Délai d'auto-save en ms — défaut : 2000
});
```

| Option | Type | Défaut | Description |
|---|---|---|---|
| `docId` | `string` | — | Clé unique dans la base IndexedDB `nabu` |
| `preset` | `Extension[]` | `FullPreset` | Preset de base |
| `extensions` | `Extension[]` | `[]` | Extensions additionnelles |
| `debounce` | `number` | `2000` | Délai en ms entre la dernière modif et la sauvegarde |
| `history` | `'full' \| { mode: 'compact', retain, onBeforeCompact }` | `'full'` | Mode d'historique (voir « Historique » plus bas) : par défaut **rien n'est jamais compacté** |

---

## Méthodes ajoutées à l'instance

`createPersistedEditor` enrichit l'instance `Nabu` retournée avec quatre membres supplémentaires (`isNew`, `saveNow()`, `compact()`, `clearPersistence()`).

### `nabu.isNew`

```js
if (engine.isNew) {
  console.log('Nouveau document, on peut afficher un message de bienvenue');
}
```

`boolean` — `true` si aucun snapshot n'existait au moment de la création (document frais), `false` si le contenu a été restauré depuis IndexedDB.

---

### `nabu.saveNow()`

```js
await engine.saveNow();
```

Force une sauvegarde **immédiate** sans attendre le debounce. Utile avant de naviguer vers une autre page, ou avant de fermer un dialogue critique.

```js
// Exemple : sauvegarder avant navigation
window.addEventListener('beforeunload', () => engine.saveNow());
```

Retourne une `Promise<void>` qui se résout quand l'écriture IndexedDB est terminée.

---

### `nabu.clearPersistence()`

```js
await engine.clearPersistence();
```

Supprime le snapshot stocké pour ce `docId` **et libère ses fichiers** : un fichier n'est supprimé du stockage partagé que si aucun autre document ne le référence ; en mode hôte, `files.onAssetReleased(url)` est appelé pour chaque fichier hébergé (Nabu ne supprime rien chez l'hôte). La prochaine instanciation avec le même `docId` repartira sur un document vide (`isNew === true`).

Utile pour implémenter un bouton "Réinitialiser le document".

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
                       clearTimeout(saveTimer)
                       saveTimer = setTimeout(save, debounce)
                                │
                         (2 secondes plus tard, si pas de nouvelle frappe)
                                │
                                ▼
                    doc.export({ mode: 'snapshot' })  →  Uint8Array
                                │
                                ▼
                    saveSnapshot(docId, snapshot)  →  IndexedDB
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

Pour des usages avancés (export, import, nettoyage en batch), les fonctions bas niveau sont exportées :

```js
import { loadSnapshot, saveSnapshot, deleteSnapshot } from '@aionbuilders/nabu';

// Charger un snapshot brut
const snapshot = await loadSnapshot('my-document'); // Uint8Array | null

// Sauvegarder manuellement un snapshot brut
await saveSnapshot('my-document', snapshot);

// Supprimer un snapshot
await deleteSnapshot('my-document');
```

> **Note :** Ces fonctions opèrent sur la base `nabu` v1, object store `snapshots`. Le record stocké a la forme `{ docId: string, snapshot: Uint8Array, savedAt: number }`.

---

## Limitations connues

- **Multi-onglets** : deux onglets ouvrant le même `docId` sauvegardent indépendamment — le dernier à écrire l'emporte. Pas de synchronisation temps-réel entre onglets.
- **Migration de schéma** : si la structure interne des blocs change de façon incompatible entre versions, les anciens snapshots peuvent échouer à l'import. Pas de stratégie de migration automatique pour l'instant.
- **Opacité** : le format binaire Loro n'est pas lisible sans Loro. Pour exporter vers un format portable (JSON, Markdown), utiliser `nabu.serialize('json')` ou `nabu.serialize('markdown')`.
