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

# E2E tests: builds the app with VITE_NABU_E2E=1 (production build) and serves it
# with `vite preview` on port 5180 (started and stopped by Playwright, ~25 s build)
bun run test:e2e

# E2E against the Vite dev server instead (debugging only: slower, flaky under load)
bun run test:e2e:dev        # = NABU_E2E_DEV=1 playwright test

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

## E2E target: production build

Every test boots a fresh editor (WASM loro) on the `/e2e` route. Against the dev server the
on-demand transforms made that boot time out under load (random `beforeEach` timeouts), so the
suite runs against a **production build**:

- `playwright.config.js` `webServer` runs `bun run build:e2e && bun run preview -- --port 5180 --strictPort`
  (`reuseExistingServer: false`, so a stale server can never serve an old build).
- `build:e2e` is `VITE_NABU_E2E=1 vite build`. The `/e2e` route (`src/routes/e2e/+page.js`) answers
  404 unless `dev` is true **or** `import.meta.env.VITE_NABU_E2E === '1'`; a normal `vite build`
  (the deployed demo) leaves it a 404.
- `NABU_E2E_DEV=1` (or `bun run test:e2e:dev`) switches back to `bun run dev` on port 5180.
- `workers: 6`. Measured on the prod build (644 tests): 6 workers ~2.5 min, always green; 10 and
  12 workers are not faster (~2.4 min) and 10 gave a few timing failures in one of two runs; 4 workers ~2.8 min.
- Use `--reporter=line` (or `list`) for ad-hoc runs; the default config also writes a JSON report to `test-results/results.json` (git-ignored).

The `/e2e` route reads `?persist=<docId>` (IndexedDB-backed editor), `?options=<json>` (Nabu init
options), `?hostFiles=1|gated` (in-memory `files.onBeforePersist`), and exposes `window.nabu` plus
`window.__nabu_ready`.

## Key Constraints

These rules are enforced throughout the test suite:

1. **Never `page.fill()` on contenteditable** — only `keyboard.type()` / `keyboard.press()`
2. **`window.nabu` via `page.evaluate()`** — set by the `/e2e` route once the engine is created (`window.__nabu_ready`)
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

The `/e2e` route exposes `window.nabu` (the engine) and sets `window.__nabu_ready = true` once
it is created. `gotoEditor()` navigates there and waits for it; there is no debug-mode toggle.

## Svelte 5 Rune Notes

Unit tests use `new ClassName(...)` (not `Object.create`) because Svelte 5 compiles
`$state`/`$derived` class fields to private fields that only exist on properly-constructed
instances. Happy-dom provides a real DOM for `calculateOffset`/`getDOMPoint` tests.
