# Guide — Action Bus (`nabu.exec`)

`nabu.exec(topic, data?)` est le point d'entrée unique pour déclencher des actions sur l'éditeur depuis l'extérieur : boutons toolbar, raccourcis custom, scripts, etc.

## Usage de base

```js
// Fire and forget (async en interne)
nabu.exec('bold')
nabu.exec('italic')
nabu.exec('heading:1')
nabu.exec('paragraph')
nabu.exec('undo')
nabu.exec('redo')
```

## Actions disponibles

### Marks (inline formatting)

Nécessite `RichTextExtension` dans les extensions.

```js
// Full API
nabu.exec('mark:toggle', { mark: 'bold' })
nabu.exec('mark:apply',  { mark: 'italic', value: true })
nabu.exec('mark:remove', { mark: 'underline' })

// Aliases courts (toggle)
nabu.exec('bold')
nabu.exec('italic')
nabu.exec('underline')
nabu.exec('code')
nabu.exec('strikethrough')
```

Toutes ces actions opèrent sur la **sélection courante**. Sans sélection non-collapsée, elles ne font rien.

### Transformation de type de bloc

Nécessite `BlockExtension` + l'extension du type cible.

```js
// Full API
nabu.exec('block:transform', { type: 'heading', props: { level: 2 } })
nabu.exec('block:transform', { type: 'paragraph' })

// Aliases (nécessitent HeadingExtension / ParagraphExtension)
nabu.exec('heading:1')  // → heading niveau 1
nabu.exec('heading:2')
nabu.exec('heading:3')
nabu.exec('heading:4')
nabu.exec('heading:5')
nabu.exec('heading:6')
nabu.exec('paragraph')
```

Opère sur le **bloc anchor** (bloc contenant le curseur). Le curseur est restauré après la transformation.

### Listes

Nécessite `ListItemExtension`.

```js
nabu.exec('list:indent')    // Tab — indente l'item courant dans la sous-liste du précédent
nabu.exec('list:unindent')  // Shift+Tab — désindente l'item courant
```

Ne fait rien si le bloc courant n'est pas un `list-item`.

### Historique

Toujours disponibles, sans extension requise.

```js
nabu.exec('undo')
nabu.exec('redo')
```

## Déclarer des actions dans une extension

```js
import { Extension } from '@aionbuilders/nabu';

const MyExtension = new Extension('my-ext', {
    actions: {
        // Signature : (nabu, data, topic) => void
        'my:action': (nabu, data) => {
            const block = nabu.selection.anchorBlock;
            if (!block) return;
            // ... faire quelque chose
            nabu.commit();
        },
        // Alias qui délègue à une autre action
        'my-shortcut': (nabu) => nabu.exec('my:action', { default: true }),
    }
});
```

Les actions reçoivent :
- `nabu` — l'instance de l'éditeur (accès à `nabu.selection`, `nabu.blocks`, etc.)
- `data` — la payload passée à `exec()`, peut être `undefined`
- `topic` — le topic exact émis (utile pour les handlers wildcard)

## Conventions de nommage

Les topics suivent la convention `namespace:entity:action` de Pulse :

| Pattern | Usage |
|---------|-------|
| `mark:toggle` | Namespace + action générique |
| `bold` | Alias court (un seul segment) |
| `heading:1` | Type de bloc + variante |
| `list:indent` | Namespace + action spécifique |

## Notes importantes

- `exec` est **async** — ne pas compter sur un retour synchrone
- Les actions opèrent sur la **sélection courante** — l'éditeur doit avoir le focus
- Si une extension n'est pas incluse, ses actions n'existent pas silencieusement (aucune erreur)
- Pulse (`@aionbuilders/pulse`) est l'implémentation interne — jamais exposé directement
