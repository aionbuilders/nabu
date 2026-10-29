# Contributing to Nabu

Thanks for wanting to help! Nabu is a block editor for Svelte 5, in public beta, built and maintained by one person (with an AI assistant, see [How Nabu is made](https://nabu.aion.builders/architecture/how-it-is-made)). This guide explains what helps most right now and how to get a change in.

Questions before you start? Ask in `#help` on the [Discord](https://discord.gg/gKkyqRRuWe).

## What helps most

- **Bug reports with steps to reproduce.** A good issue is a real contribution, often the most useful one.
- **Bug fixes that come with a test.** The test is what keeps the bug from coming back.
- **Docs.** Typos, missing examples, anything that confused you. The docs are the Markdown files in `docs/`, and the website renders them.
- **Tests for behaviour that isn't covered yet.**
- **Trying Nabu outside Chromium.** Firefox, Safari and mobile keyboards are not tested yet ([limits](https://nabu.aion.builders/architecture/limits)). Reports from those browsers are very welcome.

For anything bigger, like a new block in the core, an API change or a refactor, **open an issue first** so we can talk about it before you write code. A new block doesn't have to live in the core: the [`/extend` contract](https://nabu.aion.builders/docs/guides/extensions) is stable, so you can publish it as your own package.

## Reporting a bug

Open a [GitHub issue](https://github.com/aionbuilders/nabu/issues) with:

- the Nabu version (`@aionbuilders/nabu@x.y.z`) and the Svelte version
- the browser and the OS
- the steps to reproduce, what you expected and what happened
- a minimal reproduction if you can (a small repo, a StackBlitz or a snippet)

## Setup

You need [Bun](https://bun.sh).

```bash
git clone https://github.com/aionbuilders/nabu
cd nabu
bun install
bunx playwright install chromium
bun run dev
```

`bun run dev` serves the website and the demo pages on http://localhost:5173.

## Where things are

| Path | What |
|---|---|
| `src/lib` | the library, the only thing published to npm |
| `src/routes`, `src/site` | the website and the demo pages (not published) |
| `tests/unit` | Vitest tests, no browser |
| `tests/e2e` | Playwright tests, one real editor per test |
| `docs/` | the documentation shown on the website, and the decision records in `docs/adr` |

## Tests

```bash
bun run test:unit    # Vitest
bun run test:e2e     # builds the test app and runs Playwright (Chromium) on port 5180
```

To run one spec: `bunx playwright test tests/e2e/marks.spec.ts --reporter=line`. More details in [tests/README.md](tests/README.md).

Before opening a pull request, the unit tests and the e2e specs related to your change should pass. `bun run check` (svelte-check) still reports existing type errors, so please just don't add new ones in the files you touch.

## How the code is written

- **JavaScript with JSDoc types**, not TypeScript ([ADR 005](docs/adr/005-jsdoc-typing-strategy.md)). Svelte 5 runes, with the engine written as classes.
- **No whitespace between tags in the editor's markup.** The whole editor is a single `contenteditable`, so a space or a line break between two tags in a block component becomes text the caret can land on. Keep the tags glued together (see the existing block components).
- **Keep runtime dependencies to a minimum.** Ask in an issue before adding one.
- **The public API is a promise.** Patch versions (0.1.x) never break the public API or the `/extend` contract. A new public member gets a `@public` JSDoc tag and a test. Anything under `nabu.internals` is unstable on purpose.
- **Prefer explicit over clever.** The engine is complex enough already.

## Decision records

Architecture decisions are written down in [`docs/adr`](docs/adr). Before proposing a change to the architecture, read the ones it touches: they explain why things are the way they are, including the decisions we got wrong ([ADR 018](docs/adr/018-regions-as-containers.md) replaces [016](docs/adr/016-regions.md)). The early ones were written in French; the originals are in `docs/adr/fr`.

If your change needs a decision and none covers it, add one with the same shape as the others: Status, Date, Context, Decision, Consequences.

## Pull requests

1. Fork the repo and branch from `main`.
2. Keep the scope tight: one fix or one feature per pull request.
3. Add or update tests.
4. Describe what changes and why it is the right change.
5. If you used an AI assistant, say so in the description. That's fine here, as long as you have read and understood every line you submit.

Commit messages loosely follow `type(scope): summary`, for example `fix(selection): ...`. Not a strict rule.

## License

Nabu is MIT. By contributing, you agree that your contribution is released under the same license.

---

Nabu is maintained by one person, so reviews can take a few days. Patience is appreciated, on both sides 🙂
