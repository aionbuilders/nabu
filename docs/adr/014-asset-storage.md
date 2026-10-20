# ADR 014 — Stockage des fichiers hors du document, et modes d'historique

**Statut** : accepté (2026-10-20, validé par le propriétaire)
**Remplace** : le « mode par défaut » de `docs/design/file-handling.md` (octets dans la map Loro `assets`)
**Liés** : ADR 010 (persistance), `docs/design/clipboard-format.md`, `docs/design/import-export.md`, audit 2026-10 (thème 6)

---

## 1. Contexte

Depuis la beta, un fichier envoyé en mode par défaut est stocké **dans le document Loro** (map `assets`, référence `nabu-asset:<uuid>`). L'intention était un document autonome : un seul snapshot contient tout.

Problèmes constatés pendant l'audit :

- **Loro garde tout l'historique** et la persistance exporte un snapshot *complet* (`mode: 'snapshot'`). Un fichier supprimé reste donc **pour toujours** dans le document sauvegardé. Ajouter puis retirer des images fait grossir le document sans limite.
- Un CRDT est fait pour du texte et de la structure qui changent souvent, pas pour des blobs immuables : chaque sauvegarde et chaque future synchronisation transportent ces octets.
- Le texte et un fichier n'ont pas la même durée de vie : le texte change sans cesse, un fichier ne change jamais une fois envoyé.

Par ailleurs, l'historique complet a une vraie valeur (ex. un romancier qui veut suivre toute l'évolution de son texte) : il ne doit **jamais** être perdu sans décision explicite.

## 2. Décision

1. **Le document et son historique ne contiennent que des références.** Les octets vivent dans un **stockage de fichiers séparé**.
2. **Références par empreinte de contenu** : `nabu-asset:sha256-<hex>`.
3. **L'historique complet est le mode par défaut.** Le compactage n'a lieu que sur demande explicite de l'intégrateur, avec des garde-fous.

## 3. Conception

### 3.1 Références

- Format : `nabu-asset:sha256-<64 hex>` — empreinte SHA-256 des octets (`crypto.subtle.digest`).
- Conséquences : déduplication (la même image collée deux fois = un seul stockage), vérification d'intégrité à l'import, copier-coller entre documents partageant le même stockage sans recopie.
- Les références existantes restent lisibles : `nabu-asset:<uuid>` (beta, migrées — §3.7) et les URL d'hôte (`https://…`, refs renvoyées par `onBeforePersist`).

### 3.2 Index des fichiers dans le document (métadonnées seulement)

Le document porte une petite map Loro `assetIndex` : `hash → { mime, name, size, url? }`.

- **Jamais d'octets** dedans : quelques dizaines d'octets par fichier, l'historique reste léger.
- `url` : l'emplacement chez l'hôte une fois l'envoi terminé (ce que renvoie `onBeforePersist`). Un autre appareil qui ouvre le document sait ainsi où trouver le fichier.
- Le bloc média ne stocke que `ref` (+ `alt`, `name`, `status`), comme aujourd'hui.

### 3.3 Stockages (`AssetStore`)

Interface interne, enfichable :

```js
/** @typedef {{ has(hash): Promise<boolean>, get(hash): Promise<Blob|null>,
 *              put(hash, blob, meta): Promise<void>, delete(hash): Promise<void>,
 *              keys(): AsyncIterable<string> }} AssetStore */
```

| Contexte | Stockage par défaut |
|---|---|
| `createEditor` / `new Nabu()` (sans persistance) | `MemoryAssetStore` (perdu au rechargement, comme le document) |
| `createPersistedEditor` | `IndexedDBAssetStore` — base `nabu`, magasin `assets`, **partagé par tous les documents de l'origine** (déduplication entre documents), avec un index `docRefs[docId] → Set<hash>` pour le ménage |
| Option `files.store` | stockage fourni par l'intégrateur (même interface) |

Le stockage local sert aussi de **cache** pour les fichiers hébergés chez l'hôte.

### 3.4 Cycle de vie d'un fichier

1. **Réception** (sélecteur, collage, glisser-déposer, import) : calcul de l'empreinte, **écriture locale immédiate** (`store.put`), entrée dans `assetIndex`, bloc créé avec `ref = nabu-asset:sha256-…`.
   - Sans hôte : statut `ready` immédiatement (hors ligne, instantané).
