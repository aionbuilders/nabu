# ADR 011: Action Bus, `nabu.exec()` Wrapping Pulse

**Status:** Accepted
**Date:** 2026-03-16
**Original:** [French](fr/011-action-bus.md)

## Context

The floating toolbar (and any external UI component) needs to trigger actions on the editor: toggle bold, turn a block into an H2, indent a list item. Before this work, the logic was buried in the `onKeyDown` handlers of the extensions and was unreachable from outside.

Three approaches were evaluated:

### Option A: Direct methods on Nabu
```js
nabu.toggleMark('bold')
nabu.transformBlock('heading', { level: 2 })
```
Problem: makes `Nabu` grow indefinitely, creates tight coupling, and is not extensible.

### Option B: Command registry
A `Map<string, Function>` on Nabu, where extensions register named handlers.
Problem: complicates Nabu, introduces a system parallel to the hooks, and is a redundant pattern.

### Option C: Event bus with an abstraction (chosen)
`nabu.exec(topic, data)` as the single public entry point. The internal implementation uses Pulse (`@aionbuilders/pulse`, already a dependency) hidden behind a private field `#pulse`. Extensions declare their handlers through an `actions` property, the same pattern as `hooks` and `serializers`.

## Decision

**Option C is chosen.** `nabu.exec()` is the only public API. Pulse is never exposed.

### Why Pulse internally
- Already a dependency of the project
- Hierarchical pattern matching (`mark:toggle`, `bold`, etc.) is native
- Async by default, with no synchronous blocking
- Wildcard (`mark:**`) available if needed in the future

### Why abstract Pulse
- The internal implementation can change without breaking consumers
- The `nabu.exec()` API is orthogonal to Pulse (a "command" semantic rather than an "event" one)
- Avoids exposing a dependency that is not part of Nabu's public contract

## Architecture

### `actions` property on Extension

```js
export const RichTextExtension = new Extension('rich-text', {
    actions: {
        'mark:toggle': (nabu, data) => toggleMark(nabu, data?.mark),
        'bold':        (nabu) => toggleMark(nabu, 'bold'),
    },
    hooks: { onKeyDown }
});
```

Handler signature: `(nabu: Nabu, data: any, topic: string) => void`

### Registration in Nabu

In the constructor, after the extensions loop:
```js
if (ext.actions) {
    for (const [topic, handler] of Object.entries(ext.actions)) {
        this.#pulse.on(topic, ({ event }) => handler(this, event.data, event.topic));
    }
}
// Core actions — always available
this.#pulse.on('undo', () => this.undo());
this.#pulse.on('redo', () => this.redo());
```

### Dispatch

```js
exec(topic, data) {
    return this.#pulse.emit(topic, data);
}
```

### Action hierarchy (conventions)

| Topic | Owner | Description |
|-------|-------|-------------|
| `mark:toggle` / `mark:apply` / `mark:remove` | `RichTextExtension` | Inline marks |
| `bold`, `italic`, `underline`, `code`, `strikethrough` | `RichTextExtension` | Short aliases |
| `block:transform` | `BlockExtension` | Transform the type of the current block |
| `code:block` | `CodeExtension` | Alias → delegates to `block:transform` (`code` alone is the inline mark) |
| `heading:1`…`heading:6` | `HeadingExtension` | Aliases → delegate to `block:transform` |
| `paragraph` | `ParagraphExtension` | Alias → delegates to `block:transform` |
| `list:indent` / `list:unindent` | `ListItemExtension` | Indent/unindent a list item |
| `undo` / `redo` | Core (Nabu) | Always available |

### Alias convention

Type aliases (`heading:1`, `paragraph`) are **declared in the extension of their block** and delegate to the generic action:
```js
// HeadingExtension
'heading:1': (nabu) => nabu.exec('block:transform', { type: 'heading', props: { level: 1 } })
```
Consistency: if `HeadingExtension` is not included, `heading:1` does not exist.

## Consequences

✅ Clean API for external UI components (toolbar, slash menu, etc.)
✅ No coupling between Nabu and Pulse on the consumer side
✅ Extensions declare their API surface in a way that is consistent with the rest of the system
✅ `onKeyDown` can delegate to `exec`: centralized logic, not duplicated
⚠️ `exec` is async (Pulse): do not expect a synchronous return value
⚠️ If `BlockExtension` is not included, `block:transform` and the heading/paragraph aliases silently do not work

## Note (2026-10-27)
The core `undo` and `redo` actions are no longer registered directly on the bus: they are commands of the command registry introduced by ADR 017, and every declared command is also exposed as an action of the bus. `nabu.exec()` also re-syncs the model selection from the DOM before dispatching, and actions do nothing when the editor is read-only.
