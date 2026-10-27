# ADR 017 — Commandes, raccourcis et confirmations

**Statut** : accepté (2026-10-22, validé par le propriétaire)
**Design de référence pour `hold`** : canvas « Zones — exploration », planche **8b** (indication au-dessus du libellé, à gauche, sans bulle, teinte ambre `#B45309`, filet qui se vide dans la même teinte, aucun décalage du texte).
**Liés** : ADR 011 (bus d'actions `nabu.exec`), ADR 016 (Regions — premier client : « couper ici », fusion protégée), canvas « Zones — exploration » (planche 8 : fusion en maintenant ⌫)

---

## 1. Contexte

Aujourd'hui, les raccourcis clavier sont gérés **au cas par cas** : chaque extension intercepte `keydown` dans son hook `onKeyDown` (marques, listes, code, todos, slash menu…) et **le premier qui répond gagne**. Conséquences :

- personne ne sait que deux extensions veulent la même touche : les conflits sont silencieux ;
- impossible de personnaliser un raccourci, ni d'afficher une aide clavier fiable ;
- aucune manière commune de **confirmer** une action à risque (ex. fusionner deux régions) ou de **choisir** entre deux actions possibles.

Le bus d'actions (`nabu.exec(topic, data)`, ADR 011) existe déjà : il exécute, mais ne sait rien des touches, du contexte ni de la confirmation.

## 2. Décision

1. Un **registre central des commandes** : une extension *déclare* ses commandes (action, libellé, raccourcis, contexte d'application, stratégie de confirmation) ; le cœur résout les touches.
2. Trois **stratégies de confirmation**, choisies par chaque commande : **maintenir sur la cible**, **invite au curseur**, **choisir**.
3. Les anciens hooks `onKeyDown` restent supportés pendant la migration (repli).

## 3. Conception

### 3.1 Déclarer une commande

```js
extension('regions', {
  commands: {
    'region:split': {
      label: 'Couper ici',
      keys: ['Mod-Enter'],
      when: (ctx) => ctx.block?.behaviors.has('text') && ctx.inRoot,
      run: (nabu, ctx) => splitRegionAtCaret(nabu, ctx),
    },
    'region:merge-previous': {
      label: (ctx) => `Fusionner avec « ${ctx.previousRegion.title} »`,
      keys: ['Backspace'],
      when: (ctx) => ctx.isCollapsed && ctx.atStartOfRegion,
      confirm: { strategy: 'hold', target: (ctx) => ctx.region.marker, holdMs: 700 },
      run: (nabu, ctx) => mergeWithPrevious(nabu, ctx),
    },
  },
});
```

- Une commande **est** une action du bus : `nabu.exec('region:split')` fonctionne toujours, sans clavier (palette, menu, API).
- `keys` : accords normalisés (`Mod` = Cmd sur macOS, Ctrl ailleurs ; `Ctrl` explicite, `Alt`, `Shift`, noms de touches `KeyboardEvent.key`). Les accords réservés au navigateur ou au système (Cmd/Ctrl+W, T, N, Q…) sont refusés avec un avertissement.
- `when(ctx)` : le contexte où la commande s'applique. `ctx` est construit par le cœur à chaque `keydown` : `nabu`, `block`, `selection`, `isCollapsed`, la chaîne des ancêtres (types), plus des **faits enrichis par les extensions** (ex. `atStartOfRegion`, `region`, `previousRegion` fournis par Regions) — le cœur ne connaît aucun type de bloc.
- `label` : texte (ou fonction du contexte) pour l'aide, l'invite et le sélecteur.

### 3.2 Résolution des touches

À chaque `keydown` (phase de capture, **ignoré pendant une composition IME**) :

1. normaliser l'accord ;
2. réunir les commandes dont un raccourci correspond et dont `when(ctx)` est vrai ;
3. **une seule** → elle s'exécute (avec sa stratégie de confirmation éventuelle), `preventDefault` ;
4. **plusieurs** → priorité : une commande liée au type du bloc courant (`scope`) passe avant une commande générique ; à priorité égale → stratégie **choisir** (§3.4) ;
5. **aucune** → repli sur les hooks `onKeyDown` historiques, puis comportement natif.

### 3.3 Détection des conflits, personnalisation, aide

- **À l'enregistrement** : deux commandes avec le même accord **et** le même `scope` déclaré → avertissement développeur (`nabu.warn`) ; les recouvrements de `when` ne sont détectables qu'à l'exécution (§3.2 point 4).
- **Personnalisation** : `createEditor({ keymap: { 'region:split': ['Mod-Shift-Enter'], 'mark:bold': [] } })` remplace ou désactive des raccourcis.
- **Aide** : `nabu.commands.list()` renvoie les commandes, leurs libellés et leurs raccourcis **formatés pour la plateforme** (⌘ ⌥ ⇧ sur macOS) — la fiche clavier (planche 4) se génère d'elle-même.

### 3.4 Les trois stratégies de confirmation

L'état en cours est exposé, réactif : `nabu.pendingCommand = { id, strategy, label, target?, progress?, options? } | null`. Le cœur gère le clavier ; **l'apparence appartient à l'intégrateur** (rendu par défaut neutre fourni ; design dédié plus tard).

**a) `hold` — maintenir sur la cible** (planche 8)

- Un **appui frais** (`event.repeat === false`) commencé dans le contexte de la commande démarre le compte (`holdMs`, défaut 700 ms) ; `progress` va de 0 à 1 ; la **cible** (ex. la couture de la région) affiche la progression.
- **Relâcher avant la fin annule.** Toute autre touche annule (et fait son action normale).
- **Un maintien commencé ailleurs ne compte jamais** : les répétitions (`repeat === true`) d'une touche maintenue avant d'atteindre le contexte sont **arrêtées** au contexte — il faut relâcher et appuyer de nouveau. *(Protège celui qui efface une phrase en gardant ⌫ enfoncé.)*
- Annonce aux lecteurs d'écran via une région `aria-live` (ex. « Maintenez Retour arrière pour fusionner avec La lisière »).
- La commande reste toujours exécutable **sans maintien** (menu, palette, `nabu.exec`) : accessibilité.

**b) `invite` — invite au curseur**