2. **Avec hôte** (`onBeforePersist`) : le bloc est `pending`, l'envoi part en arrière-plan avec `{ signal, onProgress }`.
   - La copie locale **est la boîte d'envoi** : si l'onglet est fermé, l'envoi **reprend à la réouverture** (la liste des envois en attente est persistée à côté du stockage, hors du document).
   - Succès : `assetIndex[hash].url = …`, statut `ready` — commit **hors undo** (origine silencieuse, déjà en place). La référence du bloc **ne change pas** (plus d'échange de ref).
   - Échec : statut `error`, la copie locale est gardée pour réessayer.
   - Ouvert sur un autre appareil avant la fin de l'envoi : ni octets locaux ni `url` → statut affiché « envoi interrompu ».
3. **Affichage** : `Files.resolve(ref)` → objectURL depuis le stockage local, sinon `url` de l'index (via `config.resolve` si fourni), sinon état « fichier manquant ». Les objectURL sont révoqués quand plus aucun bloc monté ne les utilise.
4. **Suppression d'un bloc pendant l'envoi** : si plus aucun bloc n'utilise cette empreinte, l'envoi est **annulé** (`AbortController`) ; un Ctrl+Z le relance.

### 3.5 API préparées pour l'interface (sans UI pour l'instant)

Conformément à la règle « interface nouvelle = sessions de design dédiées », seul le cœur est livré :

- `block.progress` (réactif, 0–1, `null` hors envoi) ; `block.retry()`, `block.cancel()` ; `block.setAlt()` (existe déjà).
- Option `files.maxFileSize` (aucune limite par défaut) : un fichier trop gros est refusé avec un statut `rejected` et une raison lisible (pas seulement un avertissement console).
- Événements pour le glisser-déposer (survol, dépôt) que l'interface future pourra exploiter.

### 3.6 Modes d'historique et ménage des fichiers

```js
createPersistedEditor({ docId, history: 'full' })            // défaut
createPersistedEditor({ docId, history: { mode: 'compact', retain: '30d', onBeforeCompact } })
nabu.compact({ retain, onBeforeCompact })                      // explicite, pour les intégrateurs qui synchronisent
```

| | `full` (défaut) | `compact` (opt-in) |
|---|---|---|
| Historique du texte | conservé intégralement | conservé sur la fenêtre `retain` (ou rien si `retain: 0`) |
| Fichiers | conservés tant qu'**une version quelconque** du document les référence | libérés quand plus aucune version conservée ne les référence |
| Taille | grossit avec le texte seulement (les fichiers n'y sont plus) | bornée |

**Garde-fous** (aucune perte d'information essentielle, y compris entre les sessions) :

1. **Jamais de compactage automatique** sans `history: { mode: 'compact' }` explicite.
2. **Archivage préalable** : `onBeforeCompact(fullSnapshot)` reçoit le snapshot **complet** juste avant ; l'intégrateur peut l'archiver.
3. **Rétention configurable** (`retain`), via un snapshot Loro *shallow* à une version passée.
4. **Refus** si un envoi de fichier est en cours ou si des modifications ne sont pas encore sauvegardées.
5. **Synchronisation** : un pair resté sur une version antérieure au compactage ne peut plus se resynchroniser par mises à jour incrémentales → c'est à l'intégrateur de choisir le moment (`nabu.compact()`).
6. Le ménage du stockage partagé ne supprime un fichier que si **aucun** document ne le référence (index `docRefs`) ; en mode hôte, Nabu ne supprime rien chez l'hôte : il émet `onAssetReleased(ref)` et l'intégrateur décide.

### 3.7 Migration des documents beta

À l'ouverture, si la map Loro `assets` contient des octets (format beta) :

1. chaque entrée est hachée et écrite dans le stockage ; `assetIndex` est complété ;
2. les blocs `nabu-asset:<uuid>` reçoivent leur nouvelle ref `nabu-asset:sha256-…` (un commit silencieux, hors undo) ;
3. les entrées de la map `assets` sont retirées.

Limite assumée : en mode `full`, les anciens octets restent dans l'**historique** du document (c'est la nature d'un historique complet) ; seul un compactage explicite les libère.

### 3.8 Ce qui ne change pas

- **Export et presse-papiers** emportent toujours les octets (`assets` dans le fragment / l'export JSON, désormais indexés par empreinte) : un document exporté reste autonome. À l'import, l'empreinte est vérifiée.
- Sécurité : toutes les URL restent filtrées par `sanitizeUrl`.
- `onBeforePersist(file, { signal, onProgress })` garde son contrat ; sa `ref` renvoyée devient l'`url` de l'index. Les documents qui contiennent déjà des refs d'hôte continuent de fonctionner.

## 4. Conséquences

- ✅ Historique léger même en mode complet ; plus de croissance infinie due aux fichiers.
- ✅ Déduplication, intégrité, reprise des envois, hors ligne.
- ✅ Base saine pour la future synchronisation (SurrealDB) : les fichiers voyagent par leur propre canal.
- ⚠️ En mode local sans hôte, les fichiers ne sont **pas** synchronisés entre appareils (ils sont dans l'IndexedDB du navigateur) — à traiter avec la synchronisation.
- ⚠️ Un document seul (snapshot Loro) n'est plus autonome : il faut l'export (JSON/presse-papiers) ou le stockage pour avoir les fichiers. C'est le prix du découplage.
- ⚠️ Changement incompatible pour qui lisait la map Loro `assets` directement (non documenté publiquement).

## 5. Hors périmètre

- Synchronisation des fichiers entre appareils en mode local.
- Interface (progression, réessayer, texte alternatif, survol de dépôt) — sessions de design.
- Politique d'éviction du cache local (taille max) — à décider si besoin.
