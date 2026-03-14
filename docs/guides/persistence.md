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

---

## Méthodes ajoutées à l'instance

`createPersistedEditor` enrichit l'instance `Nabu` retournée avec trois membres supplémentaires.

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

Supprime le snapshot stocké pour ce `docId`. La prochaine instanciation avec le même `docId` repartira sur un document vide (`isNew === true`).

Utile pour implémenter un bouton "Réinitialiser le document".

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

Le snapshot est le **format binaire natif de Loro** : il encode l'intégralité du document, y compris l'historique CRDT (ce qui permet de conserver l'undo/redo après rechargement).

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
