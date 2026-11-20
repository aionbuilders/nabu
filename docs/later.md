# Later

Ideas worth keeping that were too heavy or off-topic when they came up. Each entry says why and where it came from. Move an entry out when it is planned (roadmap, ADR) or dropped (say why).

## Performance

- **Profile the opening of a long document.** A 90,000-word novel opens in ~3.1 s on WebKit and ~1.1 s on Chromium (4.1 s / 1.6 s at 150,000 words). Measure where the time goes (Loro import, Svelte mount, layout) before choosing a fix. Candidates, in order: progressive mounting (mount the visible screen, then the rest in idle slices, the DOM ends up complete so selection, find, spellcheck and accessibility keep working), then lighter blocks (~14 DOM nodes and ~15 KB per block today). True lazy mounting only if memory becomes the problem. Source: WebKit typing fix, 2026-11-15 (`tests/e2e/perf/novel-typing.perf.ts`).
- **Home page editor mount long task (~0.9 s).** Split it. Source: Core Web Vitals work on the site, 2026-11.
- **Loro WebAssembly loaded asynchronously in production builds,** without a top-level await. The bundler-entry attempt broke a client-only route on Playwright's WebKit 2248 ("L is not a function") and was removed before 0.1.6. A future option is Loro's `web` entry with an explicit async init, which changes the API (to design together). Source: 2026-11-15.

## Input

- **Isolate input handling behind one layer** (beforeinput, composition), so that an `EditContext` input adapter can be plugged in later for Chromium and Android keyboards, keeping contenteditable for rendering, caret and spellcheck. Wait for Firefox to ship EditContext and WebKit to commit to it. Source: EditContext discussion, 2026-11-17.

## Ecosystem

- **A Rust `nabu-model` crate** that reads, writes and converts Nabu documents (Loro is Rust natively), checked by the same conformance tests as the JS. Useful first to Orduin's Tauri backend (export, search, stats without the WebView); a foundation if a native (GPUI) editor ever happens. Source: GPUI discussion, 2026-11-15.

## Loro

- **Undo throws after importing a document that another engine created on its own.** Two engines each start with their own initial paragraph; one imports the other's updates, types a letter, then `undo()`: Loro throws `Index out of bound ... handler.rs:2362`. Seen with `stableIds` off too, so not caused by ADR 019. Real documents share their origin (one creates, the others import), which may be why nobody hit it. To reproduce on bare Loro, then report upstream or add a canary to `tests/unit/loro-quirks.test.js`. Source: ADR 019 lot A, 2026-11-21.

## Stable block ids

- **`importJSON(json, { keepUids: true })`**, to restore a JSON backup into an empty editor with its block uids, so that links to its blocks still work. Not needed today: `importJSON` is a paste and mints new uids, and Orduin saves Loro, not JSON. Source: ADR 019 §8 Q4, 2026-11-21.

## Release and CI

- **Pin the GitHub Actions of `publish.yml` by commit SHA** instead of major tags (`actions/checkout@v4`...), the usual hardening for a workflow that holds the publish right. Source: trusted publishing setup, 2026-11-17.
- **Staged publishing** (`npm stage publish`, approved on npmjs.com with 2FA) on top of the GitHub approval, if the threat model grows (a compromised GitHub account). Not chosen for now: one approval click is enough. Source: 2026-11-17.