- Premier appui : `pendingCommand` (stratégie `invite`) — une invite apparaît au curseur (« ⌫ pour confirmer · Échap pour annuler »).
- Même accord à nouveau (appui frais) → exécute ; Échap, toute autre touche, un clic ou un délai (défaut 5 s) → annule.

**c) `choose` — choisir entre plusieurs actions**

- Utilisée automatiquement en cas d'ambiguïté réelle (§3.2), ou explicitement par une commande qui propose des variantes.
- Les options (`label`, raccourci) s'affichent au curseur : flèches + Entrée, chiffres, clic ; Échap annule.
- Règle de conception : le sélecteur est un **filet de sécurité**, pas un mode normal — les raccourcis par défaut doivent être conçus pour ne pas se marcher dessus.

### 3.5 Ce qui ne change pas

- Le slash menu garde son clavier modal (il capture les flèches tant qu'il est ouvert).
- Les gestes de saisie (`beforeinput`) ne passent pas par ce registre : il ne concerne que les **commandes**.
- Undo : chaque commande structurelle reste une étape (mécanismes existants) ; une confirmation annulée ne crée aucune étape.

## 4. Découpage

1. **Lot 1** — registre (`commands` dans `Extension`), normalisation des accords par plateforme, contexte enrichi par les extensions, résolution + priorités, personnalisation (`keymap`), `nabu.commands.list()`, avertissements de conflit. Migration de quelques raccourcis existants pour éprouver le modèle (undo/redo, marques, todo).
2. **Lot 2** — stratégies `hold`, `invite`, `choose` + `nabu.pendingCommand` + rendus par défaut neutres (filet de progression, invite, sélecteur) + annonces `aria-live`.
3. **Lot 3** — migration des autres hooks clavier (listes, code, toggle…) ; les hooks `onKeyDown` restent supportés pour les extensions tierces.

Ensuite seulement : **Regions lot 2** (couper ici = `Mod-Enter`, fusion protégée en maintenant ⌫ sur la couture, déplacer, monter/descendre, naviguer), branché directement sur le registre.

## 5. Questions ouvertes

1. ~~Durée du maintien~~ — **décidé** : 700 ms par défaut, réglable.
2. ~~Palette de commandes~~ — **décidé** : cœur seulement (`nabu.commands.list()` + exécution) ; la palette visuelle sera dessinée en session de design.
3. ~~Raccourcis mono-touche~~ — **décidé** : imposé — une commande liée à une touche sans modificateur (Backspace, Entrée, Tab, lettre…) sans `when` est **refusée** à l'enregistrement.

---

## 6. Implementation notes — lot 1 (2026-10-22)

Code: `src/lib/utils/keys.js` (chords), `src/lib/utils/commands.js` (`CommandRegistry`), `Extension#commands` / `Extension#commandContext` (`utils/extensions.js`), wiring in `Nabu` (constructor, `#registerCommands`, `handleKeydown`, `NabuInit.keymap` / `platform`). Tests: `tests/unit/keys.test.js`, `tests/unit/commands.test.js`, `tests/e2e/commands.spec.ts`.

- **Where keys are resolved**: `Nabu#handleKeydown`, the keydown handler of the editor root, as its FIRST step (after `selection.sync()` / `normalize()`), before `dispatchEventToSelection('keydown', e, 'onKeyDown')`. Not the document-capture listener of `NabuSelection`: that one runs for every editor of the page and without knowing which one owns the key; the root handler is per editor, and it leaves their precedence to the slash menu (document capture, modal) and to anything inside a block that stops the event. Resolution still precedes every legacy hook and every block `keydown`. It ignores IME composition (`isComposing`, `keyCode 229`, `nabu.composing`) and an event already `defaultPrevented`.
- **Cheap path**: the chord of the event is looked up in a map first; if no command is bound to it, no context is built (typing costs one chord computation).
- **Context** (`CommandContext`): `nabu`, `event` (`null` from `exec`), `block` (anchor block), `selection`, `isCollapsed`, `ancestors` (types, nearest first), `inRoot` (the block is a direct child of the document), then FACTS from `Extension#commandContext(nabu, ctx)` (merged in extension order; they cannot replace the fields above; a provider that throws is ignored with a warning). The engine names no fact.
- **Resolution**: candidates = bound commands whose `when` is true (no `when` = true; throwing = false). Ranking: `scope === ctx.block.type` first, then registration order (engine commands, then extensions in order). A real tie warns once (`TODO(ADR-017 lot 2)`: `choose`) and runs the first. A synchronous `false` from `run` = "not handled": the next candidate is tried, then the legacy hooks and the native behavior; a promise or any other value = handled (`preventDefault`). A `run` that throws is logged (`console.error`) and the key is consumed.
- **`Mod`**: Cmd (Meta) on macOS, Ctrl elsewhere; `platform` is detected (`navigator.userAgentData.platform` / `platform` / `userAgent`) and overridable through the `platform` init option (tests, SSR). Consequence for migrated shortcuts: on macOS, Ctrl+B / Ctrl+Z no longer trigger bold / undo (they used to: `ctrlKey || metaKey`), and Win+Z on Windows / Linux no longer undoes; the platform's own modifier is the only one.
- **Chord normalization** (keys.js, one rule for strings and events): canonical form `Ctrl-Alt-Shift-Meta-<key>`; letters lower-cased (Caps Lock irrelevant), Shift kept as a modifier on letters and on named keys; digits / symbols matched by the character produced, Shift NOT part of the chord (`Mod-Shift-1` is invalid, write `Mod-!`); for a non-ASCII `event.key`, `Dead` or `Unidentified`, `event.code` (`KeyB`, `Digit1`) gives the Latin letter / digit; AltGraph keystrokes and pure modifier presses have no chord. Display: `⌃⌥⇧⌘` + key on macOS (`⌘↩`, `⇧⌘Z`), `Ctrl+Alt+Shift+Meta+Key` elsewhere.
- **Refused at registration** (the command stays runnable through `exec`; each refusal is a `nabu.warn`, i.e. visible with `nabu.debugging`): invalid chord; reserved chord (`RESERVED_CHORDS` in keys.js: tab / window / quit `Mod-w/t/n/q` and shifted variants, `Mod-Tab`, `Ctrl-Tab`, `Alt-Tab`, `Alt-F4`, `Mod-PageUp/Down`, `Mod-1…9`, reload `F5` / `Mod-r`, `Mod-l`, `F6`, `Mod-d`, `Mod-h`, zoom `Mod-0 = + -`, `F11`, `F12`, `Mod-Shift-i/j`, `Mod-Alt-i`); a chord without Ctrl / Alt / Meta (Shift alone does not count; function keys are not exempt) on a command without `when`. The same checks apply to `keymap`. Same chord + same `scope` (both absent counts) = dev warning, both kept.
- **Commands with `confirm` before lot 2**: stored (`CommandInfo.confirm`) but their keys are NOT bound (warning); the command stays runnable by `exec` / `commands.run`. Rationale: running a risky command from a key without its confirmation is the one failure that cannot be undone by a later lot; lot 2 only has to stop refusing them (`TODO(ADR-017 lot 2)` in `CommandRegistry#register`).
- **Commands as actions**: each registered command is also a Pulse action under its id, run with a context whose `event` is `null` (no `when` check). If an extension declares both an `actions` entry and a command with the same id, both run: don't. The engine's own `block:move-up` / `block:move-down` (`Mod-Shift-ArrowUp` / `ArrowDown`, `src/lib/blocks/move.js`, P-80: one step among the siblings of one parent, a selection moves as a run, an edge is a no-op, never leaves its container) are core commands too. The engine's own `undo` / `redo` are now commands (`Mod-z`; `Mod-Shift-z`, `Mod-y`), no longer special-cased in `handleKeydown`; `nabu.exec('undo')` is unchanged.
- **Migrated**: undo / redo (engine); `mark:bold` (`Mod-b`), `mark:italic` (`Mod-i`), `mark:underline` (`Mod-u`), `mark:code` (`Mod-e`), `mark:strikethrough` (`Mod-Shift-x`) in `rich-text`; `todo:toggle` (`Mod-Enter`, `scope: 'list-item'`, `when`: the selection touches a to-do item) in `list-item`. The `rich-text` `onKeyDown` hook stays, reduced to swallowing the browser's own Ctrl/Cmd+B / I / U when no command took them (otherwise a rebound or disabled shortcut would come back through the native `formatBold` → `beforeinput`). `toggleTodos(nabu, event)` is kept as a thin wrapper (`toggleSelectedTodos` is the command's body). Everything else (lists Tab, code, toggle, slash menu…) is still legacy hooks (lot 3).
- **Regions lot 2 and Mod-Enter**: `region:split` can declare `Mod-Enter` with `when: ctx.inRoot && …`; in a to-do item `todo:toggle` is scoped to `list-item` and wins; elsewhere the split applies. Pinned by `commands.test.js` ("Mod-Enter coexistence").
- **Introspection**: `nabu.commands.list(ctx?)` / `get(id, ctx?)` return plain snapshots (`id`, `label`, `keys`, `display`, `scope`, `extension`, `available`, `confirm`); not reactive, the set of commands is fixed once the editor is built (no runtime registration yet). `run(id, data)` = `nabu.exec`.
- **What lot 2 needs from here**: `CommandRegistry#handleKeydown` (the tie → `choose` and the `confirm` dispatch go there; `event.repeat` is on the event already in `ctx.event`), `CommandInfo.confirm`, the `register` refusal of `confirm` keys to lift, `ctx.event` for the "fresh press" rule of `hold`, `nabu.pendingCommand` to add on `Nabu`.

