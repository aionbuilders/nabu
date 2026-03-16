# ADR 011 : Action Bus — `nabu.exec()` wrappant Pulse

## Statut
Accepté

## Contexte

La floating toolbar (et tout composant UI externe) a besoin de déclencher des actions sur l'éditeur : toggle bold, transformer un bloc en H2, indenter un item de liste. Avant ce chantier, la logique était enfouie dans les handlers `onKeyDown` des extensions — inaccessible depuis l'extérieur.

Trois approches ont été évaluées :

### Option A — Méthodes directes sur Nabu
```js
nabu.toggleMark('bold')
nabu.transformBlock('heading', { level: 2 })
```
Problème : fait grossir `Nabu` indéfiniment, couplage fort, pas extensible.

### Option B — Command Registry
Un `Map<string, Function>` sur Nabu, les extensions y enregistrent des handlers nommés.
Problème : complexifie Nabu, introduit un système parallèle aux hooks, pattern redondant.

### Option C — Event Bus avec abstraction (retenu)
`nabu.exec(topic, data)` comme unique point d'entrée public. Implémentation interne via Pulse (`@aionbuilders/pulse`, déjà dependency) caché derrière un private field `#pulse`. Les extensions déclarent leurs handlers via une propriété `actions` — même pattern que `hooks` et `serializers`.

## Décision

**Option C retenue.** `nabu.exec()` est la seule API publique. Pulse n'est jamais exposé.

### Pourquoi Pulse en interne
- Déjà dependency du projet
- Pattern matching hiérarchique (`mark:toggle`, `bold`, etc.) natif
- Async par défaut — pas de blocage synchrone
- Wildcard (`mark:**`) disponible si besoin futur

### Pourquoi abstraire Pulse
- L'implémentation interne peut changer sans casser les consommateurs
- L'API `nabu.exec()` est orthogonale à Pulse (sémantique "commande" plutôt qu'"événement")
- Évite l'exposition d'une dépendance qui ne fait pas partie du contrat public de Nabu

## Architecture

### Propriété `actions` sur Extension

```js
export const RichTextExtension = new Extension('rich-text', {
    actions: {
        'mark:toggle': (nabu, data) => toggleMark(nabu, data?.mark),
        'bold':        (nabu) => toggleMark(nabu, 'bold'),
    },
    hooks: { onKeyDown }
});
```

Signature des handlers : `(nabu: Nabu, data: any, topic: string) => void`

### Enregistrement dans Nabu

Dans le constructeur, après la boucle extensions :
```js
if (ext.actions) {
    for (const [topic, handler] of Object.entries(ext.actions)) {
        this.#pulse.on(topic, ({ event }) => handler(this, event.data, event.topic));
    }
}
// Core actions — toujours disponibles
this.#pulse.on('undo', () => this.undo());
this.#pulse.on('redo', () => this.redo());
```

### Dispatch

```js
exec(topic, data) {
    return this.#pulse.emit(topic, data);
}
```

### Hiérarchie des actions (conventions)

| Topic | Propriétaire | Description |
|-------|-------------|-------------|
| `mark:toggle` / `mark:apply` / `mark:remove` | `RichTextExtension` | Marks inline |
| `bold`, `italic`, `underline`, `code`, `strikethrough` | `RichTextExtension` | Aliases courts |
| `block:transform` | `BlockExtension` | Transform type du bloc courant |
| `heading:1`…`heading:6` | `HeadingExtension` | Aliases → délèguent à `block:transform` |
| `paragraph` | `ParagraphExtension` | Alias → délègue à `block:transform` |
| `list:indent` / `list:unindent` | `ListItemExtension` | Indent/unindent item de liste |
| `undo` / `redo` | Core (Nabu) | Toujours disponibles |

### Convention aliases

Les aliases de type (`heading:1`, `paragraph`) sont **déclarés dans l'extension de leur bloc** et délèguent à l'action générique :
```js
// HeadingExtension
'heading:1': (nabu) => nabu.exec('block:transform', { type: 'heading', props: { level: 1 } })
```
Cohérence : si `HeadingExtension` n'est pas inclus, `heading:1` n'existe pas.

## Conséquences

✅ API propre pour les composants UI externes (toolbar, menu slash, etc.)
✅ Pas de couplage entre Nabu et Pulse côté consommateur
✅ Extensions déclarent leur surface d'API de façon cohérente avec le reste du système
✅ `onKeyDown` peut déléguer à `exec` — logique centralisée, pas dupliquée
⚠️ `exec` est async (Pulse) — ne pas attendre de retour synchrone
⚠️ Si `BlockExtension` n'est pas inclus, `block:transform` + les aliases heading/paragraph ne fonctionnent pas silencieusement
