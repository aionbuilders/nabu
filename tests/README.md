# Nabu test suite

Two layers plus an on-demand performance project, and the documentation examples (which are tests too).

```
tests/
├── unit/        Vitest + happy-dom: ~90 files, pure logic and the engine without a browser
├── e2e/         Playwright (Chromium): ~50 specs, one real editor per test
│   ├── helpers/ shared helpers (editor boot, keyboard, clipboard, model, DOM invariant...)
│   ├── flaky/   tests at known timing risk, run in their own project with retries
│   └── perf/    large-document measurements (own project, run on demand)
└── fixtures/    static inputs (html/: the HTML paste corpus, see fixtures/html/README.md)
```

## Running

```bash
bun run test:unit            # all unit tests, including the documentation examples
bun run test:unit:watch      # watch mode
bun run test:e2e             # builds the e2e app (VITE_NABU_E2E=1) and runs Playwright against `vite preview` on port 5180
bun run test:e2e:dev         # same against the Vite dev server (debugging only: slower, flaky under load)
bun run test                 # unit, then e2e
bun run check                # svelte-check on src/lib
```

Playwright projects (see `playwright.config.js`):

| Project | Directory | Notes |
|---|---|---|
| `core` | `tests/e2e` | everything except `flaky/` and `perf/`; `bun run test:e2e` runs `core` and `flaky` |
| `flaky` | `tests/e2e/flaky` | `retries: 2`, `timeout: 15000` (clipboard APIs, CRDT undo timing, IndexedDB debounce, cross-block selection) |
| `perf` | `tests/e2e/perf` | only exists when asked for: `bunx playwright test --project=perf` (or `NABU_PERF=1`). Large documents (1 000 to 10 000 blocks), prints a table and writes `test-results/perf.json`. One worker; can take 30 to 60 minutes. Knobs (`NABU_PERF_SIZES`, `NABU_PERF_CAP_MS`...) are documented at the top of `large-docs.perf.ts` |

Run a single spec with `bunx playwright test tests/e2e/marks.spec.ts`; use `--reporter=line` for ad-hoc runs. The default config also writes a JSON report to `test-results/results.json` (git-ignored).

## Unit tests (`tests/unit`)

Vitest, `happy-dom` environment, globals on (`describe`, `it`, `expect`, `vi`, `beforeEach`), `setup.js` as setup file. `#lib` (-> `src/lib`) resolves through the `imports` field of `package.json`; the public package names (`@aionbuilders/nabu`, `/ui`, `/extend`, `/vite`) are aliased to the source entry files in `vitest.config.js`.

By area (file name prefixes):

| Area | Files |
|---|---|
| Engine and blocks | `block.*`, `block-*`, `container.utils`, `leaf-children`, `reparent`, `roundtrip-structure`, `factories`, `placeholders.svelte` |
| Selection and caret | `calculateOffset`, `caret-navigation`, `selection-sync`, `isolated-selection`, `composition` (IME) |
| Text and marks | `marks`, `link`, `markdown-*`, `deltaToMarkdown`, `delete-*`, `native-input`, `multi-delete` |
| Lists | `list*`, `checklist` |
| Blocks | `callout`, `code-block`, `blockquote-divider`, `image`, `media-blocks`, `regions`, `region-*` |
| Clipboard and paste | `paste*`, `html-paste*`, `html-safety`, `clipboard-serialize`, `drop` |
| Import and export | `import`, `serialize` |
| Commands and keys | `commands`, `command-confirm`, `keys`, `shortcut-undo` |
| Files and assets | `asset-*`, `paste-files` |
| Persistence | `persistence-*`, `history-compaction` |
| Public API | `public-api`: pins the exact export list of the three entry points |
| Documentation | `docs-examples`: see below |

Svelte 5 rune classes (`$state` / `$derived` fields) only exist on properly constructed instances, so unit tests use `new Nabu(...)` or `new ClassName(...)`, never `Object.create`. happy-dom provides a real DOM for the offset and DOM point tests.

### Documentation examples

`docs-examples.test.js` runs the documentation. It reads `README.md` and every `docs/**/*.md` (except `docs/archive`):

