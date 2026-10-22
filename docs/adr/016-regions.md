# ADR 016 — Regions : structurer un texte continu par des repères

**Statut** : accepté (2026-10-22, validé par le propriétaire)
**Remplace** : le bloc Zone (retiré de Nabu le 2026-10-22, conteneur imbriqué)
**Liés** : `docs/design/variables.md` (à refondre sur Regions), canvas d'exploration « Zones — exploration » (planches 5–7 : Nabu seul), ADR 014 (historique), feuille de route de l'audit 2026-10

---

## 1. Contexte

Orduin (application d'écriture longue) a besoin de découper **un seul document continu** en parties, chapitres et scènes, avec des métadonnées par division, une navigation, des vues (plan, liège, frise) et, à terme, un rendu paresseux des très longs textes.

L'ancienne Zone modélisait chaque division comme une **boîte** (conteneur imbriqué). Les frontières y étaient des murs : couper un chapitre, fusionner deux scènes ou faire passer un paragraphe d'un chapitre à l'autre demandait de déplacer des blocs entre conteneurs, et l'arbre imbriqué se prête mal au rendu paresseux.

Décisions du propriétaire (2026-10-22) : **modèle à repères** ; les **primitives génériques** dans Nabu (open source), le **produit « Zone »** et toute son interface dans Orduin (privé) ; Zone retirée de Nabu sans migration (aucun utilisateur).

**Vocabulaire** : dans Nabu, la brique générique s'appelle **région** (`RegionsExtension`). « Zone » désigne le produit d'Orduin construit dessus.

## 2. Décision

Une région est une **portion d'un texte continu**, ouverte par un **repère** et fermée par le repère suivant de même niveau ou de niveau supérieur (ou la fin du document). Le document reste **plat** au niveau racine ; la structure est une couche posée dessus.

## 3. Conception

### 3.1 Le repère

- Un bloc `region` **sans texte** (bloc vide, comme le séparateur : le curseur le saute, il se rend en « couture »).
- Données Loro du repère : `regionType` (identifiant d'un type déclaré) et `fields` (map Loro des champs déclarés par ce type ; `title` est un champ de base de toute région).
- **Uniquement au niveau racine.** Un repère n'a pas de sens dans une liste ou un toggle ; le normaliseur le remonte à la racine (même mécanique que les autres règles de structure). *(cas des conteneurs : voir questions ouvertes)*
- Le contenu situé **avant le premier repère** est un préambule hors région.

### 3.2 Types de régions (déclarés par l'intégrateur)

```js
RegionsExtension({
  types: {
    part:    { level: 1, label: 'Partie {index}' },
    chapter: { level: 2, label: 'Chapitre {index}', numbering: 'document' },
    scene:   { level: 3, numbering: 'parent', fields: { pov: 'text', place: 'text' } },
  },
})
```

- `level` : profondeur (1 = la plus haute). L'étendue d'une région se déduit des niveaux.
- `label` : gabarit d'affichage (`{index}`, `{path}` → « 2.3 », `{title}`).
- `numbering` : `'parent'` (repart à 1 dans chaque région parente, défaut), `'document'` (continue sur tout le document), `'none'`.
- `fields` : champs typés (`text`, `richtext` = LoroText, `number`, `boolean`, `enum`, `date`) — Nabu les stocke et les rend réactifs ; leur sens (synopsis, statut, objectif…) appartient à l'intégrateur.
- Sans configuration : un type générique `section` (niveaux 1–3, libellés « 1. », « 1.1 »…).

### 3.3 Registre réactif `nabu.regions`

- `list` : les régions dans l'ordre du document, chacune avec `type`, `level`, `fields`, `index` / `path` / `label` calculés, `parent`, `children`, la plage de blocs (`first`, `last`), `wordCount` (somme des blocs de la plage, calculée sans rendu).
- `tree` : la hiérarchie (parties › chapitres › scènes).
- `at(position | block)` : la région la plus profonde contenant une position (fil d'Ariane, inspecteur).
- `of(marker)`, `next(region)`, `prev(region)`, `parentOf(region)`.
- Tout est `$derived` : les vues de l'intégrateur s'y abonnent sans code de synchronisation.

### 3.4 Gestes (actions) et clavier

| Action | Effet dans le modèle à repères |
|---|---|
| `region:split` — couper ici | coupe le bloc au curseur si besoin, insère un repère du même type que la région courante ; le curseur passe au début de la nouvelle région |
| `region:insert` | insère un repère (type donné) après la région courante ou au curseur |
| `region:merge` | supprime le repère : le contenu rejoint la région précédente |
| `region:move` (`up`/`down`) | déplace la région **avec ses sous-régions** (sa plage de blocs) avant / après sa voisine de même niveau |
| `region:promote` / `region:demote` | change le niveau (le type) — dans un modèle à repères, c'est tout ce qu'il faut pour réimbriquer |
| `region:next` / `region:prev` / `region:parent` | navigation : curseur au début de la région visée |

- Chaque action structurelle est **une étape d'undo** (mécanisme déjà en place) et Ctrl+Z restaure la sélection (ADR 015).
- Raccourcis par défaut configurables (voir questions ouvertes). **« Agir sur la région comme un objet »** (Échap du texte vers la région) dépend de la **primitive de sélection de bloc**, chantier à part.

### 3.5 Rendu par défaut (planche 5)

- Une couture discrète : libellé calculé (« 1.1 Le passeur ») + filet ; style neutre, variables CSS (`--nb-region-*`).
- Accessibilité : le repère est annoncé comme un **titre de niveau `level`** (`role="heading"`, `aria-level`), pour que les lecteurs d'écran naviguent par division.
- Aucune interface d'édition des champs dans Nabu : c'est le rôle de l'intégrateur (inspecteur d'Orduin). Nabu expose seulement `region.fields` et les actions.

### 3.6 Sérialisation, presse-papiers, collage

- **JSON** : `{ type: 'region', props: { regionType, fields } }` — aller-retour exact.
- **Presse-papiers interne** : les repères voyagent comme des blocs ; collés ailleurs, ils retrouvent leur rôle.
- **Markdown** : forme à décider (questions ouvertes) ; contrainte : aller-retour structurel exact pour les documents Nabu, lisible pour un humain.
- Collage d'un repère dans un conteneur (liste, toggle) : règle du §3.1.

### 3.7 Collaboration et historique

- Repères et champs vivent dans Loro : synchronisés et historisés comme le texte.
- Deux auteurs qui coupent au même endroit produisent deux repères voisins (une région vide, visible) — pas de conflit structurel.

## 4. Hors périmètre (chantiers suivants, chacun avec son ADR)

- **Sélection de bloc** (agir sur une région ou un bloc comme un objet).
- **Variables** (`{{index}}`, `{{title}}`, résolution par portée = `nabu.regions.at(block)`).
- **Rendu paresseux** par région.
- Toute l'interface produit (Orduin).

## 5. Découpage

1. **Lot 1** — bloc repère, types, normaliseur (racine), registre réactif, numérotation, rendu par défaut.
2. **Lot 2** — actions et clavier (§3.4).
3. **Lot 3** — sérialisation JSON / markdown / HTML, presse-papiers, collage.

## 6. Questions ouvertes (à trancher avant ou pendant le lot concerné)

1. **Backspace au début de la première ligne d'une région** : fusionner (supprimer le repère) ou protéger la structure (ne rien faire, fusion seulement par action explicite) ? Proposition : **protéger**, pour qu'un Backspace ne fusionne jamais deux chapitres par accident.
2. **Raccourci « couper ici »** : `Mod+Entrée` (attention : `Ctrl+Entrée` coche un todo dans une liste de tâches) ou un autre ?
3. **Repère collé dans un toggle** (conteneur qui ne peut pas être coupé comme une liste) : remonter le repère après le toggle, ou le convertir en simple titre ?
4. **Markdown** : un commentaire HTML porteur des données (`<!-- region:chapter {"title":"La forêt"} -->`), éventuellement suivi d'un titre lisible ? Rappel : le HTML embarqué reste du texte, sauf exceptions ciblées (comme `<details>` pour le toggle).
5. ~~**Préambule**~~ — **décidé** : autorisé tel quel (contenu avant le premier repère = hors région).

---

## 7. Implementation notes — lot 1 (2026-10-22)

Code: `src/lib/blocks/region/` (`types.js`, `region.svelte.js`, `Region.svelte`, `regions.svelte.js`, `normalize.js`, `insert.js`, `region.extension.js`). Tests: `tests/unit/regions.test.js`, `tests/e2e/regions.spec.ts`.

- **Default types**: with no options the extension declares THREE types, `section-1`, `section-2`, `section-3` (levels 1–3, labels `{path}. {title}`, `{path} {title}`, `{path} {title}` → "1.", "1.1 Le passeur"). The level IS the type, as §3.4 already says ("changer le niveau (le type)"): `region:promote` / `demote` will just swap `regionType`, no extra stored `level` field to keep in sync. Passing `types` REPLACES the defaults (no merge).
- **Factory**: `RegionsExtension(options)` throws on an invalid declaration (level not an integer ≥ 1, unknown numbering or field kind, an `enum` without `values`). The configuration is carried by a block subclass (`static config`, like the dialogue dash); `Regions.get(nabu)` reads it back from the registry. `createRegionsExtension` is an alias; there is no separate default instance because `RegionsExtension()` already is the default (and `FullPreset` includes it, consistently with "all built-in blocks").
- **Registry exposure**: `Regions.get(nabu)` (stored in `nabu.systems`, like `Todos`) plus a `nabu.regions` getter that the extension installs from its `onInit` hook: the core never names it. Not installed without the extension.
- **Levels and extent**: as §2. A marker whose type is NOT declared (a document coming from a richer editor) is a leaf at the deepest declared level, unnumbered, labelled by its title. Numbering: `parent` counts per (parent region, type), `document` per type over the whole document, `none` gives no index; `path` = the indexes of the numbered ancestors then its own (`"2.1"`; array in `path`, text in `pathString`).
- **Range**: `first` is the marker, `last` the last ROOT block of the range; `blocks` = everything after the marker up to `last`, sub-regions' markers and content included; `ownBlocks` stops at the first sub-region. `wordCount` / `ownWordCount` follow the same split (markers weigh 0). `next` / `prev` walk document order (a sub-region comes right after its parent).
- **Fields**: `title` plus the declared fields, read through `marker.fields` (reactive): a declared field that is unset or holds a value of the wrong type reads `null` (the stored value is untouched); `richtext` reads as its plain string, the LoroText is `marker.richtext(name)`; unknown fields are returned and exported as-is. `setField` refuses an invalid value for a declared field (returns false, `nabu.warn`); `null` clears. Dates: ISO 8601 `YYYY-MM-DD`, with an optional time; a `Date` is stored as its ISO string.
- **Root-only normalizer** (`normalize.js`, `onBeforeTransaction`, so the move belongs to the transaction — one undo step — of the operation that displaced the marker): a marker with a parent is moved RIGHT AFTER the top-level container holding it; several markers of one container keep their order. A node retyped into a marker while nested is caught too. It runs after the list normalizer (extension order), so a marker in a list item position is first split out of the list by the list rules; what is left (toggle body, callout…) is hoisted by this one. The target is isolated in `hoistTarget()` so that the open question 3 (toggle) can change it in one line (e.g. "convert to a title" would be another branch of the same function).
- **Void block**: modelled on the divider (`positions = 1`, `getDOMPoint` null, `data-nabu-inert`, `contenteditable="false"`); the caret skipping and `openTrailingCaret` are the engine's generic ones. Backspace / Delete next to a marker have NO hook yet: the text merge goes THROUGH the marker (`p(above) ; R ; p(below)` + Backspace → `p(abovebelow) ; R`, one undo step, document valid) — pinned by e2e, to be replaced by the decision of open question 1 in lot 2.
- **Serialisation (minimal)**: JSON `{ type: 'region', props: { regionType, fields } }` (richtext fields as Loro deltas), same shape on the internal clipboard format; markdown / HTML are empty for now. `TODO(ADR-016 lot 3)` marks the spots.
- **What lot 2 needs from here**: `insertRegion` and `RegionBlock#setRegionType` (promote / demote), `Region#start` / `end` / `ownEnd` (root indexes, for `region:move` and `region:merge`), `Regions#at()` (current region for `split` / `insert`), `config.defaultType`, the hoisting normalizer already guarding the root-only rule, and the Backspace / Delete decision.
