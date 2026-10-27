# ADR 016 — Regions : structurer un texte continu par des repères

**Statut** : accepté (2026-10-22, validé par le propriétaire) — **modèle de données remplacé par l'ADR 018** (2026-10-23 : les régions sont des conteneurs dans Loro, les coutures sont l'interface). Types, champs, numérotation, registre, commandes et protection restent valables.
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
- **Markdown** : commentaire de données + titre lisible (décidé, question 4 ; voir les notes du lot 3).
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

1. ~~**Backspace au début de la première ligne d'une région**~~ — **décidé (2026-10-22, propriétaire)** : **protéger**. Un Backspace au tout début du premier bloc de texte d'une région ne fusionne jamais le texte à travers le repère ; la fusion est un **maintien** de la touche (ADR 017 `hold`, 700 ms) sur la couture, commande `region:merge-previous` ; symétrique pour Suppr (`region:merge-next`, le repère SUIVANT disparaît). Première région sans préambule : rien (pas de cible, pas de maintien).
2. ~~**Raccourci « couper ici »**~~ — **décidé** : `Mod+Entrée` (`region:split`, sans confirmation), qui cohabite avec `todo:toggle` (celui-ci, limité aux éléments de liste, garde `Mod+Entrée` dans une liste de tâches).
3. ~~Repère collé dans un toggle~~ — **décidé** : remonté juste après le toggle (comme pour les listes ; la structure n'est jamais perdue).
4. ~~Markdown~~ — **décidé** : un commentaire HTML porteur des données (`<!-- region:chapter {"title":"La forêt"} -->`), relu exactement par Nabu (exception ciblée, comme `<details>`), **suivi d'un titre lisible** (`## Chapitre 2 — La forêt`) pour les humains et les autres outils.
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


---

## 8. Implementation notes — lot 2 (2026-10-22)

Code: `src/lib/blocks/region/` — `commands.js` (the commands), `facts.js` (`commandContext` facts + the merge veto), `actions.js` (the operations), `messages.js` (overridable texts), `Region.svelte` (hold rendering), `insert.js` (`createMarker`, the commit-less building block). One engine change, generic: the `onBeforeMerge` hook (below). Tests: `tests/unit/region-commands.test.js`, `tests/e2e/regions.spec.ts`.

- **Commands** (`region:*`, each also an action: `nabu.exec(id, data)`; `data.region` = a `Region`, its marker block or its marker id, acts on that region instead of the caret's). Default keys: `region:split` `Mod-Enter`, `region:merge-previous` `Backspace` + `Shift-Backspace` (hold), `region:merge-next` `Delete` (hold). No default keys for `insert`, `move` (+ `move-up` / `move-down`, the same with the direction built in, because a key cannot carry `data`), `promote`, `demote`, `next`, `prev`, `parent`: the arrow chords are mostly taken by the OS / browser; integrators bind them with `keymap`. `exec` runs a command directly: the hold is a keyboard concern (ADR 017 §3.4a), the accessible path has none.
- **Facts** (`commandContext`): `region` (deepest, `null` in the preamble), `previousRegion` (document order), `nextRegion` (first marker after the caret block; the first region from the preamble), `inRootTextBlock` (top-level text block without children: not a list item, toggle, callout…), `atStartOfRegion` (collapsed, offset 0, root text block, and NO text block between the marker and here: an image or divider in between does not count), `atEndOfRegion` (collapsed, end of text, and the block a Delete would merge into this one lies in ANOTHER region; this one is not limited to root blocks, so a Delete at the end of the last list item before a marker is protected too).
- **Protection = the `hold` command + a veto**. (1) `region:merge-previous` applies (`when`) only to a plain paragraph (`block.type === nabu.defaultBlockType`) at `atStartOfRegion` with something to merge into (a previous region or a non-empty preamble). A heading, quote, dialogue or code block at the start keeps its own Backspace (convert to a paragraph, as anywhere) and the NEXT Backspace is protected. Held-key repeats are swallowed by the confirmation controller while `when` holds (the word stops at the seam). (2) The engine's text merge (`TextBehavior#handleDeleteContentBackward` / `Forward`) now asks `onBeforeMerge(nabu, survivor, victim)` first; the extension answers `BREAK` when the two blocks are not in the same region (`Regions#at`). This closes every path that does not go through the command: first region of the document (nothing to merge into), a key not bound, a virtual keyboard (keyCode 229, no keydown), a third-party block type. The hook is generic (the engine names no reason; ADR 017 lot 1 principle). The empty block right after a marker is the same case as any block there: it asks for the hold; the veto keeps its Backspace from deleting it and jumping across.
- **Selections** spanning a marker are explicit and keep the engine's `deleteRange` semantics: the text of the range goes AND the marker inside it (a block strictly between the ends is destroyed), the junction merges the head and the tail, one commit = one undo step (pinned by unit and e2e).
- **`region:split`**: `when` = collapsed caret in a ROOT text block (`inRootTextBlock`), so a list item or a toggle title falls through (and `todo:toggle`, scoped to `list-item` and with its own `when`, keeps `Mod-Enter` in to-do items; pinned with real keys). Mid-text or at the end: `block.split({ offset, to: length })` (what Enter does, hooks included: a heading cut at its end gives a paragraph, mid-text both halves are headings), then the marker is created right before the tail, in the SAME synchronous turn, so the engine's structural burst merges the three commits into one undo step. At offset 0: no cut, the marker goes before the block. A block that does not split on Enter (a code block) is excluded from the `when` (Mod-Enter there keeps its own behaviour: the existing code-block e2e caught it). Type = the current region's, else the default (top-level) type. The caret goes to the start of the tail.
- **`region:insert`**: `{ type?, at?: 'after' | 'before', title?, fields? }`. `after` = after the region's WHOLE range (sub-regions included), `before` = before its marker; the preamble counts as a region (`before` = start of the document, `after` = end of the preamble). The caret stays (no paragraph is added: an empty region is allowed).
- **`region:move`**: moves the root blocks `[start, end)` of the region (sub-regions included) with Loro `moveBefore` / `moveAfter`, one commit. The sibling is the neighbour in the parent's `children` (the top level for a root region) and must be of the SAME level; at an edge or next to a sibling of another level nothing moves and nothing is committed. The caret is put back.
- **`region:promote` / `demote`**: `setRegionType` to the first declared type of level -1 / +1; no-op when there is none or the marker's type is not declared. Following regions re-nest by their levels (the model of §3.4: the type is all that has to change).
- **Navigation**: `next` / `prev` / `parent` put the caret at the first text position of the target region (its own content, else its first sub-region) and scroll it into view (`scrollIntoView({ block: 'center' })`); a region without text only scrolls its seam. `prev` has no target from the first region (the preamble is not a region).
- **Undo**: every structural command is one commit / one step; the selection captured before it (ADR 015) comes back on Ctrl+Z, including after a merge (marker restored, caret back at the start of the block) — e2e.
- **Hold rendering (default seam)**: `Region.svelte` reads `nabu.pendingCommandOn(block)`; when it is a hold it shows the pending message (`Hold Backspace to merge with “One”`; the controller's `hold` text built from the command label) in a `[data-region-hint]` span, `position: absolute; bottom: 100%` inside the seam's top margin (left-aligned, no bubble / background / border, `--nb-region-warning`, default `#B45309`), and a 1 px warning-tint overlay on the hairline whose `scaleX` is `1 - progress` (it drains). Nothing is in the flow, so the seam does not move (e2e compares the bounding box); it relies on `--nb-region-margin` leaving about one line above the seam (the default does). The engine's default target outline / fill is switched off on a seam. The hint is `aria-hidden` (the live region announces the same text). Nothing remains once the marker is gone. The "Merged with … · Ctrl+Z to undo" confirmation line (board 8b, state 3) is NOT done: it needs a transient element that belongs to no marker.
- **Texts**: `RegionsExtension({ messages })` (`messages.js`): labels of the commands and the hold prompt, English by default.
- **Left for lot 3**: serialization (JSON is done; markdown / HTML), clipboard and paste rules for markers, the open question 3 (marker pasted into a toggle). Not covered by the protection: the first item of a list or the first child of a container at the start of a region keeps its own Backspace (outdent / convert), as it does not merge text through the marker.

---

## 9. Implementation notes — lot 3 (2026-10-22)

Code: `src/lib/blocks/region/format.js` (pure text forms: comment, echo, HTML), `region.svelte.js` (serializers, `toMarkdown` / `toHtml`, `markdownRules` / `fromMarkdown`, `htmlRules` / `fromHTML`). The core is untouched (the guard test stays green): the engine already dispatches `BlockClass.toMarkdown` / `toHtml` / `markdownRules` / `htmlRules`. Tests: `tests/unit/regions-io.test.js`, `tests/unit/roundtrip-structure.test.js` (the kitchen sink holds markers), `tests/e2e/regions-clipboard.spec.ts`. Reference of the forms: `docs/design/import-export.md` ("The region marker exception"), `docs/design/clipboard-format.md`.

- **Markdown**: `<!-- region:<type> <json> -->` then an ATX heading of level `clamp(level, 1, 6)` holding the computed label. The comment is the source of truth; the JSON is the `fields`, minimal, keys sorted, `<` `>` `&` and U+2028/9 as `\uXXXX` (so `-->` can never appear inside). The type id is written as is when it matches `[A-Za-z0-9_-]+`, percent-encoded otherwise (decoded on import).
- **Richtext fields** are inline-markdown strings inside the JSON (`deltaToMarkdown` / the inline parser), in the comment AND in the HTML attribute; the clipboard fragment and JSON keep the Loro delta. Lossy like a paragraph (whitespace at the edge of a mark). Links are sanitized with `sanitizeUrl` whenever a richtext delta is stored (`writeField`), so no path (paste, import, `setField`) can store a `javascript:` link.
- **Import is strict and local**: a rule (priority 20, may interrupt a paragraph) detects the exact line and valid-object JSON; the heading line IMMEDIATELY after is consumed. Everything else keeps its previous meaning (heading, other comment, invalid JSON = literal text).
- **Edited heading policy**: the comment wins, the heading text and level are ignored on import (the next export rewrites it); no warning (the heading is not data). **Unknown type**: falls back to the default (lowest-level) declared type, fields kept (JSON import and the internal clipboard keep an unknown type, which the registry tolerates). Invalid declared-field values: dropped by `create` with `nabu.warn`.
- **Label in static serializers**: the clipboard `toMarkdown(pb)` / `toHtml(pb)` get PasteBlocks, not the document, so the live block writes `echo: { label, level }` (from the registry) next to `props` in the `application/x-nabu+json` serialization. It is ignored on paste. Without it (a hand-made block) the echo is derived from the type (`level` of the declaration, the label template without numbering, else the type id).
- **HTML**: `<hN data-nabu-region data-nabu-fields>`; a high-priority rule (100) with `[data-nabu-region]` (non-empty) beats `h1`-`h6`; hostile or invalid attributes degrade to a marker without fields, never to markup. Type ids and fields are text; nothing from the element is passed through.
- **Root-only paste**: pinned in unit and e2e. Pasting `[p x, marker, p y]` in a toggle body at "body|one" gives: the text before the marker lands in the body, the text after the marker too, and ONLY the marker is hoisted right after the toggle (the content order across the marker is therefore not kept inside a container: the marker cannot be there). In a list item the list normalizer cuts the list around the marker (the rest of the list follows it); in a nested list the marker goes after the top-level list structure; in a callout it is hoisted after the callout.
- **Copying only a marker** (selection reduced to a marker) gives its two markdown lines as `text/plain` and the heading element as `text/html` (it is not a text block, so the "raw selected text" rule does not apply).
- **Left out**: no warning on an edited echo; richtext of UNDECLARED fields (an unknown field holding a text container) is exported as a delta array and comes back as a plain JSON array.