- a block fenced as ` ```js test ` is executed (imports use the public package names, top-level `await` works, `expect` is global); a failure is reported as `<file>:<line>`;
- a block fenced as ` ```svelte ` must compile with `svelte/compiler`;
- any other block is illustrative and ignored;
- pages in `docs/getting-started`, `docs/guides` and `docs/recipes` must have the frontmatter the website uses: `title`, `description`, `section`, `order`.

## E2E tests (`tests/e2e`)

Every test boots a fresh editor (WASM Loro) on the `/e2e` route of the demo app, which reads:

- `?persist=<docId>`: an IndexedDB-backed editor;
- `?options=<json>`: Nabu init options;
- `?hostFiles=1|gated|fail`: an in-memory `files.onBeforePersist` (immediate, held until `window.__hostRelease()`, or failing while `window.__hostFailing`).

It exposes `window.nabu` (the engine) and sets `window.__nabu_ready = true` once the engine is created; `gotoEditor()` navigates there and waits for it. There is no debug toggle.

### Target: a production build

Against the dev server, on-demand transforms made the editor boot time out under load, so the suite runs against a **production build**:

- `playwright.config.js` `webServer` runs `bun run build:e2e && bun run preview -- --port 5180 --strictPort` with `reuseExistingServer: false` (a stale server can never serve an old build);
- `build:e2e` is `VITE_NABU_E2E=1 vite build`. The `/e2e` route (`src/routes/e2e/+page.js`) answers 404 unless `dev` is true **or** `import.meta.env.VITE_NABU_E2E === '1'`, so the deployed demo has no such route;
- `NABU_E2E_DEV=1` (or `bun run test:e2e:dev`) switches to `bun run dev` on the same port; `NABU_E2E_PORT` changes the port;
- `workers: 6`. More workers are not faster and give timing failures.

### Helpers (`tests/e2e/helpers`)

| File | Purpose |
|---|---|
| `test.ts` | the `test` every spec imports: Playwright's, plus the automatic DOM invariant fixture |
| `editor.ts` | core helpers: `gotoEditor`, `clearAndReset`, `flushRender`, `press`, boot diagnostics and retry |
| `keyboard.ts` | key shortcut aliases (`Keys.bold`...) |
| `clipboard.ts`, `clip-capture.ts` | read / write the clipboard; capture the payloads of a copy / cut event |
| `blocks.ts`, `model.ts` | build a document from a small spec, dump the model tree as a one-line outline, place a caret or selection by text, structural invariants |
| `ui.ts` | UI components: viewport geometry, real-input drags and scrolling, WCAG contrast |
| `dom-invariant.ts` | the invariant checker, see below |

### The automatic DOM invariant

`helpers/test.ts` adds an **auto fixture**: after every test that passed, it checks the editor's DOM and selection without touching them (`helpers/dom-invariant.ts`):

1. no whitespace-only text node outside a block's own text (the editor uses `white-space: pre-wrap`, so stray whitespace between the tags of a block component becomes a real selectable line);
2. no "phantom" selectable box: every selectable box must belong to a block's own content.

A violation fails the test with the offending node and the nearest block ids. Opt out sparingly and always with a reason: `test.use({ domInvariant: false })` for a file or describe, or an annotation `{ type: 'skip-dom-invariant', description: '<why>' }` for one test. `dom-invariant.spec.ts` tests the checker itself.

## Rules

1. Never `page.fill()` a contenteditable: use `keyboard.type()` / `keyboard.press()`.
2. Reach the engine with `page.evaluate()` on `window.nabu`.
3. Wait with `page.waitForFunction()` (`waitForEditor`, `flushRender`), never with arbitrary sleeps.
4. Start each test from a clean slate (`gotoEditor` then `clearAndReset`).
5. A bug found by a test is fixed in `src/lib`, or recorded with a `// BUG: description` comment and a test marked `test.fixme` / `test.todo`, never silently skipped.
6. Import `test` and `expect` from `helpers/test.js` so the DOM invariant applies.
7. Prefer turning a manual checklist into a spec; keep manual testing for "feel".

Tests at known timing risk go in `tests/e2e/flaky/` (clipboard APIs, CRDT undo timing, IndexedDB debounce, cross-block selection).
