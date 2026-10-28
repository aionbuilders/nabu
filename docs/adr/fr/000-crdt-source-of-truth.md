# ADR 000 : Un CRDT (Loro) comme source de vérité

**Statut** : accepté, **rétroactif**. La décision précède le premier commit (2026-02-18, « Init + Base Relation Blocks + Loro System ») et n'avait jamais été consignée ; ce record est écrit le 2026-10-28. Les raisons d'origine viennent de `docs/archive/PROJECT_CONTEXT.md` (mars 2026) et du README pré-bêta ; la comparaison avec Yjs (§3.3) est reconstituée à partir de ce que le code utilise aujourd'hui et doit être confirmée par le propriétaire.
**Liés** : ADR 002, 003, 004 (le modèle), 010 (persistance, multi-onglets), 014 (fichiers hors du document, compactage), 015 (l'annulation rend la sélection), 018 (régions conteneurs) ; chapitre 02 « The model is the truth » ; `docs/architecture/sources/comparison-2026-10-27.md`.

---

## 1. Contexte

### Pourquoi « 000 »

Les ADR 001 à 005 (2026-02-19) supposent tous que le document est un document Loro : l'ADR 003 est l'arbre Loro, l'ADR 004 compare `LoroText` à des blocs imbriqués, l'ADR 010 sauve un snapshot Loro. La décision qui les précède n'a jamais été écrite. Notre règle dit qu'un record s'écrit quand la décision est prise et ne se réécrit jamais : on ne réécrit donc rien, on comble le trou, en disant qu'il est comblé après coup. Le numéro 000 dit sa place dans la logique (avant 001), la date dit quand il a été écrit.

### Le besoin d'origine

`PROJECT_CONTEXT.md` (mars 2026) pose :

- un moteur d'édition **local-first**, qui fonctionne sans backend ;
- le dogme **« Loro-First »** : la vérité est dans Loro, Svelte et le DOM n'en sont que des reflets réactifs ;
- une persistance en deux temps : IndexedDB en local, puis SurrealDB en distant ;
- à terme, un CMS modulaire interconnecté (« Metablocks »).

### Les trois questions

1. Comment des copies d'un même document, modifiées séparément, se réconcilient-elles : **transformation opérationnelle (OT) ou CRDT** ?
2. Où vit la vérité : dans un **modèle d'éditeur propre**, synchronisé avec un CRDT par une liaison, ou **dans le CRDT lui-même** ?
3. **Quel CRDT** : Loro, Yjs, Automerge ?

## 2. Décision

- Le document est un `LoroDoc` : un `LoroTree` nommé `blocks` (un nœud par bloc, type et props dans ses données), le texte dans des `LoroText` avec des marks (ADR 004).
- Ce document est la **seule source de vérité**. Il n'existe pas de second modèle d'éditeur synchronisé avec lui. Les blocs Svelte (ADR 002) l'enveloppent, le DOM le reflète, et toute écriture (frappe, collage, annulation, onglet distant, appel de l'hôte) est une opération Loro.
- Aucun serveur n'est requis pour fusionner deux copies. Le transport réseau reste à l'intégrateur (`nabu.doc` en sortie, `nabu.importRemote(bytes)` en entrée).

## 3. Raisons

### 3.1 CRDT plutôt qu'OT

En pratique, l'OT a besoin d'une **autorité centrale** qui ordonne les opérations et oblige les clients refusés à rebaser puis renvoyer leurs changements : c'est le modèle de `prosemirror-collab`. Des variantes d'OT sans serveur existent, mais elles sont réputées difficiles à rendre correctes. Or Nabu doit fusionner **sans serveur**, dans des cas qu'il assure déjà :

- deux onglets ouverts sur le même document (ADR 010 : fusion dans une transaction IndexedDB, synchro en direct par `BroadcastChannel`) ;
- un document rechargé avec un tail `localStorage` ou restauré depuis un secours ;
- un pair quelconque, par n'importe quel transport, via `importRemote(bytes)`.

Un CRDT donne cela par construction : chaque copie peut recevoir les changements de n'importe quelle autre, dans n'importe quel ordre, et toutes convergent. `doc.import` est idempotent. Il n'y a ni ordre global à maintenir ni serveur à faire tourner pour qu'un éditeur hors ligne reste juste.

### 3.2 Le CRDT comme vérité, pas comme couche de synchro

ProseMirror, Tiptap, Lexical, BlockNote et les autres ont leur propre modèle de document et ajoutent la collaboration par une **liaison** (Yjs, ou Loro via `loro-prosemirror`) qui traduit dans les deux sens. Nabu n'a pas de traduction : l'arbre et le texte **sont** le CRDT. Ce que cela achète :

