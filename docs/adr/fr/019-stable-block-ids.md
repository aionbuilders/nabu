# ADR 019 — Une identité stable pour chaque bloc, en option

**Statut** : accepté (2026-11-21, validé par le propriétaire ; les huit questions du §8 tranchées selon la recommandation). Pas encore implémenté.
**Demandé par** : Orduin (l'application d'écriture construite sur Nabu), étude `~/@orduin/desktop/docs/format-versioning-research.md` §2 et §4.
**Liés** : ADR 000 (le CRDT comme source de vérité), ADR 015 (l'annulation restaure la sélection), ADR 018 (régions comme conteneurs), `src/lib/blocks/block.svelte.js`, `src/lib/blocks/undo-selection.js`.

---

## 1. Problème

L'id d'un bloc est son `TreeID` Loro (`block.svelte.js` : `this.id = node.id.toString()`). Il survit aux déplacements (Nabu déplace les nœuds, il ne les supprime jamais pour les recréer) et aux sauvegardes. Il ne survit **pas** à un « supprimer puis annuler » : Loro recrée le nœud sous un nouveau `TreeID` (ADR 015, « bloc recréé par l'annulation sous un NOUVEL id » ; mesuré par Orduin sur loro-crdt 1.17.1 : `0@1` revient en `32@5`).

Tout ce qui pointe vers un bloc depuis l'extérieur du document casse alors : un commentaire ancré à un paragraphe, un lien vers un passage, un index de recherche, un assistant IA qui cite un paragraphe. Chez Orduin : le curseur sauvegardé `{ block, offset }`, le plan que son serveur MCP expose (des ids promis comme « stables »), l'état de repli du plan, et plus tard les liens depuis les fiches de personnages.

C'est un besoin général des éditeurs de blocs (Notion a des ids stables, Tiptap a une extension `UniqueID`). Les règles qui comptent (ce nouveau nœud est-il un collage, une annulation, une coupure ?) sont des règles d'éditeur que seul le moteur voit se produire : elles relèvent donc de Nabu plutôt que d'être recodées par chaque application.

## 2. Ce que l'on sait (mesuré par Orduin, loro-crdt 1.17.1)

- Un nœud supprimé puis annulé (y compris depuis une autre session) revient avec un nouveau `TreeID`, **et avec son `node.data`**, clé `uid` supplémentaire comprise. Une valeur stockée dans `node.data` survit gratuitement à l'annulation et au rétablissement.
- `static create(nabu, type, props)` de chaque classe de bloc n'écrit que les clés qu'elle connaît (`exportProps` pour les régions et les médias). Une clé `uid` à côté n'est donc jamais copiée par copier / coller, duplication ou `importJSON`, qui passent tous par `create`. Les clés inconnues des `fields` d'une région, elles, SONT copiées : l'uid ne doit pas vivre dans `fields`.
- Une clé écrite des deux côtés d'une fusion est last-writer-wins, et deux `setContainer` concurrents perdent un côté. D'où la règle de déterminisme du §4.

Ce que fait le code aujourd'hui (lu pour cet ADR) :

- **Changement de type** (`Block#retype`, raccourcis markdown, `block:transform`, sortie de liste en reculant, sortie de sous-fil) : sur place, même nœud. Un uid survivrait.
- **Coupure** (Entrée, `onSplit` du paragraphe, du titre, du dialogue, de l'élément de liste) : le nœud d'origine garde le texte AVANT le curseur, un nouveau nœud est inséré après avec le reste. À l'offset 0, l'original garde un texte vide et le nouveau nœud prend tout.
- **Fusion** (Retour arrière en début, Suppr en fin) : le bloc précédent consomme le suivant, le suivant est détruit. Le survivant est le PREMIER bloc, même s'il était vide.
- **`importJSON`** passe par `importFragment` : il insère, il ne remplace jamais le document. C'est un collage.
- **Glisser** pour déplacer est un déplacement d'arbre (même nœud). Glisser avec Ctrl / Alt copie (par le chemin du collage).

## 3. Décision (proposée)

Une option d'éditeur, **désactivée par défaut** : un éditeur qui ne la demande pas ne paie rien et ses documents ne changent pas.

- `block.id` reste le `TreeID`. Rien ne change dans la mécanique de l'arbre, le pont de sélection ou l'ADR 015.
- Avec l'option active, chaque nœud de bloc porte **`node.data.uid`**, lu comme **`block.uid`**, et le moteur le résout : **`nabu.blockByUid(uid)`**.
- La valeur est **le `TreeID` du nœud au moment où il est estampillé**, derrière un court préfixe (§8 Q2) : `u:12@345`. Unique (Loro ne réutilise jamais un `TreeID`), gratuit, et **déterministe** : deux ordinateurs qui estampillent le même ancien bloc écrivent la même valeur, donc leurs copies convergent. Les UUID aléatoires sont rejetés pour cette raison (§6).
- Un uid est **opaque** : après une annulation, il n'est plus égal au `TreeID` du nœud, et rien ne doit s'appuyer sur cette égalité.

## 4. Les règles, cas par cas

La règle générale : **un uid suit ce qu'un lecteur appellerait « le même bloc »**. Dans un texte, c'est le bloc qui contient son **premier caractère**.

| Cas | Règle | Comment |
|---|---|---|
| Création (saisie, `insert`, une commande) | nouvel uid | écrit dans la transaction qui crée |
| Copier / coller, duplication, glisser avec Ctrl, `importJSON`, `importMarkdown`, couper puis coller | nouvel uid | `create` ne copie jamais `uid` ; un nœud collé est estampillé comme un nouveau |
| Annulation / rétablissement d'une suppression | garde son uid | gratuit : `node.data` revient avec le nœud |
| Déplacement (glisser, déplacement au clavier, déplacement de région, indenter / désindenter, normaliseurs qui déplacent) | inchangé | même nœud |
| Changement de type (paragraphe en titre, sortie de liste en reculant...) | inchangé | même nœud |
| Coupure en deux (Entrée) | la moitié qui a le premier caractère le garde ; l'autre moitié reçoit un nouvel uid | le cas courant est gratuit (le nœud d'origine garde la tête). Entrée à l'offset 0 d'un bloc non vide : le NOUVEAU nœud contient le texte, il prend donc l'uid et l'original, désormais vide, en reçoit un nouveau (§8 Q3) |
| Fusion (Retour arrière / Suppr entre blocs) | le bloc fusionné garde l'uid du bloc dont le texte vient en premier | souvent gratuit (le survivant est le premier bloc). Quand le survivant était VIDE, il prend l'uid du bloc consommé (§8 Q3) |
| Coupure de région, fusion de régions | la région qui reste garde son uid ; la nouvelle reçoit un nouvel uid | mêmes nœuds |
| Entrée au début du titre d'un conteneur (en-tête de toggle, titre de région) | le conteneur garde son uid ; le paragraphe qui reçoit le texte du titre en reçoit un nouveau | un conteneur, c'est son nœud (titre, corps, état), pas le texte de son titre (décidé à l'implémentation, 2026-11-21) |
| Uid en double (un ancien build l'a copié, une fusion de deux copies, deux pairs qui ont tous deux annulé la même suppression) | le nœud au plus petit `TreeID` garde l'uid, tous les autres prennent leur propre `TreeID` | déterministe : chaque pair écrit les mêmes valeurs, donc les copies convergent |

« Plus petit `TreeID` » : comparé par id de pair (comme entier non signé de 64 bits), puis par compteur. L'ordre est fixé par le format, identique sur toutes les machines.

Le cas du doublon est réel même quand chaque build suit les règles : le pair A et le pair B suppriment tous deux le paragraphe P hors ligne, annulent tous deux, puis se synchronisent. Chaque P recréé porte le même uid. D'où le correcteur du §5, qui tourne aussi sur les imports distants.

## 5. API

```js
const engine = createEditor({ stableIds: true });   // nom : §8 Q1

block.uid;                    // 'u:12@345', ou undefined quand l'option est désactivée
engine.blockByUid('u:12@345'); // le Block vivant, ou null
```

- **Estampiller les nouveaux blocs** : le moteur estampille chaque nœud créé dans une transaction locale (création, collage, coupure), dans cette même transaction, de sorte qu'annuler la création retire l'uid avec le nœud.
- **Le correcteur** : après `importRemote` / `import` de mises à jour, le moteur vérifie les uid des nœuds arrivés (les événements d'arbre de Loro les listent, le coût est donc proportionnel au changement, pas au document) et renomme les doublons selon la règle du §4. Origine silencieuse (`nabu:silent:uids`) : hors de l'historique d'annulation, comme les écritures de fichiers. Il tourne aussi à l'ouverture.
- **`stampBlockUids(doc)`**, exportée : estampille chaque nœud d'un document qui n'a pas d'uid, et corrige les doublons. Elle prend un **`LoroDoc` nu** (sans éditeur, sans Svelte), pour qu'une application puisse l'appeler dans sa propre migration et ses tests sur du Loro nu. Déterministe, commit avec l'origine silencieuse, et **idempotente** : un second appel n'écrit rien (`doc.version()` inchangé). Retourne le nombre de nœuds écrits.
- **`serialize('json')`** écrit `uid` sur chaque bloc quand l'option est active (un plan, un index de recherche ou un serveur MCP peuvent alors désigner des blocs). `importJSON` frappe toujours de nouveaux uid (c'est un collage, §8 Q4).
- **Types** : `uid` sur `Block`, l'option sur `NabuInit`, `blockByUid` sur `Nabu`, `stampBlockUids` exportée, le tout en JSDoc comme le reste.

Option désactivée : aucune clé écrite, aucun index tenu, `block.uid` vaut `undefined`, `blockByUid` retourne null. Un document qui A des uid reste valide dans un éditeur sans l'option : les clés sont conservées (jamais supprimées), simplement non maintenues, et `stampBlockUids` répare ce qui a été manqué quand l'option revient.

## 6. Rejeté

- **Faire survivre le `TreeID` à l'annulation.** Ce n'est pas à nous de le changer : c'est ainsi que Loro recrée un nœud supprimé.
- **Des UUID aléatoires.** Deux ordinateurs qui estampillent le même ancien bloc dans une migration écrivent des valeurs différentes ; les liens d'un côté pendent après la fusion (§4 d'Orduin).
- **L'uid dans `fields` (régions) ou dans une prop de bloc que `create` copie.** Le collage la copierait : deux blocs vivants avec une seule identité.
- **Une map conteneur séparée `uid -> TreeID`.** Une structure de plus à garder synchronisée avec l'arbre, last-writer-wins en cas d'éditions concurrentes, et à réécrire à chaque annulation. `node.data` revient gratuitement avec le nœud.
- **Le faire dans l'application.** L'application ne sait pas distinguer un collage, une annulation et une coupure : seul le moteur voit la transaction qui a créé un nœud.
- **Toujours actif.** Chaque document changerait, chaque éditeur paierait les écritures et l'index, pour un besoin que la plupart des éditeurs n'ont pas.
- **Les régions seulement** (première proposition de l'étude d'Orduin). Les commentaires, les liens vers un passage et les citations pointent vers des paragraphes ; la règle coûte pareil pour tous les blocs.

## 7. Tests prévus

Unitaires (vitest, vrai moteur), chacun avec l'option active, et le même avec elle désactivée montrant que rien n'est écrit :

1. Un bloc créé a un uid égal à son `TreeID` préfixé ; `blockByUid` le trouve.
2. Supprimer puis annuler : même uid, nouveau `TreeID` ; rétablir après annuler : même uid.
3. Copier / coller, duplication, glisser avec Ctrl, `importJSON`, `importMarkdown`, couper puis coller : nouveaux uid, jamais de doublon.
4. Déplacement (glisser, clavier, indenter / désindenter, déplacement de région), changement de type (chaque chemin de transformation, y compris les raccourcis markdown et les conversions de liste) : uid inchangé.
5. Coupure au milieu : la première moitié le garde. Entrée à l'offset 0 : le texte le garde. Fusion : le survivant le garde ; un survivant vide prend l'uid du bloc consommé.
   Les deux transferts écrivent aussi sur le nœud d'origine : Entrée à l'offset 0 puis Ctrl+Z, et Retour arrière dans un bloc vide puis Ctrl+Z, rendent à chaque bloc exactement son uid d'avant, sans doublon ; Ctrl+Shift+Z restaure ensuite l'état d'après (ajouté à la revue d'Orduin, 2026-11-21 : son curseur est sauvegardé par uid).
6. Coupure et fusion de régions, corps de toggle et de callout, éléments et conteneurs de liste : les règles tiennent pour chaque type de bloc.
7. Doublons : deux pairs suppriment et annulent le même paragraphe hors ligne, se synchronisent dans les deux sens : un uid chacun, documents identiques (`toJSON()` égaux) des deux côtés.
8. `stampBlockUids` sur un `LoroDoc` nu : estampille tout, le second appel n'écrit rien (`doc.version()` inchangé), deux forks estampillés séparément puis fusionnés dans les deux sens convergent, et un `UndoManager` neuf ne peut pas annuler l'estampille.
9. Silencieux : une estampille ou une correction n'ajoute aucune étape d'annulation ; une lettre tapée puis Ctrl+Z ne retire que la lettre.
10. `serialize('json')` porte `uid` avec l'option, pas sans ; les lecteurs de `@aionbuilders/nabu/format` l'ignorent.
11. Coût : le cas de performance à 10 000 blocs ne montre aucun changement mesurable avec l'option désactivée, et un changement borné avec elle active.

e2e (Chromium, WebKit) : Entrée au début, Retour arrière dans un bloc vide, supprimer puis Ctrl+Z, chacun vérifié via `blockByUid` ; les deux premiers aussi annulés puis rétablis (Ctrl+Z, Ctrl+Shift+Z), uid comparés avant, après l'annulation et après le rétablissement.

Test consommateur : `block.uid`, `blockByUid` et `stampBlockUids` sont typés dans le `.d.ts` publié.

## 8. Questions : toutes tranchées le 2026-11-21 (propriétaire) selon la recommandation en gras

1. **Nom de l'option et de l'API.** **`stableIds: true`, `block.uid`, `nabu.blockByUid(uid)`, `stampBlockUids(doc)`.** Alternatives : `uids: true`, `blockUids: true`. **Tranché le 2026-11-21 : comme recommandé.**
2. **Un préfixe sur la valeur ?** **Oui, `u:` (`u:12@345`).** Sans lui, un uid est égal à l'id du bloc jusqu'à la première annulation : un code qui passe l'un pour l'autre marche dans tous les tests et casse à l'usage. Avec lui, la confusion échoue tout de suite. **Tranché le 2026-11-21 : préfixe `u:`.**
3. **Entrée au début et Retour arrière dans un bloc vide : l'uid suit-il le texte ?** **Oui** (« le bloc qui contient le premier caractère »). Sans cette règle, Entrée au début d'un paragraphe cité laisse la citation sur la ligne vide au-dessus, et supprimer une ligne vide avant un paragraphe lui vole son identité. Coût : deux petits transferts dans les chemins de coupure et de fusion. **Tranché le 2026-11-21 : oui, l'uid suit le premier caractère.**
4. **Exporter puis importer un document entier en JSON : garder les uid ?** **Non, `importJSON` en frappe toujours de nouveaux** (il insère, c'est un collage, et importer deux fois le même fichier ne doit pas créer de doublons). Un mode `keepUids` pour restaurer une sauvegarde dans un éditeur vide va dans `docs/later.md` jusqu'à ce que quelqu'un en ait besoin ; Orduin sauvegarde du Loro, pas du JSON. **Tranché le 2026-11-21 : `importJSON` frappe toujours de nouveaux uid ; `keepUids` est dans `docs/later.md`.**
5. **Couper puis coller dans le même document : nouvel uid ?** **Oui, nouvel uid.** Couper est une suppression, coller est une création ; reconnaître un « déplacement par presse-papiers » serait fragile. Glisser pour déplacer garde l'uid et c'est la manière documentée de déplacer un bloc. **Tranché le 2026-11-21 : nouvel uid ; une détection du couper-coller comme déplacement attend qu'une application la demande.**
6. **Corriger automatiquement les doublons après les imports distants ?** **Oui, dans le moteur, quand l'option est active**, de façon incrémentale sur les nœuds arrivés. Sans cela, deux pairs qui annulent la même suppression laissent deux blocs avec un seul uid jusqu'à ce que l'application pense à appeler le correcteur. **Tranché le 2026-11-21 : automatique, à l'ouverture et après les imports distants, sur les nœuds arrivés seulement, hors de l'historique d'annulation.**
7. **Tous les types de bloc, conteneurs de liste compris ?** **Oui, tous les nœuds.** Les conteneurs de liste sont créés et fusionnés par le normaliseur de liste, leur uid est donc fragile par nature : la doc dira de pointer vers les éléments de liste, pas vers la liste. Aucun autre type ne pose problème d'après le code ; les tests du §7.6 le confirmeront. **Tranché le 2026-11-21 : tous les nœuds, conteneurs de liste compris, avec cette note dans la doc.**
8. **Version.** **0.1.9**, additive, désactivée par défaut. Pour Orduin c'est un changement de schéma (sa propre migration appelle `stampBlockUids`), qui a sa place dans son `docs/format.md`, pas dans celui de Nabu. **Tranché le 2026-11-21 : 0.1.9.**
