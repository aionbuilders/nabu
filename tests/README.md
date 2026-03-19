# Nabu Test Suite

Complete test coverage for `@aionbuilders/nabu` — pre-beta quality gate.

## Structure

```
tests/
├── unit/                    # Vitest unit tests (pure logic, no browser)
│   ├── setup.js             # Global test setup
│   ├── deltaToMarkdown.test.js   # deltaToMarkdown() + deltaToHtml()
│   ├── calculateOffset.test.js   # TextBehavior.calculateOffset/getDOMPoint
│   ├── marks.test.js             # isMarkActive, applyMark, toggleMark
│   ├── block.ascend.test.js      # Block.ascend() event bubbling
│   ├── block.consume.test.js     # Block.consume() merge logic
│   ├── block.split.test.js       # Block.split() / TextBehavior.split()
│   ├── container.utils.test.js   # findLCA, findDirectChildOf, wrapOrphan
│   ├── serialize.test.js         # Block serializer static methods
│   ├── list.fromMarkdown.test.js # List.fromMarkdown() parser
│   ├── list.fromHTML.test.js     # List/ListItem.fromHTML() parsers
│   └── factories.test.js         # Paragraph/Heading static factories
│
└── e2e/                     # Playwright E2E tests (real browser)
    ├── helpers/
    │   ├── editor.ts        # Core helper — ALWAYS import this first
    │   ├── keyboard.ts      # Key shortcut aliases
    │   └── clipboard.ts     # Clipboard read/write helpers
    ├── typing.spec.ts       # Basic text input
    ├── structure.spec.ts    # Block navigation
    ├── marks.spec.ts        # Rich text marks
    ├── undo.spec.ts         # Undo/redo
    ├── lists.spec.ts        # List blocks
    ├── dialogue.spec.ts     # Dialogue block
    ├── transforms.spec.ts   # Block type transforms
    ├── copy.spec.ts         # Copy/Cut
    ├── paste.spec.ts        # Paste (plain, HTML, markdown)
    ├── serialize.spec.ts    # Serialization
    ├── actions.spec.ts      # nabu.exec() action bus
    ├── edge-cases.spec.ts   # Critical edge cases
    ├── persistence.spec.ts  # IndexedDB auto-save
    └── flaky/
        └── flaky.spec.ts    # FLAKY_RISK tests (retries: 2, timeout: 15s)
```

## Running Tests

```bash
# Unit tests only
bun run test:unit

# Unit tests in watch mode
bun run test:unit:watch

# E2E tests (requires running dev server OR auto-started via webServer config)
bun run test:e2e

# Both unit + E2E
bun run test

# E2E flaky suite only
npx playwright test --project=flaky
```

## Configuration

| Config file           | Purpose                                    |
|-----------------------|--------------------------------------------|
| `vitest.config.js`    | Vitest with happy-dom, Svelte plugin, $lib alias |
| `playwright.config.js`| Dual project: `core` (normal) + `flaky` (retries: 2) |

## Key Constraints

These rules are enforced throughout the test suite:

1. **Never `page.fill()` on contenteditable** — only `keyboard.type()` / `keyboard.press()`
2. **`window.nabu` via `page.evaluate()`** after `window.__nabu_debug?.()` is called
3. **`waitForEditor()`** uses `page.waitForFunction()` — no arbitrary sleeps
4. **`clearAndReset()`** at the start of each test for a clean slate
5. **No modifications to `src/lib/`** — bugs are noted with `// BUG: description`
6. **No P0 test skips** — use `test.todo()` if a test can't be written yet

## Priority Levels

| Level | Description                    | Example                         |
|-------|--------------------------------|---------------------------------|
| P0    | Blocking — must pass for beta  | Typing, Enter, Backspace, Undo  |
| P1    | Important — should pass        | Marks, Lists, Transforms        |
| P2    | Nice-to-have                   | Unicode, performance, edge cases|

## FLAKY_RISK Tests

Tests marked FLAKY_RISK are in `tests/e2e/flaky/` and run with:
- `retries: 2` (3 total attempts)
- `timeout: 15000ms`

Categories: clipboard APIs, CRDT undo timing, IndexedDB debounce, cross-block selection.

## Debug Access

The app exposes `window.nabu` via:
```js
window.__nabu_debug?.()  // triggers debug mode, sets window.nabu
```

All E2E helpers call this automatically via `gotoEditor()`.

## Svelte 5 Rune Notes

Unit tests use `new ClassName(...)` (not `Object.create`) because Svelte 5 compiles
`$state`/`$derived` class fields to private fields that only exist on properly-constructed
instances. Happy-dom provides a real DOM for `calculateOffset`/`getDOMPoint` tests.