- l'annulation est l'`UndoManager` de Loro, avec des curseurs stables qui restent justes face à une modification distante (ADR 015) ;
- la persistance sauve le CRDT lui-même, historique compris, pas un JSON dérivé (ADR 010) ;
- la synchro entre onglets, un document chargé du disque, l'annulation et un script de l'hôte prennent le même chemin : opération Loro, événement, rune, DOM. Aucun cas particulier « le DOM a changé », puisque le DOM n'est jamais écrit en premier.

### 3.3 Loro plutôt que Yjs ou Automerge

Le dépôt ne garde aucune trace d'une comparaison faite à l'époque : Loro est présent dès le premier commit. Les arguments ci-dessous sont ceux sur lesquels le code s'appuie aujourd'hui ; **à confirmer ou corriger par le propriétaire.**

- **Un arbre déplaçable natif.** `LoroTree` implémente l'opération de déplacement de Kleppmann et al. (« A highly-available move operation for replicated trees ») : déplacements concurrents ordonnés, cycles refusés, enfants ordonnés par index fractionnaire. Nabu en dépend partout : glisser un bloc, Tab / Shift+Tab dans une liste, déplacer une région entière, et des normaliseurs qui travaillent « par moves, jamais delete+recreate » pour que les ids et le curseur survivent. Yjs n'a pas de déplacement d'arbre natif : on l'y émule par une suppression suivie d'une réinsertion, ce qui duplique ou perd un nœud déplacé en concurrence.
- **Du texte riche avec marks** (`LoroText.mark`, deltas), sur lequel repose l'ADR 004.
- **Un historique exploitable** : snapshot binaire avec l'historique (ADR 010), vecteurs de versions pour décider s'il faut fusionner (multi-onglets), shallow snapshots pour le compactage (ADR 014, lot 3), curseurs stables pour l'annulation (ADR 015).

## 4. Conséquences

### Positives

- **Local-first réel** : hors ligne, plusieurs onglets, reprise après un plantage, sans backend.
- **La collaboration réseau ne demande pas de changer le modèle** : il manque un transport, pas une architecture.
- **Une seule vérité** : ce qui est sauvé, exporté en JSON, synchronisé et annulé est le même objet.

### Négatives

- **Le poids.** Loro est livré en WebAssembly : environ 1,2 Mo gzip (3,6 Mo brut), contre 28 Ko gzip pour Yjs. Une configuration Vite qui charge le WASM est obligatoire (`nabu()`, `build.target: 'esnext'`).
- **L'opacité.** Le snapshot binaire n'est pas lisible sans Loro et n'a pas de version de schéma (ADR 010).
- **Une double représentation.** Chaque bloc existe deux fois, nœud Loro et objet Svelte, et les deux doivent concorder. C'est l'origine de P-104 (import de 5 000 blocs en 163 s) et du coût de `tree.roots()` après la montée de Loro 1.10.6 à 1.17.1 (chapitre 02, audit 2026-10).
- **Un historique qui grossit.** Tout est gardé par défaut ; d'où les fichiers hors du document (ADR 014) et le compactage, sur option.
- **Converger n'est pas être valide.** Un CRDT garantit que les copies convergent, pas que le résultat respecte le schéma de Nabu. Exemple : `L1[x], P, Q, L2[y]`, deux listes à puces séparées par deux paragraphes ; un pair supprime `P`, l'autre supprime `Q`. Chaque côté reste valide ; la fusion donne deux listes adjacentes du même type (règle R4 de `list/normalize.js` violée ; pour des listes numérotées, la numérotation repart à 1 au milieu). Aujourd'hui, `importRemote` appelle `doc.import` sans déclencher les normaliseurs (`onBeforeTransaction` ne tourne qu'au commit local), et le normaliseur des listes est borné (P-106) à ce que la transaction locale a touché, en supposant le document valide avant elle. Un état invalide arrivé par une fusion peut donc rester en place.
- **Deux créations indépendantes** d'un même document neuf donnent deux paragraphes initiaux (ADR 010, limites connues).

## 5. Questions ouvertes

1. **Normaliser après un import distant.** Sur tout le document, ou sur les nœuds que l'import a touchés (d'après l'événement Loro) ? Si chaque pair normalise, deux pairs peuvent émettre la même correction en même temps : des moves vers la même place convergent, mais une suppression de conteneur (R1 : liste vide supprimée ; R4 : la seconde liste fusionnée puis supprimée) pendant qu'un autre pair insère dans ce conteneur peut faire disparaître l'insertion. À vérifier par un test à deux documents avant de décider.
2. **Le transport réseau** (serveur, pair à pair, SurrealDB prévu à l'origine) : hors du champ de cet ADR.