---

## 7. Implementation notes — lot 2 (2026-10-22)

Code: `src/lib/utils/command-confirm.svelte.js` (`CommandConfirmation`, `PendingCommand`), the dispatch in `CommandRegistry#handleKeydown` / `register` (`utils/commands.js`), wiring in `Nabu` (`commandConfirm` init option, `pendingCommand`, `cancelPendingCommand()`, `pendingCommandOn()`, `commandAnnouncement`; a `systems` entry attaches the document listeners), `Nabu.svelte` (live region, target marking), `ui/CommandInvite.svelte`, `ui/CommandChooser.svelte`, `ui/anchor.js`. Tests: `tests/unit/command-confirm.test.js` (fake clock), `tests/e2e/command-confirm.spec.ts` with the dev-only demo commands of `/e2e?commands=demo` (`src/routes/e2e/demo-commands.js`).

- **Order**: `CommandRegistry#handleKeydown` first lets the controller see the key while something is pending (or the key of a completed hold is still down); only if it does not consume it does the normal resolution go on. So "another key cancels and acts normally" is just: cancel, then resolve (the key may even be another command). Lone modifier presses are ignored by every strategy.
- **Fresh vs repeated**: `event.repeat`. A winner command with `confirm` that gets a repeat swallows it (`preventDefault`, no state) instead of starting: that is the whole "stop a held key at the context" rule, it needs no memory of where the key was pressed (`when` is evaluated per event: false -> the repeat flows to the native behaviour, true -> swallowed). After a hold completes, the chord is remembered as spent and its repeats are swallowed until its `keyup` (or a blur / a new fresh press of it). Invite / choose use the same rule.
- **Release**: the controller listens to `keyup` (capture) on the document; the main key (by `event.code`, else the normalized key) or any modifier of the chord going up cancels an unfinished hold.
- **Clock**: `CommandConfirmOptions.clock = { now, timeout, frame }` (default `performance.now` / `setTimeout` / `requestAnimationFrame`). `progress = min(1, (now - start) / holdMs)` computed at each frame; the completion is decided by the same frame, so progress and completion cannot disagree. Tests inject a fake clock.
- **Cancellation**: keyup, another key, `selectionchange` away from the DOM selection captured at the start, `mousedown` outside `[data-nabu-ui]`, `focusout` to outside the editor / UI, window `blur`, invite timeout, `nabu.cancelPendingCommand()`. A chooser has no timeout. At completion / confirmation `when` is evaluated again with a fresh context: a command that no longer applies does not run.
- **Choose**: a tie is only among the top-ranked candidates (same `scope` rank): the tied entries become the options (`display` = the shared chord). Running an option runs the command directly (choosing is the confirmation; a tied command's own `confirm` is not asked again) with the context of the key press. Explicit variants: `confirm.options(ctx)`; the options keep their own extra fields and `run(nabu, ctx, option)` receives the chosen option. Empty options: the key falls through. Behaviour change vs lot 1: a command scoped to another block type no longer beats a generic one by registration order, they tie.
- **Live region**: one `role="status" aria-live="polite" aria-atomic` element per `Nabu.svelte` (`[data-nabu-live]`, visually hidden). The controller owns the text (`nabu.commandAnnouncement`); consecutive identical messages alternate an invisible suffix so that they are spoken again. Cancellations are announced when the user asked (release, Escape, timeout), not when they typed on. Texts: `ConfirmMessages` (`hold`, `invite`, `choose`, `option`, `done`, `cancelled`), English by default, overridable globally (`commandConfirm.messages`) and per command (`confirm.messages`).
- **Rendering**: `hold` is drawn by its target. `Nabu.svelte` sets `data-command-target="hold"` and `--nb-command-progress` on the element of `pending.target` (a block with a mounted `element`, or a DOM node) and ships a neutral outline + fill; blocks can ask `nabu.pendingCommandOn(block)` and draw their own. `CommandInvite` also serves as the fallback for a hold without mountable target (`hold: 'auto'`). `CommandChooser` only renders: the keyboard is the engine's, clicks call `nabu.commandConfirm.choose(i)`. Both are `position: fixed`, caret-anchored (flip / clamp as `SlashMenu`), `data-nabu-ui`.
- **Regions lot 2 needs**: declare `region:merge-previous` with `keys: ['Backspace']`, a `when` built on its `commandContext` facts (`atStartOfRegion`...), `confirm: { strategy: 'hold', target: (ctx) => <the marker block> }`, and have the marker component draw `nabu.pendingCommandOn(block)?.progress` (or rely on the default `data-command-target` style). `region:split` on `Mod-Enter` needs no confirmation. Pick default keys that do not tie with other commands in the same context.

---

## 8. Implementation notes — Regions lot 2 (2026-10-22)

The first client of `hold` (ADR 016 §8): `region:merge-previous` (`Backspace`, `Shift-Backspace`) and `region:merge-next` (`Delete`), `confirm: { strategy: 'hold', target: marker, messages: { hold } }` where `target` is the seam being removed and `messages.hold` builds the prompt from the command label ("Hold Backspace to merge with “…”"). Facts: `atStartOfRegion` / `atEndOfRegion` / `region` / `previousRegion` / `nextRegion` / `inRootTextBlock`. `region:split` on `Mod-Enter` has no confirmation and coexists with `todo:toggle` (different `when`: the split needs a root text block; the toggle is scoped to list items). Learned: (1) a command with `confirm` on a bare key swallows the repeats while its `when` holds, which is exactly the "erasing a word stops at the boundary" rule; no extra code in the extension. (2) A key cannot carry `data`, so a command parameterised by `data` (`region:move`) needs fixed-argument siblings (`region:move-up` / `move-down`) to be bindable. (3) A confirmation protects only what goes through the command: the engine's own text merge got a generic `onBeforeMerge(nabu, survivor, victim)` hook (`TextBehavior`, both directions) so that an extension can refuse a merge whatever started it.
